import { describe, expect, it } from 'vitest'
import { previewPick } from './previewPick'
import { REPORT_SECTIONS, reportPartHeadings } from './reportContents'

describe('picking a part of an export preview', () => {
  it('opens the issue stamp from a title block or the report issue box', () => {
    expect(
      previewPick([
        { tag: 'text', role: 'revision' },
        { tag: 'g', role: 'title-block' },
        { tag: 'svg', chapter: 'plan-profile' },
      ]),
    ).toEqual({ view: 'issue' })
    expect(previewPick([{ tag: 'DD' }, { tag: 'DL', classes: ['issue'] }])).toEqual({ view: 'issue' })
  })

  it("opens a sheet's chapter, and a report heading's section", () => {
    expect(previewPick([{ tag: 'path' }, { tag: 'g' }, { tag: 'svg', chapter: 'sections' }])).toEqual({
      view: 'setup',
      chapter: 'sections',
    })
    expect(previewPick([{ tag: 'H2', text: 'Station schedule' }])).toEqual({
      view: 'setup',
      section: 'station-schedule',
    })
    // The limitations always print but may be moved, so their heading opens their row.
    expect(previewPick([{ tag: 'H2', text: 'Quantity basis and limitations' }])).toEqual({
      view: 'setup',
      section: 'limitations',
    })
    // A heading that opens every report and plain report text open nothing.
    expect(previewPick([{ tag: 'H2', text: 'Terrain and assumptions' }])).toBeNull()
    expect(previewPick([{ tag: 'P' }, { tag: 'DIV' }])).toBeNull()
  })

  it("finds a row's headings the other way, for the preview beside the contents list", () => {
    expect(reportPartHeadings('station-schedule')).toEqual(['Station schedule'])
    expect(reportPartHeadings('engineering')).toContain('Haul scenario')
    expect(reportPartHeadings('limitations')).toEqual(['Quantity basis and limitations'])
    expect(reportPartHeadings('terrain')).toEqual(['Terrain and assumptions'])
    expect(reportPartHeadings('title')).toEqual([])
    // Every section's headings lead back to that section.
    for (const section of REPORT_SECTIONS)
      for (const heading of reportPartHeadings(section.id))
        expect(previewPick([{ tag: 'H2', text: heading }])).toEqual({ view: 'setup', section: section.id })
  })
})
