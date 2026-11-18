/**
 * Host-half behavior: the command's admission rules, the delegation-tree gate
 * that turns an armed pause into stopped runs, the parent notice, and the
 * continuation that resumes every stopped run.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, PAUSE_COMMAND } from '../index.js'

/** One live Agent stub recording everything the plugin does to it. */
function createAgent(id, { status = 'running', parent, origin } = {}) {
  const received = { splices: [], cancellations: [], followups: [], injections: [] }
  const header = {
    id,
    isSeeded: false,
    createdAt: 1,
    ...origin === undefined ? {} : { origin },
    ...parent === undefined ? {} : { parentSession: parent },
  }
  return {
    received,
    agent: {
      id,
      status,
      session: { header },
      inbox: { splice: (...args) => { received.splices.push(args); return [] } },
      cancel: (cause, options) => { received.cancellations.push([cause, options]) },
      followup: (message) => { received.followups.push(message) },
      inject: (message) => { received.injections.push(message) },
    },
  }
}

/** A Cordis-shaped Host context over a fixed population of live agents. */
function createHost(agents = []) {
  const listeners = new Map()
  const commands = new Map()
  const warnings = []
  const host = {
    warnings,
    command: () => commands.get(PAUSE_COMMAND),
    // The group above stays reachable so a case can add an agent after boot.
    agents,
    fire: (event, payload, next) => listeners.get(event)(payload, next),
    invoke: (agent, rawInput = '') => commands.get(PAUSE_COMMAND).handler({
      commandId: 'cmd-1',
      agent,
      rawInput,
      attachments: [],
      signal: new AbortController().signal,
    }),
  }
  apply({
    on: (event, listener) => {
      listeners.set(event, listener)
      return () => { listeners.delete(event) }
    },
    commands: {
      register: (definition) => {
        commands.set(definition.name, definition)
        return () => { commands.delete(definition.name) }
      },
    },
    agents: {
      list: () => host.agents,
      get: id => host.agents.find(agent => agent.id === id),
    },
    logger: { warn: (...args) => { warnings.push(args) } },
  })
  return host
}

/** Delegation tree: root keeps two running children, one idle child, one grandchild. */
function createTree() {
  const root = createAgent('root')
  const first = createAgent('child-1', { parent: 'root', origin: 'subagent' })
  const second = createAgent('child-2', { parent: 'root', origin: 'subagent' })
  const parked = createAgent('child-3', { parent: 'root', origin: 'subagent', status: 'idle' })
  const grandchild = createAgent('grandchild', { parent: 'child-1', origin: 'subagent' })
  return { root, first, second, parked, grandchild, all: [root, first, second, parked, grandchild] }
}

const enter = () => Promise.resolve({ kind: 'enter', messages: [] })

/** Take one armed member to its own boundary. */
async function stopAtBoundary(host, agent, messages = []) {
  return await host.fire('agent/pre-step', { agent, messages, turn: 1, step: 2 }, () => {
    throw new Error('a paused boundary must not delegate')
  })
}

test('the command registers the pause name without recording arguments', () => {
  const host = createHost()
  const command = host.command()
  assert.equal(command.name, PAUSE_COMMAND)
  assert.equal(command.recordInput, false)
  assert.equal(command.description, 'Pause the run before its next model request, or continue it')
})

test('arming covers the running descendants and leaves idle ones alone', () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  const result = host.invoke(tree.root.agent)
  assert.equal(result.kind, 'success')
  assert.match(result.text, /4 running agents/u)
  assert.equal(tree.parked.received.cancellations.length, 0)
})

test('every armed member stops at its own boundary and keeps its batch', async () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  host.invoke(tree.root.agent)
  const messages = [{ id: 'steering-1' }]
  assert.deepEqual(await stopAtBoundary(host, tree.grandchild.agent, messages), { kind: 'reject' })
  assert.deepEqual(tree.grandchild.received.splices, [['next-step', 0, 0, messages]])
  assert.deepEqual(tree.grandchild.received.cancellations, [[{ kind: 'user' }, { keepInbox: true }]])
  // The root has not reached its boundary yet.
  assert.deepEqual(tree.root.received.cancellations, [])
})

test('an ancestor of the paused agent is never armed', async () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  host.invoke(tree.first.agent)
  assert.deepEqual(await stopAtBoundary(host, tree.grandchild.agent), { kind: 'reject' })
  assert.deepEqual(await host.fire('agent/pre-step', { agent: tree.root.agent, messages: [], turn: 2, step: 1 }, enter), {
    kind: 'enter', messages: [],
  })
  assert.deepEqual(await host.fire('agent/pre-step', { agent: tree.second.agent, messages: [], turn: 1, step: 1 }, enter), {
    kind: 'enter', messages: [],
  })
})

test('an unarmed member always delegates and is never cancelled', async () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  assert.deepEqual(await host.fire('agent/pre-step', { agent: tree.root.agent, messages: [], turn: 1, step: 1 }, enter), {
    kind: 'enter', messages: [],
  })
  assert.deepEqual(tree.root.received.cancellations, [])
})

test('pausing a subagent notifies its live parent without waking it', () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  host.invoke(tree.first.agent)
  assert.equal(tree.root.received.injections.length, 1)
  const notice = tree.root.received.injections[0]
  assert.deepEqual(notice.source, { kind: 'session-control', form: 'notice', summary: 'User paused 2 agents' })
  assert.match(notice.content[0].text, /child-1/u)
  assert.match(notice.content[0].text, /grandchild/u)
})

test('pausing a top-level session notifies no parent', () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  host.invoke(tree.root.agent)
  for (const item of tree.all) assert.deepEqual(item.received.injections, [])
})

test('resume continues every stopped run with an empty receipt', async () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  host.invoke(tree.root.agent)
  await stopAtBoundary(host, tree.root.agent)
  await stopAtBoundary(host, tree.grandchild.agent)
  const result = host.invoke(tree.root.agent, 'resume')
  assert.equal(result.kind, 'success')
  assert.match(result.text, /2 paused runs/u)
  assert.equal(tree.root.received.followups.length, 1)
  assert.equal(tree.grandchild.received.followups.length, 1)
  assert.deepEqual(tree.root.received.followups[0].content, [])
  assert.equal(tree.root.received.followups[0].source.kind, 'retry')
  // The stopped members that never fired are only disarmed.
  assert.equal(tree.first.received.followups.length, 0)
  assert.deepEqual(await host.fire('agent/pre-step', { agent: tree.first.agent, messages: [], turn: 2, step: 1 }, enter), {
    kind: 'enter', messages: [],
  })
})

test('resume is refused once the pause is spent', async () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  host.invoke(tree.root.agent)
  await stopAtBoundary(host, tree.root.agent)
  assert.equal(host.invoke(tree.root.agent, 'resume').kind, 'success')
  assert.equal(host.invoke(tree.root.agent, 'resume').kind, 'error')
})

test('an armed member that never fired is released when its run ends', async () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  host.invoke(tree.root.agent)
  host.fire('agent/status', { agent: tree.second.agent, status: 'idle' })
  assert.deepEqual(await host.fire('agent/pre-step', { agent: tree.second.agent, messages: [], turn: 2, step: 1 }, enter), {
    kind: 'enter', messages: [],
  })
})

test('a stopped run keeps its record until it is resumed', async () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  host.invoke(tree.root.agent)
  await stopAtBoundary(host, tree.root.agent)
  host.fire('agent/status', { agent: tree.root.agent, status: 'idle' })
  assert.equal(host.invoke(tree.root.agent, 'resume').kind, 'success')
  assert.equal(tree.root.received.followups.length, 1)
})

test('a new run spends the record, so a stale continue cannot fire later', async () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  host.invoke(tree.root.agent)
  await stopAtBoundary(host, tree.root.agent)
  host.fire('agent/status', { agent: tree.root.agent, status: 'idle' })
  // The user sent an ordinary message instead of continuing the pause.
  host.fire('agent/status', { agent: tree.root.agent, status: 'running' })
  assert.equal(host.invoke(tree.root.agent, 'resume').kind, 'error')
  assert.deepEqual(tree.root.received.followups, [])
})

test('disposal releases every record', async () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  host.invoke(tree.root.agent)
  await stopAtBoundary(host, tree.root.agent)
  host.fire('agent/disposed', { agent: tree.root.agent })
  assert.equal(host.invoke(tree.root.agent, 'resume').kind, 'error')
})

test('/pause off disarms the whole pause', async () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  host.invoke(tree.root.agent)
  assert.equal(host.invoke(tree.root.agent, 'off').kind, 'success')
  assert.deepEqual(await host.fire('agent/pre-step', { agent: tree.grandchild.agent, messages: [], turn: 1, step: 2 }, enter), {
    kind: 'enter', messages: [],
  })
  assert.equal(host.invoke(tree.root.agent, 'resume').kind, 'error')
})

test('arming outside a run is refused so the next message is not stopped', () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  const result = host.invoke(tree.parked.agent)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /no next request/u)
})

test('arming twice is idempotent', () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  assert.equal(host.invoke(tree.root.agent).kind, 'success')
  const second = host.invoke(tree.root.agent)
  assert.equal(second.kind, 'success')
  assert.match(second.text, /already armed/u)
})

test('unknown arguments explain the accepted form', () => {
  const tree = createTree()
  const host = createHost(tree.all.map(item => item.agent))
  const result = host.invoke(tree.root.agent, 'later')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /Usage: \/pause \[off\|resume\]/u)
})
