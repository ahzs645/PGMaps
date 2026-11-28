import { describe, expect, it } from 'vitest'
import raw from '../../../../packages/legal-rules/packs/bc-land-status.json'
import { parsePack } from '../../../../packages/legal-rules/src/contract'
import { parseGroundRead, type GroundContextRead, type GroundInstrumentRead, type GroundRead } from '../ground/record'
import { LAND, LICENCE_AREAS, landCandidates, NO_LICENCE_AREA, UNSETTLED_PARCELS } from './landCandidates'

const FOOTPRINT_HA = 40
const feature = (id: string, ha: number) => ({
  id,
  name: id,
  details: [],
  identifiers: [],
  overlapHa: ha,
  sharePercent: (ha / FOOTPRINT_HA) * 100,
})
const instrument = (id: string, ha = 0, status: GroundInstrumentRead['status'] = 'read'): GroundInstrumentRead => ({
  instrument: id,
  status,
  features: ha ? [feature(`${id}-1`, ha)] : [],
  coveredHa: ha,
})
const context = (layer: string, ha = 0, status: GroundContextRead['status'] = 'read'): GroundContextRead => ({
  layer,
  status,
  features: ha ? [feature(`${layer}-1`, ha)] : [],
  coveredHa: ha,
})

function read({
  privateHa = 0,
  unsettledHa = 0,
  withUnsettled = true,
  reserveHa = 0,
  treatyHa = 0,
  licences = {} as Record<string, number>,
  failed = [] as string[],
  withContext = true,
} = {}): GroundRead {
  return {
    block: 'b1',
    schedule: 's1',
    shape: 'sh1',
    footprint: 'sig',
    readOn: '2026-11-27',
    footprintHa: FOOTPRINT_HA,
    catalogue: '1.6.0',
    instruments: [
      instrument('private-land', privateHa, failed.includes('private-land') ? 'failed' : 'read'),
      ...(withUnsettled ? [instrument(UNSETTLED_PARCELS, unsettledHa)] : []),
      ...LICENCE_AREAS.map((l) =>
        instrument(l.instrument, licences[l.instrument] ?? 0, failed.includes(l.instrument) ? 'failed' : 'read'),
      ),
    ],
    ...(withContext
      ? {
          context: [
            context('indian-reserves', reserveHa, failed.includes('indian-reserves') ? 'failed' : 'read'),
            context('treaty-lands', treatyHa),
          ],
        }
      : {}),
  }
}
const offer = (r: GroundRead, fact: string) => landCandidates(r)!.offers.find((o) => o.fact === fact)?.value

describe('land status candidates', () => {
  it('offers only choices the pack asks', () => {
    const pack = parsePack(raw)
    const choices = (id: string) => pack.facts.find((f) => f.id === id)!.choices
    expect(choices('land')).toEqual(expect.arrayContaining(Object.values(LAND)))
    expect(choices('licence-area')).toEqual([...LICENCE_AREAS.map((l) => l.choice), NO_LICENCE_AREA])
  })

  it('offers nothing without a read', () => {
    expect(landCandidates(undefined)).toBeNull()
  })

  it('offers Crown land when nothing else is mapped, and says that is a record, not the title', () => {
    const c = landCandidates(read())!
    expect(offer(read(), 'land')).toBe(LAND.crown)
    expect(c.offers.find((o) => o.fact === 'land')!.basis).toContain('not the title')
    expect(offer(read(), 'licence-area')).toBe(NO_LICENCE_AREA)
  })

  it('tells private, partly private, reserve and treaty land apart by their share', () => {
    expect(offer(read({ privateHa: 40 }), 'land')).toBe(LAND.private)
    expect(offer(read({ privateHa: 39.9 }), 'land')).toBe(LAND.private)
    expect(offer(read({ privateHa: 10 }), 'land')).toBe(LAND.both)
    expect(offer(read({ reserveHa: 40 }), 'land')).toBe(LAND.federal)
    expect(offer(read({ treatyHa: 40 }), 'land')).toBe(LAND.treaty)
  })

  it('offers no land when a block is only partly on a reserve, and says why', () => {
    const c = landCandidates(read({ reserveHa: 8 }))!
    expect(c.offers.some((o) => o.fact === 'land')).toBe(false)
    expect(c.notes.join(' ')).toContain('20% of the block')
  })

  it('offers nothing from a layer that was not read, never Crown land', () => {
    for (const failed of [['private-land'], ['indian-reserves']]) {
      const c = landCandidates(read({ failed }))!
      expect(c.offers.some((o) => o.fact === 'land')).toBe(false)
      expect(c.notes.join(' ')).toContain('Not read')
    }
    // A read made before the context layers were read cannot rule a reserve out.
    const old = landCandidates(read({ withContext: false }))!
    expect(old.offers.some((o) => o.fact === 'land')).toBe(false)
    expect(old.notes.join(' ')).toContain('read the ground again')
    expect(landCandidates(read({ failed: ['woodlot-licence'] }))!.offers.some((o) => o.fact === 'licence-area')).toBe(
      false,
    )
  })

  it('offers the licence covering most of the block, and notes a block only partly in one', () => {
    const whole = landCandidates(read({ licences: { 'woodlot-licence': 40 } }))!
    expect(offer(read({ licences: { 'woodlot-licence': 40 } }), 'licence-area')).toBe('A woodlot licence')
    expect(whole.notes.filter((n) => /licence/i.test(n))).toEqual([])
    const part = landCandidates(read({ licences: { 'woodlot-licence': 12, 'community-forest': 20 } }))!
    expect(part.offers.find((o) => o.fact === 'licence-area')!.value).toBe('A community forest agreement')
    expect(part.notes.join(' ')).toContain('only part of the block')
  })

  it('reads a sliver of a few square metres as boundaries meeting, never as land in the block', () => {
    const c = landCandidates(read({ privateHa: 0.0006 }))!
    expect(c.offers.find((o) => o.fact === 'land')!.value).toBe(LAND.crown)
    expect(c.notes.join(' ')).toContain('only 6 m²')
    expect(landCandidates(read({ privateHa: 0.02 }))!.offers.find((o) => o.fact === 'land')!.value).toBe(LAND.both)
    const licence = landCandidates(read({ licences: { 'woodlot-licence': 0.003 } }))!
    expect(licence.offers.find((o) => o.fact === 'licence-area')!.value).toBe(NO_LICENCE_AREA)
    expect(licence.notes.join(' ')).toContain('woodlot licence touches the block by only 30 m²')
  })

  it('offers a mineral title only where a tenure covers part of the block', () => {
    const tenure = (ha: number) => ({
      ...read(),
      instruments: [...read().instruments, instrument('mineral-placer-tenure', ha)],
    })
    expect(landCandidates(tenure(12))!.offers.find((o) => o.fact === 'mineral-title')!.value).toBe(true)
    expect(landCandidates(tenure(0))!.offers.find((o) => o.fact === 'mineral-title')!.value).toBe(false)
    expect(landCandidates(read())!.offers.some((o) => o.fact === 'mineral-title')).toBe(false)
  })

  it('keeps the context layers through a saved plan, and opens a read without them', () => {
    const saved = parseGroundRead(JSON.parse(JSON.stringify(read({ reserveHa: 40 }))))
    expect(saved.context?.map((c) => c.layer)).toEqual(['indian-reserves', 'treaty-lands'])
    expect(parseGroundRead(JSON.parse(JSON.stringify(read({ withContext: false })))).context).toBeUndefined()
  })

  it('offers no land where a parcel’s owner type is not settled, and names it', () => {
    const r = read({ unsettledHa: 0.14 })
    expect(offer(r, 'land')).toBeUndefined()
    expect(landCandidates(r)!.notes.join(' ')).toMatch(/no single owner type.*title decides/)
    // A sliver of one is the boundaries meeting, as for any parcel.
    expect(offer(read({ unsettledHa: 0.0006 }), 'land')).toBe(LAND.crown)
    // A read made before such parcels were read offers no land until the ground is read again.
    const old = read({ withUnsettled: false })
    expect(offer(old, 'land')).toBeUndefined()
    expect(landCandidates(old)!.notes.join(' ')).toMatch(/read the ground again/)
  })

  it('counts a Crown agency’s parcel as private land and says why', () => {
    const r = read({ privateHa: 0.19 })
    const parcels = r.instruments.find((i) => i.instrument === 'private-land')!
    parcels.features = [{ ...parcels.features[0], name: 'Crown Agency · Subdivision' }]
    const land = landCandidates(r)!.offers.find((o) => o.fact === 'land')!
    expect(land.value).toBe(LAND.both)
    expect(land.basis).toMatch(/agent of the government owns, so it is private land/)
    expect(landCandidates(read({ privateHa: 0.19 }))!.offers.find((o) => o.fact === 'land')!.basis).not.toMatch(/agent/)
  })
})
