import { describe, expect, it } from 'vitest'
import { buildGroundGrid, readLasHeader } from './lasSurface'

/** A LAS 1.2 file, point format 1, with a GeoKeys VLR naming EPSG:26910. */
function las(points: { x: number; y: number; z: number; cls: number }[], { epsg = 26910, compressed = false } = {}) {
  const headerSize = 227,
    vlrLength = 8 + 8 * 2,
    offset = headerSize + 54 + vlrLength,
    record = 28
  const buffer = new ArrayBuffer(offset + points.length * record)
  const view = new DataView(buffer),
    bytes = new Uint8Array(buffer)
  bytes.set(new TextEncoder().encode('LASF'), 0)
  view.setUint8(24, 1)
  view.setUint8(25, 2)
  view.setUint16(94, headerSize, true)
  view.setUint32(96, offset, true)
  view.setUint32(100, 1, true)
  view.setUint8(104, 1 | (compressed ? 0x80 : 0))
  view.setUint16(105, record, true)
  view.setUint32(107, points.length, true)
  const scale = 0.001,
    xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    zs = points.map((p) => p.z)
  ;[scale, scale, scale].forEach((s, i) => view.setFloat64(131 + i * 8, s, true))
  const origin = [Math.min(...xs), Math.min(...ys), 0]
  origin.forEach((o, i) => view.setFloat64(155 + i * 8, o, true))
  view.setFloat64(179, Math.max(...xs), true)
  view.setFloat64(187, Math.min(...xs), true)
  view.setFloat64(195, Math.max(...ys), true)
  view.setFloat64(203, Math.min(...ys), true)
  view.setFloat64(211, Math.max(...zs), true)
  view.setFloat64(219, Math.min(...zs), true)
  const vlr = headerSize
  bytes.set(new TextEncoder().encode('LASF_Projection'), vlr + 2)
  view.setUint16(vlr + 18, 34735, true)
  view.setUint16(vlr + 20, vlrLength, true)
  ;[1, 1, 0, 2].forEach((v, i) => view.setUint16(vlr + 54 + i * 2, v, true))
  ;[3072, 0, 1, epsg, 4096, 0, 1, 5703].forEach((v, i) => view.setUint16(vlr + 54 + 8 + i * 2, v, true))
  points.forEach((p, i) => {
    const at = offset + i * record
    view.setInt32(at, Math.round((p.x - origin[0]) / scale), true)
    view.setInt32(at + 4, Math.round((p.y - origin[1]) / scale), true)
    view.setInt32(at + 8, Math.round(p.z / scale), true)
    view.setUint8(at + 15, p.cls)
  })
  return buffer
}

// Ground on a 0.1 slope every 0.5 m over 20 × 10 m, with canopy returns above and two holes.
const points: { x: number; y: number; z: number; cls: number }[] = []
for (let x = 500000; x <= 500020; x += 0.5)
  for (let y = 6000000; y <= 6000010; y += 0.5) {
    const small = x >= 500005 && x < 500006.5 && y >= 6000004 && y < 6000005
    const large = x >= 500012 && x < 500018 && y >= 6000002 && y < 6000008
    if (!small && !large) points.push({ x, y, z: 800 + 0.1 * (x - 500000), cls: 2 })
    points.push({ x, y, z: 830, cls: 5 })
  }

describe('LAS ground surfaces', () => {
  it('reads the header, point count and CRS keys', () => {
    const header = readLasHeader(las(points))
    expect(header.version).toBe('1.2')
    expect(header.points).toBe(points.length)
    expect(header.epsg).toBe(26910)
    expect(header.verticalEpsg).toBe(5703)
    expect(header.min[0]).toBeCloseTo(500000, 6)
  })

  it('averages only ground points, fills short gaps and leaves wide ones missing', () => {
    const grid = buildGroundGrid(las(points), { cellM: 1, gapCells: 2 })
    expect(grid.epsg).toBe(26910)
    expect(grid.width).toBe(21)
    expect(grid.height).toBe(11)
    const at = (x: number, y: number) =>
      grid.values[Math.floor((6000010 - y) / grid.cellM) * grid.width + Math.floor((x - 500000) / grid.cellM)]
    // Canopy at 830 m never enters the surface.
    expect(at(2.2 + 500000, 6000001.2)).toBeCloseTo(800 + 0.1 * 2.25, 2)
    // The 1.5 × 1 m hole is filled from its neighbours; the 6 × 6 m clearing keeps a missing core.
    expect(at(500005.5, 6000004.5)).not.toBeNull()
    expect(at(500015.2, 6000004.9)).toBeNull()
    expect(grid.filledCells).toBeGreaterThan(0)
    expect(grid.groundPoints).toBeLessThan(points.length)
  })

  it('grows the cell to stay within the cell budget', () => {
    expect(buildGroundGrid(las(points), { cellM: 0.5, maxCells: 100 }).cellM).toBeGreaterThan(1)
  })

  it('refuses LAZ and unclassified clouds with a way forward', () => {
    expect(() => readLasHeader(las(points, { compressed: true }))).toThrow(/LAZ/)
    expect(() => buildGroundGrid(las(points.map((p) => ({ ...p, cls: 1 }))))).toThrow(/class 2/)
    expect(() => readLasHeader(new ArrayBuffer(300))).toThrow(/LASF/)
  })
})
