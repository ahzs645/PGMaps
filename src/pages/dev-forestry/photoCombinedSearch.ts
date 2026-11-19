import type { ElevationSource } from '@/lib/forestry/terrain/terrain'

import { POINTS_REFERENCE_WIDTH, pointsHeldOutLimit, sameCamera, type AcceptancePose } from './photoAcceptance'
import {
  cameraCueScore,
  compareDepthGrids,
  undecidedHeadings,
  COMBINED_SAMPLE_WIDTH,
  type CameraCues,
} from './photoCombined'
import { estimatePhotoDepth, type DepthGrid, type PhotoDepthModel } from './photoDepth'
import { ownPhotoPose } from './exifPose'
import type { PhotoOption } from './photoOptions'
import type { Rgba } from './photoViews'
import { photoCameraCues, type ImageryLayer, type PhotoResource, type PhotoTerrainSpec } from './photoWorkClient'
import { photoSkyline } from './skylineFit'

export type CombinedSettings = { useSkyline: boolean; depthModel: PhotoDepthModel | null }
type Seed = {
  label: string
  pose: AcceptancePose
  rowId?: string
  skyline?: number
  geometry?: number
  geometryCheck?: { kind: 'overlap' | 'paired points'; errorPx: number }
}
export type CombinedCandidate = Seed & { cues: CameraCues; score: number }
export type CombinedResult = {
  candidates: CombinedCandidate[]
  tested: number
  depthSamples: number
  depthModel: PhotoDepthModel | null
  depthIssue: string | null
  coarse: boolean
  /**
   * Set when the cameras that fit about as well as the best (`TIED_SCORE`) look in directions more than
   * `UNDECIDED_SPAN_DEGREES` apart: the headings the evidence leaves open, clockwise from `from` to `to`. The best
   * candidate is then one of several, not a camera to start from.
   */
  undecided: { from: number; to: number } | null
}

const unit = (n: number) => Math.max(0, Math.min(1, n))
const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

function seedsFor(
  current: AcceptancePose,
  options: PhotoOption[],
  useSkyline: boolean,
  overlapP90: number | null,
  photoWidth: number,
) {
  const trustedSky = useSkyline && options.some(({ kind, evidence }) => kind === 'winner' && evidence.settled)
  const seeds: Seed[] = []
  const add = (seed: Seed) => {
    if (!seeds.some(({ pose }) => sameCamera(pose, seed.pose))) seeds.push(seed)
  }
  for (const { id, kind, label, pose, evidence, warnings, overlap } of options) {
    if (!useSkyline && (kind === 'winner' || kind === 'runner-up')) continue
    const span = evidence.skySpanShare ?? 0
    const skyline =
      useSkyline && (evidence.skyColumns ?? 0) >= 12 && span >= 0.14
        ? unit(span / 0.7) * (evidence.agreeShare ?? 0)
        : undefined
    const pointsPx = kind === 'points' && !warnings.length ? evidence.worstPairPixels : null
    const overlapError = overlap?.basis === 'terrain' ? overlap.p90Px : id === 'matched' ? overlapP90 : null
    const geometryCheck =
      overlapError != null
        ? { kind: 'overlap' as const, errorPx: overlapError }
        : pointsPx != null
          ? { kind: 'paired points' as const, errorPx: (pointsPx * POINTS_REFERENCE_WIDTH) / photoWidth }
          : undefined
    const geometry =
      geometryCheck?.kind === 'overlap'
        ? unit(1 - (geometryCheck.errorPx - 3) / 25)
        : pointsPx != null
          ? unit(1 - pointsPx / pointsHeldOutLimit(photoWidth))
          : undefined
    add({ label, pose, rowId: id, skyline, geometry, geometryCheck })
  }
  add({ label: 'Current camera', pose: current })
  const coarse = !trustedSky || seeds.length < 2
  if (coarse) {
    const pitches = current.altitudeMeters == null ? [current.pitch] : [-12, -38]
    for (let bearing = 0; bearing < 360; bearing += 30)
      for (const pitch of pitches) add({ label: 'Coarse terrain search', pose: { ...current, bearing, pitch } })
  }
  return { seeds, coarse, trustedSky }
}

function groundFromSkyline(photo: Rgba): number[] {
  return photoSkyline(photo, COMBINED_SAMPLE_WIDTH).map((point) => (point?.y ?? 0) / photo.height)
}

export async function comparePhotoCameras({
  settings,
  current,
  options,
  overlapP90,
  photoWidth,
  eyeHeightMeters,
  terrain,
  terrainSpec,
  pixels: photo,
  imagery,
  signal,
  onProgress,
  depthFor,
}: {
  settings: CombinedSettings
  current: AcceptancePose
  options: PhotoOption[]
  overlapP90: number | null
  photoWidth: number
  eyeHeightMeters: number
  terrain: ElevationSource
  terrainSpec: PhotoTerrainSpec
  /** The photo's pixels and the imagery round it, each under the key the photo worker keeps it by. */
  pixels: PhotoResource<Rgba>
  imagery: PhotoResource<ImageryLayer[]>
  signal: AbortSignal
  onProgress: (message: string) => void
  /**
   * The photo's depth by a model: the caller's kept estimate, else a fresh one it keeps. Absent, it is estimated here
   * every time, which is a second or more of inference and a model load for the same answer.
   */
  depthFor?: (model: PhotoDepthModel, signal: AbortSignal) => Promise<DepthGrid>
}): Promise<CombinedResult> {
  const pixels = photo.value
  const { seeds, coarse, trustedSky } = seedsFor(current, options, settings.useSkyline, overlapP90, photoWidth)
  let depthIssue: string | null = null
  const model = settings.depthModel
  const inferred = model
    ? (() => {
        onProgress('Estimating depth on this device…')
        return (depthFor ? depthFor(model, signal) : estimatePhotoDepth(pixels, model, signal)).catch(() => {
          depthIssue = 'Local depth was unavailable. Other camera cues were compared.'
          return null
        })
      })()
    : Promise.resolve(null)
  const candidates = []
  for (const [index, seed] of seeds.entries()) {
    signal.throwIfAborted()
    onProgress(`Comparing camera ${index + 1} of ${seeds.length}…`)
    const { lng, lat } = seed.pose
    const pose = ownPhotoPose(
      { ...seed.pose, eyeHeightMeters },
      terrain.elevationAt(lng, lat),
      pixels.width,
      pixels.height,
    )
    if (!Number.isFinite(pose.altitudeMeters)) continue
    // Cast, coloured from imagery and scored against the photo in the worker: on the page's thread a comparison of
    // twenty-odd cameras held it for a tenth of a second a camera (4.4 s over one traced session).
    const { appearance, depth } = await photoCameraCues(
      { pose, terrain: terrainSpec, imagery, photo, width: COMBINED_SAMPLE_WIDTH, maxMeters: 75000 },
      signal,
    )
    const cues = { appearance, skyline: seed.skyline, geometry: seed.geometry }
    candidates.push({ seed, cues, depthGrid: depth })
  }
  if (model) onProgress('Finishing the local depth comparison…')
  const photoDepth = await inferred
  signal.throwIfAborted()
  const comparison = photoDepth
    ? compareDepthGrids(
        photoDepth,
        candidates.map((c) => c.depthGrid),
        trustedSky ? groundFromSkyline(pixels) : undefined,
      )
    : null
  if (photoDepth && !comparison) depthIssue = 'Too little common ground was visible for the depth comparison.'
  const results = candidates
    .flatMap(({ seed, cues }, index) => {
      const evidence: CameraCues = { ...cues, depth: comparison?.depth[index] }
      if (!Object.values(evidence).some((value) => value != null)) return []
      return [{ ...seed, cues: evidence, score: cameraCueScore(evidence) }]
    })
    .sort((a, b) => b.score - a.score)
  const distinct: CombinedCandidate[] = []
  for (const result of results) {
    if (
      !distinct.some(
        ({ pose }) => angleGap(pose.bearing, result.pose.bearing) < 6 && Math.abs(pose.pitch - result.pose.pitch) < 6,
      )
    )
      distinct.push(result)
    if (distinct.length === 3) break
  }
  return {
    candidates: distinct,
    tested: candidates.length,
    depthSamples: comparison?.samples ?? 0,
    depthModel: comparison ? model : null,
    depthIssue,
    coarse,
    undecided: undecidedHeadings(results.map(({ pose, score }) => ({ bearing: pose.bearing, score }))),
  }
}
