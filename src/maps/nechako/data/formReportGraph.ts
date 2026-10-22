import { formReportStatistics, reviewObject, type FormReport } from './submissionReview'

export type FormReportGraphOption = { kind: 'rows' | 'statistics'; key: string; label: string }
export type FormReportGraphPoint = { x: number; y: number; label: string; original: string | number }

function canonicalDecimal(text: string) {
  const [mantissa, exponent = '0'] = text.toLowerCase().split('e')
  const fraction = mantissa.split('.')[1]?.length ?? 0
  const digits = mantissa.replace(/^[+-]/, '').replace('.', '').replace(/^0+/, '')
  if (!digits) return '0'
  const significant = digits.replace(/0+$/, '')
  return `${mantissa.startsWith('-') ? '-' : ''}${significant}e${Number(exponent) - fraction + digits.length - significant.length}`
}

/** Decimal source strings may be plotted; null, booleans and blank text never become zero. */
function numeric(value: unknown): number | undefined {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))
  )
    return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) return undefined
  // Reject lost precision/underflow rather than present a different source decimal.
  if (typeof value === 'string' && canonicalDecimal(value.trim()) !== canonicalDecimal(String(number))) return undefined
  return number
}

/** Source statistics are opaque: support only scalars or one-level keyed numeric groups. */
export function formReportGraphOptions(report: FormReport) {
  const fields = [...new Set(Object.values(report.mapping))]
  if (fields.length > 200)
    throw new Error('Graphs support at most 200 mapped fields. All returned data remains in Table.')
  const options: FormReportGraphOption[] = fields.flatMap((key) =>
    report.rows.some((row) => numeric(row[key]) !== undefined)
      ? [{ kind: 'rows' as const, key, label: `Returned rows · ${key}` }]
      : [],
  )
  const statistics = formReportStatistics(report)
  if (statistics === undefined) return { options, statisticsNote: 'The source supplied no statistics object.' }
  if (!reviewObject(statistics) || Object.keys(statistics).length > 200)
    return { options, statisticsNote: 'This source statistics shape is not supported by graphs; inspect it in Table.' }
  let unsupported = 0
  for (const [key, value] of Object.entries(statistics)) {
    if (
      numeric(value) !== undefined ||
      (reviewObject(value) &&
        Object.keys(value).length <= 200 &&
        Object.values(value).some((item) => numeric(item) !== undefined))
    )
      options.push({ kind: 'statistics', key, label: `Source statistic · ${key}` })
    else unsupported++
  }
  return {
    options,
    statisticsNote: unsupported
      ? `${unsupported} source statistic group(s) have no supported numeric shape. The original values remain in Table.`
      : 'Source statistic names and values are retained as returned; their meanings and units are not inferred.',
  }
}

export function formReportGraph(report: FormReport, option: FormReportGraphOption) {
  let entries: { label: string; value: unknown }[]
  if (option.kind === 'rows') {
    if (!Object.values(report.mapping).includes(option.key)) throw new Error('Choose a mapped report field.')
    if (report.rows.length > 10_000) throw new Error('Graphs support at most 10,000 returned rows.')
    entries = report.rows.map((row, index) => ({
      label: `Submission ${String(row['Submission ID'] ?? `row ${index + 1}`)}`,
      value: row[option.key],
    }))
  } else {
    const statistics = formReportStatistics(report)
    if (!reviewObject(statistics) || !Object.prototype.hasOwnProperty.call(statistics, option.key))
      throw new Error('Choose a returned source statistic.')
    const value = statistics[option.key]
    if (reviewObject(value)) {
      if (Object.keys(value).length > 200) throw new Error('Graphs support at most 200 entries in a source statistic.')
      entries = Object.entries(value).map(([label, value]) => ({ label, value }))
    } else entries = [{ label: option.key, value }]
  }
  const points = entries.flatMap(({ label, value }, index): FormReportGraphPoint[] => {
    const y = numeric(value)
    return y === undefined ? [] : [{ x: index + 1, y, label, original: value as string | number }]
  })
  const min = points.length ? Math.min(...points.map((point) => point.y)) : 0
  const max = points.length ? Math.max(...points.map((point) => point.y)) : 0
  const padding = (max - min) * 0.05 || Math.abs(min) * 0.05 || 1
  return {
    points,
    considered: entries.length,
    excluded: entries.length - points.length,
    extent: [0.5, Math.max(1.5, entries.length + 0.5), min - padding, max + padding] as const,
    xLabel: option.kind === 'rows' ? 'Returned row position' : 'Source entry position',
  }
}
