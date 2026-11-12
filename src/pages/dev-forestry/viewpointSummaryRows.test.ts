import { describe, expect, it } from 'vitest'

import type { AlterationBreakdown, AnalysisResult } from './types'
import { assessVia } from './via'
import { runResultMetrics, viewpointSummaryMetrics, type ViewpointSummaryInput } from './viewpointSummaryRows'
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
    expect(row(rows, 'perspective')?.qualifier).toBe('perspective scale')
    expect(row(rows, 'planimetric')?.qualifier).toBe('planimetric scale')
    expect(row(rows, 'via')?.qualifier).toBe('perspective scale')
    // Every percentage-valued row names a scale, a station or a stretch of road next to its label.
    for (const metric of rows.filter((r) => r.value.includes('%') && r.key !== 'slope'))
      expect(metric.qualifier, metric.key).toBeTruthy()
    // 6% is inside PR's perspective range while 12% is past its planimetric one: the scales disagree.
    expect(row(rows, 'perspective')).toMatchObject({ tone: 'default' })
    expect(row(rows, 'perspective')?.note).toMatch(/PR range [\d.]+–7% on this scale/)
    expect(row(rows, 'planimetric')).toMatchObject({ tone: 'warning' })
    expect(row(rows, 'planimetric')?.note).toMatch(/PR range 3–10% on this scale · reads as modification/)
    expect(row(rows, 'planimetric')?.note).toContain('treed area')
  })

  it('withholds numerical figures from a provisional run and says why once, in the status row', () => {
    const result = run({ numericalReady: false })
    const rows = viewpointSummaryMetrics(input({ result }))
    expect(row(rows, 'perspective')).toMatchObject({ value: 'Withheld', tone: 'muted' })
    expect(row(rows, 'planimetric')).toMatchObject({ value: 'Withheld', tone: 'muted' })
    expect(row(rows, 'status')).toMatchObject({ value: 'Provisional', tone: 'warning' })
    expect(row(rows, 'status')?.note).toMatch(/^Terrain tiles are missing\. .*Assessment & report/)
    // The withheld rows point at the status row rather than repeating its explanation.
    expect(rows.filter((r) => r.note.includes('Assessment & report')).map((r) => r.key)).toEqual(['status'])
  })

  it('reads green-up height from the run, and labels whole-road distances', () => {
    const rows = viewpointSummaryMetrics(input())
    expect(row(rows, 'slope')?.value).toBe('31% · 5.5 m')
    expect(row(rows, 'distance')).toMatchObject({
      label: 'Visible distance',
      qualifier: 'whole road',
      value: '0.8 km – 2.4 km',
    })
    expect(row(rows, 'distance')?.note).toContain('foreground to middleground')
  })

  it('says where the objective came from', () => {
    expect(row(viewpointSummaryMetrics(input()), 'objective')).toMatchObject({ qualifier: 'established' })
    expect(row(viewpointSummaryMetrics(input()), 'objective')?.note).toMatch(/Established \(EVQO\)/)
    expect(row(viewpointSummaryMetrics(input({ objectiveSource: 'chosen' })), 'objective')?.note).toMatch(
      /not read from the inventory/,
    )
  })
})

describe('the run results as summary cards', () => {
  const withAreas = (numericalReady = true) => {
    const result = run({ numericalReady }) as unknown as {
      targets: Array<Record<string, unknown>>
      perspectiveAlteration: AlterationBreakdown
      canopyCoverageFraction: number | null
      corridorLengthMeters: number
      demResolutionMeters: number
      demTileCount: number
    }
    Object.assign(result.targets[0], { areaMeters: 400_000, visibleAreaMeters: 250_000, apparentVisiblePercent: 41 })
    result.targets.push({
      targetId: 'lf',
      role: 'landscape',
      areaMeters: 2_000_000,
      visibleAreaMeters: 1_200_000,
      visiblePercent: 60,
      forestedAreaMeters: 1_500_000,
    })
    result.perspectiveAlteration = breakdown(6, 2)
    result.canopyCoverageFraction = null
    result.corridorLengthMeters = 1250
    result.demResolutionMeters = 30
    result.demTileCount = 4
    return result as unknown as AnalysisResult
  }
  const rows = (numericalReady = true) => {
    const { result, block, landform, thresholds } = input({ result: withAreas(numericalReady) })
    return runResultMetrics({ result, block, landform, thresholds })
  }
  const row = (key: string, numericalReady = true) => rows(numericalReady).find((entry) => entry.key === key)

  it("reads the landform's alteration and its parts from the run", () => {
    expect(row('result-alteration')?.value).toBe('8.0%')
    expect(row('result-alteration')?.qualifier).toBe('perspective · the run')
    expect(row('result-split')?.value).toBe('2.0% + 6.0%')
  })

  it('withholds the figures from a provisional run and leaves out their parts', () => {
    expect(row('result-alteration', false)?.value).toBe('Withheld')
    expect(row('result-split', false)).toBeUndefined()
  })

  it('names how much of the block and landform the whole road sees, and the denudation base', () => {
    expect(row('result-block-seen')?.value).toBe('25.0 ha of 40.0 ha')
    expect(row('result-block-seen')?.qualifier).toBe('whole road')
    expect(row('result-landform-seen')?.value).toBe('120.0 ha (60%)')
    expect(row('result-forested')?.value).toBe('150.0 ha (75%)')
    expect(row('result-screening')?.value).toBe('Bare earth')
    expect(row('result-stations')?.value).toBe('2 over 1.25 km')
  })
})
