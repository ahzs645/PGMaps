import { describe, expect, it } from 'vitest'

import type { ToolRun } from './assessmentTools'
import { lookupQueryBounds } from './bcVisualInventory'
import { runExistingBasis } from './existingBasis'
import { buildReport } from './report'
import { createEmptyScene } from './scene'
import { runLines } from './toolEvidence'
import type { AlterationBreakdown, AnalysisQuality, AnalysisResult, TargetPolygon } from './types'
import { assessVia } from './via'
import { viewpointSummaryMetrics } from './viewpointSummaryRows'
import { buildExportContext, exportContents, type ContextInput } from './visualsExports'
import { narrativeInputFromScene, visualsNarrative } from './visualsNarrative'
import { DEFAULT_VISUAL_QUALITY_THRESHOLDS } from './vqo'

const breakdown = (cumulativePercent: number): AlterationBreakdown => ({
  existingPercent: 1,
  disturbancePercent: 0,
  proposedPercent: cumulativePercent - 1,
  cumulativePercent,
})

const READ = {
  status: 'complete' as const,
  bounds: [-123, 54, -122, 55] as [number, number, number, number],
  retrievedAt: '2026-11-12T18:00:00.000Z',
  source: 'BC consolidated cutblocks',
}

function run(quality: Partial<AnalysisQuality>, harvestInventory = READ): AnalysisResult {
  return {
    settings: { observerHeightMeters: 1.6, screeningEnabled: false },
    stations: [{ lng: -122.725, lat: 54.503, groundElevationMeters: 600, distanceAlongMeters: 0 }],
    assessmentStationIndex: 0,
    activeLandformId: 'lf',
    targets: [],
    perspectiveAlteration: breakdown(5),
    perspectiveByStation: [breakdown(5)],
    planimetricAlteration: breakdown(3),
    landformForestedAreaMeters: 100_000,
    demResolutionMeters: 25,
    inputSnapshot: { assessmentYear: 2026, harvestInventory },
    quality: {
      terrain: 'complete',
      vegetation: 'complete',
      existingInventory: 'complete',
      existingAssumed: false,
      greenBasis: 'confirmed-landform',
      unknownSightlines: 0,
      unknownStationCount: 0,
      underResolvedTargetIds: [],
      largestGroundCellPercent: 0.1,
      numericalReady: true,
      warnings: [],
      gaps: [],
      ...quality,
    },
  } as unknown as AnalysisResult
}

const SOURCE = 'DataBC openings (BC consolidated cutblocks), complete over the landform, read 12 Nov 2026'

describe('runExistingBasis', () => {
  it('names a complete read with its date, and keeps it when the reviewer also ticks the assumption', () => {
    expect(runExistingBasis(run({}))).toEqual({
      inventory: 'complete',
      assumed: false,
      sourceConfirmed: true,
      label: SOURCE,
    })
    const both = runExistingBasis(run({ existingAssumed: true }))!
    expect(both.sourceConfirmed).toBe(true)
    expect(both.label).toBe(`${SOURCE}; the reviewer also confirmed the included features`)
  })

  it('names the assumption, and the read under it, when the source does not cover the landform', () => {
    const assumed = runExistingBasis(run({ existingInventory: 'partial', existingAssumed: true }))!
    expect(assumed.sourceConfirmed).toBe(false)
    expect(assumed.label).toMatch(/^Reviewer assumption: the included features are all the existing disturbance/)
    // A ready figure: never called diagnostic beside X, which `DIAGNOSTIC_LABEL` marks a withheld figure by.
    expect(assumed.label).not.toContain('diagnostic')
    expect(assumed.label).toContain('not confirmed by a complete inventory read')
    expect(assumed.label).toContain('partial: the read does not cover the whole landform')
    expect(runExistingBasis(run({ existingInventory: 'not-requested' }))!.label).toBe(
      'Not confirmed: DataBC openings (BC consolidated cutblocks), not looked up',
    )
  })

  it('gives a read date only for a read that came back', () => {
    for (const inventory of ['unavailable', 'not-requested'] as const)
      expect(runExistingBasis(run({ existingInventory: inventory }))!.label, inventory).not.toContain('read 12 Nov')
    expect(runExistingBasis(run({ existingInventory: 'unavailable' }))!.label).toBe(
      'Not confirmed: DataBC openings (BC consolidated cutblocks), could not be read',
    )
    expect(runExistingBasis(run({ existingInventory: 'partial' }))!.label).toContain(', read 12 Nov 2026')
  })

  it('reads a run saved before the two were apart as an assumption with its coverage not recorded', () => {
    const old = runExistingBasis(run({ existingInventory: 'scenario-only', existingAssumed: undefined }))!
    expect(old.assumed).toBe(true)
    expect(old.sourceConfirmed).toBe(false)
    expect(old.label).toContain('coverage not recorded')
  })
})

describe('every output prints the basis beside X', () => {
  const assumed = run({ existingInventory: 'partial', existingAssumed: true })
  const label = runExistingBasis(assumed)!.label
  const landform: TargetPolygon = {
    id: 'lf',
    name: 'Face',
    role: 'landscape',
    objectiveId: 'modification',
    vac: null,
    harvestYear: null,
    clearcutPercent: null,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-122.75, 54.45],
          [-122.6, 54.45],
          [-122.6, 54.55],
          [-122.75, 54.55],
          [-122.75, 54.45],
        ],
      ],
    },
    source: 'test',
  }

  it('the FS1252 worksheet', () => {
    const text = buildReport({
      result: assumed,
      targets: [landform],
      thresholds: DEFAULT_VISUAL_QUALITY_THRESHOLDS,
      viewpointName: 'Hwy 16',
      generatedAt: new Date('2026-11-20T00:00:00Z'),
    })
    expect(text).toContain(`Existing disturbance: ${label}.`)
  })

  it('the evidence package', () => {
    const lines = runLines({
      scene: createEmptyScene(),
      summary: {
        ...assumed,
        blockAreaHa: 1,
        visibleHa: 1,
        numericalClass: null,
        via: assessVia({ objectiveId: 'modification', result: assumed, review: null }),
      },
      error: null,
      generatedAt: '2026-11-20',
    } as unknown as ToolRun)
    expect(lines.join('\n')).toContain(`existing disturbance ${label}`)
  })

  it('Save & export’s Run part', () => {
    const scene = createEmptyScene()
    const ctx = buildExportContext({
      scene,
      result: assumed,
      stale: false,
      assessment: null,
      views: [],
      fs1252: { selected: [], reviews: {} },
      blockNote: null,
      noteFigures: false,
      figure: { viewId: null, style: '', labelStyle: '', cameraInfo: false, paintBlocks: false },
      document: null,
      report: null,
      logo: '',
      renderer: { id: 'pgmaps' },
      brief: { blockId: null, viewpoints: 0 },
      evidence: { loaded: false, gaps: [], counts: { views: 0, runs: 0, fields: 0 } },
      roadViewReady: false,
      officeFieldCount: 0,
      autoRun: 'off',
      landChecks: null,
    } as unknown as ContextInput)
    const part = exportContents('fs1252', ctx).find((section) => section.title === 'Run')
    expect(part?.rows?.find((row) => row.label === 'Existing disturbance')?.value).toBe(label)
  })

  it('the Viewpoint summary', () => {
    const rows = viewpointSummaryMetrics({
      result: assumed,
      stationIndex: 0,
      driving: false,
      viewpointName: 'Hwy 16',
      block: null,
      landform,
      objectiveSource: 'chosen',
      thresholds: DEFAULT_VISUAL_QUALITY_THRESHOLDS,
      via: null,
    })
    expect(rows.find((row) => row.key === 'existing')).toMatchObject({ value: 'Assumed', note: label })
  })

  it('the Visuals paragraph’s basis', () => {
    const block: TargetPolygon = {
      ...landform,
      id: 'b1',
      name: 'B1',
      role: 'block',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.7, 54.5],
            [-122.69, 54.5],
            [-122.69, 54.506],
            [-122.7, 54.506],
            [-122.7, 54.5],
          ],
        ],
      },
    }
    const input = narrativeInputFromScene({
      block,
      targets: [block, landform],
      result: assumed,
      viewpoint: { name: 'Hwy 16', mode: 'corridor' },
      units: [{ code: 'M', geometry: landform.geometry }],
      landform,
    })
    expect(input.alteration?.existing).toBe(label)
    const sentence = visualsNarrative(input).sentences.find((entry) => entry.id === 'desktop-review')
    expect(sentence?.basis).toContain(`Existing disturbance: ${label}.`)
  })
})

describe('lookupQueryBounds', () => {
  it('reads the view and the landform together', () => {
    expect(lookupQueryBounds([-122.7, 54.4, -122.5, 54.5], [-122.8, 54.45, -122.6, 54.6])).toEqual([
      -122.8, 54.4, -122.5, 54.6,
    ])
  })

  it('keeps the whole landform when the two are too far apart to read at once', () => {
    const [west, south, east, north] = lookupQueryBounds([-125, 54, -124.9, 54.1], [-122.8, 54.45, -122.6, 54.6])
    expect(east - west).toBeCloseTo(1.5, 10)
    expect(west).toBeLessThanOrEqual(-122.8)
    expect(east).toBeGreaterThanOrEqual(-122.6)
    expect(south).toBe(54)
    expect(north).toBe(54.6)
  })

  it('reads the view alone with no landform', () => {
    expect(lookupQueryBounds([-122.7, 54.4, -122.5, 54.5], null)).toEqual([-122.7, 54.4, -122.5, 54.5])
  })
})
