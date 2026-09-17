import { describe, expect, it } from 'vitest'

import { buildReport, type ReportInput } from './report'
import type { AnalysisResult, TargetPolygon, TargetVisibility } from './types'
import { DEFAULT_VISUAL_QUALITY_THRESHOLDS } from './vqo'

const AT = new Date('2026-09-17T18:30:00Z')

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

function visibility(targetId: string, patch: Partial<TargetVisibility> = {}): TargetVisibility {
  return {
    targetId,
    role: 'block',
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
    stations: [],
    ...patch,
  } as unknown as TargetVisibility
}

function analysis(patch: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    settings: { observerHeightMeters: 1.6, maxViewDistanceMeters: 12_000, greenUpAgeYears: 20 },
    stations: [{ distanceAlongMeters: 0 }, { distanceAlongMeters: 2400 }],
    corridorLengthMeters: 9510,
    assessmentStationIndex: 1,
    targets: [visibility('a')],
    perspectiveAlteration: { existingPercent: 0, proposedPercent: 7.1, cumulativePercent: 7.1 },
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
  it('says what it is not, before anything else', () => {
    const lines = report().split('\n')
    expect(lines[0]).toBe('# Visual quality screening worksheet')
    expect(lines.slice(0, 6).join(' ')).toContain('Not a visual impact assessment')
  })

  it('records what the run was made with, so a figure can be checked', () => {
    const text = report()
    expect(text).toContain('| Generated | 2026-09-17 18:30 UTC |')
    expect(text).toContain('Highway 16 — 9.51 km, 2 stations')
    expect(text).toContain('station 2 of 2, at 2.40 km')
    expect(text).toContain('AWS Terrarium, 11 m posts, 24 tiles')
    expect(text).toContain('1.6 m above the road')
  })

  it('says the objective was exceeded, and by how much', () => {
    const landform = polygon('land', { role: 'landscape', name: 'Tabor Mountain', vac: 'medium' })
    const text = report({
      result: analysis({
        targets: [visibility('a'), visibility('land', { role: 'landscape', forestedAreaMeters: 34_819_000 })],
      }),
      targets: [polygon('a', { name: 'Block A' }), landform],
    })

    // 7.1% against partial retention's 7% perspective maximum.
    expect(text).toContain('**OVER by 0.10%**')
    expect(text).toContain('reads as Modification')
    // And within on the other scale, where VAC medium sets the figure.
    expect(text).toContain('10% (1998 Table 4, VAC medium)')
    expect(text).toContain('**Within**')
  })

  it('flags the two scales disagreeing, because only one of them governs', () => {
    const landform = polygon('land', { role: 'landscape', vac: 'medium' })
    const targets = [polygon('a'), landform]
    const disagreeing = report({
      result: analysis({ targets: [visibility('a'), visibility('land', { role: 'landscape' })] }),
      targets,
    })
    expect(disagreeing).toContain('The two scales disagree')
    expect(disagreeing).toContain('perspective')

    // Both within: no warning.
    const agreeing = report({
      result: analysis({
        targets: [visibility('a'), visibility('land', { role: 'landscape' })],
        perspectiveAlteration: { existingPercent: 0, proposedPercent: 2, cumulativePercent: 2 },
      }),
      targets,
    })
    expect(agreeing).not.toContain('The two scales disagree')
  })

  it('refuses to invent a denominator when no landform was drawn', () => {
    const text = report()
    expect(text).toContain('No landform was supplied')
    expect(text).toContain('not applied against an entire')
    expect(text).not.toContain('**OVER')
  })

  it('names the denominator it actually divided by', () => {
    const landform = polygon('land', { role: 'landscape' })
    const withInventory = report({
      result: analysis({
        targets: [
          visibility('a'),
          visibility('land', { role: 'landscape', areaMeters: 1000, forestedAreaMeters: 780 }),
        ],
      }),
      targets: [polygon('a'), landform],
    })
    expect(withInventory).toContain('78% treed, from VRI rank-1 BCLCS level 2')
    expect(withInventory).toContain('Divided by the landform’s treed area')

    const without = report({
      result: analysis({ targets: [visibility('a'), visibility('land', { role: 'landscape' })] }),
      targets: [polygon('a'), landform],
    })
    expect(without).toContain('whole landform — no vegetation inventory')
    expect(without).toContain('this reads low')
  })

  it('says whether timber was modelled, both ways round', () => {
    expect(report()).toContain('Standing timber is **not** modelled')
    const screened = report({
      result: analysis({ canopyCoverageFraction: 0.64, canopyStandCount: 332 }),
    })
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

    expect(text).toContain('recovered (past 20 yr green-up)')
    expect(text).toContain('40% of its area')
    expect(text).toContain('1 of 2 openings were excluded as recovered')
  })

  it('says a block is out of range rather than reporting it as unseen', () => {
    const text = report({
      result: analysis({ targets: [visibility('a', { outOfRange: true })] }),
    })
    expect(text).toContain('out of range')
  })

  it('always closes with the limits', () => {
    const text = report()
    expect(text).toContain('## What this run does not model')
    expect(text).toContain('Forest Planning and Practices Regulation')
    expect(text).toContain('earth curvature')
  })
})
