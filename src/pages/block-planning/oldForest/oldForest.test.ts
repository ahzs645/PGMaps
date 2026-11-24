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
import type { ExcludedArea } from './landBase'
import type { CountedArea, Corridor, Stand } from './reads'
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

describe('ground the order does not apply to', () => {
  // Left 2 km old spruce, right 1 km young pine, as above.
  const old = stand('old', rect(0, 0, 2000, 2000), 200)
  const youngPine = stand('young', rect(2000, 0, 1000, 2000), 30, { leading: 'PLI' })
  const excluded = (kind: ExcludedArea['kind'], geometry: Polygon): ExcludedArea => ({
    kind,
    id: kind,
    name: kind,
    geometry,
  })
  const prep = (ex: ExcludedArea[] | undefined, counted: CountedArea[] = [], corridors: Corridor[] = []) =>
    prepareUnit({ unit: A5, shape: unitShape, stands: [old, youngPine], counted, corridors, excluded: ex })

  it('leaves a plan with nothing to exclude exactly as before', () => {
    const before = unitFigures(prep(undefined), [], [2026], [2026], settings())
    const empty = unitFigures(prep([]), [], [2026], [2026], settings())
    expect(empty).toEqual(before)
    expect(prep([]).excluded).toEqual([])
  })

  it('takes private land and a TFL out of the CFLB and old forest, and reports each by kind', () => {
    // A private parcel over 500 m of the old stand, a TFL over 500 m of the young pine.
    const p = prep([excluded('non-crown', rect(0, 0, 500, 2000)), excluded('tfl', rect(2500, 0, 1000, 2000))])
    const [y] = unitFigures(p, [], [2026], [], settings())
    near(y.cflbHa, 400)
    near(y.oldHa, 300)
    near(y.requiredOldHa, 400 * 0.29)
    const byKind = Object.fromEntries(p.excluded.map((e) => [e.kind, e]))
    near(byKind['non-crown'].cflbHa, 100)
    near(byKind['non-crown'].grossHa, 100)
    // The TFL reaches past the unit: only its 100 ha inside counts.
    near(byKind.tfl.grossHa, 100)
    near(byKind.tfl.cflbHa, 100)
  })

  it('reports ground two sources hold once, under the first kind', () => {
    const p = prep([excluded('non-crown', rect(0, 0, 500, 2000)), excluded('woodlot', rect(0, 0, 1000, 2000))])
    const byKind = Object.fromEntries(p.excluded.map((e) => [e.kind, e]))
    near(byKind['non-crown'].grossHa, 100)
    near(byKind.woodlot.grossHa, 100)
    near(unitFigures(p, [], [2026], [], settings())[0].cflbHa, 400)
  })

  it('never counts D.1 ground on excluded land', () => {
    const ogma: CountedArea = {
      kind: 'ogma-legal',
      id: 'o',
      name: 'o',
      date: null,
      geometry: rect(2000, 0, 1000, 2000),
    }
    const [y] = unitFigures(
      prep([excluded('community-forest', rect(2500, 0, 500, 2000))], [ogma]),
      [],
      [2026],
      [],
      settings(),
    )
    near(y.countedNotOldHa, 100)
    near(y.oldHa, 500)
  })

  it('lets old forest across a tenure boundary shape interior without counting it', () => {
    // The old stand's western 300 m is a woodlot. Without it, the Crown part loses nothing to
    // the boundary: interior is still 200 m short of the young pine, counted on Crown ground only.
    const [y] = unitFigures(prep([excluded('woodlot', rect(0, 0, 300, 2000))]), [], [2026], [2026], settings())
    near(y.interiorHa!, ((2000 - 300 - 200) * 2000) / 10_000)
    // A woodlot leaving only a 150 m strip of Crown old forest beside the pine's buffer: the strip
    // is part of a wide old patch, so it is interior.
    const [strip] = unitFigures(prep([excluded('woodlot', rect(0, 0, 1650, 2000))]), [], [2026], [2026], settings())
    near(strip.interiorHa!, (150 * 2000) / 10_000)
  })
})

describe('pipeline corridors', () => {
  const old = stand('old', rect(0, 0, 3000, 2000), 200)
  const prep = (corridors: Corridor[]) =>
    prepareUnit({ unit: A5, shape: unitShape, stands: [old], counted: [], corridors })
  const line = (x: number): Corridor => ({
    kind: 'pipeline',
    geometry: {
      type: 'LineString',
      coordinates: [albersToLngLat(X0 + x, Y0 - 100), albersToLngLat(X0 + x, Y0 + 2100)],
    },
  })
  const rightOfWay = (x: number, width: number): Corridor => ({
    kind: 'pipeline',
    geometry: rect(x, -100, width, 2200),
  })

  it('takes 200 m either side of a pipeline segment from interior', () => {
    const [none] = unitFigures(prep([]), [], [2026], [2026], settings())
    near(none.interiorHa!, 600)
    const [y] = unitFigures(prep([line(1500)]), [], [2026], [2026], settings())
    near(y.interiorHa!, ((3000 - 400) * 2000) / 10_000)
    expect(prep([line(1500)]).counts.corridorKinds).toEqual({ pipeline: 1 })
  })

  it('buffers a right-of-way area like a line, from its edges', () => {
    const [y] = unitFigures(prep([rightOfWay(1480, 40)]), [], [2026], [2026], settings())
    near(y.interiorHa!, ((3000 - 440) * 2000) / 10_000)
    // Beside a line, the areas and the lines both make edges.
    const [both] = unitFigures(prep([rightOfWay(1480, 40), line(500)]), [], [2026], [2026], settings())
    near(both.interiorHa!, ((3000 - 440 - 400) * 2000) / 10_000)
  })
})
