/**
 * Local, read-only comparison of the public terrains a road project can fall back on with a
 * company's LiDAR slope sheet: slope from each terrain, on its own cells, read in the sheet's
 * printed ranges and scored on the sheet's exact pixels (its lossless tiles and its not-drawn
 * mask). The field sheet's contour surface is scored the same way, and every terrain is scored on
 * the ground all of them cover as well as on its own coverage, because the contour surface has no
 * ground where the sheet labels no contour. Elevations are set beside the contour surface's.
 * Writes only to `output`.
 *
 * node --use-env-proxy --import tsx scripts/forestry/compare-public-terrains.ts \
 *   /local/Field_Layout.pdf /local/Slope_Map.pdf /tmp/public-terrains.json
 *
 * The terrains are read as the app or a script can read them: the regional Terrarium tiles through
 * the app's loader, BC CDED's half-sheets from pub.data.gov.bc.ca, and NRCan's MRDEM-30 DTM by
 * byte range. NRCan's 1 m HRDEM mosaic and LidarBC are checked for coverage in the app
 * (`docs/research/bc-road-terrain-sources-2026-11-12.md`), not here.
 */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { decode } from 'fast-png'
import { fromUrl } from 'geotiff'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import proj4 from 'proj4'
import { decodeTerrariumElevation, DEM_TILE_SIZE } from '../../src/lib/forestry/terrain/terrain'
import { readGeoPdf } from '../../src/lib/geoPdf/read'
import {
  applyMatrix,
  decodeCells,
  estimatedClass,
  gridCorners,
  knownClass,
  parseClassGrid,
} from '../../src/lib/geoPdf/classGrid'
import { cdedFromDownload, cdedTilesFor } from '../../src/pages/dev-forestry-roads/cdedDem'
import { loadRegionalTerrain } from '../../src/pages/dev-forestry-roads/terrain'

const [fieldPath, slopePath, output] = process.argv.slice(2)
if (!fieldPath || !slopePath || !output)
  throw Error('Usage: compare-public-terrains.ts field.pdf slope.pdf /tmp/out.json')
const MRDEM_DTM = 'https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif'
/** NAD83(CSRS) / Canada Atlas Lambert, EPSG:3979, MRDEM's grid. */
const MRDEM_CRS = '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs'
/** Every fourth pixel each way: about 680,000 points on a 3,600 × 3,000 sheet. */
const STEP = 4

const read = async (p: string) =>
  readGeoPdf(new Uint8Array(await readFile(p)), path.basename(p), runtime as never, {
    maxFeatures: 500,
    maxVertices: 50_000,
  })
const grid = parseClassGrid((await read(slopePath)).layers.find((l) => l.classGrid?.kind === 'slope')?.classGrid)
if (!grid) throw Error('No slope class grid.')
const surface = (await read(fieldPath)).layers.find((l) => l.contourSurface)?.contourSurface
if (!surface) throw Error('No contour surface in the field sheet.')
const sheet = proj4('EPSG:4326', grid.wkt)
const corners = gridCorners(grid)
const west = Math.min(...corners.map((c) => c[0])) - 0.003,
  east = Math.max(...corners.map((c) => c[0])) + 0.003,
  south = Math.min(...corners.map((c) => c[1])) - 0.002,
  north = Math.max(...corners.map((c) => c[1])) + 0.002

/** A terrain as a height at a point of the sheet's projected CRS, with the cell size its slope is taken over. */
interface Terrain {
  name: string
  cellM: number
  at: (x: number, y: number) => number
}
const bilinear = (get: (c: number, r: number) => number, fc: number, fr: number) => {
  const c0 = Math.floor(fc),
    r0 = Math.floor(fr),
    tx = fc - c0,
    ty = fr - r0
  const a = get(c0, r0),
    b = get(c0 + 1, r0),
    c = get(c0, r0 + 1),
    d = get(c0 + 1, r0 + 1)
  if (![a, b, c, d].every(Number.isFinite)) return NaN
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
}
const terrains: Terrain[] = [
  {
    name: `Field sheet contours (${surface.cellM} m surface)`,
    cellM: surface.cellM,
    at: (x, y) =>
      bilinear(
        (c, r) =>
          c < 0 || r < 0 || c >= surface.width || r >= surface.height ? NaN : surface.values[r * surface.width + c],
        (x - surface.origin[0]) / surface.cellM,
        (surface.origin[1] - y) / surface.cellM,
      ),
  },
]
const regional = await loadRegionalTerrain([west, south, east, north], undefined, async (bytes) => {
  const image = decode(new Uint8Array(bytes))
  assert.equal(image.width, DEM_TILE_SIZE)
  const values = new Float32Array(image.width * image.height)
  for (let i = 0; i < values.length; i++) {
    const o = i * image.channels
    values[i] = decodeTerrariumElevation(image.data[o], image.data[o + 1], image.data[o + 2])
  }
  return values
})
terrains.push({
  name: `Regional Terrarium (${Math.round(regional.metadata.resolutionM)} m)`,
  cellM: regional.metadata.resolutionM,
  at: (x, y) => {
    const [lon, lat] = sheet.inverse([x, y])
    return regional.source.elevationAt(lon, lat)
  },
})
const ring: [number, number][] = [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
]
const cded = []
for (const tile of cdedTilesFor(ring)) {
  const response = await fetch(tile.url)
  if (!response.ok) throw Error(`CDED ${tile.name}: HTTP ${response.status}`)
  cded.push(cdedFromDownload(new Uint8Array(await response.arrayBuffer()), tile.name))
}
const midLat = (south + north) / 2
terrains.push({
  name: `BC CDED (${(cded[0].dx * 3600).toFixed(2)}″ posts)`,
  // The mean of the two post spacings on the ground.
  cellM: (cded[0].dx * 111_320 * Math.cos((midLat * Math.PI) / 180) + cded[0].dy * 110_574) / 2,
  at: (x, y) => {
    const [lon, lat] = sheet.inverse([x, y])
    for (const g of cded) {
      const fc = (lon - g.west) / g.dx,
        fr = (lat - g.south) / g.dy
      if (fc < 0 || fr < 0 || fc > g.cols - 1 || fr > g.rows - 1) continue
      return bilinear((c, r) => g.columns[c]?.[r] ?? NaN, fc, fr)
    }
    return NaN
  },
})
const lcc = proj4('EPSG:4326', MRDEM_CRS)
const image = await (await fromUrl(MRDEM_DTM)).getImage()
const [ox, oy] = image.getOrigin(),
  [rx, ry] = image.getResolution()
const box = ring.map((p) => lcc.forward(p))
const c0 = Math.floor((Math.min(...box.map((p) => p[0])) - ox) / rx) - 2,
  c1 = Math.ceil((Math.max(...box.map((p) => p[0])) - ox) / rx) + 2,
  r0 = Math.floor((Math.max(...box.map((p) => p[1])) - oy) / ry) - 2,
  r1 = Math.ceil((Math.min(...box.map((p) => p[1])) - oy) / ry) + 2
const cellsMr = (await image.readRasters({ window: [c0, r0, c1, r1] }))[0] as Float32Array
const widthMr = c1 - c0,
  heightMr = r1 - r0,
  nodata = image.getGDALNoData()
terrains.push({
  name: `NRCan MRDEM-30 DTM (${Math.abs(rx)} m)`,
  cellM: Math.abs(rx),
  at: (x, y) => {
    const [lx, ly] = lcc.forward(sheet.inverse([x, y]))
    // Cell centres at half-cells of the file's grid.
    return bilinear(
      (c, r) => {
        if (c < 0 || r < 0 || c >= widthMr || r >= heightMr) return NaN
        const v = cellsMr[r * widthMr + c]
        return v === nodata || v < -1000 ? NaN : v
      },
      (lx - ox) / rx - c0 - 0.5,
      (ly - oy) / ry - r0 - 0.5,
    )
  },
})

const cells = decodeCells(grid)
const bounds = grid.legend.map((c) => c.minimum)
const classOf = (slope: number) => bounds.reduce((n, b) => n + (slope >= b ? 1 : 0), 0)
const steep = bounds.findIndex((b) => b === 60) + 1
/** Slope by central differences one cell of the terrain either way. */
const slopeOf = (t: Terrain, x: number, y: number) => {
  const h = Math.max(t.cellM, 1)
  const e = t.at(x + h, y),
    w = t.at(x - h, y),
    n = t.at(x, y + h),
    s = t.at(x, y - h)
  return [e, w, n, s].every(Number.isFinite) ? Math.hypot((e - w) / (2 * h), (n - s) / (2 * h)) * 100 : NaN
}
const tally = () => ({
  pixels: 0,
  same: 0,
  within: 0,
  sheetSteep: 0,
  terrainSteep: 0,
  bothSteep: 0,
  drawn: 0,
  drawnAgree: 0,
})
const own = terrains.map(tally),
  common = terrains.map(tally)
for (let row = 0; row < grid.height; row += STEP)
  for (let col = 0; col < grid.width; col += STEP) {
    const code = cells[row * grid.width + col]
    const exact = knownClass(code, grid) || code === 0
    const drawn =
      code === 0
        ? false
        : knownClass(code, grid) || estimatedClass(code, grid) || [240, 241, 243].includes(code)
          ? true
          : null
    if (drawn === null) continue
    const [x, y] = applyMatrix(grid.transform, [col + 0.5, row + 0.5])
    const slopes = terrains.map((t) => slopeOf(t, x, y))
    const everywhere = slopes.every(Number.isFinite)
    slopes.forEach((slope, i) => {
      if (!Number.isFinite(slope)) return
      const k = classOf(slope)
      for (const t of everywhere ? [own[i], common[i]] : [own[i]]) {
        t.drawn++
        if (k >= 1 === drawn) t.drawnAgree++
        if (!exact) continue
        const truth = code
        t.pixels++
        if (k === truth) t.same++
        if (Math.abs(k - truth) <= 1) t.within++
        if (truth >= steep) t.sheetSteep++
        if (k >= steep) t.terrainSteep++
        if (truth >= steep && k >= steep) t.bothSteep++
      }
    })
  }
const share = (a: number, b: number) => Math.round((1000 * a) / b) / 10
const table = (tallies: ReturnType<typeof tally>[]) =>
  tallies.map((t, i) => ({
    terrain: terrains[i].name,
    exactPixels: t.pixels,
    sameRangePercent: share(t.same, t.pixels),
    withinOneRangePercent: share(t.within, t.pixels),
    sheet60PlusFoundPercent: share(t.bothSteep, t.sheetSteep),
    terrain60PlusRightPercent: share(t.bothSteep, t.terrainSteep),
    drawnSplitPercent: share(t.drawnAgree, t.drawn),
  }))
// Heights against the contour surface, on a coarse lattice of the sheet.
const offsets = terrains.slice(1).map((t) => {
  const d: number[] = []
  for (let row = 0; row < grid.height; row += 30)
    for (let col = 0; col < grid.width; col += 30) {
      const [x, y] = applyMatrix(grid.transform, [col + 0.5, row + 0.5])
      const a = terrains[0].at(x, y),
        b = t.at(x, y)
      if (Number.isFinite(a) && Number.isFinite(b)) d.push(b - a)
    }
  d.sort((a, b) => a - b)
  const q = (f: number) => Math.round(d[Math.floor(f * (d.length - 1))] * 100) / 100
  return {
    terrain: t.name,
    points: d.length,
    medianM: q(0.5),
    middleHalfM: [q(0.25), q(0.75)],
    middle90M: [q(0.05), q(0.95)],
  }
})
const result = {
  method:
    'Slope by central differences one cell of each terrain either way, read in the slope sheet’s printed ranges, scored on the sheet’s exact pixels (lossless tiles and the not-drawn mask), every fourth pixel.',
  onOwnCoverage: table(own),
  onCommonGround: table(common),
  heightAgainstContourSurface: offsets,
}
await writeFile(output, JSON.stringify(result, null, 2))
console.log('Each terrain on its own coverage')
console.table(result.onOwnCoverage)
console.log('On the ground every terrain covers')
console.table(result.onCommonGround)
console.table(offsets)
