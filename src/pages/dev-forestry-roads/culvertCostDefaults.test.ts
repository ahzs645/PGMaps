import { describe, expect, it } from 'vitest'
import catalogue from './costEvidence/external.generated.json'
import {
  CROSS_DRAIN_COST_DEFAULT,
  culvertCostDefaultProblem,
  culvertCostDefaultStatus,
  parseCulvertCostDefault,
  withCulvertCostDefault,
  withUnpricedCrossDrainDefaults,
} from './culvertCostDefaults'
import { createEngineeringDesign, type Culvert } from './engineeringTypes'
import { createDemoProject } from './terrain'

const culvert = (patch: Partial<Culvert> = {}): Culvert => ({
  id: 'cross-drain',
  name: 'Cross-drain 1',
  kind: 'cross-drain',
  chainage: 20,
  skewDegrees: 0,
  lengthM: 9.5,
  diameterM: 0.6,
  inletInvertM: null,
  outletInvertM: null,
  minCoverM: 0.6,
  unitCost: 0,
  fixedCost: 0,
  ...patch,
})

describe('provisional cross-drain construction price', () => {
  it('pins the amount, unit, specification and source to the reviewed catalogue record', () => {
    const record = catalogue.records.find((record) => record.id === CROSS_DRAIN_COST_DEFAULT.recordId)!
    expect(record).toBeDefined()
    expect(record.kind).toBe('tender-average')
    expect(record.country).toBe('CA')
    expect(record.subdivision).toBe('CA-AB')
    expect(CROSS_DRAIN_COST_DEFAULT).toMatchObject({
      unitCost: record.amounts.value,
      currency: record.currency,
      unit: record.unit,
      priceYear: record.costYear,
      recordTitle: record.title,
      sourceUrl: record.url,
      specification: record.scope,
      dateNote: record.dateNote,
      sample: record.sample,
      locator: record.locator,
      checkedAt: record.checked,
      status: 'unreviewed',
    })
  })

  it('prices an eligible cross-drain without setting its hydraulic material or claiming review', () => {
    const original = culvert()
    const priced = withCulvertCostDefault(original)
    expect(priced.unitCost).toBe(372.67)
    expect(priced.fixedCost).toBe(0)
    expect(priced.costDefault).toEqual(CROSS_DRAIN_COST_DEFAULT)
    expect(priced.material).toBeUndefined()
    expect(culvertCostDefaultStatus(priced)).toMatchObject({
      edited: false,
      specChanged: false,
      currencyChanged: false,
      summary: expect.stringMatching(/CSP is a cost assumption/),
    })
    expect(original.unitCost).toBe(0)
    expect(original.costDefault).toBeUndefined()
  })

  it.each([
    ['unknown purpose', { kind: undefined }],
    ['stream', { kind: 'stream' }],
    ['associated natural stream', { sourceFeatureId: 'creek' }],
    ['different diameter', { diameterM: 0.8 }],
    ['box', { shape: 'box', spanM: 0.6 }],
    ['plastic', { material: 'smooth-plastic' }],
    ['concrete', { material: 'concrete' }],
    ['embedded', { embedmentM: 0.1 }],
    ['multiple barrels', { barrels: 2 }],
  ] as const)('leaves %s culverts unpriced', (_name, patch) => {
    const original = culvert(patch)
    expect(culvertCostDefaultProblem(original)).not.toBeNull()
    expect(withCulvertCostDefault(original)).toBe(original)
  })

  it('preserves custom, fixed-only, imported and deliberately cleared prices', () => {
    for (const original of [
      culvert({ unitCost: 372.67 }), // matching the amount alone is not provenance
      culvert({ unitCost: 500 }),
      culvert({ fixedCost: 1500 }),
      culvert({ roadEng: {} as NonNullable<Culvert['roadEng']> }),
      culvert({ roadEngDesign: {} as NonNullable<Culvert['roadEngDesign']> }),
      culvert({ costDefault: { ...CROSS_DRAIN_COST_DEFAULT } }),
    ])
      expect(withCulvertCostDefault(original)).toBe(original)
    expect(culvertCostDefaultStatus(culvert({ unitCost: 372.67 }))).toBeNull()
  })

  it('never imports the CAD default into a project in another currency', () => {
    const original = culvert()
    expect(withCulvertCostDefault(original, 'USD')).toBe(original)
    const priced = withCulvertCostDefault(original)
    expect(culvertCostDefaultStatus(priced, 'USD')).toMatchObject({
      currencyChanged: true,
      problem: expect.stringMatching(/project’s currency/),
    })
  })

  it('retains the observation and review prompt when a rate or specification changes', () => {
    const priced = withCulvertCostDefault(culvert())
    const edited = { ...priced, unitCost: 500, fixedCost: 250, diameterM: 0.8 }
    expect(culvertCostDefaultStatus(edited)).toMatchObject({
      edited: true,
      specChanged: true,
      summary: expect.stringMatching(/Edited from provisional CAD 372.67\/m/),
    })
    expect(edited.costDefault).toBe(priced.costDefault)
    expect(edited.costDefault!.unitCost).toBe(372.67)
  })

  it('applies selected existing zeroes in one immutable project edit and preserves other roads', () => {
    const project = createDemoProject()
    const road = project.alignments[0]
    road.engineering = {
      ...createEngineeringDesign(),
      culverts: [
        culvert(),
        culvert({ id: 'held', name: 'Cost carried elsewhere' }),
        culvert({ id: 'quote', unitCost: 500 }),
        culvert({ id: 'creek', kind: 'stream' }),
      ],
    }
    project.alignments.push({ ...road, id: 'another-road' })
    const next = withUnpricedCrossDrainDefaults(project, road.id, ['cross-drain', 'quote', 'creek'])
    expect(next).not.toBe(project)
    expect(next.alignments[1]).toBe(project.alignments[1])
    expect(next.alignments[0].engineering!.culverts.map((c) => c.unitCost)).toEqual([372.67, 0, 500, 0])
    expect(project.alignments[0].engineering!.culverts[0].unitCost).toBe(0)
    expect(withUnpricedCrossDrainDefaults(next, road.id, ['cross-drain'])).toBe(next)
    expect(withUnpricedCrossDrainDefaults(project, 'absent')).toBe(project)

    project.costLocation = { place: { country: 'US' }, basis: 'chosen', setOn: '2026-11-19' }
    expect(withUnpricedCrossDrainDefaults(project, road.id)).toBe(project)
  })

  it('parses the stored source without refreshing it from the active default', () => {
    const old = { ...CROSS_DRAIN_COST_DEFAULT, unitCost: 350, checkedAt: '2026-10-01' }
    expect(parseCulvertCostDefault(old)).toEqual(old)
    expect(parseCulvertCostDefault(old)).not.toBe(old)
  })

  it.each([
    { unitCost: -1 },
    { fixedCost: Infinity },
    { currency: 'USD' },
    { status: 'reviewed' },
    { unit: '/each' },
    { sourceUrl: 'javascript:alert(1)' },
    { checkedAt: 'yesterday' },
    { priceYear: 0 },
  ])('rejects a malformed provisional observation: %j', (patch) => {
    expect(() => parseCulvertCostDefault({ ...CROSS_DRAIN_COST_DEFAULT, ...patch })).toThrow(/Culvert provisional/)
  })
})
