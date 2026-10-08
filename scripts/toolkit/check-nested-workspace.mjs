import { spawn } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const baseUrl = 'http://127.0.0.1:42175'
const server = spawn(
  process.execPath,
  [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '42175', '--strictPort'],
  {
    cwd: path.join(root, 'examples/toolkit-consumer'),
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
let output = ''
server.stdout.on('data', (data) => {
  output += data
})
server.stderr.on('data', (data) => {
  output += data
})
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Nested fixture server failed:\n${output}`)
    try {
      ready = (await fetch(baseUrl, { signal: AbortSignal.timeout(1000) })).ok
    } catch {
      /* Still starting. */
    }
    if (ready) break
    await setTimeout(200)
  }
  if (!ready) throw new Error(`Nested fixture server did not start:\n${output}`)
  const test = spawn(process.execPath, ['packages/geo-toolkit/tests/nested-workspace.browser.mjs'], {
    cwd: root,
    env: { ...process.env, PGMAPS_TOOLKIT_TEST_BASE_URL: baseUrl },
    stdio: 'inherit',
  })
  const code = await new Promise((resolve, reject) => {
    test.on('error', reject)
    test.on('exit', resolve)
  })
  if (code !== 0) throw new Error(`Nested workspace browser test failed (${code})`)
} finally {
  if (server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once('exit', resolve))
    server.kill('SIGTERM')
    await stopped
  }
}
