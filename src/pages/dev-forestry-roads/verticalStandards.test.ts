import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { parseProject, serializeProject } from './project'
import { createDemoProject, DEFAULT_ROAD_SETTINGS } from './terrain'
import { EMPTY_VERTICAL_STANDARDS, curveKind, gradeWindowAt } from './verticalStandards'
import type { Alignment, Coordinate, VerticalPoint } from './types'

const origin: Coordinate = [-122.8, 53.9]
const flat = { elevationAt: () => 800 }
function road(vertical: VerticalPoint[]): Alignment {
  return {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 400), radiusM: 0 },
    ],
    vertical,
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0,
    },
    overrides: [],
  }
}
const pvi = (id: string, chainage: number, elevation: number, curveLength = 0) => ({
  id,
  chainage,
  elevation,
  curveLength,
})
const settings = { ...DEFAULT_ROAD_SETTINGS, maxGradePercent: 50 }

describe('vertical standards', () => {
  it('classifies sag and crest and resolves overlapping grade windows', () => {
    expect(curveKind(-5, 3)).toBe('sag')
    expect(curveKind(5, -3)).toBe('crest')
    const standards = {
      ...EMPTY_VERTICAL_STANDARDS,
      gradeRanges: [
        { id: 'all', start: null, end: null, minGradePercent: -12, maxGradePercent: 10 },
        { id: 'steep', start: 100, end: 200, minGradePercent: null, maxGradePercent: 6 },
      ],
    }
    expect(gradeWindowAt(standards, 50, 400)).toEqual({ low: -12, high: 10 })
    expect(gradeWindowAt(standards, 150, 400)).toEqual({ low: -12, high: 6 })
  })

  it('flags grade windows by run, K by curve type, lengths and unrounded breaks', () => {
    // 0→200 m rises 16 m (8%), 200→400 falls 24 m (−12%): a crest with a 40 m curve, K = 2.
    const a = road([pvi('v0', 0, 800), pvi('v1', 200, 816, 40), pvi('v2', 400, 792)])
    a.verticalStandards = {
      gradeRanges: [{ id: 'g', start: null, end: null, minGradePercent: -10, maxGradePercent: 10 }],
      minSagK: 3,
      minCrestK: 4,
      minCurveLengthM: 60,
      minTangentLengthM: null,
    }
    const result = analyzeRoad(a, flat, settings)
    const messages = result.verticalChecks!.map((c) => c.message)
    expect(messages.some((m) => /^Grade −12\.0% outside −10\.0%…10\.0% for 0\+2\d\d\.\d–0\+400\.0$/.test(m))).toBe(true)
    expect(messages).toContain('K 2.0 below crest minimum 4.0 at 0+200.0 (needs 80 m)')
    expect(messages).toContain('Vertical curve 40 m shorter than 60 m at 0+200.0')
    expect(result.warnings.some((w) => w.includes('vertical standard or control check'))).toBe(true)
    // Each check is also a station flag, so the tables and plan show it.
    expect(result.stations.some((s) => s.flags.includes('K 2.0 below crest minimum 4.0 at 0+200.0 (needs 80 m)'))).toBe(
      true,
    )

    a.vertical[1].curveLength = 0
    const unrounded = analyzeRoad(a, flat, settings).verticalChecks!.map((c) => c.message)
    expect(unrounded.some((m) => m.startsWith('Unrounded crest grade break at 0+200.0'))).toBe(true)
  })

  it('checks short tangents between curves', () => {
    const a = road([pvi('v0', 0, 800), pvi('v1', 150, 810, 60), pvi('v2', 200, 800, 40), pvi('v3', 400, 810)])
    a.verticalStandards = { ...EMPTY_VERTICAL_STANDARDS, minTangentLengthM: 30 }
    const messages = analyzeRoad(a, flat, settings).verticalChecks?.map((c) => c.message) ?? []
    // Curves end at 180 and start at 180: a 0 m tangent between them.
    expect(messages.some((m) => m.startsWith('Tangent 0 m shorter than 30 m'))).toBe(true)
  })

  it('checks control elevations and grades inside their tolerances', () => {
    const a = road([pvi('v0', 0, 800), pvi('v1', 400, 820)])
    a.verticalControls = [
      {
        id: 'ok',
        chainage: 200,
        elevation: 810.1,
        toleranceAboveM: 0,
        toleranceBelowM: 0.2,
        gradePercent: 5,
        gradeTolerancePercent: 0.5,
      },
      {
        id: 'high',
        chainage: 100,
        elevation: 804.5,
        toleranceAboveM: 0.2,
        toleranceBelowM: 0.2,
        gradePercent: null,
        gradeTolerancePercent: 0,
      },
      {
        id: 'grade',
        chainage: 300,
        elevation: null,
        toleranceAboveM: 0,
        toleranceBelowM: 0,
        gradePercent: 2,
        gradeTolerancePercent: 1,
      },
    ]
    const messages = analyzeRoad(a, flat, settings).verticalChecks!.map((c) => c.message)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toBe('Elevation 805.00 is 0.50 m above control 804.50 at 0+100.0 (tolerance +0.20/−0.20 m)')
    expect(messages[1]).toBe('Grade 5.0% misses control 2.0% ±1.0% at 0+300.0')
  })

  it('leaves unset standards and older projects unchecked', () => {
    const a = road([pvi('v0', 0, 800), pvi('v1', 200, 840), pvi('v2', 400, 800)])
    expect(analyzeRoad(a, flat, settings).verticalChecks).toBeUndefined()
    a.verticalStandards = EMPTY_VERTICAL_STANDARDS
    expect(analyzeRoad(a, flat, settings).verticalChecks).toBeUndefined()
  })

  it('round-trips standards and controls through the project file', () => {
    const project = createDemoProject()
    project.alignments[0].verticalStandards = {
      gradeRanges: [{ id: 'g', start: 0, end: 300, minGradePercent: -12, maxGradePercent: 10 }],
      minSagK: 3,
      minCrestK: 3,
      minCurveLengthM: null,
      minTangentLengthM: 20,
    }
    project.alignments[0].verticalControls = [
      {
        id: 'c',
        chainage: 0,
        elevation: 700,
        toleranceAboveM: 0,
        toleranceBelowM: 0.5,
        gradePercent: null,
        gradeTolerancePercent: 0,
      },
    ]
    const restored = parseProject(JSON.parse(serializeProject(project)))
    expect(restored.alignments[0].verticalStandards).toEqual(project.alignments[0].verticalStandards)
    expect(restored.alignments[0].verticalControls).toEqual(project.alignments[0].verticalControls)
    const bad = structuredClone(project)
    bad.alignments[0].verticalStandards!.gradeRanges[0].maxGradePercent = -20
    expect(() => parseProject(bad)).toThrow('maximum cannot be below')
  })
})
