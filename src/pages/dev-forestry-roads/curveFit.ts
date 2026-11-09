/**
 * What to say beside a curve input when the value typed was not the value applied: limited to the
 * range, or not fitted to the tangents. Each note names the numbers and ends with the remedies.
 * The facts come from the engine (`horizontalCurveFits`, `verticalCurveSummary`). No DOM.
 */
import { MAX_HORIZONTAL_RADIUS_M, type HorizontalCurveFit, type verticalCurveSummary } from './engine'

const metres = (value: number, digits = 1) =>
  value.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
/** A length that must stay inside a limit is rounded down, so the suggestion itself fits. */
const within = (value: number) => metres(Math.floor(value * 10) / 10)

/** Holds a typed radius to the allowed range and says so when it had to. */
export function limitedRadius(entered: number): { radiusM: number; note: string | null } {
  const radiusM = Math.max(0, Math.min(MAX_HORIZONTAL_RADIUS_M, entered))
  return {
    radiusM,
    note:
      radiusM === entered
        ? null
        : `Limited to ${metres(radiusM)} m: ${metres(entered)} m is ${entered < 0 ? 'below zero' : 'over the largest radius'}.`,
  }
}

/** Null when the entered radius was applied as typed, or when there is nothing to fit. */
export function horizontalFitNote(fit: HorizontalCurveFit | undefined): string | null {
  if (!fit || fit.status === 'fitted' || fit.status === 'sharp' || fit.status === 'straight') return null
  if (fit.status === 'reversal')
    return `Not fitted: the road turns back on itself at point ${fit.point}, so no curve joins the two legs. The corner stays sharp. Move the points to open the angle.`
  const largest =
    fit.maxRadiusM !== null && fit.maxRadiusM >= 1
      ? ` The largest radius that fits is ${within(fit.maxRadiusM)} m.`
      : ''
  if (fit.status === 'overlap') {
    const shared = Math.min(fit.backM, fit.aheadM)
    return `Not fitted: R ${metres(fit.radiusM)} needs ${metres(fit.tangentM)} m of tangent, and point ${fit.neighbourPoint}'s curve leaves ${metres(shared)} m of the leg between them. Both corners stay sharp.${largest} Shorten this curve, shorten point ${fit.neighbourPoint}'s, or move the points apart.`
  }
  const back = fit.backM <= fit.aheadM
  return `Not fitted: R ${metres(fit.radiusM)} needs ${metres(fit.tangentM)} m of tangent, and the leg ${back ? 'back to' : 'ahead to'} point ${back ? fit.point - 1 : fit.point + 1} has ${metres(Math.min(fit.backM, fit.aheadM))} m. The corner stays sharp.${largest} Shorten this curve, shorten a neighbouring one, or move the points to lengthen the leg or reduce the angle.`
}

type VerticalCurve = ReturnType<typeof verticalCurveSummary>[number]

/** Null when the entered vertical curve was applied, or none was entered. */
export function verticalFitNote(curve: VerticalCurve | undefined): string | null {
  if (!curve || curve.valid || !curve.reason) return null
  if (curve.reason === 'end')
    return `Not applied: PVI ${curve.pvi} is an end of the profile, where there is no change of grade to round. Set its curve length to 0.`
  const half = curve.length / 2,
    back = curve.backM <= curve.aheadM,
    room = Math.min(curve.backM, curve.aheadM)
  const neighbour = back ? curve.pvi - 1 : curve.pvi + 1
  const fits = room > 0 ? ` A curve of ${within(2 * room)} m or less fits.` : ''
  return curve.reason === 'overlap'
    ? `Not fitted: this ${metres(curve.length)} m curve needs ${metres(half)} m of tangent each side, and PVI ${neighbour}'s curve leaves ${metres(room)} m between them. Tangent grades are kept at both.${fits} Shorten this curve, shorten PVI ${neighbour}'s, or move the PVIs apart.`
    : `Not fitted: this ${metres(curve.length)} m curve needs ${metres(half)} m of tangent each side, and ${metres(room)} m is available ${back ? 'back to' : 'ahead to'} PVI ${neighbour}. Tangent grades are kept.${fits} Shorten this curve, shorten a neighbouring one, or move the PVIs apart.`
}
