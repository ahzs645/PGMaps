// SPDX-License-Identifier: Apache-2.0

import { MAX_CLIMATE_CSV_BYTES, MAX_CLIMATE_DAYS } from './constants'
import type { ClimateDay, MonthlyAnomaly, ScenarioInput, Soil } from './types'

const DAY_MS = 86_400_000

/** RFC-4180-style CSV reader, including quoted fields, CRLF and escaped quotes. */
export function readCsv(text: string, maxRows = Number.POSITIVE_INFINITY): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let closedQuote = false
  const source = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
          closedQuote = true
        }
      } else cell += ch
      continue
    }
    if (ch === '"') {
      if (cell || closedQuote) throw new Error('Invalid CSV: a quote must start a field.')
      quoted = true
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(cell)
      cell = ''
      closedQuote = false
      if (ch !== ',') {
        if (ch === '\r' && source[i + 1] === '\n') i++
        if (row.some((value) => value.trim() !== '')) {
          rows.push(row)
          if (rows.length > maxRows) throw new Error(`CSV exceeds the ${maxRows - 1} daily observation limit.`)
        }
        row = []
      }
    } else {
      if (closedQuote && ch !== ' ' && ch !== '\t') throw new Error('Invalid CSV: text after a closing quote.')
      if (!closedQuote) cell += ch
    }
  }
  if (quoted) throw new Error('Invalid CSV: unclosed quoted field.')
  row.push(cell)
  if (row.some((value) => value.trim() !== '')) {
    rows.push(row)
    if (rows.length > maxRows) throw new Error(`CSV exceeds the ${maxRows - 1} daily observation limit.`)
  }
  return rows
}

export function parseDate(date: string): Pick<ClimateDay, 'date' | 'year' | 'month' | 'day'> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Date ${JSON.stringify(date)} must use YYYY-MM-DD.`)
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  if (year < 1600 || year > 2399) throw new Error(`Date ${date} is outside the supported 1600–2399 range.`)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.toISOString().slice(0, 10) !== date) throw new Error(`Date ${date} is not a valid calendar date.`)
  return { date, year, month, day }
}

function numeric(value: string, label: string): number {
  const trimmed = value.trim()
  // Number('') and Number('0x10') are not acceptable climate observations.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    throw new Error(`${label} must be a finite number. Missing observations are not imputed.`)
  }
  const number = Number(trimmed)
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite.`)
  return number
}

export function validateClimate(climate: readonly ClimateDay[]): void {
  if (!Array.isArray(climate) || climate.length === 0) throw new Error('Import at least one complete calendar year.')
  if (climate.length > MAX_CLIMATE_DAYS)
    throw new Error(`Climate input exceeds ${MAX_CLIMATE_DAYS.toLocaleString()} days.`)
  let previousTime: number | undefined
  for (let i = 0; i < climate.length; i++) {
    const day = climate[i]
    if (!day || typeof day.date !== 'string') throw new Error(`Climate row ${i + 1} has no date.`)
    const calendar = parseDate(day.date)
    for (const key of ['year', 'month', 'day'] as const) {
      if (day[key] !== calendar[key]) throw new Error(`${day.date}: ${key} disagrees with the date.`)
    }
    if (!Number.isFinite(day.tmn) || !Number.isFinite(day.tmx) || !Number.isFinite(day.ppt)) {
      throw new Error(
        `${day.date}: temperature and precipitation must be finite. Missing observations are not imputed.`,
      )
    }
    if (day.tmn < -100 || day.tmx > 80) throw new Error(`${day.date}: temperatures must be between −100 and 80 °C.`)
    if (day.tmn > day.tmx) throw new Error(`${day.date}: minimum temperature exceeds maximum temperature.`)
    if (day.ppt < 0 || day.ppt > 2_000)
      throw new Error(`${day.date}: precipitation must be between 0 and 2,000 mm/day.`)
    const time = Date.UTC(day.year, day.month - 1, day.day)
    if (previousTime !== undefined && time - previousTime !== DAY_MS) {
      throw new Error(
        `${day.date}: dates must be unique, chronological and continuous; do not concatenate separated years.`,
      )
    }
    previousTime = time
  }
  const first = climate[0]
  const last = climate[climate.length - 1]
  if (first.month !== 1 || first.day !== 1 || last.month !== 12 || last.day !== 31) {
    throw new Error('Use complete calendar years, from January 1 through December 31, including leap days.')
  }
}

/** Accepts date,tmn,tmx,ppt; optional year/month/day must agree with date. */
export function parseClimateCsv(text: string): ClimateDay[] {
  if (text.length > MAX_CLIMATE_CSV_BYTES) throw new Error('Climate CSV exceeds the 8 MB input limit.')
  const rows = readCsv(text, MAX_CLIMATE_DAYS + 1)
  if (rows.length < 2) throw new Error('CSV needs a header and daily observations: date,tmn,tmx,ppt.')
  const header = rows[0].map((cell) => cell.trim().toLowerCase())
  if (new Set(header).size !== header.length) throw new Error('CSV contains duplicate column names.')
  for (const required of ['date', 'tmn', 'tmx', 'ppt']) {
    if (!header.includes(required)) throw new Error(`CSV is missing ${required}. Required columns: date,tmn,tmx,ppt.`)
  }
  const climate = rows.slice(1).map((row, index): ClimateDay => {
    if (row.length !== header.length)
      throw new Error(`CSV row ${index + 2} has ${row.length} fields; expected ${header.length}.`)
    const calendar = parseDate(row[header.indexOf('date')].trim())
    for (const key of ['year', 'month', 'day'] as const) {
      const col = header.indexOf(key)
      if (col >= 0 && numeric(row[col], `Row ${index + 2} ${key}`) !== calendar[key]) {
        throw new Error(`CSV row ${index + 2}: ${key} disagrees with date.`)
      }
    }
    return {
      ...calendar,
      tmn: numeric(row[header.indexOf('tmn')], `Row ${index + 2} tmn`),
      tmx: numeric(row[header.indexOf('tmx')], `Row ${index + 2} tmx`),
      ppt: numeric(row[header.indexOf('ppt')], `Row ${index + 2} ppt`),
    }
  })
  validateClimate(climate)
  return climate
}

export function validateSoils(soils: readonly Soil[]): void {
  if (soils.length !== 5)
    throw new Error('The coupled model requires exactly five soils in order from xeric to subhygric.')
  for (let i = 0; i < soils.length; i++) {
    const soil = soils[i]
    if (soil.id !== i + 1 || typeof soil.label !== 'string' || !soil.label.trim()) {
      throw new Error('Soils must have IDs 1–5 in upstream row order and a nonempty label.')
    }
    if (![soil.afc, soil.awsc, soil.infiltrationRate].every(Number.isFinite))
      throw new Error(`Soil ${soil.id}: parameters must be finite.`)
    if (soil.afc <= 0 || soil.awsc < 0 || soil.awsc > soil.afc)
      throw new Error(`Soil ${soil.id}: require AFC > 0 and 0 ≤ AWSC ≤ AFC.`)
  }
}

export function validateMonthlyAnomalies(monthly: readonly MonthlyAnomaly[]): void {
  if (!Array.isArray(monthly) || monthly.length !== 12) {
    throw new Error('Each scenario requires exactly one anomaly for every month, 1–12.')
  }
  const seen = new Set<number>()
  for (const item of monthly) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(
        'Each monthly anomaly must be an object containing month, tminDelta, tmaxDelta and precipMultiplier.',
      )
    if (!Number.isInteger(item.month) || item.month < 1 || item.month > 12)
      throw new Error('Anomaly month must be an integer from 1 to 12.')
    if (seen.has(item.month)) throw new Error('Each scenario requires exactly one anomaly for every month, 1–12.')
    seen.add(item.month)
    if (![item.tminDelta, item.tmaxDelta, item.precipMultiplier].every(Number.isFinite))
      throw new Error(`Month ${item.month}: anomalies must be finite.`)
    if (item.precipMultiplier < 0) throw new Error(`Month ${item.month}: precipitation multiplier cannot be negative.`)
  }
}

export function applyMonthlyAnomalies(climate: readonly ClimateDay[], scenario: ScenarioInput): ClimateDay[] {
  validateMonthlyAnomalies(scenario.monthly)
  const months = new Map(scenario.monthly.map((item) => [item.month, item]))
  const adjusted = climate.map((day) => {
    const anomaly = months.get(day.month)!
    return {
      ...day,
      tmn: day.tmn + anomaly.tminDelta,
      tmx: day.tmx + anomaly.tmaxDelta,
      ppt: day.ppt * anomaly.precipMultiplier,
    }
  })
  validateClimate(adjusted)
  return adjusted
}

/** Selects a continuous inclusive range; it does not reproduce the old random-year sampling. */
export function selectYearRange(climate: readonly ClimateDay[], startYear: number, endYear: number): ClimateDay[] {
  validateClimate(climate)
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear)
    throw new Error('Select a valid inclusive year range.')
  const selected = climate.filter((day) => day.year >= startYear && day.year <= endYear).map((day) => ({ ...day }))
  validateClimate(selected)
  if (selected[0].year !== startYear || selected[selected.length - 1].year !== endYear)
    throw new Error('The selected years are not all available in this climate dataset.')
  return selected
}

/** Reproducible demonstration only: no observed station data or climate projection. */
export function createExampleClimateCsv(): string {
  const rows = ['date,tmn,tmx,ppt']
  const start = Date.UTC(2001, 0, 1)
  for (let i = 0; i < 365; i++) {
    const date = new Date(start + i * DAY_MS).toISOString().slice(0, 10)
    const mean = 3 + 13 * Math.sin((2 * Math.PI * (i - 100)) / 365)
    rows.push(`${date},${(mean - 5).toFixed(3)},${(mean + 5).toFixed(3)},${i % 7 === 0 ? 8 : 0}`)
  }
  return `${rows.join('\n')}\n`
}

export function climateTemplateCsv(): string {
  return createExampleClimateCsv()
}
