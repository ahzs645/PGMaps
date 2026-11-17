// Copies the deployed LiDAR analysis products into public/data for local development.
// Only the deploy workflow builds them (deploy.yml, scripts/lidar/run.py), and the folder
// is git-ignored, so a fresh checkout has none and /dev/lidar cannot load.
// Every file is checked against the deployment's own checksums.json before it is kept.
// Usage: npm run lidar:fetch-analysis [-- <deployed site origin>]
import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const TILE = 'bc-093g086'
const origin = (process.argv[2] ?? 'https://pgmaps.ahmadjalil.com').replace(/\/+$/, '')
const remote = `${origin}/data/lidar-analysis/${TILE}/`
const target = path.resolve('public/data/lidar-analysis', TILE)
const staging = `${target}.partial`

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function get(name) {
  const response = await fetch(new URL(name, remote))
  if (!response.ok) throw Error(`${name}: HTTP ${response.status}`)
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('text/html')) throw Error(`${name}: the site answered with a page, not the file`)
  return Buffer.from(await response.arrayBuffer())
}

const checksumBytes = await get('checksums.json')
const checksums = JSON.parse(checksumBytes.toString('utf8'))
const names = Object.keys(checksums)
if (!names.includes('summary.json')) throw Error('checksums.json does not list summary.json')

rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
let total = 0
for (const name of names) {
  if (name.includes('..') || path.isAbsolute(name)) throw Error(`Refusing file name ${name}`)
  const bytes = await get(name)
  const expected = checksums[name]
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256)
    throw Error(`${name}: does not match checksums.json`)
  const file = path.join(staging, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, bytes)
  total += bytes.length
  console.log(`  ${name} (${(bytes.length / 1e6).toFixed(1)} MB)`)
}
writeFileSync(path.join(staging, 'checksums.json'), checksumBytes)
rmSync(target, { recursive: true, force: true })
renameSync(staging, target)
console.log(`Copied ${names.length + 1} files (${(total / 1e6).toFixed(1)} MB) from ${remote} to ${target}`)
