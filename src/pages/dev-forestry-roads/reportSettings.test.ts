import { describe, expect, it } from 'vitest'
import {
  createReportChapter,
  createRoadReportSettings,
  formatDrawingLabel,
  parseRoadReportSettings,
  validateLabelTemplate,
} from './reportSettings'

describe('portable report settings', () => {
  it('retains chapter order, custom ranges, physical scales, fields and label placement through JSON', () => {
    const s = createRoadReportSettings()
    s.paper = 'A4'
    s.chapters = [
      {
        ...createReportChapter('schedule', 's'),
        startM: 100,
        endM: 450,
        columns: ['station', 'flags'],
        sectionIntervalM: 25,
      },
      { ...s.chapters[0], horizontalScale: 1000, verticalExaggeration: 5 },
    ]
    s.stationLabel = '{road} @ {station}'
    s.labelOffsetY = -12
    expect(parseRoadReportSettings(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })
  it('substitutes only documented fields, supports precision and keeps unknowns unknown', () => {
    expect(
      formatDrawingLabel('{road} {station}: {grade:.1}%, z={design:.2}', {
        road: 'Spur <A>',
        station: '0+120',
        grade: 6.25,
        design: null,
      }),
    ).toBe('Spur <A> 0+120: 6.3%, z=—')
    for (const expression of ['{constructor}', '{process}', '{grade:.9}', '{grade+1}', '{station', '{{station}}'])
      expect(() => validateLabelTemplate(expression)).toThrow()
  })
  it('rejects invalid ranges, infinite scales, duplicate chapters and silent zero-interval loops', () => {
    const s = createRoadReportSettings()
    expect(() => parseRoadReportSettings({ ...s, chapters: [{ ...s.chapters[0], startM: 200, endM: 100 }] })).toThrow(
      'follow',
    )
    expect(() =>
      parseRoadReportSettings({ ...s, chapters: [{ ...s.chapters[0], horizontalScale: Infinity }] }),
    ).toThrow('scale')
    expect(() => parseRoadReportSettings({ ...s, chapters: [s.chapters[0], s.chapters[0]] })).toThrow('unique')
    expect(() => parseRoadReportSettings({ ...s, chapters: [{ ...s.chapters[0], sheetLengthM: 0 }] })).toThrow(
      'Sheet length',
    )
    expect(() =>
      parseRoadReportSettings({ ...s, subviews: { ...s.subviews, plan: false, profile: false, mass: false } }),
    ).toThrow('one plot subview')
  })
})
