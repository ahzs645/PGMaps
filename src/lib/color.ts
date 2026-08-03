/**
 * Hex colour parsing shared by the map layers. All entry points accept both
 * `#rgb` and `#rrggbb` (with or without the leading '#'), because palettes in
 * this repo use both and several hand-rolled copies of these helpers silently
 * produced NaN channels for the 3-digit form.
 */

function normalizeHex(hex: string): string | null {
  const cleaned = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(cleaned)) {
    return cleaned
      .split('')
      .map((char) => char + char)
      .join('')
  }
  return /^[0-9a-f]{6}$/i.test(cleaned) ? cleaned : null
}

/** Returns black for unparseable input; use {@link parseHex} to detect that case. */
export function hexToRgb(hex: string): [number, number, number] {
  return parseHex(hex) ?? [0, 0, 0]
}

/** Channel triple, or null when the string is not a valid 3- or 6-digit hex colour. */
export function parseHex(hex: string): [number, number, number] | null {
  const normalized = normalizeHex(hex)
  if (!normalized) return null
  const value = Number.parseInt(normalized, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** CSS `rgba(...)` string. `alpha` is 0-1, as CSS expects. */
export function hexToRgba(hex: string, alpha: number): string {
  const [red, green, blue] = hexToRgb(hex)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

/**
 * Channel array for deck.gl, whose `alpha` is 0-255. Unparseable input yields a
 * fully transparent colour so a bad palette entry disappears instead of
 * painting the feature black.
 */
export function hexToRgbaArray(hex: string, alpha = 255): [number, number, number, number] {
  const parsed = parseHex(hex)
  return parsed ? [parsed[0], parsed[1], parsed[2], alpha] : [0, 0, 0, 0]
}

export function rgbToHex([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
    .join('')}`
}
