import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { createDemoProject, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import { parseProject, serializeProject } from './project'
import { alternativeCostStatus } from './alternativeCosts'
import { fullCostInputSignature } from './fullCostRecord'
import { analyzeFullCostConnector, compareFullCostCandidates } from './fullCostComparison'
import { createTotalCostPlanningDefaults } from './fullCostPlanning'
import {
  crossingReportHtml,
  crossingScreeningOverlapCount,
  estimateCrossings,
  newCrossingCostItem,
  priceCrossingItems,
  reconcileCrossingRecords,
  synchronizeCrossingRecords,
} from './crossingPlan'
import type { CrossingCostItem } from './crossingPlanTypes'
import type { Alignment, ContextFeature, Coordinate, Crossing } from './types'
import { assessCostReadiness } from './costReadiness'
import { optimizeVerticalProfile } from './verticalOptimizer'
import { EMPTY_STREAM_ASSESSMENT } from './streamClass'

const origin: Coordinate = [-122.8, 53.9]
const xy = (x: number, y: number): Coordinate => offsetCoordinate(offsetCoordinate(origin, 90, x), 0, y)
const terrain = { elevationAt: () => 800 }
const settings = { ...DEFAULT_ROAD_SETTINGS, stationInterval: 10 }
const road = (): Alignment => ({
  id: 'road',
  name: 'Test road',
  color: '#16817a',
  points: [
    { id: 'start', coordinate: origin, radiusM: 0 },
    { id: 'end', coordinate: xy(0, 100), radiusM: 0 },
  ],
  vertical: [],
  overrides: [],
  template: { ...DEFAULT_TEMPLATE, surfaceDepth: 0 },
})
const stream = (id: string, y: number): ContextFeature => ({
  id,
  name: id,
  kind: 'stream',
  geometry: { type: 'LineString', coordinates: [xy(-30, y), xy(30, y)] },
})
const context = [stream('one', 25), stream('two', 75)]
const item = (id: string, rate: number | null): CrossingCostItem => ({
  ...newCrossingCostItem(id),
  unitRate: rate,
  source: 'Synthetic test quote',
  sourceUrl: 'https://example.com/quote',
  priceDate: '2026-11-07',
})
const planned = (input = road()): Alignment => {
  const crossings = analyzeRoad(input, terrain, settings, context).crossings
  return {
    ...input,
    crossingRecords: synchronizeCrossingRecords(input, crossings, context).map((record) => ({
      ...record,
      structure: 'bridge',
      evidence: 'Site review fixture',
      items: [item(`${record.id}-price`, 100)],
    })),
  }
}

describe('physical stream crossing records', () => {
  it('collapses duplicate vertex intersections but preserves separate passages and reaches', () => {
    const r = road()
    const c: Crossing = { id: 'a', featureId: 'one', name: 'one', kind: 'stream', coordinate: xy(0, 25), chainage: 25 }
    const rows = reconcileCrossingRecords(
      r,
      [
        c,
        { ...c, id: 'duplicate', chainage: 25.001 },
        { ...c, id: 'second-pass', chainage: 80 },
        { ...c, id: 'other-reach', featureId: 'two' },
      ],
      context,
    ).rows
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((entry) => entry.record.id)).size).toBe(3)
  })

  it('keeps stable identities on reload and stales geometry changes without moving user evidence', () => {
    const r = planned()
    const first = analyzeRoad(r, terrain, settings, context).crossingEstimate!
    expect(first.complete).toBe(true)
    expect(first.rows.map((entry) => entry.status)).toEqual(['current', 'current'])
    const renamed = { ...r, name: 'Renamed' }
    expect(analyzeRoad(renamed, terrain, settings, context).crossingEstimate!.complete).toBe(true)
    const changed = { ...r, points: [...r.points.slice(0, 1), { ...r.points[1], coordinate: xy(0, 120) }] }
    const sameCrossings = reconcileCrossingRecords(
      changed,
      analyzeRoad(r, terrain, settings, context).crossings,
      context,
    )
    expect(sameCrossings.rows[0].record.id).toBe(first.rows[0].record.id)
    expect(sameCrossings.rows.every((entry) => entry.status === 'needs-review')).toBe(true)
    expect(sameCrossings.rows[0].record.evidence).toBe('Site review fixture')
    const moved = { ...r, points: r.points.map((p) => ({ ...p, coordinate: offsetCoordinate(p.coordinate, 90, 5) })) }
    const result = analyzeRoad(moved, terrain, settings, context).crossingEstimate!
    expect(result.retired).toHaveLength(2)
    expect(result.rows.every((entry) => entry.status === 'unrecorded')).toBe(true)
    const synced = synchronizeCrossingRecords(moved, analyzeRoad(moved, terrain, settings, context).crossings, context)
    expect(synced).toHaveLength(4)
    expect(synced[0].evidence).toBe('Site review fixture')
  })

  it('stales vertical, section and source geometry edits while preserving quote evidence', () => {
    const r = planned()
    const analysis = analyzeRoad(r, terrain, settings, context)
    for (const changed of [
      { ...r, vertical: [{ id: 'v', chainage: 0, elevation: 802, curveLength: 0 }] },
      { ...r, template: { ...r.template, leftWidth: r.template.leftWidth + 1 } },
    ])
      expect(reconcileCrossingRecords(changed, analysis.crossings, context).rows[0].status).toBe('needs-review')
    const changedContext = [
      { ...context[0], geometry: { type: 'LineString' as const, coordinates: [xy(-40, 25), xy(40, 25)] } },
      context[1],
    ]
    const result = reconcileCrossingRecords(r, analysis.crossings, changedContext)
    expect(result.rows[0].status).toBe('needs-review')
    expect(result.rows[1].status).toBe('current')
    expect(result.rows[0].record.items[0].source).toBe('Synthetic test quote')
    const assessmentChanged = [
      { ...context[0], streamAssessment: { ...EMPTY_STREAM_ASSESSMENT, channelWidthM: 3, fish: 'present' as const } },
      context[1],
    ]
    expect(reconcileCrossingRecords(r, analysis.crossings, assessmentChanged).rows[0].status).toBe('needs-review')
  })
})

describe('entered crossing prices and shared costs', () => {
  it('distinguishes missing rates and quantities from explicit zero, and requires source/date', () => {
    expect(priceCrossingItems([item('unknown', null)])).toMatchObject({ knownSubtotal: 0, complete: false })
    expect(priceCrossingItems([{ ...item('unknown', 100), quantity: null }]).complete).toBe(false)
    expect(priceCrossingItems([item('free', 0)])).toMatchObject({ knownSubtotal: 0, complete: true })
    expect(priceCrossingItems([{ ...item('unsourced', 0), source: '' }]).complete).toBe(false)
    expect(priceCrossingItems([{ ...item('undated', 100), priceDate: '' }])).toMatchObject({
      knownSubtotal: 100,
      complete: false,
    })
  })

  it('adds itemized crossings and shared work once per alternative, with the existing contingency once', () => {
    const original = { ...road(), engineering: createEngineeringDesign() }
    original.engineering.haul.contingencyPercent = 10
    const r = planned(original)
    const baseline = analyzeRoad(original, terrain, settings)
    const result = analyzeRoad(r, terrain, settings, context, { sharedCrossingCosts: [item('mobilization', 50)] })
    expect(result.crossingEstimate).toMatchObject({
      crossingSubtotal: 200,
      sharedSubtotal: 50,
      incrementalSubtotal: 250,
      complete: true,
    })
    expect(result.engineering!.costs.structures - baseline.engineering!.costs.structures).toBe(250)
    expect(result.estimatedCost - baseline.estimatedCost).toBeCloseTo(275, 8)
    const other = analyzeRoad({ ...r, id: 'other-road' }, terrain, settings, context, {
      sharedCrossingCosts: [item('mobilization', 50)],
    })
    expect(other.estimatedCost).toBe(result.estimatedCost)
    const normalized = analyzeFullCostConnector(r, terrain, settings, context, {
      sharedCrossingCosts: [item('mobilization', 50)],
    })
    expect(normalized.engineering!.costs.structures).toBe(result.engineering!.costs.structures)
    expect(normalized.crossingEstimate!.knownSubtotal).toBe(250)
  })

  it('requires explicit linkage and replaces a culvert allowance instead of summing it twice', () => {
    const original = { ...road(), engineering: createEngineeringDesign() }
    original.engineering.culverts = [
      {
        id: 'culvert',
        name: 'Legacy pipe',
        kind: 'stream',
        sourceFeatureId: 'one',
        chainage: 25.5,
        skewDegrees: 0,
        lengthM: 10,
        diameterM: 0.5,
        inletInvertM: 798,
        outletInvertM: 797.9,
        minCoverM: 0.3,
        unitCost: 10,
        fixedCost: 20,
      },
    ]
    const r = planned(original)
    const unlinked = analyzeRoad(r, terrain, settings, context)
    expect(unlinked.crossingEstimate!.complete).toBe(false)
    expect(unlinked.crossingEstimate!.crossingSubtotal).toBe(100)
    r.crossingRecords![0].replacesCulvertId = 'culvert'
    const linked = analyzeRoad(r, terrain, settings, context)
    const legacy = linked.engineering!.culverts[0].installedCost
    expect(linked.crossingEstimate!.replacedLegacyCost).toBe(legacy)
    expect(linked.crossingEstimate!.incrementalSubtotal).toBeCloseTo(200 - legacy, 8)
    expect(linked.engineering!.costs.structures).toBeCloseTo(200, 8)
    r.engineering!.culverts[0].chainage = 40
    const moved = analyzeRoad(r, terrain, settings, context)
    expect(moved.crossingEstimate!.complete).toBe(false)
    expect(moved.crossingEstimate!.replacedLegacyCost).toBe(0)
    expect(moved.crossingEstimate!.crossingSubtotal).toBe(100)
  })

  it('does not double count ambiguous legacy associations and recognizes priced replacements in readiness', () => {
    const original = { ...road(), engineering: createEngineeringDesign() }
    original.engineering.culverts = [
      {
        id: 'one-pipe',
        name: 'Pipe',
        kind: 'stream',
        sourceFeatureId: 'one',
        chainage: 25.5,
        skewDegrees: 0,
        lengthM: 10,
        diameterM: 0.5,
        inletInvertM: 798,
        outletInvertM: 797.9,
        minCoverM: 0.3,
        unitCost: 0,
        fixedCost: 0,
      },
    ]
    const r = planned(original)
    r.crossingRecords![0].replacesCulvertId = 'one-pipe'
    const analysis = analyzeRoad(r, terrain, settings, context)
    const flags = assessCostReadiness(analysis, r, settings).flags.map((f) => f.id)
    expect(flags).not.toContain('unassigned-crossings')
    expect(flags).not.toContain('zero-culvert-rates')
    expect(flags).not.toContain('incomplete-crossing-estimate')
    r.engineering!.culverts.push({ ...r.engineering!.culverts[0], id: 'duplicate-pipe', fixedCost: 250 })
    const ambiguous = analyzeRoad(r, terrain, settings, context)
    expect(ambiguous.crossingEstimate!.complete).toBe(false)
    expect(ambiguous.crossingEstimate!.replacedLegacyCost).toBe(0)
    expect(ambiguous.crossingEstimate!.crossingSubtotal).toBe(100)
    expect(ambiguous.engineering!.costs.structures).toBe(350)
  })

  it('flags possible duplicate drainage allowances without attaching unrelated crossings', () => {
    const analysis = analyzeRoad(planned(), terrain, settings, context)
    const row = analysis.crossingEstimate!.rows[0]
    const near = { chainage: row.chainage, coordinate: row.record.coordinate }
    const far = { chainage: row.chainage + 30, coordinate: xy(0, row.chainage + 30) }
    expect(crossingScreeningOverlapCount(analysis, [near, far], 2)).toBe(1)
    const unpriced = analyzeRoad(road(), terrain, settings, context)
    expect(crossingScreeningOverlapCount(unpriced, [near], 2)).toBe(0)
  })

  it('does not optimize total cost from missing crossing prices, with or without an engineering haul model', () => {
    for (const input of [road(), { ...road(), engineering: createEngineeringDesign() }]) {
      expect(() =>
        optimizeVerticalProfile(input, 100, terrain, settings, {
          context,
          objective: 'total',
          maxDepthM: 1,
          levelStepM: 1,
        }),
      ).toThrow(/Stream crossing estimates/)
      expect(() =>
        optimizeVerticalProfile(input, 100, terrain, settings, {
          context,
          objective: 'earthwork',
          maxDepthM: 1,
          levelStepM: 1,
        }),
      ).not.toThrow()
    }
  })

  it('keeps unpriced crossings out of complete-cost comparisons', () => {
    const r = road()
    const analysis = analyzeFullCostConnector(r, terrain, settings, context)
    expect(alternativeCostStatus(analysis)).toBe('incomplete')
    const result = compareFullCostCandidates(
      [
        {
          id: r.id,
          name: r.name,
          alignment: r,
          analysis,
          entryChainage: analysis.length,
          checks: { adoptable: true, failures: [], unknowns: [] },
        },
      ],
      createTotalCostPlanningDefaults('2026-11-07'),
      () => {
        throw Error('Unpriced crossing must be rejected before network work')
      },
    )
    expect(result.candidates[0].status).toBe('unpriced')
    expect(result.candidates[0].totalCost).toBeNull()
    expect(result.candidates[0].blockers.join(' ')).toContain('Stream crossing')
  })
})

describe('portable crossing plan evidence', () => {
  it('round-trips records, shared items and retired evidence; shared edits stale full-cost records', () => {
    const p = {
      ...createDemoProject(),
      alignments: [planned()],
      activeAlignmentId: 'road',
      context,
      sharedCrossingCosts: [item('shared', 0)],
    }
    const restored = parseProject(serializeProject(p))
    expect(restored.alignments[0].crossingRecords).toEqual(p.alignments[0].crossingRecords)
    expect(restored.sharedCrossingCosts).toEqual(p.sharedCrossingCosts)
    expect(fullCostInputSignature(p.alignments[0], p)).not.toBe(
      fullCostInputSignature(p.alignments[0], { ...p, sharedCrossingCosts: [item('shared', 50)] }),
    )
    const older = createDemoProject()
    expect(parseProject(serializeProject(older)).sharedCrossingCosts).toBeUndefined()
  })

  it('rejects duplicate IDs, invalid rates/dates and unsafe source-link schemes', () => {
    const base = { ...createDemoProject(), sharedCrossingCosts: [item('shared', 1)] }
    for (const change of [
      { unitRate: -1 },
      { unitRate: Infinity },
      { priceDate: '2026-02-30' },
      { sourceUrl: 'javascript:alert(1)' },
    ])
      expect(() =>
        parseProject({ ...base, sharedCrossingCosts: [{ ...base.sharedCrossingCosts[0], ...change }] }),
      ).toThrow()
    expect(() => parseProject({ ...base, sharedCrossingCosts: [item('same', 1), item('same', 2)] })).toThrow(/unique/)
  })

  it('reports per-crossing prices, shared-once accounting, provenance and incomplete status safely', () => {
    const p = {
      ...createDemoProject(),
      alignments: [planned()],
      activeAlignmentId: 'road',
      context,
      sharedCrossingCosts: [item('shared', null)],
    }
    p.alignments[0].crossingRecords![0].evidence = '<script>alert(1)</script>'
    const analysis = analyzeRoad(p.alignments[0], terrain, settings, context, {
      sharedCrossingCosts: p.sharedCrossingCosts,
    })
    const html = crossingReportHtml(p, analysis)
    expect(html).toContain('Incomplete / unpriced')
    expect(html).toContain('once per road estimate')
    expect(html).toContain('Synthetic test quote')
    expect(html).toContain('2026-11-07')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(estimateCrossings(p.alignments[0], analysis, context, p.sharedCrossingCosts).sharedSubtotal).toBe(0)
  })
})
