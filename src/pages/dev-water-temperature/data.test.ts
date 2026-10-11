import { describe, expect, it } from 'vitest'
import {
  aggregate,
  normalizeObservations,
  observationsCsv,
  seasonalPoints,
  timeRows,
  trailingMonthRange,
  type Observation,
  type Series,
} from './data'

const days = (month: string, count: number, value = 10): Observation[] =>
  Array.from({ length: count }, (_, index) => ({
    date: `${month}-${String(index + 1).padStart(2, '0')}`,
    temp_c: value,
    airtemp_c: 12,
  }))

describe('UNBC observation calculations', () => {
  it('uses calendar months for zoom presets and clamps month ends and catalog bounds', () => {
    expect(trailingMonthRange(['2020-01-01', '2024-03-31'], 1)).toEqual(['2024-02-29', '2024-03-31'])
    expect(trailingMonthRange(['2020-01-01', '2023-03-31'], 1)).toEqual(['2023-02-28', '2023-03-31'])
    expect(trailingMonthRange(['2024-03-01', '2024-03-31'], 6)).toEqual(['2024-03-01', '2024-03-31'])
    expect(trailingMonthRange(null, 12)).toBeNull()
  })
  it('preserves zero and missing values, rejects invalid dates and deduplicates daily observations', () => {
    expect(
      normalizeObservations([
        { date: '2023-02-29', temp_c: 3 },
        { date: '2024-02-29', temp_c: 0, airtemp_c: null },
        { date: '2024-03-01', temp_c: '5', airtemp_c: 0 },
        { date: '2024-02-29', temp_c: 0, airtemp_c: 2 },
      ]),
    ).toEqual([
      { date: '2024-02-29', temp_c: 0, airtemp_c: 2 },
      { date: '2024-03-01', temp_c: null, airtemp_c: 0 },
    ])
  })

  it('requires 75% of the actual calendar days in each month', () => {
    expect(aggregate(days('2023-02', 21), 'month', 1, 12)[0]).toMatchObject({ value: 10, expected: 28 })
    expect(aggregate(days('2024-02', 21), 'month', 1, 12)[0]).toMatchObject({ value: null, expected: 29 })
    expect(aggregate(days('2023-01', 23), 'month', 1, 12)[0].value).toBeNull()
  })

  it('groups a November–February season across New Year and checks missing-day coverage', () => {
    const input = [...days('2023-11', 30), ...days('2023-12', 31), ...days('2024-01', 31), ...days('2024-02', 29)]
    expect(aggregate(input, 'season', 11, 2)).toEqual([
      { date: '2023-11-01', time: Date.UTC(2023, 10, 1), count: 121, expected: 121, value: 10 },
    ])
    expect(aggregate(input.slice(0, 90), 'season', 11, 2)[0].value).toBeNull()
  })

  it('aligns March 1 across leap and non-leap years and keeps February 29 separate', () => {
    const values = seasonalPoints([
      { date: '2023-03-01', temp_c: 10, airtemp_c: null },
      { date: '2024-03-01', temp_c: 20, airtemp_c: null },
      { date: '2024-02-29', temp_c: 5, airtemp_c: null },
    ])
    expect(values).toHaveLength(2)
    expect(values[1]).toMatchObject({ time: Date.UTC(2000, 2, 1), mean: 15, range: [10, 20], count: 2 })
  })

  it('inserts missing daily dates instead of joining across gaps, and exports only the selected range', () => {
    const series: Series[] = [
      {
        station: { station_id: 'A', waterbody_name: 'A, "river"', latitude: 54, longitude: -124 } as Series['station'],
        color: 'red',
        data: [
          { date: '2024-01-01', temp_c: 0, airtemp_c: null },
          { date: '2024-01-03', temp_c: 10, airtemp_c: 15 },
        ],
      },
    ]
    expect(timeRows(series, 'day', 1, 12)[1]).toEqual({ time: Date.UTC(2024, 0, 2), A: null })
    const csv = observationsCsv(series, ['2024-01-01', '2024-01-01'], '2025-07-16')
    expect(csv).toContain('"A, ""river"""')
    expect(csv).toContain('"0",""')
    expect(csv).not.toContain('2024-01-03')
  })
})
