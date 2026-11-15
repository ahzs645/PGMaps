/**
 * Pieces every QGIS file shares: the `<Option type="Map">` property blocks symbol layers carry,
 * colours as QGIS writes them (`r,g,b,a`, with a colour-space suffix from 3.34), render units, and
 * the reverse of each for the reader. Written so QGIS 3.28 and later, 4.x included, read them.
 * No DOM or network access.
 */
import { parseColor, toHex, type Rgba } from '../color'
import type { ExchangeDiagnostic, ExchangeFormat } from '../model'
import { attr, childElements, el, num, type XmlElement, type XmlNodeSpec } from '../xml'

/** The QGIS version our files say they were written by; QGIS applies no older-format upgrades to them. */
export const QGIS_WRITER_VERSION = '3.28.0-Firenze'

export const POINTS_PER_MM = 72 / 25.4
/** QGIS draws pixels at the output's DPI; readers assume a 96 dpi screen. */
export const POINTS_PER_PIXEL = 72 / 96

export type OptionValue = string | number | boolean
/** A symbol layer's properties as QGIS 3.26+ writes them: every value a QString option. */
export function optionMap(values: Record<string, OptionValue | undefined>): XmlNodeSpec {
  return el(
    'Option',
    { type: 'Map' },
    ...Object.entries(values)
      .filter((entry): entry is [string, OptionValue] => entry[1] !== undefined)
      .map(([name, value]) =>
        el('Option', {
          name,
          type: 'QString',
          value: typeof value === 'number' ? num(value, 6) : typeof value === 'boolean' ? (value ? '1' : '0') : value,
        }),
      ),
  )
}

/** Reads a layer's properties from either the `<Option type="Map">` form or the older `<prop k v>` form. */
export function readOptions(layer: XmlElement): Map<string, string> {
  const out = new Map<string, string>()
  const map = childElements(layer, 'Option').find((option) => attr(option, 'type') === 'Map')
  if (map)
    for (const option of childElements(map, 'Option')) {
      const name = attr(option, 'name')
      if (name !== null) out.set(name, attr(option, 'value') ?? '')
    }
  for (const prop of childElements(layer, 'prop')) {
    const key = attr(prop, 'k')
    if (key !== null && !out.has(key)) out.set(key, attr(prop, 'v') ?? '')
  }
  return out
}

const clamp255 = (value: number) => Math.min(255, Math.max(0, Math.round(value)))

/** A CSS colour times `opacity`, as QGIS's `r,g,b,a`. */
export function qgisColor(css: string, opacity = 1): string {
  const color = parseColor(css) ?? { r: 0, g: 0, b: 0, a: 1 }
  return `${clamp255(color.r)},${clamp255(color.g)},${clamp255(color.b)},${clamp255(color.a * opacity * 255)}`
}

/** Reads `r,g,b,a[,rgb:…]`, `r,g,b` or `#rrggbb[aa]`; null when it is neither. */
export function parseQgisColor(text: string | null | undefined): Rgba | null {
  if (!text) return null
  const value = text.trim()
  if (value.startsWith('#')) return parseColor(value)
  const parts = value.split(',').slice(0, 4).map(Number)
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null
  return { r: clamp255(parts[0]), g: clamp255(parts[1]), b: clamp255(parts[2]), a: (parts[3] ?? 255) / 255 }
}

/** A colour split the way symbols hold it: an opaque `#rrggbb` and an opacity, null when opaque. */
export function splitColor(color: Rgba): { color: string; opacity: number | null } {
  const opacity = Math.round(color.a * 1000) / 1000
  return { color: toHex(color), opacity: opacity >= 1 ? null : opacity }
}

export type RenderUnit = 'Point' | 'MM' | 'Pixel' | 'Inch' | 'MapUnit' | 'MetersInMapUnits' | 'Percentage' | string

/** Collects a reader's diagnostics, each tagged with the format and subject. */
export class Diagnostics {
  readonly list: ExchangeDiagnostic[] = []
  constructor(readonly format: ExchangeFormat) {}
  private add(severity: ExchangeDiagnostic['severity'], subject: string | undefined, message: string) {
    if (this.list.some((d) => d.severity === severity && d.subject === subject && d.message === message)) return
    this.list.push({ severity, format: this.format, ...(subject ? { subject } : {}), message })
  }
  info(subject: string | undefined, message: string) {
    this.add('info', subject, message)
  }
  warning(subject: string | undefined, message: string) {
    this.add('warning', subject, message)
  }
  error(subject: string | undefined, message: string) {
    this.add('error', subject, message)
  }
}

/** A length in `unit` as points, reporting units that have no exact paper size. */
export function toPoints(
  value: number,
  unit: RenderUnit | undefined,
  diagnostics: Diagnostics,
  subject?: string,
): number {
  switch (unit ?? 'MM') {
    case 'Point':
      return value
    case 'MM':
    case '':
      return value * POINTS_PER_MM
    case 'Inch':
      return value * 72
    case 'Pixel':
      if (value) diagnostics.warning(subject, 'Sizes in pixels were read at 96 dpi; check them against the original.')
      return value * POINTS_PER_PIXEL
    default:
      if (value)
        diagnostics.warning(
          subject,
          `Sizes in ${unit === 'MapUnit' ? 'map units' : unit} change with the map scale; they were read as millimetres.`,
        )
      return value * POINTS_PER_MM
  }
}

/** Points rounded to what the writers keep, so a written and read size compare equal. */
export const roundPt = (value: number) => Math.round(value * 10000) / 10000
