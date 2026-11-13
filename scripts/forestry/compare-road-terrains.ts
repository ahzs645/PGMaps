/**
 * Local, read-only comparison of a road project's own terrain with terrain built from a company
 * field sheet's contours, road by road, through the same engine the app uses. A slope sheet of the
 * same block, when given, is the independent reference: each station's terrain slope is read in
 * the sheet's ranges and compared with the range the sheet prints there. Writes only to `output`.
 *
 * node --use-env-proxy --import tsx scripts/forestry/compare-road-terrains.ts \
 *   project.road.json Field_Layout.pdf [Slope_Map.pdf] /tmp/road-terrains.json
 *
 * The regional DEM is fetched like the app does (public Terrarium tiles); fast-png only stands in
 * for the browser's canvas decoder. The contour surface's vertical datum is not printed on the
 * sheet: elevation offsets between the two terrains include any datum difference.
 */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { decode } from 'fast-png'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import { decodeTerrariumElevation, DEM_TILE_SIZE } from '../../src/pages/dev-forestry/terrain'
import { readGeoPdf } from '../../src/lib/geoPdf/read'
import { estimatedClass, knownClass, parseClassGrid, sampleClass } from '../../src/lib/geoPdf/classGrid'
import { parseProject } from '../../src/pages/dev-forestry-roads/project'
import { loadRegionalTerrain, rasterSource, validateRoadRaster } from '../../src/pages/dev-forestry-roads/terrain'
import { safeAnalyzeRoad } from '../../src/pages/dev-forestry-roads/analysisResult'
import { contourTerrain } from '../../src/pages/dev-forestry-roads/contourTerrain'
import { slopeRangeIndex } from '../../src/pages/dev-forestry-roads/terrainSlopeClasses'
import type { RoadAnalysis, TerrainSource } from '../../src/pages/dev-forestry-roads/types'

const args = process.argv.slice(2)
if (args.length < 3)
  throw Error('Usage: compare-road-terrains.ts project.road.json field.pdf [slope.pdf] /tmp/out.json')
const [projectPath, fieldPath] = args,
  output = args.at(-1)!,
  slopePath = args.length > 3 ? args[2] : undefined
const project = parseProject(JSON.parse(await readFile(projectPath, 'utf8')))
const readPdf = async (p: string) =>
  readGeoPdf(new Uint8Array(await readFile(p)), path.basename(p), runtime as never, {
    maxFeatures: 500,
    maxVertices: 50_000,
    // CONTOUR_METHOD=nearest-contours builds the opt-in interpolation for comparison.
    contourMethod: process.env.CONTOUR_METHOD === 'nearest-contours' ? 'nearest-contours' : 'tin',
  })

async function projectTerrain(): Promise<{ name: string; source: TerrainSource }> {
  const t = project.terrain
  if (t.raster) return { name: t.name, source: rasterSource(validateRoadRaster(t.raster)) }
  if (t.kind === 'regional' && t.bounds) {
    const loaded = await loadRegionalTerrain(t.bounds, undefined, async (bytes) => {
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
    return { name: loaded.metadata.name, source: loaded.source }
  }
  throw Error(`This script cannot reload the project's ${t.kind} terrain outside the app.`)
}
const before = await projectTerrain()
const field = await readPdf(fieldPath)
const contourLayer = field.layers.find((l) => l.contourSurface)
if (!contourLayer) throw Error(`No contour surface in the field sheet: ${field.notices.join(' ')}`)
const contours = contourTerrain(contourLayer.contourSurface!, contourLayer.source, 'not stated on the sheet')
const slopeGrid = slopePath
  ? parseClassGrid((await readPdf(slopePath)).layers.find((l) => l.classGrid?.kind === 'slope')?.classGrid)
  : undefined

/** Steepest fall-line slope (%) at a point, from elevations 5 m either side east–west and north–south. */
function slopeAt(source: TerrainSource, [lon, lat]: [number, number]) {
  const dLon = 5 / (111_320 * Math.cos((lat * Math.PI) / 180)),
    dLat = 5 / 110_574
  const e = source.elevationAt(lon + dLon, lat),
    w = source.elevationAt(lon - dLon, lat),
    n = source.elevationAt(lon, lat + dLat),
    s = source.elevationAt(lon, lat - dLat)
  if (![e, w, n, s].every(Number.isFinite)) return NaN
  return Math.hypot((e - w) / 10, (n - s) / 10) * 100
}
const summary = (a: RoadAnalysis) => ({
  lengthM: Math.round(a.length),
  coveragePercent: Math.round(a.coveragePercent * 10) / 10,
  completeLengthM: Math.round(a.completeLength),
  incompleteStations: a.stations.filter((s) => !s.complete).length,
  maxDesignGradePercent: Math.round(a.maxGradePercent * 10) / 10,
  cutM3: Math.round(a.cutVolumeM3),
  fillM3: Math.round(a.fillVolumeM3),
  balanceM3: Math.round(a.balanceM3),
  estimatedCost: Math.round(a.estimatedCost),
  warnings: a.warnings.length,
})
const roads = project.alignments.map((alignment) => {
  const a = safeAnalyzeRoad(alignment, before.source, project.settings, project.context)
  const b = safeAnalyzeRoad(alignment, contours.source, project.settings, project.context)
  // Ground along the centreline at the same chainages (the alignment, not the terrain, sets them).
  const pairs = a.stations.flatMap((s, i) => {
    const t = b.stations[i]
    return t && Math.abs(t.chainage - s.chainage) < 1e-6 && s.groundElevation !== null && t.groundElevation !== null
      ? [{ chainage: s.chainage, before: s.groundElevation, contours: t.groundElevation, coordinate: s.coordinate }]
      : []
  })
  const diffs = pairs.map((p) => p.contours - p.before)
  const mean = diffs.reduce((s, d) => s + d, 0) / (diffs.length || 1)
  const grades = (stations: RoadAnalysis['stations']) =>
    stations
      .flatMap((s) => (s.groundGradePercent === null ? [] : [Math.abs(s.groundGradePercent)]))
      .sort((x, y) => x - y)
  const steepestGround = (stations: RoadAnalysis['stations']) => Math.max(0, ...grades(stations))
  const quantile = (stations: RoadAnalysis['stations'], q: number) => {
    const g = grades(stations)
    return g.length ? Math.round(g[Math.min(g.length - 1, Math.floor(q * g.length))] * 10) / 10 : null
  }
  // Station-to-station change in ground grade: a terraced surface flips between flats and steps.
  const roughness = (stations: RoadAnalysis['stations']) => {
    const g = stations.map((s) => s.groundGradePercent)
    const steps = g.flatMap((v, i) => (i && v !== null && g[i - 1] !== null ? [Math.abs(v - g[i - 1]!)] : []))
    return steps.length ? Math.round((steps.reduce((t, v) => t + v, 0) / steps.length) * 10) / 10 : null
  }
  // Station slope in the sheet's ranges, against the range the sheet prints there.
  let scored = 0,
    agreeBefore = 0,
    agreeContours = 0,
    exact = 0
  if (slopeGrid)
    for (const p of pairs) {
      const sheet = sampleClass(slopeGrid, p.coordinate)
      const sheetRange = knownClass(sheet.code, slopeGrid)
        ? sheet.code - 1
        : estimatedClass(sheet.code, slopeGrid)
          ? sheet.code - 65
          : sheet.code === 0 && slopeGrid.undrawn
            ? -1
            : null
      if (sheetRange === null) continue
      const x = slopeAt(before.source, p.coordinate),
        y = slopeAt(contours.source, p.coordinate)
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      scored++
      if (knownClass(sheet.code, slopeGrid) || sheet.code === 0) exact++
      // Within one printed range, as the sheet's own colours are read.
      if (Math.abs(slopeRangeIndex(slopeGrid.legend, x) - sheetRange) <= 1) agreeBefore++
      if (Math.abs(slopeRangeIndex(slopeGrid.legend, y) - sheetRange) <= 1) agreeContours++
    }
  return {
    road: alignment.name,
    projectTerrain: summary(a),
    contourTerrain: summary(b),
    ground: {
      stationsCompared: pairs.length,
      meanOffsetM: Math.round(mean * 100) / 100,
      offsetSpreadM:
        Math.round(Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (diffs.length || 1)) * 100) / 100,
      largestDifferenceM: Math.round(Math.max(0, ...diffs.map(Math.abs)) * 10) / 10,
      steepestGroundGradeProjectPercent: Math.round(steepestGround(a.stations) * 10) / 10,
      steepestGroundGradeContoursPercent: Math.round(steepestGround(b.stations) * 10) / 10,
      medianGroundGradeProjectPercent: quantile(a.stations, 0.5),
      medianGroundGradeContoursPercent: quantile(b.stations, 0.5),
      p90GroundGradeProjectPercent: quantile(a.stations, 0.9),
      p90GroundGradeContoursPercent: quantile(b.stations, 0.9),
      meanGradeChangeProjectPercent: roughness(a.stations),
      meanGradeChangeContoursPercent: roughness(b.stations),
    },
    slopeSheet: slopeGrid
      ? {
          stationsScored: scored,
          stationsWithExactSheetClass: exact,
          projectTerrainWithinOneRange: scored ? Math.round((agreeBefore / scored) * 1000) / 10 : null,
          contourTerrainWithinOneRange: scored ? Math.round((agreeContours / scored) * 1000) / 10 : null,
        }
      : null,
  }
})
const result = {
  projectTerrain: before.name,
  contourTerrain: contours.metadata.name,
  contourAssignment: contourLayer.contourSurface!.assignment,
  roads,
}
await writeFile(output, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
