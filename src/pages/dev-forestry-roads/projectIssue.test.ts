import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import { parseProject, projectReportHtml } from './project'
import { EMPTY_PROJECT_ISSUE, isoDate, issueLine, issueStamp, parseProjectIssue } from './projectIssue'
import { createDemoProject, demoTerrain } from './terrain'

const today = new Date(2026, 10, 9)

describe('issue stamp', () => {
  it('prints the day of printing until a date of issue is entered, and says what is not recorded', () => {
    const blank = issueStamp(undefined, today)
    expect(blank).toMatchObject({ date: '2026-11-09', dateDefaulted: true, missing: ['prepared by', 'revision'] })
    expect(issueLine(blank)).toBe('Revision not recorded · Issued 2026-11-09 · Author not recorded')
    const filled = issueStamp(
      { preparedBy: 'J. Smith', organisation: 'Northwood', revision: 'Rev B', issuedOn: '2026-10-30', note: '' },
      today,
    )
    expect(filled).toMatchObject({ date: '2026-10-30', dateDefaulted: false, missing: [] })
    expect(issueLine(filled)).toBe('Rev B · Issued 2026-10-30 · Prepared by J. Smith, Northwood')
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('is saved in the project file and refuses a date that is not one', () => {
    const issue = { ...EMPTY_PROJECT_ISSUE, preparedBy: 'J. Smith', revision: 'A', issuedOn: '2026-11-09' }
    const saved = parseProject(JSON.parse(JSON.stringify({ ...createDemoProject(), issue })))
    expect(saved.issue).toEqual(issue)
    expect(parseProject(createDemoProject()).issue).toBeUndefined()
    expect(() => parseProjectIssue({ issuedOn: '9 Nov 2026' })).toThrow(/YYYY-MM-DD/)
    expect(() => parseProjectIssue({ preparedBy: 'x'.repeat(201) })).toThrow(/Prepared by/)
  })
})

describe('report', () => {
  const project = parseProject({
    ...createDemoProject(),
    issue: {
      preparedBy: 'J. Smith',
      organisation: 'Northwood',
      revision: 'B',
      issuedOn: '',
      note: 'Issued for review',
    },
  })
  const active = project.alignments[0]
  const analysis = analyzeRoad(active, demoTerrain, project.settings, project.context)
  const report = projectReportHtml(project, analysis, { today })

  it('carries the issue stamp, the terrain source and the planning caveat at the top', () => {
    expect(report).toContain('<dt>Revision</dt><dd>B</dd>')
    expect(report).toContain('<dt>Date of issue</dt><dd>2026-11-09 (day of printing)</dd>')
    expect(report).toContain('<dt>Prepared by</dt><dd>J. Smith, Northwood</dd>')
    expect(report).toContain('<dt>Issue note</dt><dd>Issued for review</dd>')
    expect(report).toContain(`<dt>Terrain source</dt><dd>${project.terrain.name}`)
    expect(report).toContain('not for construction')
    const blank = projectReportHtml({ ...project, issue: undefined }, analysis, { today })
    expect(blank).toContain('<dt>Revision</dt><dd>Not recorded</dd>')
    expect(blank).toContain('<dt>Prepared by</dt><dd>Not recorded</dd>')
  })

  it('prints the readiness list and the crossing register, including what was not assessed', () => {
    expect(report).toContain('<h2>Readiness checks</h2>')
    expect(report).toContain('<strong>Not assessed</strong>')
    expect(report).toContain('The drainage check has not been run')
    expect(report).toContain('<h2>Crossing register</h2>')
    expect(report).toContain('<dt>Design standards</dt><dd>12% grade; minimum radius')
    expect(report).toContain('Not confirmed: starting values')
  })
})
