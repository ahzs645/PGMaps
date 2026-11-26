import { describe, expect, it } from 'vitest'
import { dailyWaterFile, validFilename } from './source'
import {
  dailyMeasuredAir,
  parseWeatherChunk,
  weatherChartRows,
  weatherCodes,
  weatherCsv,
  weatherRangeError,
  weatherValue,
} from './weatherData'

const header = 'TIMESTAMP,UTC Offset,AirT_C_Avg,AirT_C_Avg_Flag,Data_ID\nTS,UTC,Deg C,nan,nan\n'

describe('UNBC observation formats', () => {
  it('keeps source offsets, zeros, multi-code values, missing fields, and source units', () => {
    const { fields, units, rows } = parseWeatherChunk(
      header +
        '2025-05-01 00:00:00,-07:00,0,P,station1\n' +
        '2025-05-01 00:15:00,-07:00,1.4,"C, DC",station1\n' +
        '2025-05-01 01:15:00,-07:00,NAN,M,station1\n',
    )
    expect(rows[0].time).toBe(Date.parse('2025-05-01T07:00:00Z'))
    expect(weatherValue(rows[0], 'AirT_C_Avg')).toBe(0)
    expect(weatherCodes(rows[1], 'AirT_C_Avg')).toEqual(['C', 'DC'])
    expect(weatherValue(rows[2], 'AirT_C_Avg')).toBeNull()
    expect(weatherChartRows(rows, 'AirT_C_Avg', 'flagged').map((row) => row.reading)).toEqual([null, 1.4, null, null])
    expect(weatherCsv(fields, units, [rows[1]])).toContain('TS,UTC,Deg C,nan,nan')
    expect(weatherCsv(fields, units, [rows[1]])).toContain('00:15:00,-07:00,1.4,"C, DC"')
  })

  it('requires 72 distinct passing quarter hours to produce a measured daily mean', () => {
    const day = (count: number, date: string) =>
      Array.from({ length: count }, (_, index) => {
        const hours = String(Math.floor(index / 4)).padStart(2, '0')
        const minutes = String((index % 4) * 15).padStart(2, '0')
        return `${date} ${hours}:${minutes}:00,-07:00,2,P,station1\n`
      }).join('')
    const duplicate = '2025-05-01 00:00:00,-07:00,2,P,station1\n'
    const flagged = '2025-05-01 23:00:00,-07:00,6,C,station1\n'
    const { rows } = parseWeatherChunk(header + day(71, '2025-05-01') + duplicate + flagged + day(72, '2025-05-02'))
    expect([...dailyMeasuredAir(rows)]).toEqual([['2025-05-02', 2]])
  })

  it('accepts the current catalog filenames while keeping assets within the source directory', () => {
    expect(validFilename('02MF002_Goose Point.json', 'json')).toBe(true)
    expect(dailyWaterFile('02MF002_Goose Point.json')).toBe('data/02MF002_Goose%20Point.json')
    expect(validFilename('../stations.json', 'json')).toBe(false)
    expect(validFilename('badname%2Fstation.json', 'json')).toBe(false)
  })

  it('reports invalid ranges before any weather chunks are fetched', () => {
    const extent = ['2024-01-01', '2025-12-01'] as const
    expect(weatherRangeError(['2024-02-29', '2024-03-01'], extent)).toBeNull()
    expect(weatherRangeError(['2024-02-30', '2024-03-01'], extent)).toMatch(/Enter/)
    expect(weatherRangeError(['2024-01-01', '2024-04-03'], extent)).toMatch(/92 days/)
  })
})
