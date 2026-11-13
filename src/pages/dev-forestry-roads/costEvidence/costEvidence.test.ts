import { describe, expect, it } from 'vitest'
import bcLocal from './bcLocal.generated.json'
import bcProjects from './bcProjects.generated.json'
import external from './external.generated.json'
import { BC_COST_REGIONS } from '../bcCostReferences'
import {
  EVIDENCE_FRESHNESS,
  EVIDENCE_KINDS,
  NO_EVIDENCE_FILTER,
  evidenceBasis,
  evidencePlace,
  evidenceTerms,
  filterEvidence,
  formatEvidenceAmount,
  groupEvidence,
  groupTerms,
  regionLocalEvidence,
  workedEstimateLineTotal,
  type EvidenceRecord,
} from './costEvidence'
import { assembleCostEvidence } from './loadCostEvidence'

const catalogue = assembleCostEvidence(bcLocal, bcProjects, external)
const record = (id: string) => {
  const found = catalogue.records.find((item) => item.id === id)
  if (!found) throw new Error('Missing record ' + id)
  return found
}
const regionIds = BC_COST_REGIONS.map((region) => region.id)

describe('cost evidence catalogue', () => {
  it('holds every generated record in a shape the dialog can print', () => {
    expect(catalogue.records).toHaveLength(149)
    expect(new Set(catalogue.records.map((item) => item.id)).size).toBe(149)
    for (const item of catalogue.records) {
      expect(EVIDENCE_KINDS[item.kind], item.id).toBeDefined()
      expect(item.url, item.id).toMatch(/^https:\/\//)
      expect(item.checked, item.id).toMatch(/^2026-11-1[23]$/)
      expect(item.group.length, item.id).toBeGreaterThan(0)
      expect(Array.isArray(item.cautions), item.id).toBe(true)
      const amounts = Object.values(item.amounts)
      expect(amounts.length, item.id).toBeGreaterThan(0)
      for (const amount of amounts) expect(Number.isFinite(amount) && amount > 0, item.id).toBe(true)
      if (item.regionId) expect(regionIds, item.id).toContain(item.regionId)
      if (item.freshness) expect(EVIDENCE_FRESHNESS[item.freshness], item.id).toBeDefined()
      expect(formatEvidenceAmount(item), item.id).not.toBe('No amount published')
    }
  })

  it('keeps each amount in its own currency, unit and price year', () => {
    expect(formatEvidenceAmount(record('alberta-upa-2026-3'))).toBe('$33.70/tonne')
    expect(evidenceBasis(record('alberta-upa-2026-3'))).toBe('CAD · 2026')
    expect(record('alberta-upa-2026-3').sample).toBe('1,316,195 tonne · 28 contracts')
    expect(formatEvidenceAmount(record('k-agg'))).toBe('US$17 per loose yd³ hauled')
    expect(formatEvidenceAmount(record('NZ2018-SPUR'))).toBe('NZ$10,000–150,000 per km, mean NZ$72,000')
    expect(formatEvidenceAmount(record('UK2023-HAULAGE'))).toBe('£50–300 per m, typically about £100')
    expect(formatEvidenceAmount(record('IE2026-HARVEST-GRANT'))).toBe('up to €66 per linear m')
    expect(formatEvidenceAmount(record('local-014'))).toBe('$15.38/t')
    expect(evidenceBasis(record('local-014'))).toBe('CAD · effective 2026-04-01')
    expect(evidenceBasis(record('local-005'))).toBe('CAD · no price date')
  })

  it('never lets a funding figure or an undated list read as a current price', () => {
    const funding = catalogue.records.filter((item) => item.kind === 'funding')
    expect(funding.map((item) => item.id).sort()).toEqual([
      'IE2026-HARVEST-GRANT',
      'IE2026-UPGRADE-GRANT',
      'isc-om-toronto-2023-1',
    ])
    expect(funding.every((item) => item.fundingOnly)).toBe(true)
    expect(record('local-038').freshness).toBe('stale')
    expect(record('local-040').freshness).toBe('promotion')
    expect(record('NZ2024-DIAMOND-GEOGRID').cautions.join(' ')).toContain('Did not meet')
  })

  it('states an unknown term instead of dropping it', () => {
    const terms = evidenceTerms(record('local-005'))
    expect(terms.find((term) => term.label === 'Tax')?.text).toBe('Not stated')
    expect(terms.find((term) => term.label === 'Surcharges')?.text).toBe('Not stated')
    const oviatt = evidenceTerms(record('local-028'))
    expect(oviatt.find((term) => term.label === 'Surcharges')?.text).toBe(
      'Fuel surcharge: 10%; applies to all products',
    )
    // An award publishes no loading or delivery terms, and the dialog does not invent the rows.
    expect(evidenceTerms(record('contract-en22tlh001')).some((term) => term.label === 'Loading')).toBe(false)
  })

  it('prints terms a supplier applies to every product once', () => {
    const cantex = catalogue.records.filter((item) => item.group === 'Cantex Crushing')
    expect(cantex).toHaveLength(4)
    const terms = groupTerms(cantex)
    expect(terms.shared.map((term) => term.label)).toEqual(expect.arrayContaining(['Tax', 'Delivery']))
    for (const item of cantex) expect(terms.own.get(item.id)!.terms.some((term) => term.label === 'Tax')).toBe(false)
    const tiers = cantex.map((item) => terms.own.get(item.id)!.terms.find((term) => term.label === 'Price tier')?.text)
    expect(tiers).toContain('Contractor')
    const single = groupTerms([record('local-029')])
    expect(single.shared).toEqual([])
    expect(single.own.get('local-029')!.terms.length).toBeGreaterThan(0)
  })

  it('keeps a region’s supplier prices apart from its fees, awards and project records', () => {
    const cariboo = regionLocalEvidence(catalogue, 'cariboo')
    expect(cariboo.suppliers).toEqual([])
    expect(cariboo.other.map((item) => item.kind)).toEqual(['maintenance-award', 'maintenance-award'])
    expect(cariboo.leads.map((lead) => lead.party)).toEqual(['United Concrete & Gravel Ltd.', '93 Mile Aggregates'])
    expect(cariboo.projects.length).toBeGreaterThan(0)
    const skeena = regionLocalEvidence(catalogue, 'skeena')
    expect(skeena.suppliers).toEqual([])
    expect(skeena.other.every((item) => item.kind === 'municipal-fee')).toBe(true)
    const thompson = regionLocalEvidence(catalogue, 'thompson-okanagan')
    expect(thompson.suppliers.map((group) => group.name)).toEqual([
      'Cantex Crushing',
      'Grizzly Excavating',
      'Skwlāx Aggregates',
    ])
    // The quote route found in October stays listed although the November research did not revisit it.
    expect(regionLocalEvidence(catalogue, 'kootenay-boundary').leads.map((lead) => lead.party)).toContain(
      'MacKay Contracting',
    )
    for (const region of regionIds) {
      const local = regionLocalEvidence(catalogue, region)
      expect(local.suppliers.length + local.leads.length, region).toBeGreaterThan(0)
    }
  })

  it('tags Masset to the West Coast region', () => {
    const masset = catalogue.records.filter((item) => item.group === 'Urban Systems · Masset')
    expect(masset.length).toBeGreaterThan(0)
    expect(masset.every((item) => item.regionId === 'west-coast')).toBe(true)
  })

  it('filters by place, type, region and words', () => {
    const count = (records: EvidenceRecord[], place: string) =>
      records.filter((item) => evidencePlace(item) === place).length
    expect(count(catalogue.records, 'bc')).toBe(96)
    expect(count(catalogue.records, 'canada')).toBe(20)
    expect(count(catalogue.records, 'us')).toBe(20)
    expect(count(catalogue.records, 'elsewhere')).toBe(13)
    expect(filterEvidence(catalogue.records, NO_EVIDENCE_FILTER)).toHaveLength(149)
    const tenders = filterEvidence(catalogue.records, { ...NO_EVIDENCE_FILTER, kind: 'tender-average' })
    expect(groupEvidence(tenders).map((group) => [group.name, group.records.length])).toEqual([
      ['Alberta tender averages', 8],
    ])
    const culverts = filterEvidence(catalogue.records, { ...NO_EVIDENCE_FILTER, place: 'canada', query: 'CULVERT 600' })
    expect(culverts.map((item) => item.id)).toEqual(['alberta-upa-2026-4', 'allnorth-labrador-2024-4'])
    const omineca = filterEvidence(catalogue.records, { ...NO_EVIDENCE_FILTER, place: 'bc', regionId: 'omineca' })
    expect(omineca.every((item) => item.regionId === 'omineca')).toBe(true)
  })

  it('reconciles the worked estimates with their printed totals', () => {
    const estimate = (id: string) => catalogue.estimates.find((item) => item.id === id)!
    expect(catalogue.estimates).toHaveLength(8)
    const kilkenny = estimate('kilkenny-full-package')
    expect(workedEstimateLineTotal(kilkenny)).toBe(17555)
    expect(kilkenny.totals.map((total) => total.amount)).toEqual([17555, 3334, 20889])
    const herring = estimate('herring-full-package')
    expect(workedEstimateLineTotal(herring)).toBe(10385)
    expect(herring.totals.at(-1)!.amount).toBe(10385 + 2314)
    expect(workedEstimateLineTotal(estimate('herring-fr3013'))).toBe(2395)
    // The Rocking Chair sheet rounds its basic cost to the dollar before adding drainage.
    expect(workedEstimateLineTotal(estimate('rocking-chair-new-temp-4'))).toBeCloseTo(100623, -1)
    const norwich = estimate('norwich-four-year-maintenance')
    expect(workedEstimateLineTotal(norwich)).toBe(9260)
    expect((9260 + 3 * 2060) / 4).toBe(norwich.totals.at(-1)!.amount)
    for (const item of catalogue.estimates)
      expect(
        catalogue.sources.some((source) => source.id === item.sourceId),
        item.id,
      ).toBe(true)
  })

  it('carries the November fuel adjustment and the method references', () => {
    expect(catalogue.fuel).toMatchObject({ month: '2026-11', onRoadPerHour: 26.1, offRoadPerHour: 60.9 })
    expect(catalogue.sources.filter((source) => source.role === 'method')).toHaveLength(5)
    expect(catalogue.checked).toBe('2026-11-13')
    for (const item of catalogue.records.filter((entry) => entry.sourceId))
      expect(
        catalogue.sources.some((source) => source.id === item.sourceId),
        item.id,
      ).toBe(true)
  })
})
