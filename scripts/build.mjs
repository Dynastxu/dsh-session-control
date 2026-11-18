/**
 * Build the plugin's two artifacts:
 *
 * - `dist/index.js` — the Host half, plain ESM compiled by tsc.
 * - `dist/client.js` — the browser half: tsc emits one CommonJS file (the
 *   client half is deliberately a single module), and this script wraps it in
 *   the `window.__ModuleLoader__.load({ id, factory })` form the Web shell
 *   materializes, with the platform modules answered by the loader's `require`.
 *
 * @module @dynastxu/dsh-session-control/build
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const lib = join(root, 'lib')
const tmp = join(root, 'build-tmp')

if (!existsSync(tsc)) {
  console.error('build: TypeScript is not installed; run pnpm install first')
  process.exit(1)
}

/**
 * @param {readonly string[]} args - tsc arguments.
 */
function compile(args) {
  execFileSync(process.execPath, [tsc, ...args], { cwd: root, stdio: 'inherit' })
}

rmSync(lib, { recursive: true, force: true })
rmSync(tmp, { recursive: true, force: true })

compile(['-p', 'tsconfig.host.json'])
compile(['-p', 'tsconfig.client.json'])

const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const body = readFileSync(join(tmp, 'client.js'), 'utf8')
const wrapped = `/* Generated from src/client.tsx by scripts/build.mjs — do not edit. */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(name)},
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
${body}
    return module.exports
  },
})
`
writeFileSync(join(lib, 'client.js'), wrapped)
rmSync(tmp, { recursive: true, force: true })
console.log('build: lib/index.js, lib/client.js')
