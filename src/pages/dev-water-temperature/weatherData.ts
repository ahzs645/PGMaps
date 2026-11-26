import { csvParseRows } from 'd3'
import { csvCell, csvRows } from '@pgmaps/geo-toolkit/export'
import { fetchGzipText, fetchJson } from '@/lib/fetchJson'
import { DAY, isoDate, timestamp, trailingMonthRange, type DateRange } from './data'
import { UNBC, weatherFile } from './source'

export const WEATHER_CATALOG = `${UNBC}/data/weather/stations.json`
export const MAX_WEATHER_DAYS = 92
export const MEASURED_AIR = 'AirT_C_Avg'
export const COLOCATED_IDS = ['02FW006', '02MF009'] as const
export type WeatherFilter = 'all' | 'pass' | 'flagged'

interface WeatherMonth {
  month: string
  url: string
}

export interface WeatherStation {
  id: string
  name: string
  latitude: number
  longitude: number
  coordinateSource: string
  metadataUrl: string | null
  files: { name: string; url: string }[]
  months: WeatherMonth[]
  range: DateRange
  offsets: string[]
  records: number
  units: Record<string, string>
  variables: string[]
}

const VARIABLE_LABELS: Record<string, string> = {
  [MEASURED_AIR]: 'Air temperature',
  RH: 'Relative humidity',
  WS_ms_Avg: 'Wind speed',
  WindDir: 'Wind direction',
  WindDir_Avg: 'Average wind direction',
  MaxWS_ms_Avg: 'Maximum wind speed',
  Rain_mm_Tot: 'Rainfall',
  SlrFD_W_Avg: 'Solar radiation',
  SlrTF_MJ_Tot: 'Solar energy',
  BP_hPa_Avg: 'Air pressure',
  VP_hPa_Avg: 'Vapour pressure',
  DBTCDT_Avg: 'Snow depth',
  SV_DBTCDT_Avg: 'Snow depth (SnowVue)',
  SR50AT_DBTCDT_Avg: 'Snow depth (SR50AT)',
  T109_AirT_C_Avg: 'Air temperature (T109)',
}
export const variableLabel = (key: string) => VARIABLE_LABELS[key] ?? key

export const QC_MEANINGS: Record<string, string> = {
  P: 'Pass',
  C: 'Caution',
  DC: 'Dependency caution',
  DF: 'Dependency failure',
  DZ: 'Divide by zero',
  E: 'Error',
  ERR: 'Error',
  M: 'Missing',
  V: 'Visit',
  Z: 'Nighttime value',
  T: 'Tilt',
  SF: 'Snow free',
  R: 'Range',
  NV: 'No value',
  BV: 'Battery voltage',
  PT: 'Panel temperature',
  LR: 'Logger restart',
}

type CatalogEntry = {
  id?: string
  name?: string
  latitude?: number
  longitude?: number
  coordinateSource?: string
  metadataUrl?: string
  files?: { name?: string; url?: string }[]
  months?: WeatherMonth[]
  start?: string
  end?: string
  offsets?: string[]
  records?: number
  fields?: string[]
  units?: Record<string, string>
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_OFFSET = /^[+-]\d{2}:\d{2}$/
const validDay = (value: unknown): value is string =>
  typeof value === 'string' &&
  ISO_DAY.test(value) &&
  Number.isFinite(timestamp(value)) &&
  isoDate(timestamp(value)) === value

export function normalizeWeatherStations(input: unknown): WeatherStation[] {
  if (!Array.isArray(input)) throw new Error('Invalid UNBC weather catalog')
  const stations: WeatherStation[] = []
  for (const item of input as (CatalogEntry | null)[]) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(item.id) ||
      typeof item.name !== 'string' ||
      typeof item.latitude !== 'number' ||
      !Number.isFinite(item.latitude) ||
      Math.abs(item.latitude) > 90 ||
      typeof item.longitude !== 'number' ||
      !Number.isFinite(item.longitude) ||
      Math.abs(item.longitude) > 180
    )
      continue
    const fields = Array.isArray(item.fields) ? item.fields.filter((field) => typeof field === 'string') : []
    const names = new Set(fields)
    const months = (Array.isArray(item.months) ? item.months : []).flatMap((month) => {
      if (!month || typeof month.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month.month)) return []
      const url = weatherFile(month.url)
      return url === `${UNBC}/data/weather/${item.id}/${month.month}.csv.gz` ? [{ month: month.month, url }] : []
    })
    stations.push({
      id: item.id,
      name: item.name,
      latitude: item.latitude,
      longitude: item.longitude,
      coordinateSource: typeof item.coordinateSource === 'string' ? item.coordinateSource : '',
      metadataUrl: weatherFile(item.metadataUrl),
      files: (Array.isArray(item.files) ? item.files : []).flatMap((file) => {
        const url = weatherFile(file?.url)
        return url && typeof file?.name === 'string' ? [{ name: file.name, url }] : []
      }),
      months: months.sort((a, b) => a.month.localeCompare(b.month)),
      range:
        months.length && validDay(item.start) && validDay(item.end) && item.start <= item.end
          ? [item.start, item.end]
          : null,
      offsets: Array.isArray(item.offsets)
        ? item.offsets.filter((offset) => typeof offset === 'string' && ISO_OFFSET.test(offset))
        : [],
      records: typeof item.records === 'number' && Number.isFinite(item.records) ? item.records : 0,
      units: item.units && typeof item.units === 'object' ? item.units : {},
      variables: fields
        .filter((field) => names.has(`${field}_Flag`) && field !== 'RECORD')
        .sort(
          (a, b) =>
            Number(b === MEASURED_AIR) - Number(a === MEASURED_AIR) || variableLabel(a).localeCompare(variableLabel(b)),
        ),
    })
  }
  if (!stations.length) throw new Error('UNBC published no valid weather stations')
  return stations
}

export const loadWeatherStations = (signal: AbortSignal) =>
  fetchJson<unknown>(WEATHER_CATALOG, signal).then(normalizeWeatherStations)

export interface WeatherRow {
  time: number
  date: string
  stamp: string
  offset: string
  values: Record<string, string>
}
interface WeatherChunk {
  fields: string[]
  units: Record<string, string>
  rows: WeatherRow[]
}

export function parseWeatherChunk(text: string): WeatherChunk {
  const [fields, unitRow, ...records] = csvParseRows(text.replace(/^\uFEFF/, ''))
  if (
    !fields ||
    !unitRow ||
    unitRow.length !== fields.length ||
    !fields.includes('TIMESTAMP') ||
    !fields.includes('UTC Offset')
  )
    throw new Error('Invalid UNBC weather file header or units row')
  const toRecord = (row: string[]) => Object.fromEntries(fields.map((field, index) => [field, row[index] ?? '']))
  const rows = records
    .filter((row) => row.some(Boolean))
    .map((row) => {
      const values = toRecord(row)
      const stamp = values.TIMESTAMP
      const offset = values['UTC Offset']
      const date = stamp.slice(0, 10)
      const time = Date.parse(stamp.replace(' ', 'T') + offset)
      if (row.length !== fields.length || !validDay(date) || !ISO_OFFSET.test(offset) || !Number.isFinite(time))
        throw new Error(`Invalid UNBC weather record at ${stamp || '(empty timestamp)'}`)
      return { time, date, stamp, offset, values }
    })
  return { fields, units: toRecord(unitRow), rows }
}

export function weatherRangeError(range: DateRange, extent: DateRange) {
  if (!range || !extent || !validDay(range[0]) || !validDay(range[1])) return 'Enter a start and end date.'
  if (range[0] > range[1]) return 'The start date must be on or before the end date.'
  if (range[0] < extent[0] || range[1] > extent[1]) return 'Choose dates within the station record.'
  if (timestamp(range[1]) - timestamp(range[0]) >= MAX_WEATHER_DAYS * DAY)
    return `Choose up to ${MAX_WEATHER_DAYS} days to view readings at their original interval.`
  return null
}

export const latestWeatherRange = (station: WeatherStation): DateRange => trailingMonthRange(station.range, 1)

export async function loadWeatherRange(station: WeatherStation, range: NonNullable<DateRange>, signal: AbortSignal) {
  const startMonth = range[0].slice(0, 7)
  const endMonth = range[1].slice(0, 7)
  const chunks = await Promise.all(
    station.months
      .filter(({ month }) => month >= startMonth && month <= endMonth)
      .map(({ url }) => fetchGzipText(url, signal).then(parseWeatherChunk)),
  )
  return {
    fields: [...new Set(chunks.flatMap((chunk) => chunk.fields))],
    units: Object.assign({}, ...chunks.map((chunk) => chunk.units)) as Record<string, string>,
    rows: chunks
      .flatMap((chunk) => chunk.rows.filter((row) => row.date >= range[0] && row.date <= range[1]))
      .sort((a, b) => a.time - b.time),
  }
}

export function weatherCodes(row: WeatherRow, variable: string) {
  return (row.values[`${variable}_Flag`] ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code && code.toLowerCase() !== 'nan')
}

export function weatherValue(row: WeatherRow, variable: string) {
  const raw = row.values[variable]?.trim()
  const number = raw ? Number(raw) : NaN
  return Number.isFinite(number) ? number : null
}

export function weatherShown(codes: string[], filter: WeatherFilter) {
  return (
    filter === 'all' ||
    (filter === 'pass' ? codes.length === 1 && codes[0] === 'P' : codes.some((code) => code !== 'P'))
  )
}

export function weatherChartRows(rows: WeatherRow[], variable: string, filter: WeatherFilter) {
  const intervals = new Map<number, number>()
  for (let i = 1; i < rows.length; i++) {
    const interval = rows[i].time - rows[i - 1].time
    if (interval > 0) intervals.set(interval, (intervals.get(interval) ?? 0) + 1)
  }
  const interval = [...intervals].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? Infinity
  const chart: { x: number; reading: number | null }[] = []
  rows.forEach((row, index) => {
    if (index && row.time - rows[index - 1].time > interval * 1.5)
      chart.push({ x: rows[index - 1].time + interval, reading: null })
    chart.push({
      x: row.time,
      reading: weatherShown(weatherCodes(row, variable), filter) ? weatherValue(row, variable) : null,
    })
  })
  return chart
}

export function weatherCsv(fields: string[], units: Record<string, string>, rows: WeatherRow[]) {
  const header = csvRows([fields, fields.map((field) => units[field])], { quote: 'needed' })
  const observations = rows.map((row) =>
    fields
      .map((field) => {
        const value = row.values[field]
        return csvCell(value, { quote: 'needed', guardFormulas: field !== 'UTC Offset' || !ISO_OFFSET.test(value) })
      })
      .join(','),
  )
  return [header, ...observations].join('\r\n')
}

// The two collocated pilot stations both log at 15-minute intervals. Count at
// most one passing reading per slot and require 72 of 96 before reporting a mean.
export function dailyMeasuredAir(rows: WeatherRow[]) {
  const days = new Map<string, Map<number, number>>()
  const quarterHour = 15 * 60 * 1000
  for (const row of rows) {
    const value = weatherValue(row, MEASURED_AIR)
    if (value === null || !weatherShown(weatherCodes(row, MEASURED_AIR), 'pass')) continue
    const slots = days.get(row.date) ?? new Map<number, number>()
    slots.set(Math.floor(row.time / quarterHour), value)
    days.set(row.date, slots)
  }
  return new Map(
    [...days]
      .filter(([, values]) => values.size >= 72)
      .map(([date, values]) => [date, [...values.values()].reduce((sum, value) => sum + value, 0) / values.size]),
  )
}
