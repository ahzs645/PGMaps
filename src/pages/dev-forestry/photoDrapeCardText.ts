/**
 * The photo drape card's line about which camera the drape was laid for (`PhotoDrapeCard`). Kept free of DOM
 * access so the tests read it.
 */

/** A drape laid within this of the camera's heading now is still the camera's: the steps' own 0.5° (`ownPhotoSteps`). */
export const DRAPE_HEADING_TOLERANCE = 0.5

/** The smaller angle between two compass headings, degrees; null when either is missing. */
export function headingGap(a: number | null, b: number | null): number | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return Math.min(d, 360 - d)
}

const degrees = (value: number, digits = 0) => {
  const step = 10 ** digits
  const wrapped = (((Math.round(value * step) / step) % 360) + 360) % 360
  return `${wrapped.toFixed(digits)}°`
}

/**
 * "Drawn for heading 212°" while the drape is the camera's; "Drawn for heading 212°, now 218°" (and `moved`) once
 * the camera has turned past the tolerance, until the drape is laid again. Null without a drape.
 */
export function drawnForLine(
  drawnForBearing: number | null,
  currentBearing: number | null,
): { text: string; moved: boolean } | null {
  if (drawnForBearing === null || !Number.isFinite(drawnForBearing)) return null
  const gap = headingGap(drawnForBearing, currentBearing)
  if (gap === null || gap < DRAPE_HEADING_TOLERANCE)
    return { text: `Drawn for heading ${degrees(drawnForBearing)}`, moved: false }
  let [then, now] = [degrees(drawnForBearing), degrees(currentBearing!)]
  // Turned less than a degree: whole degrees would read the same, so say the tenth.
  if (then === now) [then, now] = [degrees(drawnForBearing, 1), degrees(currentBearing!, 1)]
  return { text: `Drawn for heading ${then}, now ${now}`, moved: true }
}
