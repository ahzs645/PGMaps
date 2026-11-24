import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { albersToLngLat, lngLatToAlbers } from '../../dev-avast/projection'
import { DEFAULT_OLD_FOREST_SETTINGS, prepareUnit, unitFigures, type OldForestSettings } from './oldForest'
import { isTooLarge, overlapRefusal, poolFigures, poolOverlaps, tooLargeRefusal } from './pooling'
import type { Stand } from './reads'
import { oldForestUnit } from './units'
import { YOUNGER_STANDS_MAX_SHARE } from './youngerStands'

const [X0, Y0] = lngLatToAlbers(-122.5, 54)
function rect(x: number, y: number, w: number, h: number): Polygon {
  const c = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ].map(([px, py]) => albersToLngLat(X0 + px, Y0 + py))
  return { type: 'Polygon', coordinates: [c] }
}
const stand = (id: string, geometry: Polygon, age: number): Stand => ({
  id,
  projectedAge: age,
  projectedYear: 2025,
  harvestYear: null,
  treed: true,
  forestLandBase: true,
  leading: 'SX',
  geometry,
})
const settings = (s: Partial<OldForestSettings> = {}) => ({ ...DEFAULT_OLD_FOREST_SETTINGS, ...s })
const near = (a: number, b: number, tolerance = 0.02) => expect(Math.abs(a - b) / b).toBeLessThan(tolerance)

const A5 = oldForestUnit('Prince George', 'A5')! // 29% old, 40% of that interior, from 141
const A10 = oldForestUnit('Prince George', 'A10')! // 17% old, 30% of that interior, from 121

// Two units side by side. A5 (600 ha) holds 100 ha of old forest, short of its 174 ha; A10
// (600 ha) holds 300 ha, well over its 102 ha.
const shapeA5 = rect(0, 0, 3000, 2000)
const shapeA10 = rect(3000, 0, 3000, 2000)
const unitA5 = prepareUnit({
  unit: A5,
  shape: shapeA5,
  stands: [stand('a-old', rect(0, 0, 500, 2000), 200), stand('a-young', rect(500, 0, 2500, 2000), 110)],
  counted: [],
  corridors: [],
})
const unitA10 = prepareUnit({
  unit: A10,
  shape: shapeA10,
  stands: [stand('b-old', rect(3000, 0, 1500, 2000), 200), stand('b-young', rect(4500, 0, 1500, 2000), 40)],
  counted: [],
  corridors: [],
})

describe('D.2: pooling units', () => {
  it('sums each unit’s requirement at its own percentage, and the old forest held across units', () => {
    const years = [2026, 2031]
    const a = unitFigures(unitA5, [], years, years, settings())
    const b = unitFigures(unitA10, [], years, years, settings())
    const [pooled] = poolFigures([a, b])
    near(a[0].requiredOldHa, 174)
    near(b[0].requiredOldHa, 102)
    expect(pooled.cflbHa).toBeCloseTo(a[0].cflbHa + b[0].cflbHa, 6)
    expect(pooled.requiredOldHa).toBeCloseTo(a[0].requiredOldHa + b[0].requiredOldHa, 6)
    expect(pooled.oldHa).toBeCloseTo(a[0].oldHa + b[0].oldHa, 6)
    expect(pooled.requiredInteriorHa).toBeCloseTo(a[0].requiredInteriorHa + b[0].requiredInteriorHa, 6)
    expect(pooled.interiorHa).toBeCloseTo(a[0].interiorHa! + b[0].interiorHa!, 6)
    near(pooled.requiredOldHa, 276)
    near(pooled.oldHa, 400)
    // A5 alone is short; pooled with A10 it is not.
    expect(a[0].oldHa).toBeLessThan(a[0].requiredOldHa)
    expect(pooled.oldHa).toBeGreaterThan(pooled.requiredOldHa)
  })

  it('applies D.4’s ceiling again to the pool’s sums', () => {
    const d4 = settings({ younger: { fromAge: 100 } })
    const a = unitFigures(unitA5, [], [2026], [], d4)
    const b = unitFigures(unitA10, [], [2026], [], d4)
    const [pooled] = poolFigures([a, b])
    // Only A5's 110-year-old stands count (500 ha); A10's are 40.
    near(pooled.d4OldSupplyHa!, 500)
    near(pooled.d4OldHa!, YOUNGER_STANDS_MAX_SHARE * pooled.requiredOldHa)
  })

  it('refuses units that overlap on the ground, and passes ones that only touch', () => {
    expect(
      poolOverlaps([
        { label: 'A5', shape: shapeA5 },
        { label: 'A10', shape: shapeA10 },
      ]),
    ).toEqual([])
    const overlaps = poolOverlaps([
      { label: 'A5', shape: shapeA5 },
      { label: 'A10', shape: rect(2000, 0, 3000, 2000) },
    ])
    expect(overlaps).toHaveLength(1)
    near(overlaps[0].ha, 200)
    expect(overlapRefusal(overlaps)).toMatch(/A5 and A10 \(200 ha\).*counted twice, so nothing was calculated/)
  })

  it('refuses years that do not line up', () => {
    const a = unitFigures(unitA5, [], [2026], [], settings())
    const b = unitFigures(unitA10, [], [2031], [], settings())
    expect(() => poolFigures([a, b])).toThrow(/different years/)
  })

  it('names a unit too large to read live, and the tables it waits for', () => {
    expect(isTooLarge(Error('More than 30,000 records; the read stopped.'))).toBe(true)
    expect(isTooLarge(Error('More than 30,000 VRI stands in this unit; it needs a prepared table.'))).toBe(true)
    expect(isTooLarge(Error('DataBC answered 500.'))).toBe(false)
    expect(tooLargeRefusal('A13', true)).toMatch(/A13 has more than 30,000 VRI stands.*Pooling it needs the prepared/)
  })
})
