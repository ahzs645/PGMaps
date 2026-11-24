import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { albersToLngLat, lngLatToAlbers } from '../../dev-avast/projection'
import { firstShortfall, metOnlyWithD4, shortfallText } from '../records'
import { DEFAULT_OLD_FOREST_SETTINGS, prepareUnit, unitFigures, type OldForestSettings } from './oldForest'
import type { CountedArea, Stand } from './reads'
import { oldForestUnit } from './units'
import { YOUNGER_STANDS_MAX_SHARE, youngerStandsProblem, youngerStandsSettings } from './youngerStands'

// A made-up unit near Prince George, in BC Albers metres so areas are exact (as oldForest.test.ts).
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
const stand = (id: string, geometry: Polygon, age: number | null, extra: Partial<Stand> = {}): Stand => ({
  id,
  projectedAge: age,
  projectedYear: 2025,
  harvestYear: null,
  treed: true,
  forestLandBase: true,
  leading: 'SX',
  geometry,
  ...extra,
})
const A5 = oldForestUnit('Prince George', 'A5')! // old from 141, 29% old, 40% of that interior
const settings = (s: Partial<OldForestSettings> = {}) => ({ ...DEFAULT_OLD_FOREST_SETTINGS, ...s })
const near = (a: number, b: number, tolerance = 0.02) => expect(Math.abs(a - b) / b).toBeLessThan(tolerance)

// 600 ha unit: 150 ha of old forest (750 m wide), then 450 ha of 120-year-old stands. Old forest
// needs 29% × 600 = 174 ha: 24 ha short, less than D.4's 20% (34.8 ha).
const unitShape = rect(0, 0, 3000, 2000)
const old = stand('old', rect(0, 0, 750, 2000), 200)
const mature = stand('mature', rect(750, 0, 2250, 2000), 120)
const prep = (counted: CountedArea[] = []) =>
  prepareUnit({ unit: A5, shape: unitShape, stands: [old, mature], counted, corridors: [] })
const d4 = { younger: { fromAge: 100 } }

describe('D.4: younger stands', () => {
  it('changes nothing while it is off', () => {
    const p = prep()
    const off = unitFigures(p, [], [2026, 2031], [2026], settings())
    expect(unitFigures(p, [], [2026, 2031], [2026], settings({ younger: null }))).toEqual(off)
    expect(Object.keys(off[0])).not.toContain('d4OldHa')
    expect(firstShortfall(off)).toEqual({ year: 2026, what: ['old'] })
    expect(metOnlyWithD4(off)).toBeNull()
  })

  it('counts younger stands up to 20% of the old requirement, and never more', () => {
    const [y] = unitFigures(prep(), [], [2026], [], settings(d4))
    near(y.oldHa, 150)
    near(y.requiredOldHa, 174)
    near(y.d4OldSupplyHa!, 450)
    near(y.d4OldHa!, YOUNGER_STANDS_MAX_SHARE * 174)
    expect(y.d4OldHa).toBeLessThanOrEqual(YOUNGER_STANDS_MAX_SHARE * y.requiredOldHa + 1e-9)
    // The figures D.4 does not touch stay as they were.
    const [off] = unitFigures(prep(), [], [2026], [], settings())
    expect(y.oldHa).toBe(off.oldHa)
    expect(y.nonPineOldHa).toBe(off.nonPineOldHa)
    expect(firstShortfall([y])).toBeNull()
    expect(metOnlyWithD4([y])).toEqual({ year: 2026, what: ['old'] })
    expect(shortfallText([y])).toBe('no shortfall over the projection; old met only with D.4 from 2026')
  })

  it('counts only stands from the stated age, and never ground already counted whole or reset', () => {
    const [tooYoung] = unitFigures(prep(), [], [2026], [], settings({ younger: { fromAge: 130 } }))
    expect(tooYoung.d4OldSupplyHa).toBe(0)
    const ogma: CountedArea = {
      kind: 'ogma-legal',
      id: 'o',
      name: 'o',
      date: null,
      geometry: rect(2500, 0, 500, 2000),
    }
    const block = { year: 2030, geometry: rect(750, 0, 500, 2000) }
    const [y] = unitFigures(prep([ogma]), [block], [2031], [], settings(d4))
    near(y.oldHa, 150 + 100)
    near(y.d4OldSupplyHa!, 450 - 100 - 100)
  })

  it('counts younger stands toward interior, capped at 20% of the interior requirement', () => {
    // Under the 2004 method the 120-year-old stands are an edge: 200 m comes off the old strip.
    const [off] = unitFigures(prep(), [], [2026], [2026], settings({ interiorMethod: '2004' }))
    near(off.interiorHa!, (550 * 2000) / 10_000)
    const [y] = unitFigures(prep(), [], [2026], [2026], settings({ interiorMethod: '2004', ...d4 }))
    expect(y.interiorHa).toBe(off.interiorHa)
    near(y.d4InteriorSupplyHa!, 600 - 110)
    near(y.d4InteriorHa!, YOUNGER_STANDS_MAX_SHARE * y.requiredInteriorHa)
    // Without interior years there is no interior figure, with D.4 or without.
    const [none] = unitFigures(prep(), [], [2026], [], settings(d4))
    expect(none.d4InteriorSupplyHa).toBeNull()
    expect(none.d4InteriorHa).toBeNull()
  })

  it('needs the age and the conservation benefit before anything is calculated', () => {
    expect(youngerStandsProblem({ benefit: 'Better connectivity.' }, [A5])).toMatch(/state the age/)
    expect(youngerStandsProblem({ fromAge: 141, benefit: 'Better connectivity.' }, [A5])).toMatch(
      /below A5’s old age \(141/,
    )
    expect(youngerStandsProblem({ fromAge: 100, benefit: '  ' }, [A5])).toMatch(/conservation benefit/)
    expect(() => youngerStandsSettings({ fromAge: 100, benefit: '' }, [A5])).toThrow(/conservation benefit/)
    expect(youngerStandsSettings(undefined, [A5])).toBeNull()
    expect(youngerStandsSettings({ fromAge: 100, benefit: 'Better connectivity.' }, [A5])).toEqual({ fromAge: 100 })
    // Pooled units each have their own old age: the age must be below all of them.
    const A10 = oldForestUnit('Prince George', 'A10')! // old from 121
    expect(youngerStandsProblem({ fromAge: 130, benefit: 'x' }, [A5, A10])).toMatch(/A10/)
  })
})
