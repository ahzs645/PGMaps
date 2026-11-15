/**
 * Colours as each format writes them. Symbols hold CSS colours (`#rrggbb`, `#rgb`, `#rrggbbaa`,
 * `rgb()`/`rgba()`); formats want 0–255 channels with alpha as 0–255 (QGIS, MapLibre sprites),
 * 0–100 (CIM) or 0–1 (SLD opacity). No DOM or network access.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0–1. */
  a: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Parses a CSS colour, or returns null when it is not one of the forms above. */
export function parseColor(input: string): Rgba | null {
  const text = input.trim().toLowerCase()
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  let match = /^#([0-9a-f]{3,4})$/.exec(text)
  if (match) {
    const [r, g, b, a = 'f'] = match[1].split('').map((c) => c)
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
      a: parseInt(a + a, 16) / 255,
    }
  }
  match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(text)
  if (match)
    return {
      r: parseInt(match[1].slice(0, 2), 16),
      g: parseInt(match[1].slice(2, 4), 16),
      b: parseInt(match[1].slice(4, 6), 16),
      a: match[2] ? parseInt(match[2], 16) / 255 : 1,
    }
  match = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(text)
  if (match) {
    const alpha =
      match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4])
    return {
      r: clamp(Math.round(+match[1]), 0, 255),
      g: clamp(Math.round(+match[2]), 0, 255),
      b: clamp(Math.round(+match[3]), 0, 255),
      a: clamp(alpha, 0, 1),
    }
  }
  return null
}

/** Parses a colour, falling back to opaque black for an unreadable one. */
export const rgba = (input: string): Rgba => parseColor(input) ?? { r: 0, g: 0, b: 0, a: 1 }

const hex2 = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')

/** `#rrggbb`, dropping alpha. */
export const toHex = ({ r, g, b }: Rgba) => `#${hex2(r)}${hex2(g)}${hex2(b)}`

/** `#rrggbb`, or `#rrggbbaa` when the colour is not opaque. */
export const toHexAlpha = (color: Rgba) => (color.a >= 1 ? toHex(color) : `${toHex(color)}${hex2(color.a * 255)}`)

/** A colour with its alpha multiplied by `opacity` (0–1, default 1). */
export function withOpacity(input: string, opacity = 1): Rgba {
  const color = rgba(input)
  return { ...color, a: clamp(color.a * opacity, 0, 1) }
}

/** Rounds an alpha to the 0–255 scale QGIS and PNG use. */
export const alpha255 = (color: Rgba) => clamp(Math.round(color.a * 255), 0, 255)
