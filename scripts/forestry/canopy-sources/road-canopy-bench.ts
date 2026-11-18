/**
 * Local, read-only bench: what open canopy and satellite-laser data say about a road project, set
 * against the project's own terrain and (when given) a company's LiDAR-drawn field and canopy sheets.
 *
 *   node --import tsx scripts/forestry/canopy-sources/road-canopy-bench.ts project.road.json out.json \
 *     [--field Field_Layout.pdf] [--canopy Canopy_Height.pdf] [--icesat2 icesat2.json] [--gedi gedi.json]
 *
 * Sources read here: Meta CHM v2 (Source Cooperative COGs, read by byte range), SCANFI v2 (NRCan,
 * by byte range), BC VRI rank 1 (DataBC WFS), ICESat-2 ATL03/ATL08 and GEDI from `sliderule-fetch.py`
 * and `sliderule-export.py` (SlideRule's public cluster). Writes only to the output path. The company
 * sheets, the project and the output stay outside the repository: they name a licensee's block.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { decode } from 'fast-png'
import { fromUrl } from 'geotiff'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import { decodeTerrariumElevation, DEM_TILE_SIZE } from '../../../src/lib/forestry/terrain/terrain'
import { readGeoPdf } from '../../../src/lib/geoPdf/read'
import {
  decodeCells,
  estimatedClass,
  gridProjection,
  invertMatrix,
  applyMatrix,
  knownClass,
  parseClassGrid,
} from '../../../src/lib/geoPdf/classGrid'
import type { PdfClassGrid, XY } from '../../../src/lib/geoPdf/types'
import { parseProject } from '../../../src/pages/dev-forestry-roads/project'
import { loadRegionalTerrain } from '../../../src/pages/dev-forestry-roads/terrain'
import { safeAnalyzeRoad } from '../../../src/pages/dev-forestry-roads/analysisResult'
import { contourTerrain } from '../../../src/pages/dev-forestry-roads/contourTerrain'
import type { TerrainSource } from '../../../src/pages/dev-forestry-roads/types'
import { fetchVegetationStands, type VriStand } from '../../../src/pages/dev-forestry/bcVegetationInventory'
import {
  canopyAt,
  canopyWithin,
  readMetaChm,
  mercatorPixel,
  type CanopyGrid,
} from '../../../src/lib/forestry/canopy/metaChm'
import {
  readScanfi,
  scanfiAt,
  scanfiCellCentre,
  SCANFI_LANDCOVER,
  type ScanfiGrid,
  type ScanfiLayer,
} from '../../../src/lib/forestry/canopy/scanfi'
import { corridorCanopy, gapRuns } from '../../../src/lib/forestry/canopy/corridor'
import {
  groundCheck,
  groundCheckSummary,
  differenceStats,
  type GroundPoint,
} from '../../../src/lib/forestry/canopy/groundCheck'
import { pearson, quantile, round, pointInRings, ringsOf } from './benchMath'

const argv = process.argv.slice(2)
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const [projectPath, output] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
if (!projectPath || !output)
  throw Error(
    'Usage: road-canopy-bench.ts project.road.json out.json [--field f.pdf] [--canopy c.pdf] [--icesat2 i.json] [--gedi g.json]',
  )
const t0 = Date.now()
const log = (...m: unknown[]) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)} s]`, ...m)

const project = parseProject(JSON.parse(await readFile(projectPath, 'utf8')))
const bounds = project.terrain.bounds as [number, number, number, number]
assert(bounds, 'The project has no terrain bounds.')
const pad = 0.004
const featureCoords: number[][] = [
  ...(project.reference ?? []).flatMap((f) => (f.geometry.coordinates as unknown[]).flat(3) as unknown as number[]),
  ...project.context.flatMap((f) => (f.geometry.coordinates as unknown[]).flat(3) as unknown as number[]),
].reduce<number[][]>((pairs, v, i, all) => (i % 2 ? pairs : [...pairs, [v, all[i + 1]]]), [])
const fx = featureCoords.map((c) => c[0]).filter(Number.isFinite),
  fy = featureCoords.map((c) => c[1]).filter(Number.isFinite)
const box: [number, number, number, number] = [
  Math.min(bounds[0], ...fx) - pad,
  Math.min(bounds[1], ...fy) - pad,
  Math.max(bounds[2], ...fx) + pad,
  Math.max(bounds[3], ...fy) + pad,
]
/** One east–west scale for every 20 m bin, from the box's centre latitude (see `groundCheck`). */
const BIN_KX = 111_320 * Math.cos((((box[1] + box[3]) / 2) * Math.PI) / 180)

// --- Terrain: the project's regional DEM, loaded as the app does -------------------------------------------------
const regional = await loadRegionalTerrain(bounds, undefined, async (bytes) => {
  const image = decode(new Uint8Array(bytes))
  assert.equal(image.width, DEM_TILE_SIZE)
  const values = new Float32Array(image.width * image.height)
  for (let i = 0; i < values.length; i++) {
    const o = i * image.channels
    values[i] =
      image.channels === 4 && image.data[o + 3] === 0
        ? NaN
        : decodeTerrariumElevation(image.data[o], image.data[o + 1], image.data[o + 2])
  }
  return values
})
log('regional terrain', regional.metadata.name)
const readPdf = async (p: string) =>
  readGeoPdf(new Uint8Array(await readFile(p)), path.basename(p), runtime as never, {
    maxFeatures: 500,
    maxVertices: 50_000,
  })
let contours: { source: TerrainSource; name: string } | undefined
if (flag('field')) {
  const field = await readPdf(flag('field')!)
  const layer = field.layers.find((l) => l.contourSurface)
  if (layer) {
    const t = contourTerrain(layer.contourSurface!, layer.source, 'not stated on the sheet')
    contours = { source: t.source, name: t.metadata.name }
  }
  log('contour terrain', contours?.name ?? 'none')
}
let canopySheet: PdfClassGrid | undefined
if (flag('canopy')) {
  const sheet = await readPdf(flag('canopy')!)
  canopySheet = parseClassGrid(sheet.layers.find((l) => l.classGrid?.kind === 'canopy')?.classGrid)
  log(
    'canopy sheet',
    canopySheet
      ? `${canopySheet.width}×${canopySheet.height}, ${canopySheet.legend.map((c) => c.label).join(' | ')}`
      : 'none',
  )
}

const slopeAt = (source: TerrainSource, lon: number, lat: number, d = 10) => {
  const dLon = d / (111_320 * Math.cos((lat * Math.PI) / 180)),
    dLat = d / 110_574
  const e = source.elevationAt(lon + dLon, lat),
    w = source.elevationAt(lon - dLon, lat),
    n = source.elevationAt(lon, lat + dLat),
    s = source.elevationAt(lon, lat - dLat)
  return [e, w, n, s].every(Number.isFinite) ? Math.hypot((e - w) / (2 * d), (n - s) / (2 * d)) * 100 : NaN
}

// --- Canopy sources -------------------------------------------------------------------------------------------
const open = (url: string) => fromUrl(url, { allowFullFile: false, blockSize: 65_536, cacheSize: 256 }) as never
let tRead = Date.now()
const chm: CanopyGrid = await readMetaChm(box, open, { maxPixels: 200_000_000 })
const chmSeconds = (Date.now() - tRead) / 1000
log('CHM v2', chm.width, '×', chm.height, 'cells of', chm.cellM.toFixed(2), 'm in', chmSeconds, 's')
tRead = Date.now()
const scanfiLayers: [ScanfiLayer, 2025 | 2020 | 2015 | 2010][] = [
  ['height', 2025],
  ['closure', 2025],
  ['biomass', 2025],
  ['landcover', 2025],
  ['age', 2025],
  ['height', 2015],
  ['height', 2020],
  ['closure', 2015],
  ['lodgepolePine', 2025],
  ['otherConiferous', 2025],
  ['balsamFir', 2025],
  ['blackSpruce', 2025],
  ['broadleaf', 2025],
  ['douglasFir', 2025],
]
const scanfi = new Map<string, ScanfiGrid>()
// SCANFI_CACHE=<dir> keeps the windows between runs (each layer is a separate 3 GB file read by range).
const cacheDir = process.env.SCANFI_CACHE
for (const [layer, year] of scanfiLayers) {
  const cached = cacheDir
    ? path.join(cacheDir, `scanfi-${layer}-${year}-${box.map((v) => v.toFixed(4)).join('_')}.json`)
    : undefined
  let grid: ScanfiGrid | undefined
  if (cached)
    try {
      const raw = JSON.parse(await readFile(cached, 'utf8'))
      grid = { ...raw, data: Float32Array.from(raw.data, (v: number | null) => (v === null ? NaN : v)) }
    } catch {
      grid = undefined
    }
  if (!grid) {
    grid = await readScanfi(layer, year, box, open)
    if (cached)
      await writeFile(
        cached,
        JSON.stringify({ ...grid, data: Array.from(grid.data, (v) => (Number.isNaN(v) ? null : v)) }),
      )
  }
  scanfi.set(`${layer}${year}`, grid)
}
const scanfiSeconds = (Date.now() - tRead) / 1000
log('SCANFI', scanfiLayers.length, 'layers in', scanfiSeconds, 's')
const S = (key: string, lon: number, lat: number) => scanfiAt(scanfi.get(key)!, lon, lat)
const vri = await fetchVegetationStands(box, { maxFeatures: 2000 })
log('VRI', vri.stands.length, 'stands', vri.truncated ? '(truncated)' : '')
const standAt = (lon: number, lat: number): VriStand | undefined =>
  vri.stands.find((s) => pointInRings(ringsOf(s.geometry), lon, lat))

// Company canopy sheet: exact drawn/undrawn split; class exact (lossless) or estimated (JPEG).
const sheetCells = canopySheet ? decodeCells(canopySheet) : undefined
const sheetInverse = canopySheet ? invertMatrix(canopySheet.transform) : undefined
function sheetAt(lon: number, lat: number) {
  if (!canopySheet || !sheetCells) return null
  const xy = applyMatrix(sheetInverse!, gridProjection(canopySheet).forward([lon, lat]) as XY)
  const c = Math.floor(xy[0]),
    r = Math.floor(xy[1])
  if (c < 0 || r < 0 || c >= canopySheet.width || r >= canopySheet.height) return null
  const code = sheetCells[r * canopySheet.width + c]
  if (code === 0 && canopySheet.undrawn) return { drawn: false, cls: -1, exact: true }
  if (knownClass(code, canopySheet)) return { drawn: true, cls: code - 1, exact: true }
  if (estimatedClass(code, canopySheet)) return { drawn: true, cls: code - 65, exact: false }
  if ([240, 241, 243].includes(code)) return { drawn: true, cls: null, exact: false }
  return null
}
const sheetClassOf = (h: number) => {
  if (!canopySheet) return null
  const lowest = Math.min(...canopySheet.legend.map((c) => c.minimum))
  if (h < lowest) return -1
  return canopySheet.legend.findIndex((c) => h >= c.minimum && (c.maximum === null || h < c.maximum))
}

// --- A. Terrain against ICESat-2 ground photons ----------------------------------------------------------------
type Ice = {
  photonDates: string[]
  photons: [number, number, number, number, number, number][]
  segments: Record<string, unknown>[]
}
const ice: Ice | undefined = flag('icesat2') ? JSON.parse(await readFile(flag('icesat2')!, 'utf8')) : undefined
let terrainCheck: unknown = null,
  laserCanopy: unknown = null
if (ice) {
  const ground: GroundPoint[] = ice.photons
    .filter((p) => p[3] === 1)
    .map(([lon, lat, h, , d, spot]) => ({ lon, lat, h, group: `${ice.photonDates[d]} spot ${spot}` }))
  const slope = (lon: number, lat: number) => slopeAt(regional.source, lon, lat)
  const regionalBins = groundCheck(ground, (lon, lat) => regional.source.elevationAt(lon, lat), { slopeAt: slope })
  const contourBins = contours
    ? groundCheck(ground, (lon, lat) => contours!.source.elevationAt(lon, lat), { slopeAt: slope })
    : []
  // Same bins for both terrains, so the comparison is like for like.
  const key = (b: { lon: number; lat: number; group: string }) => `${b.group}|${b.lon.toFixed(6)}|${b.lat.toFixed(6)}`
  const inContours = new Set(contourBins.map(key))
  const both = regionalBins.filter((b) => inContours.has(key(b)))
  terrainCheck = {
    groundPhotons: ground.length,
    passes: [...new Set(ground.map((g) => g.group.split(' ')[0]))],
    regionalAll: groundCheckSummary(regionalBins),
    regionalWhereContours: groundCheckSummary(both),
    contours: contours ? groundCheckSummary(contourBins) : null,
    contourMinusRegionalAtSameBins: differenceStats(
      contourBins.flatMap((c) => {
        const r = regionalBins.find((b) => key(b) === key(c))
        return r ? [c.terrain - r.terrain] : []
      }),
    ),
    // Inside canopy the ground photons are fewer and the classifier less sure: split by the CHM.
    regionalByCanopy: [
      ['open (CHM < 5 m)', (h: number) => h < 5],
      ['forest (CHM ≥ 5 m)', (h: number) => h >= 5],
    ].map(([label, test]) => ({
      label,
      stats: differenceStats(
        regionalBins
          .filter((b) => (test as (h: number) => boolean)(quantile(canopyWithin(chm, b.lon, b.lat, 10), 0.5)))
          .map((b) => b.difference),
      ),
    })),
    contoursByCanopy: contours
      ? [
          ['open (CHM < 5 m)', (h: number) => h < 5],
          ['forest (CHM ≥ 5 m)', (h: number) => h >= 5],
        ].map(([label, test]) => ({
          label,
          stats: differenceStats(
            contourBins
              .filter((b) => (test as (h: number) => boolean)(quantile(canopyWithin(chm, b.lon, b.lat, 10), 0.5)))
              .map((b) => b.difference),
          ),
        }))
      : null,
  }
  log('terrain check done')

  // --- B. Canopy height from photons (20 m bins): RH98 of canopy photons above the ground under each ----------
  // Each canopy photon is measured from the median ground photon within 6 m of it on its own beam, never from
  // a bin's median ground: on a 60 % slope a 20 m bin spans 12 m of terrain, which a bin median reads as canopy.
  const byGroup = new Map<string, { lon: number; lat: number; h: number; cls: number }[]>()
  for (const [lon, lat, h, cls, d, spot] of ice.photons) {
    const group = `${ice.photonDates[d]} spot ${spot}`
    let list = byGroup.get(group)
    if (!list) byGroup.set(group, (list = []))
    list.push({ lon, lat, h, cls })
  }
  const bins = new Map<string, { lon: number; lat: number; n: number; g: number; c: number[]; group: string }>()
  for (const [group, list] of byGroup) {
    const groundPh = list.filter((p) => p.cls === 1).sort((a, b) => a.lat - b.lat)
    const lats = groundPh.map((p) => p.lat)
    const lowerBound = (x: number) => {
      let lo = 0,
        hi = lats.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (lats[mid] < x) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    const groundUnder = (p: { lon: number; lat: number }) => {
      const near: number[] = []
      const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180)
      for (
        let i = lowerBound(p.lat - 6 / 110_574);
        i < groundPh.length && groundPh[i].lat <= p.lat + 6 / 110_574;
        i++
      ) {
        const g = groundPh[i]
        if (Math.hypot((g.lon - p.lon) * kx, (g.lat - p.lat) * 110_574) <= 6) near.push(g.h)
      }
      return near.length >= 3 ? quantile(near, 0.5) : NaN
    }
    for (const p of list) {
      const k = `${group}|${Math.floor((p.lon * BIN_KX) / 20)}|${Math.floor((p.lat * 110_574) / 20)}`
      let b = bins.get(k)
      if (!b) bins.set(k, (b = { lon: 0, lat: 0, n: 0, g: 0, c: [], group }))
      b.lon += p.lon
      b.lat += p.lat
      b.n++
      if (p.cls === 1) b.g++
      else {
        const g = groundUnder(p)
        if (Number.isFinite(g)) b.c.push(p.h - g)
      }
    }
  }
  const rows = [...bins.values()].flatMap((b) => {
    if (b.g < 5) return []
    const lon = b.lon / b.n,
      lat = b.lat / b.n
    const rel = b.c.filter((h) => h > 0)
    const laser = rel.length >= 5 ? quantile(rel, 0.98) : 0
    const chmCells = canopyWithin(chm, lon, lat, 10)
    const st = standAt(lon, lat)
    let shDrawn = 0,
      shSeen = 0
    for (let dy = -10; dy <= 10; dy += 2)
      for (let dx = -10; dx <= 10; dx += 2) {
        if (dx * dx + dy * dy > 100) continue
        const q = sheetAt(lon + dx / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + dy / 110_574)
        if (!q) continue
        shSeen++
        if (q.drawn) shDrawn++
      }
    const sh = shSeen >= 20 ? { drawn: shDrawn / shSeen >= 0.1, cls: null, exact: null } : null
    return [
      {
        lon,
        lat,
        group: b.group,
        ground: b.g,
        canopyPhotons: b.c.length,
        laserRh98: laser,
        chmP98: chmCells.length ? quantile(chmCells, 0.98) : NaN,
        scanfiHeight: S('height2025', lon, lat),
        vriHeight: st?.heightMeters ?? null,
        sheetDrawn: sh?.drawn ?? null,
        sheetClass: sh?.cls ?? null,
        sheetExact: sh?.exact ?? null,
      },
    ]
  })
  const forested = rows.filter((r) => r.laserRh98 >= 5 && r.canopyPhotons >= 10)
  const cmp = (name: string, pick: (r: (typeof rows)[number]) => number | null) => {
    const pairs = forested.flatMap((r) => {
      const v = pick(r)
      return v === null || !Number.isFinite(v) ? [] : [[v, r.laserRh98] as const]
    })
    return {
      source: name,
      bins: pairs.length,
      bias: differenceStats(pairs.map(([v, l]) => v - l)),
      r: round(
        pearson(
          pairs.map((p) => p[0]),
          pairs.map((p) => p[1]),
        ),
        3,
      ),
    }
  }
  const openLaser = rows.filter((r) => r.laserRh98 < 2 && r.ground >= 20)
  laserCanopy = {
    bins: rows.length,
    forestedBins: forested.length,
    note: 'ICESat-2 RH98 of canopy photons above the bin median ground, 20 m bins, snow-free passes',
    againstLaser: [
      cmp('Meta CHM v2 p98 (10 m radius)', (r) => r.chmP98),
      cmp('SCANFI 2025 height', (r) => r.scanfiHeight),
      cmp('VRI projected height (leading species)', (r) => r.vriHeight),
    ],
    openByLaser: {
      bins: openLaser.length,
      chmMedianP98: round(quantile(openLaser.map((r) => r.chmP98).filter(Number.isFinite), 0.5), 1),
      chmP98AtLeast5: openLaser.filter((r) => r.chmP98 >= 5).length,
    },
    sheetAgreement: canopySheet
      ? (() => {
          const withSheet = rows.filter((r) => r.sheetDrawn !== null && r.canopyPhotons + r.ground >= 20)
          return {
            bins: withSheet.length,
            laserTallAndSheetDrawn: withSheet.filter((r) => r.laserRh98 >= 5 && r.sheetDrawn).length,
            laserTallSheetNot: withSheet.filter((r) => r.laserRh98 >= 5 && !r.sheetDrawn).length,
            laserLowSheetDrawn: withSheet.filter((r) => r.laserRh98 < 5 && r.sheetDrawn).length,
            laserLowSheetNot: withSheet.filter((r) => r.laserRh98 < 5 && !r.sheetDrawn).length,
          }
        })()
      : null,
  }
  log('laser canopy done')
}

// --- C. Meta CHM v2 against the company's LiDAR canopy sheet ---------------------------------------------------
let sheetVsChm: unknown = null
if (canopySheet && sheetCells) {
  const proj = gridProjection(canopySheet)
  const cellSize = Math.hypot(canopySheet.transform[0], canopySheet.transform[1])
  const step = Math.max(1, Math.round(Math.sqrt((canopySheet.width * canopySheet.height) / 400_000)))
  const n = canopySheet.legend.length
  const confusion = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0)) // [sheet][chm], index 0 = undrawn
  const estimatedShares = { sheet: new Array(n + 1).fill(0), chm: new Array(n + 1).fill(0) }
  let drawnAgree = 0,
    drawnTotal = 0
  const drawnTable = { sheetDrawnChmTall: 0, sheetDrawnChmLow: 0, sheetUndrawnChmTall: 0, sheetUndrawnChmLow: 0 }
  for (let r = 0; r < canopySheet.height; r += step)
    for (let c = 0; c < canopySheet.width; c += step) {
      const code = sheetCells[r * canopySheet.width + c]
      const xy = applyMatrix(canopySheet.transform, [c + 0.5, r + 0.5])
      const [lon, lat] = proj.inverse(xy) as XY
      const cells = canopyWithin(chm, lon, lat, Math.max(1, cellSize / 2))
      if (!cells.length) continue
      const h = quantile(cells, 0.5)
      const chmClass = sheetClassOf(h)! + 1
      const drawn =
        code === 0
          ? false
          : knownClass(code, canopySheet) || estimatedClass(code, canopySheet) || [240, 241, 243].includes(code)
            ? true
            : null
      if (drawn === null || (code === 0 && !canopySheet.undrawn)) continue
      drawnTotal++
      if (h >= 5 === drawn) drawnAgree++
      drawnTable[
        drawn
          ? h >= 5
            ? 'sheetDrawnChmTall'
            : 'sheetDrawnChmLow'
          : h >= 5
            ? 'sheetUndrawnChmTall'
            : 'sheetUndrawnChmLow'
      ]++
      if (code === 0) confusion[0][chmClass]++
      else if (knownClass(code, canopySheet)) confusion[code][chmClass]++
      else if (estimatedClass(code, canopySheet)) {
        estimatedShares.sheet[code - 64]++
        estimatedShares.chm[chmClass]++
      }
    }
  const exactRows = confusion.map((row) => row.reduce((s, v) => s + v, 0))
  sheetVsChm = {
    sheetCellM: round(cellSize, 2),
    sampledEvery: step,
    legend: ['undrawn', ...canopySheet.legend.map((l) => l.label)],
    drawnSplit: { cells: drawnTotal, agreementPercent: round((100 * drawnAgree) / drawnTotal, 1), ...drawnTable },
    exactConfusion: confusion,
    exactClassAgreementPercent: round(
      (100 * confusion.reduce((s, row, i) => s + row[i], 0)) / exactRows.reduce((s, v) => s + v, 0),
      1,
    ),
    exactWithinOneClassPercent: round(
      (100 * confusion.reduce((s, row, i) => s + row.reduce((t, v, j) => t + (Math.abs(i - j) <= 1 ? v : 0), 0), 0)) /
        exactRows.reduce((s, v) => s + v, 0),
      1,
    ),
    estimatedAreaShares: {
      sheet: estimatedShares.sheet.map((v) =>
        round(
          (100 * v) /
            Math.max(
              1,
              estimatedShares.sheet.reduce((s, x) => s + x, 0),
            ),
          1,
        ),
      ),
      chm: estimatedShares.chm.map((v) =>
        round(
          (100 * v) /
            Math.max(
              1,
              estimatedShares.chm.reduce((s, x) => s + x, 0),
            ),
          1,
        ),
      ),
    },
  }
  // At 20 m the crown-gap texture averages out: cover share and the top class are what a block of road clears.
  const block = Math.max(2, Math.round(20 / cellSize))
  const rows: { sheetCover: number; chmCover: number; sheetTop: number; chmTop: number; exact: boolean }[] = []
  const classMid = (i: number) => {
    const c = canopySheet.legend[i]
    return c.maximum === null ? c.minimum + 2.5 : (c.minimum + c.maximum) / 2
  }
  for (let r0 = 0; r0 + block <= canopySheet.height; r0 += block)
    for (let c0 = 0; c0 + block <= canopySheet.width; c0 += block) {
      let drawn = 0,
        known = 0,
        allExact = true
      const tops: number[] = [],
        chmH: number[] = []
      for (let r = r0; r < r0 + block; r++)
        for (let c = c0; c < c0 + block; c++) {
          const code = sheetCells[r * canopySheet.width + c]
          const isUndrawn = code === 0,
            isExact = knownClass(code, canopySheet),
            isEst = estimatedClass(code, canopySheet)
          if (!isUndrawn && !isExact && !isEst && ![240, 241, 243].includes(code)) continue
          known++
          if (!isUndrawn) drawn++
          if (isEst || [240, 241, 243].includes(code)) allExact = false
          tops.push(isUndrawn ? 0 : isExact ? classMid(code - 1) : isEst ? classMid(code - 65) : 5)
          if ((r - r0) % 2 === 0 && (c - c0) % 2 === 0) {
            const [lon, lat] = proj.inverse(applyMatrix(canopySheet.transform, [c + 0.5, r + 0.5])) as XY
            const h = canopyAt(chm, lon, lat)
            if (Number.isFinite(h)) chmH.push(h)
          }
        }
      if (known < block * block * 0.9 || chmH.length < 20) continue
      rows.push({
        sheetCover: drawn / known,
        chmCover: chmH.filter((h) => h >= 5).length / chmH.length,
        sheetTop: quantile(tops, 0.95),
        chmTop: quantile(chmH, 0.95),
        exact: allExact,
      })
    }
  const treed = rows.filter((r) => r.sheetTop >= 10)
  const exactTreed = treed.filter((r) => r.exact)
  ;(sheetVsChm as Record<string, unknown>).blocks20m = {
    blockM: round(block * cellSize, 1),
    blocks: rows.length,
    cover: {
      sheetMeanPercent: round((100 * rows.reduce((t, r) => t + r.sheetCover, 0)) / rows.length, 1),
      chmMeanPercent: round((100 * rows.reduce((t, r) => t + r.chmCover, 0)) / rows.length, 1),
      r: round(
        pearson(
          rows.map((r) => r.chmCover),
          rows.map((r) => r.sheetCover),
        ),
        3,
      ),
      sheetOpen: rows.filter((r) => r.sheetCover < 0.1).length,
      chmAlsoOpen: rows.filter((r) => r.sheetCover < 0.1 && r.chmCover < 0.1).length,
      sheetClosed: rows.filter((r) => r.sheetCover >= 0.5).length,
      chmAlsoClosed: rows.filter((r) => r.sheetCover >= 0.5 && r.chmCover >= 0.5).length,
    },
    // The sheet prints 5 m classes: its "p95" is a class midpoint, so differences carry ±2.5 m of class width.
    topHeightTreed: {
      blocks: treed.length,
      chmMinusSheet: differenceStats(treed.map((r) => r.chmTop - r.sheetTop)),
      r: round(
        pearson(
          treed.map((r) => r.chmTop),
          treed.map((r) => r.sheetTop),
        ),
        3,
      ),
    },
    topHeightTreedExactTiles: {
      blocks: exactTreed.length,
      chmMinusSheet: differenceStats(exactTreed.map((r) => r.chmTop - r.sheetTop)),
    },
    // The fit from the PG LiDAR tile (CHM_FIT=slope,intercept), carried here unchanged as a transfer test.
    calibratedFromPgTile: process.env.CHM_FIT
      ? (() => {
          const [slope, intercept] = process.env.CHM_FIT!.split(',').map(Number)
          return {
            slope,
            intercept,
            chmMinusSheet: differenceStats(treed.map((r) => intercept + slope * r.chmTop - r.sheetTop)),
          }
        })()
      : null,
  }
  log('sheet vs CHM done')
}

// --- D. SCANFI and VRI against the CHM and the sheet, at SCANFI's 30 m -------------------------------------------
const h25 = scanfi.get('height2025')!
const scanfiRows: {
  scanfi: number
  closure: number
  chmMean: number
  chmP90: number
  chmCover5: number
  sheetDrawn: number | null
  lc: number
}[] = []
for (let r = 0; r < h25.height; r++)
  for (let c = 0; c < h25.width; c++) {
    const [lon, lat] = scanfiCellCentre(h25, c, r)
    if (lon < bounds[0] || lon > bounds[2] || lat < bounds[1] || lat > bounds[3]) continue
    const cells = canopyWithin(chm, lon, lat, 15)
    if (cells.length < 100) continue
    let drawn = 0,
      seen = 0
    if (canopySheet)
      for (let k = 0; k < 25; k++) {
        const dx = ((k % 5) - 2) * 6,
          dy = (Math.floor(k / 5) - 2) * 6
        const s = sheetAt(lon + dx / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + dy / 110_574)
        if (s) {
          seen++
          if (s.drawn) drawn++
        }
      }
    scanfiRows.push({
      scanfi: h25.data[r * h25.width + c],
      closure: S('closure2025', lon, lat),
      lc: S('landcover2025', lon, lat),
      chmMean: cells.reduce((s, v) => s + v, 0) / cells.length,
      chmP90: quantile(cells, 0.9),
      chmCover5: cells.filter((v) => v >= 5).length / cells.length,
      sheetDrawn: seen >= 20 ? drawn / seen : null,
    })
  }
const valid = scanfiRows.filter((r) => Number.isFinite(r.scanfi))
const scanfiVsChm = {
  cells: valid.length,
  landcover: Object.fromEntries(
    Object.entries(SCANFI_LANDCOVER).map(([code, label]) => [label, valid.filter((r) => r.lc === Number(code)).length]),
  ),
  heightVsChmMean: {
    bias: differenceStats(valid.map((r) => r.scanfi - r.chmMean)),
    r: round(
      pearson(
        valid.map((r) => r.scanfi),
        valid.map((r) => r.chmMean),
      ),
      3,
    ),
  },
  heightVsChmP90: {
    bias: differenceStats(valid.map((r) => r.scanfi - r.chmP90)),
    r: round(
      pearson(
        valid.map((r) => r.scanfi),
        valid.map((r) => r.chmP90),
      ),
      3,
    ),
  },
  closureVsChmCover5: {
    bias: differenceStats(valid.filter((r) => Number.isFinite(r.closure)).map((r) => r.closure - 100 * r.chmCover5)),
    r: round(
      pearson(
        valid.filter((r) => Number.isFinite(r.closure)).map((r) => r.closure),
        valid.filter((r) => Number.isFinite(r.closure)).map((r) => r.chmCover5),
      ),
      3,
    ),
  },
  againstSheetDrawnShare: canopySheet
    ? (() => {
        const s = valid.filter((r) => r.sheetDrawn !== null)
        return {
          cells: s.length,
          sheetDrawnMeanPercent: round((100 * s.reduce((t, r) => t + r.sheetDrawn!, 0)) / s.length, 1),
          chmCover5MeanPercent: round((100 * s.reduce((t, r) => t + r.chmCover5, 0)) / s.length, 1),
          scanfiClosureMeanPercent: round(
            s.filter((r) => Number.isFinite(r.closure)).reduce((t, r) => t + r.closure, 0) /
              s.filter((r) => Number.isFinite(r.closure)).length,
            1,
          ),
          rChmCover: round(
            pearson(
              s.map((r) => r.chmCover5),
              s.map((r) => r.sheetDrawn!),
            ),
            3,
          ),
          rScanfiClosure: round(
            pearson(
              s.filter((r) => Number.isFinite(r.closure)).map((r) => r.closure),
              s.filter((r) => Number.isFinite(r.closure)).map((r) => r.sheetDrawn!),
            ),
            3,
          ),
          rScanfiHeight: round(
            pearson(
              s.map((r) => r.scanfi),
              s.map((r) => r.sheetDrawn!),
            ),
            3,
          ),
          // Open by the sheet (under a tenth drawn) but treed by the other source.
          sheetOpenChmTreed: s.filter((r) => r.sheetDrawn! < 0.1 && r.chmCover5 >= 0.5).length,
          sheetOpenScanfiTreed: s.filter((r) => r.sheetDrawn! < 0.1 && r.scanfi >= 10).length,
          sheetOpen: s.filter((r) => r.sheetDrawn! < 0.1).length,
        }
      })()
    : null,
}
log('SCANFI vs CHM done')

// VRI polygons: inventory height against the CHM and SCANFI over the same polygon.
const vriVs = vri.stands
  .filter((s) => s.treed && s.heightMeters !== null)
  .flatMap((s) => {
    const rings = ringsOf(s.geometry)
    const xs = rings[0].map((p) => p[0]),
      ys = rings[0].map((p) => p[1])
    const [w, so, e, n] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    if (w < box[0] || e > box[2] || so < box[1] || n > box[3]) return []
    const chmIn: number[] = [],
      scanfiIn: number[] = []
    for (let lat = so; lat <= n; lat += 15 / 110_574)
      for (let lon = w; lon <= e; lon += 15 / (111_320 * Math.cos((lat * Math.PI) / 180)))
        if (pointInRings(rings, lon, lat)) {
          const h = canopyAt(chm, lon, lat)
          if (Number.isFinite(h)) chmIn.push(h)
          const sc = S('height2025', lon, lat)
          if (Number.isFinite(sc)) scanfiIn.push(sc)
        }
    if (chmIn.length < 20) return []
    return [
      {
        vri: s.heightMeters!,
        cc: s.crownClosurePercent,
        age: s.ageYears,
        chmP90: quantile(chmIn, 0.9),
        chmMean: chmIn.reduce((a, b) => a + b, 0) / chmIn.length,
        scanfi: scanfiIn.length ? quantile(scanfiIn, 0.5) : NaN,
        samples: chmIn.length,
      },
    ]
  })
const vriVsOthers = {
  polygons: vriVs.length,
  chmP90MinusVri: differenceStats(vriVs.map((v) => v.chmP90 - v.vri)),
  scanfiMinusVri: differenceStats(vriVs.filter((v) => Number.isFinite(v.scanfi)).map((v) => v.scanfi - v.vri)),
  rChmP90: round(
    pearson(
      vriVs.map((v) => v.chmP90),
      vriVs.map((v) => v.vri),
    ),
    3,
  ),
  rScanfi: round(
    pearson(
      vriVs.filter((v) => Number.isFinite(v.scanfi)).map((v) => v.scanfi),
      vriVs.filter((v) => Number.isFinite(v.scanfi)).map((v) => v.vri),
    ),
    3,
  ),
}

// --- E. Existing openings and the planned block: which source sees the clearing ---------------------------------
const polys = [
  ...(project.reference ?? [])
    .filter((f) => f.geometry.type === 'Polygon')
    .map((f) => ({ name: f.name, geometry: f.geometry })),
  ...project.context
    .filter((f) => f.geometry.type === 'Polygon')
    .map((f) => ({ name: `${f.name} (${f.kind})`, geometry: f.geometry })),
]
const openings = polys.map((p) => {
  const rings = (p.geometry as GeoJSON.Polygon).coordinates as [number, number][][]
  const xs = rings[0].map((q) => q[0]),
    ys = rings[0].map((q) => q[1])
  const acc = {
    n: 0,
    chm: [] as number[],
    sheetDrawn: 0,
    sheetSeen: 0,
    scanfiH25: [] as number[],
    scanfiH15: [] as number[],
    age: [] as number[],
    vriH: [] as number[],
  }
  for (let lat = Math.min(...ys); lat <= Math.max(...ys); lat += 10 / 110_574)
    for (let lon = Math.min(...xs); lon <= Math.max(...xs); lon += 10 / (111_320 * Math.cos((lat * Math.PI) / 180))) {
      if (!pointInRings(rings, lon, lat)) continue
      acc.n++
      const h = canopyAt(chm, lon, lat)
      if (Number.isFinite(h)) acc.chm.push(h)
      const s = sheetAt(lon, lat)
      if (s) {
        acc.sheetSeen++
        if (s.drawn) acc.sheetDrawn++
      }
      for (const [k, arr] of [
        ['height2025', acc.scanfiH25],
        ['height2015', acc.scanfiH15],
        ['age2025', acc.age],
      ] as const) {
        const v = S(k, lon, lat)
        if (Number.isFinite(v)) arr.push(v)
      }
      const st = standAt(lon, lat)
      if (st?.heightMeters != null) acc.vriH.push(st.heightMeters)
    }
  return {
    name: p.name,
    areaHa: round((acc.n * 100) / 10_000, 1),
    chmCover5Percent: acc.chm.length ? round((100 * acc.chm.filter((v) => v >= 5).length) / acc.chm.length, 1) : null,
    chmMedianM: acc.chm.length ? quantile(acc.chm, 0.5) : null,
    sheetDrawnPercent: acc.sheetSeen ? round((100 * acc.sheetDrawn) / acc.sheetSeen, 1) : null,
    scanfiHeight2015: acc.scanfiH15.length ? quantile(acc.scanfiH15, 0.5) : null,
    scanfiHeight2025: acc.scanfiH25.length ? quantile(acc.scanfiH25, 0.5) : null,
    scanfiAge2025: acc.age.length ? quantile(acc.age, 0.5) : null,
    vriHeightMedian: acc.vriH.length ? quantile(acc.vriH, 0.5) : null,
  }
})
log('openings done')

// --- F. Along each road: what the clearing takes and what stands beside it --------------------------------------
const roads = project.alignments.map((alignment) => {
  const a = safeAnalyzeRoad(alignment, regional.source, project.settings, project.context)
  const stations = a.stations.map((s) => ({
    chainage: s.chainage,
    coordinate: s.coordinate as [number, number],
    bearing: s.bearing,
    leftClearingM: s.leftClearingM,
    rightClearingM: s.rightClearingM,
  }))
  const chmCorridor = corridorCanopy(stations, (lon, lat) => canopyAt(chm, lon, lat), { stepM: 0.7 })
  const sheetHeight = (lon: number, lat: number) => {
    const s = sheetAt(lon, lat)
    if (!s || !canopySheet) return NaN
    if (!s.drawn) return 0
    if (s.cls === null) return 5
    const c = canopySheet.legend[s.cls]
    return c.maximum === null ? c.minimum : (c.minimum + c.maximum) / 2
  }
  const sheetCorridor = canopySheet ? corridorCanopy(stations, sheetHeight, { stepM: 1 }) : null
  const clearingHa = a.stations.reduce(
    (t, s, i) => t + (i ? ((s.clearingWidthM ?? 20) * (s.chainage - a.stations[i - 1].chainage)) / 10_000 : 0),
    0,
  )
  const along = (pick: (lon: number, lat: number) => number) => {
    const v = stations.map((s) => pick(...s.coordinate)).filter(Number.isFinite)
    return v.length ? round(v.reduce((t, x) => t + x, 0) / v.length, 1) : null
  }
  const share = (rows: { clearingTimberShare: number | null }[]) => {
    const v = rows.flatMap((r) => (r.clearingTimberShare === null ? [] : [r.clearingTimberShare]))
    return v.length ? round((100 * v.reduce((t, x) => t + x, 0)) / v.length, 1) : null
  }
  const biomassT = clearingHa * (along((lon, lat) => S('biomass2025', lon, lat)) ?? NaN)
  const stationsWithSheet = sheetCorridor ? sheetCorridor.filter((s) => s.clearingTimberShare !== null) : []
  const agreeTimber = sheetCorridor
    ? chmCorridor.filter(
        (c, i) =>
          c.clearingTimberShare !== null &&
          sheetCorridor[i].clearingTimberShare !== null &&
          c.clearingTimberShare >= 0.5 === sheetCorridor[i].clearingTimberShare! >= 0.5,
      ).length
    : null
  return {
    road: alignment.name,
    lengthM: Math.round(a.length),
    stations: a.stations.length,
    clearingHa: round(clearingHa, 2),
    chm: {
      clearingTimberPercent: share(chmCorridor),
      stationsWithReachingTrees: chmCorridor.filter((c) => c.tallestReaching).length,
      tallestReachingM: Math.max(0, ...chmCorridor.map((c) => c.tallestReaching?.heightM ?? 0)),
      gapRuns: gapRuns(chmCorridor, 30),
      centreMedianM: round(
        quantile(
          chmCorridor.flatMap((c) => (c.centreM === null ? [] : [c.centreM])),
          0.5,
        ),
        1,
      ),
    },
    sheet: sheetCorridor
      ? {
          clearingTimberPercent: share(sheetCorridor),
          gapRuns: gapRuns(sheetCorridor, 30),
          stationsCompared: stationsWithSheet.length,
          chmAgreesOnTimberStations: agreeTimber,
        }
      : null,
    scanfi: {
      meanHeightM: along((lon, lat) => S('height2025', lon, lat)),
      meanClosurePercent: along((lon, lat) => S('closure2025', lon, lat)),
      meanBiomassTPerHa: along((lon, lat) => S('biomass2025', lon, lat)),
      clearingBiomassT: Number.isFinite(biomassT) ? Math.round(biomassT) : null,
      meanAgeYears: along((lon, lat) => S('age2025', lon, lat)),
      lodgepolePinePercent: along((lon, lat) => S('lodgepolePine2025', lon, lat)),
    },
    vri: {
      meanHeightM: along((lon, lat) => standAt(lon, lat)?.heightMeters ?? NaN),
      meanCrownClosure: along((lon, lat) => standAt(lon, lat)?.crownClosurePercent ?? NaN),
      leadingSpecies: Object.entries(
        stations.reduce<Record<string, number>>((m, s) => {
          const sp = standAt(...s.coordinate)?.speciesCode ?? 'none'
          m[sp] = (m[sp] ?? 0) + 1
          return m
        }, {}),
      ).sort((x, y) => y[1] - x[1]),
    },
  }
})
log('roads done')

// --- G. GEDI ----------------------------------------------------------------------------------------------------
const gedi = flag('gedi') ? JSON.parse(await readFile(flag('gedi')!, 'utf8')) : null

const chmCentre = mercatorPixel((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, chm.zoom)
const result = {
  generated: new Date().toISOString(),
  box,
  readTimes: { chmSeconds, scanfiSeconds },
  chm: {
    cells: chm.width * chm.height,
    cellM: round(chm.cellM, 2),
    sources: chm.sources,
    centrePixel: chmCentre.map(Math.round),
  },
  terrains: { regional: regional.metadata.name, contours: contours?.name ?? null },
  terrainCheck,
  laserCanopy,
  sheetVsChm,
  scanfiVsChm,
  vriVsOthers,
  openings,
  roads,
  gedi,
}
await writeFile(output, JSON.stringify(result, null, 2))
log('wrote', output)
