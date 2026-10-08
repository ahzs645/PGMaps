import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scratch = await mkdtemp(path.join(tmpdir(), 'geo-toolkit-packed-'))
const consumer = path.join(scratch, 'consumer')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(args, cwd, capture = false, env = process.env) {
  const result = spawnSync(npm, args, { cwd, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', env })
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr ?? '')
    throw new Error(`npm ${args.join(' ')} failed (${result.status ?? 'launch failure'})`)
  }
  return result.stdout
}

try {
  // Build first with toolkit:build. Packing must not depend on app aliases or data.
  const packed = JSON.parse(
    run(
      ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch],
      path.join(root, 'packages/geo-toolkit'),
      true,
    ),
  )[0]
  if (packed.files.some(({ path: file }) => /(?:^|\/)src\/|\.test\.|test-results/.test(file)))
    throw new Error('Packed artifact contains source/tests instead of compiled exports.')
  const pure = path.join(scratch, 'pure')
  // A distinct dependency tree verifies the pure APIs without rendering peers.
  await mkdir(pure, { recursive: true })
  await writeFile(
    path.join(pure, 'package.json'),
    JSON.stringify({
      name: 'toolkit-pure-consumer',
      private: true,
      type: 'module',
      dependencies: { '@pgmaps/geo-toolkit': `file:${path.join(scratch, packed.filename)}` },
    }),
  )
  run(
    ['install', '--ignore-scripts', '--omit=peer', ...(process.argv.includes('--offline') ? ['--offline'] : [])],
    pure,
  )
  const pureSmoke = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await Promise.all(['calculations','index-lab','scales','grids','visualizations','projects'].map(name => import('@pgmaps/geo-toolkit/' + name))); console.log('Pure toolkit imports passed with rendering peers omitted.')",
    ],
    { cwd: pure, stdio: 'inherit' },
  )
  if (pureSmoke.status !== 0) throw new Error('Packed toolkit requires rendering peers for pure entry points.')
  await cp(path.join(root, 'examples/toolkit-consumer'), consumer, {
    recursive: true,
    filter: (file) => !/(?:^|\/)(?:node_modules|dist|test-results|playwright-report)(?:\/|$)/.test(file),
  })
  const manifestPath = path.join(consumer, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.dependencies['@pgmaps/geo-toolkit'] = `file:${path.join(scratch, packed.filename)}`
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  run(['install', '--ignore-scripts', ...(process.argv.includes('--offline') ? ['--offline'] : [])], consumer)
  // These supported entry points must load in Node without initializing a
  // browser, React UI, MapLibre or deck.gl. Optional rendering stays separate.
  const smoke = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await Promise.all(['calculations','index-lab','scales','grids','visualizations','projects'].map(name => import('@pgmaps/geo-toolkit/' + name))); console.log('Pure toolkit entry points imported successfully.')",
    ],
    { cwd: consumer, stdio: 'inherit' },
  )
  if (smoke.status !== 0) throw new Error('Packed pure entry-point imports failed.')
  run(['run', 'build'], consumer)
  if (process.argv.includes('--browser')) {
    // A fresh consumer can resolve a newer Playwright than the host lockfile.
    // Install its matching browser unless the host supplied an executable.
    if (!process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH)
      run(['exec', 'playwright', 'install', 'chromium'], consumer, false, {
        ...process.env,
        PLAYWRIGHT_SKIP_BROWSER_GC: '1',
      })
    run(['run', 'test:browser'], consumer)
  }
  process.stdout.write('Packed toolkit consumer passed outside the PG Maps repository.\n')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
