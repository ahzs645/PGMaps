import { describe, expect, it } from 'vitest'
import raw from '../../../packages/legal-rules/ground/instruments.json'
import sources from '../../../packages/legal-rules/catalogue/sources.json'
import grazingPack from '../../../packages/legal-rules/packs/bc-crown-grazing.json'
import orderPack from '../../../packages/legal-rules/packs/bc-pgtsa-biodiversity.json'
import {
  ACTIVITIES,
  conditionCql,
  GROUND_CATALOGUE,
  layerCql,
  matches,
  parseGroundCatalogue,
  type Cite,
} from './groundInstruments'

const sourceIds = new Set(sources.sources.map((s) => s.id))
const packs: Record<string, { facts: { id: string }[] }> = {
  [grazingPack.id]: grazingPack,
  [orderPack.id]: orderPack,
}

describe('the ground instrument catalogue', () => {
  it('parses', () => {
    expect(GROUND_CATALOGUE.instruments.length).toBeGreaterThanOrEqual(15)
    expect(GROUND_CATALOGUE.layers.map((l) => l.id)).toContain('tantalis')
  })

  it('cites a provision and a catalogued source for every cell, binds entry and statute', () => {
    const missing: string[] = []
    const check = (c: Cite, at: string) => {
      if (!c.provision.trim()) missing.push(`${at}: no provision`)
      if (!sourceIds.has(c.source)) missing.push(`${at}: ${c.source} is not in catalogue/sources.json`)
    }
    for (const x of GROUND_CATALOGUE.instruments) {
      check(x.statute, `${x.id} statute`)
      expect(x.binds.cites.length, `${x.id} binds`).toBeGreaterThan(0)
      x.binds.cites.forEach((c, i) => check(c, `${x.id} binds ${i + 1}`))
      for (const a of ACTIVITIES) {
        const cell = x.reach[a]
        expect(cell, `${x.id} ${a}`).toBeDefined()
        expect(cell.cites.length, `${x.id} ${a}`).toBeGreaterThan(0)
        expect(cell.note.trim().length, `${x.id} ${a} note`).toBeGreaterThan(10)
        cell.cites.forEach((c, i) => check(c, `${x.id} ${a} ${i + 1}`))
      }
    }
    expect(missing).toEqual([])
  })

  it('fails on a cell without a provision or a cites list', () => {
    const copy = structuredClone(raw) as typeof raw
    ;(copy.instruments[0].reach.harvest as { cites: unknown[] }).cites = []
    expect(() => parseGroundCatalogue(copy)).toThrow(/cites/)
    const blank = structuredClone(raw) as typeof raw
    blank.instruments[0].reach.roads.cites[0].provision = ' '
    expect(() => parseGroundCatalogue(blank)).toThrow(/provision/)
  })

  it('never says no reach where the answer turns on terms that are not public', () => {
    for (const x of GROUND_CATALOGUE.instruments)
      if (!x.terms.public) for (const a of ACTIVITIES) expect(x.reach[a].state, `${x.id} ${a}`).not.toBe('no-reach')
  })

  it('names facts that exist in their packs', () => {
    for (const x of GROUND_CATALOGUE.instruments)
      for (const f of x.facts) {
        expect(packs[f.pack], `${x.id} names pack ${f.pack}`).toBeDefined()
        expect(
          packs[f.pack].facts.some((p) => p.id === f.fact),
          `${x.id}: ${f.pack} ${f.fact}`,
        ).toBe(true)
      }
  })

  it('never reads a holder, client, owner or user field', () => {
    const forbidden =
      /CLIENT|HOLDER|OWNER_NAME|ORGANIZATION|_WHO_|USER|PERSON|LICENSEE|LICENCEE|APPLICANT|CLAIM_NAME|ADDRESS/
    for (const l of GROUND_CATALOGUE.layers) for (const f of l.fields) expect(f, l.id).not.toMatch(forbidden)
  })

  it('keeps the Land Act designations unknown, never no reach, and says how it read them', () => {
    for (const id of ['land-act-s15', 'land-act-s16', 'land-act-s17']) {
      const x = GROUND_CATALOGUE.instruments.find((i) => i.id === id)!
      expect(ACTIVITIES.map((a) => x.reach[a].state)).toEqual(['unknown', 'unknown', 'unknown', 'unknown'])
      expect(x.reach.harvest.note).toMatch(/reading of the Act's text; no court decision on the point was found/)
      expect(x.binds.kind).toBe('referral')
    }
  })

  it('shares a layer between its instruments by their conditions', () => {
    const tantalis = GROUND_CATALOGUE.instruments.filter((x) => x.layer === 'tantalis')
    const cql = layerCql(tantalis)!
    expect(cql).toContain("TENURE_SUBTYPE IN ('SEC 17 DESIGNATED USE AREA')")
    expect(cql).toContain("TENURE_TYPE IN ('LEASE') AND TENURE_STAGE IN ('TENURE')")
    const s17 = tantalis.find((x) => x.id === 'land-act-s17')!
    expect(matches(s17.where, { TENURE_SUBTYPE: 'SEC 17 DESIGNATED USE AREA' })).toBe(true)
    const lease = tantalis.find((x) => x.id === 'land-act-lease')!
    expect(matches(lease.where, { TENURE_TYPE: 'LEASE', TENURE_STAGE: 'APPLICATION' })).toBe(false)
    expect(layerCql(GROUND_CATALOGUE.instruments.filter((x) => x.layer === 'ogma'))).toBeNull()
  })

  it('keeps a blank value under notIn, in CQL and locally alike', () => {
    const c = { field: 'TIMBER_HARVEST_CODE', notIn: ['NO HARVEST ZONE'] }
    expect(conditionCql(c)).toBe("(TIMBER_HARVEST_CODE IS NULL OR TIMBER_HARVEST_CODE NOT IN ('NO HARVEST ZONE'))")
    expect(matches([c], {})).toBe(true)
    expect(matches([c], { TIMBER_HARVEST_CODE: 'NO HARVEST ZONE' })).toBe(false)
    expect(matches([c], { TIMBER_HARVEST_CODE: 'CONDITIONAL HARVEST ZONE' })).toBe(true)
  })

  it('refuses a condition on a field its layer does not read', () => {
    const copy = structuredClone(raw) as typeof raw
    copy.instruments[0].where[0].field = 'CLIENT_NAME'
    expect(() => parseGroundCatalogue(copy)).toThrow(/does not read/)
  })

  it('matches a forest file by its letter, in CQL and locally alike', () => {
    const c = { field: 'FOREST_FILE_ID', prefix: ['W', 'K'] }
    expect(conditionCql(c)).toBe("(FOREST_FILE_ID LIKE 'W%' OR FOREST_FILE_ID LIKE 'K%')")
    expect(matches([c], { FOREST_FILE_ID: 'W1234' })).toBe(true)
    expect(matches([c], { FOREST_FILE_ID: 'N1A' })).toBe(false)
    expect(matches([c], {})).toBe(false)
    const copy = structuredClone(raw) as { instruments: { where: Record<string, unknown>[] }[] }
    copy.instruments[0].where[0] = { field: 'TENURE_SUBTYPE', prefix: ["W%' OR 1=1 --"] }
    expect(() => parseGroundCatalogue(copy)).toThrow(/letters, digits or spaces/)
    copy.instruments[0].where[0] = { field: 'TENURE_SUBTYPE', in: ['A'], prefix: ['B'] }
    expect(() => parseGroundCatalogue(copy)).toThrow(/exactly one/)
  })

  it('gives every line and point layer a stated margin, and reads TFLs by hull', () => {
    for (const l of GROUND_CATALOGUE.layers)
      if (l.geometry !== 'area') {
        expect(l.near, l.id).toBeDefined()
        expect(l.near!.why.length, l.id).toBeGreaterThan(40)
      }
    expect(GROUND_CATALOGUE.layers.find((l) => l.id === 'water-licences')).toMatchObject({
      geometry: 'point',
      near: { metres: 100 },
    })
    expect(GROUND_CATALOGUE.layers.find((l) => l.id === 'tfl')!.byHull).toBe(true)
    const copy = structuredClone(raw) as { layers: Record<string, unknown>[] }
    copy.layers[0].geometry = 'line'
    expect(() => parseGroundCatalogue(copy)).toThrow(/near margin/)
  })

  it('reads the Robson Valley order apart from other objectives, with the Omineca order’s reach', () => {
    const general = GROUND_CATALOGUE.instruments.find((x) => x.id === 'legal-objective')!
    const robson = GROUND_CATALOGUE.instruments.find((x) => x.id === 'robson-valley-ada')!
    const omineca = GROUND_CATALOGUE.instruments.find((x) => x.id === 'omineca-ada-sra')!
    expect(general.where[0].notIn).toContain(robson.where[0].in![0])
    for (const a of ACTIVITIES) expect(robson.reach[a].state, a).toBe(omineca.reach[a].state)
    expect(robson.reach.harvest.cites.every((c) => c.source === 'bc.robson-valley.ada.2006')).toBe(true)
  })

  it('keeps federal critical habitat unknown without an order, citing the Act', () => {
    const x = GROUND_CATALOGUE.instruments.find((i) => i.id === 'federal-critical-habitat')!
    expect(ACTIVITIES.map((a) => x.reach[a].state)).toEqual(['unknown', 'unknown', 'unknown', 'unknown'])
    expect(x.reach.harvest.cites.map((c) => c.provision)).toContain('s. 61(1), (2)')
  })
})
