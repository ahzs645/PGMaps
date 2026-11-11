import { describe, expect, it } from 'vitest'

import type { AlterationBreakdown, AnalysisResult } from './types'
import { assessVia } from './via'
import { viewpointSummaryMetrics, type ViewpointSummaryInput } from './viewpointSummaryRows'
import { DEFAULT_VISUAL_QUALITY_THRESHOLDS } from './vqo'

const breakdown = (proposedPercent: number, existingPercent = 0): AlterationBreakdown => ({
  proposedPercent,
  disturbancePercent: 0,
  existingPercent,
  cumulativePercent: proposedPercent + existingPercent,
})

/** Two stations along a road and one block seen differently from each. */
function run({ numericalReady = true } = {}): AnalysisResult {
  return {
    settings: { observerHeightMeters: 1.6 },
    stations: [
      { lng: -122, lat: 54, groundElevationMeters: 700, distanceAlongMeters: 0 },
      { lng: -121.99, lat: 54, groundElevationMeters: 712.4, distanceAlongMeters: 1250 },
    ],
    assessmentStationIndex: 0,
    perspectiveAlteration: breakdown(6),
    perspectiveByStation: [breakdown(6), breakdown(2.5, 1)],
    planimetricAlteration: breakdown(12),
    landformForestedAreaMeters: 500_000,
    targets: [
      {
        targetId: 'b1',
        role: 'block',
        nearestVisibleDistanceMeters: 800,
        farthestVisibleDistanceMeters: 2400,
        meanSlopePercent: 31.2,
        vegHeightMeters: 5.5,
        stations: [
          { visiblePercent: 64.4, unknownPercent: 0 },
          { visiblePercent: 20, unknownPercent: 3 },
        ],
      },
    ],
    quality: { numericalReady, warnings: numericalReady ? [] : ['Terrain tiles are missing.'] },
  } as unknown as AnalysisResult
}

function input(patch: Partial<ViewpointSummaryInput> = {}): ViewpointSummaryInput {
  const result = patch.result ?? run()
  return {
    result,
    stationIndex: 0,
    driving: false,
    viewpointName: 'Hwy 97',
    block: { targetId: 'b1', name: 'CHU_26_1' },
    landform: { name: 'Davie ridge', objectiveId: 'partial-retention', vac: null },
    objectiveSource: 'established',
    thresholds: DEFAULT_VISUAL_QUALITY_THRESHOLDS,
    via: assessVia({ objectiveId: 'partial-retention', result, review: null }),
    ...patch,
  }
}
const row = (rows: ReturnType<typeof viewpointSummaryMetrics>, key: string) => rows.find((r) => r.key === key)

describe('viewpoint summary rows', () => {
  it('reads the station it is given, not the assessment station', () => {
    const atAssessment = viewpointSummaryMetrics(input())
    const driving = viewpointSummaryMetrics(input({ stationIndex: 1, driving: true }))
    expect(row(atAssessment, 'in-view')?.value).toBe('64%')
    expect(row(atAssessment, 'perspective')?.value).toBe('6.0%')
    expect(row(driving, 'viewpoint')?.value).toBe('1.25 km along')
    expect(row(driving, 'viewpoint')?.note).toContain('road view station')
    expect(row(driving, 'viewpoint')?.note).toContain('712 m + 1.6 m eye height')
    expect(row(driving, 'perspective')?.value).toBe('3.5%')
    expect(row(driving, 'perspective')?.note).toContain('1.0% already harvested')
  })

  it('says terrain is incomplete rather than reporting a share over missing ground', () => {
    const rows = viewpointSummaryMetrics(input({ stationIndex: 1 }))
    expect(row(rows, 'in-view')).toMatchObject({ value: 'Terrain incomplete', tone: 'warning' })
  })

  it('names the scale of every percentage and judges each against its own range', () => {
    const rows = viewpointSummaryMetrics(input())
    expect(row(rows, 'perspective')?.label).toMatch(/perspective scale/)
    expect(row(rows, 'planimetric')?.label).toMatch(/planimetric scale/)
    expect(row(rows, 'via')?.label).toMatch(/perspective scale/)
    // 6% is inside PR's perspective range while 12% is past its planimetric one: the scales disagree.
    expect(row(rows, 'perspective')).toMatchObject({ tone: 'default' })
    expect(row(rows, 'perspective')?.note).toMatch(/PR range [\d.]+–7% on this scale/)
    expect(row(rows, 'planimetric')).toMatchObject({ tone: 'warning' })
    expect(row(rows, 'planimetric')?.note).toMatch(/PR range 3–10% on this scale · reads as modification/)
    expect(row(rows, 'planimetric')?.note).toContain('treed area')
  })

  it('withholds numerical figures from a provisional run and says why', () => {
    const result = run({ numericalReady: false })
    const rows = viewpointSummaryMetrics(input({ result }))
    expect(row(rows, 'perspective')?.value).toBe('Withheld')
    expect(row(rows, 'planimetric')?.value).toBe('Withheld')
    expect(row(rows, 'status')).toMatchObject({ value: 'Provisional', note: 'Terrain tiles are missing.' })
  })

  it('reads green-up height from the run, and labels whole-road distances', () => {
    const rows = viewpointSummaryMetrics(input())
    expect(row(rows, 'slope')?.value).toBe('31% · 5.5 m')
    expect(row(rows, 'distance')).toMatchObject({
      label: 'Visible ground distance · whole road',
      value: '0.8 km – 2.4 km',
    })
    expect(row(rows, 'distance')?.note).toContain('foreground to middleground')
  })

  it('says where the objective came from', () => {
    expect(row(viewpointSummaryMetrics(input()), 'objective')?.note).toMatch(/Established \(EVQO\)/)
    expect(row(viewpointSummaryMetrics(input({ objectiveSource: 'chosen' })), 'objective')?.note).toMatch(
      /not read from the inventory/,
    )
  })
})
