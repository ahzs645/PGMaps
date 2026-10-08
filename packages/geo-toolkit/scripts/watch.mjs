import { watch } from 'node:fs'
import { spawn } from 'node:child_process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const root = fileURLToPath(new URL('..', import.meta.url))
let active = null
let pending = false
let timer
let closing = false

function build() {
  if (closing) return
  if (active) {
    pending = true
    return
  }
  pending = false
  process.stdout.write('Building toolkit…\n')
  active = spawn(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' })
  active.on('error', (error) => process.stderr.write(`${error.message}\n`))
  active.on('close', (code) => {
    active = null
    process.stdout.write(
      code === 0 ? 'Toolkit ready; watching source.\n' : 'Build failed; watching for a correction.\n',
    )
    if (pending) build()
  })
}
function changed(_event, name) {
  if (name && /(?:^|[/\\])(?:node_modules|dist|\.git)(?:[/\\]|$)|\.test\./.test(name)) return
  clearTimeout(timer)
  timer = setTimeout(build, 180)
}
const watchers = [
  watch(new URL('../src', import.meta.url), { recursive: true }, changed),
  watch(root, (_event, name) => {
    if (['tailwind.config.js', 'tsconfig.json', 'package.json'].includes(name)) changed()
  }),
]
function close() {
  closing = true
  clearTimeout(timer)
  watchers.forEach((watcher) => watcher.close())
  active?.kill('SIGTERM')
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
build()
