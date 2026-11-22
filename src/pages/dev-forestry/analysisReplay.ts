/** Inputs consumed by the numerical sightline calculation. Figure rendering uses a separate camera and class raster. */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  DEM_TILE_SIZE,
  ElevationGrid,
  MAX_DEM_TILES,
  demTileCoordinates,
  type DemTileRange,
} from '@/lib/forestry/terrain/terrain'
import { decodeTerrariumTile, type loadElevationGrid } from '@/lib/forestry/terrain/demLoader'
import { rasterSampler } from '@/lib/forestry/terrain/localRaster'
import { computeAnalysis, type TerrainInfo, type AnalysisContext } from './analysis'
import type { CanopyStand } from './canopy'
import type { AnalysisInput, AnalysisResult } from './types'
import type { PolygonGeometry } from './visibility'
import { compareReplayFigures, SIGHTLINE_CALC_VERSION } from './replayComparison'

export type RunInputs = {
  input: AnalysisInput
  terrain: TerrainInfo
  range: DemTileRange | null
  canopy: CanopyStand[]
  forested: PolygonGeometry[]
  context: AnalysisContext
}
type RunRef = { rowId: string; viewId: string; landformId: string }
const format = 'pgmaps-sightline-inputs-v1'
const maxBytes = 200_000_000
const json = (value: unknown) => strToU8(JSON.stringify(value))
const figures = (r: AnalysisResult) => ({
  perspective: r.perspectiveByStation,
  plan: r.planimetricAlteration,
  station: r.assessmentStationIndex,
  sightlines: r.actualSightlineCount,
})
type ReplayFigures = ReturnType<typeof figures>

const tileName = (x: number, y: number) => 'dem/' + x + '-' + y + '.f32'
export async function retainRun(data: RunInputs, tiles: Map<string, Uint8Array>, result: AnalysisResult, ref: RunRef) {
  const entries = { 'inputs.json': json(data), ...Object.fromEntries(tiles) } as Record<string, Uint8Array>
  if (Object.values(entries).reduce((n, b) => n + b.length, 0) > maxBytes)
    throw Error('Retained inputs exceed 200 MB. Reduce the study extent.')
  const checksums: Record<string, string> = {}
  for (const [name, bytes] of Object.entries(entries)) checksums[name] = await digest(bytes)
  entries['manifest.json'] = json({
    format,
    ref,
    createdAt: new Date().toISOString(),
    calcVersion: SIGHTLINE_CALC_VERSION,
    expected: figures(result),
    checksums,
  })
  if (Object.values(entries).reduce((n, bytes) => n + bytes.length, 0) > maxBytes)
    throw Error('Retained inputs exceed 200 MB. Reduce the study extent.')
  const archive = new Blob([zipSync(entries, { level: 3 }) as BlobPart], { type: 'application/zip' })
  if (archive.size > maxBytes) throw Error('Run input archive exceeds 200 MB.')
  return archive
}
/**
 * Reads the run's terrain through the regular tile loader (passed in, so this module stays free of network
 * access) and its retry limits, retaining exactly the decoded cells this run uses.
 */
export async function loadRetainedTerrain(
  range: DemTileRange,
  tiles: Map<string, Uint8Array>,
  progress: (done: number, total: number) => void,
  load: typeof loadElevationGrid,
) {
  if (range.tileCount > MAX_DEM_TILES) throw Error('Terrain range exceeds the run budget.')
  const grid = new ElevationGrid(range),
    coords = demTileCoordinates(range)
  let next = 0,
    done = 0
  async function read() {
    while (next < coords.length) {
      const { x, y } = coords[next++]
      await load({
        range: { zoom: range.zoom, minX: x, maxX: x, minY: y, maxY: y, tileCount: 1 },
        decode: async (bytes) => {
          const cells = await decodeTerrariumTile(bytes)
          if (cells.length !== DEM_TILE_SIZE * DEM_TILE_SIZE) throw Error('Invalid terrain tile size.')
          tiles.set(tileName(x, y), new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength))
          grid.setTile(x, y, cells)
          return cells
        },
      })
      progress(++done, coords.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, coords.length) }, read))
  return { grid, missingTileCount: coords.length - tiles.size }
}
async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
export async function replayRun(file: Blob) {
  if (file.size > maxBytes) throw Error('Run input archive exceeds 200 MB.')
  let total = 0
  const names = new Set<string>()
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => {
      total += entry.originalSize
      if (
        total > maxBytes ||
        names.size >= MAX_DEM_TILES + 2 ||
        names.has(entry.name) ||
        !/^(?:manifest\.json|inputs\.json|dem\/\d+-\d+\.f32)$/.test(entry.name)
      )
        throw Error('Invalid run archive contents.')
      names.add(entry.name)
      return true
    },
  })
  const manifest = JSON.parse(strFromU8(entries['manifest.json']))
  if (
    manifest?.format !== format ||
    typeof manifest.ref?.rowId !== 'string' ||
    !manifest.checksums ||
    !entries['inputs.json']
  )
    throw Error('Unsupported run input archive.')
  const files = Object.keys(entries).filter((k) => k !== 'manifest.json')
  if (files.length !== Object.keys(manifest.checksums).length) throw Error('Run inputs are incomplete.')
  for (const k of files)
    if ((await digest(entries[k])) !== manifest.checksums[k]) throw Error('Input checksum mismatch: ' + k)
  const d: RunInputs = JSON.parse(strFromU8(entries['inputs.json']))
  const local = d.input.localRasters?.find((r) => r.kind === 'terrain')
  const range = d.range
  let grid
  if (local && !range) grid = rasterSampler(local)
  else {
    if (
      !range ||
      ![range.minX, range.maxX, range.minY, range.maxY, range.zoom].every(Number.isSafeInteger) ||
      range.zoom < 0 ||
      range.zoom > 22 ||
      range.minX < 0 ||
      range.minY < 0 ||
      range.maxX >= 2 ** range.zoom ||
      range.maxY >= 2 ** range.zoom ||
      range.maxX < range.minX ||
      range.maxY < range.minY ||
      range.tileCount !== (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1) ||
      range.tileCount > MAX_DEM_TILES
    )
      throw Error('Invalid retained terrain range.')
    const mosaic = new ElevationGrid(range)
    for (const { x, y } of demTileCoordinates(range)) {
      const bytes = entries[tileName(x, y)]
      if (!bytes) continue
      if (bytes.length !== DEM_TILE_SIZE * DEM_TILE_SIZE * 4) throw Error('Invalid retained tile.')
      mosaic.setTile(x, y, new Float32Array(bytes.slice().buffer))
    }
    if (range.tileCount - mosaic.tileCount !== d.terrain.missingTileCount)
      throw Error('Retained terrain coverage differs from the run.')
    grid = mosaic
  }
  const result = computeAnalysis(grid, d.input, d.terrain, undefined, d.canopy, d.forested, d.context)
  const replayed: ReplayFigures = JSON.parse(JSON.stringify(figures(result)))
  const comparison = compareReplayFigures(manifest.expected, replayed)
  return {
    result,
    replayMatches: comparison.matches,
    replayMaxDeltaPp: comparison.maxAbsDeltaPp,
    replayMismatches: comparison.mismatches,
    replayCalcVersion: Number.isSafeInteger(manifest.calcVersion) ? (manifest.calcVersion as number) : null,
    replayRowId: manifest.ref.rowId as string,
  }
}
