#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import process from 'node:process'
import console from 'node:console'

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const base = process.argv[2] ?? '/forestryCastor/'
assert(base.startsWith('/') && base.endsWith('/'), 'Expected an absolute deployment path ending in /')
const index = await readFile(path.join(directory, 'index.html'), 'utf8')
const manifest = JSON.parse(await readFile(path.join(directory, 'source-manifest.json'), 'utf8'))
assert.equal(manifest.schema, 'pgmaps-castor-standalone-source-v1')
assert.equal(manifest.source.repository, 'https://github.com/ahzs645/PGMaps')
assert.deepEqual((await readdir(path.join(directory, 'data'))).sort(), ['forestry-castor'])
assert.deepEqual((await readdir(path.join(directory, 'data/forestry-castor'))).sort(), [
  'LICENSE',
  'NOTICE',
  'provenance.json',
  'simple_castordb.sqlite',
])
for (const file of manifest.files) {
  const bytes = await readFile(path.join(directory, file.path))
  assert.equal(bytes.byteLength, file.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
}
assert.equal(
  manifest.files.find((file) => file.path.endsWith('.sqlite')).sha256,
  '8d19a48acba51de568d6994b8b41c0d9b6d3533aa6ea8c7a0e3cd95afe23535d',
)
const refs = [...index.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
assert(
  refs.some((ref) => ref.endsWith('.js')),
  'The built application script is missing',
)
for (const ref of refs) {
  assert(ref.startsWith(base), `Unexpected external or wrong-base HTML asset: ${ref}`)
  assert((await stat(path.join(directory, ref.slice(base.length)))).isFile(), `Missing HTML asset: ${ref}`)
}
const assets = await readdir(path.join(directory, 'assets'))
assert(
  assets.some((name) => /^castor\.worker-.*\.js$/.test(name)),
  'Compiled calculation worker is missing',
)
assert(
  assets.some((name) => /^sql-wasm-.*\.wasm$/.test(name)),
  'Self-hosted SQLite Wasm is missing',
)
assert.equal(await readFile(path.join(directory, '404.html'), 'utf8'), index)
await stat(path.join(directory, '.nojekyll'))
console.log(
  `Verified standalone output: ${base}, ${assets.length} compiled assets, original SQLite checksum, worker/Wasm, and four allowlisted data files.`,
)
