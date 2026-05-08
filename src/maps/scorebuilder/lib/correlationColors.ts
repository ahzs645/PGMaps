import { bucketIndex, quantileBreaks } from './correlation'

export const BIVARIATE_3X3_PALETTE: string[][] = [
  ['#e8e8e8', '#b5d3e7', '#6c83b5'],
  ['#e4acac', '#ad9ea5', '#7d6892'],
  ['#c85a5a', '#985356', '#574249'],
]

export const BIVARIATE_NEUTRAL_FILL = '#3f3f46'

export interface BivariateBreaks {
  xBreaks: number[]
  yBreaks: number[]
}

export function buildBivariateBreaks(xValues: number[], yValues: number[]): BivariateBreaks {
  return {
    xBreaks: quantileBreaks(xValues, 3),
    yBreaks: quantileBreaks(yValues, 3),
  }
}

export function getBivariateColor(x: number, y: number, breaks: BivariateBreaks): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return BIVARIATE_NEUTRAL_FILL
  if (!breaks.xBreaks.length || !breaks.yBreaks.length) return BIVARIATE_NEUTRAL_FILL
  const xIndex = Math.min(2, Math.max(0, bucketIndex(x, breaks.xBreaks)))
  const yIndex = Math.min(2, Math.max(0, bucketIndex(y, breaks.yBreaks)))
  return BIVARIATE_3X3_PALETTE[yIndex][xIndex]
}

export const RESIDUAL_NEGATIVE_COLOR = '#1d4ed8'
export const RESIDUAL_NEUTRAL_COLOR = '#f1f5f9'
export const RESIDUAL_POSITIVE_COLOR = '#b91c1c'

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '')
  const value = parseInt(cleaned, 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`
}

function lerpColor(a: string, b: string, t: number): string {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  return rgbToHex([
    ra[0] + (rb[0] - ra[0]) * t,
    ra[1] + (rb[1] - ra[1]) * t,
    ra[2] + (rb[2] - ra[2]) * t,
  ])
}

export function getResidualColor(residual: number, maxAbsResidual: number): string {
  if (!Number.isFinite(residual) || maxAbsResidual <= 0) return BIVARIATE_NEUTRAL_FILL
  const ratio = Math.max(-1, Math.min(1, residual / maxAbsResidual))
  if (ratio === 0) return RESIDUAL_NEUTRAL_COLOR
  if (ratio > 0) return lerpColor(RESIDUAL_NEUTRAL_COLOR, RESIDUAL_POSITIVE_COLOR, ratio)
  return lerpColor(RESIDUAL_NEUTRAL_COLOR, RESIDUAL_NEGATIVE_COLOR, -ratio)
}
