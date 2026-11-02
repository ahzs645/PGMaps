/** Synthetic flat ground with exact 0.5, 2, 10 and 11 m returns in every square metre. */
export function restorationLas({ modern = true, epsg = 3157, ground = true, shiftX = 0 } = {}): Uint8Array {
  const headerSize = modern ? 375 : 227,
    recordLength = modern ? 30 : 34
  const offset = headerSize + 78,
    count = 80
  const bytes = new Uint8Array(offset + recordLength * count),
    v = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('LASF'))
  bytes[24] = 1
  bytes[25] = modern ? 4 : 2
  v.setUint16(94, headerSize, true)
  v.setUint32(96, offset, true)
  v.setUint32(100, 1, true)
  bytes[104] = modern ? 6 : 3
  v.setUint16(105, recordLength, true)
  if (modern) v.setBigUint64(247, BigInt(count), true)
  else v.setUint32(107, count, true)
  for (const at of [131, 139, 147]) v.setFloat64(at, 0.01, true)
  v.setFloat64(179, 512003.5 + shiftX, true)
  v.setFloat64(187, 512000.5 + shiftX, true)
  v.setFloat64(195, 5971003.5, true)
  v.setFloat64(203, 5971000.5, true)
  v.setFloat64(211, 111, true)
  v.setFloat64(219, 100, true)
  bytes.set(new TextEncoder().encode('LASF_Projection'), headerSize + 2)
  v.setUint16(headerSize + 18, 34735, true)
  v.setUint16(headerSize + 20, 24, true)
  const k = headerSize + 54
  v.setUint16(k, 1, true)
  v.setUint16(k + 2, 1, true)
  v.setUint16(k + 6, 2, true)
  for (const [index, key, value] of [
    [0, 3072, epsg],
    [1, 4096, 6647],
  ]) {
    const at = k + 8 + index * 8
    v.setUint16(at, key, true)
    v.setUint16(at + 4, 1, true)
    v.setUint16(at + 6, value, true)
  }
  let i = 0
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++)
      for (const h of [0, 0.5, 2, 10, 11]) {
        const at = offset + i++ * recordLength
        v.setInt32(at, Math.round((512000.5 + x + shiftX) * 100), true)
        v.setInt32(at + 4, Math.round((5971000.5 + y) * 100), true)
        v.setInt32(at + 8, Math.round((100 + h) * 100), true)
        bytes[at + 14] = h === 11 ? 1 : 2
        bytes[at + (modern ? 16 : 15)] = h === 0 && ground ? 2 : 1
      }
  return bytes
}
