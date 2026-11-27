import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import order2008 from '../../../../packages/legal-rules/catalogue/orders/bc.mackenzie.biodiversity.2008.json'
import amendment2010 from '../../../../packages/legal-rules/catalogue/orders/bc.mackenzie.biodiversity-amendment.2010.json'
import { albersToLngLat, lngLatToAlbers } from '../../dev-avast/projection'
import { DEFAULT_OLD_FOREST_SETTINGS, prepareUnit, unitFigures } from './oldForest'
import { heldOld, liveOldAllowance, mackenzieShortfallText, mackenzieYears, outsideRows } from './mackenzie'
import { mackenzieYoungerProblem } from './mackenzieRecord'
import {
  DROPPED_IN_2010,
  MACKENZIE_ORDER,
  MACKENZIE_UNITS,
  mackenzieOldFrom,
  mackenzieUnit,
  rowOf,
  standGroup,
  table1Variants,
} from './mackenzieUnits'
import { smallCommunityForest } from './mackenzieReads'
import type { Stand } from './reads'
import { oldForestUnit } from './units'

const rowKey = (r: { unitsAsPrinted: string; beo: string; groups: string[]; oldPercent: number }) =>
  `${r.unitsAsPrinted}|${r.beo}|${r.groups.join(',')}|${r.oldPercent}`

describe('the Mackenzie order’s tables', () => {
  const t2010 = MACKENZIE_ORDER.table2.rows
  const t2008 = MACKENZIE_ORDER.table2As2008.rows

  it('holds the 2010 Table 2’s 72 rows and the 2008 table’s 93', () => {
    expect(t2010).toHaveLength(72)
    expect(t2008).toHaveLength(93)
  })

  it('reads the 2010 table as the 2008 table less the seven groups given legal OGMAs', () => {
    // Two transcriptions made apart (the 2008 text layer, the 2010 page images) must agree.
    const kept = t2008.filter((r) => !DROPPED_IN_2010.includes(r.unitsAsPrinted)).map(rowKey)
    expect(t2010.map(rowKey).sort()).toEqual(kept.sort())
    expect(DROPPED_IN_2010).toHaveLength(7)
  })

  it('agrees with every table row the catalogue transcriptions quote', () => {
    const quotes = (o: typeof order2008 | typeof amendment2010, id: string) =>
      o.provisions.find((p) => p.id === id)!.quotes
    // "Kennedy High 3 28" (2008 Table 2), "Selwyn | High | 3 | 28" (2010), "3 25 50 50" (Table 3),
    // "4 SBSmk1, SBSmk2, SBSwk1" (Table 1).
    const has2008 = (unit: string, beo: string, group: string, pct: number) =>
      t2008.some(
        (r) => r.unitsAsPrinted === unit && r.beo === beo && r.groupsAsPrinted === group && r.oldPercent === pct,
      )
    expect(quotes(order2008, 'Table 2 (2008)')).toContain('Kennedy High 3 28')
    expect(has2008('Kennedy', 'High', '3', 28)).toBe(true)
    expect(quotes(amendment2010, '1(b)')).toContain('Selwyn | High | 3 | 28')
    expect(t2010.some((r) => r.unitsAsPrinted === 'Selwyn' && r.groupsAsPrinted === '3' && r.oldPercent === 28)).toBe(
      true,
    )
    expect(quotes(order2008, 'Table 3')).toContain('3 25 50 50')
    expect(MACKENZIE_ORDER.table3.rows.find((r) => r.group === '3')).toEqual({
      group: '3',
      Low: 25,
      Intermediate: 50,
      High: 50,
    })
    expect(quotes(order2008, '1.5 Table 1')).toContain('4 SBSmk1, SBSmk2, SBSwk1')
    expect(MACKENZIE_ORDER.table1.groups.find((g) => g.group === '4')!.variants).toEqual(['SBSmk1', 'SBSmk2', 'SBSwk1'])
  })

  it('gives every unit exactly the 2010 table’s rows, and the BWBS deciduous row of its emphasis option', () => {
    expect(MACKENZIE_UNITS).toHaveLength(29)
    for (const unit of MACKENZIE_UNITS) {
      const printed = t2010.filter((r) => r.unitsAsPrinted === unit.asPrinted)
      const own = unit.rows.filter((r) => !r.groups.includes('6&7'))
      expect(own.map((r) => `${r.groups.join(',')}|${r.oldPercent}`)).toEqual(
        printed.map((r) => `${r.groups.join(',')}|${r.oldPercent}`),
      )
      const decid = unit.rows.find((r) => r.groups.includes('6&7'))!
      expect(decid.oldPercent).toBe(unit.beos.includes('High') ? 19 : 13)
      expect(unit.landscapeUnits.length).toBe(unit.asPrinted.split(',').length)
      for (const lu of unit.landscapeUnits) expect(unit.beos).toContain(lu.beo)
    }
  })

  it('sets interior by Table 3, and leaves open the rows the order does not settle', () => {
    const interior = (id: string, groups: string) =>
      mackenzieUnit(id)!.rows.find((r) => r.groups.join(',') === groups)!.interiorPercent
    expect(interior('nation', '4,5')).toBe(25)
    expect(interior('selwyn', '3')).toBe(50)
    expect(interior('blackwater', '3')).toBe(25)
    expect(interior('blackwater', '4,7')).toBe(10)
    expect(interior('nation', '6&7')).toBe(25)
    expect(interior('akie-akie-river', '6&7')).toBe(10)
    // "2, 3" at High is 25% or 50%; "Low / Intermediate" is 10% or 25%.
    expect(interior('upper-ospika', '2,3')).toBeNull()
    expect(mackenzieUnit('upper-ospika')!.rows[0].interiorNote).toMatch(/25% for group 2 at High, 50% for group 3/)
    for (const r of mackenzieUnit('philip-philip-lake-tudyah-a')!.rows) expect(r.interiorPercent).toBeNull()
  })

  it('names Objective 2(d)’s parks only for units still in the table', () => {
    expect(mackenzieUnit('blackwater')!.park?.asPrinted).toBe('Muscovite Lakes Park')
    expect(mackenzieUnit('buffalohead')!.park?.asPrinted).toBe('Ed Bird Estella Lake Park')
    expect(MACKENZIE_UNITS.filter((u) => u.park)).toHaveLength(2)
  })
})

describe('the order’s definitions', () => {
  it('reads old forest by the stand’s own BEC unit and leading species', () => {
    expect(mackenzieOldFrom({ bec: 'SBS mk1', leading: 'SX' })).toBe(121)
    expect(mackenzieOldFrom({ bec: 'SBS mk2', leading: 'PLI' })).toBe(121)
    expect(mackenzieOldFrom({ bec: 'SBS wk1', leading: 'SX' })).toBe(141)
    expect(mackenzieOldFrom({ bec: 'BWBS dk', leading: 'AT' })).toBe(101)
    expect(mackenzieOldFrom({ bec: 'BWBS mw', leading: 'EP' })).toBe(101)
    expect(mackenzieOldFrom({ bec: 'BWBS dk', leading: 'SW' })).toBe(141)
    // Deciduous species are birch or aspen only: a cottonwood-leading stand is old from 141.
    expect(mackenzieOldFrom({ bec: 'BWBS mw', leading: 'AC' })).toBe(141)
    expect(mackenzieOldFrom({ bec: 'SBS wk2', leading: 'AT' })).toBe(141)
    expect(mackenzieOldFrom({ bec: null, leading: null })).toBe(141)
  })

  it('puts each stand in its Table 1 group, reading later BEC labels only where they name one group', () => {
    expect(standGroup({ bec: 'SBS wk1', leading: 'SX' })).toBe('4')
    expect(standGroup({ bec: 'ESSF mv4', leading: 'BL' })).toBe('2') // printed "ESSmv4"
    expect(standGroup({ bec: 'BWBS dk', leading: 'SW' })).toBe('7') // BWBSdk1
    expect(standGroup({ bec: 'BWBS mw', leading: 'PLI' })).toBe('6') // BWBSmw1
    expect(standGroup({ bec: 'BWBS dk', leading: 'AT' })).toBe('6&7')
    expect(standGroup({ bec: 'ESSF mvp', leading: 'BL' })).toBe('1') // ESSFmvp2 to 4
    expect(standGroup({ bec: 'ESSF wcp', leading: 'BL' })).toBe('1') // ESSFwcp3
    expect(standGroup({ bec: 'BAFA un', leading: null })).toBeNull()
    // ESSFmv would stand for ESSFmv2 to 4 (group 2) and ESSFmvp2 to 4 (group 1): no group.
    expect(table1Variants('ESSFmv')).toEqual({ variants: [], group: null })
  })

  it('leaves out only community forests of 600 ha or less', () => {
    expect(smallCommunityForest(600)).toBe(true)
    expect(smallCommunityForest(600.5)).toBe(false)
    expect(smallCommunityForest(26_302)).toBe(false)
  })
})

describe('Objective 2’s live old forest arithmetic', () => {
  it('counts the dead part as Natural Forest Area, capped by the affected share when one is stated', () => {
    expect(
      liveOldAllowance({ requiredOldHa: 100, deadOldHa: 30, affectedPercent: null, youngerSupplyHa: null }),
    ).toEqual({ nfaHa: 30, liveTargetHa: 70, youngerHa: null })
    expect(
      liveOldAllowance({ requiredOldHa: 100, deadOldHa: 30, affectedPercent: 20, youngerSupplyHa: null }).nfaHa,
    ).toBe(20)
  })

  it('lets younger stands make up at most 20% of the live old forest part of the target', () => {
    const a = liveOldAllowance({ requiredOldHa: 100, deadOldHa: 30, affectedPercent: 20, youngerSupplyHa: 500 })
    expect(a.liveTargetHa).toBe(80)
    expect(a.youngerHa).toBe(16) // 20% of 80, never 20% of 100
    expect(
      liveOldAllowance({ requiredOldHa: 100, deadOldHa: 0, affectedPercent: null, youngerSupplyHa: 5 }).youngerHa,
    ).toBe(5)
  })

  it('needs the age and the benefit before younger stands count', () => {
    expect(mackenzieYoungerProblem(undefined)).toBeNull()
    expect(mackenzieYoungerProblem({ benefit: 'x' })).toMatch(/no default/)
    expect(mackenzieYoungerProblem({ fromAge: 141, benefit: 'x' })).toMatch(/below 141/)
    expect(mackenzieYoungerProblem({ fromAge: 100, benefit: ' ' })).toMatch(/benefit/)
    expect(mackenzieYoungerProblem({ fromAge: 100, benefit: 'Connectivity.' })).toBeNull()
  })
})

// A made-up piece of Nation (High: groups 4 and 5 at 16%, 25% of that interior; BWBS deciduous at 19%),
// built in BC Albers metres so areas are exact.
const [X0, Y0] = lngLatToAlbers(-123.9, 55.6)
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
  bec: 'SBS mk1',
  geometry,
  ...extra,
})
const NATION = mackenzieUnit('nation')!
const near = (a: number, b: number, tolerance = 0.02) => expect(Math.abs(a - b) / b).toBeLessThan(tolerance)
const OFF = { affectedPercent: null, youngerFromAge: null }

describe('Mackenzie old and interior forest', () => {
  // Left 2 km: SBS mk1 aged 130 (old from 121), half its stems dead. Right 1 km: SBS wk2 aged 100
  // (group 5, old from 141). West of the unit, touching it: a lake.
  const old = stand('old', rect(0, 0, 2000, 2000), 130, { deadPercent: 50 })
  const younger = stand('younger', rect(2000, 0, 1000, 2000), 100, { bec: 'SBS wk2' })
  const lake = stand('lake', rect(-500, 0, 500, 2000), null, { treed: false, forestLandBase: false, cover5: 'LA' })
  const shape = rect(0, 0, 3000, 2000)
  const prep = (stands: Stand[]) => prepareUnit({ unit: NATION, shape, stands, counted: [], corridors: [] })
  const g45 = (y: { rows: { row: string }[] }) =>
    y.rows.find((r) => r.row === 'g4+5')! as ReturnType<typeof mackenzieYears>[number]['rows'][number]

  it('sets each row’s old forest against its share of the CFLB in its groups', () => {
    const [y] = mackenzieYears(prep([old, younger]), [], [2026], [], OFF)
    const r = g45(y)
    near(r.cflbHa, 600)
    near(r.requiredOldHa, 600 * 0.16)
    near(r.oldHa, 400)
    near(r.deadOldHa, 200)
    near(r.nfaHa, 200)
    near(heldOld(r), 400)
    expect(r.interiorHa).toBeNull()
    expect(rowOf(NATION, '6&7')!.oldPercent).toBe(19)
  })

  it('caps the Natural Forest Area at the affected share of the target', () => {
    const [y] = mackenzieYears(prep([old, younger]), [], [2026], [], { ...OFF, affectedPercent: 25 })
    const r = g45(y)
    near(r.nfaHa, 96 * 0.25)
    near(heldOld(r), 200 + 24)
  })

  it('takes 200 m from old forest beside a lake, and gives interior to the row whose old ground it lies on', () => {
    const [withLake] = mackenzieYears(prep([old, younger, lake]), [], [2026], [2026], OFF)
    near(g45(withLake).interiorHa!, (1800 * 2000) / 10_000)
    near(g45(withLake).requiredInteriorHa!, 96 * 0.25)
    const [noLake] = mackenzieYears(prep([old, younger, { ...lake, cover5: null }]), [], [2026], [2026], OFF)
    near(g45(noLake).interiorHa!, 400)
  })

  it('counts younger stands toward old forest only, and never toward interior', () => {
    const alive = { ...old, deadPercent: null }
    const [off] = mackenzieYears(prep([alive, younger, lake]), [], [2026], [2026], OFF)
    const [on] = mackenzieYears(prep([alive, younger, lake]), [], [2026], [2026], { ...OFF, youngerFromAge: 90 })
    near(g45(on).youngerSupplyHa!, 200)
    near(g45(on).youngerHa!, 0.2 * 96)
    expect(g45(on).interiorHa).toBe(g45(off).interiorHa)
    expect(g45(off).youngerHa).toBeUndefined()
  })

  it('makes a block young from its year', () => {
    const block = { year: 2030, geometry: rect(0, 0, 1000, 2000) }
    const [y26, y31] = mackenzieYears(prep([old, younger]), [block], [2026, 2031], [], OFF)
    near(g45(y26).oldHa, 400)
    near(g45(y31).oldHa, 200)
  })

  it('counts BWBS deciduous-leading stands in their own row from 101 years, and names CFLB no row holds', () => {
    const decid = stand('decid', rect(2000, 0, 1000, 1000), 105, { bec: 'BWBS mw', leading: 'AT' })
    const essf = stand('essf', rect(2000, 1000, 1000, 1000), 200, { bec: 'ESSF mv3', leading: 'BL' })
    const p = prep([old, decid, essf])
    const [y] = mackenzieYears(p, [], [2026], [], OFF)
    const d = y.rows.find((r) => r.row === 'g6&7')!
    near(d.cflbHa, 100)
    near(d.oldHa, 100)
    // Nation has no group 2 row: ESSFmv3 is named, never counted.
    expect(outsideRows(p).map((o) => [o.label, o.group, Math.round(o.cflbHa)])).toEqual([['ESSFmv3', '2', 100]])
  })

  it('says which row falls short first', () => {
    const youngOnly = stand('y', rect(0, 0, 3000, 2000), 50)
    const [y] = mackenzieYears(prep([youngOnly]), [], [2026], [], OFF)
    expect(mackenzieShortfallText([y], NATION)).toBe('short of old (group 4, 5) from 2026')
  })
})

describe('the Prince George calculation', () => {
  it('ignores the fields only the Mackenzie order reads', () => {
    const A5 = oldForestUnit('Prince George', 'A5')!
    const shape = rect(0, 0, 3000, 2000)
    const plain = [
      stand('old', rect(0, 0, 2000, 2000), 200, { bec: 'ESSF wk2' }),
      stand('young', rect(2000, 0, 1000, 2000), 30, { leading: 'PLI', bec: 'ESSF wk2' }),
      stand('lake', rect(-500, 0, 500, 2000), null, { treed: false, forestLandBase: false }),
    ]
    const withFields = plain.map((s, i) => ({ ...s, deadPercent: 60, cover5: i === 2 ? 'LA' : null }))
    const figures = (stands: Stand[]) =>
      unitFigures(prepareUnit({ unit: A5, shape, stands, counted: [], corridors: [] }), [], [2026, 2031], [2026], {
        ...DEFAULT_OLD_FOREST_SETTINGS,
      })
    expect(figures(withFields)).toEqual(figures(plain))
  })
})
