// Downloads the optional ALIKED + LightGlue models the own-photo flight matcher can use into the git-ignored
// public/models/photo-match/, checked against the sizes and SHA-256 sums in
// src/pages/dev-forestry/photoMatchModels.json. They come from WebSfM's `models-v1` release; a GitHub release
// sends no CORS headers, so a browser cannot read them there and the site has to serve its own copy.
//
//   npm run photo-match:fetch-models
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'

const root = new URL('../../../', import.meta.url)
const models = JSON.parse(await readFile(new URL('src/pages/dev-forestry/photoMatchModels.json', root), 'utf8'))
const folder = new URL(`public${models.folder}`, root)
await mkdir(folder, { recursive: true })

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
let failed = false
for (const { path, size, sha256: want } of Object.values(models.files)) {
  const target = new URL(path, folder)
  const kept = await readFile(target).catch(() => null)
  if (kept && kept.byteLength === size && sha256(kept) === want) {
    console.log(`✓ ${path} (present)`)
    continue
  }
  process.stdout.write(`↓ ${path} … `)
  const response = await fetch(models.source + path)
  if (!response.ok) {
    console.log(`HTTP ${response.status}`)
    failed = true
    continue
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength !== size || sha256(bytes) !== want) {
    console.log(`refused: ${bytes.byteLength} bytes, sha256 ${sha256(bytes)}`)
    failed = true
    continue
  }
  const part = new URL(`${path}.part`, folder)
  await writeFile(part, bytes)
  await rm(target, { force: true })
  await rename(part, target)
  console.log('ok')
}
if (failed) process.exitCode = 1
