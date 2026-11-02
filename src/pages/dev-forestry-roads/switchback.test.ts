import { describe, expect, it } from 'vitest'
import { alignmentLength, analyzeRoad, horizontalCurveSummary, offsetCoordinate, positionAt } from './engine'
import { createSwitchbackAlternative, type SwitchbackOptions } from './switchback'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, createDemoProject } from './terrain'
import { parseProject, serializeProject } from './project'
import type { Alignment, Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
function straight(start = origin, heading = 90): Alignment {
  return {
    id: 'original',
    name: 'Existing approach',
    color: '#16817a',
    points: [
      { id: 'start', coordinate: start, radiusM: 0 },
      { id: 'end', coordinate: offsetCoordinate(start, heading, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'v1', chainage: 100, elevation: 805, curveLength: 40 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
}
const options: SwitchbackOptions = {
  id: 'new-switchback',
  direction: 'left',
  radiusM: 20,
  approachM: 30,
  tangentM: 10,
  departureM: 40,
  gradePercent: 3,
  startElevationM: 805,
}

describe('editable switchback alternatives', () => {
  it.each(['left', 'right'] as const)(
    'constructs two full-radius quarter circles turning %s, with exact lengths and spacing',
    (direction) => {
      const input = straight(),
        original = structuredClone(input)
      const result = createSwitchbackAlternative(input, { ...options, direction })
      const curves = horizontalCurveSummary(result.alignment)
      expect(curves).toHaveLength(2)
      for (const curve of curves) {
        expect(curve.radius).toBeCloseTo(20, 8)
        expect(curve.deflectionDegrees).toBeCloseTo(90, 5)
        expect(curve.direction).toBe(direction)
        expect(curve.spiralInLengthM + curve.spiralOutLengthM).toBe(0)
      }
      expect(result.addedLengthM).toBeCloseTo(80 + Math.PI * 20, 5)
      expect(curves[0].start - result.startChainage).toBeCloseTo(30, 5)
      expect(curves[1].start - curves[0].end).toBeCloseTo(10, 5)
      expect(result.endChainage - curves[1].end).toBeCloseTo(40, 5)
      expect(result.legSeparationM).toBe(50)
      expect(result.endElevationM).toBeCloseTo(805 + (80 + Math.PI * 20) * 0.03, 6)
      expect(result.sketch.at(-1)).toEqual([-10, direction === 'left' ? 50 : -50])
      expect(input).toEqual(original)
      // An exact geometric alternative, not a best-fit operation that shrinks the radius.
      const analysis = analyzeRoad(result.alignment, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
      expect(analysis.warnings.some((s) => /sharp|overlap|does not fit/.test(s))).toBe(false)
      expect(analysis.stations.at(-1)?.gradePercent).toBeCloseTo(3, 5)
    },
  )

  it('preserves the entire original plan and formation, including an extrapolated final tangent', () => {
    const input = straight()
    input.vertical[1].chainage = 80
    input.vertical[1].elevation = 804
    const old = analyzeRoad(input, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    const result = createSwitchbackAlternative(input, options)
    const updated = analyzeRoad(result.alignment, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    for (let s = 0; s <= 100; s += 10) {
      expect(positionAt(result.alignment, s).coordinate).toEqual(positionAt(input, s).coordinate)
      const a = old.stations.find((v) => Math.abs(v.chainage - s) < 0.001)!
      const b = updated.stations.find((v) => Math.abs(v.chainage - s) < 0.001)!
      expect(b.designElevation).toBeCloseTo(a.designElevation!, 5)
    }
    expect(result.alignment.vertical.find((v) => v.id === 'v1')?.curveLength).toBe(0)
    expect(result.alignment.vertical.some((v) => Math.abs(v.chainage - 100) < 0.001)).toBe(true)
  })

  it('uses the same metric frame at high latitude across the antimeridian', () => {
    const input = straight([179.999, 80], 90)
    const result = createSwitchbackAlternative(input, { ...options, direction: 'right' })
    expect(result.addedLengthM).toBeCloseTo(80 + Math.PI * 20, 5)
    expect(horizontalCurveSummary(result.alignment).every((c) => Math.abs(c.deflectionDegrees - 90) < 1e-5)).toBe(true)
    expect(result.alignment.points.every((p) => p.coordinate[0] >= -180 && p.coordinate[0] <= 180)).toBe(true)
  })

  it('retains unrelated ranges but clears endpoint and reviewed-cost identities on the new road', () => {
    const input = straight()
    input.networkEntryRoadId = 'previous-end-road'
    input.fsrConnection = {
      targetFeatureId: 'fsr',
      targetName: 'FSR',
      targetCoordinate: input.points[1].coordinate,
      originCoordinate: input.points[0].coordinate,
      originAlignmentId: 'original',
      endpoint: 'end',
      preference: 'nearest',
      networkScope: 'fixture',
      straightLineDistanceM: 100,
      routeLengthM: 100,
      searchCost: 100,
    }
    input.verticalAlternatives = [
      { id: 'profile', name: 'Existing profile', vertical: structuredClone(input.vertical) },
    ]
    input.activeVerticalAlternativeId = 'profile'
    input.verticalAlternativeCostMode = 'shared'
    input.overrides = [
      {
        id: 'turnout',
        name: 'Existing turnout',
        start: 20,
        end: 40,
        taper: 5,
        side: 'left',
        kind: 'turnout',
        extraWidth: 2,
      },
    ]
    const result = createSwitchbackAlternative(input, options)
    expect(result.alignment.networkEntryRoadId).toBeUndefined()
    expect(result.alignment.fsrConnection).toBeUndefined()
    expect(result.alignment.verticalAlternatives).toBeUndefined()
    expect(result.alignment.activeVerticalAlternativeId).toBeUndefined()
    expect(result.alignment.verticalAlternativeCostMode).toBeUndefined()
    expect(result.alignment.overrides).toEqual(input.overrides)
    expect(input.networkEntryRoadId).toBe('previous-end-road')
    expect(input.verticalAlternatives).toHaveLength(1)
  })

  it('round-trips through the normal saved project and reproduces fitted geometry', () => {
    const project = createDemoProject(),
      input = straight()
    const result = createSwitchbackAlternative(input, options)
    project.alignments = [input, result.alignment]
    project.activeAlignmentId = result.alignment.id
    const saved = parseProject(serializeProject(project))
    expect(saved.alignments).toHaveLength(2)
    expect(saved.alignments[0]).toEqual(
      parseProject({ ...project, alignments: [input], activeAlignmentId: input.id }).alignments[0],
    )
    expect(horizontalCurveSummary(saved.alignments[1])).toEqual(horizontalCurveSummary(result.alignment))
    expect(alignmentLength(saved.alignments[1])).toBeCloseTo(result.endChainage, 8)
  })

  it('rejects zero connecting tangent, unsupported inputs, missing profile and stale formation', () => {
    const input = straight()
    for (const patch of [
      { tangentM: 0 },
      { radiusM: 0 },
      { radiusM: NaN },
      { approachM: 0 },
      { gradePercent: Infinity },
      { startElevationM: 804 },
      { id: 'original' },
    ])
      expect(() => createSwitchbackAlternative(input, { ...options, ...patch })).toThrow()
    expect(() => createSwitchbackAlternative({ ...input, vertical: [] }, options)).toThrow(/vertical controls/)
    expect(() =>
      createSwitchbackAlternative(
        { ...input, vertical: [...input.vertical, { id: 'beyond', chainage: 110, elevation: 805, curveLength: 0 }] },
        options,
      ),
    ).toThrow(/beyond the road end/)
  })
})
