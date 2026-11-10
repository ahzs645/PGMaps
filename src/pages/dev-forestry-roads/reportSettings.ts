/** Portable bounded report authoring. Label templates substitute whitelisted data; never eval code. */
import { parseOmittedSections, type ReportSectionId } from './reportContents'

export const REPORT_CHAPTER_KINDS = [
  'plan-profile',
  'sections',
  'schedule',
  'curves',
  'structures',
  'materials',
] as const
export type ReportChapterKind = (typeof REPORT_CHAPTER_KINDS)[number]
export const REPORT_COLUMNS = [
  'station',
  'ground',
  'design',
  'grade',
  'cutArea',
  'fillArea',
  'cutVolume',
  'fillVolume',
  'mass',
  'flags',
] as const
export type ReportColumn = (typeof REPORT_COLUMNS)[number]
export const LABEL_FIELDS = ['station', 'grade', 'ground', 'design', 'radius', 'road', 'project'] as const
export interface ReportChapter {
  id: string
  title: string
  kind: ReportChapterKind
  startM: number | null
  endM: number | null
  sheetLengthM: number
  sectionIntervalM: number
  /** Null fits the road window. Otherwise, a physical 1:N horizontal scale on the selected paper. */
  horizontalScale: number | null
  verticalExaggeration: number
  columns: ReportColumn[]
}
/**
 * Plot-book paper, landscape. Each sheet is drawn 1123 units high; `viewWidth` keeps the paper's
 * proportions, so a wider sheet gains width and every vertical position stays where it was.
 * A3 and A4 keep the original 1587-unit sheet.
 */
export const REPORT_PAPERS = {
  A3: { label: 'A3 landscape', widthMm: 420, heightMm: 297, viewWidth: 1587, cssSize: 'A3 landscape' },
  A4: { label: 'A4 landscape', widthMm: 297, heightMm: 210, viewWidth: 1587, cssSize: 'A4 landscape' },
  tabloid: {
    label: 'Tabloid 11 × 17 in (ANSI B) landscape',
    widthMm: 431.8,
    heightMm: 279.4,
    viewWidth: 1736,
    cssSize: '17in 11in',
  },
  'ansi-d': {
    label: 'ANSI D 22 × 34 in landscape',
    widthMm: 863.6,
    heightMm: 558.8,
    viewWidth: 1736,
    cssSize: '34in 22in',
  },
} as const
export type ReportPaper = keyof typeof REPORT_PAPERS
export const REPORT_PAPER_IDS = Object.keys(REPORT_PAPERS) as ReportPaper[]
export interface RoadReportSettings {
  schema: 'pgmaps-road-report-v1'
  paper: ReportPaper
  chapters: ReportChapter[]
  subviews: { plan: boolean; profile: boolean; mass: boolean; contours: boolean; legend: boolean }
  stationLabel: string
  gradeLabel: string
  labelOffsetX: number
  labelOffsetY: number
  curveTablePosition: 'chapter' | 'plan-sheet' | 'none'
  /** Report sections left out of the printed report (`reportContents.ts`); absent prints them all. */
  omittedSections?: ReportSectionId[]
}
export const MAX_REPORT_CHAPTERS = 16
export const MAX_REPORT_SHEETS = 500
export function createReportChapter(kind: ReportChapterKind, id: string): ReportChapter {
  return {
    id,
    title: {
      'plan-profile': 'Plan & profile',
      sections: 'Cross-sections',
      schedule: 'Station schedule',
      curves: 'Horizontal curves',
      structures: 'Culvert inventory',
      materials: 'Material quantities',
    }[kind],
    kind,
    startM: null,
    endM: null,
    sheetLengthM: 250,
    sectionIntervalM: 20,
    horizontalScale: null,
    verticalExaggeration: 1,
    columns: ['station', 'ground', 'design', 'grade', 'cutArea', 'fillArea', 'mass'],
  }
}
export function createRoadReportSettings(): RoadReportSettings {
  return {
    schema: 'pgmaps-road-report-v1',
    paper: 'A3',
    chapters: [createReportChapter('plan-profile', 'plan-profile'), createReportChapter('sections', 'sections')],
    subviews: { plan: true, profile: true, mass: true, contours: true, legend: true },
    stationLabel: '{station}',
    gradeLabel: '{grade:.1}%',
    labelOffsetX: 0,
    labelOffsetY: 0,
    curveTablePosition: 'none',
  }
}
function record(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${label} must be an object.`)
  return raw as Record<string, unknown>
}
function number(raw: unknown, min: number, max: number, label: string) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max)
    throw Error(`${label} must be ${min}–${max}.`)
  return raw
}
function optional(raw: unknown, min: number, max: number, label: string) {
  return raw === null ? null : number(raw, min, max, label)
}
function text(raw: unknown, label: string, max = 100) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max) throw Error(`${label} needs 1–${max} characters.`)
  return raw.trim()
}
export function validateLabelTemplate(raw: unknown): string {
  const expression = text(raw, 'Drawing label', 200)
  const remainder = expression.replace(/\{([a-z]+)(?::\.([0-4]))?\}/g, (_match, field: string) => {
    if (!(LABEL_FIELDS as readonly string[]).includes(field)) throw Error(`Unknown drawing label field: ${field}.`)
    return ''
  })
  if (/[{}]/.test(remainder)) throw Error('Use label fields such as {station}, {road}, or {grade:.1}.')
  return expression
}
export function formatDrawingLabel(
  expression: string,
  values: Partial<Record<(typeof LABEL_FIELDS)[number], string | number | null>>,
): string {
  return validateLabelTemplate(expression).replace(
    /\{([a-z]+)(?::\.([0-4]))?\}/g,
    (_match, field: (typeof LABEL_FIELDS)[number], decimals?: string) => {
      const value = values[field]
      if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '—'
      return typeof value === 'number'
        ? decimals === undefined
          ? String(Number(value.toFixed(2)))
          : value.toFixed(Number(decimals))
        : value
    },
  )
}
export function parseRoadReportSettings(raw: unknown): RoadReportSettings {
  if (raw === undefined) return createRoadReportSettings()
  const r = record(raw, 'Report settings')
  if (r.schema !== 'pgmaps-road-report-v1') throw Error('Unsupported road report settings version.')
  if (typeof r.paper !== 'string' || !(REPORT_PAPER_IDS as string[]).includes(r.paper))
    throw Error('Choose A3, A4, tabloid or ANSI D report paper.')
  if (!Array.isArray(r.chapters) || !r.chapters.length || r.chapters.length > MAX_REPORT_CHAPTERS)
    throw Error(`Use 1–${MAX_REPORT_CHAPTERS} report chapters.`)
  const chapters = r.chapters.map((rawChapter): ReportChapter => {
    const c = record(rawChapter, 'Report chapter')
    if (!(REPORT_CHAPTER_KINDS as readonly unknown[]).includes(c.kind)) throw Error('Unknown report chapter kind.')
    const id = text(c.id, 'Report chapter ID')
    if (!/^[a-zA-Z0-9_.:-]+$/.test(id)) throw Error('Report chapter ID contains unsupported characters.')
    const startM = optional(c.startM, 0, 100000, 'Report start station')
    const endM = optional(c.endM, 0, 100000, 'Report end station')
    if (startM !== null && endM !== null && endM <= startM) throw Error('Report end station must follow its start.')
    if (
      !Array.isArray(c.columns) ||
      !c.columns.length ||
      c.columns.length > REPORT_COLUMNS.length ||
      c.columns.some((v) => !(REPORT_COLUMNS as readonly unknown[]).includes(v)) ||
      new Set(c.columns).size !== c.columns.length
    )
      throw Error('Select distinct station schedule columns.')
    return {
      id,
      title: text(c.title, 'Chapter title'),
      kind: c.kind as ReportChapterKind,
      startM,
      endM,
      sheetLengthM: number(c.sheetLengthM, 10, 10000, 'Sheet length'),
      sectionIntervalM: number(c.sectionIntervalM, 2, 1000, 'Report interval'),
      horizontalScale: optional(c.horizontalScale, 50, 100000, 'Horizontal scale denominator'),
      verticalExaggeration: number(c.verticalExaggeration, 0.1, 20, 'Vertical exaggeration'),
      columns: [...c.columns] as ReportColumn[],
    }
  })
  if (new Set(chapters.map((c) => c.id)).size !== chapters.length) throw Error('Report chapter IDs must be unique.')
  const subviews = record(r.subviews, 'Drawing subviews')
  for (const key of ['plan', 'profile', 'mass', 'contours', 'legend'])
    if (typeof subviews[key] !== 'boolean') throw Error('Drawing subview visibility must be true or false.')
  if (!subviews.plan && !subviews.profile && !subviews.mass && chapters.some((c) => c.kind === 'plan-profile'))
    throw Error('Keep at least one plot subview.')
  if (!['chapter', 'plan-sheet', 'none'].includes(r.curveTablePosition as string))
    throw Error('Unknown curve table position.')
  const omittedSections = parseOmittedSections(r.omittedSections)
  return {
    schema: 'pgmaps-road-report-v1',
    paper: r.paper as ReportPaper,
    chapters,
    subviews: {
      plan: subviews.plan as boolean,
      profile: subviews.profile as boolean,
      mass: subviews.mass as boolean,
      contours: subviews.contours as boolean,
      legend: subviews.legend as boolean,
    },
    stationLabel: validateLabelTemplate(r.stationLabel),
    gradeLabel: validateLabelTemplate(r.gradeLabel),
    labelOffsetX: number(r.labelOffsetX, -100, 100, 'Label X offset'),
    labelOffsetY: number(r.labelOffsetY, -100, 100, 'Label Y offset'),
    curveTablePosition: r.curveTablePosition as RoadReportSettings['curveTablePosition'],
    ...(omittedSections?.length ? { omittedSections } : {}),
  }
}
