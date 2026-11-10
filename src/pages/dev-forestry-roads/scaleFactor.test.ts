import { describe, expect, it } from 'vitest'
import { combinedScaleFactor, gaussianRadius, gridToLocal, localToGrid, scaleFactorText } from './scaleFactor'
import { reduceTraverse } from './surveyInterchange'

// Reference numbers: RFLTools functional specification §13.8 (NAD83(CSRS)/GRS80, UTM zone 10).
describe('combined scale factor', () => {
  it('reproduces the reference table', () => {
    const at = (lat: number, lon: number, h: number) => {
      const scale = combinedScaleFactor(3157, { latitudeDeg: lat, longitudeDeg: lon }, h)
      if (!scale.ok) throw Error(scale.reason)
      return scale
    }
    const meridian = at(54, -123, 0)
    expect(meridian.pointScale).toBeCloseTo(0.9996, 8)
    expect(meridian.elevationFactor).toBe(1)
    expect(1000 / meridian.combined).toBeCloseTo(1000.4, 3)
    const east = at(54, -121.47, 1000)
    expect(east.pointScale).toBeCloseTo(0.99972341, 8)
    expect(east.elevationFactor).toBeCloseTo(0.9998434, 8)
    expect(east.combined).toBeCloseTo(0.99956686, 8)
    const princeGeorge = at(53.917, -122.75, 700)
    expect(princeGeorge.pointScale).toBeCloseTo(0.99960331, 8)
    expect(princeGeorge.elevationFactor).toBeCloseTo(0.99989037, 8)
    expect(princeGeorge.combined).toBeCloseTo(0.99949373, 8)
    expect(1000 / princeGeorge.combined).toBeCloseTo(1000.507, 3)
    expect(gaussianRadius(54)).toBeCloseTo(6384700, -2)
    expect(scaleFactorText(princeGeorge)).toContain('CSF 0.99949373')
  })
  it('refuses BC Albers and grids that are not UTM', () => {
    const albers = combinedScaleFactor(3005, { latitudeDeg: 54, longitudeDeg: -122.75 }, 0)
    expect(albers.ok).toBe(false)
    expect(scaleFactorText(albers)).toMatch(/equal-area/)
    expect(combinedScaleFactor(3857, { latitudeDeg: 54, longitudeDeg: -122.75 }, 0).ok).toBe(false)
  })
  it('converts local ground coordinates to grid about the project origin', () => {
    const grid = localToGrid([5100, 5000], [5000, 5000], [516420, 5974316.1], 0.99949373)
    expect(grid[0]).toBeCloseTo(516519.949, 3)
    expect(grid[1]).toBeCloseTo(5974316.1, 6)
    const back = gridToLocal(grid, [5000, 5000], [516420, 5974316.1], 0.99949373)
    expect(back[0]).toBeCloseTo(5100, 9)
  })
})

describe('a traverse with ground distances', () => {
  it('reduces ground distances to grid by the combined factor', () => {
    const legs = [{ id: 'A', bearingDegrees: 90, horizontalDistanceM: 1000, gradePercent: 0 }]
    const grid = reduceTraverse({ start: [500000, 5970000, 700], adjustment: 'none', legs })
    const ground = reduceTraverse({
      start: [500000, 5970000, 700],
      adjustment: 'none',
      legs,
      distanceScale: 0.99949373,
    })
    expect(grid.stations[1].raw[0] - 500000).toBeCloseTo(1000, 6)
    expect(ground.stations[1].raw[0] - 500000).toBeCloseTo(999.49373, 5)
    expect(() =>
      reduceTraverse({ start: [500000, 5970000, 700], adjustment: 'none', legs, distanceScale: 1.5 }),
    ).toThrow(/scale factor/)
  })
})
