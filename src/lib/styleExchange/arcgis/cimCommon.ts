/**
 * Pieces every ArcGIS Pro file shares: the CIM version written, colours in both encodings Pro uses,
 * and small readers for untyped JSON. Pro's layer, map and layout files (`.lyrx`, `.mapx`, `.pagx`)
 * write a colour as `{ type: 'CIMRGBColor', values: [r, g, b, alpha 0–100] }`; a style (`.stylx`)
 * writes the compact `[r, g, b, alpha 0–255]`, as Esri's own Parks.stylx and Calls.stylx do.
 * Type and field names follow the published CIM specification (github.com/Esri/cim-spec, v3).
 * No DOM or network access.
 */
import { parseColor, toHex, type Rgba } from '../color'
import type { ExchangeDiagnostic, ExchangeFormat } from '../model'

/**
 * CIM version and build written into every document. They are the values Esri's Parks.stylx
 * (dictionary-renderer-toolkit) carries, ArcGIS Pro 3.2, so Pro 3.2 and later open the files
 * without upgrading them; nothing here needs a newer CIM.
 */
export const CIM_VERSION = '3.2.0'
export const CIM_BUILD = 49706

export type ColorForm = 'cim' | 'compact'

const round = (value: number, digits: number) => Number(value.toFixed(digits))

/** A CSS colour, its alpha multiplied by `opacity`, in the form a file wants. */
export function cimColor(css: string, opacity = 1, form: ColorForm = 'cim'): unknown {
  const color = parseColor(css) ?? { r: 0, g: 0, b: 0, a: 1 }
  const a = Math.min(1, Math.max(0, color.a * opacity))
  if (form === 'compact') return [color.r, color.g, color.b, Math.round(a * 255)]
  return { type: 'CIMRGBColor', values: [color.r, color.g, color.b, round(a * 100, 2)] }
}

export type Json = Record<string, unknown>
export const isRecord = (value: unknown): value is Json =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export const records = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : [])
export const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
export const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const clamp255 = (value: number) => Math.min(255, Math.max(0, Math.round(value)))

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const hh = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const [r, g, b] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x]
  const m = v - c
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)]
}

/**
 * A CIM colour in either encoding, as RGBA. `approximate` names a conversion that is not exact
 * (CMYK without its colour profile, Lab); null when the value is not a colour this reads.
 */
export function colorFromCim(value: unknown): { color: Rgba; approximate?: string } | null {
  const nums = (list: unknown) =>
    Array.isArray(list) && list.every((n) => typeof n === 'number') ? (list as number[]) : null
  const compact = nums(value)
  if (compact) {
    if (compact.length < 3) return null
    return {
      color: {
        r: clamp255(compact[0]),
        g: clamp255(compact[1]),
        b: clamp255(compact[2]),
        a: (compact[3] ?? 255) / 255,
      },
    }
  }
  if (!isRecord(value)) return null
  const values = nums(value.values)
  if (!values) return null
  const alpha = (index: number) => Math.min(1, Math.max(0, (values[index] ?? 100) / 100))
  switch (value.type) {
    case 'CIMRGBColor':
      if (values.length < 3) return null
      return { color: { r: clamp255(values[0]), g: clamp255(values[1]), b: clamp255(values[2]), a: alpha(3) } }
    case 'CIMGrayColor':
      if (values.length < 1) return null
      return { color: { r: clamp255(values[0]), g: clamp255(values[0]), b: clamp255(values[0]), a: alpha(1) } }
    case 'CIMHSVColor': {
      if (values.length < 3) return null
      const [r, g, b] = hsvToRgb(values[0], values[1] / 100, values[2] / 100)
      return { color: { r, g, b, a: alpha(3) } }
    }
    case 'CIMCMYKColor': {
      if (values.length < 4) return null
      const [c, m, y, k] = values.map((v) => v / 100)
      const rgb = (part: number) => clamp255(255 * (1 - part) * (1 - k))
      return {
        color: { r: rgb(c), g: rgb(m), b: rgb(y), a: alpha(4) },
        approximate: 'a CMYK colour converted without its colour profile',
      }
    }
    default:
      return null
  }
}

/** `#rrggbb` and the alpha apart, as symbols keep them. */
export const splitColor = (color: Rgba) => ({ color: toHex(color), opacity: color.a })

export function diagnostic(
  format: ExchangeFormat,
  severity: ExchangeDiagnostic['severity'],
  message: string,
  subject?: string,
): ExchangeDiagnostic {
  return subject === undefined ? { severity, format, message } : { severity, format, subject, message }
}

/** Number trimmed to `digits` decimals, without `-0`. */
export const trim = (value: number, digits = 4) => {
  const rounded = round(value, digits)
  return Object.is(rounded, -0) ? 0 : rounded
}

const bits = new DataView(new ArrayBuffer(8))
/** The next double above (`up`) or below `value`: turns Pro's inclusive class break into an exclusive end and back. */
export function nextAfter(value: number, up: boolean): number {
  if (!Number.isFinite(value)) return value
  if (value === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE
  bits.setFloat64(0, value)
  bits.setBigInt64(0, bits.getBigInt64(0) + (value > 0 === up ? 1n : -1n))
  return bits.getFloat64(0)
}
