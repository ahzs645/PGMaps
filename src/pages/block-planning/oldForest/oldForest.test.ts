import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { albersToLngLat, lngLatToAlbers } from '../../dev-avast/projection'
import {
  ageIn,
  DEFAULT_OLD_FOREST_SETTINGS,
  firstShortfall,
  leadingGroup,
  prepareUnit,
  unitFigures,
  type OldForestSettings,
} from './oldForest'
import type { CountedArea, Stand } from './reads'
import { oldForestUnit } from './units'

// A made-up unit near Prince George, built in BC Albers metres so areas are exact.
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
const unitShape = rect(0, 0, 3000, 2000)
const settings = (s: Partial<OldForestSettings> = {}) => ({ ...DEFAULT_OLD_FOREST_SETTINGS, ...s })
const near = (a: number, b: number, tolerance = 0.02) => expect(Math.abs(a - b) / b).toBeLessThan(tolerance)

describe('ages', () => {
  it('reads VRI ages as projected, and a harvest as a new stand', () => {
    const s = stand('a', rect(0, 0, 10, 10), 150)
    expect(ageIn(s, 2025)).toBe(150)
    expect(ageIn(s, 2035)).toBe(160)
    expect(ageIn(s, 2019)).toBe(144)
    const cut = { ...s, harvestYear: 2021, projectedAge: 4 }
    expect(ageIn(cut, 2030)).toBe(9)
    expect(ageIn(cut, 2019)).toBeNull()
  })

  it('groups leading species', () => {
    expect(leadingGroup('PLI')).toBe('pine')
    expect(leadingGroup('AT')).toBe('deciduous')
    expect(leadingGroup('SX')).toBe('conifer')
    expect(leadingGroup('BL')).toBe('conifer')
  })
})

describe('old and interior forest', () => {
  // Left 2 km: one old spruce stand. Right 1 km: young pine (makes an edge) or mature (does not).
  const old = stand('old', rect(0, 0, 2000, 2000), 200)
  const youngPine = stand('young', rect(2000, 0, 1000, 2000), 30, { leading: 'PLI' })
  const mature = stand('mature', rect(2000, 0, 1000, 2000), 100)
  const prep = (neighbour: Stand, counted: CountedArea[] = []) =>
    prepareUnit({ unit: A5, shape: unitShape, stands: [old, neighbour], counted, corridors: [] })

  it('counts old forest on the CFLB and sets it against the order’s share', () => {
    const [y] = unitFigures(prep(youngPine), [], [2026], [], settings())
    near(y.cflbHa, 600)
    near(y.oldHa, 400)
    near(y.requiredOldHa, 600 * 0.29)
    expect(y.interiorHa).toBeNull()
  })

  it('takes 200 m from old forest next to young pine, and none next to mature forest', () => {
    const [young] = unitFigures(prep(youngPine), [], [2026], [2026], settings())
    near(young.interiorHa!, ((2000 - 200) * 2000) / 10_000)
    const [matureY] = unitFigures(prep(mature), [], [2026], [2026], settings())
    near(matureY.interiorHa!, 400)
    // The 2004 method buffers against anything younger than old, mature included.
    const [y2004] = unitFigures(prep(mature), [], [2026], [2026], settings({ interiorMethod: '2004' }))
    near(y2004.interiorHa!, ((2000 - 200) * 2000) / 10_000)
  })

  it('makes a block’s ground young from its year, and leaves out interior narrower than 200 m', () => {
    const block = { year: 2031, geometry: rect(0, 0, 1850, 2000) }
    const [before, after] = unitFigures(prep(mature), [block], [2026, 2031], [2026, 2031], settings())
    near(before.oldHa, 400)
    near(after.oldHa, (150 * 2000) / 10_000)
    // 150 m of old forest left beside the block: too narrow to be interior.
    expect(after.interiorHa).toBe(0)
    expect(firstShortfall([before, after])).toEqual({ year: 2031, what: ['old', 'old non-pine', 'old interior'] })
  })

  it('counts a legal OGMA whole, and a non-legal one only when switched on', () => {
    const ogma = (kind: CountedArea['kind']): CountedArea => ({
      kind,
      id: kind,
      name: kind,
      date: null,
      geometry: rect(2500, 0, 500, 2000),
    })
    const [legal] = unitFigures(prep(mature, [ogma('ogma-legal')]), [], [2026], [], settings())
    near(legal.oldHa, 500)
    near(legal.countedNotOldHa, 100)
    const [off] = unitFigures(
      prep(mature, [ogma('ogma-non-legal')]),
      [],
      [2026],
      [],
      settings({ countNonLegalOgmas: false }),
    )
    near(off.oldHa, 400)
  })

  it('applies the proxy’s shares to a stated CFLB', () => {
    const [proxy] = unitFigures(prep(youngPine), [], [2026], [2026], settings())
    const [y] = unitFigures(prep(youngPine), [], [2026], [2026], settings({ cflbEnteredHa: 1000 }))
    expect(y.cflbHa).toBe(1000)
    near(y.requiredOldHa, 290)
    near(y.oldHa / y.cflbHa, proxy.oldHa / proxy.cflbHa, 0.001)
    near(y.interiorHa! / y.cflbHa, proxy.interiorHa! / proxy.cflbHa, 0.001)
  })
})
