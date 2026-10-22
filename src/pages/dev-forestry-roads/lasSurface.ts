/**
 * Uncompressed LAS (1.0–1.4) point clouds to a bare-earth grid: ground-classified points
 * (class 2) are averaged per cell, short gaps are filled from their neighbours, and anything
 * wider stays missing rather than being invented. LAZ is compressed and not decoded here.
 * Pure: takes an ArrayBuffer, no DOM or network access.
 */
export interface LasHeader {
  version: string
  pointFormat: number
  pointLength: number
  pointOffset: number
  points: number
  scale: [number, number, number]
  offset: [number, number, number]
  min: [number, number, number]
  max: [number, number, number]
  /** From the GeoTIFF keys VLR, when present. */
  epsg: number | null
  verticalEpsg: number | null
}
export interface GroundGrid {
  epsg: number | null
  /** Centre of the top-left cell; rows run south (negative y pixel size). */
  origin: [number, number]
  pixelSize: [number, number]
  width: number
  height: number
  values: Array<number | null>
  groundPoints: number
  totalPoints: number
  filledCells: number
  cellM: number
}

const decoder = new TextDecoder()

export function readLasHeader(buffer: ArrayBuffer): LasHeader {
  if (buffer.byteLength < 227) throw Error('The file is too short to be a LAS point cloud.')
  const view = new DataView(buffer)
  if (decoder.decode(new Uint8Array(buffer, 0, 4)) !== 'LASF')
    throw Error('Not a LAS file: the LASF signature is missing.')
  const major = view.getUint8(24),
    minor = view.getUint8(25)
  const headerSize = view.getUint16(94, true)
  const pointOffset = view.getUint32(96, true)
  const vlrs = view.getUint32(100, true)
  const formatByte = view.getUint8(104)
  if (formatByte & 0xc0)
    throw Error('This LAS is compressed (LAZ). Decompress it first, for example with PDAL or LAStools las2las.')
  const pointFormat = formatByte & 0x3f
  const pointLength = view.getUint16(105, true)
  let points = view.getUint32(107, true)
  if (major === 1 && minor >= 4 && headerSize >= 375) points = Number(view.getBigUint64(247, true)) || points
  const double = (at: number) => view.getFloat64(at, true)
  const header: LasHeader = {
    version: `${major}.${minor}`,
    pointFormat,
    pointLength,
    pointOffset,
    points,
    scale: [double(131), double(139), double(147)],
    offset: [double(155), double(163), double(171)],
    max: [double(179), double(195), double(211)],
    min: [double(187), double(203), double(219)],
    epsg: null,
    verticalEpsg: null,
  }
  // GeoKeyDirectory (LASF_Projection, record 34735): ProjectedCSTypeGeoKey 3072, VerticalCSTypeGeoKey 4096.
  let at = headerSize
  for (let i = 0; i < vlrs && at + 54 <= buffer.byteLength; i++) {
    const user = decoder.decode(new Uint8Array(buffer, at + 2, 16)).replace(/\0.*$/, '')
    const record = view.getUint16(at + 18, true),
      length = view.getUint16(at + 20, true)
    if (user === 'LASF_Projection' && record === 34735 && at + 54 + length <= buffer.byteLength) {
      const keys = view.getUint16(at + 54 + 6, true)
      for (let k = 0; k < keys; k++) {
        const base = at + 54 + 8 + k * 8
        const id = view.getUint16(base, true),
          location = view.getUint16(base + 2, true),
          value = view.getUint16(base + 6, true)
        if (location !== 0) continue
        if (id === 3072) header.epsg = value
        if (id === 4096) header.verticalEpsg = value
      }
    }
    at += 54 + length
  }
  if (pointLength < 20 || pointOffset + points * pointLength > buffer.byteLength)
    throw Error('The LAS point records are truncated or their length is not recognised.')
  return header
}

/** Average ground points into cells of `cellM` (grown if needed to stay within `maxCells`). */
export function buildGroundGrid(
  buffer: ArrayBuffer,
  {
    cellM = 1,
    maxCells = 4_194_304,
    gapCells = 3,
    classes = [2],
  }: { cellM?: number; maxCells?: number; gapCells?: number; classes?: number[] } = {},
): GroundGrid {
  const h = readLasHeader(buffer)
  const view = new DataView(buffer)
  const spanX = h.max[0] - h.min[0],
    spanY = h.max[1] - h.min[1]
  if (!(spanX > 0 && spanY > 0)) throw Error('The point cloud has no horizontal extent.')
  let cell = Math.max(0.1, cellM)
  while ((Math.floor(spanX / cell) + 1) * (Math.floor(spanY / cell) + 1) > maxCells) cell *= 1.25
  const width = Math.floor(spanX / cell) + 1,
    height = Math.floor(spanY / cell) + 1
  const sum = new Float64Array(width * height),
    count = new Uint32Array(width * height)
  // Classification: low five bits of byte 15 in formats 0–5, the whole byte 16 in formats 6–10.
  const classAt = h.pointFormat >= 6 ? 16 : 15,
    classMask = h.pointFormat >= 6 ? 0xff : 0x1f
  const wanted = new Set(classes)
  let ground = 0
  for (let i = 0; i < h.points; i++) {
    const at = h.pointOffset + i * h.pointLength
    if (!wanted.has(view.getUint8(at + classAt) & classMask)) continue
    const x = view.getInt32(at, true) * h.scale[0] + h.offset[0],
      y = view.getInt32(at + 4, true) * h.scale[1] + h.offset[1],
      z = view.getInt32(at + 8, true) * h.scale[2] + h.offset[2]
    const col = Math.floor((x - h.min[0]) / cell),
      row = Math.floor((h.max[1] - y) / cell)
    if (col < 0 || row < 0 || col >= width || row >= height) continue
    sum[row * width + col] += z
    count[row * width + col]++
    ground++
  }
  if (!ground)
    throw Error(
      'No ground-classified (class 2) points. Classify the cloud first (for example PDAL filters.smrf) and import again.',
    )
  const values: Array<number | null> = Array.from(count, (n, i) => (n ? sum[i] / n : null))
  // Fill a gap only from at least three known neighbours, a cell's width at a time.
  let filled = 0
  for (let pass = 0; pass < gapCells; pass++) {
    const next = values.slice()
    let changed = 0
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const i = row * width + col
        if (values[i] !== null) continue
        let total = 0,
          known = 0
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue
            const r = row + dr,
              c = col + dc
            if (r < 0 || c < 0 || r >= height || c >= width) continue
            const v = values[r * width + c]
            if (v !== null) {
              total += v
              known++
            }
          }
        if (known >= 3) {
          next[i] = total / known
          changed++
        }
      }
    if (!changed) break
    for (let i = 0; i < values.length; i++) values[i] = next[i]
    filled += changed
  }
  return {
    epsg: h.epsg,
    origin: [h.min[0] + cell / 2, h.max[1] - cell / 2],
    pixelSize: [cell, -cell],
    width,
    height,
    values: values.map((v) => (v === null ? null : Math.round(v * 1000) / 1000)),
    groundPoints: ground,
    totalPoints: h.points,
    filledCells: filled,
    cellM: cell,
  }
}
