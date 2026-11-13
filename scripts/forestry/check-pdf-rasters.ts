/** Local, read-only source verification. No source maps or coordinates are written to the repository. */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readGeoPdf } from '../../src/lib/geoPdf/read'
import { parseClassGrid, summarizeClassSteps } from '../../src/lib/geoPdf/classGrid'
import { readLooseShapefile } from '../../src/pages/dev-forestry-roads/spatialImport'

const [maps, blockPath, output] = process.argv.slice(2)
if (!maps || !blockPath || !output)
  throw Error(
    'Usage: npx tsx scripts/forestry/check-pdf-rasters.ts /local/Maps /local/block.shp /tmp/pdf-class-report.json',
  )
const file = async (p: string) => new File([await readFile(p)], path.basename(p))
const stem = blockPath.replace(/\.shp$/i, '')
const block = await readLooseShapefile(await file(blockPath), path.basename(blockPath), {
  prj: await file(stem + '.prj'),
  dbf: await file(stem + '.dbf'),
})
const geometry = block.collection.features[0].geometry
if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') throw Error('Supply a polygon block.')
const results = []
const seen = new Set<string>()
// Every PDF in the folder whose profile publishes a class raster; identical copies once.
for (const name of (await readdir(maps)).filter((n) => /\.pdf$/i.test(n)).sort()) {
  let imported
  try {
    imported = await readGeoPdf(new Uint8Array(await readFile(path.join(maps, name))), name, runtime, {
      maxFeatures: 500,
      maxVertices: 50000,
    })
  } catch (error) {
    console.log(`${name}: not read (${error instanceof Error ? error.message : String(error)})`)
    continue
  }
  if (seen.has(imported.sha256)) continue
  seen.add(imported.sha256)
  const layer = imported.layers.find((l) => l.classGrid)
  const grid = parseClassGrid(layer?.classGrid)
  if (!grid) continue
  const steps = summarizeClassSteps(grid, geometry)
  let result = steps.next()
  while (!result.done) result = steps.next()
  results.push({
    file: name,
    sha256: imported.sha256,
    profile: layer!.source.profile,
    kind: grid.kind,
    width: grid.width,
    height: grid.height,
    checksum: grid.checksum,
    legend: grid.legend,
    counts: grid.counts,
    sourceImages: grid.sourceImages,
    summary: result.value,
    notes: grid.notes,
  })
}
await writeFile(
  output,
  JSON.stringify({ method: 'Original embedded PDF pixels; full selected polygon denominator', results }, null, 2),
)
console.log(`Checked ${results.length} class grids; wrote ${output}`)
