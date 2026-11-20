/**
 * Host-half behavior: the command's admission rules, the delegation-tree gate
 * that turns an armed pause into stopped runs, the parent notice, and the
 * continuation that resumes every stopped run.
 */

import { describe, expect, it } from "vitest";

import type { Context } from "@deepseek-ai/cordis";
import { PAUSE_COMMAND, apply } from "../src/index";

/** One message the Host notices; only the fields these cases read are modeled. */
interface NoticeLike {
  readonly content: readonly { readonly text: string }[];
  readonly source: Record<string, unknown>;
}

/** One live Agent stub recording everything the plugin does to it. */
interface AgentStub {
  readonly received: {
    readonly splices: unknown[][];
    readonly cancellations: unknown[][];
    readonly followups: NoticeLike[];
    readonly injections: NoticeLike[];
  };
  readonly agent: {
    readonly id: string;
    readonly status: string;
    readonly session: { readonly header: Record<string, unknown> };
    readonly inbox: { splice(...args: unknown[]): unknown };
    cancel(cause: unknown, options: unknown): void;
    followup(message: NoticeLike): void;
    inject(message: NoticeLike): void;
  };
}

interface AgentOptions {
  readonly status?: string;
  readonly parent?: string;
  readonly origin?: string;
}

/** One live Agent stub recording everything the plugin does to it. */
function createAgent(id: string, options: AgentOptions = {}): AgentStub {
  const received: AgentStub["received"] = {
    splices: [],
    cancellations: [],
    followups: [],
    injections: [],
  };
  const header = {
    id,
    isSeeded: false,
    createdAt: 1,
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.parent === undefined ? {} : { parentSession: options.parent }),
  };
  return {
    received,
    agent: {
      id,
      status: options.status ?? "running",
      session: { header },
      inbox: {
        splice: (...args: unknown[]) => {
          received.splices.push(args);
          return [];
        },
      },
      cancel: (cause: unknown, cancelOptions: unknown) => {
        received.cancellations.push([cause, cancelOptions]);
      },
      followup: (message) => {
        received.followups.push(message);
      },
      inject: (message) => {
        received.injections.push(message);
      },
    },
  };
}

/** The command definition the plugin registered. */
interface CommandStub {
  readonly name: string;
  readonly recordInput: boolean;
  readonly description: string;
  handler(invocation: {
    commandId: string;
    agent: unknown;
    rawInput: string;
    attachments: never[];
    signal: AbortSignal;
  }): { kind: string; text: string };
}

/** A Cordis-shaped Host context over a fixed population of live agents. */
interface HostStub {
  readonly warnings: unknown[][];
  readonly agents: AgentStub["agent"][];
  command(): CommandStub;
  fire(
    event: string,
    payload: unknown,
    next?: () => Promise<unknown>,
  ): Promise<unknown> | undefined;
  invoke(agent: AgentStub["agent"], rawInput?: string): { kind: string; text: string };
}

/** A Cordis-shaped Host context over a fixed population of live agents. */
function createHost(agents: AgentStub["agent"][] = []): HostStub {
  const listeners = new Map<string, (...args: never[]) => unknown>();
  const commands = new Map<string, CommandStub>();
  const warnings: unknown[][] = [];
  const host: HostStub = {
    warnings,
    command: () => commands.get(PAUSE_COMMAND) as CommandStub,
    // The group above stays reachable so a case can add an agent after boot.
    agents,
    fire: (event, payload, next) => {
      const listener = listeners.get(event) as unknown as (
        receivedPayload: unknown,
        receivedNext?: () => Promise<unknown>,
      ) => Promise<unknown>;
      return listener(payload, next);
    },
    invoke: (agent, rawInput = "") =>
      (commands.get(PAUSE_COMMAND) as CommandStub).handler({
        commandId: "cmd-1",
        agent,
        rawInput,
        attachments: [],
        signal: new AbortController().signal,
      }),
  };
  apply({
    on: (event: string, listener: (...args: never[]) => unknown) => {
      listeners.set(event, listener);
      return () => {
        listeners.delete(event);
      };
    },
    commands: {
      register: (definition: CommandStub) => {
        commands.set(definition.name, definition);
        return () => {
          commands.delete(definition.name);
        };
      },
    },
    agents: {
      list: () => host.agents,
      get: (id: string) => host.agents.find((agent) => agent.id === id),
    },
    logger: {
      warn: (...args: unknown[]) => {
        warnings.push(args);
      },
    },
  } as unknown as Context);
  return host;
}

/** Delegation tree: root keeps two running children, one idle child, one grandchild. */
function createTree() {
  const root = createAgent("root");
  const first = createAgent("child-1", { parent: "root", origin: "subagent" });
  const second = createAgent("child-2", { parent: "root", origin: "subagent" });
  const parked = createAgent("child-3", { parent: "root", origin: "subagent", status: "idle" });
  const grandchild = createAgent("grandchild", { parent: "child-1", origin: "subagent" });
  return {
    root,
    first,
    second,
    parked,
    grandchild,
    all: [root, first, second, parked, grandchild],
  };
}

const enter = () => Promise.resolve({ kind: "enter", messages: [] });

/** Take one armed member to its own boundary. */
async function stopAtBoundary(host: HostStub, agent: AgentStub["agent"], messages: unknown[] = []) {
  return await host.fire("agent/pre-step", { agent, messages, turn: 1, step: 2 }, () => {
    throw new Error("a paused boundary must not delegate");
  });
}

describe("host half", () => {
  it("the command registers the pause name without recording arguments", () => {
    const host = createHost();
    const command = host.command();
    expect(command.name).toBe(PAUSE_COMMAND);
    expect(command.recordInput).toBe(false);
    expect(command.description).toBe("Pause the run before its next model request, or continue it");
  });

  it("arming covers the running descendants and leaves idle ones alone", () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    const result = host.invoke(tree.root.agent);
    expect(result.kind).toBe("success");
    expect(result.text).toMatch(/4 running agents/u);
    expect(tree.parked.received.cancellations.length).toBe(0);
  });

  it("every armed member stops at its own boundary and keeps its batch", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.root.agent);
    const messages = [{ id: "steering-1" }];
    expect(await stopAtBoundary(host, tree.grandchild.agent, messages)).toEqual({ kind: "reject" });
    expect(tree.grandchild.received.splices).toEqual([["next-step", 0, 0, messages]]);
    expect(tree.grandchild.received.cancellations).toEqual([
      [{ kind: "user" }, { keepInbox: true }],
    ]);
    // The root has not reached its boundary yet.
    expect(tree.root.received.cancellations).toEqual([]);
  });

  it("an ancestor of the paused agent is never armed", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.first.agent);
    expect(await stopAtBoundary(host, tree.grandchild.agent)).toEqual({ kind: "reject" });
    expect(
      await host.fire(
        "agent/pre-step",
        { agent: tree.root.agent, messages: [], turn: 2, step: 1 },
        enter,
      ),
    ).toEqual({ kind: "enter", messages: [] });
    expect(
      await host.fire(
        "agent/pre-step",
        { agent: tree.second.agent, messages: [], turn: 1, step: 1 },
        enter,
      ),
    ).toEqual({ kind: "enter", messages: [] });
  });

  it("an unarmed member always delegates and is never cancelled", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    expect(
      await host.fire(
        "agent/pre-step",
        { agent: tree.root.agent, messages: [], turn: 1, step: 1 },
        enter,
      ),
    ).toEqual({ kind: "enter", messages: [] });
    expect(tree.root.received.cancellations).toEqual([]);
  });

  it("pausing a subagent notifies its live parent without waking it", () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.first.agent);
    expect(tree.root.received.injections.length).toBe(1);
    const notice = tree.root.received.injections[0] as NoticeLike;
    expect(notice.source).toEqual({
      kind: "session-control",
      form: "notice",
      summary: "User paused 2 agents",
    });
    const [first] = notice.content;
    expect(first?.text).toMatch(/child-1/u);
    expect(first?.text).toMatch(/grandchild/u);
  });

  it("pausing a top-level session notifies no parent", () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.root.agent);
    for (const item of tree.all) expect(item.received.injections).toEqual([]);
  });

  it("resume continues every stopped run with an empty receipt", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.root.agent);
    await stopAtBoundary(host, tree.root.agent);
    await stopAtBoundary(host, tree.grandchild.agent);
    const result = host.invoke(tree.root.agent, "resume");
    expect(result.kind).toBe("success");
    expect(result.text).toMatch(/2 paused runs/u);
    expect(tree.root.received.followups.length).toBe(1);
    expect(tree.grandchild.received.followups.length).toBe(1);
    expect(tree.root.received.followups[0]?.content).toEqual([]);
    expect(tree.root.received.followups[0]?.source.kind).toBe("retry");
    // The stopped members that never fired are only disarmed.
    expect(tree.first.received.followups.length).toBe(0);
    expect(
      await host.fire(
        "agent/pre-step",
        { agent: tree.first.agent, messages: [], turn: 2, step: 1 },
        enter,
      ),
    ).toEqual({ kind: "enter", messages: [] });
  });

  it("resume is refused once the pause is spent", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.root.agent);
    await stopAtBoundary(host, tree.root.agent);
    expect(host.invoke(tree.root.agent, "resume").kind).toBe("success");
    expect(host.invoke(tree.root.agent, "resume").kind).toBe("error");
  });

  it("an armed member that never fired is released when its run ends", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.root.agent);
    host.fire("agent/status", { agent: tree.second.agent, status: "idle" });
    expect(
      await host.fire(
        "agent/pre-step",
        { agent: tree.second.agent, messages: [], turn: 2, step: 1 },
        enter,
      ),
    ).toEqual({ kind: "enter", messages: [] });
  });

  it("a stopped run keeps its record until it is resumed", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.root.agent);
    await stopAtBoundary(host, tree.root.agent);
    host.fire("agent/status", { agent: tree.root.agent, status: "idle" });
    expect(host.invoke(tree.root.agent, "resume").kind).toBe("success");
    expect(tree.root.received.followups.length).toBe(1);
  });

  it("a new run spends the record, so a stale continue cannot fire later", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.root.agent);
    await stopAtBoundary(host, tree.root.agent);
    host.fire("agent/status", { agent: tree.root.agent, status: "idle" });
    // The user sent an ordinary message instead of continuing the pause.
    host.fire("agent/status", { agent: tree.root.agent, status: "running" });
    expect(host.invoke(tree.root.agent, "resume").kind).toBe("error");
    expect(tree.root.received.followups).toEqual([]);
  });

  it("disposal releases every record", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.root.agent);
    await stopAtBoundary(host, tree.root.agent);
    host.fire("agent/disposed", { agent: tree.root.agent });
    expect(host.invoke(tree.root.agent, "resume").kind).toBe("error");
  });

  it("/pause off disarms the whole pause", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.root.agent);
    expect(host.invoke(tree.root.agent, "off").kind).toBe("success");
    expect(
      await host.fire(
        "agent/pre-step",
        { agent: tree.grandchild.agent, messages: [], turn: 1, step: 2 },
        enter,
      ),
    ).toEqual({ kind: "enter", messages: [] });
    expect(host.invoke(tree.root.agent, "resume").kind).toBe("error");
  });

  it("arming outside a run is refused so the next message is not stopped", () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    const result = host.invoke(tree.parked.agent);
    expect(result.kind).toBe("error");
    expect(result.text).toMatch(/no next request/u);
  });

  it("arming twice is idempotent", () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    expect(host.invoke(tree.root.agent).kind).toBe("success");
    const second = host.invoke(tree.root.agent);
    expect(second.kind).toBe("success");
    expect(second.text).toMatch(/already armed/u);
  });

  it("unknown arguments explain the accepted form", () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    const result = host.invoke(tree.root.agent, "later");
    expect(result.kind).toBe("error");
    expect(result.text).toMatch(/Usage: \/pause \[off\|resume\|status\]/u);
  });

  it("/pause status reports a pause that already stopped its run", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.root.agent);
    // Armed but not yet at a boundary: nothing stopped, so nothing to continue.
    expect(host.invoke(tree.root.agent, "status").kind).toBe("error");
    await stopAtBoundary(host, tree.root.agent);
    expect(host.invoke(tree.root.agent, "status").kind).toBe("success");
  });

  it("/pause status reports nothing once the pause is resumed", async () => {
    const tree = createTree();
    const host = createHost(tree.all.map((item) => item.agent));
    host.invoke(tree.root.agent);
    await stopAtBoundary(host, tree.root.agent);
    host.invoke(tree.root.agent, "resume");
    expect(host.invoke(tree.root.agent, "status").kind).toBe("error");
  });
});
