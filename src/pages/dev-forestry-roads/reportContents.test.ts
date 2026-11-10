import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import { parseProject, projectReportHtml, serializeProject } from './project'
import {
  omittedSectionsNotice,
  parseOmittedSections,
  REPORT_SECTIONS,
  reportIncludes,
  reportSectionForHeading,
  toggleReportSection,
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

    it('lists every section once', () => {
      expect(new Set(REPORT_SECTIONS.map((section) => section.id)).size).toBe(REPORT_SECTIONS.length)
    })
  })
})
