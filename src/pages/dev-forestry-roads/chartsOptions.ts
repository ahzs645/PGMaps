/**
 * What the plot book's profile, grade and mass-haul sheet shows (`chartsSheet.ts`): which panels,
 * the station-axis spacing, the grade axis, the legend, the sheet statistics and the per-interval
 * statistics band. A charts chapter carries a full set (`ReportChapter.charts`); the report
 * package may override some of them for its own charts sheets (`ReportPackageSettings.charts`).
 * No DOM access.
 */
export const CHART_PANELS = ['profile', 'grade', 'mass'] as const
export type ChartPanel = (typeof CHART_PANELS)[number]
/** Station-axis spacings offered for the charts sheet; null picks one from the length shown. */
export const CHART_STATION_TICKS = [50, 100, 200, 250, 500, 1000] as const
/** Grade-axis half-ranges offered; null fits the axis to the design and ground grades. */
export const CHART_GRADE_RANGES = [10, 15, 20, 30, 50] as const
/** Interval lengths for the statistics band; null prints no band. */
export const CHART_INTERVALS = [100, 200, 250, 500, 1000] as const
/**
 * Where the interval statistics print: a table under the charts, or on the profile itself, with a
 * line at every interval boundary and the figures at the top or bottom of each interval, or along
 * a dashed line at the interval's average grade.
 */
export const CHART_INTERVAL_STYLES = ['band', 'top', 'bottom', 'line'] as const
export type ChartIntervalStyle = (typeof CHART_INTERVAL_STYLES)[number]
/** Whose average grade the profile styles print: the design line's, or the design's and the ground's. */
export const CHART_INTERVAL_LINES = ['design', 'both'] as const
export type ChartIntervalLines = (typeof CHART_INTERVAL_LINES)[number]
export const INTERVAL_LINES_LABELS: Record<ChartIntervalLines, string> = {
  design: 'Design line',
  both: 'Design and ground lines',
}
export const INTERVAL_STYLE_LABELS: Record<ChartIntervalStyle, string> = {
  band: 'Table under the charts',
  top: 'On the profile, top of each interval',
  bottom: 'On the profile, bottom of each interval',
  line: 'On the profile, along the average-grade line',
}

export interface ChartsOptions {
  /** Drawn top to bottom in `CHART_PANELS` order; at least one. */
  panels: ChartPanel[]
  stationTickM: number | null
  gradeRangePercent: number | null
  legend: boolean
  /** Length, elevations, climb and descent, grades and earthwork for the sheet's range. */
  stats: boolean
  /**
   * The statistics band under the charts: average and steepest grade, rise, ground grade, cut and
   * fill for each interval of this length. Absent (older files) or null prints no band.
   */
  intervalM?: number | null
  /** How the interval statistics print. Absent is the table under the charts. */
  intervalStyle?: ChartIntervalStyle
  /**
   * On the profile, the design's average grade alone or the ground's beside it, each in its
   * line's colour. Absent is the design alone. The table always prints both.
   */
  intervalLines?: ChartIntervalLines
}
export const DEFAULT_CHARTS_OPTIONS: ChartsOptions = {
  panels: ['profile', 'grade', 'mass'],
  stationTickM: null,
  gradeRangePercent: null,
  legend: true,
  stats: true,
}

function record(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${label} must be an object.`)
  return raw as Record<string, unknown>
}
const choice = (value: unknown, allowed: readonly number[], label: string) => {
  if (value === null) return null
  if (!allowed.includes(value as number)) throw Error(`${label} must be one of ${allowed.join(', ')}, or automatic.`)
  return value as number
}
function intervalStyle(raw: unknown): ChartIntervalStyle {
  if (!CHART_INTERVAL_STYLES.includes(raw as ChartIntervalStyle))
    throw Error(`Statistics style must be one of ${CHART_INTERVAL_STYLES.join(', ')}.`)
  return raw as ChartIntervalStyle
}
function intervalLines(raw: unknown): ChartIntervalLines {
  if (!CHART_INTERVAL_LINES.includes(raw as ChartIntervalLines))
    throw Error(`Statistics lines must be one of ${CHART_INTERVAL_LINES.join(', ')}.`)
  return raw as ChartIntervalLines
}
function panels(raw: unknown): ChartPanel[] {
  if (
    !Array.isArray(raw) ||
    !raw.length ||
    raw.some((v) => !(CHART_PANELS as readonly unknown[]).includes(v)) ||
    new Set(raw).size !== raw.length
  )
    throw Error('Show at least one of the profile, grade and mass-haul charts.')
  return CHART_PANELS.filter((panel) => (raw as unknown[]).includes(panel))
}

/** Reads a charts chapter's options. */
export function parseChartsOptions(raw: unknown): ChartsOptions {
  const r = record(raw, 'Chart options')
  for (const key of ['legend', 'stats'])
    if (typeof r[key] !== 'boolean') throw Error('Chart legend and statistics must be on or off.')
  return {
    panels: panels(r.panels),
    stationTickM: choice(r.stationTickM, CHART_STATION_TICKS, 'Station axis spacing'),
    gradeRangePercent: choice(r.gradeRangePercent, CHART_GRADE_RANGES, 'Grade axis range'),
    legend: r.legend as boolean,
    stats: r.stats as boolean,
    // Written only when set, so a file saved before the band existed reads back unchanged.
    ...(r.intervalM === undefined ? {} : { intervalM: choice(r.intervalM, CHART_INTERVALS, 'Statistics interval') }),
    ...(r.intervalStyle === undefined ? {} : { intervalStyle: intervalStyle(r.intervalStyle) }),
    ...(r.intervalLines === undefined ? {} : { intervalLines: intervalLines(r.intervalLines) }),
  }
}

/** Reads a partial set of options, as the report package stores its overrides. */
export function parseChartsOverride(raw: unknown): Partial<ChartsOptions> {
  const r = record(raw, 'Package chart options')
  const out: Partial<ChartsOptions> = {}
  if (r.panels !== undefined) out.panels = panels(r.panels)
  if (r.stationTickM !== undefined)
    out.stationTickM = choice(r.stationTickM, CHART_STATION_TICKS, 'Station axis spacing')
  if (r.gradeRangePercent !== undefined)
    out.gradeRangePercent = choice(r.gradeRangePercent, CHART_GRADE_RANGES, 'Grade axis range')
  if (r.intervalM !== undefined) out.intervalM = choice(r.intervalM, CHART_INTERVALS, 'Statistics interval')
  if (r.intervalStyle !== undefined) out.intervalStyle = intervalStyle(r.intervalStyle)
  if (r.intervalLines !== undefined) out.intervalLines = intervalLines(r.intervalLines)
  for (const key of ['legend', 'stats'] as const)
    if (r[key] !== undefined) {
      if (typeof r[key] !== 'boolean') throw Error('Chart legend and statistics must be on or off.')
      out[key] = r[key] as boolean
    }
  return out
}

/** The default chapter title for the panels shown, so a sheet without mass haul does not say it has it. */
export function chartsTitle(panels: readonly ChartPanel[]): string {
  const names = CHART_PANELS.filter((p) => panels.includes(p)).map(
    (p) => ({ profile: 'profile', grade: 'grade', mass: 'mass haul' })[p],
  )
  const text = names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : (names[0] ?? '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
