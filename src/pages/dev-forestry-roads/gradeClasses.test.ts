import { describe, expect, it } from 'vitest'
import { GRADE_CLASS_COLORS, gradeClassOf, gradeClassRoadLines, gradeClasses } from './gradeClasses'
import { DEFAULT_DESIGN_STANDARDS, gradeRule, reviewGrades, type GradeSpan } from './designStandards'

describe('grade classes from the grade limit', () => {
  it('break at half, three quarters and the limit, labelled in percent', () => {
    expect(gradeClasses(18).map((c) => c.label)).toEqual([
      'Grade 0–9 %',
      'Grade 9–13.5 %',
      'Grade 13.5–18 %',
      'Over the 18 % limit',
      'Grade unknown',
    ])
  })
  it('put a grade on a break in the class below, either way', () => {
    expect(gradeClassOf(9, 18).id).toBe('gentle')
    expect(gradeClassOf(-9.01, 18).id).toBe('moderate')
    expect(gradeClassOf(13.5, 18).id).toBe('moderate')
    expect(gradeClassOf(-18, 18).id).toBe('steep')
    expect(gradeClassOf(18.01, 18).id).toBe('over')
  })
  it('keep a missing grade unknown, and the plan’s own red and grey', () => {
    expect(gradeClassOf(null, 18).id).toBe('unknown')
    expect(gradeClassOf(Number.NaN, 18).id).toBe('unknown')
    expect(GRADE_CLASS_COLORS.over).toBe('#dc2626')
    expect(GRADE_CLASS_COLORS.unknown).toBe('#9ca3af')
  })
})

describe('the plan coloured by grade class', () => {
  it('recolours the active road by the grade of each interval, and leaves the rest alone', () => {
    const segment = (properties: Record<string, unknown>): GeoJSON.Feature => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [] },
      properties,
    })
    const roads: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        segment({ id: 'a', selected: true, chainage: 20, color: '#d97706' }),
        segment({ id: 'a', selected: true, chainage: 40, color: '#dc2626' }),
        segment({ id: 'a', selected: true, chainage: 60, color: '#9ca3af' }),
        segment({ id: 'b', selected: false, color: '#123456' }),
      ],
    }
    const stations = [
      { chainage: 0, gradePercent: null, flags: [] },
      { chainage: 20, gradePercent: 12, flags: [] },
      { chainage: 40, gradePercent: -19, flags: ['Grade exceeds 18%'] },
      { chainage: 60, gradePercent: 3, flags: [] },
    ]
    const coloured = gradeClassRoadLines(roads, stations, 18).features.map((f) => f.properties)
    expect(coloured[0]).toMatchObject({ color: GRADE_CLASS_COLORS.moderate, legendLabel: 'Grade 9–13.5 %' })
    expect(coloured[1]).toMatchObject({ color: GRADE_CLASS_COLORS.over, legendLabel: 'Grade standard not met' })
    expect(coloured[2]).toEqual({ id: 'a', selected: true, chainage: 60, color: '#9ca3af' })
    expect(coloured[3]).toEqual({ id: 'b', selected: false, color: '#123456' })
  })

  const lines: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [10, 20, 30].map((chainage) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [] },
      properties: { selected: true, chainage, color: '#d97706' },
    })),
  }
  const reviewed = (grades: number[], rule: ReturnType<typeof gradeRule>, span: GradeSpan) => {
    const stations = grades.map((gradePercent, i) => ({ chainage: i * 10, gradePercent }))
    const review = reviewGrades(stations, rule, span)
    return stations.map((station, i) => ({ ...station, flags: review.flags.has(i) ? [review.flags.get(i)!] : [] }))
  }

  it.each(['ahead', 'behind'] as const)(
    'keeps an allowed short pitch in the steep class using %s intervals',
    (span) => {
      const rule = gradeRule(
        { maxGradePercent: 12 },
        { ...DEFAULT_DESIGN_STANDARDS, shortPitchGradePercent: 16, shortPitchMaxLengthM: 20 },
      )
      const stations = reviewed([0, 15, 15, 0], rule, span)
      const result = gradeClassRoadLines(lines, stations, 12, undefined, span).features.map((f) => f.properties!)
      const pitch = { color: GRADE_CLASS_COLORS.steep, legendLabel: 'Grade above 9 % · within standard' }
      expect(result[1]).toMatchObject(pitch)
      expect(result[span === 'ahead' ? 2 : 0]).toMatchObject(pitch)
      expect(result[span === 'ahead' ? 0 : 2].color).toBe(GRADE_CLASS_COLORS.gentle)

      const tooLong = reviewed([0, 15, 15, 0], { ...rule, shortPitch: { gradePercent: 16, maxLengthM: 10 } }, span)
      expect(gradeClassRoadLines(lines, tooLong, 12, undefined, span).features[1].properties).toMatchObject({
        color: GRADE_CLASS_COLORS.over,
        legendLabel: 'Grade standard not met',
      })
    },
  )

  it.each(['start-to-end', 'end-to-start'] as const)(
    'shows the adverse breach for loaded travel %s',
    (loadedDirection) => {
      const rule = gradeRule(
        { maxGradePercent: 12 },
        { ...DEFAULT_DESIGN_STANDARDS, adverseGradePercent: 8, loadedDirection },
      )
      const stations = reviewed([10, -10, 0, 0], rule, 'ahead')
      const result = gradeClassRoadLines(lines, stations, 12, undefined, 'ahead').features.map((f) => f.properties!)
      expect(result[loadedDirection === 'start-to-end' ? 0 : 1]).toMatchObject({
        color: GRADE_CLASS_COLORS.over,
        legendLabel: 'Grade standard not met',
      })
      expect(result[loadedDirection === 'start-to-end' ? 1 : 0].color).toBe(GRADE_CLASS_COLORS.steep)
    },
  )
})

describe('grade classes with the person’s own breaks and colours', () => {
  const settings = { breaks: [0.4, 0.9] as const, colors: { gentle: '#0000ff', moderate: '#00ffff', steep: '#ff00ff' } }
  it('break where asked and colour as asked, keeping over the limit red and unknown grey', () => {
    expect(gradeClasses(20, settings).map((c) => [c.label, c.color])).toEqual([
      ['Grade 0–8 %', '#0000ff'],
      ['Grade 8–18 %', '#00ffff'],
      ['Grade 18–20 %', '#ff00ff'],
      ['Over the 20 % limit', '#dc2626'],
      ['Grade unknown', '#9ca3af'],
    ])
    expect(gradeClassOf(8, 20, settings).id).toBe('gentle')
    expect(gradeClassOf(8.01, 20, settings).id).toBe('moderate')
    expect(gradeClassOf(-18.5, 20, settings).id).toBe('steep')
  })
})
