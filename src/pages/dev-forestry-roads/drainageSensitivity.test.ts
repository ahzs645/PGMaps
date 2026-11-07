import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MAX_DRAINAGE_COMPARISONS,
  DRAINAGE_ALGORITHM_VERSION,
  parseDrainageComparisons,
  parseDrainageEvidence,
  parseDrainageSettings,
  parsePourPoint,
  type DrainageEvidence,
} from './drainageEvidence'
import {
  compareDrainageRuns,
  createDrainageComparison,
  drainageComparisonId,
  drainageComparisonsExport,
} from './drainageSensitivity'
import { DEFAULT_DRAINAGE_SETTINGS } from './drainageRun'
import { parseProject, serializeProject } from './project'
import { createDemoProject } from './terrain'
import { DrainageSensitivityPanel } from './DrainageSensitivityPanel'

/** An independent 10 m raster: 100 cells = 1 ha; 150 cells = 1.5 ha. */
function evidence(cells = 100): DrainageEvidence {
  return parseDrainageEvidence({
    schema: 'pgmaps-drainage-evidence-v1',
    algorithmVersion: DRAINAGE_ALGORITHM_VERSION,
    geometryScope: 'catchments-and-review-locations',
    alignmentId: 'a',
    fingerprint: `drainage-v1-${cells.toString(16).padStart(16, '0')}`,
    roadFingerprint: 'drainage-road-v1-0000000000000001',
    createdAt: '2026-11-07T07:00:00.000Z',
    settings: { ...DEFAULT_DRAINAGE_SETTINGS, bufferM: cells === 100 ? 50 : 100 },
    pourPoint: { coordinate: [-122, 53], snapRadiusM: 20, surface: 'existing', snapPolicy: 'lowest-elevation' },
    terrain: {
      name: 'Analytical fixture',
      sourceKind: 'demo',
      immutable: true,
      resolutionM: 10,
      verticalReference: 'Synthetic',
    },
    grid: { origin: [0, 200], width: 20, height: 20, cellM: 10 },
    selectedCatchment: {
      requestedCoordinate: [-122, 53],
      snappedCoordinate: [-122, 53],
      snappedDistanceM: 0,
      outletCell: 200,
      surface: 'existing',
      snapPolicy: 'lowest-elevation',
      cells,
      areaHa: cells / 100,
      touchesGridEdge: false,
      touchesNoData: false,
      truncated: false,
    },
    summary: {
      crossings: 1,
      redirected: 0,
      lowPoints: 0,
      pondingAreaM2: 0,
      undersized: 0,
      culverts: 1,
      changedCells: 0,
    },
    warnings: [],
    features: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-122, 53] },
          properties: {
            role: 'culvert-check',
            id: 'c',
            name: 'Crossing',
            chainage: 50,
            existingAreaHa: cells / 100,
            designAreaHa: cells / 200,
          },
        },
      ],
    },
  })
}
describe('drainage sensitivity evidence', () => {
  it('compares the same outlet with independent cell-area and culvert arithmetic', () => {
    const baseline = createDrainageComparison(evidence(), '50 m buffer')
    const candidate = createDrainageComparison(evidence(150), '100 m buffer')
    const comparison = compareDrainageRuns(baseline, candidate)
    expect(comparison.areaDeltaHa).toBeCloseTo(0.5, 12)
    expect(comparison.areaDeltaPercent).toBeCloseTo(50, 12)
    expect(comparison.changedInputs).toEqual(['Upslope buffer'])
    expect(comparison.culverts).toEqual([{ id: 'c', name: 'Crossing', existingDeltaHa: 0.5, designDeltaHa: 0.25 }])
    expect(comparison.cautions).toEqual([])
  })
  it('makes outlet movement and incomplete coverage visible alongside area changes', () => {
    const baseline = createDrainageComparison(evidence(), 'Before')
    const next = evidence(150)
    next.selectedCatchment!.snappedCoordinate = [-121.9999, 53]
    next.selectedCatchment!.snappedDistanceM = 6.7
    next.selectedCatchment!.touchesGridEdge = true
    next.selectedCatchment!.truncated = true
    next.pourPoint!.snapPolicy = 'max-accumulation'
    next.selectedCatchment!.snapPolicy = 'max-accumulation'
    const comparison = compareDrainageRuns(baseline, createDrainageComparison(next, 'Changed snap'))
    expect(comparison.areaDeltaHa).toBeCloseTo(0.5)
    expect(comparison.outletMovedM).toBeGreaterThan(6)
    expect(comparison.changedInputs).toContain('Snap policy')
    expect(comparison.cautions.join(' ')).toMatch(/outlet moved/)
    expect(comparison.cautions.join(' ')).toMatch(/incomplete/)
  })
  it('identifies changed terrain samples even when the source name and nominal resolution match', () => {
    const before = evidence()
    const after = evidence(150)
    before.terrain.fingerprint = 'drainage-terrain-v1-0000000000000001'
    after.terrain.fingerprint = 'drainage-terrain-v1-0000000000000002'
    const comparison = compareDrainageRuns(
      createDrainageComparison(before, 'Old grid'),
      createDrainageComparison(after, 'Revised grid'),
    )
    expect(comparison.changedInputs).toContain('Terrain source or resolution')
  })
  it('withholds selected-outlet sensitivity for a different location and all area deltas for a different road', () => {
    const baseline = createDrainageComparison(evidence(), 'Baseline')
    const candidate = createDrainageComparison(evidence(150), 'Other')
    candidate.selectedCatchment!.requestedCoordinate = [-122.01, 53]
    candidate.pourPoint!.coordinate = [-122.01, 53]
    expect(compareDrainageRuns(baseline, candidate).areaDeltaHa).toBeNull()
    candidate.selectedCatchment!.requestedCoordinate = [-122, 53]
    candidate.pourPoint!.coordinate = [-122, 53]
    candidate.roadFingerprint = 'drainage-road-v1-0000000000000002'
    const comparison = compareDrainageRuns(baseline, candidate)
    expect(comparison.areaDeltaHa).toBeNull()
    expect(comparison.areaDeltaPercent).toBeNull()
    expect(comparison.culverts).toEqual([])
    expect(comparison.changedInputs).toContain('Road geometry or road settings')
  })
  it('withholds deltas across calculation versions and requires a current run before pinning', () => {
    const baseline = createDrainageComparison(evidence(), 'Current')
    const candidate = structuredClone(baseline)
    delete candidate.algorithmVersion
    const comparison = compareDrainageRuns(baseline, candidate)
    expect(comparison.sameCalculation).toBe(false)
    expect(comparison.changedInputs).toContain('Calculation version')
    expect(comparison.areaDeltaHa).toBeNull()
    expect(comparison.culverts).toEqual([])
    expect(comparison.cautions.join(' ')).toMatch(/versions differ or are unknown/)
    const older = evidence()
    delete older.algorithmVersion
    expect(() => createDrainageComparison(older, 'Older')).toThrow(/Re-run/)
  })
  it('tracks requested-point changes independently of whether the outlet resolves', () => {
    const baseline = createDrainageComparison(evidence(), 'Unresolved baseline')
    delete baseline.selectedCatchment
    baseline.warnings = ['Pour point is outside the sampled grid.']
    const candidate = structuredClone(baseline)
    candidate.pourPoint!.coordinate = [-122.01, 53]
    let comparison = compareDrainageRuns(baseline, candidate)
    expect(comparison.changedInputs).toContain('Requested outlet')
    expect(comparison.areaDeltaHa).toBeNull()
    expect(comparison.cautions.join(' ')).toMatch(/not resolved/)

    candidate.pourPoint!.coordinate = [...baseline.pourPoint!.coordinate]
    candidate.selectedCatchment = evidence().selectedCatchment
    comparison = compareDrainageRuns(baseline, candidate)
    expect(comparison.changedInputs).not.toContain('Requested outlet')
    expect(comparison.sameRequestedPoint).toBe(true)
    expect(comparison.areaDeltaHa).toBeNull()
    expect(comparison.cautions.join(' ')).toMatch(/not resolved/)

    delete baseline.pourPoint
    delete candidate.selectedCatchment
    comparison = compareDrainageRuns(baseline, candidate)
    expect(comparison.changedInputs).toContain('Requested outlet')
    expect(comparison.sameRequestedPoint).toBe(false)
  })
  it('retains unresolved outlet requests and their saved warnings in the comparison view', () => {
    const record = createDrainageComparison(evidence(), 'Missing terrain')
    delete record.selectedCatchment
    record.warnings = ['The requested outlet is outside supported terrain.']
    const html = renderToStaticMarkup(
      createElement(DrainageSensitivityPanel, {
        records: [record],
        totalRecords: 1,
        stale: false,
        busy: false,
        onSave: () => {},
        onRemove: () => {},
        onExport: () => {},
      }),
    )
    expect(html).toContain('Outlet not resolved')
    expect(html).toContain('Requested -122, 53; no resolved outlet.')
    expect(html).toContain('The requested outlet is outside supported terrain.')
    expect(html).toContain('Saved run warnings')
  })
  it('retains comparisons through project JSON and exports them explicitly as historical', () => {
    const baseline = createDrainageComparison(evidence(), 'Baseline')
    const candidate = createDrainageComparison(evidence(150), 'Larger buffer')
    const project = createDemoProject()
    project.drainage = { settings: DEFAULT_DRAINAGE_SETTINGS, records: [], comparisons: [baseline, candidate] }
    expect(parseProject(serializeProject(project)).drainage?.comparisons).toEqual([baseline, candidate])
    const exported = drainageComparisonsExport([baseline, candidate], drainageComparisonId(baseline))
    expect(exported.status).toBe('historical-comparison')
    expect(exported.runs[1].comparison.areaDeltaPercent).toBe(50)
    expect(JSON.stringify(exported)).not.toMatch(/"features"|"directions"|"accumulation"|"values"/)
    expect(() => drainageComparisonsExport([baseline], 'missing')).toThrow(/baseline/)
  })
  it('rejects oversized, duplicate, nonfinite or physically inconsistent snapshots', () => {
    const baseline = createDrainageComparison(evidence(), 'Baseline')
    expect(() => parseDrainageComparisons(Array(MAX_DRAINAGE_COMPARISONS + 1).fill(baseline))).toThrow(/at most/)
    expect(() => parseDrainageComparisons([baseline, baseline])).toThrow(/already saved/)
    const invalid = structuredClone(baseline)
    invalid.selectedCatchment!.areaHa = 2
    expect(() => parseDrainageComparisons([invalid])).toThrow(/does not match/)
    invalid.selectedCatchment!.areaHa = Infinity
    expect(() => parseDrainageComparisons([invalid])).toThrow(/Catchment area/)
    invalid.selectedCatchment!.areaHa = 1
    invalid.selectedCatchment!.outletCell = 400
    expect(() => parseDrainageComparisons([invalid])).toThrow(/outlet cell/)
  })
  it('keeps legacy omission intact and rejects unknown policies rather than silently routing differently', () => {
    const legacy = { rainfallMmPerHr: 50, runoffCoefficient: 0.35, manningN: 0.024, streamThresholdHa: 1, bufferM: 250 }
    expect(parseDrainageSettings(legacy)).toEqual(legacy)
    const point = { coordinate: [-122, 53], snapRadiusM: 10, surface: 'design' }
    expect(parsePourPoint(point)).toEqual(point)
    expect(() => parseDrainageSettings({ ...legacy, depressionPolicy: { mode: 'invented' } })).toThrow()
    expect(() =>
      parseDrainageSettings({ ...legacy, depressionPolicy: { mode: 'depth-limited', maxDepthM: -1 } }),
    ).toThrow()
    expect(() => parseDrainageSettings({ ...legacy, workingResolutionM: NaN })).toThrow()
    expect(() => parsePourPoint({ ...point, snapPolicy: 'nearest-lowest-maybe' })).toThrow()
  })
})
