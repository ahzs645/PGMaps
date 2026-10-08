import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'
import path from 'node:path'
import postcss from 'postcss'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(path.join(tmpdir(), 'geo-toolkit-build-'))
const destination = path.join(root, 'dist')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? 'launch failure'})`)
}

async function copyAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name)
    if (entry.isDirectory()) await copyAssets(source)
    else if (!entry.name.includes('.test.') && /\.(css|svg|png|woff2?|mjs|d\.mts|d\.ts)$/.test(entry.name)) {
      const target = path.join(output, path.relative(path.join(root, 'src'), source))
      await mkdir(path.dirname(target), { recursive: true })
      await cp(source, target)
    }
  }
}
async function files(directory, prefix = '') {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory()) result.push(...(await files(path.join(directory, entry.name), relative)))
    else result.push(relative)
  }
  return result
}
try {
  // Compile completely before touching the live exports. Failed watch builds
  // retain the last working package instead of breaking the running consumer.
  run('tsc', ['-p', 'tsconfig.json', '--noEmitOnError', '--outDir', output])
  await copyAssets(path.join(root, 'src'))
  run('tailwindcss', [
    '-c',
    'tailwind.config.js',
    '-i',
    'src/styles.css',
    '-o',
    path.join(output, 'styles.css'),
    '--minify',
  ])
  // Within @scope, a bare ancestor selector cannot match the scope root.
  // Preserve isolation while making Tailwind's important prefix explicit.
  const stylesheet = path.join(output, 'styles.css')
  const css = postcss.parse(await readFile(stylesheet, 'utf8'))
  css.walkRules((rule) => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name === 'scope') {
        rule.selector = rule.selector.replace(/(^|,\s*)\.geo-toolkit\s+/g, '$1:scope ')
        break
      }
    }
  })
  await writeFile(stylesheet, css.toString())
  await mkdir(destination, { recursive: true })
  const current = await files(destination)
  const next = new Set(await files(output))
  for (const file of next) {
    const target = path.join(destination, file)
    const content = await readFile(path.join(output, file))
    let previous
    try {
      previous = await readFile(target)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (previous?.equals(content)) continue
    await mkdir(path.dirname(target), { recursive: true })
    // Preserve existing file inodes so dev-server watchers invalidate cached
    // modules/styles. Only changed files trigger HMR after a successful build.
    await writeFile(target, content)
  }
  for (const obsolete of current.filter((file) => !next.has(file))) await rm(path.join(destination, obsolete))
} finally {
  await rm(output, { recursive: true, force: true })
}
