import { reviewObject, reviewText, unwrapReview } from './submissionReview'

export type AdminRow = Record<string, unknown>
export type AdminColumn = { key: string; label: string; boolean?: boolean }

/** Build 6268M managers use native arrays. Do not turn denied/malformed replies into empty lists. */
export function adminRows(input: unknown): AdminRow[] {
  const value = unwrapReview(input)
  if (!Array.isArray(value) || value.length > 10000 || value.some((row) => !reviewObject(row)))
    throw new Error('Expected a source list of at most 10,000 records. The collection was not loaded.')
  return value as AdminRow[]
}

export function adminId(value: unknown): string | undefined {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^[1-9]\d*$/.test(String(value))) return
  return Number(value) <= 2147483647 ? String(value) : undefined
}

export function adminCell(value: unknown, boolean = false): string {
  if (value === undefined) return 'Not supplied'
  if (value === null) return 'Null'
  if (value === '') return 'Empty value'
  if (boolean) {
    if ([true, 1, '1', 't', 'true'].includes(value as string)) return 'Yes'
    if ([false, 0, '0', 'f', 'false'].includes(value as string)) return 'No'
  }
  return reviewText(value)
}

export function filterAdminRows(rows: AdminRow[], query: string, field = ''): AdminRow[] {
  const search = query.trim().toLocaleLowerCase()
  if (!search) return rows
  return rows.filter((row) =>
    (field ? [row[field]] : Object.values(row)).some((value) => reviewText(value).toLocaleLowerCase().includes(search)),
  )
}

export const SUBMISSION_COLUMNS: AdminColumn[] = [
  { key: 'sub_id', label: 'Submission ID' },
  { key: 'sub_title', label: 'Title' },
  { key: 'sub_name', label: 'Name' },
  { key: 'sub_state', label: 'State' },
]

/** SubmissionManager.js uses sub_id; research IDs and search-result IDs are different contracts. */
export function adminSubmissions(input: unknown): AdminRow[] {
  const rows = adminRows(input)
  const ids = new Set<string>()
  for (const row of rows) {
    const id = adminId(row.sub_id)
    if (!id || ids.has(id)) throw new Error('The submission catalogue has an invalid or duplicate source ID.')
    ids.add(id)
  }
  return rows
}

/** Dashboard.js sends the selected local calendar date as an ISO instant. */
export function scheduleDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid calendar date.')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    throw new Error('Choose a valid calendar date.')
  return date.toISOString()
}

export function localCalendarDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function calendarDays(month: string): (string | null)[] {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Choose a valid month.')
  scheduleDate(`${month}-01`)
  const [year, monthNumber] = month.split('-').map(Number)
  const offset = new Date(year, monthNumber - 1, 1).getDay()
  const days = new Date(year, monthNumber, 0).getDate()
  const cells: (string | null)[] = Array(offset).fill(null)
  for (let day = 1; day <= days; day++) cells.push(`${month}-${String(day).padStart(2, '0')}`)
  while (cells.length % 7) cells.push(null)
  return cells
}

export function scheduleMarkers(input: unknown): Map<string, string[]> {
  const markers = new Map<string, string[]>()
  for (const row of adminRows(input)) {
    if (typeof row.day !== 'string') throw new Error('The schedule has a missing calendar date.')
    scheduleDate(row.day)
    const colour = typeof row.colour === 'string' && /^[\da-f]{6}$/i.test(row.colour) ? `#${row.colour}` : ''
    markers.set(row.day, [...(markers.get(row.day) ?? []), colour])
  }
  return markers
}

/** Dashboard.js treats these as separate categories; a task may occur in both. */
export function scheduleNotifications(input: unknown): { newTasks: AdminRow[]; nearDeadline: AdminRow[] } {
  const value = unwrapReview(input)
  if (!reviewObject(value)) throw new Error('Expected source notification categories.')
  return { newTasks: adminRows(value.newTasks), nearDeadline: adminRows(value.nearDeadline) }
}

export const SYSTEM_RESOURCES = [
  {
    id: 'layers',
    title: 'Spatial layer registry',
    path: 'rest/portal/admin/getAllBaseLayers.php',
    description:
      'Registered sources and their original Base, Auto Add and Auto On defaults. A catalogue entry may expose multiple layers.',
    columns: [
      { key: 'baselayer_id', label: 'Source ID' },
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Source type' },
      { key: 'resource', label: 'Resource' },
      { key: 'layers', label: 'Layers' },
      { key: 'is_base', label: 'Base', boolean: true },
      { key: 'is_default', label: 'Auto Add', boolean: true },
      { key: 'is_on', label: 'Auto On', boolean: true },
      { key: 'attributions', label: 'Attribution' },
    ],
  },
  {
    id: 'flags',
    title: 'Submission status flags',
    path: 'rest/portal/getStatusFlags.php',
    description: 'The original submission status flag definitions.',
    columns: [
      { key: 'status_id', label: 'Status ID' },
      { key: 'status_desc', label: 'Description' },
    ],
  },
  {
    id: 'statuses',
    title: 'Task statuses',
    path: 'rest/portal/getTaskStatuses.php',
    description: 'Task status names, rank, colour and descriptions supplied by the source.',
    columns: [
      { key: 'status_id', label: 'Status ID' },
      { key: 'status_name', label: 'Name' },
      { key: 'rank', label: 'Rank' },
      { key: 'colour', label: 'Colour' },
      { key: 'description', label: 'Description' },
    ],
  },
  {
    id: 'priorities',
    title: 'Priorities',
    path: 'rest/portal/getPriorities.php',
    description: 'Original scheduling priority parameters, retained without applying or changing scheduling rules.',
    columns: [
      { key: 'priority_id', label: 'Priority ID' },
      { key: 'priority_description', label: 'Priority' },
      { key: 'start_date_delay', label: 'Start delay' },
      { key: 'duration', label: 'Duration' },
      { key: 'preferred_start_day', label: 'Preferred start day' },
      { key: 'preferred_end_day', label: 'Preferred end day' },
    ],
  },
  {
    id: 'holidays',
    title: 'Holidays',
    path: 'rest/portal/getHolidays.php',
    description:
      'Declared holiday dates. An empty returned list does not describe weekend or other server scheduling rules.',
    columns: [
      { key: 'holiday_id', label: 'Holiday ID' },
      { key: 'name', label: 'Name' },
      { key: 'date', label: 'Date' },
      { key: 'description', label: 'Description' },
    ],
  },
] satisfies { id: string; title: string; path: string; description: string; columns: AdminColumn[] }[]
