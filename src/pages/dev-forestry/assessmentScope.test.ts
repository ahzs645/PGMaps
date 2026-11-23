import { describe, expect, it } from 'vitest'

import { assessmentScope, scopeProvenance, scopeRows, type ScopeInput } from './assessmentScope'
import type { BadgeUnit } from './inventoryBadge'
import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisResult, type AssessmentMask, type TargetPolygon } from './types'
import { parseViaReview } from './via'
import { polygonAreaMeters } from './visibility'

// Made-up geometry near a made-up place; nothing here is from a real assessment.
const box = (lng: number, lat: number, w: number, h = w): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, lat],
      [lng + w, lat],
      [lng + w, lat + h],
      [lng, lat + h],
      [lng, lat],
    ],
  ],
})
const ha = (g: GeoJSON.Polygon) => polygonAreaMeters(g) / 10_000

const target = (patch: Partial<TargetPolygon> & Pick<TargetPolygon, 'id' | 'role' | 'geometry'>): TargetPolygon => ({
  name: patch.id,
  objectiveId: 'partial-retention',
  vac: null,
  harvestYear: null,
  clearcutPercent: null,
  source: 'Drawn here',
  ...patch,
})

const LANDFORM = box(-122, 54, 0.04)
const BLOCK = box(-121.99, 54.01, 0.01)
const WTP = box(-121.985, 54.015, 0.002)
const landform = target({ id: 'lf', role: 'landscape', geometry: LANDFORM, name: 'Test face' })
const block = target({ id: 'b1', role: 'block', geometry: BLOCK, name: 'Block T1' })
const wtp: AssessmentMask = {
  id: 'm1',
  name: 'Wildlife tree patch 1',
  kind: 'retained',
  geometry: WTP,
  source: 'Drawn on the plan map',
}

const base = (patch: Partial<ScopeInput> = {}): ScopeInput => ({
  targets: [landform, block],
  masks: [],
  settings: { ...DEFAULT_ANALYSIS_SETTINGS },
  landformId: 'lf',
  ...patch,
})

describe('the assessment scope', () => {
  it('reads gross and net block geometry, net of a wildlife tree patch, with the mask’s source', () => {
    const scope = assessmentScope(base({ masks: [wtp] }))
    const [b] = scope.blocks
    expect(b.grossHa).toBeCloseTo(ha(BLOCK), 6)
    expect(b.netHa).toBeCloseTo(ha(BLOCK) - ha(WTP), 2)
    expect(b.clearedHa).toBeCloseTo(b.netHa, 6)
    expect(b.deductions.map((d) => [d.name, d.kindLabel])).toEqual([
      ['Wildlife tree patch 1', 'Wildlife tree patch / retention'],
    ])
    expect(scope.masks[0].provenance.origin).toBe('drawn')
    // A retained patch keeps its ground in both denominators and adds no alteration.
    expect(scope.masks[0].effect).toEqual({ planimetric: 'in', perspective: 'in', alteration: 'none' })
    expect(scope.statement).toMatch(/1 block, [\d.]+ ha gross, [\d.]+ ha net of 1 mask/)
  })

  it('takes overlapping masks once in the net footprint', () => {
    const twin = { ...wtp, id: 'm2', name: 'Wildlife tree patch 2' }
    const scope = assessmentScope(base({ masks: [wtp, twin] }))
    expect(scope.blocks[0].netHa).toBeCloseTo(ha(BLOCK) - ha(WTP), 2)
    expect(scope.blocks[0].deductions).toHaveLength(2)
  })

  it('counts a partial cut by Table 6, never as cleared ground', () => {
    const partial = { ...block, harvestSystem: 'partial' as const, volumeRemovedPercent: 30 }
    const scope = assessmentScope(base({ targets: [landform, partial] }))
    expect(scope.blocks[0].clearedHa).toBe(0)
    expect(scope.blocks[0].netHa).toBeCloseTo(ha(BLOCK), 6)
    expect(scope.blocks[0].treatment).toMatch(/Partial cut \(30% of volume removed\): not cleared ground; .*Table 6/)
    expect(scope.statement).toMatch(/1 partial cut counted by Table 6/)
  })

  it('names private land in or out of the denominators as the run’s setting has it', () => {
    const parcel: AssessmentMask = {
      id: 'p1',
      name: 'Private land, PID 000-000-001',
      kind: 'private',
      geometry: box(-121.97, 54.03, 0.005),
      source: 'ParcelMap BC parcel fabric (DataBC WFS), parcel 1; added by the reviewer',
    }
    const kept = assessmentScope(base({ masks: [parcel] }))
    expect(kept.masks[0].provenance.origin).toBe('inventory')
    expect(kept.masks[0].effect.planimetric).toBe('in')
    expect(kept.statement).toMatch(/private land in the denominators/)
    expect(kept.denominators.planimetric.excluded.join()).not.toMatch(/private/)

    const settings = { ...DEFAULT_ANALYSIS_SETTINGS, privateLandOutOfDenominator: true }
    const out = assessmentScope(base({ masks: [parcel], settings }))
    expect(out.masks[0].effect).toEqual({ planimetric: 'out', perspective: 'out', alteration: 'none' })
    expect(out.statement).toMatch(/private land out of the denominators/)
    expect(out.denominators.perspective.excluded.join()).toMatch(/1 private land mask/)

    // The run's own settings win over the scene's when the run is this landform's.
    const run = {
      settings,
      landformForestedAreaMeters: 1_234_000,
      landformAreaMeters: polygonAreaMeters(LANDFORM),
      quality: { greenBasis: 'inventory-and-openings' } as AnalysisResult['quality'],
      targets: [],
      activeLandformId: 'lf',
    }
    const read = assessmentScope(base({ masks: [parcel], result: run }))
    expect(read.fromRun).toBe(true)
    expect(read.privateLandOut).toBe(true)
    expect(read.denominators.planimetric.areaHa).toBeCloseTo(123.4, 6)
    expect(read.statement).toMatch(/planimetric over 123\.4 ha treed/)
    // Another landform's run is not this scope's.
    expect(assessmentScope(base({ result: { ...run, activeLandformId: 'other' } })).fromRun).toBe(false)
  })

  it('names every inventory unit a joined landform spans, and only suggests what it is', () => {
    const units: BadgeUnit[] = [
      { id: 'u1', polygonNumber: '901', objectiveId: null, vac: null, vsc: null, geometry: box(-122, 54, 0.025, 0.04) },
      {
        id: 'u2',
        polygonNumber: '902',
        objectiveId: null,
        vac: null,
        vsc: null,
        geometry: box(-121.975, 54, 0.015, 0.04),
      },
    ]
    const scope = assessmentScope(base({ inventoryUnits: units }))
    expect(scope.landform?.units?.map((u) => u.label)).toEqual(['901', '902'])
    expect(scope.landform?.units?.[0].sharePercent).toBeGreaterThan(55)
    expect(scope.landform?.suggestedExtent).toBe('several-units')
    expect(scope.landform?.reviewedAs).toBeNull()
    expect(scope.statement).toMatch(/VLI 901 \(\d+%\) and 902 \(\d+%\)/)
    // The reviewer's statement and note come from the review record, as parsed.
    const review = parseViaReview({
      landformRecords: { 'Test face': { reviewedAs: 'several-units', scopeNote: 'Both units, joined at the draw.' } },
    })
    const reviewed = assessmentScope(base({ inventoryUnits: units, review }))
    expect(reviewed.landform?.reviewedAs).toBe('several-units')
    expect(reviewed.statement).toMatch(/reviewed as parts of several inventory units, joined/)
    const rows = scopeRows(reviewed)
    expect(rows.find((r) => r.label === 'Scope note')).toEqual({
      label: 'Scope note',
      value: 'Both units, joined at the draw.',
      source: 'reviewer',
    })
    // An unknown statement is dropped on reading, never guessed.
    expect(parseViaReview({ landformRecords: { X: { reviewedAs: 'all' } } })?.landformRecords).toBeUndefined()
  })

  it('leaves the reviewer’s statement blank when not given, and says when the inventory was not read', () => {
    const rows = scopeRows(assessmentScope(base()))
    expect(rows.find((r) => r.label === 'Reviewed as')?.value).toBeNull()
    expect(rows.find((r) => r.label === 'Inventory units under it')?.value).toBe('Inventory not read')
    expect(rows.find((r) => r.label === 'Planimetric denominator')?.value).toMatch(/once it is run/)
  })

  it('keeps a mask traced on another landform out of this scope', () => {
    const scoped = { ...wtp, kind: 'natural' as const, landformId: 'elsewhere' }
    const scope = assessmentScope(base({ masks: [scoped] }))
    expect(scope.masks).toEqual([])
    expect(scope.otherLandformMasks).toBe(1)
    expect(scope.blocks[0].netHa).toBeCloseTo(ha(BLOCK), 6)
  })

  it('reads where a shape came from', () => {
    expect(scopeProvenance({ source: 'BC visual landscape inventory', inventoryUnitId: '1' }).origin).toBe('inventory')
    expect(
      scopeProvenance({ source: 'Visible face from the road (one station); review against the view' }).origin,
    ).toBe('candidate')
    expect(scopeProvenance({ source: 'Ridge layer seen from the road; review against the view' }).origin).toBe(
      'candidate',
    )
    expect(scopeProvenance({ source: 'blocks.kml' }).origin).toBe('imported')
    expect(scopeProvenance({ source: 'Drawn here' }).origin).toBe('drawn')
    expect(scopeProvenance({ source: 'RESULTS forest cover reserve (DataBC WFS), group reserve 7' }).origin).toBe(
      'inventory',
    )
    expect(scopeProvenance({ source: '' })).toMatchObject({ origin: 'recorded', detail: 'Not recorded' })
  })
})
