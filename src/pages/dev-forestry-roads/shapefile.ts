/**
 * A minimal ESRI shapefile writer: Point and PolyLine layers with a dBase III attribute table,
 * WGS84 coordinates (.prj) and UTF-8 text (.cpg). Pure; the caller zips the returned files.
 */
import type { Coordinate } from './types'

export type ShapeField = { name: string; type: 'C' | 'N'; length: number; decimals?: number }
export type ShapeLayer =
  | {
      name: string
      type: 'point'
      fields: ShapeField[]
      features: { point: Coordinate; attributes: Record<string, unknown> }[]
    }
  | {
      name: string
      type: 'polyline'
      fields: ShapeField[]
      features: { parts: Coordinate[][]; attributes: Record<string, unknown> }[]
    }

export const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'

const encoder = new TextEncoder()

function header(view: DataView, shapeType: number, lengthBytes: number, box: number[]) {
  view.setInt32(0, 9994, false)
  view.setInt32(24, lengthBytes / 2, false)
  view.setInt32(28, 1000, true)
  view.setInt32(32, shapeType, true)
  box.forEach((value, i) => view.setFloat64(36 + i * 8, value, true))
}

function bounds(points: Coordinate[]) {
  if (!points.length) return [0, 0, 0, 0]
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ]
}

/** dBase III limits: a numeric field holds at most 19 characters, a text field 254 bytes. */
export const DBF_MAX_NUMBER_WIDTH = 19
export const DBF_MAX_TEXT_BYTES = 254

const numberText = (value: number, decimals: number) => {
  const text = value.toFixed(decimals)
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text
}

/** Text cut to `limit` UTF-8 bytes on a character boundary rather than splitting a multi-byte character. */
function clipBytes(value: string, limit: number) {
  let text = '',
    size = 0
  for (const character of value) {
    const bytes = encoder.encode(character).length
    if (size + bytes > limit) return { text, cut: true }
    text += character
    size += bytes
  }
  return { text, cut: false }
}

/**
 * dBase III table: fixed-width records, numbers right-aligned, text left-aligned. Each field is
 * widened to fit its data, up to the format's limits; a value that still does not fit is blanked
 * (numbers) or cut on a character boundary (text), and reported in `warnings`. Unknown numbers
 * (null, undefined, NaN, ±Infinity) are blank without a warning.
 */
export function encodeDbf(
  fields: ShapeField[],
  rows: Record<string, unknown>[],
): { bytes: Uint8Array; fields: ShapeField[]; warnings: string[] } {
  if (fields.some((f) => !/^[A-Z0-9_]{1,10}$/.test(f.name)))
    throw Error('DBF field names are 1–10 capitals, digits or _.')
  const warnings: string[] = []
  const sized = fields.map((f): ShapeField => {
    const values = rows.map((row) => row[f.name])
    if (f.type === 'N') {
      const decimals = f.decimals ?? 0
      const widest = Math.max(
        0,
        ...values.map((v) =>
          typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e21 ? numberText(v, decimals).length : 0,
        ),
      )
      return { ...f, length: Math.min(DBF_MAX_NUMBER_WIDTH, Math.max(f.length, widest)) }
    }
    const widest = Math.max(0, ...values.map((v) => (v == null ? 0 : encoder.encode(String(v)).length)))
    return { ...f, length: Math.min(DBF_MAX_TEXT_BYTES, Math.max(f.length, widest)) }
  })
  const recordLength = 1 + sized.reduce((sum, f) => sum + f.length, 0)
  const headerLength = 32 + 32 * sized.length + 1
  const bytes = new Uint8Array(headerLength + recordLength * rows.length + 1)
  const view = new DataView(bytes.buffer)
  const now = new Date()
  bytes[0] = 0x03
  bytes[1] = now.getFullYear() - 1900
  bytes[2] = now.getMonth() + 1
  bytes[3] = now.getDate()
  view.setUint32(4, rows.length, true)
  view.setUint16(8, headerLength, true)
  view.setUint16(10, recordLength, true)
  sized.forEach((f, i) => {
    const at = 32 + i * 32
    bytes.set(encoder.encode(f.name), at)
    bytes[at + 11] = f.type.charCodeAt(0)
    bytes[at + 16] = f.length
    bytes[at + 17] = f.decimals ?? 0
  })
  bytes[headerLength - 1] = 0x0d
  const blanked = new Map<string, number>(),
    cut = new Map<string, number>(),
    notNumbers = new Map<string, number>()
  const count = (map: Map<string, number>, name: string) => map.set(name, (map.get(name) ?? 0) + 1)
  rows.forEach((row, r) => {
    let at = headerLength + r * recordLength
    bytes[at++] = 0x20
    for (const f of sized) {
      const value = row[f.name]
      let cell: Uint8Array
      if (f.type === 'N') {
        let text = ''
        if (typeof value === 'number' && Number.isFinite(value)) {
          // toFixed switches to exponent notation at 1e21, which a dBase number cannot hold.
          const fixed = Math.abs(value) < 1e21 ? numberText(value, f.decimals ?? 0) : null
          if (fixed === null || fixed.length > f.length) count(blanked, f.name)
          else text = fixed
        } else if (value != null && typeof value !== 'number') count(notNumbers, f.name)
        cell = encoder.encode(text.padStart(f.length, ' '))
      } else {
        const clipped = clipBytes(value == null ? '' : String(value), f.length)
        if (clipped.cut) count(cut, f.name)
        cell = new Uint8Array(f.length).fill(0x20)
        cell.set(encoder.encode(clipped.text))
      }
      bytes.set(cell, at)
      at += f.length
    }
  })
  bytes[bytes.length - 1] = 0x1a
  const records = (n: number) => `${n} record${n === 1 ? '' : 's'}`
  for (const [name, n] of blanked)
    warnings.push(`${name}: left blank in ${records(n)}; the number is wider than a dBase field can hold.`)
  for (const [name, n] of notNumbers) warnings.push(`${name}: left blank in ${records(n)}; the value is not a number.`)
  for (const [name, n] of cut)
    warnings.push(
      `${name}: text cut to ${sized.find((f) => f.name === name)!.length} bytes in ${records(n)}, the most a dBase field can hold.`,
    )
  return { bytes, fields: sized, warnings }
}

/** The table bytes of {@link encodeDbf}, for callers that do not read its warnings. */
export function writeDbf(fields: ShapeField[], rows: Record<string, unknown>[]): Uint8Array {
  return encodeDbf(fields, rows).bytes
}

/**
 * The .shp, .shx, .dbf, .prj and .cpg files of one layer, keyed by file name, with a warning for
 * each attribute field whose values had to be blanked or cut to fit the dBase table.
 */
export function writeShapefileLayer(layer: ShapeLayer): { files: Record<string, Uint8Array>; warnings: string[] } {
  const shapeType = layer.type === 'point' ? 1 : 3
  const contents = layer.features.map((feature) => {
    if (layer.type === 'point') {
      const [x, y] = (feature as { point: Coordinate }).point
      const bytes = new Uint8Array(20)
      const view = new DataView(bytes.buffer)
      view.setInt32(0, 1, true)
      view.setFloat64(4, x, true)
      view.setFloat64(12, y, true)
      return { bytes, points: [[x, y] as Coordinate] }
    }
    const parts = (feature as { parts: Coordinate[][] }).parts.filter((p) => p.length >= 2)
    const points = parts.flat()
    const bytes = new Uint8Array(44 + 4 * parts.length + 16 * points.length)
    const view = new DataView(bytes.buffer)
    view.setInt32(0, 3, true)
    bounds(points).forEach((value, i) => view.setFloat64(4 + i * 8, value, true))
    view.setInt32(36, parts.length, true)
    view.setInt32(40, points.length, true)
    let start = 0
    parts.forEach((part, i) => {
      view.setInt32(44 + i * 4, start, true)
      start += part.length
    })
    points.forEach(([x, y], i) => {
      view.setFloat64(44 + 4 * parts.length + i * 16, x, true)
      view.setFloat64(44 + 4 * parts.length + i * 16 + 8, y, true)
    })
    return { bytes, points }
  })
  const box = bounds(contents.flatMap((c) => c.points))
  const shpLength = 100 + contents.reduce((sum, c) => sum + 8 + c.bytes.length, 0)
  const shp = new Uint8Array(shpLength),
    shx = new Uint8Array(100 + 8 * contents.length)
  const shpView = new DataView(shp.buffer),
    shxView = new DataView(shx.buffer)
  header(shpView, shapeType, shpLength, box)
  header(shxView, shapeType, shx.length, box)
  let offset = 100
  contents.forEach((c, i) => {
    shpView.setInt32(offset, i + 1, false)
    shpView.setInt32(offset + 4, c.bytes.length / 2, false)
    shp.set(c.bytes, offset + 8)
    shxView.setInt32(100 + i * 8, offset / 2, false)
    shxView.setInt32(104 + i * 8, c.bytes.length / 2, false)
    offset += 8 + c.bytes.length
  })
  const dbf = encodeDbf(
    layer.fields,
    layer.features.map((f) => f.attributes),
  )
  return {
    files: {
      [`${layer.name}.shp`]: shp,
      [`${layer.name}.shx`]: shx,
      [`${layer.name}.dbf`]: dbf.bytes,
      [`${layer.name}.prj`]: encoder.encode(WGS84_PRJ),
      [`${layer.name}.cpg`]: encoder.encode('UTF-8'),
    },
    warnings: dbf.warnings.map((warning) => `${layer.name} ${warning}`),
  }
}

/** The files of {@link writeShapefileLayer}, for callers that do not read its warnings. */
export function writeShapefile(layer: ShapeLayer): Record<string, Uint8Array> {
  return writeShapefileLayer(layer).files
}
