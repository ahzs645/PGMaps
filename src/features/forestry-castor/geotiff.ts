// SPDX-License-Identifier: Apache-2.0
import type { CastorGrid } from './types'

const NO_DATA = -9999
type Entry = { tag: number; type: number; count: number; bytes: Uint8Array; offset?: number }
/** One north-up, Float64 band. geotiff.js 2.x's writer truncates values to Uint8. */
export function encodeCastorGeoTiff(
  grid: CastorGrid,
  values: readonly (number | null)[],
  description: string,
): ArrayBuffer {
  const count = grid.width * grid.height
  if (!Number.isInteger(count) || count < 1 || count > 2_000_000 || values.length !== count)
    throw new Error('GeoTIFF values must match a grid of at most 2,000,000 cells.')
  const match = /^EPSG:(\d+)$/i.exec(grid.crs)
  const epsg = match ? Number(match[1]) : 0
  if (!epsg || epsg > 65535 || [4326, 4269, 4267].includes(epsg))
    throw new Error('GeoTIFF export requires a supported projected EPSG code with metre units.')
  const entries: Entry[] = []
  const number = (tag: number, type: 3 | 4 | 12, items: number[]) => {
    const size = type === 3 ? 2 : type === 4 ? 4 : 8
    const bytes = new Uint8Array(items.length * size),
      view = new DataView(bytes.buffer)
    items.forEach((value, index) =>
      type === 3
        ? view.setUint16(index * size, value, true)
        : type === 4
          ? view.setUint32(index * size, value, true)
          : view.setFloat64(index * size, value, true),
    )
    entries.push({ tag, type, count: items.length, bytes })
  }
  const ascii = (tag: number, text: string) => {
    const bytes = new TextEncoder().encode(text.replace(/[^\x20-\x7e]/g, '?') + '\0')
    entries.push({ tag, type: 2, count: bytes.length, bytes })
  }
  number(256, 4, [grid.width])
  number(257, 4, [grid.height])
  number(258, 3, [64])
  number(259, 3, [1])
  number(262, 3, [1])
  // JSON remains ASCII TIFF metadata while preserving arbitrary Unicode on parse.
  ascii(
    270,
    description.replace(/[^\x20-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`),
  )
  number(273, 4, [0])
  number(277, 3, [1])
  number(278, 4, [grid.height])
  number(279, 4, [count * 8])
  number(284, 3, [1])
  ascii(305, 'PGMaps forestryCastor browser')
  number(339, 3, [3])
  number(33550, 12, [grid.cellSize, grid.cellSize, 0])
  number(33922, 12, [0, 0, 0, grid.originX, grid.originY, 0])
  number(34735, 3, [1, 1, 0, 4, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, epsg, 3076, 0, 1, 9001])
  ascii(42113, String(NO_DATA))
  entries.sort((a, b) => a.tag - b.tag)
  let offset = 8 + 2 + entries.length * 12 + 4
  const align = () => {
    offset = Math.ceil(offset / 8) * 8
  }
  for (const entry of entries)
    if (entry.bytes.length > 4) {
      align()
      entry.offset = offset
      offset += entry.bytes.length
    }
  align()
  const pixelOffset = offset
  new DataView(entries.find((entry) => entry.tag === 273)!.bytes.buffer).setUint32(0, pixelOffset, true)
  const buffer = new ArrayBuffer(pixelOffset + count * 8)
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer)
  bytes[0] = 0x49
  bytes[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true)
  view.setUint16(8, entries.length, true)
  entries.forEach((entry, index) => {
    const position = 10 + index * 12
    view.setUint16(position, entry.tag, true)
    view.setUint16(position + 2, entry.type, true)
    view.setUint32(position + 4, entry.count, true)
    if (entry.offset !== undefined) {
      view.setUint32(position + 8, entry.offset, true)
      bytes.set(entry.bytes, entry.offset)
    } else bytes.set(entry.bytes, position + 8)
  })
  values.forEach((value, index) => {
    if (value !== null && !Number.isFinite(value)) throw new Error('Raster values must be finite or null.')
    view.setFloat64(pixelOffset + index * 8, value ?? NO_DATA, true)
  })
  return buffer
}
