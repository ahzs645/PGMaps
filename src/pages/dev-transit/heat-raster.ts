import type { HeatTheme } from './types'

export const PALETTE = ['#2f9612', '#7ec850', '#e2e478', '#f4b670', '#e27878']
export const DARK_PALETTE = ['#179963', '#6bb85a', '#d4b64c', '#dd9354', '#df756a']
export const heatPalette = (theme: HeatTheme) => (theme === 'dark' ? DARK_PALETTE : PALETTE)
const RGB = {
  light: PALETTE.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))),
  dark: DARK_PALETTE.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))),
}
const FADE = 1.15
const LUT_SIZE = 1024
export const HEAT_UPSAMPLE = 2

/** Premultiplied interpolation keeps opacity and luminance stable. */
export function blendHeatPixels(
  previous: Uint8ClampedArray,
  next: Uint8ClampedArray,
  progress: number,
  out: Uint8ClampedArray,
) {
  const p = Math.max(0, Math.min(1, progress))
  for (let i = 0; i < out.length; i += 4) {
    const a = previous[i + 3] * (1 - p),
      b = next[i + 3] * p,
      alpha = a + b
    out[i + 3] = alpha
    for (let channel = 0; channel < 3; channel++)
      out[i + channel] = alpha ? (previous[i + channel] * a + next[i + channel] * b) / alpha : 0
  }
}

export function heatColor(minutes: number, max: number, theme: HeatTheme = 'light'): [number, number, number, number] {
  if (minutes < 0 || !Number.isFinite(minutes) || minutes > max * FADE) return [0, 0, 0, 0]
  const value = Math.max(0, Math.min(1, minutes / max)) * (PALETTE.length - 1)
  const index = Math.min(PALETTE.length - 2, Math.floor(value)),
    ratio = value - index
  const opacity = theme === 'dark' ? 145 : 155
  const alpha = minutes <= max ? opacity : opacity * (1 - (minutes - max) / (max * (FADE - 1)))
  const rgb = RGB[theme]
  return [...rgb[index].map((c, i) => Math.round(c + (rgb[index + 1][i] - c) * ratio)), Math.round(alpha)] as [
    number,
    number,
    number,
    number,
  ]
}

function axis(size: number, scale: number) {
  const low = new Int32Array(size * scale),
    high = new Int32Array(size * scale),
    fraction = new Float32Array(size * scale)
  for (let i = 0; i < low.length; i++) {
    const position = Math.max(0, Math.min(size - 1, (i + 0.5) / scale - 0.5))
    low[i] = Math.floor(position)
    high[i] = Math.min(size - 1, low[i] + 1)
    fraction[i] = position - low[i]
  }
  return { low, high, fraction }
}

/** Interpolate travel minutes before colouring, with a separate access mask.
 * Missing access contributes no value and fades coverage rather than turning
 * into a zero-minute shortcut or getting filled across disconnected areas.
 */
export function makeHeatRaster(grid: number[], cols: number, rows: number, max: number, theme: HeatTheme = 'light') {
  const width = cols * HEAT_UPSAMPLE,
    height = rows * HEAT_UPSAMPLE
  const pixels = new Uint8ClampedArray(width * height * 4)
  const lut = new Uint8ClampedArray(LUT_SIZE * 4)
  for (let i = 0; i < LUT_SIZE; i++) lut.set(heatColor((i * max * FADE) / (LUT_SIZE - 1), max, theme), i * 4)
  const x = axis(cols, HEAT_UPSAMPLE),
    y = axis(rows, HEAT_UPSAMPLE)
  const toLut = (LUT_SIZE - 1) / (max * FADE)
  for (let row = 0; row < height; row++) {
    const ty = y.fraction[row],
      top = y.low[row] * cols,
      bottom = y.high[row] * cols
    for (let col = 0; col < width; col++) {
      const tx = x.fraction[col]
      const v00 = grid[top + x.low[col]],
        v01 = grid[top + x.high[col]]
      const v10 = grid[bottom + x.low[col]],
        v11 = grid[bottom + x.high[col]]
      let sum = 0,
        coverage = 0
      const w00 = (1 - tx) * (1 - ty),
        w01 = tx * (1 - ty),
        w10 = (1 - tx) * ty,
        w11 = tx * ty
      if (v00 >= 0 && Number.isFinite(v00)) {
        sum += v00 * w00
        coverage += w00
      }
      if (v01 >= 0 && Number.isFinite(v01)) {
        sum += v01 * w01
        coverage += w01
      }
      if (v10 >= 0 && Number.isFinite(v10)) {
        sum += v10 * w10
        coverage += w10
      }
      if (v11 >= 0 && Number.isFinite(v11)) {
        sum += v11 * w11
        coverage += w11
      }
      if (!coverage) continue
      const value = sum / coverage
      if (value > max * FADE) continue
      const index = Math.round(value * toLut) * 4,
        offset = (row * width + col) * 4
      pixels[offset] = lut[index]
      pixels[offset + 1] = lut[index + 1]
      pixels[offset + 2] = lut[index + 2]
      pixels[offset + 3] = lut[index + 3] * coverage
    }
  }
  return { width, height, pixels }
}
