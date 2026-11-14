/**
 * The frame's forest at real density, for a `final` engine capture (`engineCapture.ts`, `quality: 'final'`).
 *
 * The road view draws the first 300 m stem for stem and widens a few stems into clumps past it, so a far hillside
 * reads as squat blobs (`docs/forestry-visual-quality.md`, **Final render**). For the report's still, the frame's
 * forest is grown again with the road view's own near-band placement — `forestPatches` tiles of the near band, grown
 * by `growForestPatch` with that band's spacing and seed — out to `radiusMeters` (the landform's farthest point plus a
 * kilometre) within the frames' bearings. Species, heights, VRI crown closure, clearings, openings, thinnings,
 * reserves and tree-free areas therefore follow exactly the rules the road view follows, and inside the near band the
 * stems are the road view's own stems. Crowns come from `crownWidthForClosure` at the near band's density (about
 * 3–4 m on a mature stand), never wider than `FINAL_STAND_MAX_CROWN_TO_HEIGHT` of the stem's height.
 *
 * Output is the package's tree layout (`SCENE_TREE_FIELDS`) in its local metres, one Float32Array to transfer.
 * Patches grow nearest first; when the next would pass `FINAL_STAND_MAX_STEMS`, growing stops and the stand's radius
 * comes in to the nearest ground not grown, so the stand is always complete out to the radius it reports.
 * Deterministic: cells are seeded by their own coordinates, so the same eye and forest give the same stand.
 *
 * Display only: never an analysis input. DOM-free and network-free (the slices yield through `setTimeout`).
 */

import { TREE_SPECIES_IDS } from './forest'
import { forestBands, forestPatches, growForestPatch } from './forestPatches'
import type { ForestConfiguration } from './ForestOverlay'
import type { FrameCamera } from './figureFraming'
import type { ElevationSource } from './terrain'
import { metersPerDegree } from './visibility'
import { SCENE_TREE_FIELDS } from './scenePackage'

/** Most stems a final stand carries: about 42 MB of floats, a few milliseconds a frame as instanced cards. */
export const FINAL_STAND_MAX_STEMS = 1_500_000

/** A crown at most this share of its stem's height: a spire, not a clump. */
export const FINAL_STAND_MAX_CROWN_TO_HEIGHT = 0.35

/** How far past the farthest class polygon (the landform, the blocks) the stand reaches, metres. */
export const FINAL_STAND_PAST_LANDFORM_METERS = 1000

/** Widened each side of the frames' bearings, degrees: a near crown standing just outside still leans in. */
export const FINAL_STAND_BEARING_MARGIN_DEGREES = 3

/** Longest one slice of growing runs before it yields, milliseconds. */
const SLICE_MS = 30

const FIELDS = SCENE_TREE_FIELDS.length

export type FinalStandInput = {
  /** The package's local origin (longitude, latitude); stems are metres east and north of it. */
  origin: { lng: number; lat: number }
  /** Where the eye stands; the radius and bearings are measured from here. */
  eye: { lng: number; lat: number }
  radiusMeters: number
  /** Degrees clockwise from north, [from, to]; `to` may pass 360. */
  bearings: [number, number]
  forest: Pick<
    ForestConfiguration,
    'anchorLatitude' | 'stands' | 'clearings' | 'openings' | 'thinnings' | 'inventory' | 'standHeightMeters'
  >
  /** The ground the package's stems stand on. */
  elevation: ElevationSource
  maxStems?: number
}

export type FinalStand = {
  fields: typeof SCENE_TREE_FIELDS
  species: typeof TREE_SPECIES_IDS
  count: number
  data: Float32Array
  /** The radius the stand is complete to: the one asked for, or less when the stem budget ran out. */
  radiusMeters: number
  requestedRadiusMeters: number
  bearings: [number, number]
  /** True when the budget brought the radius in. */
  clipped: boolean
  /** Metres between near-band grid cells the stems were grown on. */
  spacingMeters: number
  /** Wall time to grow it, milliseconds. */
  millis: number
}

const wrap360 = (degrees: number) => ((degrees % 360) + 360) % 360

/** The frames' bearings, widened by the margin each side: [from, to], `from` in [0, 360), `to` past it when wrapped. */
export function finalStandBearings(
  frames: ReadonlyArray<Pick<FrameCamera, 'bearingDeg' | 'hfovDeg'>>,
  marginDegrees = FINAL_STAND_BEARING_MARGIN_DEGREES,
): [number, number] {
  if (!frames.length) return [0, 360]
  // Frames run left to right side by side (`planFraming`): the first frame's left edge to the last frame's right.
  const first = frames[0]
  const last = frames[frames.length - 1]
  const left = first.bearingDeg - first.hfovDeg / 2
  const across = frames.reduce((sum, frame) => sum + frame.hfovDeg, 0)
  const span = across >= 360 ? 360 : wrap360(last.bearingDeg + last.hfovDeg / 2 - left)
  const total = Math.min(360, span + 2 * marginDegrees)
  if (total >= 360) return [0, 360]
  const from = wrap360(left - marginDegrees)
  return [from, from + total]
}

/** The stand's radius for a capture whose farthest class polygon stands `reachMeters` off. */
export function finalStandRadius(reachMeters: number): number {
  return Math.ceil((Math.max(0, reachMeters) + FINAL_STAND_PAST_LANDFORM_METERS) / 100) * 100
}

/** Whether `bearing` lies in the span (`[from, to]`, `to` possibly past 360), widened by `slack` each side. */
function inSpan(bearing: number, [from, to]: [number, number], slack = 0): boolean {
  const span = to - from
  if (span + 2 * slack >= 360) return true
  return wrap360(bearing - from + slack) <= span + 2 * slack
}

/**
 * Grows the stand in slices: each `yield` is a point to hand the thread back. `buildFinalStand` runs it with
 * `setTimeout` between slices; a test drains it at once.
 */
export function* finalStandSteps(
  input: FinalStandInput,
  sliceMillis = SLICE_MS,
  now: () => number = () => performance.now(),
): Generator<void, FinalStand> {
  const started = now()
  const { origin, eye, forest, elevation } = input
  const requested = Math.max(0, input.radiusMeters)
  const maxStems = Math.max(0, Math.floor(input.maxStems ?? FINAL_STAND_MAX_STEMS))
  const bearings = input.bearings
  const scale = metersPerDegree(origin.lat)
  const eyeX = (eye.lng - origin.lng) * scale.lng
  const eyeY = (eye.lat - origin.lat) * scale.lat
  // The road view's near band, its tile size, spacing and seed: inside it these are the road view's own stems.
  const near = forestBands(requested)[0]
  const band = { ...near, far: requested }
  const anchorLatitude = forest.anchorLatitude ?? eye.lat
  const patches = forestPatches(eye, [band], anchorLatitude).flatMap((patch) => {
    const x = (patch.centre.lng - origin.lng) * scale.lng - eyeX
    const y = (patch.centre.lat - origin.lat) * scale.lat - eyeY
    const distance = Math.hypot(x, y)
    const half = (band.size * Math.SQRT2) / 2
    if (distance - half > requested) return []
    if (distance > half) {
      const bearing = (Math.atan2(x, y) * 180) / Math.PI
      if (!inSpan(bearing, bearings, (Math.asin(Math.min(1, half / distance)) * 180) / Math.PI)) return []
    }
    return [{ patch, nearest: Math.max(0, distance - half) }]
  })
  patches.sort((a, b) => a.nearest - b.nearest)

  const species = TREE_SPECIES_IDS
  const speciesIndex = new Map(species.map((id, i) => [id, i]))
  const chunks: Float32Array[] = []
  let count = 0
  let radius = requested
  let clipped = false
  let sliceStart = now()
  const inputs = {
    stands: forest.stands,
    clearings: forest.clearings,
    openings: forest.openings,
    thinnings: forest.thinnings,
    inventory: forest.inventory,
    heightMeters: forest.standHeightMeters,
  }
  for (let i = 0; i < patches.length; i++) {
    const { patch, nearest } = patches[i]
    const grown = growForestPatch(patch, band, inputs, elevation, anchorLatitude)
    const chunk = new Float32Array(grown.length * FIELDS)
    let kept = 0
    for (const tree of grown) {
      const x = (tree.lng - origin.lng) * scale.lng
      const y = (tree.lat - origin.lat) * scale.lat
      const dx = x - eyeX,
        dy = y - eyeY
      if (Math.hypot(dx, dy) >= requested) continue
      if (!inSpan((Math.atan2(dx, dy) * 180) / Math.PI, bearings)) continue
      const o = kept * FIELDS
      chunk[o] = x
      chunk[o + 1] = y
      chunk[o + 2] = tree.elevationMeters
      chunk[o + 3] = speciesIndex.get(tree.species) ?? 0
      chunk[o + 4] = tree.heightMeters
      chunk[o + 5] = Math.min(tree.heightMeters * tree.slenderness, tree.heightMeters * FINAL_STAND_MAX_CROWN_TO_HEIGHT)
      chunk[o + 6] = tree.tone
      kept++
    }
    if (count + kept > maxStems) {
      // Out of budget: the stand is complete only out to the nearest ground not grown.
      radius = Math.floor(Math.min(requested, nearest))
      clipped = true
      break
    }
    chunks.push(chunk.subarray(0, kept * FIELDS))
    count += kept
    if (now() - sliceStart >= sliceMillis) {
      yield
      sliceStart = now()
    }
  }

  // One buffer; with the radius brought in, only the stems inside it.
  const data = new Float32Array(count * FIELDS)
  let written = 0
  for (const chunk of chunks) {
    if (!clipped) {
      data.set(chunk, written * FIELDS)
      written += chunk.length / FIELDS
      continue
    }
    for (let k = 0; k < chunk.length; k += FIELDS)
      if (Math.hypot(chunk[k] - eyeX, chunk[k + 1] - eyeY) < radius) {
        data.set(chunk.subarray(k, k + FIELDS), written * FIELDS)
        written++
      }
  }
  return {
    fields: SCENE_TREE_FIELDS,
    species,
    count: written,
    data: written === count ? data : data.slice(0, written * FIELDS),
    radiusMeters: radius,
    requestedRadiusMeters: requested,
    bearings,
    clipped,
    spacingMeters: band.spacing,
    millis: Math.round(now() - started),
  }
}

/** Grows the stand, handing the thread back between slices so the page keeps drawing. */
export async function buildFinalStand(input: FinalStandInput): Promise<FinalStand> {
  const steps = finalStandSteps(input)
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

/** The stand moved to another package origin (x and y shifted in place); the same stand when the origins match. */
export function moveStandOrigin(
  stand: FinalStand,
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
): FinalStand {
  const scale = metersPerDegree(to.lat)
  const dx = (from.lng - to.lng) * scale.lng
  const dy = (from.lat - to.lat) * scale.lat
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) return stand
  for (let k = 0; k < stand.data.length; k += FIELDS) {
    stand.data[k] += dx
    stand.data[k + 1] += dy
  }
  return stand
}
