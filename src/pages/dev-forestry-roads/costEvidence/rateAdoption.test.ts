import { describe, expect, it } from 'vitest'
import bcLocal from './bcLocal.generated.json'
import bcProjects from './bcProjects.generated.json'
import external from './external.generated.json'
import additions from './additions.generated.json'
import { formatEvidenceAmount, type EvidenceRecord } from './costEvidence'
import { assembleCostEvidence } from './loadCostEvidence'
import { adoptionOverlaps, adoptionTargets, isTargetKey, targetFor, writeTarget } from './adoptionTargets'
import {
  ADOPTABLE_RATE_KEYS,
  adoptionBasisNote,
  adoptionPrefill,
  adoptionProblems,
  adoptionRefusal,
  applyAdoption,
  createAdoption,
  createBuildUpAdoption,
  parseRateEvidence,
  rateSourceLines,
  withoutAdoption,
  type AdoptionInput,
} from './rateAdoption'
import { buildUpSnapshot, type RateBuildUp } from './rateBuildUps'
import { createDemoProject } from '../terrain'
import { createEngineeringDesign } from '../engineeringTypes'
import type { RoadProject } from '../types'

const catalogue = assembleCostEvidence(bcLocal, bcProjects, external, additions)
const record = (id: string): EvidenceRecord => {
  const found = catalogue.records.find((item) => item.id === id)
  if (!found) throw new Error('Missing record ' + id)
  return found
}
/** Alberta granular base course, $33.70/tonne: a CAD record in another unit. */
const baseCourse = record('alberta-upa-2026-3')
/** Alberta common excavation, $11.22/m³: already on the cut rate's basis. */
const excavation = record('alberta-upa-2026-5')
/** Canim Lake offsite disposal, $200/m³: excavation, haul and disposal in one price. */
const offsite = record('canim-2025-o1-excavation-offsite')

/** The demo project with an engineered road: two materials (one rock), haul on, a pit and a culvert. */
function engineered(): RoadProject {
  const base = createDemoProject()
  const engineering = {
    ...createEngineeringDesign(),
    materials: [
      { id: 'till', name: 'Till', color: '#a16207', cutRate: 9, reusableFraction: 0.8, compactionFactor: 0.9 },
      {
        id: 'rock',
        name: 'Granite',
        color: '#57534e',
        cutRate: 45,
        reusableFraction: 1,
        compactionFactor: 1.3,
        rock: true,
      },
    ],
    sites: [
      {
        id: 'pit',
        name: 'Km 4 pit',
        kind: 'borrow' as const,
        chainage: 400,
        accessDistanceM: 200,
        capacityM3: 5000,
        unitRate: 6,
        fixedCost: 2000,
      },
    ],
    culverts: [
      {
        id: 'c1',
        name: 'Culvert 1',
        chainage: 300,
        skewDegrees: 0,
        lengthM: 12,
        diameterM: 0.6,
        inletInvertM: null,
        outletInvertM: null,
        minCoverM: 0.3,
        unitCost: 250,
        fixedCost: 0,
      },
    ],
    haul: { ...createEngineeringDesign().haul, enabled: true, overhaulRate: 1.2, endHaulRate: 1.5, wasteRate: 3 },
  }
  return {
    ...base,
    alignments: base.alignments.map((a) => (a.id === base.activeAlignmentId ? { ...a, engineering } : a)),
  }
}
const project = engineered()
const road = project.activeAlignmentId
const target = (key: string) => {
  const found = targetFor(project, key)
  if (!found) throw new Error('Missing target ' + key)
  return found
}
const input = (patch: Partial<AdoptionInput> = {}): AdoptionInput => ({
  record: baseCourse,
  target: target('surfacingRate'),
  currency: 'CAD',
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
    // 3 funding references, 6 context-only estimates and Canim Lake's contingency; 2 fees and 2 awards.
    expect(refused.filter((item) => item.fundingOnly || item.contextOnly)).toHaveLength(10)
    expect(refused.filter((item) => item.kind === 'municipal-fee' || item.kind === 'maintenance-award')).toHaveLength(4)
  })

  it('refuses a whole-project amount, which has no unit, and a record with no amount', () => {
    const award = record('payne-2025-award')
    expect(adoptionRefusal(award)).toMatch(/no unit/)
    expect(adoptionRefusal({ ...baseCourse, amounts: {} })).toMatch(/no amount/)
    expect(adoptionProblems(input({ record: award }))).toEqual([adoptionRefusal(award)])
    expect(() => createAdoption(input({ record: award }), '2026-11-12')).toThrow(/no unit/)
  })

  it('offers every rate the road and the project hold, each with its basis and the work it prices', () => {
    const keys = adoptionTargets(project).map((t) => t.key)
    expect(keys.slice(0, 4)).toEqual([...ADOPTABLE_RATE_KEYS])
    for (const key of [
      `${road}/haul.overhaulRate`,
      `${road}/haul.borrowRate`,
      `${road}/haul.mobilizationCost`,
      `${road}/material:till.cutRate`,
      `${road}/material:rock.shallowCutRate`,
      `${road}/material:rock.overbreakRate`,
      `${road}/site:pit.unitRate`,
      `${road}/site:pit.fixedCost`,
      `${road}/culvert:c1.unitCost`,
      'schedule:mobilization',
      'schedule:insurance-bonding',
    ])
      expect(keys, key).toContain(key)
    // Till is not rock: no shallow-rock or overbreak rate for it.
    expect(keys).not.toContain(`${road}/material:till.shallowCutRate`)
    // Future work is costed over its horizon, not adopted as a one-off rate.
    expect(keys).not.toContain('schedule:maintenance')
    for (const key of keys) expect(isTargetKey(key), key).toBe(true)
    expect(isTargetKey('haulRate')).toBe(false)
    expect(isTargetKey(`${road}/haul.contingencyPercent`)).toBe(false)
    expect(target(`${road}/material:till.cutRate`)).toMatchObject({
      basis: 'bank-m3',
      prices: ['excavation'],
      value: 9,
    })
    expect(target('schedule:insurance-bonding')).toMatchObject({ unit: '%', basis: 'percent', value: null })
  })

  it('writes each kind of rate where the engine reads it, and nothing else', () => {
    const cut = writeTarget(project, `${road}/material:rock.overbreakRate`, 60)
    const rock = cut.alignments.find((a) => a.id === road)!.engineering!.materials.find((m) => m.id === 'rock')!
    expect(rock.overbreakRate).toBe(60)
    expect(cut.settings).toBe(project.settings)
    const pit = writeTarget(project, `${road}/site:pit.unitRate`, 7.5)
    expect(pit.alignments.find((a) => a.id === road)!.engineering!.sites[0].unitRate).toBe(7.5)
    const bonding = writeTarget(project, 'schedule:insurance-bonding', 3)
    expect(bonding.costSchedule!.entries).toEqual([
      { id: 'insurance-bonding', status: 'priced', basis: 'percent', percent: 3 },
    ])
    expect(() => writeTarget(project, `${road}/material:gone.cutRate`, 5)).toThrow(/no longer in the road/)
  })
})

describe('the adopted rate is the user’s figure', () => {
  it('offers a starting value only for one amount in the project’s currency, the rate’s unit and basis', () => {
    expect(adoptionPrefill(excavation, target('cutRate'))).toBe(11.22)
    expect(adoptionPrefill(excavation, target('fillRate'))).toBe(11.22)
    // Same currency, another unit: a tonne, a cubic metre for clearing.
    expect(adoptionPrefill(baseCourse, target('surfacingRate'))).toBeNull()
    expect(adoptionPrefill(excavation, target('clearingRate'))).toBeNull()
    expect(adoptionPrefill(record('consultant-rate-18'), target('clearingRate'))).toBe(6)
    // A cubic metre stated as loose does not start a bank-measured rate.
    expect(adoptionPrefill(excavation, target('cutRate'), 'CAD', 'loose-m3')).toBeNull()
    expect(adoptionPrefill(excavation, target('cutRate'), 'CAD', 'bank-m3')).toBe(11.22)
    // A project in US dollars is offered the US records, never a converted Canadian one.
    expect(adoptionPrefill(excavation, target('cutRate'), 'USD')).toBeNull()
    expect(adoptionPrefill({ currency: 'USD', amounts: { value: 9 }, unit: '/m³' }, target('cutRate'), 'USD')).toBe(9)
    // A percentage record starts a percentage budget item.
    expect(adoptionPrefill(record('canim-2025-bonding'), target('schedule:insurance-bonding'))).toBe(3)
    expect(adoptionPrefill(record('canim-2025-o1-traffic'), target('schedule:traffic-control'))).toBe(250000)
  })

  it('never offers a value from another currency or from a range', () => {
    for (const item of catalogue.records)
      for (const t of adoptionTargets(project)) {
        const offered = adoptionPrefill(item, t)
        if (offered === null) continue
        expect(item.currency, item.id).toBe('CAD')
        expect(offered, item.id).toBe(item.amounts.value)
      }
    expect(
      adoptionPrefill({ currency: 'CAD', amounts: { low: 5, high: 9 }, unit: '/m³' }, target('cutRate')),
    ).toBeNull()
  })

  it('says what differs before a figure is typed, and converts nothing', () => {
    expect(adoptionBasisNote(baseCourse, target('surfacingRate'))).toMatch(
      /priced\/tonne, the rate in CAD\/m³\. Nothing is converted/,
    )
    expect(adoptionBasisNote({ currency: 'USD', amounts: { value: 9 }, unit: '/m³' }, target('cutRate'))).toMatch(
      /in USD\. Nothing is converted/,
    )
    expect(adoptionBasisNote(excavation, target('cutRate'))).toMatch(/already in CAD\/m³/)
    expect(adoptionBasisNote(excavation, target('cutRate'), 'CAD', 'loose-m3')).toMatch(/swell or compaction factor/)
  })

  it('needs the specification confirmed, a rate and a reason for any difference', () => {
    expect(adoptionProblems(input())).toEqual([])
    expect(adoptionProblems(input({ specificationConfirmed: false }))).toEqual(['Confirm the specification matches.'])
    expect(adoptionProblems(input({ rate: null }))[0]).toMatch(/Enter the adopted rate/)
    expect(adoptionProblems(input({ rate: 10001 }))[0]).toMatch(/Enter the adopted rate/)
    expect(adoptionProblems(input({ reason: '  ' }))[0]).toMatch(/Say why/)
    expect(adoptionProblems(input({ reason: 'x'.repeat(501) }))[0]).toMatch(/500 characters/)
    const same = { record: excavation, target: target('cutRate'), reason: '' }
    expect(adoptionProblems(input({ ...same, rate: 11.22 }))).toEqual([])
    expect(adoptionProblems(input({ ...same, rate: 14 }))[0]).toMatch(/Say why/)
    // A road rate takes its own limit: mobilization runs to millions.
    expect(adoptionProblems(input({ target: target(`${road}/haul.mobilizationCost`), rate: 85000 }))).toEqual([])
  })
})

describe('a bundled price is not counted twice', () => {
  it('finds the lines that already price what a bundled price includes', () => {
    const waste = target(`${road}/haul.wasteRate`)
    // Offsite disposal at Canim Lake includes excavation and haul; this road prices both already.
    const overlaps = adoptionOverlaps(project, waste, ['excavation', 'haul', 'disposal'])
    expect(overlaps).toHaveLength(2)
    expect(overlaps[0]).toMatch(/^Excavation is in this price and also in the cut rate \(12\/m³\), Till excavation/)
    expect(overlaps[1]).toMatch(/^Haul is in this price and also in the road’s overhaul rate \(1\.2\/m³·km\)/)
    // The rate's own work is never an overlap, and a part nothing else prices is not one either.
    expect(adoptionOverlaps(project, waste, ['disposal', 'processing'])).toEqual([])
  })

  it('asks how an overlap was accounted for, and keeps the answer', () => {
    const waste = target(`${road}/haul.wasteRate`)
    const overlaps = adoptionOverlaps(project, waste, ['excavation', 'haul', 'disposal'])
    const bundled = input({
      record: offsite,
      target: waste,
      rate: 200,
      reason: '',
      includes: ['excavation', 'haul', 'disposal'],
      overlaps,
    })
    expect(adoptionProblems(bundled)[0]).toMatch(/already prices: say how you accounted for it/)
    const adoption = createAdoption(
      { ...bundled, rate: 120, reason: 'Excavation and haul priced on their own lines; disposal fee share only.' },
      '2026-11-14',
    )
    expect(adoption).toMatchObject({ includes: ['excavation', 'haul', 'disposal'], overlaps })
  })
})

describe('what is stored', () => {
  const adoption = createAdoption(input({ observedBasis: 'tonne' }), '2026-11-12')

  it('keeps the observation as it was read, with every term, beside the typed rate and its reason', () => {
    expect(adoption).toMatchObject({
      rate: 74,
      specificationConfirmed: true,
      reason: '2.2 t per compacted m³ from the pit’s test report.',
      adoptedOn: '2026-11-12',
      currency: 'CAD',
      observedBasis: 'tonne',
      target: { label: 'Surfacing rate', unit: '/m³' },
      observation: {
        recordId: 'alberta-upa-2026-3',
        kind: 'tender-average',
        currency: 'CAD',
        amounts: { value: 33.7 },
        unit: '/tonne',
        costYear: 2026,
        locator: "'2026 UPA '!B14:H14",
        checked: '2026-11-12',
        where: { country: 'CA', subdivision: 'CA-AB' },
      },
    })
    expect(adoption.observation!.terms!.map((term) => term.label)).toContain('Tax')
    expect(adoption.observation!.amounts).not.toBe(baseCourse.amounts)
    expect(formatEvidenceAmount(adoption.observation!)).toBe(formatEvidenceAmount(baseCourse))
  })

  it('writes the rate and its source together and leaves every other setting alone', () => {
    const next = applyAdoption(project, 'surfacingRate', adoption)
    expect(next.settings).toEqual({ ...project.settings, surfacingRate: 74 })
    expect(next.alignments).toBe(project.alignments)
    expect(next.rateEvidence).toEqual({ surfacingRate: adoption })
    const second = createAdoption(
      input({ record: excavation, target: target('cutRate'), rate: 11.22, reason: '' }),
      '2026-11-13',
    )
    expect(second.reason).toBeUndefined()
    const both = applyAdoption(next, 'cutRate', second)
    expect(Object.keys(both.rateEvidence!)).toEqual(['surfacingRate', 'cutRate'])
    expect(withoutAdoption(both.rateEvidence, 'cutRate')).toEqual({ surfacingRate: adoption })
    expect(withoutAdoption(next.rateEvidence, 'surfacingRate')).toBeUndefined()
    expect(withoutAdoption(next.rateEvidence, 'cutRate')).toBe(next.rateEvidence)
  })

  it('prints the rate, the observation in its own unit, its basis and terms, and the reason', () => {
    const adopted = applyAdoption(project, 'surfacingRate', adoption)
    const [line] = rateSourceLines(adopted.rateEvidence, adopted)
    expect(line).toMatchObject({
      rateKey: 'surfacingRate',
      adopted: 'Surfacing rate $74.00/m³',
      observed: '$33.70/tonne · CAD · 2026',
      source: 'Tender average · Granular Base Course — Des.2 Cl.25 · Alberta tender averages',
      locator: "'2026 UPA '!B14:H14 · checked 2026-11-12",
      reason: '2.2 t per compacted m³ from the pit’s test report.',
      scope: 'Measured on tonne',
      edited: null,
      orphaned: null,
      stale: null,
    })
    expect(line.terms.some((term) => term.startsWith('Tax:'))).toBe(true)
    expect(rateSourceLines(undefined, project)).toEqual([])
  })

  it('says so when the rate was edited after the adoption, or what it was for is gone', () => {
    const adopted = applyAdoption(project, 'surfacingRate', adoption)
    const [edited] = rateSourceLines(adopted.rateEvidence, {
      ...adopted,
      settings: { ...adopted.settings, surfacingRate: 80 },
    })
    expect(edited.edited).toBe(
      'The rate is now $80.00/m³, edited after this adoption; the source explains $74.00/m³ only.',
    )
    const key = `${road}/material:till.cutRate`
    const tillAdoption = createAdoption(
      input({ record: excavation, target: target(key), rate: 11.22, reason: '' }),
      '2026-11-14',
    )
    const withTill = applyAdoption(project, key, tillAdoption)
    const removed: RoadProject = {
      ...withTill,
      alignments: withTill.alignments.map((a) =>
        a.id === road ? { ...a, engineering: { ...a.engineering!, materials: a.engineering!.materials.slice(1) } } : a,
      ),
    }
    const [orphan] = rateSourceLines(removed.rateEvidence, removed)
    expect(orphan.label).toBe('Till excavation')
    expect(orphan.orphaned).toMatch(/no longer in the project/)
  })

  it('takes a build-up’s result and flags the rate when the build-up changes', () => {
    const truck: RateBuildUp = {
      id: 'b1',
      name: 'Pit run, 12 km',
      kind: 'truck-cycle',
      truck: {
        allInRateCadPerHour: 165,
        cycleMinutes: null,
        compactedPayloadM3: 10,
        parts: { loadMinutes: 6, haulKm: 12, loadedKmh: 40, unloadMinutes: 4, emptyKmh: 60, queueMinutes: 2 },
      },
      savedOn: '2026-11-14',
    }
    const snapshot = buildUpSnapshot(truck)!
    // 6 + 18 + 4 + 12 + 2 = 42 minutes; 165 × 42 ÷ 60 ÷ 10 = 11.55.
    expect(snapshot.result).toBeCloseTo(11.55, 10)
    expect(() => createBuildUpAdoption(snapshot, target('cutRate'), 'CAD', '2026-11-14')).toThrow(/bank m³/)
    const adoption = createBuildUpAdoption(snapshot, target(`${road}/site:pit.unitRate`), 'CAD', '2026-11-14')
    const applied = applyAdoption({ ...project, rateBuildUps: [truck] }, `${road}/site:pit.unitRate`, adoption)
    const [line] = rateSourceLines(applied.rateEvidence, applied)
    expect(line.source).toBe('Build-up · Truck cycle · Pit run, 12 km')
    expect(line.observed).toContain('= 42 min')
    expect(line.stale).toBeNull()
    const slower = { ...truck, truck: { ...truck.truck!, parts: { ...truck.truck!.parts!, loadedKmh: 30 } } }
    const [changed] = rateSourceLines(applied.rateEvidence, { ...applied, rateBuildUps: [slower] })
    expect(changed.stale).toMatch(/now gives \$13\.20\/m³; apply it again/)
    expect(rateSourceLines(applied.rateEvidence, { ...applied, rateBuildUps: undefined })[0].stale).toMatch(/deleted/)
  })

  it('survives the project file, reads a file from before rate targets, and refuses what could not be adopted', () => {
    const stored = JSON.parse(JSON.stringify({ surfacingRate: adoption }))
    expect(parseRateEvidence(stored)).toEqual({ surfacingRate: adoption })
    expect(parseRateEvidence(undefined)).toBeUndefined()
    expect(parseRateEvidence({})).toBeUndefined()
    // November 12 files: no currency, basis, terms or target.
    const legacy = JSON.parse(JSON.stringify(stored))
    for (const key of ['currency', 'observedBasis', 'target']) delete legacy.surfacingRate[key]
    for (const key of ['terms', 'cautions', 'where']) delete legacy.surfacingRate.observation[key]
    expect(parseRateEvidence(legacy)!.surfacingRate.rate).toBe(74)
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
    expect(broken((value) => (value.surfacingRate.includes = ['teleport']))).toThrow(/included work/)
    expect(broken((value) => delete value.surfacingRate.observation)).toThrow(/one record or one build-up/)
    expect(() => parseRateEvidence({ haulRate: adoption })).toThrow(/Rate source/)
    const roadKey = `${road}/haul.borrowRate`
    expect(Object.keys(parseRateEvidence({ [roadKey]: stored.surfacingRate })!)).toEqual([roadKey])
  })
})
