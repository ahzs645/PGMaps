import { describe, expect, it } from 'vitest'

import { buildReport, type ReportInput } from './report'
import type { AnalysisResult, StationResult, TargetPolygon, TargetVisibility } from './types'
import { DEFAULT_VISUAL_QUALITY_THRESHOLDS } from './vqo'

const AT = new Date('2026-09-17T18:30:00Z')

/** A short east-running corridor south-west of the proposal. */
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

function stationResults(percents: number[]): StationResult[] {
  return percents.map((visiblePercent, index) => ({ ...STATIONS[index], visiblePercent }))
}

function visibility(targetId: string, patch: Partial<TargetVisibility> = {}): TargetVisibility {
  return {
    targetId,
    role: 'block',
    // One sample, north-east of the corridor and in view.
    positions: Float64Array.from([-122.5, 53.93]),
    anyVisible: Uint8Array.from([1]),
    sampleCount: 1,
    areaMeters: 1_312_000,
    visibleAreaMeters: 430_000,
    visiblePercent: 33,
    apparentVisiblePercent: 34.7,
    nearestVisibleDistanceMeters: 3300,
    meanSlopePercent: 19,
    vegHeightMeters: 4.6,
    forestedAreaMeters: null,
    outOfRange: false,
    recovered: false,
    alterationWeight: 1,
    stations: stationResults([20, 33]),
    ...patch,
  } as unknown as TargetVisibility
}

function analysis(patch: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    settings: { observerHeightMeters: 1.6, maxViewDistanceMeters: 12_000, greenUpAgeYears: 20 },
    stations: STATIONS,
    corridorLengthMeters: 9510,
    assessmentStationIndex: 1,
    targets: [visibility('a')],
    perspectiveAlteration: { existingPercent: 0, proposedPercent: 7.1, cumulativePercent: 7.1 },
    perspectiveByStation: [
      { existingPercent: 0, proposedPercent: 2.4, cumulativePercent: 2.4 },
      { existingPercent: 0, proposedPercent: 7.1, cumulativePercent: 7.1 },
    ],
    planimetricAlteration: { existingPercent: 0, proposedPercent: 3.77, cumulativePercent: 3.77 },
    landformAreaMeters: null,
    landformForestedAreaMeters: null,
    recoveredOpeningCount: 0,
    canopyCoverageFraction: null,
    canopyStandCount: 0,
    demTileCount: 24,
    demResolutionMeters: 11,
    missingTileCount: 0,
    elapsedMs: 5800,
    ...patch,
  } as unknown as AnalysisResult
}

const LANDFORM = polygon('land', { role: 'landscape', name: 'Tabor Mountain', vac: 'medium' })

/** A run with a landform, which is what most of the form needs. */
function withLandform(patch: Partial<AnalysisResult> = {}, landform = LANDFORM): ReportInput {
  return {
    result: analysis({
      targets: [
        visibility('a'),
        // 4,488.9 ha of landform, 3,481.9 ha of it treed — 78%, as Tabor reads.
        visibility('land', {
          role: 'landscape',
          areaMeters: 44_889_000,
          visibleAreaMeters: 21_342_000,
          visiblePercent: 48,
          forestedAreaMeters: 34_819_000,
        }),
      ],
      ...patch,
    }),
    targets: [polygon('a', { name: 'Block A' }), landform],
    thresholds: DEFAULT_VISUAL_QUALITY_THRESHOLDS,
    viewpointName: 'Highway 16',
    generatedAt: AT,
  }
}

function report(patch: Partial<ReportInput> = {}): string {
  return buildReport({
    result: analysis(),
    targets: [polygon('a', { name: 'Block A — west face' })],
    thresholds: DEFAULT_VISUAL_QUALITY_THRESHOLDS,
    viewpointName: 'Highway 16',
    generatedAt: AT,
    ...patch,
  })
}

describe('buildReport', () => {
  it('says which form it is on, and how it differs from a filled one', () => {
    const text = report()
    expect(text.split('\n')[0]).toBe('# Visual Quality Effectiveness Evaluation — desk screening')
    expect(text).toContain('FS1252 (2008/04)')
    // The two things a reader must not miss: the form is post-harvest, and
    // half of it needs a field visit.
    expect(text).toContain('**post-harvest** form')
    expect(text).toContain('The field half cannot be computed')
  })

  it('lays the sections out in the form’s own order and numbering', () => {
    const headings = report(withLandform())
      .split('\n')
      .filter((line) => line.startsWith('## 2.'))
    expect(headings).toEqual([
      '## 2.1.2 Site information (office)',
      '## 2.1.3 VLI information (office)',
      '## 2.2.1 Viewpoint (field)',
      '## 2.2.2 Photography (field)',
      '## 2.2.3 Assess basic VQC (field)',
      '## 2.2.4 Design observations (field)',
      '## 2.3.4 Partial cut alterations',
      '## 2.3.2 Assess initial VQC (office)',
      '## 2.3.3 Assess adjusted VQC (office)',
      '## 2.3.6 EE rating',
      '## 2.3.7 Allowance for over-ride',
    ])
  })

  it('fills the viewpoint from the assessment station', () => {
    const text = report(withLandform())
    expect(text).toContain('| GPS latitude | 53.90000 |')
    expect(text).toContain('| GPS longitude | -122.55000 |')
    expect(text).toContain('706 m ground, eye at +1.6 m')
    expect(text).toContain('station 2 of 2')
    // North-east of the corridor, a few km out.
    expect(text).toMatch(/\| Viewing direction \| \d+° NE \|/)
    expect(text).toMatch(/\| Viewing distance \| \d\.\d\d km \(middleground\) \|/)
  })

  it('aims the viewing direction at what can be seen, not at the centroid', () => {
    const screened = report(
      withLandform({
        targets: [
          visibility('a', { anyVisible: Uint8Array.from([0]), visibleAreaMeters: 0, visiblePercent: 0 }),
          visibility('land', { role: 'landscape' }),
        ],
      }),
    )
    expect(screened).toContain('nothing proposed is in view')
  })

  it('reports every viewpoint on the corridor, as the form asks', () => {
    const text = report(withLandform())
    expect(text).toContain('### Other viewpoints on this corridor')
    // The assessment station is marked, and the one that is within its
    // objective is not bolded as over.
    expect(text).toContain('| **2** (assessment) | 2.40 km | **7.10%** | Modification |')
    expect(text).toContain('| 1 | 0.00 km | 2.40% | Partial retention |')
    expect(text).toContain('repeat the')
    // Choosing which stations are real viewpoints is not a number.
    expect(text).toContain('public viewing opportunity, not a number')
  })

  it('says when a station reads worse than the viewpoint it led with', () => {
    // The assessment station is chosen for block exposure, not for the worst
    // ratio, so it can quietly understate the case. A live Tabor run had the
    // headline at 7.10% while eight stations read higher, one at 10.50%.
    const text = report(
      withLandform({
        perspectiveByStation: [
          { existingPercent: 0, proposedPercent: 10.5, cumulativePercent: 10.5 },
          { existingPercent: 0, proposedPercent: 7.1, cumulativePercent: 7.1 },
        ],
      }),
    )
    expect(text).toContain('1 station reads higher than the assessment viewpoint')
    expect(text).toContain('the headline understates the case')
  })

  it('stays quiet when the assessment viewpoint is the worst', () => {
    expect(report(withLandform())).not.toContain('read higher than the assessment viewpoint')
  })

  it('derives viewpoint importance, and says it is only a floor', () => {
    const text = report(withLandform())
    expect(text).toMatch(/\| Viewpoint importance \| \*\*at least [123]\*\*/)
    expect(text).toContain('at an assumed 80 km/h')
    expect(text).toContain('A floor, not the answer')
    // Levels 4 and 5 are land use, which no terrain model knows.
    expect(text).toContain('rest stop or campsite')
  })

  it('supplies design element 4 and leaves the four judgements blank', () => {
    const text = report(withLandform())
    expect(text).toContain('| 4. Distance between alteration and viewpoint | **Moderate** (> 1 and < 8 km) | **0** |')
    expect(text).toContain('| 1. Response to major lines of force | ______ *(field)* | ______ *(field)* |')
    expect(text).toContain('the one measurement among five judgements')
  })

  it('splits the alteration into the form’s a, b and c', () => {
    const text = report(
      withLandform({
        perspectiveAlteration: { existingPercent: 1.1, proposedPercent: 6.0, cumulativePercent: 7.1 },
      }),
    )
    expect(text).toContain('| a) % of landform altered by recent openings | **6.00%** |')
    expect(text).toContain('| c) % non-veg contribution of old openings | **1.10%** |')
    expect(text).toContain('| **X = (a + b + c)** | **7.10%** |')
    expect(text).toContain('| **Initial VQC** | **M — Modification** |')
    // b is a gap, and the worksheet says so rather than implying zero.
    expect(text).toContain('b) % of landform with site disturbance outside openings | ______ *(office)* — not modelled')
    expect(text).toContain('**(b) is a real gap, not a rounding one.**')
  })

  it('explains that the form’s a and c mean something else before harvest', () => {
    expect(report(withLandform())).toContain('**How the run maps onto (a) and (c).**')
  })

  it('says the objective was exceeded, and by how much', () => {
    const text = report(withLandform())
    // 7.1% against partial retention's 7% perspective maximum.
    expect(text).toContain('**OVER by 0.10%**')
    expect(text).toContain('reads as Modification')
  })

  it('works out how much the adjustment would have to carry, in the form’s own Y', () => {
    const text = report(withLandform())
    expect(text).toContain('X × (1 + 0.14 Y)')
    expect(text).toContain('the adjustment has to carry it')
    // 7% against 7.1% needs Y at or below -0.1.
    expect(text).toMatch(/Y would have to reach −0\.\d/)
  })

  it('warns that the adjustment can overwhelm the measurement', () => {
    // Y = -7 multiplies X by 0.02, which brings any X below 350% inside a 7%
    // objective. That makes the adjustment, not the measurement, the decision —
    // worth saying out loud rather than printing an adjusted number and stopping.
    const text = report(withLandform())
    expect(text).toContain('The adjustment can overwhelm the measurement')
    expect(text).toContain('worth being sceptical of')
  })

  it('still reports a break-even Y for an alteration far over the objective', () => {
    const text = report(
      withLandform({ perspectiveAlteration: { existingPercent: 0, proposedPercent: 60, cumulativePercent: 60 } }),
    )
    expect(text).toMatch(/Y would have to reach −6\.\d/)
  })

  it('refuses to rate effectiveness, because half the input is a field visit', () => {
    const text = report(withLandform())
    expect(text).toContain('Cannot be completed from a desk run')
    expect(text).toContain('not provisionally 3')
    // The five ratings are still printed, so the field half has somewhere to go.
    expect(text).toContain('| 3 | Borderline | One method indicates achievement, one does not |')
  })

  it('refuses to invent a denominator when no landform was drawn', () => {
    const text = report()
    expect(text).toContain('no denominator to divide by')
    expect(text).toContain('No landform was supplied')
    expect(text).not.toContain('**OVER')
  })

  it('keeps the inventory’s established objective apart from its recommendation', () => {
    const text = report({
      ...withLandform(),
      inventoryUnit: { polygonNumber: 'VLI 1668', vsc: '2', scenicArea: true },
      inventorySource: 'BC visual landscape inventory (DataBC)',
    })
    expect(text).toContain('| Polygon No. | VLI 1668 |')
    expect(text).toContain('| VSC | 2 |')
    expect(text).toContain('| Scenic area | Yes |')
    expect(text).toContain('| Established VQO | PR — Partial retention |')
    expect(text).toContain('recommendation is not an established objective')
  })

  it('converts a partial cut through FS1252 Table 4', () => {
    const input = withLandform()
    const text = report({
      ...input,
      targets: [polygon('a', { name: 'Block A', clearcutPercent: 50 }), LANDFORM],
    })
    // 50% removed among 4.6 m residuals reads as 1.8% of a clearcut.
    expect(text).toContain('| Block A | 50% | 4.6 m | 1.8% |')
    expect(text).toContain('belongs on line 2.3.2 (a)')
  })

  it('treats a whole-block clearcut as the heavier reading, and says so', () => {
    const text = report(withLandform())
    expect(text).toContain('No partial cuts in this run')
    expect(text).toContain('which is the heavier')
  })

  it('keeps planimetric denudation out of the form and marked as a proxy', () => {
    const text = report(withLandform())
    const formEnd = text.indexOf('# Supporting figures')
    expect(formEnd).toBeGreaterThan(0)
    expect(text.slice(0, formEnd)).not.toContain('Planimetric')
    expect(text).toContain('10% (1998 procedures, Table 4 — denudation by VAC)')
    // Two documents, two Table 4s: the worksheet says which is which.
    expect(text).toContain('a different table from the FS1252 Table 4')
  })

  it('flags the two scales disagreeing, because only one of them governs', () => {
    expect(report(withLandform())).toContain('The two scales disagree')
    const agreeing = report(
      withLandform({ perspectiveAlteration: { existingPercent: 0, proposedPercent: 2, cumulativePercent: 2 } }),
    )
    expect(agreeing).not.toContain('The two scales disagree')
  })

  it('names the denominator it actually divided by', () => {
    const withInventory = report(
      withLandform({
        targets: [
          visibility('a'),
          visibility('land', { role: 'landscape', areaMeters: 1000, forestedAreaMeters: 780 }),
        ],
      }),
    )
    expect(withInventory).toContain('78% treed, from VRI rank-1 BCLCS level 2')

    const without = report(withLandform({ targets: [visibility('a'), visibility('land', { role: 'landscape' })] }))
    expect(without).toContain('whole landform — no vegetation inventory')
    expect(without).toContain('reads low on a partly bare landform')
  })

  it('says whether timber was modelled, both ways round', () => {
    expect(report()).toContain('Standing timber is **not** modelled')
    const screened = report({ result: analysis({ canopyCoverageFraction: 0.64, canopyStandCount: 332 }) })
    expect(screened).toContain('VRI rank-1 stand height over 64% of the area, 332 stands')
    expect(screened).toContain('no transmission model')
  })

  it('warns when the terrain mosaic had holes in it', () => {
    expect(report()).not.toContain('terrain tiles did not load')
    expect(report({ result: analysis({ missingTileCount: 3 }) })).toContain('3 of 24 terrain tiles did not load')
  })

  it('shows which existing openings counted and which had recovered', () => {
    const text = report({
      result: analysis({
        targets: [
          visibility('a'),
          visibility('old', { role: 'harvested', recovered: true, visiblePercent: 0 }),
          visibility('recent', { role: 'harvested', alterationWeight: 0.4, visiblePercent: 12 }),
        ],
        recoveredOpeningCount: 1,
      }),
      targets: [
        polygon('a'),
        polygon('old', { role: 'harvested', name: 'Opening 1998', harvestYear: 1998 }),
        polygon('recent', { role: 'harvested', name: 'Opening 2019', harvestYear: 2019 }),
      ],
    })
    // Only the one that counts towards (c) gets a row; the recovered one is a
    // tally, because a DataBC lookup routinely returns hundreds of them.
    expect(text).toContain('| Openings found | 2 |')
    expect(text).toContain('| Recovered, past green-up | 1 |')
    expect(text).toContain('| **Counting towards (c)** | **1** |')
    expect(text).toContain('| Opening 2019 | 2019 | 40% of its area | 12% |')
    expect(text).not.toContain('Opening 1998')
  })

  it('does not bury the worksheet under a DataBC lookup', () => {
    // A real run over Prince George returned 754 openings, nearly all of them
    // recovered and out of sight, and put 760 table rows between the reader and
    // the closing notes. Only contributors get rows, and only the worst of those.
    const many = Array.from({ length: 300 }, (_, index) =>
      visibility(`o${index}`, {
        role: 'harvested',
        recovered: index % 3 !== 0,
        visiblePercent: index % 3 === 0 ? 1 + (index % 40) : 0,
        alterationWeight: 1,
      }),
    )
    const text = report({
      result: analysis({ targets: [visibility('a'), ...many], recoveredOpeningCount: 200 }),
      targets: [polygon('a'), ...many.map((_, index) => polygon(`o${index}`, { role: 'harvested' }))],
    })

    expect(text).toContain('| Openings found | 300 |')
    expect(text).toContain('| Recovered, past green-up | 200 |')
    const rows = text.split('\n').filter((line) => line.startsWith('| Polygon o'))
    expect(rows.length).toBeLessThanOrEqual(25)
    expect(text).toMatch(/The 25 largest contributors, of \d+:/)
    // Sorted worst-first, so the row that matters is the one you read: o39 is
    // the most exposed at 1 + (39 % 40) = 40%.
    expect(rows[0]).toContain('| Polygon o39 |')
    expect(rows[0]).toContain('40%')
  })

  it('says so when nothing on the ground still counts', () => {
    const text = report({
      result: analysis({
        targets: [visibility('a'), visibility('old', { role: 'harvested', recovered: true, visiblePercent: 0 })],
        recoveredOpeningCount: 1,
      }),
      targets: [polygon('a'), polygon('old', { role: 'harvested' })],
    })
    expect(text).toContain('line (c) is zero')
  })

  it('says a block is out of range rather than reporting it as unseen', () => {
    expect(report({ result: analysis({ targets: [visibility('a', { outOfRange: true })] }) })).toContain('out of range')
  })

  it('always closes with the limits, including the ones the form names', () => {
    const text = report()
    expect(text).toContain('## What this run does not model')
    expect(text).toContain('FS1252 line 2.3.2 (b), left blank above')
    expect(text).toContain('Forest Planning and Practices Regulation')
    expect(text).toContain('earth curvature')
    // FS1252 wants a calculation per viewpoint; this does one.
    expect(text).toContain('repeat the calculation for each viewpoint')
  })
})
