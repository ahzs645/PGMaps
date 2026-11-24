import { describe, expect, it } from 'vitest'
import { groundInstrument } from '@/lib/legal/groundInstruments'
import type { GroundFeature, GroundInstrumentRead, GroundRead } from './record'
import {
  exceptionsToRequest,
  featureKey,
  wildlifeAnswer,
  wildlifeCitesText,
  wildlifeRows,
  withheldRequests,
} from './wildlifeMeasures'

const uwr = (order: string, unit: string, overlapHa = 1): GroundFeature => ({
  id: `UWR ${order} ${unit}`,
  name: 'M-RATA-01',
  details: [],
  identifiers: [
    { label: 'UWR', value: order },
    { label: 'Unit', value: unit },
  ],
  overlapHa,
  sharePercent: 10,
})
const wha = (tag: string, overlapHa = 1): GroundFeature => ({
  id: `WHA ${tag}`,
  name: 'Caribou',
  details: [],
  identifiers: [{ label: 'WHA', value: tag }],
  overlapHa,
  sharePercent: 10,
})
const NO_HARVEST = groundInstrument('uwr-no-harvest')!
const CONDITIONAL = groundInstrument('uwr-conditional')!
const WHA_NO_HARVEST = groundInstrument('wha-no-harvest')!
const WHA_CONDITIONAL = groundInstrument('wha-conditional')!
const states = (a: ReturnType<typeof wildlifeAnswer>) =>
  a && [a.reach.harvest, a.reach.replant, a.reach.roads, a.reach.grazing].map((c) => c.state)

describe('general wildlife measures on a found range or habitat area', () => {
  it('reads the order and unit a feature names', () => {
    expect(featureKey(NO_HARVEST, uwr('u-7-003', 'P-002'))).toEqual({
      layer: 'uwr',
      key: 'u-7-003',
      unit: 'P-002',
      harvestCode: 'NO HARVEST ZONE',
    })
    expect(featureKey(WHA_NO_HARVEST, wha('7-003'))).toMatchObject({ layer: 'wha', key: '7-003' })
  })

  it('answers a caribou high unit of U-7-003 from GWM 2(a), and leaves replanting and grazing to other law', () => {
    const a = wildlifeAnswer(NO_HARVEST, uwr('u-7-003', 'P-002'))!
    expect(a.status).toBe('read')
    expect(states(a)).toEqual(['governs', 'no-reach', 'governs', 'no-reach'])
    expect(a.reach.harvest.note).toContain('GWM 2(a)')
    expect(a.reach.harvest.cites).toEqual(
      expect.arrayContaining([
        { source: 'bc.uwr.u-7-003', provision: 'GWM 2(a)' },
        { source: 'bc.fppr', provision: 's. 69' },
      ]),
    )
    expect(wildlifeCitesText(a.reach.harvest.cites)).toContain('UWR u-7-003 order GWM 2(a)')
    expect(a.reach.grazing.note).toMatch(/set nothing on grazing/)
    expect(a.exemptions.map((e) => e.ref)).toEqual(expect.arrayContaining(['GWM 2(b)', 'GWM 2(c)', 'GWM 2(d)']))
    // A corridor unit: conditions, not a prohibition.
    const corridor = wildlifeAnswer(CONDITIONAL, uwr('u-7-003', 'P-001'))!
    expect(states(corridor)).toEqual(['conditions', 'no-reach', 'conditions', 'no-reach'])
    expect(corridor.exemptions.map((e) => e.ref)).not.toContain('GWM 2(b)')
  })

  it('answers the 2022 moose order by unit: no primary forest activities in a no harvest unit', () => {
    const no = wildlifeAnswer(NO_HARVEST, uwr('u-7-022', '1'))!
    expect(states(no)).toEqual(['governs', 'governs', 'governs', 'conditions'])
    const cond = wildlifeAnswer(CONDITIONAL, uwr('u-7-022', '3'))!
    expect(states(cond)).toEqual(['conditions', 'conditions', 'conditions', 'no-reach'])
    expect(cond.reach.replant.note).toContain('Part 4, objective 1')
    expect(cond.reach.replant.cites.map((c) => c.source)).toEqual(['bc.uwr.omineca-moose-2022', 'bc.fppr', 'bc.frpa'])
  })

  it('says a Code order binds through the forest stewardship plan', () => {
    const a = wildlifeAnswer(NO_HARVEST, uwr('u-7-013', 'PGD-005'))!
    expect(states(a)).toEqual(['governs', 'conditions', 'governs', 'conditions'])
    expect(a.binds.kind).toBe('via-fsp')
    expect(a.reach.harvest.note).toMatch(/continued objective/)
    expect(a.reach.harvest.cites.map((c) => c.source)).toEqual(['bc.uwr.u-7-013', 'bc.frpa'])
  })

  it('keeps Unknown, naming the order, where a read order does not name the unit', () => {
    const a = wildlifeAnswer(CONDITIONAL, uwr('u-7-003', 'Z-999'))!
    expect(a.status).toBe('unit-not-named')
    expect(a.reach.replant.state).toBe('unknown')
    expect(a.reach.replant.note).toMatch(/names no zone for unit Z-999/)
    // Harvest keeps the layer's conditional harvest zone answer.
    expect(a.reach.harvest.state).toBe('conditions')
  })

  it('keeps an unread order Unknown, naming it, with the harvest code still answering harvest', () => {
    const a = wildlifeAnswer(NO_HARVEST, uwr('u-7-012', 'HE-1-001'))!
    expect(a.status).toBe('unread')
    expect(states(a)).toEqual(['governs', 'unknown', 'unknown', 'unknown'])
    expect(a.reach.roads.note).toContain('Not yet read here: the order for u-7-012')
    expect(a.reach.roads.note).toContain('uwr_u7_012.pdf')
    const unlisted = wildlifeAnswer(CONDITIONAL, uwr('u-8-001', '1'))!
    expect(unlisted.status).toBe('not-listed')
    expect(unlisted.reach.grazing.note).toMatch(/not among the orders read here/)
  })

  it('answers a habitat area by its harvest zone where the order zones by map', () => {
    const core = wildlifeAnswer(WHA_NO_HARVEST, wha('7-001'))!
    expect(states(core)).toEqual(['governs', 'conditions', 'governs', 'conditions'])
    const management = wildlifeAnswer(WHA_CONDITIONAL, wha('7-001'))!
    expect(states(management)).toEqual(['conditions', 'conditions', 'conditions', 'conditions'])
    const caribou = wildlifeAnswer(WHA_NO_HARVEST, wha('7-045'))!
    expect(states(caribou)).toEqual(['governs', 'no-reach', 'governs', 'conditions'])
  })

  it('keeps a data-sensitive habitat area Unknown and drafts a request for its order', () => {
    const a = wildlifeAnswer(WHA_NO_HARVEST, wha('7-004'))!
    expect(a.status).toBe('withheld')
    expect(a.reach.roads.state).toBe('unknown')
    expect(a.reach.roads.cites).toContainEqual({ source: 'bc.gar', provision: 's. 10(3)' })
    const read = groundRead([{ instrument: 'wha-no-harvest', features: [wha('7-004'), wha('7-005')] }])
    const requests = withheldRequests(read, groundInstrument, 'Block 7')
    expect(requests).toHaveLength(1)
    expect(requests[0].identifiers).toEqual(['WHA 7-004', 'WHA 7-005'])
    expect(requests[0].text).toContain('Block 7')
    expect(requests[0].text).toContain('s. 10(3)')
  })

  it('groups features an order answers alike into one row, and keeps other instruments to the catalogue', () => {
    const r: GroundInstrumentRead = {
      instrument: 'uwr-no-harvest',
      status: 'read',
      features: [
        uwr('u-7-003', 'P-002', 2),
        uwr('u-7-003', 'P-003', 3),
        uwr('u-7-022', '1', 1),
        uwr('u-7-012', 'HE-1-001', 1),
      ],
      coveredHa: 7,
    }
    const rows = wildlifeRows(NO_HARVEST, r)!
    expect(rows.map((w) => [w.orderId, w.features.length, w.overlapHa])).toEqual([
      ['u-7-003', 2, 5],
      ['omineca-moose-2022', 1, 1],
      ['u-7-012', 1, 1],
    ])
    expect(wildlifeRows(groundInstrument('alr')!, { ...r, instrument: 'alr' })).toBeNull()
  })

  it('lists the exceptions of every read order found, with the statutory route', () => {
    const read = groundRead([
      { instrument: 'uwr-no-harvest', features: [uwr('u-7-003', 'P-002'), uwr('u-7-019', 'DJA-G1')] },
      { instrument: 'uwr-conditional', features: [uwr('u-7-013', 'PGD-001')] },
    ])
    const exceptions = exceptionsToRequest(read, groundInstrument)
    expect(exceptions.map((x) => x.order.id)).toEqual(['u-7-003', 'u-7-019', 'u-7-013'])
    expect(exceptions[0].units).toEqual(['u-7-003 P-002'])
    expect(exceptions[0].route.cites).toContainEqual({ source: 'bc.fppr', provision: 's. 92(1)' })
    expect(exceptions[1].clauses.map((c) => c.ref)).toContain('GWM 2')
    expect(exceptions[2].route.text).toMatch(/Continued objectives/)
    expect(exceptions[2].clauses.map((c) => c.ref)).toContain('objective 8(a), (b)')
  })
})

function groundRead(found: { instrument: string; features: GroundFeature[] }[]): GroundRead {
  return {
    block: 'b',
    schedule: 's',
    shape: 'x',
    footprint: 'f',
    readOn: '2026-11-24',
    footprintHa: 10,
    catalogue: 'test',
    instruments: found.map((f) => ({
      instrument: f.instrument,
      status: 'read',
      features: f.features,
      coveredHa: f.features.reduce((n, x) => n + x.overlapHa, 0),
    })),
  }
}
