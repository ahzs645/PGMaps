import { LIMITS, type ImportFile } from './types'
export interface LasHeader {
  version: string
  points: number
  copc: boolean
  compressed: boolean
  format: number
  hasCRS: boolean
}
export async function inspectLas(file: ImportFile): Promise<LasHeader> {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (at: number, length: number) =>
    new TextDecoder()
      .decode(bytes.slice(at, at + length))
      .replace(/\0/g, '')
      .trim()
  if (bytes.length < 227 || text(0, 4) !== 'LASF')
    throw Error('This is not a complete LAS/LAZ file. Restore archive parts before importing.')
  const major = bytes[24],
    minor = bytes[25],
    format = bytes[104] & 63
  if (major !== 1 || minor > 4 || format > 10) throw Error('Unsupported LAS version or point format')
  const headerSize = view.getUint16(94, true),
    offset = view.getUint32(96, true),
    records = view.getUint32(100, true)
  if (headerSize < 227 || offset < headerSize || offset > file.size || records > 100000)
    throw Error('Invalid LAS header or truncated point data')
  let points = view.getUint32(107, true)
  if (minor >= 4) {
    if (bytes.length < 375 || headerSize < 375) throw Error('Truncated LAS 1.4 header')
    const extended = Number(view.getBigUint64(247, true))
    if (extended) points = extended
  }
  if (!Number.isSafeInteger(points) || points <= 0) throw Error('LAS file has no usable point records')
  let at = headerSize,
    copc = false,
    hasCRS = false
  for (let i = 0; i < records && at + 54 <= Math.min(offset, bytes.length); i++) {
    const user = text(at + 2, 16),
      record = view.getUint16(at + 18, true),
      size = view.getUint16(at + 20, true)
    if (user === 'copc' && record === 1) copc = true
    if (user === 'LASF_Projection' && [34735, 2112].includes(record)) hasCRS = true
    at += 54 + size
    if (at > offset) throw Error('Invalid LAS variable-length records')
  }
  if (!hasCRS && minor >= 4) {
    let evlrAt = Number(view.getBigUint64(235, true))
    const count = view.getUint32(243, true)
    if (!Number.isSafeInteger(evlrAt) || count > 64)
      throw Error('Unsupported LAS extended metadata; normalize it with PDAL before importing')
    for (let i = 0; i < count; i++) {
      if (!evlrAt || evlrAt + 60 > file.size) throw Error('Truncated LAS extended metadata')
      const record = new Uint8Array(await file.slice(evlrAt, evlrAt + 60).arrayBuffer())
      if (record.length < 60) throw Error('Truncated LAS extended metadata')
      const header = new DataView(record.buffer, record.byteOffset, record.byteLength)
      const size = Number(header.getBigUint64(20, true))
      if (!Number.isSafeInteger(size) || evlrAt + 60 + size > file.size)
        throw Error('Invalid LAS extended metadata length')
      const user = new TextDecoder().decode(record.slice(2, 18)).replace(/\0/g, '').trim()
      if (user === 'LASF_Projection' && header.getUint16(18, true) === 2112 && size > 0) {
        hasCRS = true
        break
      }
      evlrAt += 60 + size
    }
  }
  const compressed = (bytes[104] & 192) !== 0
  if (!compressed && offset + points * view.getUint16(105, true) > file.size) throw Error('Truncated LAS point records')
  return { version: major + '.' + minor, points, copc, hasCRS, format, compressed }
}
export function checkLasBudget(header: LasHeader, size: number) {
  if (!header.copc && (size > LIMITS.plainBytes || header.points > LIMITS.plainPoints))
    throw Error(
      header.points.toLocaleString() +
        ' points: this ordinary LAS/LAZ needs COPC/EPT conversion for browser streaming. Plain files are limited to 2 million points and 64 MiB. The BC sample EPT button streams the original sample safely.',
    )
  if (!header.hasCRS)
    throw Error(
      'LAS/COPC needs an embedded CRS. Assign the correct CRS with PDAL before importing; the GeoJSON/GeoTIFF CRS selector does not alter point clouds.',
    )
}
export function streamingUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw Error('Enter an absolute HTTPS COPC or EPT URL')
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw Error('Use an HTTPS URL without embedded credentials')
  const ept = /\/ept\.json$/i.test(url.pathname)
  if (!ept && !/\.copc\.laz$/i.test(url.pathname))
    throw Error('URL streaming accepts ept.json or a .copc.laz file; ordinary remote LAZ needs conversion first')
  return { url: url.href, kind: ept ? ('ept' as const) : ('copc' as const) }
}
/** Keep the GeoLibre styling/profile controls; all loading goes through the guarded workspace. */
export function hideNativeLoadSection(container?: HTMLElement) {
  const section = container?.querySelector('.lidar-file-input-wrapper')?.closest<HTMLElement>('.lidar-control-section')
  if (section) section.hidden = true
}
