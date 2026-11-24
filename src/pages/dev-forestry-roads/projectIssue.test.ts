import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import { parseProject, projectReportHtml } from './project'
import { createRoadReportSettings } from './reportSettings'
import { EMPTY_PROJECT_ISSUE, isCalendarDate, isoDate, issueLine, issueStamp, parseProjectIssue } from './projectIssue'
import { createDemoProject, demoTerrain } from './terrain'

const today = new Date(2026, 10, 9)

describe('issue stamp', () => {
  it('keeps a document title only when one was typed', () => {
    expect(parseProjectIssue({ ...EMPTY_PROJECT_ISSUE, title: ' Haul road ' }).title).toBe('Haul road')
    expect('title' in parseProjectIssue({ ...EMPTY_PROJECT_ISSUE, title: '' })).toBe(false)
    expect('title' in parseProjectIssue(EMPTY_PROJECT_ISSUE)).toBe(false)
  })

  it('prints a designation after the name, and a project without one reads and writes as before', () => {
    const stamp = issueStamp(
      {
        preparedBy: 'J. Smith',
        designation: 'RPF #4521',
        organisation: 'Northwood',
        revision: 'A',
        issuedOn: '',
        note: '',
      },
      today,
    )
    expect(stamp.preparedBy).toBe('J. Smith, RPF #4521')
    expect(issueLine(stamp, undefined)).toBe('Rev A · Issued 2026-11-09 · Prepared by J. Smith, RPF #4521, Northwood')
    expect(parseProjectIssue({ ...EMPTY_PROJECT_ISSUE, designation: 'RPF' })).toMatchObject({ designation: 'RPF' })
    expect('designation' in parseProjectIssue({ ...EMPTY_PROJECT_ISSUE, designation: '' })).toBe(false)
    expect('designation' in parseProjectIssue(EMPTY_PROJECT_ISSUE)).toBe(false)
    // A designation alone names nobody, so the stamp still asks who prepared it.
    expect(issueStamp({ ...EMPTY_PROJECT_ISSUE, designation: 'RPF' }, today).missing).toContain('prepared by')
  })

  it('prints the day of printing until a date of issue is entered, and leaves what is missing blank', () => {
    const blank = issueStamp(undefined, today)
    expect(blank).toMatchObject({ date: '2026-11-09', dateDefaulted: true, missing: ['prepared by', 'revision'] })
    // Blank by default: each field keeps its label with nothing after it.
    expect(issueLine(blank, undefined)).toBe('Rev · Issued 2026-11-09 · Prepared by')
    expect(issueLine(blank, 'blank')).toBe('Rev · Issued 2026-11-09 · Prepared by')
    // The earlier wording, when the project asks for it (and always in the dialog's own line).
    expect(issueLine(blank, 'stated')).toBe('Revision not recorded · Issued 2026-11-09 · Author not recorded')
    const filled = issueStamp(
      { preparedBy: 'J. Smith', organisation: 'Northwood', revision: 'Rev B', issuedOn: '2026-10-30', note: '' },
      today,
    )
    expect(filled).toMatchObject({ date: '2026-10-30', dateDefaulted: false, missing: [] })
    expect(issueLine(filled, 'stated')).toBe('Rev B · Issued 2026-10-30 · Prepared by J. Smith, Northwood')
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('is saved in the project file and refuses a date that is not one', () => {
    const issue = { ...EMPTY_PROJECT_ISSUE, preparedBy: 'J. Smith', revision: 'A', issuedOn: '2026-11-09' }
    const saved = parseProject(JSON.parse(JSON.stringify({ ...createDemoProject(), issue })))
    expect(saved.issue).toEqual(issue)
    expect(parseProject(createDemoProject()).issue).toBeUndefined()
    expect(() => parseProjectIssue({ issuedOn: '9 Nov 2026' })).toThrow(/YYYY-MM-DD/)
    // A day that does not exist is refused, not rolled over into the next month.
    expect(() => parseProjectIssue({ issuedOn: '2026-02-31' })).toThrow(
      'The date of issue must be a real date, written YYYY-MM-DD.',
    )
    expect(() => parseProjectIssue({ issuedOn: '2026-13-45' })).toThrow(/real date/)
    expect(parseProjectIssue({ issuedOn: '2028-02-29' }).issuedOn).toBe('2028-02-29')
    expect(isCalendarDate('2026-02-28')).toBe(true)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2026-2-9')).toBe(false)
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
    // A field left empty prints blank by default: its label stays, with an empty value.
    const blank = projectReportHtml({ ...project, issue: undefined }, analysis, { today })
    expect(blank).toContain('<dt>Revision</dt><dd></dd>')
    expect(blank).toContain('<dt>Prepared by</dt><dd></dd>')
    expect(blank).not.toContain('Not recorded')
  })

  it('prints the earlier "Not recorded" for empty fields when the project asks for it', () => {
    const stated = projectReportHtml(
      { ...project, issue: undefined, reportSettings: { ...createRoadReportSettings(), emptyFields: 'stated' } },
      analysis,
      { today },
    )
    expect(stated).toContain('<dt>Revision</dt><dd>Not recorded</dd>')
    expect(stated).toContain('<dt>Prepared by</dt><dd>Not recorded</dd>')
    // Only the person's fields follow the choice: the defaulted date still says where it came from.
    expect(stated).toContain('<dt>Date of issue</dt><dd>2026-11-09 (day of printing)</dd>')
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

describe('plot book title block', () => {
  it('carries the revision, the date of issue and the author on every sheet', async () => {
    const { plotBookHtml } = await import('./plotBook')
    const project = createDemoProject()
    const active = project.alignments[0]
    const analysis = analyzeRoad(active, demoTerrain, project.settings, project.context)
    const book = plotBookHtml({
      projectName: project.name,
      alignment: active,
      analysis,
      terrain: project.terrain,
      toGrid: ([lon, lat]) => [lon * 70_000, lat * 111_000],
      issue: { preparedBy: 'J. Smith', organisation: 'Northwood', revision: 'B', issuedOn: '2026-10-30', note: '' },
    })
    const sheets = book.match(/<section class="sheet">/g)?.length ?? 0
    expect(sheets).toBeGreaterThan(1)
    expect(book.match(/data-role="revision">Rev B</g)).toHaveLength(sheets)
    expect(book.match(/data-role="issued">Issued 2026-10-30</g)).toHaveLength(sheets)
    expect(book.match(/data-role="prepared-by">Prepared by J\. Smith, Northwood</g)).toHaveLength(sheets)
    expect(book.match(/not for construction/g)?.length).toBeGreaterThanOrEqual(sheets)
    // Nothing entered: the fields keep their labels, blank, and the sheet is dated the day it is made.
    const unstamped = {
      projectName: project.name,
      alignment: active,
      analysis,
      terrain: project.terrain,
      toGrid: ([lon, lat]: [number, number]): [number, number] => [lon * 70_000, lat * 111_000],
      today,
    }
    const blank = plotBookHtml(unstamped)
    expect(blank).toContain('data-role="revision">Rev<')
    expect(blank).toContain('data-role="issued">Issued 2026-11-09<')
    expect(blank).toContain('data-role="prepared-by">Prepared by:<')
    expect(blank).not.toContain('not recorded')
    // The project's choice brings back the earlier wording, unchanged.
    const stated = plotBookHtml({ ...unstamped, settings: { ...createRoadReportSettings(), emptyFields: 'stated' } })
    expect(stated).toContain('data-role="revision">Rev not recorded<')
    expect(stated).toContain('data-role="prepared-by">Prepared by: not recorded<')
  })
})
