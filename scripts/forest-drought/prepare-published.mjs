#!/usr/bin/env node
/**
 * Verify or restore the exact published forDRAT snapshot.
 *
 * node scripts/forest-drought/prepare-published.mjs --check
 * node scripts/forest-drought/prepare-published.mjs --from /path/to/forDrat.csv
 * node scripts/forest-drought/prepare-published.mjs --download
 *
 * This never follows upstream master or recomputes model outputs. Updating the
 * pin is an explicit review of the source contract, manifest and browser tests.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const directory = new URL('../../public/data/forest-drought/', import.meta.url)
const destination = new URL('fordrat.csv', directory)
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'))
const commit = 'ac51aafe7b66d039c990964a9acd809a2ea73848'
const expectedSha256 = 'abdb1a26645d6d24e6d45380f55aa555a5f69ffdad79c5f7fb47627003f0d2df'
const expectedBlob = '29fcf5e9207802e3516b809418bbbe73ab96ff12'
const expectedLicenseSha256 = '2e1faa05bb91574fa388220185f57b3607701714053971f704a3b32bceb9851b'
const sourceUrl = `https://raw.githubusercontent.com/bcgov/forDRAT/${commit}/data/forDrat.csv`
const args = process.argv.slice(2)
let bytes
let restore = false

if (args.length === 0 || (args.length === 1 && args[0] === '--check')) {
  bytes = await readFile(destination)
} else if (args.length === 2 && args[0] === '--from') {
  bytes = await readFile(args[1])
  restore = true
} else if (args.length === 1 && args[0] === '--download') {
  const response = await fetch(sourceUrl)
  if (!response.ok) throw new Error(`Pinned forDRAT download failed: HTTP ${response.status}`)
  bytes = Buffer.from(await response.arrayBuffer())
  restore = true
} else {
  throw new Error('Use --check, --from /path/to/forDrat.csv, or --download.')
}

function requireEqual(actual, expected, name) {
  if (actual !== expected) throw new Error(`${name} mismatch: received ${actual}; expected ${expected}.`)
}

const sha256 = createHash('sha256').update(bytes).digest('hex')
const gitBlobSha = createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
requireEqual(sha256, expectedSha256, 'CSV SHA-256')
requireEqual(gitBlobSha, expectedBlob, 'Upstream Git blob SHA')
requireEqual(bytes.byteLength, 338744, 'CSV byte length')
requireEqual(manifest.source.commit, commit, 'Manifest source commit')
requireEqual(manifest.source.url, sourceUrl, 'Manifest source URL')
requireEqual(manifest.source.sha256, sha256, 'Manifest SHA-256')
requireEqual(manifest.source.gitBlobSha, gitBlobSha, 'Manifest Git blob SHA')
requireEqual(manifest.source.bytes, bytes.byteLength, 'Manifest byte length')

const lines = bytes.toString('utf8').trimEnd().split('\n')
requireEqual(lines[0], manifest.snapshot.columns.join(','), 'CSV header')
const rows = lines.slice(1).map((line) => line.split(','))
requireEqual(rows.length, manifest.snapshot.rowCount, 'Manifest row count')
requireEqual(new Set(rows.map((row) => row[0])).size, manifest.snapshot.bgcCount, 'Manifest BGC count')
requireEqual(new Set(rows.map((row) => `${row[0]}|${row[1]}|${row[3]}`)).size, rows.length, 'Unique combinations')
requireEqual(
  rows.length,
  manifest.snapshot.bgcCount * manifest.periods.length * manifest.soilMoistureRegimes.length,
  'Complete grid size',
)
for (const { id } of manifest.periods) requireEqual(rows.filter((row) => row[1] === id).length, 1020, `Period ${id}`)

const license = await readFile(new URL('LICENSE-fordrat.md', directory))
requireEqual(createHash('sha256').update(license).digest('hex'), expectedLicenseSha256, 'Upstream licence SHA-256')
if (restore) await writeFile(destination, bytes)

console.log(
  JSON.stringify(
    {
      status: restore ? 'restored-and-verified' : 'verified',
      path: fileURLToPath(destination),
      commit,
      sha256,
      gitBlobSha,
      bytes: bytes.byteLength,
      rows: rows.length,
      bgcUnits: manifest.snapshot.bgcCount,
      periods: manifest.periods.map(({ id }) => id),
    },
    null,
    2,
  ),
)
