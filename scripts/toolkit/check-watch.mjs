import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { clearTimeout, setTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scratch = await mkdtemp(path.join(tmpdir(), 'geo-toolkit-watch-'))
let child
let server
let output = ''
let waiter
let offset = 0
function expect(message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${message}\n${output.slice(-4000)}`)), 45000)
    waiter = () => {
      const index = output.indexOf(message, offset)
      if (index < 0) return
      offset = index + message.length
      clearTimeout(timer)
      waiter = null
      resolve()
    }
    waiter()
  })
}
async function readyAfter(content) {
  const ready = expect('Toolkit ready; watching source.')
  await writeFile(path.join(scratch, 'src/watch-probe.ts'), content)
  await ready
}
async function servedContains(url, text) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.ok && (await response.text()).includes(text)) return
    } catch {
      /* Dev server is starting or invalidating its module cache. */
    }
    await delay(100)
  }
  throw new Error(`Live dev server did not serve updated ${text}.`)
}
try {
  await cp(path.join(root, 'packages/geo-toolkit'), scratch, {
    recursive: true,
    filter: (file) => !/(?:^|[/\\])(?:dist|node_modules)(?:[/\\]|$)/.test(file),
  })
  await symlink(path.join(root, 'node_modules'), path.join(scratch, 'node_modules'), 'dir')
  await writeFile(path.join(scratch, 'vite.config.mjs'), "export default { build: { outDir: 'consumer-build' } }\n")
  child = spawn(process.execPath, ['scripts/watch.mjs'], {
    cwd: scratch,
    env: { ...process.env, PATH: path.join(root, 'node_modules/.bin') + path.delimiter + process.env.PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const collect = (data) => {
    output += data
    waiter?.()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  await expect('Toolkit ready; watching source.')
  await readyAfter('export const probe: number = 1\n')
  server = spawn(
    process.execPath,
    [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '43175', '--strictPort'],
    { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  server.stdout.on('data', collect)
  server.stderr.on('data', collect)
  await servedContains('http://127.0.0.1:43175/dist/watch-probe.js', 'probe = 1')
  await servedContains('http://127.0.0.1:43175/dist/styles.css', 'geo-toolkit')
  const compiled = path.join(scratch, 'dist/watch-probe.js')
  const previous = await readFile(compiled, 'utf8')
  const failed = expect('Build failed; watching for a correction.')
  await writeFile(path.join(scratch, 'src/watch-probe.ts'), "export const probe: number = 'invalid'\n")
  await failed
  if ((await readFile(compiled, 'utf8')) !== previous)
    throw new Error('Failed rebuild changed the last working output.')
  await readyAfter('export const probe: number = 2\n')
  if (!(await readFile(compiled, 'utf8')).includes('probe = 2')) throw new Error('Corrected source was not rebuilt.')
  await servedContains('http://127.0.0.1:43175/dist/watch-probe.js', 'probe = 2')
  const stylesReady = expect('Toolkit ready; watching source.')
  const sourceStyles = path.join(scratch, 'src/styles.css')
  await writeFile(sourceStyles, (await readFile(sourceStyles, 'utf8')) + '\n.watch-css-probe { color: #010203; }\n')
  await stylesReady
  await servedContains('http://127.0.0.1:43175/dist/styles.css', 'watch-css-probe')
  const ready = expect('Toolkit ready; watching source.')
  await rm(path.join(scratch, 'src/watch-probe.ts'))
  await ready
  try {
    await readFile(compiled)
    throw new Error('Deleted source retained an obsolete compiled export.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  process.stdout.write(
    'Toolkit watch passed: live modules/CSS refresh, errors retain working exports, corrections recover, deleted outputs are removed.\n',
  )
} finally {
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once('exit', resolve))
    server.kill('SIGTERM')
    await stopped
  }
  if (child && child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    await stopped
  }
  await rm(scratch, { recursive: true, force: true })
}
