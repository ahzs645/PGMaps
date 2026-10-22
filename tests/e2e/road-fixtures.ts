/** Byte-level point-cloud fixtures for the road-design e2e tests. */
/**
 * A tiny LAS 1.2 cloud (format 1, EPSG:26910 and vertical EPSG:5703 keys): a 5 % ground slope plus
 * a canopy 25 m above it, classified 2 and 5, or all 1 (unclassified) when `classified` is false.
 */
export function lasFile(classified = true) {
  const points: { x: number; y: number; z: number; cls: number }[] = []
  for (let x = 0; x <= 40; x += 0.5)
    for (let y = 0; y <= 40; y += 0.5) {
      points.push({ x, y, z: 700 + 0.05 * x, cls: classified ? 2 : 1 })
      points.push({ x, y, z: 725, cls: classified ? 5 : 1 })
    }
  const headerSize = 227,
    vlrLength = 24,
    offset = headerSize + 54 + vlrLength,
    record = 28
  const buffer = Buffer.alloc(offset + points.length * record)
  buffer.write('LASF', 0)
  buffer.writeUInt8(1, 24)
  buffer.writeUInt8(2, 25)
  buffer.writeUInt16LE(headerSize, 94)
  buffer.writeUInt32LE(offset, 96)
  buffer.writeUInt32LE(1, 100)
  buffer.writeUInt8(1, 104)
  buffer.writeUInt16LE(record, 105)
  buffer.writeUInt32LE(points.length, 107)
  for (let i = 0; i < 3; i++) buffer.writeDoubleLE(0.001, 131 + i * 8)
  ;[515000, 5970000, 0].forEach((v, i) => buffer.writeDoubleLE(v, 155 + i * 8))
  ;[515040, 515000, 5970040, 5970000, 725, 700].forEach((v, i) => buffer.writeDoubleLE(v, 179 + i * 8))
  buffer.write('LASF_Projection', headerSize + 2)
  buffer.writeUInt16LE(34735, headerSize + 18)
  buffer.writeUInt16LE(vlrLength, headerSize + 20)
  ;[1, 1, 0, 2, 3072, 0, 1, 26910, 4096, 0, 1, 5703].forEach((v, i) => buffer.writeUInt16LE(v, headerSize + 54 + i * 2))
  points.forEach((p, i) => {
    const at = offset + i * record
    buffer.writeInt32LE(Math.round(p.x / 0.001), at)
    buffer.writeInt32LE(Math.round(p.y / 0.001), at + 4)
    buffer.writeInt32LE(Math.round(p.z / 0.001), at + 8)
    buffer.writeUInt8(p.cls, at + 15)
  })
  return buffer
}
