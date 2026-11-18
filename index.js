/**
 * Safe pause for a running Session and the subagents it owns.
 *
 * Arming a pause marks the addressed Agent and every live descendant that is
 * currently running. Each member finishes the step in flight — the streaming
 * response and its whole tool batch — and its own mark is consumed at its next
 * `agent/pre-step` boundary, the last point before its next model request would
 * be issued. That turn is then cancelled with `keepInbox`, so it closes as the
 * recorded user stop the transcript already reports (`已停止` / stopped) instead
 * of a silent `completed` turn, and the input that boundary had already claimed
 * goes back to the inbox rather than being discarded. Ancestors are never armed:
 * a pause moves down the delegation tree, never up it.
 *
 * Resuming submits one continuation message per stopped Agent that wakes its
 * loop over the same history, so each continues from exactly where it stopped:
 * the completed tool results are already in its log.
 *
 * When the paused Agent is itself a subagent, its live parent receives a runtime
 * context notice naming the paused agents and their descendants. The notice is
 * queued, not waking the parent, so the parent learns at its next step why those
 * results will not arrive before the user resumes them.
 *
 * The composer control reaches this plugin through the user-facing `pause`
 * command, because a command is the client-callable Host entry point a bundle can
 * add without a generated Remote contribution.
 *
 * @module @dynastxu/dsh-session-control
 */

import { randomUUID } from 'node:crypto'

export const name = 'session-control'

export const inject = ['agents', 'commands']

/** Command name the composer control invokes. */
export const PAUSE_COMMAND = 'pause'

/** Argument that cancels an armed pause. */
const ARGUMENT_OFF = 'off'

/** Argument that resumes a pause that already stopped its runs. */
const ARGUMENT_RESUME = 'resume'

/**
 * One user-role message this plugin authors. Shape matches the Host message
 * constructors without importing them, so the plugin keeps no package dependency.
 * @param content - model-facing blocks.
 * @param source - producer source declared by this plugin.
 * @returns an identified user message.
 */
function userMessage(content, source) {
  return { id: randomUUID(), role: 'user', content, source }
}

/** The empty continuation receipt that wakes a stopped run; it adds no instruction. */
function continuationMessage() {
  return userMessage([], { kind: 'retry', rpcId: randomUUID() })
}

/**
 * One parent-facing notice naming the agents this pause stopped.
 * @param stopped - agents whose runs were stopped.
 * @returns a context-form user message for the parent agent.
 */
function pausedNotice(stopped) {
  const ids = stopped.map(agent => String(agent.id)).join(', ')
  const summary = stopped.length === 1 ? 'User paused 1 agent' : `User paused ${String(stopped.length)} agents`
  return userMessage(
    [{
      type: 'text',
      text: `${summary} before their next model request: ${ids}. They produce no result until the user resumes them; do not wait for them or re-delegate their work.`,
    }],
    { kind: 'session-control', form: 'notice', summary },
  )
}

/**
 * The live descendants of one Agent, walking the subagent parent links recorded
 * on each Session header.
 * @param agents - every live Agent in this Host process.
 * @param root - delegation root of the walk.
 * @returns descendants in parent-before-child order, excluding the root.
 */
function descendantsOf(agents, root) {
  const children = new Map()
  for (const agent of agents) {
    const header = agent.session.header
    if (header.origin !== 'subagent' || header.parentSession === undefined) continue
    const siblings = children.get(header.parentSession) ?? []
    siblings.push(agent)
    children.set(header.parentSession, siblings)
  }
  const found = []
  const seen = new Set([root.id])
  const queue = [root.id]
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      found.push(child)
      queue.push(child.id)
    }
  }
  return found
}

/**
 * Register the pause command, the step gate that consumes it, and the
 * parent-facing notice.
 * @param ctx - Host context carrying the Agent registry and command registry.
 */
export function apply(ctx) {
  /** Agent -> the pause it belongs to; members of one pause share the record. */
  const members = new WeakMap()

  /**
   * @param agent - the member to release.
   * @param record - the pause record that agent belongs to.
   */
  function release(agent, record) {
    record.armed.delete(agent)
    record.stopped.delete(agent)
    if (members.get(agent) === record) members.delete(agent)
  }

  /**
   * @param record - the pause to forget entirely.
   */
  function forget(record) {
    for (const agent of [...record.armed, ...record.stopped]) {
      if (members.get(agent) === record) members.delete(agent)
    }
    record.armed.clear()
    record.stopped.clear()
  }

  // A pause record belongs to one stopped run. An armed member that never
  // reached its boundary is spent when its run ends, and any member is spent
  // when its next run starts — resuming clears its own members before waking.
  ctx.on('agent/status', ({ agent, status }) => {
    const record = members.get(agent)
    if (record === undefined) return
    if (status === 'running' || !record.stopped.has(agent)) release(agent, record)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    const record = members.get(agent)
    if (record !== undefined) release(agent, record)
  })

  ctx.on('agent/pre-step', (payload, next) => {
    const record = members.get(payload.agent)
    if (record === undefined || !record.armed.has(payload.agent)) return next()
    record.armed.delete(payload.agent)
    record.stopped.add(payload.agent)
    // The loop claimed this batch for the step it now stops. Put it back so a
    // pause holds queued input for the next turn rather than discarding it.
    if (payload.messages.length > 0) {
      try {
        payload.agent.inbox.splice('next-step', 0, 0, [...payload.messages])
      } catch (error) {
        ctx.logger.warn('session-control: could not return the paused batch to the inbox', error)
      }
    }
    // Cancellation records the user stop the conversation already shows. The
    // rejection is the fallback for a turn that is no longer cancellable:
    // either way no model request leaves.
    payload.agent.cancel({ kind: 'user' }, { keepInbox: true })
    return Promise.resolve({ kind: 'reject' })
  })

  /** Arm one pause across the addressed Agent and its running descendants. */
  function arm(agent) {
    // Arming while idle would stop the next turn's own first step, including a
    // message the user had just sent.
    if (agent.status !== 'running') {
      return { kind: 'error', text: 'No run is active, so there is no next request to pause before.' }
    }
    if (members.has(agent)) {
      return { kind: 'success', text: 'Pause already armed.' }
    }
    const record = { armed: new Set([agent]), stopped: new Set() }
    for (const child of descendantsOf(ctx.agents.list(), agent)) {
      if (child.status !== 'running') continue
      record.armed.add(child)
    }
    for (const member of record.armed) members.set(member, record)
    const header = agent.session.header
    const parent = header.origin === 'subagent' && header.parentSession !== undefined
      ? ctx.agents.get(header.parentSession)
      : undefined
    if (parent !== undefined) parent.inject(pausedNotice([...record.armed]))
    const count = record.armed.size
    return {
      kind: 'success',
      text: count === 1
        ? 'Pause armed: the run stops before its next model request.'
        : `Pause armed for ${String(count)} running agents: each run stops before its next model request.`,
    }
  }

  /** Continue every run this pause stopped, or disarm it before it fires. */
  function resume(agent) {
    const record = members.get(agent)
    if (record === undefined) return { kind: 'error', text: 'Nothing is paused.' }
    const stopped = [...record.stopped]
    forget(record)
    for (const target of stopped) target.followup(continuationMessage())
    return {
      kind: 'success',
      text: stopped.length === 0 ? 'Pause canceled.' : `Resumed ${String(stopped.length)} paused ${stopped.length === 1 ? 'run' : 'runs'}.`,
    }
  }

  ctx.commands.register({
    name: PAUSE_COMMAND,
    description: 'Pause the run before its next model request, or continue it',
    recordInput: false,
    handler: (invocation) => {
      const argument = invocation.rawInput.trim().toLowerCase()
      if (argument !== '' && argument !== ARGUMENT_OFF && argument !== ARGUMENT_RESUME) {
        return { kind: 'error', text: `Usage: /${PAUSE_COMMAND} [${ARGUMENT_OFF}|${ARGUMENT_RESUME}]` }
      }
      if (argument === ARGUMENT_OFF) {
        const record = members.get(invocation.agent)
        if (record !== undefined) forget(record)
        return { kind: 'success', text: 'Pause canceled.' }
      }
      if (argument === ARGUMENT_RESUME) return resume(invocation.agent)
      return arm(invocation.agent)
    },
  })
}
