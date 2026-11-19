/**
 * A PDF sheet's contour surface as the project's terrain. The sheet prints no vertical datum, so
 * the person states it, as for any terrain that does not say. DOM and network free.
 */
import type { PdfContourSurface } from '@/lib/geoPdf/contours'
import type { PdfSource } from '@/lib/geoPdf/types'
import { localRasterResolution } from '@/lib/forestry/terrain/localRaster'
import { yieldToHost } from './cooperative'
import {
  MAX_ROAD_RASTER_CELLS,
  rasterSource,
  roadProjection,
  TerrainImportQuestion,
  validateRoadRaster,
} from './terrain'
import type { Bounds } from '@/lib/forestry/terrain/terrain'
import type { TerrainMetadata, TerrainSource } from './types'

/** A contour surface refined between its contours from a hillshade sheet (`hillshadeRefine.ts`). */
export interface ContourRelief {
  /** The hillshade sheet's file name. */
  name: string
  sharePercent: number
  medianChangeM: number
  p99ChangeM: number
  /** What was done, for the import notice. */
  summary: string
}

export function contourTerrain(
  surface: PdfContourSurface,
  source: PdfSource,
  verticalReference: string,
  relief?: ContourRelief,
): { metadata: TerrainMetadata; source: TerrainSource; summary: string } {
  const file = source.file.split('/').at(-1) ?? source.file
  if (!verticalReference.trim())
    throw new TerrainImportQuestion(
      `${file} prints contour elevations but not what they are measured from. State the vertical datum to use them as terrain.`,
      { verticalDatum: { files: [file] } },
    )
  if (verticalReference.trim().length > 300) throw Error('Shorten the vertical datum to at most 300 characters.')
  const raster = validateRoadRaster({
    id: `terrain-${source.sha256.slice(0, 16)}-contours`,
    name: `${relief ? 'Contours + hillshade' : 'Contours'} · ${file}`.slice(0, 200),
    kind: 'terrain',
    epsg: surface.epsg,
    origin: [...surface.origin],
    pixelSize: [surface.cellM, -surface.cellM],
    width: surface.width,
    height: surface.height,
    // Millimetres are far finer than a contour surface knows; they keep the saved project smaller.
    values: Array.from(surface.values, (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)),
    acquired: '',
    verticalReference: verticalReference.trim(),
    sha256: source.sha256,
  })
  const latitude = roadProjection(raster.epsg).inverse(raster.origin)[1]
  const metadata: TerrainMetadata = {
    kind: 'geotiff',
    name: raster.name,
    resolutionM: localRasterResolution(raster, latitude),
    epsg: raster.epsg,
    verticalReference: raster.verticalReference,
    sha256: source.sha256,
    raster,
    ...(relief
      ? {
          relief: {
            name: relief.name,
            sharePercent: relief.sharePercent,
            medianChangeM: relief.medianChangeM,
            p99ChangeM: relief.p99ChangeM,
          },
        }
      : {}),
  }
  const a = surface.assignment
  return {
    metadata,
    source: rasterSource(raster),
    summary: `Terrain from ${file}'s ${a.interval} m contours (${a.labelledLines} labelled, ${a.inferredLines} inferred lines; ${surface.cellM} m cells).${relief ? ` ${relief.summary}` : ''} Coarser than LiDAR; ground beyond the labelled contours is left missing.`,
  }
}

/** A contour terrain as {@link contourTerrain} returns it. */
export type ContourTerrain = ReturnType<typeof contourTerrain>

const FILL_NAME = / \+ regional DEM beyond them \(\d+% of cells\)$/
const FILL_DATUM_TEXT = '; cells beyond the contours: regional DEM, datum unverified'
const FILL_DATUM = /; cells beyond the contours: regional DEM, datum unverified$/

/**
 * The contour terrain widened to cover `extent` (WGS84 [west, south, east, north]: the roads and
 * blocks being designed), with every cell the contours leave missing taken from `fill`, the
 * regional DEM. A sheet's contours stop at its frame, so a road that runs off the sheet otherwise
 * has no ground. The contour cells are copied unchanged on the same grid; neither surface is
 * shifted to meet the other (their datums are not known to agree), so a step of a metre or two can
 * show where they meet, and the summary says so. When the widened grid would pass the road
 * terrain's cell limit, the cells grow (2 m, then 3 m, …) and the contours are resampled bilinearly;
 * the name states the cell size. Returns the input unchanged when no cell needed filling.
 * DOM and network free: the regional source is passed in.
 */
export async function fillBeyondContours(
  terrain: ContourTerrain,
  extent: Bounds,
  fill: { source: TerrainSource; resolutionM: number; name?: string },
  signal?: AbortSignal,
  padM = 100,
  /**
   * Widening for a road drawn later: never crop the grid it has (other roads stand on it), and
   * refuse rather than coarsen its cells past this factor.
   */
  keep?: { maxCellFactor: number },
): Promise<ContourTerrain & { filledShare: number }> {
  const r = terrain.metadata.raster
  if (!r) throw Error('That terrain has no grid to widen.')
  const projection = roadProjection(r.epsg)
  const cell0 = r.pixelSize[0]
  const corners = [
    [extent[0], extent[1]],
    [extent[0], extent[3]],
    [extent[2], extent[1]],
    [extent[2], extent[3]],
  ].map((p) => projection.forward(p as [number, number]))
  const want = [
    Math.min(...corners.map((p) => p[0])) - padM,
    Math.min(...corners.map((p) => p[1])) - padM,
    Math.max(...corners.map((p) => p[0])) + padM,
    Math.max(...corners.map((p) => p[1])) + padM,
  ]
  const sheet = [
    r.origin[0],
    r.origin[1] + (r.height - 1) * r.pixelSize[1],
    r.origin[0] + (r.width - 1) * cell0,
    r.origin[1],
  ]
  // The sheet's whole area and the roads', when that fits the cell limit at the contours' own
  // cells; else the roads' area alone (contour cells past it are cropped); only then coarser cells.
  let left = Math.min(sheet[0], want[0]),
    bottom = Math.min(sheet[1], want[1]),
    right = Math.max(sheet[2], want[2]),
    top = Math.max(sheet[3], want[3])
  // Keep the contour grid's own lines: the new origin is a whole number of cells from the old one.
  let factor = 1
  const size = (k: number) => {
    const cell = cell0 * k
    const x0 = r.origin[0] - Math.ceil((r.origin[0] - left) / cell - 1e-9) * cell
    const y0 = r.origin[1] + Math.ceil((top - r.origin[1]) / cell - 1e-9) * cell
    const width = Math.ceil((right - x0) / cell - 1e-9) + 1
    const height = Math.ceil((y0 - bottom) / cell - 1e-9) + 1
    return { cell, x0, y0, width, height }
  }
  let grid = size(factor)
  if (grid.width * grid.height > MAX_ROAD_RASTER_CELLS && !keep) {
    ;[left, bottom, right, top] = want
    grid = size(factor)
  }
  while (grid.width * grid.height > MAX_ROAD_RASTER_CELLS) grid = size((factor += 0.25))
  if (keep && factor > keep.maxCellFactor)
    throw Error(
      `Widening this terrain to the road would need ${Math.round(grid.cell * 10) / 10} m cells, more than ${keep.maxCellFactor} times its ${Math.round(cell0 * 10) / 10} m: the road runs too far from the sheet. Load a terrain that covers the road instead.`,
    )
  const at = (x: number, y: number) => {
    const col = (x - r.origin[0]) / cell0,
      row = (r.origin[1] - y) / cell0
    if (col < -1e-6 || row < -1e-6 || col > r.width - 1 + 1e-6 || row > r.height - 1 + 1e-6) return NaN
    const c = Math.min(r.width - 2, Math.max(0, Math.floor(col))),
      q = Math.min(r.height - 2, Math.max(0, Math.floor(row)))
    const u = Math.min(1, Math.max(0, col - c)),
      v = Math.min(1, Math.max(0, row - q))
    const w = [
      r.values[q * r.width + c],
      r.values[q * r.width + c + 1],
      r.values[(q + 1) * r.width + c],
      r.values[(q + 1) * r.width + c + 1],
    ]
    // A neighbour with no weight never counts, so a cell on the grid's own lines is copied exactly,
    // even beside a missing one; a missing neighbour that does weigh makes the point missing.
    const weights = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v].map((x) => (x < 1e-9 ? 0 : x))
    let sum = 0
    for (let i = 0; i < 4; i++) {
      if (!weights[i]) continue
      if (w[i] === null) return NaN
      sum += w[i]! * weights[i]
    }
    return sum / weights.reduce((a, b) => a + b, 0)
  }
  const values: Array<number | null> = new Array(grid.width * grid.height)
  let filled = 0,
    known = 0,
    sliceStart = Date.now()
  for (let row = 0; row < grid.height; row++) {
    const y = grid.y0 - row * grid.cell
    for (let col = 0; col < grid.width; col++) {
      const x = grid.x0 + col * grid.cell
      let v = at(x, y)
      if (!Number.isFinite(v)) {
        const [lon, lat] = projection.inverse([x, y])
        v = fill.source.elevationAt(lon, lat)
        if (Number.isFinite(v)) filled++
      }
      if (Number.isFinite(v)) known++
      values[row * grid.width + col] = Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null
    }
    if (Date.now() - sliceStart > 12) {
      await yieldToHost()
      signal?.throwIfAborted()
      sliceStart = Date.now()
    }
  }
  if (
    !filled &&
    factor === 1 &&
    grid.x0 === r.origin[0] &&
    grid.y0 === r.origin[1] &&
    grid.width === r.width &&
    grid.height === r.height
  )
    return { ...terrain, filledShare: 0 }
  // Widened again (a road drawn past the last fill): cells an earlier fill took still count as filled.
  let earlier = 0
  if (terrain.metadata.fill) {
    let before = 0
    for (const v of r.values) if (v !== null) before++
    earlier = Math.round((terrain.metadata.fill.sharePercent / 100) * before)
  }
  const filledShare = known ? Math.min(1, (filled + earlier) / known) : 0
  const header = JSON.stringify([r.sha256, r.epsg, grid.x0, grid.y0, grid.cell, grid.width, grid.height])
  const bytes = new Uint8Array([
    ...new TextEncoder().encode(header),
    ...new Uint8Array(Float64Array.from(values, (v) => (v === null ? NaN : v)).buffer),
  ])
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  // "Contours · file", or "Contours + hillshade · file" for a surface refined from a hillshade.
  const share = `${Math.round(filledShare * 100)}%`
  const raster = validateRoadRaster({
    ...r,
    id: `terrain-${sha256.slice(0, 16)}-contours`,
    name: `${r.name.replace(FILL_NAME, '')} + regional DEM beyond them (${share} of cells)`.slice(0, 200),
    origin: [grid.x0, grid.y0],
    pixelSize: [grid.cell, -grid.cell],
    width: grid.width,
    height: grid.height,
    values,
    verticalReference: `${r.verticalReference.replace(FILL_DATUM, '')}${FILL_DATUM_TEXT}`.slice(0, 300),
    sha256,
  })
  const latitude = projection.inverse(raster.origin)[1]
  return {
    metadata: {
      ...terrain.metadata,
      name: raster.name,
      resolutionM: localRasterResolution(raster, latitude),
      verticalReference: raster.verticalReference,
      sha256,
      raster,
      fill: {
        name: fill.name ?? 'the regional DEM',
        resolutionM: fill.resolutionM,
        sharePercent: Math.round(filledShare * 1000) / 10,
      },
    },
    source: rasterSource(raster),
    summary: `${terrain.summary.replace(/ Coarser than LiDAR; ground beyond the labelled contours is left missing\.$/, ' Coarser than LiDAR.')} Ground past the contours (${share} of cells) comes from the regional DEM (about ${Math.round(fill.resolutionM)} m), not shifted to meet them: expect a step of a metre or two where they join.${
      factor > 1
        ? ` The area needed ${Math.round(grid.cell * 100) / 100} m cells to stay within ${MAX_ROAD_RASTER_CELLS.toLocaleString('en-CA')} cells; the contours were resampled to them.`
        : ''
    }`,
    filledShare,
  }
}

/** A terrain built by {@link contourTerrain}. */
export const isContourTerrain = (raster: { id: string } | undefined) => !!raster?.id.endsWith('-contours')

/**
 * How a contour surface's slope compared with the same block's printed slope sheet, scored on the
 * sheet's exact pixels by `scripts/forestry/check-pdf-contour-slope.ts` (one supplied company
 * sheet pair, November 2026). See `docs/forestry-road-design/source-pdf-import.md`.
 */
export const CONTOUR_RELIEF_SLOPE_CHECK =
  'On the one sheet set checked, slope from contours refined with the hillshade was in the same printed range for 53% of the slope sheet’s exact pixels and within one range for 80% (contours alone: 43% and 69% on the same pixels); it agreed 91–94% on the 35%, 40% and 60% thresholds.'
export const CONTOUR_SLOPE_CHECK =
  'On the one sheet pair checked, contour slope was in the same printed range for 43% of the sheet’s exact pixels and within one range for 69%; it agreed 87–91% on the 35%, 40% and 60% thresholds and read the 60%+ share low (38% against 42%).'

/**
 * The roads that use this grid but run past it, for the automatic regional fill: a road with a point
 * within `nearM` of the grid and a point closer than `reachM` (its section reach) to the grid's edge
 * or beyond it. A road farther off stands on other ground and is left alone. DOM free.
 */
export function roadsPastGrid<Road extends { points: readonly { coordinate: readonly [number, number] }[] }>(
  raster: Pick<NonNullable<TerrainMetadata['raster']>, 'epsg' | 'origin' | 'pixelSize' | 'width' | 'height'>,
  roads: readonly Road[],
  reachM: number,
  nearM = 5000,
): Road[] {
  const projection = roadProjection(raster.epsg)
  const x0 = raster.origin[0],
    x1 = raster.origin[0] + (raster.width - 1) * raster.pixelSize[0],
    y1 = raster.origin[1],
    y0 = raster.origin[1] + (raster.height - 1) * raster.pixelSize[1]
  const inside = (x: number, y: number, by: number) => x >= x0 + by && x <= x1 - by && y >= y0 + by && y <= y1 - by
  return roads.filter((road) => {
    const points = road.points.map((p) => projection.forward([p.coordinate[0], p.coordinate[1]]))
    return points.some(([x, y]) => inside(x, y, -nearM)) && points.some(([x, y]) => !inside(x, y, reachM))
  })
}
