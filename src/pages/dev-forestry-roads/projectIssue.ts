/**
 * The issue stamp printed on documents that leave the workspace: who prepared them, for whom, which
 * revision and when. Pure, with no DOM or network access.
 */
export interface ProjectIssue {
  preparedBy: string
  organisation: string
  /** Free text: "A", "Rev 2", "Issued for review". */
  revision: string
  /** YYYY-MM-DD. Empty prints the day the document is made. */
  issuedOn: string
  note: string
}

export const EMPTY_PROJECT_ISSUE: ProjectIssue = {
  preparedBy: '',
  organisation: '',
  revision: '',
  issuedOn: '',
  note: '',
}

export const PLANNING_CAVEAT = 'Preliminary planning geometry · not for construction'

/**
 * True for a real calendar day written YYYY-MM-DD. `Date.parse` rolls 2026-02-31 over to March and
 * a pattern alone accepts 2026-13-45, so the date is rebuilt and compared with what was written.
 */
export function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function parseProjectIssue(raw: unknown): ProjectIssue {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('The issue stamp must be an object.')
  const r = raw as Record<string, unknown>
  const text = (value: unknown, label: string, max: number) => {
    if (value === undefined) return ''
    if (typeof value !== 'string' || value.length > max)
      throw Error(`${label} must be text of at most ${max} characters.`)
    return value
  }
  const issuedOn = text(r.issuedOn, 'Date of issue', 10)
  if (issuedOn && !isCalendarDate(issuedOn)) throw Error('The date of issue must be a real date, written YYYY-MM-DD.')
  return {
    preparedBy: text(r.preparedBy, 'Prepared by', 200),
    organisation: text(r.organisation, 'Organisation', 200),
    revision: text(r.revision, 'Revision', 40),
    issuedOn,
    note: text(r.note, 'Issue note', 500),
  }
}

/** Local calendar date as YYYY-MM-DD, the form the stamp stores and prints. */
export function isoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface IssueStamp {
  /** The stored date of issue, or today's when none is stored. */
  date: string
  /** True when the date is the day of printing because none was entered. */
  dateDefaulted: boolean
  preparedBy: string
  organisation: string
  revision: string
  note: string
  /** What the stamp still lacks, for a prompt beside the export. */
  missing: string[]
}

/** The stamp as printed. A missing name or revision prints as "not recorded", never as a blank. */
export function issueStamp(issue: ProjectIssue | undefined, today: Date = new Date()): IssueStamp {
  const value = issue ?? EMPTY_PROJECT_ISSUE
  const missing: string[] = []
  if (!value.preparedBy.trim()) missing.push('prepared by')
  if (!value.revision.trim()) missing.push('revision')
  return {
    date: value.issuedOn || isoDate(today),
    dateDefaulted: !value.issuedOn,
    preparedBy: value.preparedBy.trim(),
    organisation: value.organisation.trim(),
    revision: value.revision.trim(),
    note: value.note.trim(),
    missing,
  }
}

/** One line for a title block or a file header: "Rev B · 2026-11-09 · J. Smith, Northwood". */
export function issueLine(stamp: IssueStamp): string {
  const who = [stamp.preparedBy, stamp.organisation].filter(Boolean).join(', ')
  return [
    stamp.revision ? `Rev ${stamp.revision.replace(/^rev(ision)?\.?\s*/i, '')}` : 'Revision not recorded',
    `Issued ${stamp.date}`,
    who ? `Prepared by ${who}` : 'Author not recorded',
  ].join(' · ')
}
