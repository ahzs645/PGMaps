import { toCsv } from '@pgmaps/geo-toolkit/export'
import { parseCsvRows } from '@/lib/parseCsv'

export function checkedCsv(text: string, delimiter = ',') {
  // Existing parser handles quoted delimiters/newlines. Reject unclosed quotes first.
  let quoted = false
  for (let i = 0; i < text.length; i++)
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') i++
      else quoted = !quoted
    }
  if (quoted) throw new Error('CSV has an unclosed quoted field.')
  const [rawHeaders, ...rows] = parseCsvRows(text.replace(/^\uFEFF/, ''), { delimiter })
  const headers = rawHeaders?.map((value) => value.trim())
  if (!headers?.length || headers.some((value) => !value) || new Set(headers).size !== headers.length)
    throw new Error('CSV needs nonempty, unique column headers.')
  if (rows.length > 50000) throw new Error('Import at most 50,000 CSV records at a time.')
  if (rows.some((row) => row.length !== headers.length))
    throw new Error('CSV rows have different column counts. Check the delimiter and quoting.')
  return { headers, records: rows.map((row) => Object.fromEntries(headers.map((key, i) => [key, row[i]]))) }
}

/** Quote every cell and stop spreadsheet formula execution in textual exports. */
export function csvExport(headers: string[], rows: unknown[][]) {
  return toCsv(headers, rows)
}

export type MonitoringDateFormat = 'iso' | 'dmy' | 'mdy' | 'ymd'
export type MonitoringMapping = {
  timestamp: string
  station: string
  primary: string
  secondary: string
  primaryUnit: string
  secondaryUnit: string
  timezone: string
  timezoneColumn?: string
  dateFormat?: MonitoringDateFormat
}
export type Observation = {
  time: number
  timestamp: string
  station: string
  primary: number | null
  secondary: number | null
  row: number
  source: Record<string, string>
}

export function parseTimestamp(text: string, timezone: string, dateFormat: MonitoringDateFormat = 'iso'): number {
  if (!['iso', 'dmy', 'mdy', 'ymd'].includes(dateFormat)) throw new Error('Choose a supported explicit date format.')
  if (dateFormat !== 'iso') {
    const parts = text
      .trim()
      .match(dateFormat === 'ymd' ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/ : /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (!parts) throw new Error(`The daily date does not match the selected ${dateFormat.toUpperCase()} format.`)
    const year = dateFormat === 'ymd' ? parts[1] : parts[3]
    const month = dateFormat === 'dmy' ? parts[2] : dateFormat === 'mdy' ? parts[1] : parts[2]
    const day = dateFormat === 'dmy' ? parts[1] : dateFormat === 'mdy' ? parts[2] : parts[3]
    text = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} 00:00:00`
  }
  const match = text
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/)
  if (!match) throw new Error('Use ISO date/time YYYY-MM-DD HH:mm:ss, optionally with Z or ±HH:mm.')
  const [, year, month, day, hour, minute, second = '0', fraction = '', embedded] = match
  const date = new Date(0)
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day))
  date.setUTCHours(Number(hour), Number(minute), Number(second), Math.round(Number(`0${fraction}`) * 1000))
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute) ||
    date.getUTCSeconds() !== Number(second)
  )
    throw new Error('Invalid calendar date/time.')
  const zone = embedded || timezone
  if (zone === 'embedded') throw new Error('This timestamp has no UTC offset. Choose its time zone.')
  if (zone === 'Z' || zone === 'UTC') return date.getTime()
  const offset = zone.match(/^([+-])(\d{2}):(\d{2})$/)
  if (offset) {
    if (Number(offset[2]) > 14 || Number(offset[3]) > 59 || (Number(offset[2]) === 14 && Number(offset[3]) !== 0))
      throw new Error('UTC offset must be within ±14:00.')
    return date.getTime() - (offset[1] === '+' ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60000
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const localTime = (time: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(time).map((part) => [part.type, part.value]))
    const output = new Date(0)
    output.setUTCFullYear(Number(parts.year), Number(parts.month) - 1, Number(parts.day))
    output.setUTCHours(Number(parts.hour), Number(parts.minute), Number(parts.second), date.getUTCMilliseconds())
    return output.getTime()
  }
  let guess = date.getTime()
  for (let i = 0; i < 4; i++) guess += date.getTime() - localTime(guess)
  const candidates = [
    ...new Set(
      [-7200000, -3600000, 0, 3600000, 7200000]
        .map((shift) => guess + shift)
        .filter((value) => localTime(value) === date.getTime()),
    ),
  ]
  if (candidates.length !== 1)
    throw new Error(
      'Ambiguous or nonexistent local time at a daylight-saving transition. Supply an explicit UTC offset.',
    )
  return candidates[0]
}

export function normalizeMonitoring(records: Record<string, string>[], mapping: MonitoringMapping) {
  if (!mapping.timestamp || !mapping.primary) throw new Error('Choose a timestamp and primary measurement column.')
  const errors: { row: number; message: string }[] = [],
    observations: Observation[] = []
  records.forEach((source, index) => {
    try {
      const numeric = (column: string) => {
        if (!column || !source[column]?.trim()) return null
        const value = Number(source[column])
        if (!Number.isFinite(value)) throw new Error(`${column} is not a finite number.`)
        return value
      }
      const timezone = mapping.timezoneColumn ? source[mapping.timezoneColumn]?.trim() : mapping.timezone
      if (!timezone) throw new Error('Missing timezone/UTC offset in the mapped column.')
      const time = parseTimestamp(source[mapping.timestamp] || '', timezone, mapping.dateFormat)
      const primary = numeric(mapping.primary),
        secondary = numeric(mapping.secondary)
      if (primary === null && secondary === null) throw new Error('No measurements in this row.')
      observations.push({
        time,
        timestamp: new Date(time).toISOString(),
        station: mapping.station ? source[mapping.station] : 'All observations',
        primary,
        secondary,
        row: index + 2,
        source,
      })
    } catch (error) {
      errors.push({ row: index + 2, message: error instanceof Error ? error.message : String(error) })
    }
  })
  observations.sort((a, b) => a.time - b.time || a.row - b.row)
  const seen = new Set<string>()
  let duplicates = 0
  observations.forEach((item) => {
    const key = `${item.station}\u0000${item.timestamp}`
    if (seen.has(key)) duplicates++
    seen.add(key)
  })
  return { observations, errors, duplicates }
}

export function summarize(values: (number | null)[]) {
  const numbers = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (!numbers.length) return { count: 0, min: null, max: null, mean: null }
  return {
    count: numbers.length,
    min: numbers.reduce((a, b) => Math.min(a, b)),
    max: numbers.reduce((a, b) => Math.max(a, b)),
    mean: numbers.reduce((a, b) => a + b, 0) / numbers.length,
  }
}
