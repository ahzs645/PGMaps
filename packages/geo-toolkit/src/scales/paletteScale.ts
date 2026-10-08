import { bisectRight, color, interpolateLab, interpolateRgb, quantileSorted } from 'd3'

export type PaletteClassification = 'equal-interval' | 'quantile' | 'manual'
export interface PaletteSampling {
  colors: readonly string[]
  /** Optional source stop coordinates; unequal spacing is preserved. */
  positions?: readonly number[]
  range?: readonly [number, number]
  reverse?: boolean
  interpolation?: 'rgb' | 'lab'
}

/** D3's parser expects comma syntax; our CSS also uses modern space/slash RGB. */
function parseColor(value: string) {
  const normalized = value.replace(/\b(rgb|hsl)a?\(([^,)]+)\)/gi, (_, family: string, contents: string) => {
    const [channels, alpha] = contents.trim().split(/\s*\/\s*/)
    const parts = channels.trim().split(/\s+/)
    if (parts.length !== 3) return value
    const opacity = alpha?.endsWith('%') ? String(Number.parseFloat(alpha) / 100) : alpha
    return `${family}${opacity == null ? '' : 'a'}(${parts.join(',')}${opacity == null ? '' : `,${opacity}`})`
  })
  return color(normalized)
}

/** A colour interval is independent of the numeric domain being classified. */
export function paletteInterpolator({
  colors,
  positions,
  range = [0, 1],
  reverse = false,
  interpolation = 'rgb',
}: PaletteSampling) {
  if (!colors.length || colors.some((c) => !parseColor(c))) throw new Error('Palette must contain valid CSS colours.')
  if (!range.every(Number.isFinite) || range[0] < 0 || range[1] > 1 || range[0] > range[1])
    throw new Error('Palette range must be ordered within 0–1.')
  let stops = colors.map((_, i) => (colors.length === 1 ? 0 : i / (colors.length - 1)))
  if (positions) {
    if (
      positions.length !== colors.length ||
      positions.some((v, i) => !Number.isFinite(v) || (i > 0 && v <= positions[i - 1]))
    )
      throw new Error('Palette positions must be finite and strictly increasing.')
    const span = positions[positions.length - 1] - positions[0]
    stops = positions.map((v) => (span ? (v - positions[0]) / span : 0))
  }
  const interpolate = interpolation === 'lab' ? interpolateLab : interpolateRgb
  return (input: number): string => {
    if (!Number.isFinite(input)) throw new Error('Palette position must be finite.')
    const t = Math.max(0, Math.min(1, input))
    const position = range[0] + (reverse ? 1 - t : t) * (range[1] - range[0])
    if (colors.length === 1 || position <= stops[0]) return colors[0]
    if (position >= stops[stops.length - 1]) return colors[colors.length - 1]
    const i = bisectRight(stops, position) - 1
    return interpolate(
      parseColor(colors[i])!.formatRgb(),
      parseColor(colors[i + 1])!.formatRgb(),
    )((position - stops[i]) / (stops[i + 1] - stops[i]))
  }
}

export function samplePalette(options: PaletteSampling, count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 256) throw new Error('Choose 1–256 colour steps.')
  const at = paletteInterpolator(options)
  return Array.from({ length: count }, (_, i) => at(count === 1 ? 0.5 : i / (count - 1)))
}

export interface PaletteScaleOptions extends PaletteSampling {
  domain: readonly [number, number]
  classes: number
  classification?: PaletteClassification
  values?: readonly (number | null | undefined)[]
  breaks?: readonly number[]
  missingColor: string
}

/** Boundary values enter the upper bin. Out-of-domain values clamp to end bins. */
export function resolvePaletteScale(options: PaletteScaleOptions) {
  const {
    domain: [min, max],
    classes,
    classification = 'equal-interval',
    missingColor,
  } = options
  if (![min, max].every(Number.isFinite) || min > max) throw new Error('Data domain must be finite and ordered.')
  if (!Number.isInteger(classes) || classes < 1 || classes > 256) throw new Error('Choose 1–256 classes.')
  if (!parseColor(missingColor)) throw new Error('Missing-data colour is invalid.')
  let breaks: number[] = []
  if (classification === 'manual') {
    breaks = [...(options.breaks ?? [])]
    if (breaks.some((v, i) => !Number.isFinite(v) || v <= min || v >= max || (i > 0 && v <= breaks[i - 1])))
      throw new Error('Manual breaks must increase strictly inside the data domain.')
  } else if (min !== max && classification === 'quantile') {
    const values = (options.values ?? [])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max)
      .sort((a, b) => a - b)
    if (!values.length) throw new Error('Quantiles need numeric observations within the data domain.')
    if (values[0] !== values[values.length - 1]) {
      breaks = Array.from({ length: classes - 1 }, (_, i) => quantileSorted(values, (i + 1) / classes)!).filter(
        (v, i, all) => v > min && v < max && (i === 0 || v !== all[i - 1]),
      )
    }
  } else if (min !== max) {
    breaks = Array.from({ length: classes - 1 }, (_, i) => min + ((max - min) * (i + 1)) / classes)
  }
  const colors = samplePalette(options, breaks.length + 1)
  const indexForValue = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? bisectRight(breaks, value) : null
  return {
    domain: [min, max] as const,
    breaks,
    colors,
    missingColor,
    requestedClasses: classes,
    effectiveClasses: colors.length,
    indexForValue,
    colorForValue: (value: number | null | undefined) => {
      const index = indexForValue(value)
      return index === null ? missingColor : colors[index]
    },
    bins: colors.map((fill, i) => ({
      min: i === 0 ? min : breaks[i - 1],
      max: i === breaks.length ? max : breaks[i],
      includesMax: i === breaks.length,
      color: fill,
    })),
  }
}

/** Resolved classification shared by numeric renderers and legend definitions. */
export type ResolvedPaletteScale = ReturnType<typeof resolvePaletteScale>

/** Contrast against an opaque reference surface, including the fill's own alpha. */
export function paletteContrast(fill: string, background: string, opacity = 1): number {
  const foreground = parseColor(fill)?.rgb(),
    behind = parseColor(background)?.rgb()
  if (!foreground || !behind) throw new Error('Contrast needs valid CSS colours.')
  const alpha = Math.max(0, Math.min(1, opacity)) * foreground.opacity
  const channels = (c: typeof foreground) => [c.r, c.g, c.b].map((v) => (Number.isFinite(v) ? v : 0))
  const back = channels(behind),
    front = channels(foreground).map((v, i) => v * alpha + back[i] * (1 - alpha))
  const luminance = (rgb: number[]) =>
    rgb
      .map((v) => {
        v /= 255
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0)
  const a = luminance(front),
    b = luminance(back)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
