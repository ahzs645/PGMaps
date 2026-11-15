import { describe, expect, it } from 'vitest'
import { distance } from './engine'
import { fitSimilarity, gridSpacingM, localPlaneGrid, localPlaneOffset, localPlaneProjection } from './localPlane'
import type { XY } from './landXmlImport'

describe('local plane', () => {
  it('measures as the road engine does: within a millionth at 15 km', () => {
    const plane = localPlaneProjection([500_000, 6_000_000])
    for (const [dx, dy] of [
      [1000, 0],
      [0, 10_000],
      [15_000, 15_000],
    ]) {
      const a = plane.toLonLat([500_000, 6_000_000]),
        b = plane.toLonLat([500_000 + dx, 6_000_000 + dy])
      expect(Math.abs(distance(a, b) / Math.hypot(dx, dy) - 1)).toBeLessThan(1e-6)
      const back = plane.toFile(b)
      expect(back[0]).toBeCloseTo(500_000 + dx, 6)
      expect(back[1]).toBeCloseTo(6_000_000 + dy, 6)
    }
  })

  it('centres the plane on what was read, to the metre', () => {
    expect(
      localPlaneOffset([
        [100.4, 20],
        [300.2, 80],
      ]),
    ).toEqual([200, 50])
  })

  it('fits a similarity to control points and reports each residual', () => {
    const scale = 1.0004,
      turn = (12 * Math.PI) / 180
    const to = ([x, y]: XY): XY => [
      scale * (x * Math.cos(turn) - y * Math.sin(turn)) + 1000,
      scale * (x * Math.sin(turn) + y * Math.cos(turn)) - 500,
    ]
    const from: XY[] = [
      [0, 0],
      [400, 30],
      [120, 380],
    ]
    const exact = fitSimilarity(from.map((p) => ({ from: p, to: to(p) })))
    expect(exact.scale).toBeCloseTo(scale, 9)
    expect(exact.rotationDeg).toBeCloseTo(12, 9)
    expect(exact.rmsM).toBeLessThan(1e-9)
    // One point 0.3 m off: least squares spreads it over every point's residual and the RMS.
    const off = fitSimilarity(
      from.map((p, k) => ({ from: p, to: k === 2 ? ([to(p)[0] + 0.3, to(p)[1]] as XY) : to(p) })),
    )
    expect(Math.max(...off.residualsM)).toBeGreaterThan(0.1)
    expect(off.rmsM).toBeGreaterThan(0.05)
    expect(off.rmsM).toBeLessThan(0.3)
    expect(() => fitSimilarity([{ from: [0, 0], to: [1, 1] }])).toThrow(/at least two/)
    expect(() =>
      fitSimilarity([
        { from: [5, 5], to: [1, 1] },
        { from: [5, 5], to: [9, 9] },
      ]),
    ).toThrow(/in one place/)
  })

  it('draws a grid at round file coordinates, in the file units', () => {
    expect(gridSpacingM(950)).toBe(100)
    expect(gridSpacingM(4200)).toBe(500)
    const plane = localPlaneProjection([1_000, 2_000])
    const sw = plane.toLonLat([0, 1_000]),
      ne = plane.toLonLat([2_000, 3_000])
    const grid = localPlaneGrid({ offsetM: [1_000, 2_000], unitM: 0.3048 }, [sw[0], sw[1], ne[0], ne[1]])
    expect(grid.features.length).toBeGreaterThan(10)
    // 600 m is 1,969 feet: labels are in the file's units.
    expect(grid.features.map((f) => f.properties.label)).toContain('E 1,969')
  })
})
