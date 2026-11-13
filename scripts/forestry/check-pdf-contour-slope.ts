/**
 * Local, read-only check of terrain built from a sheet's contours against the same block's slope
 * sheet. Scores only what the slope sheet states exactly: its lossless class pixels, and the
 * drawn/not-drawn split its lossless transparency gives in every tile. Writes only to `output`.
 *
 * npx tsx scripts/forestry/check-pdf-contour-slope.ts /local/Field_Layout.pdf /local/Slope_Map.pdf /tmp/contour-slope.json
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readGeoPdf } from '../../src/lib/geoPdf/read'
import { applyMatrix, decodeCells, knownClass, parseClassGrid } from '../../src/lib/geoPdf/classGrid'
import { projectedEpsg } from '../../src/lib/geoPdf/georeference'
import { slopePercentAt, slopeRangeIndex } from '../../src/pages/dev-forestry-roads/terrainSlopeClasses'
import type { LocalRaster } from '../../src/pages/dev-forestry/types'

const [fieldPath, slopePath, output] = process.argv.slice(2)
if (!fieldPath || !slopePath || !output)
  throw Error('Usage: npx tsx scripts/forestry/check-pdf-contour-slope.ts field.pdf slope.pdf /tmp/out.json')
const read = async (p: string) =>
  readGeoPdf(new Uint8Array(await readFile(p)), path.basename(p), runtime as never, {
    maxFeatures: 500,
    maxVertices: 50_000,
    // CONTOUR_METHOD=nearest-contours builds the opt-in interpolation for comparison.
    contourMethod: process.env.CONTOUR_METHOD === 'nearest-contours' ? 'nearest-contours' : 'tin',
  })
const field = await read(fieldPath)
const surface = field.layers.find((l) => l.contourSurface)?.contourSurface
if (!surface) throw Error(`No contour surface: ${field.notices.join(' ')}`)
const raster: LocalRaster = {
  id: 'check',
  name: 'check',
  kind: 'terrain',
  epsg: surface.epsg,
  origin: surface.origin,
  pixelSize: [surface.cellM, -surface.cellM],
  width: surface.width,
  height: surface.height,
  values: Array.from(surface.values, (v) => (Number.isFinite(v) ? v : null)),
  acquired: '',
  verticalReference: 'unstated',
  sha256: '0'.repeat(64),
}
const slope = await read(slopePath)
const grid = parseClassGrid(slope.layers.find((l) => l.classGrid?.kind === 'slope')?.classGrid)
if (!grid) throw Error('No slope class grid.')
if (projectedEpsg(grid.wkt) !== surface.epsg) throw Error('The two sheets use different projections.')
const cells = decodeCells(grid)
const K = grid.legend.length
// confusion[sheet][terrain]: index 0 = below the lowest range, 1..K = ranges, K+1 = terrain missing
const confusion = Array.from({ length: K + 1 }, () => Array(K + 2).fill(0) as number[])
const drawn = { agree: 0, total: 0 }
for (let row = 0; row < grid.height; row++)
  for (let col = 0; col < grid.width; col++) {
    const code = cells[row * grid.width + col]
    const exactClass = knownClass(code, grid)
    const sheetDrawn = code === 0 ? false : exactClass || code > 64 || [240, 241, 243].includes(code) ? true : null
    if (sheetDrawn === null) continue
    const [x, y] = applyMatrix(grid.transform, [col + 0.5, row + 0.5])
    const c = Math.round((x - raster.origin[0]) / raster.pixelSize[0]),
      r = Math.round((y - raster.origin[1]) / raster.pixelSize[1])
    const s = c < 0 || r < 0 || c >= raster.width || r >= raster.height ? NaN : slopePercentAt(raster, c, r)
    const terrain = Number.isFinite(s) ? slopeRangeIndex(grid.legend, s) + 1 : K + 1
    if (terrain <= K) {
      drawn.total++
      if (terrain > 0 === sheetDrawn) drawn.agree++
    }
    if (code === 0 || exactClass) confusion[exactClass ? code : 0][terrain]++
  }
const scored = confusion.map((row) => row.slice(0, K + 1))
const total = scored.flat().reduce((s, n) => s + n, 0)
const same = scored.reduce((s, row, i) => s + row[i], 0)
const screen = (minimum: number) => {
  const k = grid.legend.findIndex((c) => c.minimum === minimum) + 1
  let agree = 0,
    sheet = 0,
    terrain = 0
  scored.forEach((row, i) =>
    row.forEach((n, j) => {
      const a = i >= k,
        b = j >= k
      if (a === b) agree += n
      if (a) sheet += n
      if (b) terrain += n
    }),
  )
  return { threshold: minimum, agreement: agree / total, sheetShare: sheet / total, terrainShare: terrain / total }
}
const result = {
  method:
    'Terrain from the field sheet contours, slope by central differences on its cells, read with the slope sheet legend; scored on the slope sheet pixels whose class is exact (lossless tiles) or not drawn.',
  contourAssignment: surface.assignment,
  surface: { epsg: surface.epsg, cellM: surface.cellM, vertices: surface.vertices },
  drawnSplit: { agreement: drawn.agree / drawn.total, pixels: drawn.total },
  exactPixels: total,
  terrainMissingPixels: confusion.reduce((s, row) => s + row[K + 1], 0),
  sameRange: same / total,
  withinOneRange:
    scored.reduce((s, row, i) => s + row.reduce((t, n, j) => t + (Math.abs(i - j) <= 1 ? n : 0), 0), 0) / total,
  screens: [35, 40, 60].map(screen),
  labels: ['below', ...grid.legend.map((c) => c.label)],
  confusion,
}
await writeFile(output, JSON.stringify(result, null, 2))
console.log(JSON.stringify({ ...result, confusion: undefined }, null, 2))
