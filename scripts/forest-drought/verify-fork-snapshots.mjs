import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const lock = JSON.parse(readFileSync(new URL('./forks.lock.json', import.meta.url), 'utf8'))
assert.equal(lock.schema, 'pgmaps-forest-drought-forks-v1')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const paths = new Set()
for (const file of lock.files) {
  assert(!paths.has(file.local), `Duplicate locked file: ${file.local}`)
  paths.add(file.local)
  assert(/^[a-f0-9]{40}$/.test(file.commit), 'Fork references must be immutable commits')
  assert(!file.local.split('/').includes('..'), 'Local snapshot path must stay in the repository')
  const bytes = readFileSync(resolve(root, file.local))
  assert.equal(bytes.length, file.bytes, `Size changed: ${file.local}`)
  assert.equal(hash(bytes), file.sha256, `Snapshot drift: ${file.local}; update the fork and lock together`)
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  assert.equal(blob, file.gitBlobSha, `Git blob changed: ${file.local}`)
  if (process.argv.includes('--remote')) {
    const url = `https://raw.githubusercontent.com/${file.repository}/${file.commit}/${file.source.split('/').map(encodeURIComponent).join('/')}`
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    assert(response.ok, `Could not read pinned fork file: ${url} (${response.status})`)
    assert.equal(hash(new Uint8Array(await response.arrayBuffer())), file.sha256, `Fork/local mismatch: ${file.local}`)
  }
}
for (const filename of readdirSync(resolve(root, 'src/features/forest-drought/model'))) {
  if (filename.endsWith('.ts') && !filename.endsWith('.test.ts')) {
    assert(paths.has(`src/features/forest-drought/model/${filename}`), `Untracked model source: ${filename}`)
  }
}
console.log(`Verified ${lock.files.length} source snapshots pinned to the two browser forks${process.argv.includes('--remote') ? ' including remote bytes' : ''}.`)
