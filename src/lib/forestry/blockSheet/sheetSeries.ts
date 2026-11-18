/**
 * A series of block map sheets: one sheet per block, written as one multi-page PDF or a ZIP of one
 * PDF, SVG or PNG a block (docs/forestry-block-map-sheets.md, **Sheet series**). The tool lists its
 * blocks and builds each page through its own `buildSheet` call; this module orders and picks the
 * pages, fills the name tokens in typed fields and file names, keeps file names unique and safe,
 * and runs the pages one after another with progress and Cancel. A page that cannot be built is
 * left out by name, never silently. No DOM or network access (jsPDF and the PNG rasteriser are
 * passed in through `SheetFileDeps`).
 */
import { zipSync } from 'fflate'
import { encodeSheetImages } from '@/lib/mapSheet/png'
import { addSheetPage, createSheetPdf, drawSheetPdf } from '@/lib/mapSheet/renderPdf'
import {
  isSheetFormat,
  SHEET_FORMAT_INFO,
  sheetFile,
  type SheetFileDeps,
  type SheetFormat,
  type SheetPicture,
} from '@/lib/mapSheet/sheetFormats'

/** Most pages one series writes. A larger choice is refused before any page is built. */
export const MAX_SHEET_SERIES_PAGES = 50
/** Longest file name a page gets, characters before the extension. */
export const MAX_SERIES_FILE_NAME_LENGTH = 100
/** The default pattern for each page's file name in a ZIP. */
export const DEFAULT_SERIES_FILE_NAME = '{page}-{name}'
/** Holds what a ZIP's pages were written without; added only when there is something to say. */
export const SERIES_NOTES_FILE = 'notes.txt'

export type SeriesValue = string | number | boolean | null | undefined

/** A block a tool offers for a series: a stable id, the name printed and its attributes. */
export interface SheetSeriesBlock {
  id: string
  name: string
  /** Read by `{attr:FIELD}`, e.g. the block's cutting permit or licence. */
  attributes?: Readonly<Record<string, SeriesValue>>
}

export interface SheetSeriesPage<B extends SheetSeriesBlock = SheetSeriesBlock> {
  block: B
  id: string
  name: string
  /** 1-based position in the series. */
  number: number
  total: number
}

export type SheetSeriesOrder = 'listed' | 'name'
export const SHEET_SERIES_ORDERS: readonly { value: SheetSeriesOrder; label: string }[] = [
  { value: 'listed', label: 'As listed' },
  { value: 'name', label: 'By name' },
]

/** Sorts names as people read them: "Block 2" before "Block 10", case and accents ignored. */
const NATURAL = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Which blocks a series takes: every block the tool lists, or these ids. */
export type SheetSeriesSelection = 'all' | readonly string[]

/**
 * The series' pages: the chosen blocks (ids no longer listed are ignored), each id once, in the
 * tool's order or by name, numbered from 1.
 */
export function seriesPages<B extends SheetSeriesBlock>(
  blocks: readonly B[],
  { order = 'listed', selected = 'all' }: { order?: SheetSeriesOrder; selected?: SheetSeriesSelection } = {},
): SheetSeriesPage<B>[] {
  const wanted = selected === 'all' ? null : new Set(selected)
  const seen = new Set<string>()
  const chosen = blocks.filter((block) => {
    if (seen.has(block.id) || (wanted && !wanted.has(block.id))) return false
    seen.add(block.id)
    return true
  })
  if (order === 'name') chosen.sort((a, b) => NATURAL.compare(a.name, b.name) || blocks.indexOf(a) - blocks.indexOf(b))
  return chosen.map((block, i) => ({ block, id: block.id, name: block.name, number: i + 1, total: chosen.length }))
}

/** The tokens a typed field or a file name pattern can hold, for the form's explanation. */
export const SERIES_TOKENS: readonly { token: string; means: string }[] = [
  { token: '{name}', means: "the block's name" },
  { token: '{page}', means: 'the page number, from 1' },
  { token: '{total}', means: 'how many pages the series has' },
  { token: '{attr:FIELD}', means: "the block's FIELD attribute, e.g. {attr:CP}" },
]

const TOKEN = /\{([A-Za-z]+)(?::([^{}]*))?\}/g

function attributeOf(page: Pick<SheetSeriesPage, 'block'>, field: string): { found: boolean; value: SeriesValue } {
  const attributes = page.block.attributes ?? {}
  if (Object.prototype.hasOwnProperty.call(attributes, field)) return { found: true, value: attributes[field] }
  const key = Object.keys(attributes).find((name) => name.toLowerCase() === field.toLowerCase())
  return key === undefined ? { found: false, value: undefined } : { found: true, value: attributes[key] }
}

/**
 * `text` with its tokens filled for `page`. A token PGMaps does not know, or an attribute the block
 * does not have, is left as typed so the sheet shows it; an attribute the block has but leaves
 * blank fills in empty.
 */
export function fillSeriesTokens(text: string, page: SheetSeriesPage): string {
  return text.replace(TOKEN, (whole, token: string, argument: string | undefined) => {
    const name = token.toLowerCase()
    if (argument === undefined) {
      if (name === 'name') return page.name
      if (name === 'page') return String(page.number)
      if (name === 'total') return String(page.total)
      return whole
    }
    if (name !== 'attr' || !argument.trim()) return whole
    const { found, value } = attributeOf(page, argument.trim())
    return found ? (value === null || value === undefined ? '' : String(value)) : whole
  })
}

/**
 * The tokens in `text` that will not fill: unknown names, and attributes none of `blocks` has.
 * For the form, so a typo is seen before the sheets are written.
 */
export function unfilledSeriesTokens(text: string, blocks: readonly SheetSeriesBlock[]): string[] {
  const problems: string[] = []
  for (const match of text.matchAll(TOKEN)) {
    const [whole, token, argument] = match
    const name = token.toLowerCase()
    const known =
      argument === undefined
        ? name === 'name' || name === 'page' || name === 'total'
        : name === 'attr' && !!argument.trim() && blocks.some((block) => attributeOf({ block }, argument.trim()).found)
    if (!known && !problems.includes(whole)) problems.push(whole)
  }
  return problems
}

/** Every string value of `fields` with its tokens filled for `page`; other values pass through. */
export function fillSeriesFields<T extends Readonly<Record<string, string | undefined>>>(
  fields: T,
  page: SheetSeriesPage,
): T {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === 'string' ? fillSeriesTokens(value, page) : value,
    ]),
  ) as T
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * A name safe on Windows, macOS and Linux and in a ZIP: letters, digits, spaces turned to "-",
 * ".", "_", "-", "(", ")" and "+"; anything else becomes "-". Leading and trailing dots and dashes
 * go, reserved device names gain "_", and the result is cut to `MAX_SERIES_FILE_NAME_LENGTH`.
 * Empty after all that, it is `fallback`.
 */
export function safeFileName(name: string, fallback: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}._()+\- ]+/gu, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MAX_SERIES_FILE_NAME_LENGTH)
    .replace(/[-.]+$/g, '')
  if (!cleaned) return fallback === name ? 'sheet' : safeFileName(fallback, 'sheet')
  return WINDOWS_RESERVED.test(cleaned.split('.')[0]) ? `${cleaned}_` : cleaned
}

/**
 * Names made unique the way a file system compares them (case and trailing dots ignored): a repeat
 * gains "-2", "-3", … before the extension, so no page overwrites another when the ZIP is unpacked.
 */
export function uniqueFileNames(names: readonly string[], extension: string): string[] {
  const used = new Set<string>()
  const key = (name: string) => name.normalize('NFC').toLowerCase()
  return names.map((base) => {
    let name = base
    for (let suffix = 2; used.has(key(name)); suffix++) name = `${base}-${suffix}`
    used.add(key(name))
    return `${name}.${extension}`
  })
}

/** Each page's file name from `pattern`: tokens filled, made safe and unique, with `extension`. */
export function seriesFileNames(pattern: string, pages: readonly SheetSeriesPage[], extension: string): string[] {
  return uniqueFileNames(
    pages.map((page) =>
      safeFileName(fillSeriesTokens(pattern.trim() || DEFAULT_SERIES_FILE_NAME, page), `sheet-${page.number}`),
    ),
    extension,
  )
}

// ---- Output settings, as the shared form edits them ----

/** One multi-page PDF, or a ZIP of one file a page. SVG and PNG series are always a ZIP. */
export type SheetSeriesBundle = 'pdf' | 'zip'

export interface SheetOutputSettings {
  format: SheetFormat
  /** One sheet per block, rather than one sheet of the chosen block. */
  series: boolean
  /** The blocks in the series: every block the tool lists (new ones included), or these ids. */
  blocks: 'all' | string[]
  order: SheetSeriesOrder
  /** Each page's file name in a ZIP, with tokens. */
  fileName: string
  bundle: SheetSeriesBundle
  /** Dim the map outside the block of interest (`ComposeInput.maskOutsideBlock`). */
  mask: boolean
}

export const DEFAULT_SHEET_OUTPUT: SheetOutputSettings = {
  format: 'pdf',
  series: false,
  blocks: 'all',
  order: 'listed',
  fileName: DEFAULT_SERIES_FILE_NAME,
  bundle: 'pdf',
  mask: false,
}

/** Validates settings read back from browser storage; anything unknown takes the default. */
export function parseSheetOutputSettings(raw: unknown): SheetOutputSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SHEET_OUTPUT
  const r = raw as Record<string, unknown>
  return {
    format: isSheetFormat(r.format) ? r.format : DEFAULT_SHEET_OUTPUT.format,
    series: r.series === true,
    blocks: Array.isArray(r.blocks)
      ? [...new Set(r.blocks.filter((id): id is string => typeof id === 'string').map((id) => id.slice(0, 200)))]
      : 'all',
    order: r.order === 'name' ? 'name' : 'listed',
    fileName:
      typeof r.fileName === 'string' && r.fileName.trim()
        ? r.fileName.slice(0, MAX_SERIES_FILE_NAME_LENGTH * 2)
        : DEFAULT_SERIES_FILE_NAME,
    bundle: r.bundle === 'zip' ? 'zip' : 'pdf',
    mask: r.mask === true,
  }
}

/** What a series is written as: one PDF only for PDF pages bundled as one. */
export const seriesContainer = (settings: Pick<SheetOutputSettings, 'format' | 'bundle'>): 'pdf' | 'zip' =>
  settings.format === 'pdf' && settings.bundle === 'pdf' ? 'pdf' : 'zip'

// ---- Running a series ----

export interface SheetSeriesProgress {
  /** Pages finished, built or left out. */
  done: number
  total: number
  /** The page being built, or null once every page is done. */
  page: string | null
}

/** Takes each page as it is built, so only one page's drawing is held at a time. */
export interface SheetSeriesWriter {
  add(page: SheetSeriesPage, sheet: SheetPicture, fileName: string, signal?: AbortSignal): Promise<void>
  /** The file, given what the pages were written without (`SheetSeriesResult.notes`). */
  finish(notes: readonly string[]): Promise<Blob>
}

export interface BuiltSeriesPage {
  sheet: SheetPicture
  /** What the page wanted and could not draw, each a sentence (`BuiltSheet.missing`). */
  missing: readonly string[]
}

export interface SheetSeriesResult {
  blob: Blob
  /** Pages written. */
  written: number
  /** What written pages were drawn without, under each page's name. */
  missing: { page: string; sentences: string[] }[]
  /** Pages that could not be built, by name, with the reason. */
  leftOut: { page: string; reason: string }[]
  /** Every left-out page and missing sentence as one line each, for the tool's notes. */
  notes: string[]
}

const isAbort = (cause: unknown, signal?: AbortSignal) =>
  signal?.aborted || (cause instanceof Error && cause.name === 'AbortError')
const reasonOf = (cause: unknown) => (cause instanceof Error && cause.message ? cause.message : String(cause))

/**
 * Builds and writes the pages one after another. A page whose `build` throws is left out and named
 * with its reason in `leftOut` and `notes` (and in a ZIP's `SERIES_NOTES_FILE`): one block without
 * terrain should not cost the rest of a long series. Cancel (the signal, or an `AbortError` from a
 * page) stops the whole series, and a series where no page could be built is an error naming each.
 */
export async function runSheetSeries(run: {
  pages: readonly SheetSeriesPage[]
  fileNames: readonly string[]
  build: (page: SheetSeriesPage, signal?: AbortSignal) => Promise<BuiltSeriesPage>
  writer: SheetSeriesWriter
  signal?: AbortSignal
  onProgress?: (progress: SheetSeriesProgress) => void
}): Promise<SheetSeriesResult> {
  const { pages, signal } = run
  if (!pages.length) throw Error('Choose at least one block for the series.')
  if (pages.length > MAX_SHEET_SERIES_PAGES)
    throw Error(
      `A series is at most ${MAX_SHEET_SERIES_PAGES} sheets; ${pages.length} blocks are chosen. Choose fewer blocks.`,
    )
  const missing: SheetSeriesResult['missing'] = []
  const leftOut: SheetSeriesResult['leftOut'] = []
  let written = 0
  for (const [i, page] of pages.entries()) {
    if (signal?.aborted) throw new DOMException('Sheet series cancelled.', 'AbortError')
    run.onProgress?.({ done: i, total: pages.length, page: page.name })
    let built: BuiltSeriesPage
    try {
      built = await run.build(page, signal)
    } catch (cause) {
      if (isAbort(cause, signal)) throw cause
      leftOut.push({ page: page.name, reason: reasonOf(cause) })
      continue
    }
    await run.writer.add(page, built.sheet, run.fileNames[i], signal)
    written++
    if (built.missing.length) missing.push({ page: page.name, sentences: [...built.missing] })
  }
  if (!written)
    throw Error(`No sheet could be made. ${leftOut.map((entry) => `${entry.page}: ${entry.reason}`).join(' ')}`)
  run.onProgress?.({ done: pages.length, total: pages.length, page: null })
  const notes = [
    ...leftOut.map((entry) => `${entry.page} left out: ${entry.reason}`),
    ...missing.flatMap((entry) => entry.sentences.map((sentence) => `${entry.page}: ${sentence}`)),
  ]
  return { blob: await run.writer.finish(notes), written, missing, leftOut, notes }
}

/** One PDF, a page a sheet; each page keeps its own paper size. */
export function pdfSeriesWriter(deps: SheetFileDeps): SheetSeriesWriter {
  const module = deps.jspdf
  if (!module) throw Error('PDF output needs jsPDF.')
  let pdf: ReturnType<typeof createSheetPdf> | null = null
  let fonts: ReturnType<NonNullable<SheetFileDeps['configurePdf']>>
  return {
    async add(_page, sheet, _fileName, signal) {
      const ops = await encodeSheetImages(sheet.ops)
      if (signal?.aborted) throw new DOMException('Sheet series cancelled.', 'AbortError')
      if (!pdf) {
        pdf = createSheetPdf(module, sheet.width, sheet.height)
        fonts = deps.configurePdf?.(pdf)
      } else addSheetPage(pdf, sheet.width, sheet.height)
      drawSheetPdf(pdf, module, ops, fonts)
    },
    async finish() {
      if (!pdf) throw Error('The series has no pages.')
      return new Blob([pdf.output('arraybuffer')], { type: SHEET_FORMAT_INFO.pdf.mime })
    },
  }
}

/** A ZIP of one file a sheet in `format`, and `SERIES_NOTES_FILE` when a page was left out or drawn without something. */
export function zipSeriesWriter(format: SheetFormat, deps: SheetFileDeps): SheetSeriesWriter {
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  return {
    async add(page, sheet, fileName, signal) {
      const blob = await sheetFile(sheet, format, deps, { title: page.name, signal })
      // PDF and PNG are compressed already; SVG text deflates well.
      files[fileName] = [new Uint8Array(await blob.arrayBuffer()), { level: format === 'svg' ? 6 : 0 }]
    },
    async finish(notes) {
      if (notes.length) files[SERIES_NOTES_FILE] = [new TextEncoder().encode(`${notes.join('\n')}\n`), { level: 6 }]
      const zipped = zipSync(files)
      return new Blob([zipped as BlobPart], { type: 'application/zip' })
    },
  }
}

/**
 * The whole series from a tool's settings: pages from `blocks`, file names from
 * `settings.fileName`, a multi-page PDF or a ZIP (`seriesContainer`), each page built by `build`.
 * `build` receives the page; fill its typed fields with `fillSeriesFields` and frame its block.
 */
export async function writeSheetSeries<B extends SheetSeriesBlock>(input: {
  blocks: readonly B[]
  settings: Pick<SheetOutputSettings, 'format' | 'blocks' | 'order' | 'fileName' | 'bundle'>
  build: (page: SheetSeriesPage<B>, signal?: AbortSignal) => Promise<BuiltSeriesPage>
  deps: SheetFileDeps
  signal?: AbortSignal
  onProgress?: (progress: SheetSeriesProgress) => void
}): Promise<SheetSeriesResult & { container: 'pdf' | 'zip' }> {
  const { settings } = input
  const pages = seriesPages(input.blocks, { order: settings.order, selected: settings.blocks })
  const container = seriesContainer(settings)
  const result = await runSheetSeries({
    pages,
    fileNames: seriesFileNames(settings.fileName, pages, SHEET_FORMAT_INFO[settings.format].extension),
    build: (page, signal) => input.build(page as SheetSeriesPage<B>, signal),
    writer: container === 'pdf' ? pdfSeriesWriter(input.deps) : zipSeriesWriter(settings.format, input.deps),
    signal: input.signal,
    onProgress: input.onProgress,
  })
  return { ...result, container }
}
