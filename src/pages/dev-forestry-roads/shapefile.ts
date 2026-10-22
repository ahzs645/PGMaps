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

/** dBase III table: fixed-width records, numbers right-aligned, text left-aligned and truncated by bytes. */
export function writeDbf(fields: ShapeField[], rows: Record<string, unknown>[]): Uint8Array {
  if (fields.some((f) => !/^[A-Z0-9_]{1,10}$/.test(f.name)))
    throw Error('DBF field names are 1–10 capitals, digits or _.')
  const recordLength = 1 + fields.reduce((sum, f) => sum + f.length, 0)
  const headerLength = 32 + 32 * fields.length + 1
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
  fields.forEach((f, i) => {
    const at = 32 + i * 32
    bytes.set(encoder.encode(f.name), at)
    bytes[at + 11] = f.type.charCodeAt(0)
    bytes[at + 16] = f.length
    bytes[at + 17] = f.decimals ?? 0
  })
  bytes[headerLength - 1] = 0x0d
  rows.forEach((row, r) => {
    let at = headerLength + r * recordLength
    bytes[at++] = 0x20
    for (const f of fields) {
      const value = row[f.name]
      let cell: Uint8Array
      if (f.type === 'N') {
        const text = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(f.decimals ?? 0) : ''
        cell = encoder.encode(text.length > f.length ? '' : text.padStart(f.length, ' '))
      } else {
        // Truncate on a character boundary rather than splitting a multi-byte character.
        let text = '',
          size = 0
        for (const character of value == null ? '' : String(value)) {
          const bytes = encoder.encode(character).length
          if (size + bytes > f.length) break
          text += character
          size += bytes
        }
        cell = new Uint8Array(f.length).fill(0x20)
        cell.set(encoder.encode(text))
      }
      bytes.set(cell, at)
      at += f.length
    }
  })
  bytes[bytes.length - 1] = 0x1a
  return bytes
}

/** The .shp, .shx, .dbf, .prj and .cpg files of one layer, keyed by file name. */
export function writeShapefile(layer: ShapeLayer): Record<string, Uint8Array> {
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
  return {
    [`${layer.name}.shp`]: shp,
    [`${layer.name}.shx`]: shx,
    [`${layer.name}.dbf`]: writeDbf(
      layer.fields,
      layer.features.map((f) => f.attributes),
    ),
    [`${layer.name}.prj`]: encoder.encode(WGS84_PRJ),
    [`${layer.name}.cpg`]: encoder.encode('UTF-8'),
  }
}
