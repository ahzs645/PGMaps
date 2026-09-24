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

export interface ReadableTextColorOptions {
  /** Relative luminance (0-1) above which the dark colour is used. */
  threshold?: number
  dark?: string
  light?: string
  /** Luma weights: Rec. 601 (0.299/0.587/0.114, the default) or Rec. 709. */
  weights?: '601' | '709'
}

/**
 * Text colour that stays legible on `background`: dark on light fills, light
 * on dark ones. Callers that previously tuned their own threshold or dark
 * shade pass them here so markers keep their exact look.
 */
export function readableTextColor(
  background: string,
  { threshold = 0.58, dark = '#111827', light = '#ffffff', weights = '601' }: ReadableTextColorOptions = {},
): string {
  const [red, green, blue] = hexToRgb(background)
  const luminance =
    weights === '709'
      ? (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
      : (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  return luminance > threshold ? dark : light
}

/**
 * Stable colour for a category key: an explicit entry when the palette names
 * one, otherwise a fallback picked by hashing the key, so a category keeps its
 * colour between renders and sessions without being listed.
 */
export function colorForKey(
  key: string,
  named: Readonly<Record<string, string>>,
  fallbackPalette: readonly string[],
): string {
  const normalized = key.trim().toLowerCase()
  if (named[normalized]) return named[normalized]
  if (fallbackPalette.length === 0) return '#64748b'
  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0
  }
  return fallbackPalette[hash % fallbackPalette.length]
}
