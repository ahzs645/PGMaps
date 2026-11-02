/** Shared LAS/LAZ metadata reader. No point decoding, DOM or network access. */
export interface PointCloudHeader {
  version: string
  /** Point data record format with the compression bits removed. */
  pointFormat: number
  pointLength: number
  pointOffset: number
  points: number
  scale: [number, number, number]
  offset: [number, number, number]
  min: [number, number, number]
  max: [number, number, number]
  compressed: boolean
  epsg: number | null
  verticalEpsg: number | null
}

const decoder = new TextDecoder()

export function asBytes(data: Uint8Array | ArrayBuffer) {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

/** LAZ marks bit 7 of the point-format byte (bit 6 in some writers) and carries the LASzip VLR. */
export function isLaz(data: Uint8Array | ArrayBuffer): boolean {
  const bytes = asBytes(data)
  if (bytes.byteLength < 227 || decoder.decode(bytes.subarray(0, 4)) !== 'LASF') return false
  if (bytes[104] & 0xc0) return true
  return vlrs(bytes).some((v) => v.user === 'laszip encoded' && v.record === 22204)
}

interface Vlr {
  user: string
  record: number
  data: Uint8Array
}

function vlrs(bytes: Uint8Array): Vlr[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: Vlr[] = []
  const name = (at: number) => decoder.decode(bytes.subarray(at, at + 16)).replace(/\0.*$/s, '')
  let at = view.getUint16(94, true)
  const count = view.getUint32(100, true)
  for (let i = 0; i < count && at + 54 <= bytes.byteLength; i++) {
    const length = view.getUint16(at + 20, true)
    if (at + 54 + length > bytes.byteLength) break
    out.push({
      user: name(at + 2),
      record: view.getUint16(at + 18, true),
      data: bytes.subarray(at + 54, at + 54 + length),
    })
    at += 54 + length
  }
  // LAS 1.4 extended VLRs sit after the points (uncompressed in LAZ as well).
  if (bytes[24] === 1 && bytes[25] >= 4 && view.getUint16(94, true) >= 375) {
    let evlr = Number(view.getBigUint64(235, true))
    const evlrs = view.getUint32(243, true)
    for (let i = 0; i < evlrs && evlr > 0 && evlr + 60 <= bytes.byteLength; i++) {
      const length = Number(view.getBigUint64(evlr + 20, true))
      if (evlr + 60 + length > bytes.byteLength) break
      out.push({
        user: name(evlr + 2),
        record: view.getUint16(evlr + 18, true),
        data: bytes.subarray(evlr + 60, evlr + 60 + length),
      })
      evlr += 60 + length
    }
  }
  return out
}

interface WktNode {
  keyword: string
  args: Array<string | number | WktNode>
}

function parseWkt(text: string): WktNode | null {
  const tokens = text.match(/"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_]*|[-+]?[0-9.]+(?:[eE][-+]?\d+)?|[[\](),]/g) ?? []
  let i = 0
  const node = (): WktNode | null => {
    const keyword = tokens[i++]
    if (!keyword || !/^[A-Za-z_]/.test(keyword)) return null
    const out: WktNode = { keyword: keyword.toUpperCase(), args: [] }
    if (tokens[i] !== '[' && tokens[i] !== '(') return out
    i++
    while (i < tokens.length && tokens[i] !== ']' && tokens[i] !== ')') {
      const token = tokens[i]
      if (token !== ',' && !token.startsWith('"') && !/^[-+0-9.]/.test(token)) {
        const child = node()
        if (!child) return out
        out.args.push(child)
        continue
      }
      if (token.startsWith('"')) out.args.push(token.slice(1, -1).replace(/""/g, '"'))
      else if (token !== ',') out.args.push(Number(token))
      i++
    }
    i++
    return out
  }
  return node()
}

function wktEpsg(text: string, keywords: string[]): number | null {
  const root = parseWkt(text)
  const find = (n: WktNode): WktNode | null => {
    if (keywords.includes(n.keyword)) return n
    for (const a of n.args)
      if (typeof a === 'object') {
        const hit = find(a)
        if (hit) return hit
      }
    return null
  }
  const crs = root && find(root)
  if (!crs) return null
  for (const a of crs.args)
    if (
      typeof a === 'object' &&
      (a.keyword === 'AUTHORITY' || a.keyword === 'ID') &&
      String(a.args[0]).toUpperCase() === 'EPSG'
    ) {
      const code = Number(a.args[1])
      if (Number.isInteger(code) && code > 0) return code
    }
  // Some writers (WhiteboxTools among them) leave AUTHORITY out and name the code instead.
  const named = typeof crs.args[0] === 'string' && /EPSG\s*:\s*(\d+)/i.exec(crs.args[0])
  return named ? Number(named[1]) : null
}

/** The LAS/LAZ public header and CRS. Accepts LAZ; checks record bounds only for LAS. */
export function readPointCloudHeader(data: Uint8Array | ArrayBuffer, { headerOnly = false } = {}): PointCloudHeader {
  const bytes = asBytes(data)
  if (bytes.byteLength < 227) throw Error('The file is too short to be a LAS or LAZ point cloud.')
  if (decoder.decode(bytes.subarray(0, 4)) !== 'LASF')
    throw Error('Not a LAS or LAZ file: the LASF signature is missing.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const major = bytes[24],
    minor = bytes[25]
  const headerSize = view.getUint16(94, true)
  if (major !== 1 || minor > 4 || headerSize < (minor >= 4 ? 375 : 227) || bytes.byteLength < headerSize)
    throw Error('Unsupported or truncated LAS header.')
  let points = view.getUint32(107, true)
  if (major === 1 && minor >= 4 && headerSize >= 375) points = Number(view.getBigUint64(247, true)) || points
  const double = (at: number) => view.getFloat64(at, true)
  const header: PointCloudHeader = {
    version: `${major}.${minor}`,
    pointFormat: bytes[104] & 0x3f,
    pointLength: view.getUint16(105, true),
    pointOffset: view.getUint32(96, true),
    points,
    scale: [double(131), double(139), double(147)],
    offset: [double(155), double(163), double(171)],
    max: [double(179), double(195), double(211)],
    min: [double(187), double(203), double(219)],
    compressed: isLaz(bytes),
    epsg: null,
    verticalEpsg: null,
  }
  const minimumLengths = [20, 28, 26, 34, 57, 63, 30, 36, 38, 59, 67]
  if (
    !Number.isSafeInteger(points) ||
    points < 0 ||
    header.pointFormat > 10 ||
    header.pointLength < minimumLengths[header.pointFormat]
  )
    throw Error('Unsupported LAS point format, count or record length.')
  const records = vlrs(bytes)
  for (const v of records) {
    if (v.user !== 'LASF_Projection' || v.record !== 34735 || v.data.byteLength < 8) continue
    // GeoKeyDirectory: ProjectedCSTypeGeoKey 3072, VerticalCSTypeGeoKey 4096.
    const keys = new DataView(v.data.buffer, v.data.byteOffset, v.data.byteLength)
    const count = keys.getUint16(6, true)
    for (let k = 0; k < count && 8 + k * 8 + 8 <= v.data.byteLength; k++) {
      const base = 8 + k * 8
      if (keys.getUint16(base + 2, true) !== 0) continue
      const id = keys.getUint16(base, true),
        value = keys.getUint16(base + 6, true)
      if (id === 3072 && value > 0 && value !== 32767) header.epsg = value
      if (id === 4096 && value > 0 && value !== 32767) header.verticalEpsg = value
    }
  }
  for (const v of records) {
    if (v.user !== 'LASF_Projection' || v.record !== 2112) continue
    const wkt = decoder.decode(v.data).replace(/\0+$/, '')
    header.epsg ??= wktEpsg(wkt, ['PROJCS', 'PROJCRS', 'PROJECTEDCRS'])
    header.verticalEpsg ??= wktEpsg(wkt, ['VERT_CS', 'VERTCRS', 'VERTICALCRS'])
  }
  if (
    !headerOnly &&
    !header.compressed &&
    (header.pointLength < 20 || header.pointOffset + points * header.pointLength > bytes.byteLength)
  )
    throw Error('The LAS point records are truncated or their length is not recognised.')
  return header
}
