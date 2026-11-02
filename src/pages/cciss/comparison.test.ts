import { describe, expect, it } from 'vitest'
import {
  COMPARISON_METRIC_LIMIT,
  compareSnapshots,
  comparisonMetricKey,
  parseComparisonSnapshot,
  serializeComparisonSnapshot,
  type ComparisonMetric,
  type ComparisonSnapshot,
} from './comparison'
import { shinySnapshot } from './comparisonAdapters'
import { parseShinyReport } from './shinyReport'

function snapshot(id = 'A'): ComparisonSnapshot {
  return {
    schema: 'cciss-comparison-snapshot-v1',
    id,
    label: `Assessment ${id}`,
    family: 'test-current-analysis',
    provenance: { source: 'Synthetic hand calculations', version: 'source-1', method: 'method-1', synthetic: true },
    context: { site: { id, point: [-123, 54] }, settings: { modelWeights: { first: 1, second: 1 } } },
    periods: { '2021': { label: '2021–2040', startYear: 2021, endYear: 2040, kind: 'modelled' } },
    metrics: [
      {
        measure: 'species.vote',
        entity: 'Pl',
        dimensions: { class: '1', stage: 'modelled' },
        period: '2021',
        value: 0.2,
        unit: 'probability',
        direction: 'higher-better',
      },
      {
        measure: 'species.establishment',
        entity: 'Pl',
        dimensions: {},
        period: null,
        periodCoverage: ['2021'],
        value: 2,
        unit: 'class',
        scale: 'cciss-suitability-1-4',
        direction: 'lower-better',
      },
      { measure: 'bgc.label', entity: 'location', dimensions: {}, period: '2021', value: 'SBSmh', unit: 'category' },
      {
        measure: 'regional.expansion',
        entity: 'Pl',
        dimensions: { scope: 'named-region' },
        period: '2021',
        value: 1.5,
        unit: 'ratio',
      },
      {
        measure: 'regional.total',
        entity: 'Cw',
        dimensions: { scope: 'named-region' },
        period: '2021',
        value: null,
        unit: 'count',
      },
    ],
  }
}

describe('source-neutral immutable comparison snapshots', () => {
  it('clones and freezes nested data and round trips exact dimensions/provenance', () => {
    const input = snapshot()
    const parsed = parseComparisonSnapshot(input)
    ;(input.context.site as { point: number[] }).point[0] = -100
    input.metrics[0].value = 0.9
    expect(parsed.context).toEqual(snapshot().context)
    expect(parsed.metrics[0].value).toBe(0.2)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.context.site)).toBe(true)
    expect(Object.isFrozen(parsed.metrics[0].dimensions)).toBe(true)
    expect(() => {
      parsed.metrics[0].value = 0.9
    }).toThrow()
    expect(parseComparisonSnapshot(serializeComparisonSnapshot(parsed))).toEqual(parsed)
  })
  it('compares different sites/settings with B−A probability points and lower-better class steps', () => {
    const left = snapshot(),
      right = snapshot('B')
    right.context.settings = { modelWeights: { first: 3, second: 1 } }
    right.metrics[0].value = 0.5
    right.metrics[1].value = 3
    right.metrics[2].value = 'ICHdw'
    right.metrics[3].value = 2
    const result = compareSnapshots(left, right)
    const vote = result.rows.find((r) => r.metric.measure === 'species.vote')!
    expect(vote.delta).toBeCloseTo(30)
    expect(vote.deltaUnit).toBe('percentage-points')
    expect(vote.interpretation).toBe('improved')
    const suitability = result.rows.find((r) => r.metric.measure === 'species.establishment')!
    expect(suitability.delta).toBe(1)
    expect(suitability.deltaUnit).toBe('class-steps')
    expect(suitability.interpretation).toBe('declined')
    const region = result.rows.find((r) => r.metric.measure === 'regional.expansion')!
    expect(region.delta).toBe(0.5)
    expect(region.deltaUnit).toBe('absolute')
    const bgc = result.rows.find((r) => r.metric.measure === 'bgc.label')!
    expect(bgc).toMatchObject({
      leftValue: 'SBSmh',
      rightValue: 'ICHdw',
      delta: null,
      interpretation: 'changed',
      compatible: true,
    })
    expect(result.comparedCount).toBe(3)
  })
  it('uses explicit dimensions as identity, preserving observed/modelled and missingness', () => {
    const left = snapshot(),
      right = snapshot('B')
    right.metrics[0].dimensions = { stage: 'observed', class: '1' }
    const result = compareSnapshots(left, right)
    const votes = result.rows.filter((r) => r.metric.measure === 'species.vote')
    expect(votes).toHaveLength(2)
    expect(votes.map((r) => r.delta)).toEqual([null, null])
    expect(votes.map((r) => [r.leftValue, r.rightValue])).toEqual([
      [0.2, null],
      [null, 0.2],
    ])
    expect(result.rows.find((r) => r.metric.measure === 'regional.total')).toMatchObject({
      leftValue: null,
      rightValue: null,
      delta: null,
      interpretation: 'unknown',
    })
    expect(result.warnings.join(' ')).toContain('not zero')
    const reordered = { ...left.metrics[0], dimensions: { stage: 'modelled', class: '1' } }
    expect(comparisonMetricKey(reordered)).toBe(comparisonMetricKey(left.metrics[0]))
  })
  it('withholds arithmetic for different workflows, synthetic status or methods', () => {
    for (const mutate of [
      (b: ComparisonSnapshot) => {
        b.family = 'test-legacy-analysis'
      },
      (b: ComparisonSnapshot) => {
        b.provenance.synthetic = false
      },
      (b: ComparisonSnapshot) => {
        b.provenance.method = 'other-method'
      },
    ]) {
      const right = snapshot('B')
      mutate(right)
      const result = compareSnapshots(snapshot(), right)
      expect(result.compatible).toBe(false)
      expect(result.rows.every((r) => r.delta === null && !r.compatible)).toBe(true)
      expect(result.rows[0]).toMatchObject({ leftValue: 0.2, rightValue: 0.2 })
    }
    const version = snapshot('B')
    version.provenance.version = 'source-2'
    expect(compareSnapshots(snapshot(), version).warnings.join(' ')).toContain('Source versions differ')
    expect(compareSnapshots(snapshot(), version).rows[0].delta).toBe(0)
  })
  it('keeps exact period IDs and rejects same-ID boundary/kind assumptions', () => {
    const right = snapshot('B')
    right.periods['2021'].endYear = 2050
    expect(compareSnapshots(snapshot(), right).rows.every((r) => r.delta === null && !r.compatible)).toBe(true)
    right.periods['2021'] = {
      label: 'Original 2021 ID, bounds unavailable',
      startYear: null,
      endYear: null,
      kind: 'unknown',
    }
    const left = snapshot()
    left.periods['2021'] = { ...right.periods['2021'] }
    expect(compareSnapshots(left, right).rows[0].reason).toContain('unknown')
    const renamed = snapshot('C')
    renamed.periods['2021_2040'] = renamed.periods['2021']
    delete renamed.periods['2021']
    renamed.metrics.forEach((m) => {
      if (m.period === '2021') m.period = '2021_2040'
      if (m.periodCoverage)
        m.periodCoverage = m.periodCoverage.map((period) => (period === '2021' ? '2021_2040' : period))
    })
    const result = compareSnapshots(snapshot(), renamed)
    expect(result.rows.filter((r) => r.metric.measure === 'species.vote')).toHaveLength(2)
    expect(result.rows.every((r) => r.delta === null)).toBe(true)
  })
  it('withholds ordinal/unit mismatches rather than claiming percentage change', () => {
    const right = snapshot('B')
    right.metrics[1].scale = 'different-rating-system'
    right.metrics[3].unit = 'score'
    const result = compareSnapshots(snapshot(), right)
    expect(result.rows.find((r) => r.metric.unit === 'class')).toMatchObject({ delta: null, compatible: false })
    expect(result.rows.find((r) => r.metric.measure === 'regional.expansion')).toMatchObject({
      delta: null,
      compatible: false,
    })
    delete right.metrics[1].scale
    const left = snapshot()
    delete left.metrics[1].scale
    expect(compareSnapshots(left, right).rows.find((r) => r.metric.unit === 'class')?.reason).toContain('unspecified')
  })
  it('compares aggregate metrics only over their explicit contributing periods', () => {
    const left = snapshot(),
      right = snapshot('B')
    for (const value of [left, right]) {
      value.periods['1961'] = { label: 'Mapped baseline', startYear: 1961, endYear: 1990, kind: 'baseline' }
      value.periods['1991'] = {
        label: 'Conflicting source observation labels; exact ID retained',
        startYear: null,
        endYear: null,
        kind: 'observed',
      }
      for (const startYear of [2041, 2061, 2081])
        value.periods[String(startYear)] = {
          label: String(startYear),
          startYear,
          endYear: startYear + 19,
          kind: 'modelled',
        }
      value.metrics = [
        {
          measure: 'species.establishment',
          entity: 'Pl',
          dimensions: {},
          period: null,
          periodCoverage: ['1961', '1991', '2021'],
          value: 2,
          unit: 'class',
          scale: 'cciss-suitability-1-4',
          direction: 'lower-better',
        },
        {
          measure: 'species.maturation',
          entity: 'Pl',
          dimensions: {},
          period: null,
          periodCoverage: ['2081', '2061', '2021', '2041'],
          value: 2,
          unit: 'class',
          scale: 'cciss-suitability-1-4',
          direction: 'lower-better',
        },
        {
          measure: 'species.baseline',
          entity: 'Pl',
          dimensions: {},
          period: '1961',
          value: 2,
          unit: 'class',
          scale: 'cciss-suitability-1-4',
          direction: 'lower-better',
        },
      ]
    }
    right.metrics.forEach((m) => {
      m.value = 3
    })
    const result = compareSnapshots(left, right)
    expect(result.rows.find((r) => r.metric.measure === 'species.establishment')).toMatchObject({
      delta: null,
      compatible: false,
    })
    expect(result.rows.find((r) => r.metric.measure === 'species.maturation')).toMatchObject({
      delta: 1,
      compatible: true,
      interpretation: 'declined',
    })
    expect(result.rows.find((r) => r.metric.measure === 'species.baseline')).toMatchObject({
      delta: 1,
      compatible: true,
    })
    expect(parseComparisonSnapshot(left).metrics[1].periodCoverage).toEqual(['2021', '2041', '2061', '2081'])
    const originalKey = comparisonMetricKey(left.metrics[1])
    right.metrics[1].periodCoverage = ['2021', '2041']
    const different = compareSnapshots(left, right).rows.find((r) => r.metric.measure === 'species.maturation')!
    expect(different.key).toBe(originalKey)
    expect(different).toMatchObject({ delta: null, compatible: false })
    delete right.metrics[1].periodCoverage
    expect(compareSnapshots(left, right).rows.find((r) => r.metric.measure === 'species.maturation')?.reason).toContain(
      'unspecified',
    )
  })
  it('retains truncated original Shiny summary values while withholding unsupported summary comparisons', () => {
    const csv = (maturation: number) =>
      ['SiteRef,SS_NoSpace,Spp,Curr,1_2021,2_2021,3_2021,X_2021,ccissFeas', `1,A/01,Pl,2,1,0,0,0,${maturation}`].join(
        '\n',
      )
    const left = shinySnapshot(parseShinyReport(csv(2)), {
      id: 'incomplete-A',
      site: '1',
      series: 'A/01',
      source: 'Partial current export A',
    })
    const right = shinySnapshot(parseShinyReport(csv(3)), {
      id: 'incomplete-B',
      site: '1',
      series: 'A/01',
      source: 'Partial current export B',
    })
    const result = compareSnapshots(left, right)
    const maturation = result.rows.find((row) => row.metric.measure === 'species.summary.maturation.shiny')!
    expect(maturation).toMatchObject({
      leftValue: 2,
      rightValue: 3,
      delta: null,
      compatible: false,
      interpretation: 'incompatible',
    })
    expect(maturation.reason).toMatch(/contribut|coverage|unspecified|unknown/i)
    // The actual exported 2021 vote still has a verified source-period definition;
    // missing summary contributors do not block its separate numeric comparison.
    expect(
      result.rows.find((row) => row.metric.measure === 'species.vote' && row.metric.dimensions.class === '1'),
    ).toMatchObject({ delta: 0, compatible: true })
  })
  it('imputes absent probability categories only from explicit, compatible complete group scope', () => {
    const left = snapshot(),
      right = snapshot('B')
    const metric = (entity: string, value: number): ComparisonMetric => ({
      measure: 'bgc.probability',
      entity,
      dimensions: { stage: 'modelled' },
      period: '2021',
      value,
      unit: 'probability',
      probabilityGroup: 'modelled-bgc-2021',
    })
    left.metrics = [metric('A', 0.75), metric('B', 0.25)]
    right.metrics = [metric('A', 0.5), metric('C', 0.5)]
    const group = {
      id: 'modelled-bgc-2021',
      measure: 'bgc.probability',
      period: '2021',
      entity: null,
      dimensions: { stage: 'modelled' },
      categoryDimensions: [],
      complete: true,
    }
    left.probabilityGroups = [group]
    right.probabilityGroups = [{ ...group, dimensions: { ...group.dimensions }, categoryDimensions: [] }]
    const result = compareSnapshots(left, right)
    expect(result.rows.find((r) => r.metric.entity === 'B')).toMatchObject({
      leftValue: 0.25,
      rightValue: 0,
      rightImputed: true,
      delta: -25,
    })
    expect(result.rows.find((r) => r.metric.entity === 'C')).toMatchObject({
      leftValue: 0,
      rightValue: 0.5,
      leftImputed: true,
      delta: 50,
    })
    right.probabilityGroups[0].complete = false
    expect(compareSnapshots(left, right).rows.find((r) => r.metric.entity === 'B')).toMatchObject({
      rightValue: null,
      rightImputed: false,
      delta: null,
    })
    right.probabilityGroups[0].dimensions.stage = 'observed'
    right.metrics.forEach((m) => {
      m.dimensions.stage = 'observed'
    })
    expect(compareSnapshots(left, right).rows.every((r) => !r.leftImputed && !r.rightImputed)).toBe(true)
    left.metrics[0].value = 0.5
    expect(() => parseComparisonSnapshot(left)).toThrow('sum to one')
  })
  it('rejects malformed/cyclic/nonfinite/duplicate/oversized data without changing the last snapshot', () => {
    const invalid: ((s: ComparisonSnapshot) => void)[] = [
      (s) => {
        s.metrics.push({ ...s.metrics[0], dimensions: { stage: 'modelled', class: '1' } })
      },
      (s) => {
        s.metrics[0].value = Infinity
      },
      (s) => {
        s.metrics[0].value = 1.1
      },
      (s) => {
        s.metrics[1].value = 1.5
      },
      (s) => {
        s.metrics[0].period = 'undefined-period'
      },
      (s) => {
        s.metrics[0].periodCoverage = ['2021']
      },
      (s) => {
        s.metrics[1].periodCoverage = ['2021', '2021']
      },
      (s) => {
        s.metrics[1].periodCoverage = ['unknown']
      },
      (s) => {
        s.periods['2021'].startYear = 2050
      },
      (s) => {
        s.context.cycle = s.context
      },
      (s) => {
        s.context.nonJson = undefined as unknown as null
      },
      (s) => {
        s.metrics = Array.from({ length: COMPARISON_METRIC_LIMIT + 1 }, () => s.metrics[0])
      },
    ]
    const valid = parseComparisonSnapshot(snapshot())
    for (const mutate of invalid) {
      const value = snapshot()
      mutate(value)
      expect(() => parseComparisonSnapshot(value)).toThrow()
    }
    expect(() => parseComparisonSnapshot('{')).toThrow('valid JSON')
    expect(() => parseComparisonSnapshot(JSON.stringify({ ...snapshot(), unexpected: true }))).toThrow(
      'unsupported field',
    )
    expect(valid.metrics[0].value).toBe(0.2)
  })
  it('withholds nonfinite numeric differences even when both source values are finite', () => {
    const left = snapshot(),
      right = snapshot('B')
    left.metrics = [
      { measure: 'arbitrary.score', entity: 'test', dimensions: {}, period: '2021', value: -1e308, unit: 'score' },
    ]
    right.metrics = [{ ...left.metrics[0], value: 1e308 }]
    expect(compareSnapshots(left, right).rows[0]).toMatchObject({
      delta: null,
      compatible: false,
      interpretation: 'incompatible',
    })
  })
})
