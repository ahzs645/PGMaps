import { describe, expect, it } from 'vitest'
import { previewPick } from './previewPick'

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
    // An always-printed heading and plain report text open nothing.
    expect(previewPick([{ tag: 'H2', text: 'Terrain and assumptions' }])).toBeNull()
    expect(previewPick([{ tag: 'P' }, { tag: 'DIV' }])).toBeNull()
  })
})
