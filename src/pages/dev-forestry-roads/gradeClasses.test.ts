import { describe, expect, it } from 'vitest'
import { GRADE_CLASS_COLORS, gradeClassOf, gradeClassRoadLines, gradeClasses } from './gradeClasses'

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
      { chainage: 0, gradePercent: null },
      { chainage: 20, gradePercent: 12 },
      { chainage: 40, gradePercent: -19 },
      { chainage: 60, gradePercent: 3 },
    ]
    const coloured = gradeClassRoadLines(roads, stations, 18).features.map((f) => f.properties)
    expect(coloured[0]).toMatchObject({ color: GRADE_CLASS_COLORS.moderate, legendLabel: 'Grade 9–13.5 %' })
    expect(coloured[1]).toMatchObject({ color: GRADE_CLASS_COLORS.over, legendLabel: 'Over the 18 % limit' })
    expect(coloured[2]).toEqual({ id: 'a', selected: true, chainage: 60, color: '#9ca3af' })
    expect(coloured[3]).toEqual({ id: 'b', selected: false, color: '#123456' })
  })
})
