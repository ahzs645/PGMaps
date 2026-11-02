import { pointCloudRecords, readPointCloudHeader, recordsCrs, type Vlr } from '@/lib/lidar/lasHeader'
import { LIMITS, type ImportFile } from './types'
export interface LasHeader {
  version: string
  points: number
  copc: boolean
  compressed: boolean
  format: number
  hasCRS: boolean
  epsg: number | null
}
const MAX_METADATA = 16 * 1024 * 1024
const isCrsRecord = (v: Vlr) => v.user === 'LASF_Projection' && (v.record === 34735 || v.record === 2112)
/** Header, VLRs and LAS 1.4 extended VLRs read in bounded slices, parsed by the shared LAS reader. */
export async function inspectLas(file: ImportFile): Promise<LasHeader> {
  const prefix = new Uint8Array(await file.slice(0, 375).arrayBuffer())
  if (prefix.length < 227 || new TextDecoder().decode(prefix.subarray(0, 4)) !== 'LASF')
    throw Error('This is not a complete LAS/LAZ file. Restore archive parts before importing.')
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength)
  const headerSize = view.getUint16(94, true),
    offset = view.getUint32(96, true)
  if (headerSize < 227 || offset < headerSize || offset > file.size || offset > MAX_METADATA)
    throw Error('Invalid LAS header or truncated point data')
  const metadata = new Uint8Array(await file.slice(0, offset).arrayBuffer())
  const header = readPointCloudHeader(metadata, { headerOnly: true })
  if (header.points <= 0) throw Error('LAS file has no usable point records')
  const records = pointCloudRecords(metadata)
  if (header.version === '1.4') {
    const meta = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength)
    let evlrAt = Number(meta.getBigUint64(235, true))
    const count = meta.getUint32(243, true)
    if (!Number.isSafeInteger(evlrAt) || count > 64)
      throw Error('Unsupported LAS extended metadata; normalize it with PDAL before importing')
    for (let i = 0; i < count && !records.some(isCrsRecord); i++) {
      if (!evlrAt || evlrAt + 60 > file.size) throw Error('Truncated LAS extended metadata')
      const head = new Uint8Array(await file.slice(evlrAt, evlrAt + 60).arrayBuffer())
      if (head.length < 60) throw Error('Truncated LAS extended metadata')
      const evlr = new DataView(head.buffer, head.byteOffset, head.byteLength)
      const size = Number(evlr.getBigUint64(20, true))
      if (!Number.isSafeInteger(size) || evlrAt + 60 + size > file.size)
        throw Error('Invalid LAS extended metadata length')
      const record: Vlr = {
        user: new TextDecoder().decode(head.subarray(2, 18)).replace(/\0.*$/s, ''),
        record: evlr.getUint16(18, true),
        data: new Uint8Array(),
      }
      if (isCrsRecord(record) && size > 0 && size <= MAX_METADATA)
        record.data = new Uint8Array(await file.slice(evlrAt + 60, evlrAt + 60 + size).arrayBuffer())
      records.push(record)
      evlrAt += 60 + size
    }
  }
  const copc = records.some((v) => v.user === 'copc' && v.record === 1)
  const crs = recordsCrs(records)
  const hasCRS = crs.epsg !== null || records.some((v) => isCrsRecord(v) && v.data.byteLength > 0)
  if (!header.compressed && offset + header.points * header.pointLength > file.size)
    throw Error('Truncated LAS point records')
  return {
    version: header.version,
    points: header.points,
    copc,
    hasCRS,
    format: header.pointFormat,
    compressed: header.compressed,
    epsg: crs.epsg,
  }
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
/**
 * Keep the GeoLibre styling/profile controls; all loading goes through the guarded workspace.
 * LidarControl appends its panel to the map container (not control.getContainer()), so pass
 * map.getContainer(). Its file section holds the file input, sample list and URL loader.
 */
export function hideNativeLoadSection(root?: ParentNode | null) {
  let hidden = 0
  root?.querySelectorAll<HTMLElement>('.lidar-control-panel .lidar-file-input-wrapper').forEach((wrapper) => {
    const section = wrapper.closest<HTMLElement>('.lidar-control-section') ?? wrapper
    section.hidden = true
    section.style.display = 'none'
    section.querySelectorAll<HTMLInputElement>('input, select, button').forEach((control) => (control.disabled = true))
    hidden++
  })
  return hidden
}
