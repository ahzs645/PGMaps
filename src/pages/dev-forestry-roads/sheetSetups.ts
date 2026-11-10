/**
 * Named sheet setups: the plot book's paper, chapters, scales, subviews, labels and report contents,
 * and the block map sheet's kind, paper, scale and typed title fields, kept under a name so one
 * office standard can be applied to any project. The library lives in this browser; a setup also
 * travels as a small JSON file, and a project file's plot-book settings can be read as one.
 * Nothing project-specific is kept: not the block a sheet shows, nor its access comments.
 * No DOM or network access; `SheetSetupLibrary.tsx` reads and writes browser storage.
 */
import { SHEET_PRESETS } from '@/lib/forestry/blockSheet/sheets'
import { PAPER_SIZES } from '@/lib/mapSheet/layout'
import { formatScale } from '@/lib/mapSheet/scale'
import { parseBlockSheetSettings, type BlockSheetSettings } from './blockSheet'
import { parseRoadReportSettings, REPORT_PAPERS, type RoadReportSettings } from './reportSettings'

export const SHEET_SETUP_SCHEMA = 'pgmaps-sheet-setup-v1'
export const SHEET_SETUP_LIBRARY_SCHEMA = 'pgmaps-sheet-setup-library-v1'
/** Setups this browser keeps; saving one more asks for one to be deleted first. */
export const MAX_SHEET_SETUPS = 30
export const MAX_SHEET_SETUP_NAME = 80
/** Largest file read as a setup: the project-file limit, since a project file's plot-book settings can be read. */
export const MAX_SHEET_SETUP_FILE_BYTES = 120_000_000

/** The block sheet's settings a setup keeps: everything except the block and its comments. */
export type BlockSheetSetup = Omit<BlockSheetSettings, 'block' | 'comments'>

export interface SheetSetup {
  schema: typeof SHEET_SETUP_SCHEMA
  name: string
  /** Date saved, YYYY-MM-DD. */
  savedOn: string
  plotBook?: RoadReportSettings
  blockSheet?: BlockSheetSetup
}

export interface SheetSetupLibrary {
  schema: typeof SHEET_SETUP_LIBRARY_SCHEMA
  setups: SheetSetup[]
}

export const emptySheetSetupLibrary = (): SheetSetupLibrary => ({ schema: SHEET_SETUP_LIBRARY_SCHEMA, setups: [] })

function setupName(raw: unknown): string {
  if (typeof raw !== 'string') throw Error('Name the setup.')
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!name || name.length > MAX_SHEET_SETUP_NAME)
    throw Error(`A setup name needs 1–${MAX_SHEET_SETUP_NAME} characters.`)
  return name
}

function blockSheetPart(raw: unknown): BlockSheetSetup {
  const parsed = parseBlockSheetSettings(raw)
  return { kind: parsed.kind, paper: parsed.paper, scale: parsed.scale, fields: parsed.fields }
}

const day = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** A setup from the current settings. At least one of the two parts is needed. */
export function createSheetSetup(
  name: string,
  parts: { plotBook?: RoadReportSettings; blockSheet?: BlockSheetSettings },
  today = new Date(),
): SheetSetup {
  if (!parts.plotBook && !parts.blockSheet) throw Error('There is no sheet setup to save.')
  return {
    schema: SHEET_SETUP_SCHEMA,
    name: setupName(name),
    savedOn: day(today),
    ...(parts.plotBook ? { plotBook: parseRoadReportSettings(parts.plotBook) } : {}),
    ...(parts.blockSheet ? { blockSheet: blockSheetPart(parts.blockSheet) } : {}),
  }
}

/** Reads one setup. Plot-book settings are checked as a project file checks them; an invalid part refuses the setup. */
export function parseSheetSetup(raw: unknown): SheetSetup {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('A sheet setup must be an object.')
  const r = raw as Record<string, unknown>
  if (r.schema !== SHEET_SETUP_SCHEMA) throw Error('This is not a PG Maps sheet setup.')
  if (r.plotBook === undefined && r.blockSheet === undefined) throw Error('The sheet setup holds no settings.')
  const savedOn = typeof r.savedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.savedOn) ? r.savedOn : ''
  return {
    schema: SHEET_SETUP_SCHEMA,
    name: setupName(r.name),
    savedOn,
    ...(r.plotBook === undefined ? {} : { plotBook: parseRoadReportSettings(r.plotBook) }),
    ...(r.blockSheet === undefined ? {} : { blockSheet: blockSheetPart(r.blockSheet) }),
  }
}

/** Reads the browser's library. A damaged entry is dropped, not the library; at most `MAX_SHEET_SETUPS` are kept. */
export function parseSheetSetupLibrary(raw: unknown): SheetSetupLibrary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptySheetSetupLibrary()
  const r = raw as Record<string, unknown>
  if (r.schema !== SHEET_SETUP_LIBRARY_SCHEMA || !Array.isArray(r.setups)) return emptySheetSetupLibrary()
  const setups: SheetSetup[] = []
  for (const entry of r.setups) {
    if (setups.length >= MAX_SHEET_SETUPS) break
    try {
      const setup = parseSheetSetup(entry)
      if (!setups.some((other) => sameName(other.name, setup.name))) setups.push(setup)
    } catch {
      // A damaged entry is left out; the others still load.
    }
  }
  return { schema: SHEET_SETUP_LIBRARY_SCHEMA, setups }
}

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0

/** The library with `setup` added, replacing one of the same name (ignoring case). Refuses past `MAX_SHEET_SETUPS`. */
export function saveSheetSetup(library: SheetSetupLibrary, setup: SheetSetup): SheetSetupLibrary {
  const others = library.setups.filter((entry) => !sameName(entry.name, setup.name))
  if (others.length >= MAX_SHEET_SETUPS)
    throw Error(`This browser keeps ${MAX_SHEET_SETUPS} sheet setups. Delete one before saving another.`)
  const replaced = others.length < library.setups.length
  const setups = replaced
    ? library.setups.map((entry) => (sameName(entry.name, setup.name) ? setup : entry))
    : [...library.setups, setup]
  return { schema: SHEET_SETUP_LIBRARY_SCHEMA, setups }
}

export function removeSheetSetup(library: SheetSetupLibrary, name: string): SheetSetupLibrary {
  return { schema: SHEET_SETUP_LIBRARY_SCHEMA, setups: library.setups.filter((entry) => !sameName(entry.name, name)) }
}

export const serializeSheetSetup = (setup: SheetSetup) => `${JSON.stringify(setup, null, 2)}\n`

/** A file name for a setup: its name, non-alphanumerics to `-`. */
export const sheetSetupFilename = (setup: SheetSetup) =>
  `${
    setup.name
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'sheet-setup'
  }.sheet-setup.json`

/**
 * A setup read from a file: a setup file, or a project file, whose plot-book settings become a setup
 * named after the project. A project file without plot-book settings has nothing to read.
 */
export function sheetSetupFromFile(text: string, today = new Date()): SheetSetup {
  if (text.length > MAX_SHEET_SETUP_FILE_BYTES) throw Error('That file is too large to be a sheet setup.')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw Error('That file is not JSON: choose a .sheet-setup.json or a .road.json file.')
  }
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  if (r.schema === 'pgmaps-road-project-v1') {
    if (r.reportSettings === undefined)
      throw Error('That project file has no plot-book settings of its own: it uses the defaults.')
    const name = typeof r.name === 'string' && r.name.trim() ? r.name : 'Project'
    return createSheetSetup(
      `${name.trim().slice(0, MAX_SHEET_SETUP_NAME - 9)} plot book`,
      {
        plotBook: parseRoadReportSettings(r.reportSettings),
      },
      today,
    )
  }
  return parseSheetSetup(raw)
}

/**
 * The settings after applying `setup`. Each part it holds replaces that part; the block sheet keeps
 * its block and comments, which belong to the project.
 */
export function applySheetSetup(
  setup: SheetSetup,
  current: { blockSheet: BlockSheetSettings },
): { plotBook?: RoadReportSettings; blockSheet?: BlockSheetSettings } {
  return {
    ...(setup.plotBook ? { plotBook: parseRoadReportSettings(setup.plotBook) } : {}),
    ...(setup.blockSheet
      ? {
          blockSheet: parseBlockSheetSettings({
            ...setup.blockSheet,
            block: current.blockSheet.block,
            comments: current.blockSheet.comments,
          }),
        }
      : {}),
  }
}

/** One line per part: what applying the setup sets. */
export function describeSheetSetup(setup: SheetSetup): string[] {
  const lines: string[] = []
  if (setup.plotBook) {
    const chapters = setup.plotBook.chapters.length
    const omitted = setup.plotBook.omittedSections?.length ?? 0
    lines.push(
      `Plot book: ${REPORT_PAPERS[setup.plotBook.paper].label}, ${chapters} chapter${chapters === 1 ? '' : 's'}${
        omitted ? `; report leaves out ${omitted} section${omitted === 1 ? '' : 's'}` : ''
      }`,
    )
  }
  if (setup.blockSheet) {
    const fields = Object.values(setup.blockSheet.fields).filter((value) => value?.trim()).length
    lines.push(
      `Block sheet: ${SHEET_PRESETS[setup.blockSheet.kind].label}, ${PAPER_SIZES[setup.blockSheet.paper].label}, ${
        setup.blockSheet.scale === 'fit' ? 'fit the block' : formatScale(setup.blockSheet.scale)
      }${fields ? `, ${fields} typed field${fields === 1 ? '' : 's'}` : ''}`,
    )
  }
  return lines
}
