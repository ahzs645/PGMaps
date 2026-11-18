/** Camera transfer from image correspondences and an independently checked reference camera. */
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { orientationFromPairs, solveFromControls, type ControlPair } from './controlPose'
import { projectToPhoto, type PhotoPose } from './photoPose'
import { castRay } from './photoViews'

type Pixel = [number, number]
export type OverlapCamera = PhotoPose & { hfov: number }
type Camera = OverlapCamera
export type ImageMatch = [reference: Pixel, target: Pixel]

const MIN_CONTROLS = 12
const FRAME_WIDTH = 1050
const MAX_GROUND_METERS = 12000
const INLIER_PIXELS = 12
const MAX_HELD_OUT_P90 = 24
const MAX_HELD_OUT_MEDIAN = 8

type ErrorSummary = { medianPx: number; p90Px: number; withinThreshold: number }
type Fit = { pose: Camera; inliers: number }
export type TransferResult =
  | { status: 'insufficient'; controls: number; reason: string }
  | {
      status: 'candidate' | 'inconsistent'
      controls: number
      regions: number
      fixed: ErrorSummary
      adjusted: ErrorSummary | null
      baseline: ErrorSummary
      model: 'fixed' | 'adjusted'
      inliers: number
      pose: Camera | null
    }

function frameCell(frame: PhotoPose, [x, y]: Pixel): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= frame.width || y >= frame.height) return null
  return Math.floor((x / frame.width) * 8) + Math.floor((y / frame.height) * 6) * 8
}

/** Keeps one descriptor match per cell on either image. Input matches are strongest first. */
function groundControls(
  ref: Camera,
  target: Camera,
  terrain: ElevationSource,
  matches: readonly ImageMatch[],
): ControlPair[] {
  const usedRef = new Set<number>()
  const usedTarget = new Set<number>()
  return matches.flatMap(([pixel, point], index) => {
    const from = frameCell(ref, pixel)
    const to = frameCell(target, point)
    if (from === null || to === null || usedRef.has(from) || usedTarget.has(to)) return []
    const hit = castRay(ref, terrain, ...pixel, MAX_GROUND_METERS)
    if (!hit || !Number.isFinite(hit.elevation)) return []
    usedRef.add(from)
    usedTarget.add(to)
    return [{ id: String(index), pixel: point, lng: hit.lng, lat: hit.lat, elevation: hit.elevation }]
  })
}

function error(pose: Camera, pair: ControlPair): number {
  const predicted = projectToPhoto(pose, pair.lng, pair.lat, pair.elevation)
  return predicted
    ? (Math.hypot(predicted.x - pair.pixel[0], predicted.y - pair.pixel[1]) * FRAME_WIDTH) / pose.width
    : Infinity
}

function summarize(errors: number[]): ErrorSummary {
  const sorted = [...errors].sort((a, b) => a - b)
  return {
    medianPx: sorted[Math.ceil(sorted.length / 2) - 1],
    p90Px: sorted[Math.ceil(sorted.length * 0.9) - 1],
    withinThreshold: errors.filter((value) => value <= INLIER_PIXELS).length / errors.length,
  }
}

function robustOrientation(
  start: Camera,
  pairs: readonly ControlPair[],
): { pose: Camera; inliers: ControlPair[] } | null {
  const n = pairs.length
  let best: { pose: Camera; inliers: ControlPair[] } | null = null
  let bestLoss = Infinity
  // Reproducible hypotheses over the spatially thinned controls.
  let seed = 1337
  const draw = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return Math.floor((seed / 2 ** 32) * n)
  }
  for (let trial = 0; trial < 160; trial++) {
    const indices = new Set([draw(), draw(), draw()])
    if (indices.size !== 3) continue
    const angles = orientationFromPairs(
      start,
      Array.from(indices, (index) => pairs[index]),
    )
    if (!angles) continue
    const pose = { ...start, ...angles }
    const errors = pairs.map((pair) => error(pose, pair))
    const inliers = pairs.filter((_, index) => errors[index] <= INLIER_PIXELS)
    const loss = errors.reduce((sum, value) => sum + Math.min(value, INLIER_PIXELS), 0)
    if (!best || inliers.length > best.inliers.length || (inliers.length === best.inliers.length && loss < bestLoss)) {
      best = { pose, inliers }
      bestLoss = loss
    }
  }
  if (!best || best.inliers.length < Math.max(5, Math.ceil(n * 0.6))) return null
  const angles = orientationFromPairs(start, best.inliers)
  return angles ? { pose: { ...start, ...angles }, inliers: best.inliers } : null
}

function adjustPosition(start: Camera, inliers: ControlPair[]): Fit | null {
  const fitted = solveFromControls({ start, pairs: inliers, pixelSigma: (3 * start.width) / FRAME_WIDTH })
  if (!fitted) return null
  const { east, north, up } = fitted.shift
  if (Math.hypot(east, north) > 75 || Math.abs(up) > 60) return null
  return { pose: fitted.pose, inliers: inliers.length }
}

function regionsOf(controls: ControlPair[]): ControlPair[][] {
  // Split the overlap itself so a partial image overlap can still hold out entire regions.
  const x = controls.map((pair) => pair.pixel[0]).sort((a, b) => a - b)
  const y = controls.map((pair) => pair.pixel[1]).sort((a, b) => a - b)
  const mid = Math.floor(controls.length / 2)
  const regions: ControlPair[][] = [[], [], [], []]
  for (const pair of controls) {
    const col = Number(pair.pixel[0] >= x[mid])
    const row = Number(pair.pixel[1] >= y[mid])
    regions[row * 2 + col].push(pair)
  }
  return regions
}

/** Fits only on training regions and measures every control in the region held out of that fit. */
export function transferCamera(
  reference: Camera,
  target: Camera,
  terrain: ElevationSource,
  matches: readonly ImageMatch[],
  allowPositionAdjustment = true,
): TransferResult {
  const controls = groundControls(reference, target, terrain, matches)
  const n = controls.length
  if (n < MIN_CONTROLS) return { status: 'insufficient', controls: n, reason: 'Too few distributed ground matches' }
  const x = controls.map((pair) => pair.pixel[0])
  const y = controls.map((pair) => pair.pixel[1])
  if (Math.max(...x) - Math.min(...x) < target.width * 0.18 || Math.max(...y) - Math.min(...y) < target.height * 0.12)
    return { status: 'insufficient', controls: n, reason: 'Ground matches are concentrated in a strip' }
  const regions = regionsOf(controls).filter((region) => region.length)
  if (regions.filter((region) => region.length >= 2).length < 3 || regions.some((region) => n - region.length < 6))
    return { status: 'insufficient', controls: n, reason: 'Too few spatial regions can be held out' }

  const fixedErrors: number[] = []
  const adjustedErrors: number[] = []
  let adjustedComplete = allowPositionAdjustment
  for (const region of regions) {
    const heldOut = new Set(region)
    const training = controls.filter((pair) => !heldOut.has(pair))
    const fit = robustOrientation(target, training)
    const adjusted = allowPositionAdjustment && fit ? adjustPosition(target, fit.inliers) : null
    if (!adjusted) adjustedComplete = false
    for (const pair of region) {
      fixedErrors.push(fit ? error(fit.pose, pair) : Infinity)
      if (adjusted) adjustedErrors.push(error(adjusted.pose, pair))
    }
  }
  const fixed = summarize(fixedErrors)
  const adjusted = adjustedComplete ? summarize(adjustedErrors) : null
  const baseline = summarize(controls.map((pair) => error(target, pair)))
  // Keep the simpler fixed-GPS estimate unless moving the camera helps outside the fitted regions.
  const useAdjusted = !!adjusted && adjusted.medianPx < fixed.medianPx * 0.85 && adjusted.p90Px <= fixed.p90Px
  const heldOut = useAdjusted ? adjusted : fixed
  const passes =
    heldOut.medianPx <= MAX_HELD_OUT_MEDIAN && heldOut.p90Px <= MAX_HELD_OUT_P90 && heldOut.withinThreshold >= 0.7
  const full = passes ? robustOrientation(target, controls) : null
  const solved = full && (useAdjusted ? adjustPosition(target, full.inliers) : { pose: full.pose })
  return {
    status: solved ? 'candidate' : 'inconsistent',
    controls: n,
    regions: regions.length,
    fixed,
    adjusted,
    baseline,
    model: useAdjusted ? 'adjusted' : 'fixed',
    inliers: full?.inliers.length ?? 0,
    pose: solved?.pose ?? null,
  }
}
