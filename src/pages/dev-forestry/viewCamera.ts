/**
 * A planned view's own camera (backlog VQ-13): its lens as entered, and a surveyed eye.
 *
 * A historical VIA's frame is often not one of the four lenses offered: its camera block states a field of view, or a
 * focal length on a sensor of its own. A view keeps the lens as it was entered (`ViewLensEntry`: a horizontal field
 * in degrees, or a focal length with its crop factor, 1 for a 35 mm-equivalent figure) beside its full-frame-equivalent
 * `focalMm`, which every older reader and the capture key go on reading. The field across is exact either way.
 *
 * The eye a view is captured from can be surveyed (`ViewEye`): an elevation above sea level, or a height above the
 * terrain model's ground. An elevation stands the eye there as a stood-at viewpoint's surveyed eye does (a run input
 * at that stand, as a photo viewpoint's altitude is); a height above the ground raises or lowers only the road view's
 * eye while it stands at the view, and the capture with it, never the run's stations. Where the surveyed elevation
 * and the terrain model disagree by more than `EYE_GROUND_TOLERANCE_METERS` it is flagged, never refused: the
 * reviewer sees both numbers on the view's row and on the figure's camera information.
 *
 * Pure: no DOM or network access.
 */
import { verticalFovFromHorizontal } from './exifPose'

/** A full-frame sensor's half width, millimetres: a focal length's field across is read on a 36 mm frame. */
export const HALF_FRAME_MM = 18

/** The horizontal field of a full-frame-equivalent focal length, degrees. */
export function lensHfovDeg(focalMm: number): number {
  return (2 * Math.atan(HALF_FRAME_MM / focalMm) * 180) / Math.PI
}

/** The full-frame-equivalent focal length of a field across, millimetres: `lensHfovDeg`'s inverse. */
export function focalForHfov(hfovDeg: number): number {
  return HALF_FRAME_MM / Math.tan((hfovDeg * Math.PI) / 360)
}

/** The full-frame-equivalent focal lengths a view takes, as `parseViewsOfInterest` has always read them. */
export const MIN_EQUIVALENT_FOCAL_MM = 10
export const MAX_EQUIVALENT_FOCAL_MM = 300
/** The fields across those focal lengths give, degrees (about 6.9° to 121.9°). */
export const MIN_HFOV_DEG = lensHfovDeg(MAX_EQUIVALENT_FOCAL_MM)
export const MAX_HFOV_DEG = lensHfovDeg(MIN_EQUIVALENT_FOCAL_MM)
/** Crop factors a camera body can have: a medium-format back (0.5) to a phone's small sensor (10). */
export const MIN_CROP_FACTOR = 0.5
export const MAX_CROP_FACTOR = 10

/** How a view's lens was entered: its field across, or a focal length on a sensor with that crop factor. */
export type ViewLensEntry = { kind: 'hfov'; hfovDeg: number } | { kind: 'focal'; focalMm: number; cropFactor: number }

/** The full-frame-equivalent focal length an entry gives, millimetres. */
export function equivalentFocalMm(entry: ViewLensEntry): number {
  return entry.kind === 'hfov' ? focalForHfov(entry.hfovDeg) : entry.focalMm * entry.cropFactor
}

/** The field across an entry gives, degrees: exact for a field entered as one. */
export function lensEntryHfov(entry: ViewLensEntry): number {
  return entry.kind === 'hfov' ? entry.hfovDeg : lensHfovDeg(equivalentFocalMm(entry))
}

/** Why an entry cannot be used, or null: its equivalent focal length must be one a view can hold. */
export function lensEntryProblem(entry: ViewLensEntry): string | null {
  if (entry.kind === 'focal') {
    if (!(entry.focalMm > 0)) return 'A focal length is more than 0 mm.'
    if (!(entry.cropFactor >= MIN_CROP_FACTOR && entry.cropFactor <= MAX_CROP_FACTOR))
      return `A crop factor runs from ${MIN_CROP_FACTOR} to ${MAX_CROP_FACTOR} (1 for a 35 mm-equivalent figure).`
  }
  const focal = equivalentFocalMm(entry)
  if (!(focal >= MIN_EQUIVALENT_FOCAL_MM - 1e-9 && focal <= MAX_EQUIVALENT_FOCAL_MM + 1e-9))
    return `The road view takes ${MIN_EQUIVALENT_FOCAL_MM} to ${MAX_EQUIVALENT_FOCAL_MM} mm full-frame equivalent (${MAX_HFOV_DEG.toFixed(1)}° to ${MIN_HFOV_DEG.toFixed(1)}° across); this is ${focal.toFixed(1)} mm.`
  return null
}

/** Both fields of a frame `width` × `height` for a field across, degrees. */
export function fieldsOfView(hfovDeg: number, width: number, height: number): { hfovDeg: number; vfovDeg: number } {
  return { hfovDeg, vfovDeg: verticalFovFromHorizontal(hfovDeg, width, height) }
}

/** "80.0 mm full-frame equivalent" with a tenth only where it has one. */
export function focalLabel(focalMm: number): string {
  const tenth = Math.round(focalMm * 10) / 10
  return `${Number.isInteger(tenth) ? tenth : tenth.toFixed(1)} mm`
}

/** "25.4° across, as entered (79.9 mm full-frame equivalent)", "50 mm × 1.6 crop: 80 mm equivalent, 25.4° across". */
export function lensEntryLabel(entry: ViewLensEntry): string {
  const hfov = lensEntryHfov(entry)
  if (entry.kind === 'hfov')
    return `${hfov.toFixed(1)}° across, as entered (${focalLabel(equivalentFocalMm(entry))} full-frame equivalent)`
  return entry.cropFactor === 1
    ? `${focalLabel(entry.focalMm)} (35 mm equivalent), ${hfov.toFixed(1)}° across`
    : `${focalLabel(entry.focalMm)} × ${entry.cropFactor} crop: ${focalLabel(equivalentFocalMm(entry))} equivalent, ${hfov.toFixed(1)}° across`
}

/** The entry as the camera information block prints it, in plain characters: "50 mm lens x 1.6 crop". */
export function lensEntryNote(entry: ViewLensEntry): string {
  if (entry.kind === 'hfov') return `${entry.hfovDeg.toFixed(1)} degrees across`
  return entry.cropFactor === 1
    ? `${focalLabel(entry.focalMm)}, 35 mm equivalent`
    : `${focalLabel(entry.focalMm)} lens x ${entry.cropFactor} crop`
}

/** Reads a kept entry; one that does not read, or names a lens a view cannot hold, is dropped. */
export function parseViewLens(raw: unknown): ViewLensEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  const entry: ViewLensEntry | null =
    value.kind === 'hfov' && finite(value.hfovDeg)
      ? { kind: 'hfov', hfovDeg: value.hfovDeg }
      : value.kind === 'focal' && finite(value.focalMm) && finite(value.cropFactor)
        ? { kind: 'focal', focalMm: value.focalMm, cropFactor: value.cropFactor }
        : null
  return entry && !lensEntryProblem(entry) ? entry : null
}

/**
 * A view's surveyed eye: `elevation`, metres above sea level (a GNSS reading, a VIA's camera block), or `ground`,
 * metres above the terrain model's ground under the view (a truck cab, a lookout's deck). Absent: the eye stands at
 * the run's eye height over the terrain model, as every view always has.
 */
export type ViewEye = { reference: 'elevation' | 'ground'; meters: number }

/** Plausible values: as a stood-at viewpoint's surveyed eye (`viewpointStand.ts`), and a height a person stands at. */
export const MIN_EYE_ELEVATION_METERS = -500
export const MAX_EYE_ELEVATION_METERS = 9000
export const MIN_EYE_HEIGHT_METERS = 0.1
export const MAX_EYE_HEIGHT_METERS = 500

/**
 * How far a surveyed eye may sit from the terrain model's eye (its ground plus the eye height) before the view is
 * flagged, metres. A screen, not a standard: the regional DEM's own vertical error is a few metres, and a lookout on a
 * bluff or a cut bank is where the two part.
 */
export const EYE_GROUND_TOLERANCE_METERS = 3

export function viewEyeProblem(eye: ViewEye): string | null {
  if (!Number.isFinite(eye.meters)) return 'Type a number of metres.'
  if (eye.reference === 'elevation')
    return eye.meters >= MIN_EYE_ELEVATION_METERS && eye.meters <= MAX_EYE_ELEVATION_METERS
      ? null
      : `An eye elevation runs from ${MIN_EYE_ELEVATION_METERS} to ${MAX_EYE_ELEVATION_METERS} m above sea level.`
  return eye.meters >= MIN_EYE_HEIGHT_METERS && eye.meters <= MAX_EYE_HEIGHT_METERS
    ? null
    : `A height above the ground runs from ${MIN_EYE_HEIGHT_METERS} to ${MAX_EYE_HEIGHT_METERS} m.`
}

export function parseViewEye(raw: unknown): ViewEye | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value.reference !== 'elevation' && value.reference !== 'ground') return null
  if (typeof value.meters !== 'number') return null
  const eye: ViewEye = { reference: value.reference, meters: value.meters }
  return viewEyeProblem(eye) ? null : eye
}

/** "812.4 m above sea level, surveyed", "3.0 m above the terrain model's ground". */
export function viewEyeLabel(eye: ViewEye): string {
  return eye.reference === 'elevation'
    ? `${eye.meters.toFixed(1)} m above sea level, surveyed`
    : `${eye.meters.toFixed(1)} m above the terrain model's ground`
}

/** A surveyed elevation against the terrain model's eye there. */
export type EyeCheck = {
  surveyedEyeMeters: number
  modelGroundMeters: number
  /** The model's ground plus the eye height the run uses. */
  modelEyeMeters: number
  /** Surveyed minus the model's eye: negative when the surveyed eye is lower. */
  differenceMeters: number
  /** The surveyed eye is below the model's ground itself: the model's hillside hides what the real eye sees. */
  belowGround: boolean
  /** Apart by more than `EYE_GROUND_TOLERANCE_METERS`. */
  flagged: boolean
  toleranceMeters: number
}

/**
 * Compares a surveyed elevation with the terrain model's eye at the view; null for a height above the ground (it
 * stands on the model by definition) or where the model's ground is not known.
 */
export function eyeCheck(
  eye: ViewEye | null | undefined,
  modelGroundMeters: number | null | undefined,
  eyeHeightMeters: number,
  toleranceMeters = EYE_GROUND_TOLERANCE_METERS,
): EyeCheck | null {
  if (!eye || eye.reference !== 'elevation') return null
  if (modelGroundMeters === null || modelGroundMeters === undefined || !Number.isFinite(modelGroundMeters)) return null
  const modelEyeMeters = modelGroundMeters + eyeHeightMeters
  const differenceMeters = eye.meters - modelEyeMeters
  return {
    surveyedEyeMeters: eye.meters,
    modelGroundMeters,
    modelEyeMeters,
    differenceMeters,
    belowGround: eye.meters < modelGroundMeters,
    flagged: Math.abs(differenceMeters) > toleranceMeters,
    toleranceMeters,
  }
}

/** "Surveyed eye 812.0 m is 12.2 m below the terrain model's eye (822.6 m ground + 1.6 m)." */
export function eyeCheckText(check: EyeCheck): string {
  const apart = Math.abs(check.differenceMeters)
  const side = check.differenceMeters < 0 ? 'below' : 'above'
  const eyeHeight = check.modelEyeMeters - check.modelGroundMeters
  return `Surveyed eye ${check.surveyedEyeMeters.toFixed(1)} m is ${apart.toFixed(1)} m ${side} the terrain model's eye (${check.modelGroundMeters.toFixed(1)} m ground + ${eyeHeight.toFixed(1)} m)${check.belowGround ? ', under the model’s ground, which hides what it sees' : ''}.`
}

/**
 * What a planned view is captured with: its field across (a photo's own, else its lens entry's, else its focal
 * length's), its full-frame-equivalent focal length, and its eye: an elevation the stand's eye stands at (a photo's
 * altitude, else a surveyed elevation), or a height above the terrain model's ground for the road view's eye. The
 * page's stand, facing and save all read it, so the capture is the camera the row shows.
 */
export type ViewCaptureCamera = {
  hfovDeg: number
  focalMm: number
  /** Metres above sea level; null: the eye stands on the terrain model. */
  surveyedEyeMeters: number | null
  /** Metres above the terrain model's ground; null: the run's eye height. */
  eyeHeightMeters: number | null
}

export function viewCaptureCamera(view: {
  focalMm: number
  lens?: ViewLensEntry | null
  eye?: ViewEye | null
  photo?: { hfov: number; altitudeMeters: number | null } | null
}): ViewCaptureCamera {
  const photo = view.photo
  const hfovDeg =
    photo && Number.isFinite(photo.hfov) && photo.hfov > 0
      ? photo.hfov
      : view.lens
        ? lensEntryHfov(view.lens)
        : lensHfovDeg(view.focalMm)
  // A photo's camera is the photo's: its altitude, or eye height over the ground when it has none.
  const eye = photo ? null : (view.eye ?? null)
  return {
    hfovDeg,
    focalMm: view.focalMm,
    surveyedEyeMeters: photo ? photo.altitudeMeters : eye?.reference === 'elevation' ? eye.meters : null,
    eyeHeightMeters: eye?.reference === 'ground' ? eye.meters : null,
  }
}
