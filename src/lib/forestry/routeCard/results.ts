/**
 * A route card's rows as read for one subject, and as the sheet prints them.
 *
 * Every row ends in one of five states: read (Y, Within or N), still reading, failed, not public, or
 * entered by the person. A row that could not be read prints *Not read*, and one whose data is not
 * published prints *Not public* until the person enters it: neither is ever N, because N says the
 * layer was looked at and nothing was there. An entered row prints the person's answer and is marked
 * as theirs in every file. No DOM or network access.
 */
import { prepareSubject, type Planar, type PlanarBounds, type PreparedSubject } from './geometry'
import { measureRow, planReads, runRead, type RouteCardFinding } from './query'
import { presetReadRows, ROUTE_CARD_ROWS, type RouteCardPreset, type RouteCardRow } from './rows'

/** What the person entered for a row the tool cannot read. */
export type RouteCardEntry = {
  answer: 'yes' | 'near' | 'no'
  /** What the row prints after Y, as the person wrote it. */
  names: string
  /** Where it came from: "RAAD export, 2026-08-20", "BCTS LRM". */
  source?: string
}

export type RouteCardRowState =
  | { status: 'reading' }
  | { status: 'read'; finding: RouteCardFinding }
  | { status: 'failed'; error: string }
  | { status: 'notPublic' }

export type RouteCardSubject = {
  /** The block's or road's id in the scene. */
  id: string
  /** What the sheet's title cell prints. */
  name: string
  kind: 'block' | 'road'
  shape: Planar
}

/** What a printed row says, in the sheet's three columns plus who answered it. */
export type RouteCardPrintedRow = {
  id: string
  label: string
  /** Column C: "Y", "N", "Within 200 m of Block", "Not read", "Not public". */
  value: string
  /** Column D: the names, as the tool's sheet quotes them. */
  names: string
  /** The value is Y (the tool prints those rows bold). */
  flagged: boolean
  /** Read from a layer, PGMaps' estimate (`RouteCardRow.estimate`), entered by the reviewer, or not answered. */
  by: 'read' | 'estimated' | 'entered' | 'none'
  /** Why a row is Not read or Not public, or where an entry came from; also PGMaps' names for Within rows. */
  note: string
}

/**
 * A list as the route card tool's sheet prints it: each value in single quotes, or double quotes when
 * it holds an apostrophe, joined with ", " (`'TR0000T000'`, `"Made-up T'en Nation"`).
 */
export function quotedList(values: readonly string[]): string {
  return values
    .map((value) => (value.includes("'") && !value.includes('"') ? `"${value}"` : `'${value.replace(/'/g, "\\'")}'`))
    .join(', ')
}

export const withinLabel = (meters: number, subject: RouteCardSubject['kind']) =>
  // The tool prints "of Block" on road reports too; PGMaps names what was measured.
  `Within ${meters.toLocaleString('en-CA')} m of ${subject === 'road' ? 'Road' : 'Block'}`

const answerValue = (answer: RouteCardEntry['answer'], row: RouteCardRow, subject: RouteCardSubject['kind']) =>
  answer === 'yes' ? 'Y' : answer === 'no' ? 'N' : withinLabel(row.search.nearWithinMeters ?? 200, subject)

/** One row as the sheet prints it. */
export function printRow(
  row: RouteCardRow,
  state: RouteCardRowState | undefined,
  entry: RouteCardEntry | undefined,
  subject: RouteCardSubject['kind'],
): RouteCardPrintedRow {
  const base = { id: row.id, label: row.label }
  // The reviewer's entry stands over a row no layer answers and over PGMaps' estimate.
  if (entry && (row.source.kind === 'notPublic' || row.estimate))
    return {
      ...base,
      value: answerValue(entry.answer, row, subject),
      names: entry.answer === 'yes' ? entry.names.trim() : '',
      flagged: entry.answer === 'yes',
      by: 'entered',
      note: `Entered by the reviewer${entry.source?.trim() ? ` from ${entry.source.trim()}` : ''}.`,
    }
  if (row.source.kind === 'notPublic') {
    if (entry)
      return {
        ...base,
        value: answerValue(entry.answer, row, subject),
        names: entry.answer === 'yes' ? entry.names.trim() : '',
        flagged: entry.answer === 'yes',
        by: 'entered',
        note: `Entered by the reviewer${entry.source?.trim() ? ` from ${entry.source.trim()}` : ''}.`,
      }
    return { ...base, value: 'Not public', names: '', flagged: false, by: 'none', note: row.source.reason }
  }
  if (!state || state.status === 'reading')
    return {
      ...base,
      value: 'Not read',
      names: '',
      flagged: false,
      by: 'none',
      note: 'Still reading when this was written.',
    }
  if (state.status === 'failed')
    return {
      ...base,
      value: 'Not read',
      names: '',
      flagged: false,
      by: 'none',
      note: `Could not be read: ${state.error}`,
    }
  if (state.status === 'notPublic')
    return { ...base, value: 'Not public', names: '', flagged: false, by: 'none', note: '' }
  const { finding } = state
  const partial = finding.truncated ? ' The layer held more features than one answer returns: some may be missing.' : ''
  const unconfirmed = row.confirmed ? '' : ' Layer not yet confirmed against the route card tool.'
  return {
    ...base,
    value: answerValue(finding.answer, row, subject),
    names: finding.answer === 'yes' ? quotedList(finding.names) : '',
    flagged: finding.answer === 'yes',
    by: row.estimate ? 'estimated' : 'read',
    note: `${row.estimate ? `Estimated: ${row.note ?? 'PGMaps’ estimate, not the source’s own answer.'} ` : ''}${finding.answer === 'near' && finding.nearNames.length ? `Nearby: ${finding.nearNames.join('; ')}.` : ''}${partial}${unconfirmed}`.trim(),
  }
}

export type RouteCardSheet = {
  title: string
  sections: Array<{ title: string; rows: RouteCardPrintedRow[] }>
}

/** The whole sheet for a preset. */
export function routeCardSheet(
  preset: RouteCardPreset,
  subject: Pick<RouteCardSubject, 'name' | 'kind'>,
  states: Readonly<Record<string, RouteCardRowState>>,
  entries: Readonly<Record<string, RouteCardEntry>> = {},
  rows: readonly RouteCardRow[] = ROUTE_CARD_ROWS,
): RouteCardSheet {
  return {
    title: subject.name,
    sections: preset.sections.map((section) => ({
      title: section.title,
      rows: section.rows.map((id) => {
        const row = rows.find((candidate) => candidate.id === id)!
        return printRow(row, states[id], entries[id], subject.kind)
      }),
    })),
  }
}

/** How many rows are flagged, still reading, failed and not public. */
export function routeCardCounts(sheet: RouteCardSheet) {
  const all = sheet.sections.flatMap((section) => section.rows)
  return {
    rows: all.length,
    flagged: all.filter((row) => row.flagged).length,
    within: all.filter((row) => row.value.startsWith('Within')).length,
    notRead: all.filter((row) => row.value === 'Not read').length,
    notPublic: all.filter((row) => row.value === 'Not public').length,
    entered: all.filter((row) => row.by === 'entered').length,
    estimated: all.filter((row) => row.by === 'estimated').length,
  }
}

/**
 * Reads every row a preset uses for one subject, reporting each row as its read lands, so a slow
 * or failed layer never holds the others. Rows sharing a layer share its read.
 */
export async function runRouteCard(
  preset: RouteCardPreset,
  subject: RouteCardSubject,
  fetcher: typeof fetch,
  onRow: (id: string, state: RouteCardRowState) => void,
  options: {
    signal?: AbortSignal
    rows?: readonly RouteCardRow[]
    concurrency?: number
    /** The block's access road: its layers are read along it too, for the considerations' crossings. */
    access?: Planar | null
  } = {},
): Promise<void> {
  const rows = presetReadRows(preset, options.rows ?? ROUTE_CARD_ROWS)
  const prepared: PreparedSubject = prepareSubject(subject.shape)
  const access = options.access ? prepareSubject(options.access) : null
  const bounds: PlanarBounds = access
    ? [
        Math.min(prepared.bounds[0], access.bounds[0]),
        Math.min(prepared.bounds[1], access.bounds[1]),
        Math.max(prepared.bounds[2], access.bounds[2]),
        Math.max(prepared.bounds[3], access.bounds[3]),
      ]
    : prepared.bounds
  for (const row of rows)
    onRow(row.id, row.source.kind === 'notPublic' ? { status: 'notPublic' } : { status: 'reading' })
  const reads = planReads(rows)
  let next = 0
  const lane = async () => {
    while (next < reads.length) {
      const read = reads[next++]
      if (options.signal?.aborted) return
      try {
        const { features, truncated } = await runRead(read, bounds, fetcher, options.signal)
        for (const id of read.rows) {
          const row = rows.find((candidate) => candidate.id === id)!
          onRow(id, { status: 'read', finding: measureRow(row, prepared, features, truncated, access) })
        }
      } catch (error) {
        if (options.signal?.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        for (const id of read.rows) onRow(id, { status: 'failed', error: message })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 6) }, lane))
}
