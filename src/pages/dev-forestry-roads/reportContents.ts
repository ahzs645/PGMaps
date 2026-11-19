/**
 * Which sections the printed report includes, and in what order. A project keeps the sections the
 * user left out (`RoadReportSettings.omittedSections`), so a section added in a later version prints
 * until it is turned off, and the order the user set (`RoadReportSettings.sectionOrder`, absent for
 * the usual order), where a section this version does not know is dropped and a new one takes its
 * usual place (`orderedKeys`). The parts that say what the report is and what it cannot be relied on
 * for always print: the title, the stamps, the status and the terrain and assumptions open the report
 * and never move; the quantity basis and limitations always print but may be moved. A print that
 * leaves anything out says so under its status line. No DOM or network access.
 */
import { orderedKeys, type ContentsPart } from '@/lib/documentContents/contents'
import type { SavedContents } from '@/lib/documentContents/savedContents'

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
    heading: [
      'Engineering cost breakdown',
      'Material quantities',
      'Culvert geometry',
      'Culvert schedule',
      'Haul scenario',
    ],
  },
  { id: 'quantity-schedule', label: 'Schedule of quantities and equipment', heading: 'Schedule of quantities' },
  { id: 'balance-points', label: 'Balance points', heading: 'Balance points' },
  { id: 'end-haul', label: 'End haul summary', heading: 'End haul summary' },
  { id: 'record-changes', label: 'Record of changes from the issued design', heading: 'Record of changes' },
  { id: 'sections', label: 'Cross-sections', heading: 'Cross-sections' },
  { id: 'model-flags', label: 'Model flags', heading: 'Model flags' },
  { id: 'crossing-review', label: 'Crossing review', heading: 'Crossing review' },
  { id: 'station-schedule', label: 'Station schedule', heading: 'Station schedule' },
  { id: 'clearing', label: 'Clearing schedule', heading: 'Clearing schedule' },
  { id: 'slope-stakes', label: 'Slope-stake book', heading: 'Slope-stake book' },
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

/** The always-printed part that may move: the quantity basis and limitations. */
export const LIMITATIONS_PART = 'limitations'
export const LIMITATIONS_LABEL = ALWAYS_PRINTED_SECTIONS[4]

/** A part of the report body whose place the user may set: a section, or the limitations. */
export type ReportOrderId = ReportSectionId | typeof LIMITATIONS_PART

/** The usual order of the report body: the sections, with the limitations after the cross-sections. */
export const REPORT_ORDER: readonly ReportOrderId[] = REPORT_SECTIONS.flatMap((section) =>
  section.id === 'sections' ? [section.id, LIMITATIONS_PART] : [section.id],
)

/** The parts that open every report in this order and never move (keys of the contents list). */
export const PINNED_REPORT_PARTS = [
  { key: 'title', label: ALWAYS_PRINTED_SECTIONS[0] },
  { key: 'not-current', label: ALWAYS_PRINTED_SECTIONS[1] },
  { key: 'status', label: ALWAYS_PRINTED_SECTIONS[2] },
  { key: 'terrain', label: ALWAYS_PRINTED_SECTIONS[3] },
] as const

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index])

/** The report body's order: the stored one with unknown ids dropped and new parts in their usual place. */
export function reportSectionOrder(stored: readonly string[] | undefined): ReportOrderId[] {
  return orderedKeys(REPORT_ORDER, stored).keys as ReportOrderId[]
}

/**
 * The stored order as read from a project file: undefined when absent or the usual order, else the
 * whole order with unknown ids dropped, so a project saved by a newer version still opens.
 */
export function parseSectionOrder(raw: unknown): ReportOrderId[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length > 100 || raw.some((value) => typeof value !== 'string'))
    throw Error('The report section order must be a list of section names.')
  const order = reportSectionOrder(raw as string[])
  return sameOrder(order, REPORT_ORDER) ? undefined : order
}

/** The order to store after a move: undefined when it is the usual order again. */
export const storedSectionOrder = (order: readonly string[]): ReportOrderId[] | undefined => {
  const full = reportSectionOrder(order)
  return sameOrder(full, REPORT_ORDER) ? undefined : full
}

/** The label of a part of the report body. */
export const reportPartLabel = (id: ReportOrderId): string =>
  id === LIMITATIONS_PART ? LIMITATIONS_LABEL : (REPORT_SECTIONS.find((section) => section.id === id)?.label ?? id)

/** The report's sections (no limitations) in the stored order. */
export const orderedReportSections = (stored: readonly string[] | undefined): ReportSectionId[] =>
  reportSectionOrder(stored).filter((id): id is ReportSectionId => id !== LIMITATIONS_PART)

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

/** The sections left out, by label, in report order (the stored `order`, else the usual one). */
export function omittedSectionLabels(omitted: readonly string[] | undefined, order?: readonly string[]): string[] {
  return orderedReportSections(order)
    .filter((id) => omitted?.includes(id))
    .map((id) => reportPartLabel(id))
}

/** The line a print that leaves sections out carries, so a reader knows it is not the whole report. Empty when complete. */
export function omittedSectionsNotice(omitted: readonly string[] | undefined, order?: readonly string[]): string {
  const labels = omittedSectionLabels(omitted, order)
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

/** The part of the report body a heading belongs to: a section, or the limitations; null for a part that opens the report. */
export function reportPartForHeading(text: string): ReportOrderId | null {
  const section = reportSectionForHeading(text)
  if (section) return section
  return text.trim().startsWith(LIMITATIONS_LABEL) ? LIMITATIONS_PART : null
}

/**
 * The headings a contents row's part prints under, for bringing it into view in a preview: the
 * section's own, the limitations' or the terrain's. Empty for the title, the stamps and the status,
 * which sit at the top.
 */
export function reportPartHeadings(key: string): readonly string[] {
  if (key === LIMITATIONS_PART) return [LIMITATIONS_LABEL]
  if (key === 'terrain') return [ALWAYS_PRINTED_SECTIONS[3]]
  const section = REPORT_SECTIONS.find((entry) => entry.id === key)
  if (!section) return []
  return typeof section.heading === 'string' ? [section.heading] : section.heading
}

/** Why a section has nothing to print for this road, by section; absent sections print. */
export type ReportSectionsUnavailable = Partial<Record<ReportSectionId, string>>

/** The report's contents as `DocumentContents` lists them: the opening parts pinned and locked, then the body in order. */
export function reportContentsParts(
  settings: { omittedSections?: readonly string[]; sectionOrder?: readonly string[] } | undefined,
  unavailable: ReportSectionsUnavailable = {},
): ContentsPart[] {
  const include = reportIncludes(settings?.omittedSections)
  return [
    ...PINNED_REPORT_PARTS.map(
      (part): ContentsPart => ({
        key: part.key,
        label: part.label,
        state: 'on',
        locked: 'Always printed',
        pinned: true,
      }),
    ),
    ...reportSectionOrder(settings?.sectionOrder).map(
      (id): ContentsPart =>
        id === LIMITATIONS_PART
          ? { key: id, label: LIMITATIONS_LABEL, state: 'on', locked: 'Always printed' }
          : {
              key: id,
              label: reportPartLabel(id),
              state: include(id) ? 'on' : 'off',
              ...(unavailable[id] ? { unavailable: unavailable[id] } : {}),
            },
    ),
  ]
}

/** The left-out sections this version knows, in catalogue order. */
const knownOmitted = (omitted: readonly string[] | undefined): ReportSectionId[] =>
  REPORT_SECTIONS.map((section) => section.id).filter((id) => omitted?.includes(id))

/** The left-out list after a contents list's states change: sections only, in catalogue order. */
export function omittedFromStates(
  omitted: readonly string[] | undefined,
  changes: Record<string, string>,
): ReportSectionId[] {
  let next = knownOmitted(omitted)
  for (const [key, state] of Object.entries(changes))
    if (IDS.includes(key)) next = toggleReportSection(next, key as ReportSectionId, state === 'on')
  return next
}

/** A built-in choice of sections, always in the usual order. */
export interface ReportContentsPreset {
  id: string
  label: string
  omitted: readonly ReportSectionId[]
}

/**
 * The built-in presets. Without the long schedules leaves out the four sections the report package
 * puts in appendices of their own by default (`defaultPlacement`).
 */
export const REPORT_CONTENTS_PRESETS: readonly ReportContentsPreset[] = [
  { id: 'every', label: 'Every section', omitted: [] },
  {
    id: 'short',
    label: 'Without the long schedules',
    omitted: ['sections', 'station-schedule', 'clearing', 'slope-stakes'],
  },
]

/** The built-in preset the choice matches (its sections and the usual order), or null. */
export function matchingReportPreset(
  omitted: readonly string[] | undefined,
  order: readonly string[] | undefined,
): string | null {
  if (storedSectionOrder(order ?? REPORT_ORDER)) return null
  const left = new Set(knownOmitted(omitted))
  const preset = REPORT_CONTENTS_PRESETS.find(
    (entry) => entry.omitted.length === left.size && entry.omitted.every((id) => left.has(id)),
  )
  return preset?.id ?? null
}

/** The report's left-out list and order after applying a saved preset's states and order. */
export function reportContentsFromSaved(
  preset: Pick<SavedContents, 'states' | 'order'>,
  current: { omittedSections?: readonly string[]; sectionOrder?: readonly string[] },
): { omittedSections: ReportSectionId[]; sectionOrder: ReportOrderId[] | undefined } {
  const states = Object.fromEntries(Object.entries(preset.states).filter(([key]) => IDS.includes(key)))
  return {
    omittedSections: omittedFromStates(current.omittedSections, states),
    sectionOrder: preset.order ? storedSectionOrder(preset.order) : (current.sectionOrder as ReportOrderId[]),
  }
}

/**
 * The order to store after the sections alone were reordered (the report package lists no
 * limitations): each section slot of the current order takes the next of `sections`, and the
 * limitations keep their place.
 */
export function withSectionSequence(
  stored: readonly string[] | undefined,
  sections: readonly string[],
): ReportOrderId[] | undefined {
  const next = sections.filter((id): id is ReportSectionId => IDS.includes(id))
  let at = 0
  const order = reportSectionOrder(stored).map((id) => (id === LIMITATIONS_PART ? id : (next[at++] ?? id)))
  return storedSectionOrder(order)
}
