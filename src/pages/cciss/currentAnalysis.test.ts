import { describe, expect, it } from 'vitest'
import {
  assessCurrentSite,
  currentOptions,
  currentSitesAtPoint,
  parseCurrentBundle,
  type CurrentBundle,
} from './currentAnalysis'

/** Deliberately artificial input; expectations below are hand-calculated. */
function fixture(): CurrentBundle {
  const dimensions: CurrentBundle['pilot']['dimensions'] = []
  for (const model of [1, 2])
    for (const scenario of [1, 2])
      for (const [index, period] of ['2021', '2041', '2061', '2081'].entries())
        for (const run of [1, 2])
          dimensions.push({
            array_ordinal: dimensions.length + 1,
            gcm_id: model,
            scenario_id: scenario,
            futureperiod_id: index + 1,
            run_id: run,
            gcm: `model${model}`,
            scenario: `scenario${scenario}`,
            futureperiod: period,
            run: `run${run}`,
          })
  return {
    schema: 'cciss-current-analysis-v1',
    provenance: {
      datasetVersion: 'Synthetic test only',
      source: 'Independent artificial regression input',
      ccissrCommit: 'a'.repeat(40),
      versionMatched: true,
      synthetic: true,
    },
    pilot: {
      schema: 'cciss-current-pilot-v1',
      requestValid: true,
      requestedSites: [1],
      dimensions,
      bgcCodes: [
        { bgc_id: 1, bgc: 'A' },
        { bgc_id: 2, bgc: 'B' },
        { bgc_id: 3, bgc: 'C' },
      ],
      future: [{ siteno: 1, bgc_id: dimensions.map((d) => (d.futureperiod === '2021' ? 1 : d.gcm_id === 1 ? 2 : 3)) }],
      novelty: [{ siteno: 1, novelty: dimensions.map((d) => (d.gcm_id === 1 ? 10 : 70)) }],
      observed: [{ siteno: 1, bgc_pred: 'A' }],
      attribution: [{ siteno: 1, bgc: 'A' }],
      siteGeometry: [
        {
          siteno: 1,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2],
                [0, 0],
              ],
              [
                [0.5, 0.5],
                [1, 0.5],
                [1, 1],
                [0.5, 1],
                [0.5, 0.5],
              ],
            ],
          },
        },
      ],
    },
    ecology: {
      schema: 'cciss-ecology-v1',
      tables: {
        E1: [
          { BGC: 'A', SS_NoSpace: 'A/01', Edatopic: 'C4', SpecialCode: null },
          { BGC: 'A', SS_NoSpace: 'A/01', Edatopic: 'D4', SpecialCode: null },
          { BGC: 'B', SS_NoSpace: 'B/01', Edatopic: 'C4', SpecialCode: null },
          { BGC: 'B', SS_NoSpace: 'B/01', Edatopic: 'D4', SpecialCode: null },
          { BGC: 'B', SS_NoSpace: 'B/02', Edatopic: 'C4', SpecialCode: null },
          { BGC: 'B', SS_NoSpace: 'B/02', Edatopic: 'E4', SpecialCode: null },
          { BGC: 'C', SS_NoSpace: 'C/01', Edatopic: 'D4', SpecialCode: null },
        ],
        E1_Phase: [],
        S1: [
          { BGC: 'A', SS_NoSpace: 'A/01', Spp: 'Pine', Feasible: 1, OHR: false },
          { BGC: 'B', SS_NoSpace: 'B/01', Spp: 'Pine', Feasible: 2, OHR: false },
          { BGC: 'B', SS_NoSpace: 'B/02', Spp: 'Pine', Feasible: 3, OHR: false },
          { BGC: 'C', SS_NoSpace: 'C/01', Spp: 'Pine', Feasible: 5, OHR: false },
        ],
      },
    },
  }
}
const parsed = () => parseCurrentBundle(JSON.stringify(fixture()))

describe('current CCISS owner-bundle calculations', () => {
  it('accepts raw SQL export without pretending ecological or version readiness', () => {
    const raw = fixture().pilot
    raw.synthetic = true
    const bundle = parseCurrentBundle(JSON.stringify(raw))
    expect(bundle.provenance.versionMatched).toBe(false)
    expect(bundle.provenance.synthetic).toBe(true)
    const result = assessCurrentSite(bundle, { siteId: 1 })
    expect(result.bgcProbabilities.find((r) => r.period === '2041' && r.bgc === 'B')?.probability).toBe(0.5)
    expect(result.capabilities).toEqual({ predictions: true, siteSeries: false, suitability: false, summaries: false })
    expect(result.species).toEqual([])
    expect(result.warnings.join(' ')).toContain('Synthetic verification data')
  })
  it('derives labels and source periods from the supplied dimensions', () => {
    const options = currentOptions(parsed(), 1)
    expect(options.models).toEqual(['model1', 'model2'])
    expect(options.scenarios).toEqual(['scenario1', 'scenario2'])
    expect(options.runs).toEqual(['run1', 'run2'])
    expect(options.periods).toEqual(['1961', '1991', '2021', '2041', '2061', '2081'])
    expect(options.series).toEqual(['A/01'])
    const numeric = fixture() as unknown as { pilot: { dimensions: { futureperiod: string | number }[] } }
    numeric.pilot.dimensions.forEach((d) => {
      d.futureperiod = Number(d.futureperiod)
    })
    expect(currentOptions(parseCurrentBundle(JSON.stringify(numeric)), 1).periods).toEqual(options.periods)
  })
  it('weights every actual run and excludes missing members from SQL denominators', () => {
    const bundle = parsed()
    const result = assessCurrentSite(bundle, {
      siteId: 1,
      modelWeights: { model1: 3, model2: 1 },
      scenarioWeights: { scenario1: 1, scenario2: 0 },
    })
    expect(result.bgcProbabilities.find((r) => r.period === '2041' && r.bgc === 'B')).toMatchObject({
      probability: 0.75,
      members: 2,
    })
    bundle.pilot.future[0].bgc_id[2] = null // model1/scenario1/2041/run1
    const missing = assessCurrentSite(bundle, { siteId: 1 })
    expect(missing.bgcProbabilities.find((r) => r.period === '2041' && r.bgc === 'B')?.probability).toBeCloseTo(3 / 7)
    expect(missing.warnings.join(' ')).toContain('1 selected prediction members are missing')
    expect(() => assessCurrentSite(bundle, { siteId: 1, modelWeights: { model1: 0, model2: 0 } })).toThrow(
      'positive weight',
    )
    const extreme = assessCurrentSite(parsed(), {
      siteId: 1,
      modelWeights: { model1: 1e308, model2: 1e308 },
      scenarioWeights: { scenario1: 1e308, scenario2: 1e308 },
    })
    expect(extreme.bgcProbabilities.find((r) => r.period === '2041' && r.bgc === 'B')?.probability).toBe(0.5)
    expect(extreme.bgcProbabilities.every((r) => Number.isFinite(r.probability))).toBe(true)
  })
  it('uses forward×reverse overlap, residual unsuitable mass and source summaries', () => {
    const result = assessCurrentSite(parsed(), { siteId: 1, series: 'A/01' })
    const future = result.overlap.filter((r) => r.period === '2041')
    expect(future.find((r) => r.predictedSeries === 'B/01')?.probability).toBeCloseTo(0.4)
    expect(future.find((r) => r.predictedSeries === 'B/02')?.probability).toBeCloseTo(0.1)
    expect(future.find((r) => r.predictedSeries === 'C/01')?.probability).toBeCloseTo(0.5)
    const row = result.species[0]
    expect(row.votes['2041']).toEqual([0, 0.4, 0.1, 0.5])
    expect(result.summaries[0].summary).toMatchObject({ establishment: 1, maturation: 3, improve: 25, decline: 75 })
    expect(result.summaries[0].summary?.maturationScore).toBeCloseTo(3.34)
    expect(result.warnings.join(' ')).toContain('Synthetic verification data')
  })
  it('splits compatible phases after mainunit overlap and honours special codes', () => {
    const bundle = parsed()
    bundle.ecology!.tables.E1_Phase = [
      { BGC: 'B', SS_NoSpace: 'B/01a', Edatopic: 'C4', SpecialCode: null, MainUnit: 'B/01' },
      { BGC: 'B', SS_NoSpace: 'B/01b', Edatopic: 'D4', SpecialCode: null, MainUnit: 'B/01' },
    ]
    const phaseResult = assessCurrentSite(bundle, { siteId: 1, series: 'A/01' })
    expect(
      phaseResult.overlap.find((r) => r.period === '2041' && r.predictedSeries === 'B/01a')?.probability,
    ).toBeCloseTo(0.2)
    expect(
      phaseResult.overlap.find((r) => r.period === '2041' && r.predictedSeries === 'B/01b')?.probability,
    ).toBeCloseTo(0.2)
    expect(phaseResult.species[0].votes['2041']).toEqual([0, 0.4, 0.1, 0.5])
    // Ordinary phase ratings are display references. Current Shiny explicitly
    // computes species votes from NoPhase, even when phases carry other ratings.
    bundle.ecology!.tables.S1.push({ BGC: 'B', SS_NoSpace: 'B/01a', Spp: 'Pine', Feasible: 5 })
    expect(assessCurrentSite(bundle, { siteId: 1, series: 'A/01' }).species[0].votes['2041']).toEqual([
      0, 0.4, 0.1, 0.5,
    ])
    bundle.ecology!.tables.E1.push({ BGC: 'A', SS_NoSpace: 'A/01', Edatopic: 'C4', SpecialCode: null })
    const duplicated = assessCurrentSite(bundle, { siteId: 1, series: 'A/01' })
    // Raw phase joins count C4 twice but D4 once, so squared overlaps split
    // the parent probability 4:1. Regular NoPhase votes remain unchanged.
    expect(
      duplicated.overlap.find((r) => r.period === '2041' && r.predictedSeries === 'B/01a')?.probability,
    ).toBeCloseTo(0.32)
    expect(
      duplicated.overlap.find((r) => r.period === '2041' && r.predictedSeries === 'B/01b')?.probability,
    ).toBeCloseTo(0.08)
    expect(duplicated.species[0].votes['2041']).toEqual([0, 0.4, 0.1, 0.5])
    bundle.ecology!.tables.E1.forEach((r) => {
      if (['A/01', 'B/02'].includes(r.SS_NoSpace)) r.SpecialCode = 'wet'
    })
    const special = assessCurrentSite(bundle, { siteId: 1, series: 'A/01' })
    expect(special.overlap.filter((r) => r.period === '2041' && r.predictedBgc === 'B')).toEqual([
      { period: '2041', predictedBgc: 'B', predictedSeries: 'B/02', probability: 0.5 },
    ])
  })
  it('keeps special current phases selectable but pairs them as ccissr eda_overlap.R does', () => {
    const bundle = parsed()
    bundle.ecology!.tables.E1_Phase.push({
      BGC: 'A',
      SS_NoSpace: 'A/02a',
      Edatopic: 'C4',
      SpecialCode: 'wet',
      MainUnit: 'A/02',
    })
    bundle.ecology!.tables.E1.push({ BGC: 'D', SS_NoSpace: 'D/01', Edatopic: 'Z9', SpecialCode: 'wet' })
    bundle.ecology!.tables.S1.push({ BGC: 'D', SS_NoSpace: 'D/01', Spp: 'Pine', Feasible: 1 })
    bundle.pilot.bgcCodes.push({ bgc_id: 4, bgc: 'D' })
    bundle.pilot.future[0].bgc_id = bundle.pilot.future[0].bgc_id.map((id) => (id === 3 ? 4 : id))
    expect(currentOptions(bundle, 1).series).toEqual(['A/01', 'A/02a'])
    // Values from running ccissr edatopicOverlap(onlyRegular = TRUE) on this input (R 4.3.3, data.table 1.14.10).
    // rmFlag looks special codes up in E1 only, so the special phase A/02a (wet) cannot pair with the special E1
    // series D/01 (wet). D then has no overlap at all and leaves the BGC denominator, so B carries all of 2041.
    const regular = assessCurrentSite(bundle, { siteId: 1, series: 'A/01' })
    expect(regular.overlap.find((r) => r.period === '2041' && r.predictedSeries === 'B/01')?.probability).toBeCloseTo(
      0.8,
    )
    expect(regular.species.find((r) => r.species === 'Pine')?.votes['2041']).toEqual([0, 0.8, 0.2, 0])
    const phase = assessCurrentSite(bundle, { siteId: 1, series: 'A/02a' })
    expect(phase.overlap).toEqual([])
    expect(phase.species).toEqual([])
    expect(phase.capabilities.summaries).toBe(false)
  })
  it('applies encoded novelty cutoff and keeps pre-display summaries separate', () => {
    const result = assessCurrentSite(parsed(), { siteId: 1, series: 'A/01', noveltyCutoff: 5 })
    expect(result.bgcProbabilities.find((r) => r.period === '2041' && r.bgc === 'novel')?.probability).toBe(0.5)
    expect(result.species[0].votes['2041']).toEqual([0, 0.4, 0.1, 0])
    expect(result.species[0].novelty['2041']).toBe(0.5)
    expect(result.summaries[0].summary?.maturationScore).toBeCloseTo(2.08)
    const bundle = parsed()
    bundle.pilot.novelty[0].novelty[0] = null
    expect(() => assessCurrentSite(bundle, { siteId: 1, noveltyCutoff: 5 })).toThrow('missing novelty')
  })
  it('does not infer missing observed votes or accept unconfirmed ecological versions', () => {
    const bundle = parsed()
    bundle.pilot.observed[0].bgc_pred = null
    const result = assessCurrentSite(bundle, { siteId: 1, series: 'A/01' })
    expect(result.bgcProbabilities.some((r) => r.period === '1991')).toBe(false)
    expect(result.capabilities.summaries).toBe(false)
    bundle.provenance.versionMatched = false
    expect(assessCurrentSite(bundle, { siteId: 1, series: 'A/01' }).species).toEqual([])
  })
  it('contains points using actual polygons, holes and shared-boundary ambiguity', () => {
    const bundle = parsed()
    expect(currentSitesAtPoint(bundle, [0.2, 0.2])).toEqual([1])
    expect(currentSitesAtPoint(bundle, [0.7, 0.7])).toEqual([])
    expect(currentSitesAtPoint(bundle, [20, 20])).toEqual([])
    bundle.pilot.siteGeometry.push({
      siteno: 2,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [2, 0],
            [3, 0],
            [3, 2],
            [2, 2],
            [2, 0],
          ],
        ],
      },
    })
    expect(currentSitesAtPoint(bundle, [2, 1])).toEqual([1, 2])
  })
  it('rejects shifted ordinals, malformed arrays, mismatched source schema and unsafe inputs', () => {
    const mutations: ((b: CurrentBundle) => void)[] = [
      (b) => {
        b.pilot.dimensions[0].array_ordinal = 2
      },
      (b) => {
        b.pilot.future[0].bgc_id.pop()
      },
      (b) => {
        b.pilot.future[0].bgc_id[0] = 999
      },
      (b) => {
        b.pilot.attribution.push(b.pilot.attribution[0])
      },
      (b) => {
        b.pilot.dimensions[0].futureperiod = '2021_2040'
      },
      (b) => {
        b.pilot.dimensions[0].futureperiod = '1961'
      },
      (b) => {
        b.pilot.dimensions[0].futureperiod = '1991'
      },
      (b) => {
        delete (b.ecology!.tables.S1[0] as { Feasible?: number }).Feasible
      },
    ]
    for (const mutate of mutations) {
      const bundle = fixture()
      mutate(bundle)
      expect(() => parseCurrentBundle(JSON.stringify(bundle))).toThrow()
    }
    expect(() => parseCurrentBundle('{')).toThrow('valid JSON')
    const missingOhr = parsed()
    delete missingOhr.ecology!.tables.S1[0].OHR
    expect(() => assessCurrentSite(missingOhr, { siteId: 1, series: 'A/01', includeOutOfRange: false })).toThrow(
      'explicit boolean OHR',
    )
  })
})
