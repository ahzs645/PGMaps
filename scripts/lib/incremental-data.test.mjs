import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beginDataBuild, createIncrementalCopier, mapLimit } from './incremental-data.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pgmaps-incremental-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('copy reuse detects source changes, edited or missing outputs, and exclusions', (t) => {
  const root = fixture(t)
  const source = join(root, 'source'),
    destination = join(root, 'public')
  mkdirSync(source)
  writeFileSync(join(source, 'data.json'), 'first')
  writeFileSync(join(source, 'raw.zip'), 'archive')
  const copy = () => {
    const copier = createIncrementalCopier(root)
    copier.copy(source, destination, (file) => !file.endsWith('.zip'))
    return copier.complete()
  }
  assert.deepEqual(copy(), { copied: 1, skipped: 0 })
  const mtime = statSync(join(destination, 'data.json')).mtimeMs
  assert.deepEqual(copy(), { copied: 0, skipped: 1 })
  assert.equal(statSync(join(destination, 'data.json')).mtimeMs, mtime)
  assert.throws(() => statSync(join(destination, 'raw.zip')), { code: 'ENOENT' })
  writeFileSync(join(source, 'data.json'), 'other')
  assert.deepEqual(copy(), { copied: 1, skipped: 0 })
  assert.equal(readFileSync(join(destination, 'data.json'), 'utf8'), 'other')
  writeFileSync(join(destination, 'data.json'), 'local')
  assert.deepEqual(copy(), { copied: 1, skipped: 0 })
  rmSync(join(destination, 'data.json'))
  assert.deepEqual(copy(), { copied: 1, skipped: 0 })
})

test('build fingerprints detect input edits and nested output loss; failures are not cached', (t) => {
  const root = fixture(t)
  const input = join(root, 'input.json'),
    output = join(root, 'tiles')
  writeFileSync(input, 'first')
  mkdirSync(join(output, '0'), { recursive: true })
  const tile = join(output, '0', '0.png')
  writeFileSync(tile, 'tile')
  const begin = () => beginDataBuild(root, 'test', [input], [output])
  assert.equal(begin().needsBuild, true)
  assert.equal(begin().needsBuild, true)
  begin().complete()
  assert.equal(begin().needsBuild, false)
  writeFileSync(input, 'other')
  assert.equal(begin().needsBuild, true)
  begin().complete()
  rmSync(tile)
  assert.equal(begin().needsBuild, true)
  assert.equal(beginDataBuild(root, 'test', [input], [output], true).needsBuild, true)
})

test('limited parsing preserves result order and caps in-flight work', async () => {
  let active = 0,
    peak = 0
  const result = await mapLimit([3, 2, 1, 0], 2, async (value) => {
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, value))
    active--
    return value * 2
  })
  assert.deepEqual(result, [6, 4, 2, 0])
  assert.equal(peak, 2)
})

test('overlapping mappings only copy the last authoritative source', (t) => {
  const root = fixture(t)
  const old = join(root, 'old'),
    current = join(root, 'current'),
    destination = join(root, 'public')
  mkdirSync(old)
  mkdirSync(current)
  writeFileSync(join(old, 'latest.json'), 'old')
  writeFileSync(join(current, 'latest.json'), 'authoritative')
  const copy = () => {
    const copier = createIncrementalCopier(root)
    copier.copy(old, destination)
    copier.copy(current, destination)
    return copier.complete()
  }
  assert.deepEqual(copy(), { copied: 1, skipped: 0 })
  assert.equal(readFileSync(join(destination, 'latest.json'), 'utf8'), 'authoritative')
  assert.deepEqual(copy(), { copied: 0, skipped: 1 })
})
