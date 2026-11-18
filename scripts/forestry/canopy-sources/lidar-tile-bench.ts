/**
 * Local, read-only bench: open canopy and satellite-laser sources against PGMaps' own airborne LiDAR
 * tile (BC 093G086, July 2024, 1 m CHM and DTM in NAD83(CSRS) UTM 10N, CGVD2013), which is the
 * reference here. Needs the tile's analysis products (`npm run lidar:fetch-analysis`).
 *
 *   node --import tsx scripts/forestry/canopy-sources/lidar-tile-bench.ts out.json \
 *     [--products public/data/lidar-analysis/bc-093g086] [--icesat2 g086-icesat2.json]
 *
 * Writes only to the output path.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { decode } from 'fast-png'
import { fromFile, fromUrl } from 'geotiff'
import proj4 from 'proj4'
import { decodeTerrariumElevation, DEM_TILE_SIZE } from '../../../src/lib/forestry/terrain/terrain'
import { loadRegionalTerrain } from '../../../src/pages/dev-forestry-roads/terrain'
import { fetchVegetationStands } from '../../../src/pages/dev-forestry/bcVegetationInventory'
import { canopyAt, readMetaChm } from '../../../src/lib/forestry/canopy/metaChm'
import { readScanfi, scanfiCellCentre, type ScanfiGrid } from '../../../src/lib/forestry/canopy/scanfi'
import {
  groundCheck,
  groundCheckSummary,
  differenceStats,
  type GroundPoint,
} from '../../../src/lib/forestry/canopy/groundCheck'
import { linearFit, pearson, quantile, round, pointInRings, ringsOf } from './benchMath'

const argv = process.argv.slice(2)
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const output = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
assert(output, 'Usage: lidar-tile-bench.ts out.json [--products dir] [--icesat2 file]')
const products = flag('products') ?? 'public/data/lidar-analysis/bc-093g086'
const t0 = Date.now()
const log = (...m: unknown[]) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)} s]`, ...m)

proj4.defs('EPSG:3157', '+proj=utm +zone=10 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs')
const utm = proj4('EPSG:4326', 'EPSG:3157')
const summary = JSON.parse(await readFile(path.join(products, 'summary.json'), 'utf8'))
assert.equal(summary.crs, 'EPSG:3157')
async function raster(name: string) {
  const image = await (await fromFile(path.join(products, name))).getImage()
  const [ox, oy] = image.getOrigin(),
    [rx, ry] = image.getResolution()
  const data = (await image.readRasters({ samples: [0], interleave: true })) as Float32Array
  const width = image.getWidth(),
    height = image.getHeight()
  const at = (lon: number, lat: number) => {
    const [x, y] = utm.forward([lon, lat])
    const c = Math.floor((x - ox) / rx),
      r = Math.floor((y - oy) / ry)
    const v = c < 0 || r < 0 || c >= width || r >= height ? NaN : data[r * width + c]
    return v === -9999 ? NaN : v
  }
  const lonLat = (c: number, r: number) => utm.inverse([ox + (c + 0.5) * rx, oy + (r + 0.5) * ry]) as [number, number]
  return { data, width, height, at, lonLat }
}
const lidarChm = await raster('height-1m.tif')
const lidarDtm = await raster('dtm-1m.tif')
const box = summary.bounds_wgs84 as [number, number, number, number]
/** One east–west scale for every 20 m bin, from the box's centre latitude (see `groundCheck`). */
const BIN_KX = 111_320 * Math.cos((((box[1] + box[3]) / 2) * Math.PI) / 180)
log('LiDAR', lidarChm.width, '×', lidarChm.height)

const open = (url: string) => fromUrl(url, { allowFullFile: false, blockSize: 65_536, cacheSize: 256 }) as never
const chm = await readMetaChm(box, open)
log('CHM v2', chm.width, '×', chm.height)
const scanfi: Record<string, ScanfiGrid> = {}
for (const [layer, year] of [
  ['height', 2025],
  ['height', 2020],
  ['closure', 2025],
  ['biomass', 2025],
] as const)
  scanfi[`${layer}${year}`] = await readScanfi(layer, year, box, open)
log('SCANFI read')
const regional = await loadRegionalTerrain(box, undefined, async (bytes) => {
  const image = decode(new Uint8Array(bytes))
  const values = new Float32Array(image.width * image.height)
  assert.equal(image.width, DEM_TILE_SIZE)
  for (let i = 0; i < values.length; i++) {
    const o = i * image.channels
    values[i] =
      image.channels === 4 && image.data[o + 3] === 0
        ? NaN
        : decodeTerrariumElevation(image.data[o], image.data[o + 1], image.data[o + 2])
  }
  return values
})

// --- 1. CHM v2 against the LiDAR CHM, cell by cell and over blocks ---------------------------------------------
const pixelDiffs: number[] = []
const byClass = new Map<string, number[]>()
const classOf = (h: number) => (h < 2 ? '0–2 m' : h < 5 ? '2–5 m' : h < 15 ? '5–15 m' : h < 25 ? '15–25 m' : '25 m +')
for (let r = 0; r < lidarChm.height; r += 2)
  for (let c = 0; c < lidarChm.width; c += 2) {
    const ref = lidarChm.data[r * lidarChm.width + c]
    if (ref === -9999 || !Number.isFinite(ref)) continue
    const [lon, lat] = lidarChm.lonLat(c, r)
    const v = canopyAt(chm, lon, lat)
    if (!Number.isFinite(v)) continue
    pixelDiffs.push(v - ref)
    const k = classOf(ref)
    if (!byClass.has(k)) byClass.set(k, [])
    byClass.get(k)!.push(v - ref)
  }
function blocks(size: number) {
  const rows: {
    lidarMean: number
    lidarP95: number
    lidarCover: number
    chmMean: number
    chmP95: number
    chmCover: number
    lon: number
    lat: number
    slope: number
  }[] = []
  for (let r0 = 0; r0 + size <= lidarChm.height; r0 += size)
    for (let c0 = 0; c0 + size <= lidarChm.width; c0 += size) {
      const ref: number[] = [],
        pred: number[] = []
      for (let r = r0; r < r0 + size; r++)
        for (let c = c0; c < c0 + size; c++) {
          const h = lidarChm.data[r * lidarChm.width + c]
          if (h === -9999) continue
          const [lon, lat] = lidarChm.lonLat(c, r)
          const v = canopyAt(chm, lon, lat)
          if (!Number.isFinite(v)) continue
          ref.push(h)
          pred.push(v)
        }
      if (ref.length < size * size * 0.9) continue
      const [lon, lat] = lidarChm.lonLat(c0 + size / 2, r0 + size / 2)
      const z = (dc: number, dr: number) => lidarDtm.data[(r0 + size / 2 + dr) * lidarDtm.width + c0 + size / 2 + dc]
      const slope = Math.hypot((z(5, 0) - z(-5, 0)) / 10, (z(0, 5) - z(0, -5)) / 10) * 100
      rows.push({
        lidarMean: ref.reduce((s, v) => s + v, 0) / ref.length,
        lidarP95: quantile(ref, 0.95),
        lidarCover: ref.filter((v) => v >= 5).length / ref.length,
        chmMean: pred.reduce((s, v) => s + v, 0) / pred.length,
        chmP95: quantile(pred, 0.95),
        chmCover: pred.filter((v) => v >= 5).length / pred.length,
        lon,
        lat,
        slope,
      })
    }
  const forested = rows.filter((b) => b.lidarP95 >= 10)
  return {
    blockM: size,
    blocks: rows.length,
    meanHeight: {
      bias: differenceStats(rows.map((b) => b.chmMean - b.lidarMean)),
      r: round(
        pearson(
          rows.map((b) => b.chmMean),
          rows.map((b) => b.lidarMean),
        ),
        3,
      ),
    },
    p95Height: {
      bias: differenceStats(rows.map((b) => b.chmP95 - b.lidarP95)),
      r: round(
        pearson(
          rows.map((b) => b.chmP95),
          rows.map((b) => b.lidarP95),
        ),
        3,
      ),
    },
    p95HeightForested: {
      bias: differenceStats(forested.map((b) => b.chmP95 - b.lidarP95)),
      r: round(
        pearson(
          forested.map((b) => b.chmP95),
          forested.map((b) => b.lidarP95),
        ),
        3,
      ),
      // LiDAR p95 ≈ intercept + slope × CHM v2 p95: how far a straight line takes the model, here only.
      fit: linearFit(
        forested.map((b) => b.chmP95),
        forested.map((b) => b.lidarP95),
      ),
    },
    cover5: {
      biasPercent: differenceStats(rows.map((b) => 100 * (b.chmCover - b.lidarCover))),
      r: round(
        pearson(
          rows.map((b) => b.chmCover),
          rows.map((b) => b.lidarCover),
        ),
        3,
      ),
    },
    openAgreement: {
      lidarOpen: rows.filter((b) => b.lidarCover < 0.1).length,
      chmAlsoOpen: rows.filter((b) => b.lidarCover < 0.1 && b.chmCover < 0.1).length,
      lidarClosed: rows.filter((b) => b.lidarCover >= 0.5).length,
      chmAlsoClosed: rows.filter((b) => b.lidarCover >= 0.5 && b.chmCover >= 0.5).length,
    },
    p95BySlope: [
      [0, 10],
      [10, 30],
      [30, Infinity],
    ].map(([lo, hi]) => ({
      slope: `${lo}–${hi === Infinity ? '' : hi} %`,
      stats: differenceStats(forested.filter((b) => b.slope >= lo && b.slope < hi).map((b) => b.chmP95 - b.lidarP95)),
    })),
    p95ByLidarHeight: [
      [10, 20],
      [20, 25],
      [25, 30],
      [30, Infinity],
    ].map(([lo, hi]) => ({
      lidarP95: `${lo}–${hi === Infinity ? '' : hi} m`,
      stats: differenceStats(
        forested.filter((b) => b.lidarP95 >= lo && b.lidarP95 < hi).map((b) => b.chmP95 - b.lidarP95),
      ),
    })),
  }
}
const chmVsLidar = {
  imagery: 'tile 0212102012: 2016-09-30 to 2020-05-09 (acq_dates.parquet); LiDAR July 2024',
  pixels: { cells: pixelDiffs.length, stats: differenceStats(pixelDiffs) },
  pixelsByLidarHeight: [...byClass].map(([k, v]) => ({ lidar: k, stats: differenceStats(v) })),
  blocks: [10, 30].map(blocks),
}
log('CHM v2 vs LiDAR done')

// --- 2. SCANFI against the LiDAR at its own 30 m cells -----------------------------------------------------------
const h25 = scanfi.height2025
const scanfiRows: {
  scanfi: number
  scanfi20: number
  closure: number
  biomass: number
  mean: number
  p90: number
  p95: number
  max: number
  cover: number
}[] = []
for (let r = 0; r < h25.height; r++)
  for (let c = 0; c < h25.width; c++) {
    const v = h25.data[r * h25.width + c]
    if (!Number.isFinite(v)) continue
    const [lon, lat] = scanfiCellCentre(h25, c, r)
    const ref: number[] = []
    for (let dy = -14; dy <= 14; dy += 2)
      for (let dx = -14; dx <= 14; dx += 2) {
        const h = lidarChm.at(lon + dx / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + dy / 110_574)
        if (Number.isFinite(h)) ref.push(h)
      }
    if (ref.length < 200) continue
    const i = r * h25.width + c
    scanfiRows.push({
      scanfi: v,
      scanfi20: scanfi.height2020.data[i],
      closure: scanfi.closure2025.data[i],
      biomass: scanfi.biomass2025.data[i],
      mean: ref.reduce((s, x) => s + x, 0) / ref.length,
      p90: quantile(ref, 0.9),
      p95: quantile(ref, 0.95),
      max: Math.max(...ref),
      cover: ref.filter((x) => x >= 5).length / ref.length,
    })
  }
const treed = scanfiRows.filter((r) => r.p95 >= 10)
const scanfiVsLidar = {
  cells: scanfiRows.length,
  heightVsLidarMean: {
    bias: differenceStats(scanfiRows.map((r) => r.scanfi - r.mean)),
    r: round(
      pearson(
        scanfiRows.map((r) => r.scanfi),
        scanfiRows.map((r) => r.mean),
      ),
      3,
    ),
  },
  heightVsLidarP90: {
    bias: differenceStats(treed.map((r) => r.scanfi - r.p90)),
    r: round(
      pearson(
        treed.map((r) => r.scanfi),
        treed.map((r) => r.p90),
      ),
      3,
    ),
  },
  heightVsLidarP95: {
    bias: differenceStats(treed.map((r) => r.scanfi - r.p95)),
    r: round(
      pearson(
        treed.map((r) => r.scanfi),
        treed.map((r) => r.p95),
      ),
      3,
    ),
  },
  height2020VsLidarP95: {
    bias: differenceStats(treed.filter((r) => Number.isFinite(r.scanfi20)).map((r) => r.scanfi20 - r.p95)),
  },
  closureVsLidarCover5: {
    biasPercent: differenceStats(
      scanfiRows.filter((r) => Number.isFinite(r.closure)).map((r) => r.closure - 100 * r.cover),
    ),
    r: round(
      pearson(
        scanfiRows.filter((r) => Number.isFinite(r.closure)).map((r) => r.closure),
        scanfiRows.filter((r) => Number.isFinite(r.closure)).map((r) => r.cover),
      ),
      3,
    ),
  },
  meanBiomassTPerHa: round(
    scanfiRows.filter((r) => Number.isFinite(r.biomass)).reduce((s, r) => s + r.biomass, 0) /
      scanfiRows.filter((r) => Number.isFinite(r.biomass)).length,
    1,
  ),
}
log('SCANFI vs LiDAR done')

// --- 3. Ground: ICESat-2 and the regional DEM against the LiDAR DTM ---------------------------------------------
type Ice = { photonDates: string[]; photons: [number, number, number, number, number, number][] }
const ice: Ice | undefined = flag('icesat2') ? JSON.parse(await readFile(flag('icesat2')!, 'utf8')) : undefined
let ground: unknown = null,
  laserCanopy: unknown = null
const slope = (lon: number, lat: number) => {
  const d = 5,
    kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const z = (dx: number, dy: number) => lidarDtm.at(lon + dx / kx, lat + dy / 110_574)
  return Math.hypot((z(d, 0) - z(-d, 0)) / (2 * d), (z(0, d) - z(0, -d)) / (2 * d)) * 100
}
// The regional DEM everywhere on the tile, against the LiDAR's own ground.
const regionalDiffs: number[] = []
for (let r = 0; r < lidarDtm.height; r += 10)
  for (let c = 0; c < lidarDtm.width; c += 10) {
    const z = lidarDtm.data[r * lidarDtm.width + c]
    if (z === -9999) continue
    const [lon, lat] = lidarDtm.lonLat(c, r)
    const t = regional.source.elevationAt(lon, lat)
    if (Number.isFinite(t)) regionalDiffs.push(t - z)
  }
if (ice) {
  const pts: GroundPoint[] = ice.photons
    .filter((p) => p[3] === 1)
    .map(([lon, lat, h, , d, spot]) => ({ lon, lat, h, group: `${ice.photonDates[d]} spot ${spot}` }))
  // terrain − reference: here the LiDAR is the "terrain" and ICESat-2 the points, so a positive number is ICESat-2 low.
  const bins = groundCheck(pts, (lon, lat) => lidarDtm.at(lon, lat), { slopeAt: slope })
  const regionalBins = groundCheck(pts, (lon, lat) => regional.source.elevationAt(lon, lat), { slopeAt: slope })
  ground = {
    groundPhotons: pts.length,
    passes: [...new Set(pts.map((p) => p.group.split(' ')[0]))],
    lidarMinusIcesat2: groundCheckSummary(bins),
    regionalMinusIcesat2: groundCheckSummary(regionalBins),
    regionalMinusLidarEverywhere: differenceStats(regionalDiffs),
  }
  // Canopy: RH98 of canopy photons above the ground photons within 6 m on the same beam (as the road bench).
  const groups = new Map<string, { lon: number; lat: number; h: number; cls: number }[]>()
  for (const [lon, lat, h, cls, d, spot] of ice.photons) {
    const k = `${ice.photonDates[d]} spot ${spot}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push({ lon, lat, h, cls })
  }
  const rows: { laser: number; lidarP98: number; chmP98: number; canopy: number }[] = []
  for (const list of groups.values()) {
    const g = list.filter((p) => p.cls === 1)
    const binsMap = new Map<string, { lon: number; lat: number; n: number; ng: number; rel: number[] }>()
    for (const p of list) {
      const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180)
      const key = `${Math.floor((p.lon * BIN_KX) / 20)}|${Math.floor((p.lat * 110_574) / 20)}`
      let b = binsMap.get(key)
      if (!b) binsMap.set(key, (b = { lon: 0, lat: 0, n: 0, ng: 0, rel: [] }))
      b.lon += p.lon
      b.lat += p.lat
      b.n++
      if (p.cls === 1) {
        b.ng++
        continue
      }
      const near = g
        .filter(
          (q) =>
            Math.abs(q.lat - p.lat) * 110_574 <= 6 && Math.hypot((q.lon - p.lon) * kx, (q.lat - p.lat) * 110_574) <= 6,
        )
        .map((q) => q.h)
      if (near.length >= 3) b.rel.push(p.h - quantile(near, 0.5))
    }
    for (const b of binsMap.values()) {
      if (b.ng < 5) continue
      const lon = b.lon / b.n,
        lat = b.lat / b.n
      const rel = b.rel.filter((h) => h > 0)
      const lid: number[] = [],
        pred: number[] = []
      for (let dy = -10; dy <= 10; dy++)
        for (let dx = -10; dx <= 10; dx++) {
          if (dx * dx + dy * dy > 100) continue
          const ll: [number, number] = [lon + dx / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + dy / 110_574]
          const h = lidarChm.at(...ll)
          if (Number.isFinite(h)) lid.push(h)
          const v = canopyAt(chm, ...ll)
          if (Number.isFinite(v)) pred.push(v)
        }
      if (lid.length < 200) continue
      rows.push({
        laser: rel.length >= 5 ? quantile(rel, 0.98) : 0,
        lidarP98: quantile(lid, 0.98),
        chmP98: pred.length ? quantile(pred, 0.98) : NaN,
        canopy: rel.length,
      })
    }
  }
  const tall = rows.filter((r) => r.lidarP98 >= 10)
  laserCanopy = {
    bins: rows.length,
    tallBins: tall.length,
    icesat2MinusLidarP98: {
      bias: differenceStats(tall.map((r) => r.laser - r.lidarP98)),
      r: round(
        pearson(
          tall.map((r) => r.laser),
          tall.map((r) => r.lidarP98),
        ),
        3,
      ),
    },
    chmMinusLidarP98: {
      bias: differenceStats(tall.filter((r) => Number.isFinite(r.chmP98)).map((r) => r.chmP98 - r.lidarP98)),
    },
    tallWithFewCanopyPhotons: tall.filter((r) => r.canopy < 10).length,
  }
}
log('ground and laser done')

// --- 4. VRI polygons against the LiDAR -------------------------------------------------------------------------
const vri = await fetchVegetationStands(box, { maxFeatures: 500 })
const vriRows = vri.stands
  .filter((s) => s.treed && s.heightMeters !== null)
  .flatMap((s) => {
    const rings = ringsOf(s.geometry)
    const inside: number[] = []
    for (let r = 0; r < lidarChm.height; r += 3)
      for (let c = 0; c < lidarChm.width; c += 3) {
        const h = lidarChm.data[r * lidarChm.width + c]
        if (h === -9999) continue
        if (pointInRings(rings, ...lidarChm.lonLat(c, r))) inside.push(h)
      }
    return inside.length >= 300
      ? [{ vri: s.heightMeters!, p95: quantile(inside, 0.95), p90: quantile(inside, 0.9), cells: inside.length }]
      : []
  })
const vriVsLidar = {
  polygons: vriRows.length,
  vriMinusLidarP95: differenceStats(vriRows.map((v) => v.vri - v.p95)),
  vriMinusLidarP90: differenceStats(vriRows.map((v) => v.vri - v.p90)),
  r: round(
    pearson(
      vriRows.map((v) => v.vri),
      vriRows.map((v) => v.p95),
    ),
    3,
  ),
}

const result = {
  generated: new Date().toISOString(),
  tile: { box, acquisition: 'July 2024', crs: summary.crs, vertical: summary.vertical_datum },
  chmVsLidar,
  scanfiVsLidar,
  ground,
  laserCanopy,
  vriVsLidar,
}
await writeFile(output, JSON.stringify(result, null, 2))
log('wrote', output)
