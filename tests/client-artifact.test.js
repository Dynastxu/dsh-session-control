/**
 * Artifact smoke test: the built browser half must execute inside the shell's
 * module-loader contract and expose the plugin object the client Loader expects.
 * The platform modules are stubbed; component rendering is not exercised here.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Minimal stand-ins for the platform modules the artifact requires. */
const platform = {
  react: {
    createElement: () => null,
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useRef: value => ({ current: value }),
    useEffect: () => {},
    useMemo: factory => factory(),
  },
  'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: Symbol('fragment') },
  '@deepseek-ai/dsh-client-ui-primitives': new Proxy(
    {},
    {
      get: () =>
        function Primitive() {
          return null
        },
    },
  ),
}

/**
 * Evaluate the artifact with the loader global installed.
 * @returns the registrations the artifact published.
 */
function load() {
  const registrations = []
  const previous = globalThis.window
  globalThis.window = { __ModuleLoader__: { load: registration => registrations.push(registration) } }
  try {
    new Function(source)()
  } finally {
    globalThis.window = previous
  }
  return registrations
}

test('the artifact registers one module under the package id', () => {
  const registrations = load()
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, '@dynastxu/dsh-session-control')
  assert.equal(typeof registrations[0].factory, 'function')
})

test('the factory exposes the plugin object and requires only platform modules', () => {
  const [registration] = load()
  const required = []
  const plugin = registration.factory(specifier => {
    required.push(specifier)
    const module = platform[specifier]
    if (module === undefined) throw new Error(`unexpected platform module: ${specifier}`)
    return module
  })
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual([...plugin.inject].sort(), ['locale', 'remote', 'remote.commands', 'slots'])
  assert.deepEqual([...required].sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react', 'react/jsx-runtime'])
})
