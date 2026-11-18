/**
 * The matchers the flight match can pair two photos with, and the arithmetic the learned one needs outside its
 * network.
 *
 * - `xfeat`: the XFeat extractor bundled with the app and reciprocal nearest descriptors. Nothing to download.
 * - `aliked-lightglue`: the ALIKED detector and the LightGlue matcher trained for it, as WebSfM exports them
 *   (`NOTICE-PHOTO-MATCH-MODELS.md`). Optional: the two files are not in the repository; a site serves them from
 *   `photoMatchModels.json`'s folder once `npm run photo-match:fetch-models` has put them there.
 *
 * Measured on one flight of fourteen helicopter photos (18 November 2026, outside the browser): the learned pair
 * matched two frames taken 3.6 s apart with a 26 mm and then a 52 mm lens (358 verified matches) and two frames a
 * minute apart that descriptors alone left at 14.
 *
 * Free of DOM and network access.
 */
import models from './photoMatchModels.json'

export type PhotoMatcher = 'xfeat' | 'aliked-lightglue'

export const PHOTO_MATCHERS: Record<PhotoMatcher, { label: string; megabytes: number | null }> = {
  xfeat: { label: 'XFeat', megabytes: null },
  'aliked-lightglue': {
    label: 'ALIKED + LightGlue',
    megabytes: Math.round((models.files.detector.size + models.files.matcher.size) / 1e6),
  },
}

export const isPhotoMatcher = (value: unknown): value is PhotoMatcher =>
  value === 'xfeat' || value === 'aliked-lightglue'

/** The learned matcher's files: where the site serves each from (a path from the site's root), and its exact size. */
export const LEARNED_MATCH_FILES = {
  detector: { path: models.folder + models.files.detector.path, size: models.files.detector.size },
  matcher: { path: models.folder + models.files.matcher.path, size: models.files.matcher.size },
} as const

/** The longer side ALIKED sees, the multiple its sides are held to, and how many keypoints go on to LightGlue. */
export const LEARNED_LONG_EDGE = 1024
export const LEARNED_SIDE_MULTIPLE = 32
export const LEARNED_MAX_KEYPOINTS = 2048
/** ALIKED's descriptor length; the detector's outputs are told apart by it. */
export const LEARNED_DESCRIPTOR_LENGTH = 128

/** The size a `width` × `height` picture is resized to for the detector. Never larger than the picture. */
export function learnedInputSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, LEARNED_LONG_EDGE / Math.max(width, height))
  const side = (value: number) =>
    Math.max(LEARNED_SIDE_MULTIPLE, Math.round((value * scale) / LEARNED_SIDE_MULTIPLE) * LEARNED_SIDE_MULTIPLE)
  return { width: side(width), height: side(height) }
}

/** The indices of the `limit` highest scores, highest first; ties keep their order. */
export function strongestKeypoints(scores: ArrayLike<number>, limit = LEARNED_MAX_KEYPOINTS): number[] {
  return Array.from({ length: scores.length }, (_, index) => index)
    .sort((a, b) => scores[b] - scores[a] || a - b)
    .slice(0, limit)
}

/**
 * Keypoints as LightGlue expects them: measured from the picture's centre, in units of half its longer side. A wrong
 * centre or scale here is not an error anywhere; the matcher only finds fewer matches.
 */
export function lightGlueKeypoints(points: ArrayLike<number>, width: number, height: number): Float32Array {
  const half = Math.max(width, height) / 2
  const out = new Float32Array(points.length)
  for (let i = 0; i < points.length; i += 2) {
    out[i] = (points[i] - width / 2) / half
    out[i + 1] = (points[i + 1] - height / 2) / half
  }
  return out
}

/** The rows `indices` name of a row-major table `length` wide, in that order. */
export function selectRows(table: ArrayLike<number>, indices: readonly number[], length: number): Float32Array {
  const out = new Float32Array(indices.length * length)
  for (const [row, index] of indices.entries())
    for (let i = 0; i < length; i++) out[row * length + i] = table[index * length + i]
  return out
}
