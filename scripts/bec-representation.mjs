import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPinnedStudy, sha256 } from './lib/becRepresentation.mjs'

const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'bec-representation')
const check = process.argv.includes('--check')
const { data, sources } = await loadPinnedStudy(join(directory, 'source'))
const representation = `${JSON.stringify(data, null, 2)}\n`
const manifest = `${JSON.stringify({
  schemaVersion: 1,
  source: data.source,
  sources,
  outputs: [{ path: 'representation.json', sha256: sha256(representation), bytes: Buffer.byteLength(representation) }],
  summary: data.summary,
  regeneration: 'node scripts/bec-representation.mjs',
  check: 'node scripts/bec-representation.mjs --check',
  scope: 'Pinned source tables and normalized story data only. Display geometry is documented separately.',
}, null, 2)}\n`

for (const [name, content] of [['representation.json', representation], ['manifest.json', manifest]]) {
  const path = join(directory, name)
  if (check) {
    const existing = await readFile(path, 'utf8').catch(() => null)
    if (existing !== content) throw new Error(`Generated BEC study data is stale: ${name}`)
  } else {
    await writeFile(path, content)
  }
}
console.log(`${check ? 'Verified' : 'Generated'} BEC study: ${data.summary.unitCount} units, ${data.summary.finiteRatioCount} finite ratios, ${data.summary.intersectionCount} park intersections.`)
