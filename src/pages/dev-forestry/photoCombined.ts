/** Experimental candidate comparison. Scores indicate relative agreement within one photo. */
import type { DepthGrid } from './photoDepth'
import type { HitBuffer } from './photoHitBuffer'
import type { PhotoPose } from './photoPose'
import { modelAgreement, type ImagerySampler, type Rgba } from './photoViews'

export type CameraCues = {
  depth?: { global: number; lateral: number } | null
  appearance?: number | null
  skyline?: number | null
  geometry?: number | null
  sun?: number | null
}

export const COMBINED_SAMPLE_WIDTH = 96

/** Weighted terms shown in the review. Missing measurements stay null so they can be distinguished from zero. */
export function cameraCueContributions(cues: CameraCues) {
  const { depth, appearance, skyline, geometry, sun } = cues
  return {
    depth: depth ? 0.38 * depth.global + 0.62 * depth.lateral : null,
    appearance: appearance == null ? null : 0.6 * appearance,
    skyline: skyline == null ? null : 0.75 * skyline,
    geometry: geometry == null ? null : 1.5 * geometry,
    sun: sun == null ? null : 0.8 * sun,
  }
}

export function cameraCueScore(cues: CameraCues): number {
  return Object.values(cameraCueContributions(cues)).reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

/** Scores this close to the best are the same fit: the sweep's own steps move a score about this much. */
export const TIED_SCORE = 0.08
/** Tied cameras further apart than this are different answers, not one answer's neighbours (the sweep is 30° apart). */
export const UNDECIDED_SPAN_DEGREES = 45

/**
 * The headings left open by cameras that score within `TIED_SCORE` of the best: the smallest arc holding them all,
 * clockwise, or null when they sit within `UNDECIDED_SPAN_DEGREES` of each other.
 */
export function undecidedHeadings(scored: ReadonlyArray<{ bearing: number; score: number }>) {
  if (scored.length < 2) return null
  const best = Math.max(...scored.map(({ score }) => score))
  const tied = [
    ...new Set(
      scored.filter(({ score }) => score >= best - TIED_SCORE).map(({ bearing }) => ((bearing % 360) + 360) % 360),
    ),
  ].sort((a, b) => a - b)
  if (tied.length < 2) return null
  // The arc is everything but the widest gap between neighbours.
  let widest = 0,
    after = 0
  for (let i = 0; i < tied.length; i++) {
    const gap = (tied[(i + 1) % tied.length] - tied[i] + 360) % 360
    if (gap > widest) {
      widest = gap
      after = (i + 1) % tied.length
    }
  }
  const span = 360 - widest
  if (span <= UNDECIDED_SPAN_DEGREES) return null
  return { from: tied[after], to: tied[(after + tied.length - 1) % tied.length] }
}

/** First ground intersection as reciprocal distance along the camera's forward axis. */
export function terrainInverseDepth(hits: HitBuffer, pose: PhotoPose): DepthGrid {
  const { width, height, distance } = hits
  const inverse = Float32Array.from(distance, (value, i) => {
    if (!Number.isFinite(value) || value <= 0) return Number.NaN
    const x = ((i % width) + 0.5) * (pose.width / width)
    const y = (Math.floor(i / width) + 0.5) * (pose.height / height)
    return Math.hypot(1, (x - pose.width / 2) / pose.focalPx, (y - pose.height / 2) / pose.focalPx) / value
  })
  return { width, height, inverse }
}

/** Builds only the colour samples needed for the score, reusing the depth cast. */
export function groundAppearance(photo: Rgba, hits: HitBuffer, sample: ImagerySampler): number | null {
  const { width, height, lng, lat, distance } = hits
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < distance.length; i++) {
    const colour = Number.isFinite(distance[i]) ? sample(lng[i], lat[i]) : ([170, 200, 235] as const)
    if (!colour) continue
    data.set(colour, i * 4)
    data[i * 4 + 3] = 255
  }
  const agreement = modelAgreement(photo, { width, height, data })
  return Number.isFinite(agreement.score) ? 0.67 * agreement.brightness + 0.33 * agreement.edges : null
}

function sampleDepth(grid: DepthGrid, x: number, y: number, width: number, height: number): number {
  const u = Math.max(0, Math.min(grid.width - 1, ((x + 0.5) * grid.width) / width - 0.5))
  const v = Math.max(0, Math.min(grid.height - 1, ((y + 0.5) * grid.height) / height - 0.5))
  const left = Math.floor(u)
  const top = Math.floor(v)
  const at = (xx: number, yy: number) => grid.inverse[yy * grid.width + xx]
  const right = Math.min(grid.width - 1, left + 1)
  const bottom = Math.min(grid.height - 1, top + 1)
  const a = at(left, top) + (u - left) * (at(right, top) - at(left, top))
  const b = at(left, bottom) + (u - left) * (at(right, bottom) - at(left, bottom))
  return a + (v - top) * (b - a)
}

function ranks(values: readonly number[]): Float64Array {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b])
  const result = new Float64Array(order.length)
  for (let i = 0; i < order.length; ) {
    let end = i + 1
    while (end < order.length && values[order[end]] === values[order[i]]) end++
    for (let j = i; j < end; j++) result[order[j]] = (i + end - 1) / 2
    i = end
  }
  return result
}

function rankCorrelation(a: Float64Array, b: Float64Array): number {
  const mid = (a.length - 1) / 2
  let aa = 0
  let bb = 0
  let ab = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - mid
    const y = b[i] - mid
    aa += x * x
    bb += y * y
    ab += x * y
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0
}

function rowCentered(values: number[]): number[] {
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  const median = values.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return values.map((value) => value - median)
}

/** Scores the same valid ground pixels for all poses. A sky or occluded pixel cannot give a candidate an advantage. */
export function compareDepthGrids(
  photo: DepthGrid,
  candidates: readonly DepthGrid[],
  skyFloor?: readonly number[],
): { depth: NonNullable<CameraCues['depth']>[]; samples: number } | null {
  if (!candidates.length) return null
  const { width, height } = candidates[0]
  const fromPhoto: number[] = []
  const fromTerrain = candidates.map((): number[] => [])
  const photoLateral: number[] = []
  const terrainLateral = candidates.map((): number[] => [])
  for (let y = 0; y < height; y++) {
    const photoRow: number[] = []
    const terrainRows = candidates.map((): number[] => [])
    for (let x = 0; x < width; x++) {
      if (x < width * 0.025 || x >= width * 0.975 || y >= height * 0.975) continue
      if ((y + 0.5) / height <= (skyFloor?.[x] ?? 0) + 0.025) continue
      const index = y * width + x
      const value = sampleDepth(photo, x, y, width, height)
      if (!(value > 0) || !candidates.every((grid) => grid.inverse[index] > 0)) continue
      photoRow.push(value)
      for (const [i, grid] of candidates.entries()) terrainRows[i].push(grid.inverse[index])
    }
    fromPhoto.push(...photoRow)
    for (const [i, row] of terrainRows.entries()) fromTerrain[i].push(...row)
    if (photoRow.length >= 8) {
      photoLateral.push(...rowCentered(photoRow))
      for (const [i, row] of terrainRows.entries()) terrainLateral[i].push(...rowCentered(row))
    }
  }
  if (fromPhoto.length < Math.max(150, 0.2 * width * height)) return null
  const globalRanks = ranks(fromPhoto)
  const lateralRanks = ranks(photoLateral)
  return {
    samples: fromPhoto.length,
    depth: fromTerrain.map((values, i) => {
      const global = rankCorrelation(globalRanks, ranks(values))
      return {
        global,
        lateral: photoLateral.length >= 150 ? rankCorrelation(lateralRanks, ranks(terrainLateral[i])) : global,
      }
    }),
  }
}
