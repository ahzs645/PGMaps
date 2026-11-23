/**
 * The pixel measure with the drawn timber in front, for PGMaps' own renderer, from two pictures of one framing: the
 * before-harvest render and the after picture the figure was drawn on. The road view grows its stand from seeds keyed
 * to each cell's own coordinates, so the two renders differ only where harvest cleared the ground. A pixel the class
 * pass gives to a proposed block (the ground under the trees) whose colour changes between before and after is the
 * block's cut ground seen past the drawn timber; one that does not change is hidden by timber standing in front of
 * it (or by the block's own stand in a gap the picture cannot tell apart, which errs toward less alteration).
 *
 * The result is a class raster like an engine's screened pass: a hidden block pixel inside the landform reads as
 * landform and one outside it as other terrain, so the landform's pixels (the denominator) are those of the ground
 * pass and only the proposed count falls. Existing openings are not harvested between the two pictures, so they
 * cannot be told apart this way: they keep the ground pass's count. No DOM or network access.
 */
import { countClasses, FIGURE_CLASS, type ClassRaster, type FigureCounts } from './composeFigure'

/**
 * RGB distance (0–441) past which a pixel has changed between the before and after pictures. The two renders of a
 * view with nothing harvested in sight (marblehead-vp1-hwy31, 2400 × 2769) differ past 32 in 23 pixels of 6.6
 * million; cut ground against standing timber differs by about 100 or more.
 */
export const TIMBER_CHANGE_DISTANCE = 32

/** Straight RGBA pixels, row-major from the top-left. */
export interface RgbaPixels {
  data: ArrayLike<number>
  width: number
  height: number
}

/** Why a view has no with-timber figure, as the sheet and the reports print it after "not measured". */
export const TIMBER_ABSENT = {
  noBefore: 'no before-harvest render of this view',
  roadViewClosed: 'the road view was closed, so no before-harvest render was taken',
  terrainLoading: 'the road view’s terrain was still loading, so no before-harvest render was taken',
  elsewhere:
    'the view was saved at another place and no before-harvest render was taken there (the road view draws only where you stand): capture it again, or save it again standing there',
  savedBefore: 'the view was saved before harvest',
  noClassPass: 'the view has no class pass',
  noFrame: 'the view has no framed capture',
  size: 'the before render and the figure were not drawn at one size',
} as const

export type TimberMeasure =
  | {
      kind: 'measured'
      /** The class pass with every proposed pixel the timber hides read as the ground in front of it. */
      classes: ClassRaster
      /** Proposed pixels in the landform in the ground pass, and those seen past the timber. */
      proposedPx: number
      seenPx: number
    }
  | { kind: 'absent'; reason: string }

/** Whether pixel `k` differs between two RGBA pictures by more than `threshold`. */
const changed = (a: ArrayLike<number>, b: ArrayLike<number>, k: number, threshold: number) => {
  const o = k * 4
  const dr = a[o] - b[o],
    dg = a[o + 1] - b[o + 1],
    db = a[o + 2] - b[o + 2]
  return dr * dr + dg * dg + db * db > threshold * threshold
}

/**
 * The with-timber class raster of a view: `classes` (the ground pass) with each proposed pixel that does not change
 * between `before` and `after` given to the ground in front of it. All three must be one size.
 */
export function timberScreenedClasses(
  classes: ClassRaster,
  before: RgbaPixels,
  after: RgbaPixels,
  threshold = TIMBER_CHANGE_DISTANCE,
): TimberMeasure {
  const { width, height } = classes
  const n = width * height
  if (
    before.width !== width ||
    before.height !== height ||
    after.width !== width ||
    after.height !== height ||
    before.data.length < n * 4 ||
    after.data.length < n * 4
  )
    return { kind: 'absent', reason: TIMBER_ABSENT.size }
  const codes = new Uint8Array(classes.codes)
  let proposedPx = 0,
    seenPx = 0
  for (let k = 0; k < n; k++) {
    const code = codes[k]
    if (code !== FIGURE_CLASS.proposedIn && code !== FIGURE_CLASS.proposedOut) continue
    const inside = code === FIGURE_CLASS.proposedIn
    if (inside) proposedPx++
    if (changed(before.data, after.data, k, threshold)) {
      if (inside) seenPx++
    } else codes[k] = inside ? FIGURE_CLASS.landform : FIGURE_CLASS.terrain
  }
  return { kind: 'measured', classes: { width, height, codes }, proposedPx, seenPx }
}

/** The counts a with-timber measure gives, or null when it is absent. */
export const timberCounts = (measure: TimberMeasure | null | undefined): FigureCounts | null =>
  measure?.kind === 'measured' ? countClasses(measure.classes) : null
