import { describe, expect, it } from 'vitest'
import bcLocal from './bcLocal.generated.json'
import bcProjects from './bcProjects.generated.json'
import external from './external.generated.json'
import { formatEvidenceAmount, type EvidenceRecord } from './costEvidence'
import { assembleCostEvidence } from './loadCostEvidence'
import {
  ADOPTABLE_RATE_KEYS,
  adoptionBasisNote,
  adoptionPrefill,
  adoptionProblems,
  adoptionRefusal,
  applyAdoption,
  createAdoption,
  parseRateEvidence,
  rateSourceLines,
  withoutAdoption,
  type AdoptionInput,
} from './rateAdoption'

const catalogue = assembleCostEvidence(bcLocal, bcProjects, external)
const record = (id: string): EvidenceRecord => {
  const found = catalogue.records.find((item) => item.id === id)
  if (!found) throw new Error('Missing record ' + id)
  return found
}
/** Alberta granular base course, $33.70/tonne: a CAD record in another unit. */
const baseCourse = record('alberta-upa-2026-3')
/** Alberta common excavation, $11.22/m³: already on the cut rate's basis. */
const excavation = record('alberta-upa-2026-5')
const settings = { cutRate: 12, fillRate: 8, surfacingRate: 40, clearingRate: 1.5, shrinkFactor: 0.9 }
const input = (patch: Partial<AdoptionInput> = {}): AdoptionInput => ({
  record: baseCourse,
  rateKey: 'surfacingRate',
  rate: 74,
  reason: '2.2 t per compacted m³ from the pit’s test report.',
  specificationConfirmed: true,
  ...patch,
})

describe('what can be adopted', () => {
  it('refuses funding references, context-only records, municipal fees and maintenance awards', () => {
    const refused = catalogue.records.filter((item) => adoptionRefusal(item) !== null)
    for (const item of catalogue.records) {
      const barred =
        item.fundingOnly ||
        item.contextOnly ||
        item.kind === 'funding' ||
        item.kind === 'municipal-fee' ||
        item.kind === 'maintenance-award'
      if (barred) expect(adoptionRefusal(item), item.id).not.toBeNull()
    }
    // The catalogue holds 3 funding references, 6 context-only estimates, 2 fees and 2 awards.
    expect(refused.filter((item) => item.fundingOnly || item.contextOnly)).toHaveLength(9)
    expect(refused.filter((item) => item.kind === 'municipal-fee' || item.kind === 'maintenance-award')).toHaveLength(4)
  })

  it('refuses a whole-project amount, which has no unit, and a record with no amount', () => {
    const award = catalogue.records.find((item) => item.kind === 'contract-award' && !item.unit)!
    expect(adoptionRefusal(award)).toMatch(/no unit/)
    expect(adoptionRefusal({ ...baseCourse, amounts: {} })).toMatch(/no amount/)
    expect(adoptionProblems(input({ record: award }))).toEqual([adoptionRefusal(award)])
    expect(() => createAdoption(input({ record: award }), '2026-11-12')).toThrow(/no unit/)
  })

  it('allows supplier prices, tender averages and estimates that carry a unit', () => {
    expect(adoptionRefusal(baseCourse)).toBeNull()
    expect(adoptionRefusal(excavation)).toBeNull()
    expect(adoptionRefusal(catalogue.records.find((item) => item.kind === 'supplier-price')!)).toBeNull()
  })
})

describe('the adopted rate is the user’s figure', () => {
  it('offers a starting value only for one CAD amount in the rate’s own unit', () => {
    expect(adoptionPrefill(excavation, 'cutRate')).toBe(11.22)
    expect(adoptionPrefill(excavation, 'fillRate')).toBe(11.22)
    // Same currency, another unit: a tonne, a square metre for a cubic-metre rate, a cubic metre for clearing.
    expect(adoptionPrefill(baseCourse, 'surfacingRate')).toBeNull()
    expect(adoptionPrefill(excavation, 'clearingRate')).toBeNull()
    expect(adoptionPrefill(record('consultant-rate-07'), 'surfacingRate')).toBeNull()
    expect(adoptionPrefill(record('consultant-rate-18'), 'clearingRate')).toBe(6)
  })

  it('never offers a value from another currency or from a range', () => {
    for (const item of catalogue.records)
      for (const key of ADOPTABLE_RATE_KEYS) {
        const offered = adoptionPrefill(item, key)
        if (offered === null) continue
        expect(item.currency, item.id).toBe('CAD')
        expect(offered, item.id).toBe(item.amounts.value)
      }
    expect(adoptionPrefill({ currency: 'USD', amounts: { value: 9 }, unit: '/m³' }, 'cutRate')).toBeNull()
    expect(adoptionPrefill({ currency: 'CAD', amounts: { low: 5, high: 9 }, unit: '/m³' }, 'cutRate')).toBeNull()
    expect(
      adoptionPrefill({ currency: 'CAD', amounts: { low: 5, value: 7, high: 9 }, unit: '/m³' }, 'cutRate'),
    ).toBeNull()
  })

  it('says what differs before a figure is typed, and converts nothing', () => {
    expect(adoptionBasisNote(baseCourse, 'surfacingRate')).toMatch(
      /priced\/tonne, the rate in CAD\/m³\. Nothing is converted/,
    )
    expect(adoptionBasisNote({ currency: 'USD', amounts: { value: 9 }, unit: '/m³' }, 'cutRate')).toMatch(
      /in USD\. Nothing is converted/,
    )
    expect(adoptionBasisNote(excavation, 'cutRate')).toMatch(/already in CAD\/m³/)
  })

  it('needs the specification confirmed, a rate and a reason for any difference', () => {
    expect(adoptionProblems(input())).toEqual([])
    expect(adoptionProblems(input({ specificationConfirmed: false }))).toEqual(['Confirm the specification matches.'])
    expect(adoptionProblems(input({ rate: null }))[0]).toMatch(/Enter the adopted rate/)
    expect(adoptionProblems(input({ rate: 0 }))[0]).toMatch(/Enter the adopted rate/)
    expect(adoptionProblems(input({ rate: 10001 }))[0]).toMatch(/Enter the adopted rate/)
    expect(adoptionProblems(input({ reason: '  ' }))[0]).toMatch(/Say why/)
    expect(adoptionProblems(input({ reason: 'x'.repeat(501) }))[0]).toMatch(/500 characters/)
    // The record's own figure in the rate's unit needs no reason; any other figure does.
    const same = { record: excavation, rateKey: 'cutRate' as const, reason: '' }
    expect(adoptionProblems(input({ ...same, rate: 11.22 }))).toEqual([])
    expect(adoptionProblems(input({ ...same, rate: 14 }))[0]).toMatch(/Say why/)
  })
})

describe('what is stored', () => {
  const adoption = createAdoption(input(), '2026-11-12')

  it('keeps the observation as it was read, beside the typed rate and its reason', () => {
    expect(adoption).toEqual({
      rate: 74,
      observation: {
        recordId: 'alberta-upa-2026-3',
        kind: 'tender-average',
        title: 'Granular Base Course — Des.2 Cl.25',
        group: 'Alberta tender averages',
        place: 'Alberta, provincial highway projects',
        currency: 'CAD',
        amounts: { value: 33.7 },
        unit: '/tonne',
        costYear: 2026,
        url: baseCourse.url,
        locator: "'2026 UPA '!B14:H14",
        checked: '2026-11-12',
      },
      specificationConfirmed: true,
      reason: '2.2 t per compacted m³ from the pit’s test report.',
      adoptedOn: '2026-11-12',
    })
    expect(adoption.observation.amounts).not.toBe(baseCourse.amounts)
    expect(formatEvidenceAmount(adoption.observation)).toBe(formatEvidenceAmount(baseCourse))
  })

  it('writes the rate and its source together and leaves every other setting alone', () => {
    const next = applyAdoption({ settings }, 'surfacingRate', adoption)
    expect(next.settings).toEqual({ ...settings, surfacingRate: 74 })
    expect(next.rateEvidence).toEqual({ surfacingRate: adoption })
    const second = createAdoption(
      input({ record: excavation, rateKey: 'cutRate', rate: 11.22, reason: '' }),
      '2026-11-13',
    )
    expect(second.reason).toBeUndefined()
    const both = applyAdoption(next, 'cutRate', second)
    expect(Object.keys(both.rateEvidence)).toEqual(['surfacingRate', 'cutRate'])
    expect(withoutAdoption(both.rateEvidence, 'cutRate')).toEqual({ surfacingRate: adoption })
    expect(withoutAdoption(next.rateEvidence, 'surfacingRate')).toBeUndefined()
    expect(withoutAdoption(next.rateEvidence, 'cutRate')).toBe(next.rateEvidence)
  })

  it('prints the rate, the observation in its own unit and the reason', () => {
    const [line] = rateSourceLines({ surfacingRate: adoption }, { ...settings, surfacingRate: 74 })
    expect(line).toMatchObject({
      rateKey: 'surfacingRate',
      adopted: 'Surfacing rate $74.00/m³',
      observed: '$33.70/tonne · CAD · 2026',
      source: 'Tender average · Granular Base Course — Des.2 Cl.25 · Alberta tender averages',
      locator: "'2026 UPA '!B14:H14 · checked 2026-11-12",
      reason: '2.2 t per compacted m³ from the pit’s test report.',
      adoptedOn: '2026-11-12',
      edited: null,
    })
    expect(rateSourceLines(undefined, settings)).toEqual([])
  })

  it('says so when the rate was edited after the adoption', () => {
    const [line] = rateSourceLines({ surfacingRate: adoption }, { ...settings, surfacingRate: 80 })
    expect(line.edited).toBe(
      'The rate is now $80.00/m³, edited after this adoption; the record explains $74.00/m³ only.',
    )
  })

  it('survives the project file and refuses a record that could not have been adopted', () => {
    const stored = JSON.parse(JSON.stringify({ surfacingRate: adoption }))
    expect(parseRateEvidence(stored)).toEqual({ surfacingRate: adoption })
    expect(parseRateEvidence(undefined)).toBeUndefined()
    expect(parseRateEvidence({})).toBeUndefined()
    const broken = (patch: (value: typeof stored) => void) => {
      const copy = JSON.parse(JSON.stringify(stored))
      patch(copy)
      return () => parseRateEvidence(copy)
    }
    expect(broken((value) => (value.surfacingRate.observation.kind = 'funding'))).toThrow(/cannot inform a rate/)
    expect(broken((value) => (value.surfacingRate.specificationConfirmed = false))).toThrow(/specification/)
    expect(broken((value) => (value.surfacingRate.rate = '74'))).toThrow(/adopted rate/)
    expect(broken((value) => (value.surfacingRate.observation.url = 'javascript:alert(1)'))).toThrow(/web address/)
    expect(broken((value) => (value.surfacingRate.adoptedOn = 'yesterday'))).toThrow(/YYYY-MM-DD/)
    expect(broken((value) => delete value.surfacingRate.observation.checked)).toThrow(/checked date/)
    expect(() => parseRateEvidence({ haulRate: adoption })).toThrow(/Rate source/)
  })
})
