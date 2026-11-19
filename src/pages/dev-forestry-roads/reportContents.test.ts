import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import { parseProject, projectReportHtml, reportSectionsUnavailable, serializeProject } from './project'
import {
  matchingReportPreset,
  omittedFromStates,
  omittedSectionsNotice,
  parseOmittedSections,
  parseSectionOrder,
  REPORT_CONTENTS_PRESETS,
  REPORT_ORDER,
  REPORT_SECTIONS,
  reportContentsFromSaved,
  reportContentsParts,
  reportIncludes,
  reportSectionForHeading,
  reportSectionOrder,
  storedSectionOrder,
  toggleReportSection,
  withSectionSequence,
} from './reportContents'
import { createRoadReportSettings } from './reportSettings'
import { createDemoProject, demoTerrain } from './terrain'

const today = new Date(2026, 10, 9)

describe('report contents', () => {
  it('keeps the left-out list in report order and drops ids this version does not know', () => {
    expect(parseOmittedSections(undefined)).toBeUndefined()
    expect(parseOmittedSections(['station-schedule', 'review', 'a-future-section'])).toEqual([
      'review',
      'station-schedule',
    ])
    expect(() => parseOmittedSections('review')).toThrow(/list/)
    expect(() => parseOmittedSections([3])).toThrow(/list/)
  })

  it('turns sections on and off and says what a print leaves out', () => {
    let omitted = toggleReportSection(undefined, 'sections', false)
    omitted = toggleReportSection(omitted, 'review', false)
    expect(omitted).toEqual(['review', 'sections'])
    expect(reportIncludes(omitted)('sections')).toBe(false)
    expect(reportIncludes(omitted)('profile')).toBe(true)
    expect(omittedSectionsNotice(omitted)).toBe(
      'This print leaves out 2 sections: Readiness checks, Cross-sections. Print the full report before relying on what they hold.',
    )
    expect(toggleReportSection(omitted, 'review', true)).toEqual(['sections'])
    expect(omittedSectionsNotice([])).toBe('')
  })

  it('reads the section from a report heading', () => {
    expect(reportSectionForHeading('Readiness checks')).toBe('review')
    expect(reportSectionForHeading('Cross-sections · every 20 m')).toBe('sections')
    expect(reportSectionForHeading('Haul scenario')).toBe('engineering')
    expect(reportSectionForHeading('Crossing register')).toBe('crossing-register')
    expect(reportSectionForHeading('Crossing review')).toBe('crossing-review')
    expect(reportSectionForHeading('Terrain and assumptions')).toBeNull()
  })

  it('applies a stored order: unknown ids dropped, new sections in their usual place, the usual order not kept', () => {
    expect(reportSectionOrder(undefined)).toEqual(REPORT_ORDER)
    // The limitations sit after the cross-sections in the usual order.
    expect(REPORT_ORDER.indexOf('limitations')).toBe(REPORT_ORDER.indexOf('sections') + 1)
    const moved = ['slope-stakes', ...REPORT_ORDER.filter((id) => id !== 'slope-stakes')]
    expect(parseSectionOrder(['a-future-section', ...moved])).toEqual(moved)
    expect(parseSectionOrder([...REPORT_ORDER])).toBeUndefined()
    expect(storedSectionOrder(REPORT_ORDER)).toBeUndefined()
    // An order saved before a section existed puts it in its usual place.
    expect(reportSectionOrder(moved.filter((id) => id !== 'clearing'))).toEqual(moved)
    expect(() => parseSectionOrder([1])).toThrow(/order/)
    // The package lists no limitations: reordering its sections keeps the limitations' slot.
    const sections = REPORT_SECTIONS.map((section) => section.id as string).reverse()
    const order = withSectionSequence(undefined, sections)!
    expect(order.indexOf('limitations')).toBe(REPORT_ORDER.indexOf('limitations'))
    expect(order.filter((id) => id !== 'limitations')).toEqual(sections)
  })

  it('names the report and package notice in the stored order', () => {
    const moved = ['station-schedule', ...REPORT_ORDER.filter((id) => id !== 'station-schedule')]
    expect(omittedSectionsNotice(['review', 'station-schedule'], moved)).toBe(
      'This print leaves out 2 sections: Station schedule, Readiness checks. Print the full report before relying on what they hold.',
    )
  })

  it('lists the contents with the opening parts pinned and locked, and each unavailable reason on its row', () => {
    const parts = reportContentsParts({ omittedSections: ['profile'] }, { 'model-flags': 'The model raised no flags' })
    expect(parts.slice(0, 4).map((part) => [part.key, !!part.pinned, !!part.locked])).toEqual([
      ['title', true, true],
      ['not-current', true, true],
      ['status', true, true],
      ['terrain', true, true],
    ])
    const limitations = parts.find((part) => part.key === 'limitations')!
    expect([limitations.locked, limitations.pinned]).toEqual(['Always printed', undefined])
    expect(parts.find((part) => part.key === 'profile')?.state).toBe('off')
    expect(parts.find((part) => part.key === 'model-flags')?.unavailable).toBe('The model raised no flags')
    expect(parts.slice(4).map((part) => part.key)).toEqual(REPORT_ORDER)
    expect(omittedFromStates(['profile'], { profile: 'on', review: 'off', limitations: 'off' })).toEqual(['review'])
  })

  it('matches the built-in presets, which keep the usual order, and applies a saved one', () => {
    expect(matchingReportPreset(undefined, undefined)).toBe('every')
    const short = REPORT_CONTENTS_PRESETS.find((preset) => preset.id === 'short')!
    expect(matchingReportPreset([...short.omitted].reverse(), undefined)).toBe('short')
    expect(matchingReportPreset(['review'], undefined)).toBeNull()
    const moved = ['profile', ...REPORT_ORDER.filter((id) => id !== 'profile')]
    expect(matchingReportPreset(undefined, moved)).toBeNull()
    expect(
      reportContentsFromSaved(
        { states: { review: 'off', 'gone-section': 'off' }, order: ['title', ...moved] },
        { omittedSections: ['profile'] },
      ),
    ).toEqual({ omittedSections: ['review', 'profile'], sectionOrder: moved })
  })

  describe('in the printed report', () => {
    const project = parseProject(createDemoProject())
    const analysis = analyzeRoad(project.alignments[0], demoTerrain, project.settings, project.context)

    it('prints every section unless one is left out, unchanged from before', () => {
      const report = projectReportHtml(project, analysis, { today })
      expect(report).toContain('<h2>Readiness checks</h2>')
      expect(report).toContain('<h2>Longitudinal profile</h2>')
      expect(report).toContain('<h2>Station schedule</h2>')
      expect(report).toContain('<h2>Crossing review</h2>')
      expect(report).not.toContain('data-omitted-sections')
    })

    it('leaves out the chosen sections, keeps the caveats, and says what it left out', () => {
      const chosen = parseProject(
        JSON.parse(
          serializeProject({
            ...project,
            reportSettings: {
              ...createRoadReportSettings(),
              omittedSections: ['review', 'profile', 'station-schedule', 'crossing-review', 'sections'],
            },
          }),
        ),
      )
      expect(chosen.reportSettings?.omittedSections).toEqual([
        'review',
        'profile',
        'sections',
        'crossing-review',
        'station-schedule',
      ])
      const report = projectReportHtml(chosen, analysis, { today })
      expect(report).not.toContain('<h2>Readiness checks</h2>')
      expect(report).not.toContain('<h2>Longitudinal profile</h2>')
      expect(report).not.toContain('<h2>Station schedule</h2>')
      expect(report).not.toContain('<h2>Crossing review</h2>')
      expect(report).not.toContain('Cross-sections · every')
      expect(report).toContain('data-omitted-sections')
      expect(report).toContain('This print leaves out 5 sections: Readiness checks, Longitudinal profile')
      // What the report is and what it cannot be relied on for always prints.
      expect(report).toContain('<h2>Terrain and assumptions</h2>')
      expect(report).toContain('<h2>Quantity basis and limitations</h2>')
      expect(report).toContain('not for construction')
    })

    it('prints the usual order when none is stored, the same as before orders existed', () => {
      const report = projectReportHtml(project, analysis, { today })
      // The headings of the demo report, in the order the fixed template printed them.
      expect([...report.matchAll(/<h2>([^<]*)/g)].map((match) => match[1])).toEqual([
        'Terrain and assumptions',
        'Project budget',
        'Readiness checks',
        'Crossing register',
        'Streams and riparian assessment',
        'Routing constraints and riparian screens',
        'Stream crossing estimates',
        'Longitudinal profile',
        'Schedule of quantities',
        'Balance points',
        'End haul summary',
        'Quantity basis and limitations',
        'Model flags',
        'Crossing review',
        'Station schedule',
        'Clearing schedule',
        'Slope-stake book',
      ])
      const explicit = {
        ...project,
        reportSettings: { ...createRoadReportSettings(), sectionOrder: [...REPORT_ORDER] },
      }
      expect(projectReportHtml(explicit, analysis, { today })).toBe(report)
    })

    it('moves a section in the printed report and in its left-out line', () => {
      const sectionOrder = [
        'station-schedule' as const,
        'limitations' as const,
        ...REPORT_ORDER.filter((id) => id !== 'station-schedule' && id !== 'limitations'),
      ]
      const moved = parseProject(
        JSON.parse(
          serializeProject({
            ...project,
            reportSettings: { ...createRoadReportSettings(), sectionOrder, omittedSections: ['review', 'clearing'] },
          }),
        ),
      )
      expect(moved.reportSettings?.sectionOrder).toEqual(sectionOrder)
      const report = projectReportHtml(moved, analysis, { today })
      const headings = [...report.matchAll(/<h2>([^<]*)/g)].map((match) => match[1])
      expect(headings.slice(0, 4)).toEqual([
        'Terrain and assumptions',
        'Project budget',
        'Station schedule',
        'Quantity basis and limitations',
      ])
      expect(headings).not.toContain('Readiness checks')
      expect(report).toContain('This print leaves out 2 sections: Readiness checks, Clearing schedule.')
      // A plain project gains no order on the way through a file.
      const plain = { ...project, reportSettings: createRoadReportSettings() }
      expect(serializeProject(parseProject(JSON.parse(serializeProject(plain))))).toBe(serializeProject(plain))
      expect(serializeProject(plain)).not.toContain('sectionOrder')
    })

    it('says which sections this road gives nothing to print, as the report prints them', () => {
      const unavailable = reportSectionsUnavailable(project, analysis)
      expect(unavailable['record-changes']).toBe('Choose the issued design below')
      expect(unavailable.aggregate).toBe('No aggregate source is entered')
      expect(unavailable.review).toBeUndefined()
      const report = projectReportHtml(project, analysis, { today })
      expect(report).not.toContain('<h2>Record of changes')
      expect(report).not.toContain('<h2>Surfacing aggregate source')
      const quiet = { ...analysis, warnings: [] }
      expect(reportSectionsUnavailable(project, quiet)['model-flags']).toBe('The model raised no flags')
      expect(projectReportHtml(project, quiet, { today })).not.toContain('<h2>Model flags</h2>')
    })

    it('lists every section once', () => {
      expect(new Set(REPORT_SECTIONS.map((section) => section.id)).size).toBe(REPORT_SECTIONS.length)
    })
  })
})
