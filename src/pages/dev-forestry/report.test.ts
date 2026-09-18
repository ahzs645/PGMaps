import { describe, expect, it } from 'vitest'

import { buildReport, type ReportInput } from './report'
import type { AnalysisQuality, AnalysisResult, TargetPolygon } from './types'
import { DEFAULT_VISUAL_QUALITY_THRESHOLDS, type VisualQualityThresholds } from './vqo'

/**
 * The Markdown worksheet is the companion to the stamped FS1252 PDF, so it is
 * written from the saved run only: the active landform the run was bound to,
 * the per-station figures, and the evidence record that decides whether the
 * numerical fields may be shown at all. These tests are about what it refuses
 * to invent as much as what it fills in.
 */

const AT = new Date('2026-09-17T18:30:00Z')

const STATIONS = [
  { lng: -122.6, lat: 53.9, groundElevationMeters: 712, distanceAlongMeters: 0 },
  { lng: -122.55, lat: 53.9, groundElevationMeters: 706, distanceAlongMeters: 2400 },
]

function polygon(id: string, patch: Partial<TargetPolygon> = {}): TargetPolygon {
  return {
    id,
    name: `Polygon ${id}`,
    role: 'block',
    objectiveId: 'partial-retention',
    vac: null,
    harvestYear: null,
    clearcutPercent: null,
    geometry: { type: 'Polygon', coordinates: [] },
    source: 'Drawn here',
    ...patch,
  }
}

function quality(patch: Partial<AnalysisQuality> = {}): AnalysisQuality {
  return {
    terrain: 'complete',
    vegetation: 'complete',
    existingInventory: 'scenario-only',
    greenBasis: 'confirmed-landform',
    unknownSightlines: 0,
    unknownStationCount: 0,
    underResolvedTargetIds: [],
    largestGroundCellPercent: 0.12,
    numericalReady: true,
    warnings: ['Apparent-area integration is a screening approximation.'],
    ...patch,
  }
}

/** Only the fields the worksheet reads. */
function analysis(patch: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    settings: { observerHeightMeters: 1.6, maxViewDistanceMeters: 12_000, greenUpAgeYears: 20 },
    stations: STATIONS,
    corridorLengthMeters: 2400,
    assessmentStationIndex: 1,
    largestVisibleAreaStationIndex: 0,
    activeLandformId: 'land',
    targets: [],
    perspectiveAlteration: { disturbancePercent: 0.5, existingPercent: 1.1, proposedPercent: 6.0, cumulativePercent: 7.6 },
    perspectiveByStation: [
      { disturbancePercent: 0, existingPercent: 0, proposedPercent: 2.4, cumulativePercent: 2.4 },
      { disturbancePercent: 0.5, existingPercent: 1.1, proposedPercent: 6.0, cumulativePercent: 7.6 },
    ],
    planimetricAlteration: { disturbancePercent: 0.2, existingPercent: 0.6, proposedPercent: 3.0, cumulativePercent: 3.8 },
    demResolutionMeters: 11.2,
    inputSnapshot: { assessmentYear: 2026 },
    quality: quality(),
    ...patch,
  } as unknown as AnalysisResult
}

const LANDFORM = polygon('land', { role: 'landscape', name: 'Tabor Mountain', vac: 'medium' })

function report(patch: Partial<ReportInput> = {}): string {
  return buildReport({
    result: analysis(),
    targets: [polygon('a', { name: 'Block A' }), LANDFORM],
    thresholds: DEFAULT_VISUAL_QUALITY_THRESHOLDS,
    viewpointName: 'Highway 16',
    generatedAt: AT,
    ...patch,
  })
}

describe('buildReport', () => {
  it('says what it is, and that the export date is not a field date', () => {
    const text = report()
    expect(text.split('\n')[0]).toBe('# Visual Quality Effectiveness Evaluation — simulation draft')
    expect(text).toContain('FS1252 2008/04. Not a field evaluation')
    expect(text).toContain('Generated: 2026-09-17T18:30:00.000Z. This is not a field-evaluation date.')
    expect(text).toContain('Viewpoint/corridor: Highway 16. Active landform: Tabor Mountain.')
    expect(text).toContain('Assessment year: 2026.')
  })

  it('names the landform the run was bound to, not the first one in the scene', () => {
    const decoy = polygon('decoy', { role: 'landscape', name: 'Some other hill' })
    const text = report({ targets: [decoy, polygon('a'), LANDFORM] })
    expect(text).toContain('Active landform: Tabor Mountain.')
    expect(text).not.toContain('Some other hill')
  })

  it('reports the highest-ratio station and the most-visible station separately', () => {
    const text = report()
    expect(text).toContain('Assessment station: 2 (highest available estimated cumulative perspective ratio).')
    expect(text).toContain('Station with most proposed ground visible: 1.')
  })

  it('tabulates a, b, c, X and the numerical class for every station when the evidence is complete', () => {
    const text = report()
    expect(text).toContain('Numerical form fields: available as modelled scenario estimates.')
    expect(text).toContain('| 1 | -122.600000 | 53.900000 | 712.0 | 2.40 | 0.00 | 0.00 | 2.40 | PR |')
    expect(text).toContain('| 2 | -122.550000 | 53.900000 | 706.0 | 6.00 | 0.50 | 1.10 | 7.60 | M |')
  })

  it('withholds every numerical field when the evidence is incomplete, rather than printing zero', () => {
    const text = report({ result: analysis({ quality: quality({ numericalReady: false, greenBasis: 'unverified-whole-landform' }) }) })
    expect(text).toContain('Numerical form fields: WITHHELD pending missing evidence / resolution checks.')
    expect(text).toContain('| 1 | -122.600000 | 53.900000 | 712.0 | Withheld | Withheld | Withheld | Withheld | Undetermined |')
    expect(text).not.toContain('| 7.60 |')
    expect(text).toContain('The map-area figure is provisional; no within-range verdict is assigned.')
    expect(text).not.toContain('**Within**')
  })

  it('carries the run’s own warnings and evidence status', () => {
    const text = report({
      result: analysis({
        quality: quality({
          terrain: 'partial',
          existingInventory: 'not-requested',
          warnings: ['Some terrain/surface sightlines are unknown.', '3 DEM tiles did not load.'],
        }),
      }),
    })
    expect(text).toContain('Green denominator: confirmed-landform. Existing disturbance: not-requested.')
    expect(text).toContain('Terrain: partial; vegetation inventory: complete.')
    expect(text).toContain('> Some terrain/surface sightlines are unknown.')
    expect(text).toContain('> 3 DEM tiles did not load.')
    expect(text).toContain('Largest landform grid cell: 0.12% of green map area, a resolution diagnostic')
  })

  it('says so when a result carries no quality record at all', () => {
    const text = report({ result: analysis({ quality: undefined }) })
    expect(text).toContain('> No quality record. Rerun the scenario.')
    expect(text).toContain('WITHHELD')
  })

  it('fills the VLI section from the inventory unit and leaves the rest blank', () => {
    const filled = report({
      inventoryUnit: { polygonNumber: 'VLI 1668', vsc: '2', scenicArea: true },
      inventorySource: 'BC visual landscape inventory (DataBC)',
    })
    expect(filled).toContain('VLI polygon: VLI 1668; VSC: 2.')
    expect(filled).toContain('Inventory source: BC visual landscape inventory (DataBC).')
    expect(filled).toContain('Scenario objective: partial-retention; VAC: medium. A selected objective is not proof of legal establishment.')

    const blank = report()
    expect(blank).toContain('VLI polygon: ______; VSC: ______.')
    expect(blank).toContain('Inventory source: Not supplied.')
    expect(blank).toContain('Forest district / licensee / licence / CP / sample code / field date: ______ (not inferred).')
  })

  it('resolves the planimetric allowance the same way the panel does', () => {
    // Medium VAC on partial retention: 1998 Table 4 gives 10%.
    expect(report()).toContain('Scenario map-area alteration: 3.80%. Planning allowance: 10%. 1998 Table 4, medium VAC; timber-supply planning only.')

    // No VAC: the mid-range planning assumption, labelled as one.
    const unrated = report({ targets: [polygon('a'), polygon('land', { role: 'landscape', name: 'Tabor Mountain', vac: null })] })
    expect(unrated).toContain('Planning allowance: 10%. No VAC supplied: Table 4 medium/mid-range planning assumption.')

    // An explicit custom threshold wins, and is labelled as a custom figure.
    const thresholds: VisualQualityThresholds = {
      ...DEFAULT_VISUAL_QUALITY_THRESHOLDS,
      planimetric: { ...DEFAULT_VISUAL_QUALITY_THRESHOLDS.planimetric, 'partial-retention': 12 },
    }
    expect(report({ thresholds })).toContain('Planning allowance: 12%. Explicit custom planning threshold')
  })

  it('has no planimetric figure without an active landform', () => {
    const text = report({ result: analysis({ activeLandformId: null, planimetricAlteration: null }) })
    expect(text).toContain('Active landform: None.')
    expect(text).toContain('No active-landform planimetric result.')
  })

  it('leaves the field half and the partial-cut quantities blank instead of substituting proxies', () => {
    const text = report()
    expect(text).toContain('2.2.3 Basic VQC (ocular): ______. Not inferred from the numerical class.')
    expect(text).toContain('2.2.4 Five design observations: force lines ______; natural character ______; edge treatments ______; distance ______; position ______.')
    expect(text).toContain('actual volume removed ______; actual mean residual-tree height ______; clearcut equivalent ______.')
    expect(text).toContain('PERCENT_CLEARCUT is not volume removed, and green-up height is not residual-tree height. Neither is substituted.')
    expect(text).toContain('2.3.6 Final EE rating: ______. 2.3.7 Override and rationale: ______. Evaluator: ______. Signature: ______.')
  })

  it('keeps the reference sources apart', () => {
    const text = report()
    expect(text).toContain('The 2022 summary has six design elements; this historical FS1252 has five.')
    expect(text).toContain('plan-to-perspective ratios are not applied again')
    expect(text).toContain('No timber volume is inferred from visibility')
  })

  it('escapes pipes in supplied names so the table stays a table', () => {
    const text = report({ viewpointName: 'Road | with pipe' })
    expect(text).toContain('Viewpoint/corridor: Road \\| with pipe.')
  })
})
