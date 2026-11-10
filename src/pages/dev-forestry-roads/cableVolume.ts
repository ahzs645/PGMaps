/**
 * Timber volume on the extraction grid, for weighting suggested cable lines by the wood they yard
 * rather than by area alone (`selectCableLines` with `volume`).
 *
 * Two sources, both stated with the result:
 * - **VRI** rank-1 live stand volume per hectare (`LIVE_STAND_VOLUME_125`, 12.5 cm+ utilisation),
 *   from DataBC's WFS (`vriVolume.ts`). A polygon-average inventory estimate, not a cruise.
 * - **An imported raster** of volume per hectare (a single-band GeoTIFF), sampled at the grid's cell
 *   centres (`volumeRasterImport.ts`).
 *
 * Missing stays unknown: a cell with no volume keeps NaN, its area is reported, and for the weighting
 * it counts at the mean of the known yardable cells, so it neither wins nor loses a line by default.
 *
 * Pure: no DOM or network access.
 */
import { polygonCells } from './skidReach'
import type { ExtractionGrid } from './extractionReach'

/** Largest volume per hectare accepted from a source, m³/ha. BC's richest coastal stands carry about 2,000. */
export const MAX_VOLUME_PER_HA = 3000

export interface CellVolume {
  /** Volume per hectare at each grid cell, m³/ha; NaN where the source has none. */
  perHa: Float32Array
  /** Where it came from, for the results line. */
  source: string
}

export interface VolumeStand {
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  /** m³/ha; null where the inventory has no figure. */
  volumePerHa: number | null
}

const usable = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_VOLUME_PER_HA

/** Volume per hectare at each grid cell from inventory polygons; the first polygon holding a cell wins. */
export function volumeFromStands(eg: ExtractionGrid, stands: readonly VolumeStand[], source: string): CellVolume {
  const { sg } = eg
  const n = sg.grid.values.length
  const perHa = new Float32Array(n).fill(NaN)
  const taken = new Uint8Array(n)
  const { origin, cellM, width, height } = sg.grid
  const minX = origin[0] - cellM,
    maxX = origin[0] + width * cellM,
    minY = origin[1] - height * cellM,
    maxY = origin[1] + cellM
  for (const stand of stands) {
    const polygons = stand.geometry.type === 'Polygon' ? [stand.geometry.coordinates] : stand.geometry.coordinates
    for (const rings of polygons) {
      const xy = rings.map((ring) => ring.map((c) => sg.toGrid([c[0], c[1]])))
      // Only polygons over the grid are rasterized.
      const outer = xy[0] ?? []
      if (
        outer.length < 3 ||
        outer.every((p) => p[0] < minX) ||
        outer.every((p) => p[0] > maxX) ||
        outer.every((p) => p[1] < minY) ||
        outer.every((p) => p[1] > maxY)
      )
        continue
      const mask = polygonCells(sg.grid, xy)
      for (let i = 0; i < n; i++)
        if (mask[i] && !taken[i]) {
          taken[i] = 1
          if (usable(stand.volumePerHa)) perHa[i] = stand.volumePerHa!
        }
    }
  }
  return { perHa, source }
}

/** Volume per hectare at each grid cell from a sampler at the cell centres (lon, lat); NaN where it has none. */
export function volumeFromSampler(
  eg: ExtractionGrid,
  sample: (lon: number, lat: number) => number,
  source: string,
): CellVolume {
  const { origin, cellM, width, height } = eg.sg.grid
  const perHa = new Float32Array(width * height).fill(NaN)
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const [lon, lat] = eg.sg.toLonLat([origin[0] + col * cellM, origin[1] - row * cellM])
      const v = sample(lon, lat)
      if (usable(v)) perHa[row * width + col] = v
    }
  return { perHa, source }
}

export interface VolumeWeights {
  /** Weight per grid cell, m³ (volume per hectare × cell area); unknown yardable cells at the known mean. */
  m3: Float32Array
  /** 1 where the cell's volume is known. */
  known: Uint8Array
  /** Mean of the known yardable cells, m³/ha; null when none is known. */
  meanPerHa: number | null
  knownHa: number
  unknownHa: number
  source: string
}

/**
 * Cell weights for the selection over the yardable cells (`yardable[i] = 1`). Throws when no
 * yardable cell has a volume: the source does not cover the block.
 */
export function volumeWeights(eg: ExtractionGrid, volume: CellVolume, yardable: Uint8Array): VolumeWeights {
  const n = eg.sg.grid.values.length
  if (volume.perHa.length !== n) throw Error('The volume was read on another grid. Read it again.')
  const cellHa = (eg.sg.grid.cellM * eg.sg.grid.cellM) / 10_000
  const known = new Uint8Array(n)
  let sum = 0,
    knownCells = 0,
    unknownCells = 0
  for (let i = 0; i < n; i++) {
    if (!yardable[i]) continue
    if (Number.isFinite(volume.perHa[i])) {
      known[i] = 1
      sum += volume.perHa[i]
      knownCells++
    } else unknownCells++
  }
  if (!knownCells) throw Error(`${volume.source} has no volume over the block's yardable ground.`)
  const mean = sum / knownCells
  const m3 = new Float32Array(n)
  for (let i = 0; i < n; i++) if (yardable[i]) m3[i] = (known[i] ? volume.perHa[i] : mean) * cellHa
  return {
    m3,
    known,
    meanPerHa: mean,
    knownHa: knownCells * cellHa,
    unknownHa: unknownCells * cellHa,
    source: volume.source,
  }
}
