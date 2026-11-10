/**
 * Which sections the printed report includes. A project keeps the sections the user left out
 * (`RoadReportSettings.omittedSections`), so a section added in a later version prints until it is
 * turned off. The parts that say what the report is and what it cannot be relied on for always
 * print, and a print that leaves anything out says so under its status line. No DOM or network access.
 */

/** The report's optional sections, in the order they print. */
export const REPORT_SECTIONS = [
  { id: 'review', label: 'Readiness checks', heading: 'Readiness checks' },
  { id: 'full-cost', label: 'Complete access cost', heading: 'Complete access cost' },
  { id: 'crossing-register', label: 'Crossing register', heading: 'Crossing register' },
  { id: 'streams', label: 'Streams and riparian assessment', heading: 'Streams and riparian' },
  { id: 'constraints', label: 'Routing constraints', heading: 'Routing constraints' },
  { id: 'crossing-estimates', label: 'Stream crossing estimates', heading: 'Stream crossing estimates' },
  { id: 'drainage', label: 'Drainage review evidence', heading: 'Drainage review' },
  { id: 'aggregate', label: 'Surfacing aggregate source', heading: 'Surfacing aggregate source' },
  { id: 'profile', label: 'Longitudinal profile', heading: 'Longitudinal profile' },
  {
    id: 'engineering',
    label: 'Costs, materials, culverts and haul',
    heading: ['Engineering cost breakdown', 'Material quantities', 'Culvert geometry', 'Haul scenario'],
  },
  { id: 'sections', label: 'Cross-sections', heading: 'Cross-sections' },
  { id: 'model-flags', label: 'Model flags', heading: 'Model flags' },
  { id: 'crossing-review', label: 'Crossing review', heading: 'Crossing review' },
  { id: 'station-schedule', label: 'Station schedule', heading: 'Station schedule' },
] as const satisfies readonly { id: string; label: string; heading: string | readonly string[] }[]

export type ReportSectionId = (typeof REPORT_SECTIONS)[number]['id']

/** Printed on every report whatever is chosen: what it is, who issued it, and what it cannot be relied on for. */
export const ALWAYS_PRINTED_SECTIONS = [
  'Title and issue stamp',
  'Not-current stamp, while an input is invalid',
  'Status, coverage and totals',
  'Terrain and assumptions',
  'Quantity basis and limitations',
] as const

const IDS: readonly string[] = REPORT_SECTIONS.map((section) => section.id)

/**
 * The left-out list as read from a project file. Ids this version does not know are dropped rather
 * than refusing the file, so a project saved by a newer version still opens.
 */
export function parseOmittedSections(raw: unknown): ReportSectionId[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length > 100 || raw.some((value) => typeof value !== 'string'))
    throw Error('Report sections left out must be a list of section names.')
  const known = REPORT_SECTIONS.map((section) => section.id).filter((id) => raw.includes(id))
  return known
}

/** Whether a section prints, given the sections left out. */
export const reportIncludes =
  (omitted: readonly string[] | undefined) =>
  (id: ReportSectionId): boolean =>
    !omitted?.includes(id)

/** The sections left out, by label, in report order. */
export function omittedSectionLabels(omitted: readonly string[] | undefined): string[] {
  return REPORT_SECTIONS.filter((section) => omitted?.includes(section.id)).map((section) => section.label)
}

/** The line a print that leaves sections out carries, so a reader knows it is not the whole report. Empty when complete. */
export function omittedSectionsNotice(omitted: readonly string[] | undefined): string {
  const labels = omittedSectionLabels(omitted)
  if (!labels.length) return ''
  return `This print leaves out ${labels.length === 1 ? 'one section' : `${labels.length} sections`}: ${labels.join(', ')}. Print the full report before relying on what they hold.`
}

/** The next left-out list after a section is turned on or off. */
export function toggleReportSection(
  omitted: readonly string[] | undefined,
  id: ReportSectionId,
  included: boolean,
): ReportSectionId[] {
  const next = new Set((omitted ?? []).filter((value) => IDS.includes(value)) as ReportSectionId[])
  if (included) next.delete(id)
  else next.add(id)
  return REPORT_SECTIONS.map((section) => section.id).filter((value) => next.has(value))
}

/** The section a report heading belongs to, read from its text; null for an always-printed part. */
export function reportSectionForHeading(text: string): ReportSectionId | null {
  const heading = text.trim()
  for (const section of REPORT_SECTIONS) {
    const prefixes: readonly string[] = typeof section.heading === 'string' ? [section.heading] : section.heading
    if (prefixes.some((prefix) => heading.startsWith(prefix))) return section.id
  }
  return null
}
