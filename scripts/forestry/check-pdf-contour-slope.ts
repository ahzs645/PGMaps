/**
 * Local, read-only check of terrain built from a sheet's contours against the same block's slope
 * sheet. Scores only what the slope sheet states exactly: its lossless class pixels, and the
 * drawn/not-drawn split its lossless transparency gives in every tile. Writes only to `output`.
 *
 * npx tsx scripts/forestry/check-pdf-contour-slope.ts /local/Field_Layout.pdf /local/Slope_Map.pdf /tmp/contour-slope.json [/local/Hillshade_Map.pdf]
 *
 * With the hillshade sheet, the surface refined between contours from it (`hillshadeRelief.ts`) is
 * scored the same way beside the contour surface, on the pixels both have ground under, and a
 * held-out test is run: the surface is rebuilt from every other contour, with and without the
 * hillshade, and read at the contours left out, whose heights the sheet prints.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readGeoPdf } from '../../src/lib/geoPdf/read'
import {
  assignContourElevations,
  contourSurface,
  readContourLabels,
  type PdfContourSurface,
} from '../../src/lib/geoPdf/contours'
import { hillshadeOnGrid, refineWithHillshadeNow } from '../../src/lib/geoPdf/hillshadeRelief'
import { extractPaths } from '../../src/lib/geoPdf/paths'
import { PDF_PROFILES } from '../../src/lib/geoPdf/profiles'
import { readMapFrames } from '../../src/lib/geoPdf/georeference'
import { applyMatrix, decodeCells, knownClass, parseClassGrid } from '../../src/lib/geoPdf/classGrid'
import { projectedEpsg } from '../../src/lib/geoPdf/georeference'
import { slopePercentAt, slopeRangeIndex } from '../../src/pages/dev-forestry-roads/terrainSlopeClasses'
import type { LocalRaster } from '../../src/pages/dev-forestry/types'

const [fieldPath, slopePath, output, hillshadePath] = process.argv.slice(2)
if (!fieldPath || !slopePath || !output)
  throw Error(
    'Usage: npx tsx scripts/forestry/check-pdf-contour-slope.ts field.pdf slope.pdf /tmp/out.json [hillshade.pdf]',
  )
const read = async (p: string, mosaicPixels = false) =>
  readGeoPdf(new Uint8Array(await readFile(p)), path.basename(p), runtime as never, {
    maxFeatures: 500,
    maxVertices: 50_000,
    mosaicPixels,
    // CONTOUR_METHOD=nearest-contours builds the opt-in interpolation for comparison.
    contourMethod: process.env.CONTOUR_METHOD === 'nearest-contours' ? 'nearest-contours' : 'tin',
  })
const field = await read(fieldPath)
const surface = field.layers.find((l) => l.contourSurface)?.contourSurface
if (!surface) throw Error(`No contour surface: ${field.notices.join(' ')}`)
const rasterOf = (s: PdfContourSurface, values: Float32Array = s.values): LocalRaster => ({
  id: 'check',
  name: 'check',
  kind: 'terrain',
  epsg: s.epsg,
  origin: s.origin,
  pixelSize: [s.cellM, -s.cellM],
  width: s.width,
  height: s.height,
  values: Array.from(values, (v) => (Number.isFinite(v) ? v : null)),
  acquired: '',
  verticalReference: 'unstated',
  sha256: '0'.repeat(64),
})
const slope = await read(slopePath)
const grid = parseClassGrid(slope.layers.find((l) => l.classGrid?.kind === 'slope')?.classGrid)
if (!grid) throw Error('No slope class grid.')
if (projectedEpsg(grid.wkt) !== surface.epsg) throw Error('The two sheets use different projections.')
const cells = decodeCells(grid)
const K = grid.legend.length

/** Scores terrains on the slope sheet's exact pixels. With several, only where every one has ground. */
function score(rasters: LocalRaster[]) {
  // confusion[sheet][terrain]: index 0 = below the lowest range, 1..K = ranges, K+1 = terrain missing
  const tallies = rasters.map(() => ({
    confusion: Array.from({ length: K + 1 }, () => Array(K + 2).fill(0) as number[]),
    drawn: { agree: 0, total: 0 },
  }))
  for (let row = 0; row < grid!.height; row++)
    for (let col = 0; col < grid!.width; col++) {
      const code = cells[row * grid!.width + col]
      const exactClass = knownClass(code, grid!)
      const sheetDrawn = code === 0 ? false : exactClass || code > 64 || [240, 241, 243].includes(code) ? true : null
      if (sheetDrawn === null) continue
      const [x, y] = applyMatrix(grid!.transform, [col + 0.5, row + 0.5])
      const classes = rasters.map((raster) => {
        const c = Math.round((x - raster.origin[0]) / raster.pixelSize[0]),
          r = Math.round((y - raster.origin[1]) / raster.pixelSize[1])
        const s = c < 0 || r < 0 || c >= raster.width || r >= raster.height ? NaN : slopePercentAt(raster, c, r)
        return Number.isFinite(s) ? slopeRangeIndex(grid!.legend, s) + 1 : K + 1
      })
      // Several terrains are compared on the same pixels.
      if (rasters.length > 1 && classes.some((terrain) => terrain > K)) continue
      classes.forEach((terrain, i) => {
        const t = tallies[i]
        if (terrain <= K) {
          t.drawn.total++
          if (terrain > 0 === sheetDrawn) t.drawn.agree++
        }
        if (code === 0 || exactClass) t.confusion[exactClass ? code : 0][terrain]++
      })
    }
  return tallies.map(({ confusion, drawn }) => {
    const scored = confusion.map((row) => row.slice(0, K + 1))
    const total = scored.flat().reduce((s, n) => s + n, 0)
    const same = scored.reduce((s, row, i) => s + row[i], 0)
    const screen = (minimum: number) => {
      const k = grid!.legend.findIndex((c) => c.minimum === minimum) + 1
      let agree = 0,
        sheet = 0,
        terrain = 0,
        both = 0
      scored.forEach((row, i) =>
        row.forEach((n, j) => {
          const a = i >= k,
            b = j >= k
          if (a === b) agree += n
          if (a) sheet += n
          if (b) terrain += n
          if (a && b) both += n
        }),
      )
      return {
        threshold: minimum,
        agreement: agree / total,
        sheetShare: sheet / total,
        terrainShare: terrain / total,
        // Of the ground the sheet prints at the threshold or steeper, the share the terrain finds.
        found: both / sheet,
      }
    }
    return {
      drawnSplit: { agreement: drawn.agree / drawn.total, pixels: drawn.total },
      exactPixels: total,
      terrainMissingPixels: confusion.reduce((s, row) => s + row[K + 1], 0),
      sameRange: same / total,
      withinOneRange:
        scored.reduce((s, row, i) => s + row.reduce((t, n, j) => t + (Math.abs(i - j) <= 1 ? n : 0), 0), 0) / total,
      screens: [35, 40, 60].map(screen),
      confusion,
    }
  })
}

const [contours] = score([rasterOf(surface)])
const result: Record<string, unknown> = {
  method:
    'Terrain from the field sheet contours, slope by central differences on its cells, read with the slope sheet legend; scored on the slope sheet pixels whose class is exact (lossless tiles) or not drawn.',
  contourAssignment: surface.assignment,
  surface: { epsg: surface.epsg, cellM: surface.cellM, vertices: surface.vertices },
  labels: ['below', ...grid.legend.map((c) => c.label)],
  ...contours,
}

if (hillshadePath) {
  const sheet = await read(hillshadePath, true)
  const layer = sheet.layers.find((l) => l.imageMosaic?.kind === 'hillshade')
  if (!layer?.imageMosaic || !layer.mosaicPixels) throw Error(`No hillshade layer: ${sheet.notices.join(' ')}`)
  const shadeOn = (s: PdfContourSurface) => hillshadeOnGrid(layer.imageMosaic!, layer.mosaicPixels!, s)
  const refine = (s: PdfContourSurface) => {
    const started = Date.now()
    const refined = refineWithHillshadeNow({
      width: s.width,
      height: s.height,
      cellM: s.cellM,
      prior: s.values,
      shade: shadeOn(s),
      anchors: s.anchors!,
      intervalM: s.assignment.interval,
    })
    return { refined, seconds: (Date.now() - started) / 1000 }
  }
  const { refined, seconds } = refine(surface)
  const [onCommon, withHillshade] = score([rasterOf(surface), rasterOf(surface, refined.values)])
  const brief = (r: (typeof onCommon)[]) => r.map(({ confusion: _, ...rest }) => rest)
  result.hillshade = {
    method:
      'The contour surface refined between its contours from the hillshade sheet (`hillshadeRelief.ts`), scored beside the contour surface on the exact pixels both have ground under.',
    seconds,
    lighting: refined.lighting,
    cells: refined.cells,
    refinedCells: refined.refinedCells,
    medianChangeM: refined.medianChangeM,
    p99ChangeM: refined.p99ChangeM,
    boundedShare: refined.boundedShare,
    shadeResidualGrey: refined.shadeResidualGrey,
    contoursAlone: brief([onCommon])[0],
    contoursAndHillshade: brief([withHillshade])[0],
  }

  // Held-out contours: rebuild from every other contour and read the ones left out.
  const bytes = new Uint8Array(await readFile(fieldPath))
  const { frames } = await readMapFrames(bytes)
  const frame = frames[0]
  const doc = await runtime.getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  const content = await doc.getOptionalContentConfig({ intent: 'any' })
  const page = await doc.getPage(frame.page)
  const text = await page.getTextContent()
  const list = await page.getOperatorList({ intent: 'any', annotationMode: runtime.AnnotationMode.DISABLE })
  const profile = PDF_PROFILES.find((p) => p.label === field.layers[0].source.profile) ?? PDF_PROFILES[0]
  const paths = extractPaths(list as never, runtime.OPS as never, content as never, frame, profile.rules, {
    maxFeatures: 500,
    maxVertices: 50_000,
  })
  const items = text.items.flatMap((item) => ('str' in item ? [item] : []))
  const stated = items.map((item) => profile.contours.statedInterval?.exec(item.str.trim())).find(Boolean)
  const metresPerUnit = Math.sqrt(
    Math.abs(frame.pageToProjected[0] * frame.pageToProjected[3] - frame.pageToProjected[1] * frame.pageToProjected[2]),
  )
  const assignment = assignContourElevations(
    paths.contours,
    readContourLabels(items as never, frame.bbox, profile.contours.label),
    frame.bbox,
    { statedInterval: stated ? Number(stated[1]) : undefined, metresPerUnit },
  )
  const wide = assignment.interval * 2
  const keep = (h: number | null) => h !== null && Math.abs(h / wide - Math.round(h / wide)) < 1e-6
  const sparse = contourSurface(
    paths.contours,
    { ...assignment, interval: wide, elevations: assignment.elevations.map((h) => (keep(h) ? h : null)) },
    frame,
    surface.epsg,
  )
  // The held-out lines as points a cell apart: the full surface's points that are not on a kept contour.
  const held: number[] = []
  for (let k = 0; k < surface.anchors!.length; k += 3)
    if (!keep(surface.anchors![k + 2])) held.push(surface.anchors![k], surface.anchors![k + 1], surface.anchors![k + 2])
  const errors = (values: Float32Array, common: Float32Array) => {
    const out: number[] = []
    for (let k = 0; k < held.length; k += 3) {
      const c0 = Math.floor(held[k]),
        r0 = Math.floor(held[k + 1])
      if (c0 < 0 || r0 < 0 || c0 >= sparse.width - 1 || r0 >= sparse.height - 1) continue
      const at = (v: Float32Array) => {
        const tx = held[k] - c0,
          ty = held[k + 1] - r0,
          i = r0 * sparse.width + c0
        return (
          v[i] * (1 - tx) * (1 - ty) +
          v[i + 1] * tx * (1 - ty) +
          v[i + sparse.width] * (1 - tx) * ty +
          v[i + sparse.width + 1] * tx * ty
        )
      }
      const value = at(values)
      // Only where both surfaces have ground, so the two are read at the same points.
      if (Number.isFinite(value) && Number.isFinite(at(common))) out.push(value - held[k + 2])
    }
    out.sort((a, b) => Math.abs(a) - Math.abs(b))
    const signed = [...out].sort((a, b) => a - b)
    return {
      points: out.length,
      medianM: signed[Math.floor(signed.length / 2)],
      medianAbsM: Math.abs(out[Math.floor(out.length / 2)]),
      within90M: Math.abs(out[Math.floor(out.length * 0.9)]),
      within99M: Math.abs(out[Math.floor(out.length * 0.99)]),
      rmseM: Math.sqrt(out.reduce((s, v) => s + v * v, 0) / out.length),
    }
  }
  const sparseRefined = refine(sparse).refined
  result.heldOut = {
    method: `Surfaces rebuilt from the ${wide} m contours alone and read at the ${assignment.interval} m contours left out, a cell apart along them.`,
    contoursAlone: errors(sparse.values, sparseRefined.values),
    contoursAndHillshade: errors(sparseRefined.values, sparse.values),
    boundedShare: sparseRefined.boundedShare,
  }
}
await writeFile(output, JSON.stringify(result, null, 2))
console.log(JSON.stringify({ ...result, confusion: undefined }, null, 2))
