export type TimelineKey = string | number

export type TimelineValue = number | null | undefined

export type TimelineChangeStatus = 'changed' | 'new' | 'removed' | 'unchanged' | 'missing'

export interface PercentageChangeOptions {
  zeroBaseline?: 'null' | 'infinity'
}

export interface PercentageChangeResult {
  startValue: number | null
  endValue: number | null
  absoluteChange: number | null
  percentChange: number | null
  status: TimelineChangeStatus
}

export interface TimelineRange<TTime extends TimelineKey = TimelineKey> {
  start: TTime
  end: TTime
}

export interface TimelinePoint<TTime extends TimelineKey = TimelineKey> {
  time: TTime
  value: number
}

export interface UnitTimelineChange<TUnit extends TimelineKey = TimelineKey, TTime extends TimelineKey = TimelineKey>
  extends PercentageChangeResult {
  unit: TUnit
  startTime: TTime | null
  endTime: TTime | null
  points: TimelinePoint<TTime>[]
}

export interface TimelineChangeOptions<TRecord, TUnit extends TimelineKey, TTime extends TimelineKey> extends PercentageChangeOptions {
  unit: (record: TRecord) => TUnit | null | undefined
  time: (record: TRecord) => TTime | null | undefined
  value: (record: TRecord) => TimelineValue
  range?: TimelineRange<TTime>
  aggregate?: (values: readonly number[]) => number
}

export const timelineAggregations = {
  sum: (values: readonly number[]) => values.reduce((total, value) => total + value, 0),
  average: (values: readonly number[]) => {
    if (values.length === 0) return 0
    return timelineAggregations.sum(values) / values.length
  },
  min: (values: readonly number[]) => Math.min(...values),
  max: (values: readonly number[]) => Math.max(...values),
}

export function createTrailingYearRange(endYear: number, years: number): TimelineRange<number> {
  const safeYears = Math.max(1, Math.floor(years))

  return {
    start: endYear - safeYears + 1,
    end: endYear,
  }
}

export function calculatePercentageChange(
  startValue: TimelineValue,
  endValue: TimelineValue,
  options: PercentageChangeOptions = {}
): PercentageChangeResult {
  const start = asFiniteNumber(startValue)
  const end = asFiniteNumber(endValue)

  if (start === null || end === null) {
    return {
      startValue: start,
      endValue: end,
      absoluteChange: null,
      percentChange: null,
      status: 'missing',
    }
  }

  const absoluteChange = end - start

  if (start === 0) {
    if (end === 0) {
      return {
        startValue: start,
        endValue: end,
        absoluteChange,
        percentChange: 0,
        status: 'unchanged',
      }
    }

    return {
      startValue: start,
      endValue: end,
      absoluteChange,
      percentChange: options.zeroBaseline === 'infinity' ? (end > 0 ? Infinity : -Infinity) : null,
      status: end > 0 ? 'new' : 'removed',
    }
  }

  const percentChange = (absoluteChange / Math.abs(start)) * 100

  return {
    startValue: start,
    endValue: end,
    absoluteChange,
    percentChange,
    status: absoluteChange === 0 ? 'unchanged' : 'changed',
  }
}

export function calculateTimelinePercentageChanges<TRecord, TUnit extends TimelineKey, TTime extends TimelineKey>(
  records: readonly TRecord[],
  options: TimelineChangeOptions<TRecord, TUnit, TTime>
): UnitTimelineChange<TUnit, TTime>[] {
  const aggregate = options.aggregate ?? timelineAggregations.sum
  const valuesByUnitAndTime = new Map<TUnit, Map<TTime, number[]>>()

  records.forEach((record) => {
    const unit = options.unit(record)
    const time = options.time(record)
    const value = asFiniteNumber(options.value(record))

    if (unit == null || time == null || value === null) return
    if (options.range && !isWithinRange(time, options.range)) return

    const valuesByTime = valuesByUnitAndTime.get(unit) ?? new Map<TTime, number[]>()
    const values = valuesByTime.get(time) ?? []

    values.push(value)
    valuesByTime.set(time, values)
    valuesByUnitAndTime.set(unit, valuesByTime)
  })

  return Array.from(valuesByUnitAndTime.entries())
    .map(([unit, valuesByTime]) => {
      const points = Array.from(valuesByTime.entries())
        .map(([time, values]) => ({ time, value: aggregate(values) }))
        .sort((left, right) => compareTimelineKeys(left.time, right.time))

      const firstPoint = points[0] ?? null
      const lastPoint = points[points.length - 1] ?? null
      const change = calculatePercentageChange(firstPoint?.value, lastPoint?.value, options)

      return {
        unit,
        startTime: firstPoint?.time ?? null,
        endTime: lastPoint?.time ?? null,
        points,
        ...change,
      }
    })
    .sort((left, right) => compareTimelineKeys(left.unit, right.unit))
}

export function formatPercentChange(value: number | null, digits = 1): string {
  if (value === null) return 'n/a'
  if (value === Infinity) return '+∞%'
  if (value === -Infinity) return '-∞%'

  const formatted = `${Math.abs(value).toFixed(digits)}%`
  if (value > 0) return `+${formatted}`
  if (value < 0) return `-${formatted}`
  return formatted
}

function asFiniteNumber(value: TimelineValue): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isWithinRange<TTime extends TimelineKey>(time: TTime, range: TimelineRange<TTime>): boolean {
  return compareTimelineKeys(time, range.start) >= 0 && compareTimelineKeys(time, range.end) <= 0
}

function compareTimelineKeys(left: TimelineKey, right: TimelineKey): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), undefined, { numeric: true })
}
