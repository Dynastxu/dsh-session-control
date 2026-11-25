/**
 * Host half of `@dynastxu/dsh-session-control`.
 *
 * A pause marks the addressed Agent and every live descendant that is currently
 * running. Each member finishes the step in flight and is cancelled at its own
 * next `agent/pre-step` boundary, the last point before its next model request
 * would be issued, so the turn records as the user stop the transcript already
 * shows and the batch that boundary claimed returns to the inbox.
 *
 * Continuing submits one empty continuation receipt per stopped run, which wakes
 * that loop over its own history. A paused Agent that is itself a subagent
 * notifies its live parent through a queued runtime context notice; the pause
 * never arms an ancestor.
 *
 * A pause that actually fired outlives the Host process that fired it: the
 * Session id is written to a small ledger in the profile directory, so after a
 * DSH restart `/pause status` still reports the Session and `/pause resume`
 * opens its next turn over the log the stop already left.
 *
 * The composer control reaches this plugin through the user-facing `pause`
 * command, the client-callable Host entry point a bundle can add without a
 * generated Remote contribution.
 *
 * @module @dynastxu/dsh-session-control
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { CommandResult } from "@deepseek-ai/dsh-commands";
import type { ContentBlock, ContextFormed, MessageId, UserMessage } from "@deepseek-ai/dsh-llm";
import type { SessionId } from "@deepseek-ai/dsh-session";
// Type-only: the `retry` message source this plugin submits arrives with the
// Session controller's source declaration.
import type { SessionRequestId } from "@deepseek-ai/dsh-api-session-controller/types";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    /** Runtime context this plugin injects into a paused agent's parent. */
    "session-control": { kind: "session-control" } & ContextFormed;
  }
}

export const name = "session-control";

export const inject = ["agents", "commands"] as const;

/** Command name the composer control invokes. */
export const PAUSE_COMMAND = "pause";

/** Argument that cancels an armed pause. */
const ARGUMENT_OFF = "off";

/** Argument that continues the runs a pause stopped. */
const ARGUMENT_RESUME = "resume";

/** Argument that reports whether this Agent holds a pause that already fired. */
const ARGUMENT_STATUS = "status";

/** Profile file that keeps fired pauses across a Host restart. */
const LEDGER_FILE = "session-control.pauses.json";

/** Ledger format version a reader must recognize before trusting its records. */
const LEDGER_VERSION = 1;

/** The agents one pause covers; members share the record. */
interface PauseRecord {
  /** The Agent the user addressed; the only member a restart can continue. */
  readonly root: Agent;
  readonly armed: Set<Agent>;
  readonly stopped: Set<Agent>;
}

/** What one fired pause leaves durably: the Session and when it stopped. */
interface LedgerEntry {
  readonly pausedAt: string;
}

/** Logger surface the ledger needs; the Host logger satisfies it. */
interface LedgerLogger {
  warn(message: string, error?: unknown): void;
}

/**
 * Resolve the profile directory that owns this plugin's durable ledger.
 * @param ctx - Host context, which may expose the launcher's profile context.
 * @returns the directory, or undefined outside a profile (memory-only pauses).
 */
function profileDirectory(ctx: Context): string | undefined {
  const read = (ctx as { get?: (name: string) => unknown }).get;
  if (typeof read === "function") {
    const profile = read.call(ctx, "profileContext") as { readonly dir?: unknown } | undefined;
    if (profile !== undefined && typeof profile.dir === "string" && profile.dir !== "")
      return profile.dir;
  }
  const fromEnvironment = process.env.DSH_PROFILE_DIR;
  return fromEnvironment === undefined || fromEnvironment === "" ? undefined : fromEnvironment;
}

/**
 * Read the fired pauses a previous Host left in the profile.
 * @param directory - profile directory, or undefined when persistence is off.
 * @param logger - Host logger for an unreadable or malformed ledger.
 * @returns one entry per Session whose pause fired, keyed by Session id.
 */
function readLedger(
  directory: string | undefined,
  logger: LedgerLogger,
): Map<SessionId, LedgerEntry> {
  const ledger = new Map<SessionId, LedgerEntry>();
  if (directory === undefined) return ledger;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(directory, LEDGER_FILE), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return ledger;
    const stored = parsed as { version?: unknown; pauses?: unknown };
    if (stored.version !== LEDGER_VERSION) return ledger;
    if (typeof stored.pauses !== "object" || stored.pauses === null) return ledger;
    for (const [id, value] of Object.entries(stored.pauses)) {
      if (typeof value !== "object" || value === null) continue;
      const pausedAt = (value as { pausedAt?: unknown }).pausedAt;
      if (typeof pausedAt !== "string") continue;
      ledger.set(id as SessionId, { pausedAt });
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("session-control: could not read the pause ledger", error);
    }
  }
  return ledger;
}

/**
 * Replace the ledger atomically, so an interrupted write leaves the previous
 * records instead of a truncated file.
 * @param directory - profile directory, or undefined when persistence is off.
 * @param ledger - the complete set of fired pauses to keep.
 * @param logger - Host logger for a write that cannot land.
 */
function writeLedger(
  directory: string | undefined,
  ledger: ReadonlyMap<SessionId, LedgerEntry>,
  logger: LedgerLogger,
): void {
  if (directory === undefined) return;
  const target = join(directory, LEDGER_FILE);
  const body = JSON.stringify(
    {
      version: LEDGER_VERSION,
      pauses: Object.fromEntries([...ledger].map(([id, entry]) => [id, entry])),
    },
    undefined,
    2,
  );
  const staged = `${target}.${String(process.pid)}.tmp`;
  try {
    writeFileSync(staged, `${body}\n`, "utf8");
    renameSync(staged, target);
  } catch (error: unknown) {
    logger.warn("session-control: could not save the pause ledger", error);
  }
}

/**
 * One user-role message this plugin authors. Shape matches the Host message
 * constructors without importing them, so the plugin keeps no package
 * dependency at runtime.
 * @param content - model-facing blocks.
 * @param source - producer source declared by this plugin or the Session controller.
 * @returns an identified user message.
 */
function userMessage(content: readonly ContentBlock[], source: UserMessage["source"]): UserMessage {
  return { id: randomUUID() as MessageId, role: "user", content, source };
}

/** The empty continuation receipt that wakes a stopped run; it adds no instruction. */
function continuationMessage(): UserMessage {
  return userMessage([], { kind: "retry", rpcId: randomUUID() as SessionRequestId });
}

/**
 * One parent-facing notice naming the agents this pause stopped.
 * @param stopped - agents whose runs were stopped.
 * @returns a context-form user message for the parent agent.
 */
function pausedNotice(stopped: readonly Agent[]): UserMessage {
  const ids = stopped.map((agent) => String(agent.id)).join(", ");
  const summary =
    stopped.length === 1 ? "User paused 1 agent" : `User paused ${String(stopped.length)} agents`;
  return userMessage(
    [
      {
        type: "text",
        text: `${summary} before their next model request: ${ids}. They produce no result until the user resumes them; do not wait for them or re-delegate their work.`,
      },
    ],
    { kind: "session-control", form: "notice", summary },
  );
}

/**
 * The live descendants of one Agent, walking the subagent parent links recorded
 * on each Session header.
 * @param agents - every live Agent in this Host process.
 * @param root - delegation root of the walk.
 * @returns descendants in parent-before-child order, excluding the root.
 */
function descendantsOf(agents: readonly Agent[], root: Agent): Agent[] {
  const children = new Map<SessionId, Agent[]>();
  for (const agent of agents) {
    const header = agent.session.header;
    if (header.origin !== "subagent" || header.parentSession === undefined) continue;
    const siblings = children.get(header.parentSession) ?? [];
    siblings.push(agent);
    children.set(header.parentSession, siblings);
  }
  const found: Agent[] = [];
  const seen = new Set<SessionId>([root.id]);
  const queue: SessionId[] = [root.id];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      found.push(child);
      queue.push(child.id);
    }
  }
  return found;
}

/**
 * Register the pause command, the boundary gate that consumes it, and the
 * parent-facing notice.
 * @param ctx - Host context carrying the Agent registry and command registry.
 */
export function apply(ctx: Context): void {
  /** Agent -> the pause it belongs to; members of one pause share the record. */
  const members = new WeakMap<Agent, PauseRecord>();
  /** Fired pauses the Host process does not hold: the ledger a restart reads. */
  const directory = profileDirectory(ctx);
  const ledger = readLedger(directory, ctx.logger);

  /**
   * Keep one fired pause in the profile ledger.
   * @param sessionId - Session whose run the pause stopped.
   */
  function remember(sessionId: SessionId): void {
    ledger.set(sessionId, { pausedAt: new Date().toISOString() });
    writeLedger(directory, ledger, ctx.logger);
  }

  /**
   * Drop one Session from the profile ledger when its pause is spent.
   * @param sessionId - Session to forget.
   */
  function forgetPersisted(sessionId: SessionId): void {
    if (ledger.delete(sessionId)) writeLedger(directory, ledger, ctx.logger);
  }

  /**
   * Release one member from its pause.
   * @param agent - the member to release.
   * @param record - the pause record that agent belongs to.
   */
  function release(agent: Agent, record: PauseRecord): void {
    record.armed.delete(agent);
    record.stopped.delete(agent);
    if (members.get(agent) === record) members.delete(agent);
  }

  /**
   * Forget a pause entirely.
   * @param record - the pause to forget.
   */
  function forget(record: PauseRecord): void {
    for (const agent of [...record.armed, ...record.stopped]) {
      if (members.get(agent) === record) members.delete(agent);
    }
    record.armed.clear();
    record.stopped.clear();
  }

  // A pause record belongs to one stopped run. An armed member that never
  // reached its boundary is spent when its run ends, and any member is spent
  // when its next run starts. A run that starts also spends the persisted pause
  // of its own Session: the user moved on instead of continuing it.
  ctx.on("agent/status", ({ agent, status }) => {
    if (status === "running") forgetPersisted(agent.id);
    const record = members.get(agent);
    if (record === undefined) return;
    if (status === "running" || !record.stopped.has(agent)) release(agent, record);
  });
  // Disposal only drops this Agent's live record: the Session may be reopened
  // later, and its fired pause belongs to the Session, not to one Agent object.
  ctx.on("agent/disposed", ({ agent }) => {
    const record = members.get(agent);
    if (record !== undefined) release(agent, record);
  });

  ctx.on("agent/pre-step", (payload, next): Promise<PreStepDecision> => {
    const record = members.get(payload.agent);
    if (record === undefined || !record.armed.has(payload.agent)) return next();
    record.armed.delete(payload.agent);
    record.stopped.add(payload.agent);
    // The addressed Session is the one a restart can continue; its descendants
    // are reached through it, so only the root id is worth a durable record.
    if (payload.agent === record.root) remember(payload.agent.id);
    // The loop claimed this batch for the step it now stops. Put it back so a
    // pause holds queued input for the next turn rather than discarding it.
    if (payload.messages.length > 0) {
      try {
        payload.agent.inbox.splice("next-step", 0, 0, [...payload.messages]);
      } catch (error: unknown) {
        ctx.logger.warn("session-control: could not return the paused batch to the inbox", error);
      }
    }
    // Cancellation records the user stop the conversation already shows. The
    // rejection is the fallback for a turn that is no longer cancellable:
    // either way no model request leaves.
    payload.agent.cancel({ kind: "user" }, { keepInbox: true });
    return Promise.resolve({ kind: "reject" });
  });

  /**
   * Arm one pause across the addressed Agent and its running descendants.
   * @param agent - the Agent the command addressed.
   * @returns the command outcome.
   */
  function arm(agent: Agent): CommandResult {
    // Arming while idle would stop the next turn's own first step, including a
    // message the user had just sent.
    if (agent.status !== "running") {
      return {
        kind: "error",
        text: "No run is active, so there is no next request to pause before.",
      };
    }
    if (members.has(agent)) return { kind: "success", text: "Pause already armed." };
    const record: PauseRecord = { root: agent, armed: new Set([agent]), stopped: new Set() };
    for (const child of descendantsOf(ctx.agents.list(), agent)) {
      if (child.status === "running") record.armed.add(child);
    }
    for (const member of record.armed) members.set(member, record);
    const header = agent.session.header;
    const parent =
      header.origin === "subagent" && header.parentSession !== undefined
        ? ctx.agents.get(header.parentSession)
        : undefined;
    parent?.inject(pausedNotice([...record.armed]));
    return {
      kind: "success",
      text:
        record.armed.size === 1
          ? "Pause armed: the run stops before its next model request."
          : `Pause armed for ${String(record.armed.size)} running agents: each run stops before its next model request.`,
    };
  }

  /**
   * Continue every run this pause stopped, or disarm it before it fires.
   * @param agent - the Agent the command addressed.
   * @returns the command outcome.
   */
  function resume(agent: Agent): CommandResult {
    const record = members.get(agent);
    if (record === undefined) {
      // The pause outlived the Host process that fired it. The Session's log
      // ends at the stopped turn, so one empty continuation opens its next turn
      // over that history — the same receipt a live resume submits.
      if (!ledger.has(agent.id)) return { kind: "error", text: "Nothing is paused." };
      if (agent.status === "running") {
        forgetPersisted(agent.id);
        return { kind: "error", text: "The paused run already started again." };
      }
      forgetPersisted(agent.id);
      agent.followup(continuationMessage());
      return { kind: "success", text: "Resumed 1 paused run." };
    }
    const stopped = [...record.stopped];
    forgetPersisted(record.root.id);
    forget(record);
    for (const target of stopped) target.followup(continuationMessage());
    return {
      kind: "success",
      text:
        stopped.length === 0
          ? "Pause canceled."
          : `Resumed ${String(stopped.length)} paused ${stopped.length === 1 ? "run" : "runs"}.`,
    };
  }

  ctx.commands.register({
    name: PAUSE_COMMAND,
    description: "Pause the run before its next model request, or continue it",
    recordInput: false,
    handler: (invocation): CommandResult => {
      const argument = invocation.rawInput.trim().toLowerCase();
      if (
        argument !== "" &&
        argument !== ARGUMENT_OFF &&
        argument !== ARGUMENT_RESUME &&
        argument !== ARGUMENT_STATUS
      ) {
        return {
          kind: "error",
          text: `Usage: /${PAUSE_COMMAND} [${ARGUMENT_OFF}|${ARGUMENT_RESUME}|${ARGUMENT_STATUS}]`,
        };
      }
      if (argument === ARGUMENT_STATUS) {
        // A run that ended on its own never consumed the armed pause, so this
        // answers which of the two happened; a client mirror cannot tell. A
        // pause whose Host process is gone is answered from the ledger.
        const record = members.get(invocation.agent);
        return (record?.stopped.size ?? 0) > 0 || ledger.has(invocation.agent.id)
          ? { kind: "success", text: "Paused." }
          : { kind: "error", text: "Nothing is paused." };
      }
      if (argument === ARGUMENT_OFF) {
        const record = members.get(invocation.agent);
        if (record !== undefined) {
          forgetPersisted(record.root.id);
          forget(record);
        } else {
          forgetPersisted(invocation.agent.id);
        }
        return { kind: "success", text: "Pause canceled." };
      }
      if (argument === ARGUMENT_RESUME) return resume(invocation.agent);
      return arm(invocation.agent);
    },
  });
}
