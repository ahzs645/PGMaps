import { csvRows } from '@pgmaps/geo-toolkit/export'

export interface Station {
  station_id: string
  station_code: string
  waterbody_name: string
  station_description: string
  latitude: number
  longitude: number
  filename: string
  start: string
  end: string
  n: number
  provider_name: string
  url: string
}

export interface Observation {
  date: string
  temp_c: number | null
  airtemp_c: number | null
}

export interface Series {
  station: Station
  color: string
  data: Observation[]
}

export type DateRange = readonly [string, string] | null
export type Aggregation = 'day' | 'month' | 'season'
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const SERIES_COLORS = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3']
export const DAY = 86_400_000
export const timestamp = (date: string) => Date.parse(`${date}T00:00:00Z`)
export const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10)
export const finiteValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export function normalizeObservations(input: unknown): Observation[] {
  if (!Array.isArray(input)) throw new Error('Invalid station observation file')
  const unique = new Map<string, Observation>()
  for (const item of input) {
    if (!item || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue
    const time = timestamp(item.date)
    if (!Number.isFinite(time) || isoDate(time) !== item.date) continue
    unique.set(item.date, { date: item.date, temp_c: finiteValue(item.temp_c), airtemp_c: finiteValue(item.airtemp_c) })
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function normalizeStations(input: unknown): Station[] {
  if (!Array.isArray(input)) throw new Error('Invalid station catalog')
  return input
    .filter(
      (station): station is Station =>
        station &&
        typeof station.station_id === 'string' &&
        typeof station.filename === 'string' &&
        /^[A-Za-z0-9_-]+\.json$/.test(station.filename) &&
        typeof station.station_code === 'string' &&
        typeof station.start === 'string' &&
        typeof station.end === 'string' &&
        Number.isFinite(station.latitude) &&
        Math.abs(station.latitude) <= 90 &&
        Number.isFinite(station.longitude) &&
        Math.abs(station.longitude) <= 180 &&
        Number.isFinite(station.n),
    )
    .sort((a, b) => a.station_code.localeCompare(b.station_code))
}

export function filterRange(data: Observation[], range: DateRange): Observation[] {
  return range ? data.filter((point) => point.date >= range[0] && point.date <= range[1]) : data
}

/** Range presets use calendar months and clamp month ends, including leap years. */
export function trailingMonthRange(extent: DateRange, months: number): DateRange {
  if (!extent) return null
  const end = new Date(timestamp(extent[1]))
  const firstOfMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, 1))
  const daysInMonth = new Date(Date.UTC(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth() + 1, 0)).getUTCDate()
  const start = isoDate(
    Date.UTC(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth(), Math.min(end.getUTCDate(), daysInMonth)),
  )
  return [start < extent[0] ? extent[0] : start, extent[1]]
}

export interface AggregatePoint {
  date: string
  time: number
  value: number | null
  count: number
  expected: number
}

/** Calendar-day coverage, including leap years and seasons crossing New Year. */
export function aggregate(
  data: Observation[],
  mode: Aggregation,
  startMonth: number,
  endMonth: number,
): AggregatePoint[] {
  if (mode === 'day')
    return data.map((point) => ({
      date: point.date,
      time: timestamp(point.date),
      value: point.temp_c,
      count: point.temp_c === null ? 0 : 1,
      expected: 1,
    }))
  const groups = new Map<string, { values: number[]; first: number; last: number }>()
  for (const point of data) {
    const year = Number(point.date.slice(0, 4))
    const month = Number(point.date.slice(5, 7))
    let first: number
    let last: number
    if (mode === 'month') {
      first = Date.UTC(year, month - 1, 1)
      last = Date.UTC(year, month, 1)
    } else {
      const wraps = startMonth > endMonth
      if (!(wraps ? month >= startMonth || month <= endMonth : month >= startMonth && month <= endMonth)) continue
      const startYear = wraps && month <= endMonth ? year - 1 : year
      first = Date.UTC(startYear, startMonth - 1, 1)
      last = Date.UTC(startYear + (wraps ? 1 : 0), endMonth, 1)
    }
    const key = isoDate(first)
    const group = groups.get(key) ?? { values: [], first, last }
    if (point.temp_c !== null) group.values.push(point.temp_c)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([date, { values, first, last }]) => {
      const expected = Math.round((last - first) / DAY)
      return {
        date,
        time: first,
        count: values.length,
        expected,
        value:
          values.length >= Math.ceil(expected * 0.75)
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null,
      }
    })
    .sort((a, b) => a.time - b.time)
}

export interface ChartRow {
  time: number
  [key: string]: number | null
}

export function timeRows(series: Series[], mode: Aggregation, start: number, end: number): ChartRow[] {
  const rows = new Map<number, ChartRow>()
  for (const item of series) {
    for (const point of aggregate(item.data, mode, start, end)) {
      const row = rows.get(point.time) ?? { time: point.time }
      row[item.station.station_id] = point.value
      rows.set(point.time, row)
    }
  }
  if (!rows.size) return []
  // Explicit empty days prevent a line from bridging missing observations.
  if (mode === 'day') {
    const times = [...rows.keys()]
    const end = Math.max(...times)
    for (let time = Math.min(...times); time <= end; time += DAY) {
      if (!rows.has(time)) rows.set(time, { time })
    }
  }
  return [...rows.values()]
    .sort((a, b) => a.time - b.time)
    .map((row) => {
      for (const item of series) row[item.station.station_id] ??= null
      return row
    })
}

export function seasonalPoints(data: Observation[]) {
  const groups = new Map<number, number[]>()
  for (const point of data) {
    if (point.temp_c === null) continue
    // One leap-year calendar aligns March–December across all source years.
    const time = Date.UTC(2000, Number(point.date.slice(5, 7)) - 1, Number(point.date.slice(8, 10)))
    const values = groups.get(time) ?? []
    values.push(point.temp_c)
    groups.set(time, values)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, values]) => ({
      time,
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      range: [Math.min(...values), Math.max(...values)],
      count: values.length,
    }))
}

export function observationsCsv(series: Series[], range: DateRange, updated: string | null) {
  const rows = [
    [
      'source',
      'snapshot_updated',
      'station_id',
      'waterbody',
      'latitude',
      'longitude',
      'date',
      'water_temp_c',
      'air_temp_c',
    ],
    ...series.flatMap((item) =>
      filterRange(item.data, range).map((point) => [
        'UNBC water-temperature local snapshot',
        updated,
        item.station.station_id,
        item.station.waterbody_name,
        item.station.latitude,
        item.station.longitude,
        point.date,
        point.temp_c,
        point.airtemp_c,
      ]),
    ),
  ]
  return csvRows(rows)
}
