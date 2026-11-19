/**
 * The report package: one main PDF and, for each part the user puts in an appendix, a PDF of its
 * own. Every part (a report section, a plot-book chapter, a block map sheet) is placed in the
 * package, in an appendix or left out; the choice is saved with the project's report settings
 * (`RoadReportSettings.package`). This module decides which file holds what and words the contents;
 * the page renders the parts with the existing report, plot-book and sheet renderers and
 * `reportPackagePdf.ts` merges them. No DOM or network access.
 */
import { SHEET_KINDS, SHEET_PRESETS, type SheetKind } from '@/lib/forestry/blockSheet/sheets'
import { parseChartsOverride, type ChartsOptions } from './chartsOptions'
import { orderedKeys } from '@/lib/documentContents/contents'
import { orderedReportSections, REPORT_SECTIONS, type ReportSectionId } from './reportContents'

export const PACKAGE_PLACEMENTS = ['main', 'appendix', 'omit'] as const
export type PackagePlacement = (typeof PACKAGE_PLACEMENTS)[number]
export const PLACEMENT_LABELS: Record<PackagePlacement, string> = {
  main: 'In package',
  appendix: 'Appendix (separate PDF)',
  omit: 'Leave out',
}

/** Plot-book chapter kinds, as `REPORT_CHAPTER_KINDS` (listed here so the two modules do not import each other). */
export const PACKAGE_CHAPTERS = [
  'charts',
  'plan-profile',
  'sections',
  'schedule',
  'curves',
  'structures',
  'materials',
  'stakes',
  'clearing',
] as const
export type PackageChapter = (typeof PACKAGE_CHAPTERS)[number]
const CHAPTER_LABELS: Record<PackageChapter, string> = {
  charts: 'Profile, grade & mass haul',
  'plan-profile': 'Plan & profile sheets',
  sections: 'Cross-section sheets',
  schedule: 'Station schedule sheets',
  curves: 'Horizontal curve table',
  structures: 'Culvert inventory',
  materials: 'Material quantities',
  stakes: 'Slope-stake book',
  clearing: 'Clearing schedule',
}

export type PackagePartId = `report:${ReportSectionId}` | `plotbook:${PackageChapter}` | `sheet:${SheetKind}`
export interface PackagePart {
  id: PackagePartId
  group: 'report' | 'plotbook' | 'sheet'
  key: string
  label: string
}
export const PACKAGE_GROUP_LABELS: Record<PackagePart['group'], string> = {
  report: 'Report sections',
  plotbook: 'Plot-book chapters (A3 sheets)',
  sheet: 'Block map sheets (one per package, not per road)',
}

export const PACKAGE_PARTS: readonly PackagePart[] = [
  ...REPORT_SECTIONS.map((s) => ({
    id: `report:${s.id}` as const,
    group: 'report' as const,
    key: s.id,
    label: s.label,
  })),
  ...PACKAGE_CHAPTERS.map((c) => ({
    id: `plotbook:${c}` as const,
    group: 'plotbook' as const,
    key: c,
    label: CHAPTER_LABELS[c],
  })),
  ...SHEET_KINDS.map((k) => ({
    id: `sheet:${k}` as const,
    group: 'sheet' as const,
    key: k,
    label: SHEET_PRESETS[k].label,
  })),
]

/**
 * Where a part goes when the user has not chosen. Long schedules go to appendices; the whole-road
 * charts and the 250 m plan-and-profile sheets are in the package; one block sheet, the field layout.
 */
export function defaultPlacement(id: PackagePartId): PackagePlacement {
  if (
    id === 'report:sections' ||
    id === 'report:station-schedule' ||
    id === 'report:clearing' ||
    id === 'report:slope-stakes' ||
    id === 'plotbook:sections'
  )
    return 'appendix'
  if (id.startsWith('report:')) return 'main'
  if (id === 'plotbook:charts' || id === 'plotbook:plan-profile') return 'main'
  if (id === 'sheet:field-layout') return 'main'
  return 'omit'
}

/** What the main file opens with: a cover listing its contents, or a summary of the roads. */
export const PACKAGE_FRONTS = ['cover', 'summary'] as const
export type PackageFront = (typeof PACKAGE_FRONTS)[number]
export const FRONT_LABELS: Record<PackageFront, string> = {
  cover: 'Cover with contents',
  summary: 'Summary of the roads',
}
/** The summary page's sections, in print order (`packageSummary.ts`). */
export const SUMMARY_SECTIONS = [
  'figures',
  'grades',
  'findings',
  'roads',
  'costChart',
  'costTable',
  'openItems',
  'contents',
] as const
export type SummarySection = (typeof SUMMARY_SECTIONS)[number]
export const SUMMARY_SECTION_LABELS: Record<SummarySection, string> = {
  figures: 'Key figures',
  grades: 'Grade figures (average, steepest, over the limit)',
  findings: 'Findings',
  roads: 'Road summary table',
  costChart: 'Cost by category chart',
  costTable: 'Cost breakdown table',
  openItems: 'Open items (checks needing attention)',
  contents: 'Contents of the package',
}

/**
 * What the package does with a company slope sheet (`slopeSheetCheck.ts`), when the project has one:
 * nothing, the check beside each road's estimate, or the check and the high case that full-benches
 * the stretches the sheet shows steeper (`slopeSheetCase.ts`). Absent is the check.
 */
export const SLOPE_SHEET_MODES = ['off', 'check', 'range'] as const
export type SlopeSheetMode = (typeof SLOPE_SHEET_MODES)[number]
export const SLOPE_SHEET_MODE_LABELS: Record<SlopeSheetMode, string> = {
  off: 'Not on the summary',
  check: 'Check beside the estimate',
  range: 'Check and high case',
}

export interface ReportPackageSettings {
  /** Only the parts the user changed from `defaultPlacement`. */
  parts: Partial<Record<PackagePartId, PackagePlacement>>
  /** Absent opens with the cover. */
  front?: PackageFront
  /** Summary sections switched off; absent prints them all. */
  summaryOff?: SummarySection[]
  /** False prints every summary figure and total before contingency. Absent includes it. */
  contingency?: boolean
  /**
   * Chart options the package's profile, grade and mass-haul sheets use over the plot book's own
   * (`ChartsOptions`): the Simplified preset leaves out mass haul and adds 200 m statistics.
   */
  charts?: Partial<ChartsOptions>
  /** The slope sheet's place in the summary. Absent is `check`. */
  slopeSheet?: SlopeSheetMode
  /**
   * Prints the low, medium and high estimate of each road on the summary (`estimateRange.ts`), with
   * the report settings' `estimate` allowances. Absent prints no range.
   */
  range?: boolean
  /**
   * The order of the plot-book chapters and the block sheets in the package, when the user moved one:
   * their part ids, read with unknown ids dropped and new parts in their usual place. The report
   * sections follow the report's own order (`RoadReportSettings.sectionOrder`).
   */
  order?: PackagePartId[]
}

/**
 * The preliminary estimate's settings (`RoadReportSettings.estimate`), shared by the Preliminary
 * estimate export and the package summary's range: the person's allowances, never workspace
 * defaults (a blank one is counted and named, not priced), and whether the export counts
 * contingency (the package uses its own choice).
 */
export interface EstimateSettings {
  crossDrainSpacingM?: number
  crossDrainCost?: number
  endHaulRate?: number
  /** False prints the export's figures before contingency. Absent includes it. */
  contingency?: boolean
}
/** The allowances alone. */
export type RangeOptions = Omit<EstimateSettings, 'contingency'>
export const RANGE_LIMITS = {
  crossDrainSpacingM: [10, 1000],
  crossDrainCost: [0, 1_000_000],
  endHaulRate: [0, 1000],
} as const

export const slopeSheetMode = (settings: ReportPackageSettings | undefined): SlopeSheetMode =>
  settings?.slopeSheet ?? 'check'
export const packageFront = (settings: ReportPackageSettings | undefined): PackageFront => settings?.front ?? 'cover'
export const summaryShows = (settings: ReportPackageSettings | undefined, section: SummarySection) =>
  !settings?.summaryOff?.includes(section)
export const includesContingency = (settings: ReportPackageSettings | undefined) => settings?.contingency !== false

export function placementOf(settings: ReportPackageSettings | undefined, id: PackagePartId): PackagePlacement {
  return settings?.parts[id] ?? defaultPlacement(id)
}

/** A copy with one part moved, keeping only the parts that differ from their default. */
export function withPlacement(
  settings: ReportPackageSettings | undefined,
  id: PackagePartId,
  placement: PackagePlacement,
): ReportPackageSettings {
  const parts = { ...(settings?.parts ?? {}) }
  if (placement === defaultPlacement(id)) delete parts[id]
  else parts[id] = placement
  return { ...settings, parts }
}

/** A copy with the front page or a summary option changed, dropping whatever equals its default. */
export function withSummary(
  settings: ReportPackageSettings | undefined,
  changes: {
    front?: PackageFront
    section?: [SummarySection, boolean]
    contingency?: boolean
    charts?: Partial<ChartsOptions>
    slopeSheet?: SlopeSheetMode
    range?: boolean
  },
): ReportPackageSettings {
  const next: ReportPackageSettings = { parts: {}, ...settings }
  if (changes.front) next.front = changes.front
  if (changes.charts) next.charts = { ...next.charts, ...changes.charts }
  if (changes.contingency !== undefined) next.contingency = changes.contingency
  if (changes.slopeSheet) next.slopeSheet = changes.slopeSheet
  if (changes.range !== undefined) next.range = changes.range
  if (changes.section) {
    const [section, on] = changes.section
    const off = new Set(next.summaryOff ?? [])
    if (on) off.delete(section)
    else off.add(section)
    next.summaryOff = SUMMARY_SECTIONS.filter((id) => off.has(id))
  }
  return tidy(next)
}

function tidy(settings: ReportPackageSettings): ReportPackageSettings {
  const out: ReportPackageSettings = { parts: settings.parts }
  if (settings.front && settings.front !== 'cover') out.front = settings.front
  if (settings.summaryOff?.length) out.summaryOff = settings.summaryOff
  if (settings.contingency === false) out.contingency = false
  if (settings.charts && Object.keys(settings.charts).length) out.charts = settings.charts
  if (settings.slopeSheet && settings.slopeSheet !== 'check') out.slopeSheet = settings.slopeSheet
  if (settings.range) out.range = true
  const order = storedPackageOrder(settings.order)
  if (order) out.order = order
  return out
}

/** The parts whose order the package keeps itself: the plot-book chapters and the block sheets. */
const ORDERED_PART_IDS: readonly PackagePartId[] = PACKAGE_PARTS.filter((part) => part.group !== 'report').map(
  (part) => part.id,
)

/** The plot-book chapters' and block sheets' order: the stored one completed, or the usual one. */
export function packagePartOrder(order: readonly string[] | undefined): PackagePartId[] {
  return orderedKeys(ORDERED_PART_IDS, order).keys as PackagePartId[]
}

/** The order to keep: undefined when it is the usual one. */
function storedPackageOrder(order: readonly string[] | undefined): PackagePartId[] | undefined {
  if (!order) return undefined
  const full = packagePartOrder(order)
  return full.every((id, index) => id === ORDERED_PART_IDS[index]) ? undefined : full
}

/**
 * Every part in package order: the report sections in the report's order (`sectionOrder`), then the
 * plot-book chapters and the block sheets in the package's own.
 */
export function orderedPackageParts(
  settings: ReportPackageSettings | undefined,
  sectionOrder?: readonly string[],
): PackagePart[] {
  const byId = new Map(PACKAGE_PARTS.map((part) => [part.id, part]))
  return [
    ...orderedReportSections(sectionOrder).map((id) => byId.get(`report:${id}`)!),
    ...packagePartOrder(settings?.order).map((id) => byId.get(id)!),
  ]
}

/** A copy with the plot-book chapters' and block sheets' order set (any other ids are left out). */
export function withPackageOrder(
  settings: ReportPackageSettings | undefined,
  order: readonly string[],
): ReportPackageSettings {
  return tidy({
    parts: {},
    ...settings,
    order: order.filter((id) => ORDERED_PART_IDS.includes(id as PackagePartId)) as PackagePartId[],
  })
}

/** True when nothing differs from the default package, so the settings need not be saved. */
export const isDefaultPackage = (settings: ReportPackageSettings | undefined) =>
  !settings || (Object.keys(tidy({ ...settings, parts: {} })).length === 1 && !Object.keys(settings.parts).length)

export const PACKAGE_PRESETS = ['full', 'simplified'] as const
export type PackagePreset = (typeof PACKAGE_PRESETS)[number]
export const PRESET_LABELS: Record<PackagePreset | 'custom', string> = {
  full: 'Full package',
  simplified: 'Simplified (summary and charts)',
  custom: 'Custom',
}

/**
 * The presets. Simplified opens with the summary instead of a cover, prints each road's profile,
 * grade and mass-haul sheet after it and nothing else: one or two pages for one road.
 */
export function presetSettings(
  preset: PackagePreset,
  contingency = true,
  slopeSheet: SlopeSheetMode = 'check',
  range?: boolean,
  order?: readonly PackagePartId[],
): ReportPackageSettings {
  const kept = order ? { order: [...order] } : {}
  if (preset === 'full') return tidy({ parts: {}, contingency, slopeSheet, range, ...kept })
  const parts: ReportPackageSettings['parts'] = {}
  for (const part of PACKAGE_PARTS) {
    const placement: PackagePlacement = part.id === 'plotbook:charts' ? 'main' : 'omit'
    if (placement !== defaultPlacement(part.id)) parts[part.id] = placement
  }
  return tidy({
    parts,
    front: 'summary',
    summaryOff: ['openItems', 'contents'],
    contingency,
    slopeSheet,
    range,
    charts: { panels: ['profile', 'grade'], stationTickM: 200, intervalM: 200 },
    ...kept,
  })
}

/** The preset the settings match, ignoring the contingency, slope-sheet and range choices and the order, which every preset keeps. */
export function packagePreset(settings: ReportPackageSettings | undefined): PackagePreset | 'custom' {
  const contingency = includesContingency(settings)
  const key = (value: ReportPackageSettings) =>
    JSON.stringify(tidy({ ...value, contingency: true, slopeSheet: 'check', range: false, order: undefined }))
  const current = key(settings ?? { parts: {} })
  return PACKAGE_PRESETS.find((preset) => key(presetSettings(preset, contingency)) === current) ?? 'custom'
}

function parseRangeSwitch(raw: unknown): boolean {
  if (typeof raw !== 'boolean') throw Error('Report package range must be on or off.')
  return raw
}

/** Reads the preliminary estimate's settings; blank allowances stay blank. */
export function parseEstimateSettings(raw: unknown): EstimateSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Estimate settings must be an object.')
  const r = raw as Record<string, unknown>
  const out: EstimateSettings = {}
  if (r.contingency !== undefined) {
    if (typeof r.contingency !== 'boolean') throw Error('Estimate contingency must be true or false.')
    if (!r.contingency) out.contingency = false
  }
  for (const key of Object.keys(RANGE_LIMITS) as (keyof RangeOptions)[]) {
    const value = r[key]
    if (value === undefined || value === null) continue
    const [min, max] = RANGE_LIMITS[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw Error(`Estimate ${key} must be a number from ${min} to ${max}.`)
    out[key] = value
  }
  return out
}

const PART_IDS = new Set<string>(PACKAGE_PARTS.map((p) => p.id))

/** Reads saved package choices. Unknown parts (from a newer version) are dropped, as unknown report sections are. */
export function parseReportPackage(raw: unknown): ReportPackageSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Report package settings must be an object.')
  const r = raw as {
    parts?: unknown
    front?: unknown
    summaryOff?: unknown
    contingency?: unknown
    charts?: unknown
    slopeSheet?: unknown
    range?: unknown
    order?: unknown
  }
  if (
    r.order !== undefined &&
    (!Array.isArray(r.order) || r.order.length > 200 || r.order.some((id) => typeof id !== 'string'))
  )
    throw Error('Report package order must be a list of part names.')
  if (r.slopeSheet !== undefined && !SLOPE_SHEET_MODES.includes(r.slopeSheet as SlopeSheetMode))
    throw Error(`Report package slope sheet must be one of ${SLOPE_SHEET_MODES.join(', ')}.`)
  if (r.front !== undefined && !PACKAGE_FRONTS.includes(r.front as PackageFront))
    throw Error(`Report package front page must be one of ${PACKAGE_FRONTS.join(', ')}.`)
  if (r.contingency !== undefined && typeof r.contingency !== 'boolean')
    throw Error('Report package contingency must be true or false.')
  if (r.summaryOff !== undefined && !Array.isArray(r.summaryOff))
    throw Error('Report package summary sections must be a list.')
  const extras: Omit<ReportPackageSettings, 'parts'> = {
    ...(r.front === undefined ? {} : { front: r.front as PackageFront }),
    // Unknown sections (from a newer version) are dropped, as unknown parts are.
    ...(r.summaryOff === undefined
      ? {}
      : { summaryOff: SUMMARY_SECTIONS.filter((id) => (r.summaryOff as unknown[]).includes(id)) }),
    ...(r.contingency === undefined ? {} : { contingency: r.contingency as boolean }),
    ...(r.charts === undefined ? {} : { charts: parseChartsOverride(r.charts) }),
    ...(r.slopeSheet === undefined ? {} : { slopeSheet: r.slopeSheet as SlopeSheetMode }),
    ...(r.range === undefined ? {} : { range: parseRangeSwitch(r.range) }),
    // Unknown parts (from a newer version) are dropped; `tidy` keeps the order only when it was changed.
    ...(r.order === undefined ? {} : { order: packagePartOrder(r.order as string[]) }),
  }
  const parts = r.parts
  if (parts === undefined) return tidy({ parts: {}, ...extras })
  if (!parts || typeof parts !== 'object' || Array.isArray(parts))
    throw Error('Report package parts must be an object of part placements.')
  const out: ReportPackageSettings['parts'] = {}
  for (const [id, placement] of Object.entries(parts)) {
    if (!PART_IDS.has(id)) continue
    if (!PACKAGE_PLACEMENTS.includes(placement as PackagePlacement))
      throw Error(`Report package part ${id} must be one of ${PACKAGE_PLACEMENTS.join(', ')}.`)
    if (placement !== defaultPlacement(id as PackagePartId)) out[id as PackagePartId] = placement as PackagePlacement
  }
  return tidy({ parts: out, ...extras })
}

/** One file of the package and what it holds. */
export interface PackageFile {
  key: 'main' | PackagePartId
  title: string
  filename: string
  /** Report sections printed in this file's reports; empty prints no report. */
  report: ReportSectionId[]
  /** Plot-book chapters printed in this file's plot books; empty prints no plot book. */
  plotbook: PackageChapter[]
  /** Block map sheets, once per file. */
  sheets: SheetKind[]
}

export interface PackagePlan {
  main: PackageFile
  appendices: PackageFile[]
  omitted: PackagePart[]
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

/**
 * Which file holds what. Parts keep their package order (`orderedPackageParts`: the report sections
 * in the report's `sectionOrder`); each appendix part is its own file.
 */
export function packagePlan(
  settings: ReportPackageSettings | undefined,
  basename: string,
  sectionOrder?: readonly string[],
): PackagePlan {
  const main: PackageFile = {
    key: 'main',
    title: 'Report package',
    filename: `${basename}-report-package.pdf`,
    report: [],
    plotbook: [],
    sheets: [],
  }
  const appendices: PackageFile[] = []
  const omitted: PackagePart[] = []
  for (const part of orderedPackageParts(settings, sectionOrder)) {
    const placement = placementOf(settings, part.id)
    if (placement === 'omit') {
      omitted.push(part)
      continue
    }
    const file: PackageFile =
      placement === 'main'
        ? main
        : {
            key: part.id,
            title: `Appendix: ${part.label}`,
            filename: `${basename}-appendix-${slug(part.label)}.pdf`,
            report: [],
            plotbook: [],
            sheets: [],
          }
    if (part.group === 'report') file.report.push(part.key as ReportSectionId)
    else if (part.group === 'plotbook') file.plotbook.push(part.key as PackageChapter)
    else file.sheets.push(part.key as SheetKind)
    if (placement === 'appendix') appendices.push(file)
  }
  return { main, appendices, omitted }
}

/** The sections a file's reports leave out, for `reportSettings.omittedSections`. */
export function omittedFor(file: PackageFile): ReportSectionId[] {
  return REPORT_SECTIONS.map((s) => s.id).filter((id) => !file.report.includes(id))
}

/** A file holds nothing when it has no report section, plot-book chapter or sheet. */
export function isEmptyFile(file: PackageFile): boolean {
  return !file.report.length && !file.plotbook.length && !file.sheets.length
}

/** What a file holds, in words, for its cover and the dialog's preview. */
export function describeFile(file: PackageFile): string[] {
  const label = (id: PackagePartId) => PACKAGE_PARTS.find((p) => p.id === id)?.label ?? id
  const lines: string[] = []
  if (file.sheets.length) lines.push(`Block map sheets: ${file.sheets.map((k) => label(`sheet:${k}`)).join(', ')}`)
  if (file.report.length) lines.push(`Report, per road: ${file.report.map((s) => label(`report:${s}`)).join(', ')}`)
  if (file.plotbook.length)
    lines.push(`Plot book, per road: ${file.plotbook.map((c) => label(`plotbook:${c}`)).join(', ')}`)
  return lines
}

const partLabel = (id: PackagePartId) => PACKAGE_PARTS.find((p) => p.id === id)?.label ?? id

/**
 * The line a package's report prints where a partial print says what it leaves out: which file
 * holds each report section this one does not, and which are out of the package.
 */
export function packageReportNotice(plan: PackagePlan, file: PackageFile): string {
  const elsewhere = [plan.main, ...plan.appendices]
    .filter((other) => other !== file && other.report.length)
    .map((other) => `${other.report.map((s) => partLabel(`report:${s}`)).join(', ')} (${other.filename})`)
  const left = plan.omitted.filter((p) => p.group === 'report').map((p) => p.label)
  return [
    `Part of a report package (${file.filename}).`,
    elsewhere.length ? `Other report sections are in ${elsewhere.join('; ')}.` : '',
    left.length
      ? `Left out of the package: ${left.join(', ')}. Print the full report before relying on what they hold.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The Save & export preview: the files the package writes and what each holds, for these roads. */
export function packagePreviewHtml(plan: PackagePlan, roads: readonly string[], zipName: string): string {
  const files = [plan.main, ...plan.appendices].filter((f) => !isEmptyFile(f))
  const fileHtml = (file: PackageFile) =>
    `<li><strong>${escapeHtml(file.filename)}</strong>: ${escapeHtml(file.title)}<ul>${describeFile(file)
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('')}</ul></li>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Report package</title><style>body{font:14px/1.5 Inter,Arial,sans-serif;color:#0b2b4a;margin:24px}h1{font-size:20px}li{margin:4px 0}.muted{color:#4b4f56}</style></head><body><h1>Report package</h1><p>${escapeHtml(
    roads.length === 1 ? `Road: ${roads[0]}` : `${roads.length} roads: ${roads.join(', ')}`,
  )}</p><p class="muted">${
    files.length > 1 ? `Downloads as ${escapeHtml(zipName)} holding ${files.length} PDFs.` : 'Downloads as one PDF.'
  } Each PDF opens with a cover whose contents give the page every part starts on.</p><ol>${files
    .map(fileHtml)
    .join('')}</ol>${
    plan.omitted.length
      ? `<p class="muted">Left out: ${escapeHtml(plan.omitted.map((p) => p.label).join(', '))}</p>`
      : ''
  }</body></html>`
}
