import { describe, expect, it } from 'vitest'
import {
  createReportChapter,
  createRoadReportSettings,
  formatDrawingLabel,
  parseRoadReportSettings,
  validateLabelTemplate,
} from './reportSettings'
import { REPORT_ORDER } from './reportContents'

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
  it('takes tabloid and ANSI D paper and the report sections left out, and still reads older settings', () => {
    for (const paper of ['A3', 'A4', 'tabloid', 'ansi-d'] as const)
      expect(parseRoadReportSettings({ ...createRoadReportSettings(), paper }).paper).toBe(paper)
    expect(() => parseRoadReportSettings({ ...createRoadReportSettings(), paper: 'B5' })).toThrow(/tabloid or ANSI D/)
    const s = { ...createRoadReportSettings(), omittedSections: ['sections', 'review'] }
    expect(parseRoadReportSettings(JSON.parse(JSON.stringify(s))).omittedSections).toEqual(['review', 'sections'])
    // An empty list is the same as none, so a file does not change by saving it.
    expect(parseRoadReportSettings({ ...createRoadReportSettings(), omittedSections: [] })).not.toHaveProperty(
      'omittedSections',
    )
    expect(parseRoadReportSettings(createRoadReportSettings())).not.toHaveProperty('omittedSections')
  })

  it('keeps a report section order only when it differs from the usual one, dropping unknown ids', () => {
    const moved = ['profile', ...REPORT_ORDER.filter((id) => id !== 'profile')]
    const read = parseRoadReportSettings(
      JSON.parse(JSON.stringify({ ...createRoadReportSettings(), sectionOrder: [...moved, 'a-future-section'] })),
    )
    expect(read.sectionOrder).toEqual(moved)
    // The usual order, or a stored order that leaves a new section out, reads as no order at all.
    expect(
      parseRoadReportSettings({ ...createRoadReportSettings(), sectionOrder: [...REPORT_ORDER] }),
    ).not.toHaveProperty('sectionOrder')
    const older = moved.filter((id) => id !== 'slope-stakes')
    expect(parseRoadReportSettings({ ...createRoadReportSettings(), sectionOrder: older }).sectionOrder).toEqual(moved)
    expect(parseRoadReportSettings(createRoadReportSettings())).not.toHaveProperty('sectionOrder')
    expect(() => parseRoadReportSettings({ ...createRoadReportSettings(), sectionOrder: 'profile' })).toThrow(/order/)
  })
  it('keeps what an empty field prints only when it is not the default, and refuses an unknown choice', () => {
    // Absent (every file written before the choice) is blank, and nothing is added on the way through.
    expect(parseRoadReportSettings(createRoadReportSettings())).not.toHaveProperty('emptyFields')
    expect(parseRoadReportSettings({ ...createRoadReportSettings(), emptyFields: 'blank' })).not.toHaveProperty(
      'emptyFields',
    )
    const stated = { ...createRoadReportSettings(), emptyFields: 'stated' as const }
    expect(parseRoadReportSettings(JSON.parse(JSON.stringify(stated)))).toEqual(stated)
    expect(() => parseRoadReportSettings({ ...createRoadReportSettings(), emptyFields: 'dash' })).toThrow(/left empty/)
  })
})
