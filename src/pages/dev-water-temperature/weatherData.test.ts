import { describe, expect, it } from 'vitest'
import { dailyWaterFile, validFilename } from './source'
import {
  dailyMeasuredAir,
  displayUnit,
  variableLabel,
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

describe('displayUnit', () => {
  it('prints symbols for the logger unit row and drops placeholder units', () => {
    expect(displayUnit('Deg C')).toBe('°C')
    expect(displayUnit('W/m^2')).toBe('W/m²')
    expect(displayUnit('meters/second')).toBe('m/s')
    expect(displayUnit('hPa')).toBe('hPa')
    expect(displayUnit('%')).toBe('%')
    expect(displayUnit('nan')).toBeUndefined()
    expect(displayUnit('unitless')).toBeUndefined()
    expect(displayUnit(undefined)).toBeUndefined()
  })
})

/** The variables each station offers (fields with a QC column) in UNBC's catalog, November 2026. */
const OFFERED: Record<string, string[]> = {
  '02FW003': [
    'BattV_Avg',
    'PTemp_C_Avg',
    'SR50AT_TCDT_Avg',
    'SR50AT_Q_Avg',
    'SR50AT_SRTmp_C_Avg',
    'SR50AT_DBTCDT_Avg',
    'SlrFD_W_Avg',
    'Rain_mm_Tot',
    'Strikes_Tot',
    'Dist_km_Avg',
    'WS_ms_Avg',
    'WindDir',
    'WindDir_SD1_WVT',
    'MaxWS_ms_Avg',
    'AirT_C_Avg',
    'VP_hPa_Avg',
    'BP_hPa_Avg',
    'RH',
    'RHT_C_Avg',
    'TiltNS_deg_Avg',
    'TiltWE_deg_Avg',
    'SlrTF_MJ_Tot',
    'T109_AirT_C_Avg',
    'Gtmp_Avg',
    'SWin_Avg',
    'SWout_Avg',
    'LWin_Avg',
    'LWout_Avg',
    'SWnet_Avg',
    'LWnet_Avg',
    'SWalbedo_Avg',
    'NR_Avg',
  ],
  '02FW005': [
    'BattV_Avg',
    'PTemp_C_Avg',
    'SlrFD_W_Avg',
    'Rain_mm_Tot',
    'Strikes_Tot',
    'Dist_km_Avg',
    'WS_ms_Avg',
    'WindDir',
    'MaxWS_ms_Avg',
    'AirT_C_Avg',
    'VP_hPa_Avg',
    'BP_hPa_Avg',
    'RH',
    'RHT_C_Avg',
    'TiltNS_deg_Avg',
    'TiltWE_deg_Avg',
    'SlrTF_MJ_Tot',
    'DT_Avg',
    'TCDT_Avg',
    'DBTCDT_Avg',
    'SWin_Avg',
    'SWout_Avg',
    'LWin_Avg',
    'LWout_Avg',
    'SWnet_Avg',
    'LWnet_Avg',
    'SWalbedo_Avg',
    'NR_Avg',
    'Stmp_Avg',
    'Gtmp_Avg',
  ],
  '02FW006': [
    'BattV_Avg',
    'PTemp_C_Avg',
    'SlrFD_W_Avg',
    'Rain_mm_Tot',
    'Strikes_Tot',
    'Dist_km_Avg',
    'WS_ms_Avg',
    'WindDir',
    'WindDir_SD1_WVT',
    'MaxWS_ms_Avg',
    'AirT_C_Avg',
    'VP_hPa_Avg',
    'BP_hPa_Avg',
    'RH',
    'RHT_C_Avg',
    'TiltNS_deg_Avg',
    'TiltWE_deg_Avg',
    'SlrTF_MJ_Tot',
    'SV_DT_Avg',
    'SV_Q_Avg',
    'SV_TCDT_Avg',
    'SV_DBTCDT_Avg',
    'SV_Tmp_Avg',
    'SV_RH',
    'SV_Pitch',
    'SV_Roll',
    'SV_Volt',
    'SV_Freq',
    'SV_Alert',
    'Gtmp_0cm_Avg',
    'Gtmp_5cm_Avg',
    'Gtmp_10cm_Avg',
    'Gtmp_15cm_Avg',
    'Gtmp_20cm_Avg',
    'T109_AirT_C_Avg',
    'SWin_Avg',
    'SWout_Avg',
    'LWin_Avg',
    'LWout_Avg',
    'SWnet_Avg',
    'LWnet_Avg',
    'SWalbedo_Avg',
    'NR_Avg',
  ],
  '02FW008': [
    'BattV_Avg',
    'PTemp_C_Avg',
    'SlrFD_W_Avg',
    'Rain_mm_Tot',
    'Strikes_Tot',
    'Dist_km_Max',
    'WS_ms_Avg',
    'WindDir',
    'WindDir_SD1_WVT',
    'MaxWS_ms_Avg',
    'AirT_C_Avg',
    'VP_hPa_Avg',
    'BP_hPa_Avg',
    'RH',
    'RHT_C_Avg',
    'TiltNS_deg_Avg',
    'TiltWE_deg_Avg',
    'SlrTF_MJ_Tot',
    'SWin_Avg',
    'SWout_Avg',
    'LWin_Avg',
    'LWout_Avg',
    'SWnet_Avg',
    'LWnet_Avg',
    'SWalbedo_Avg',
    'NR_Avg',
    'SV_DT_Avg',
    'SV_Q_Avg',
    'SV_TCDT_Avg',
    'SV_DBTCDT_Avg',
    'SV_Tmp_Avg',
    'SV_RH',
    'SV_Pitch',
    'SV_Roll',
    'SV_Volt',
    'SV_Freq',
    'SV_Alert',
    'T109_AirT_C_Avg',
    'Gtmp_Avg',
  ],
  '02MF005': [
    'BattV_Avg',
    'BP_hPa_Avg',
    'Rain_mm_Tot',
    'WS_ms_Avg',
    'WS_Std',
    'WindDir',
    'WindDir_Avg',
    'AirT_C_Avg',
    'RH',
    'Gtmp_Avg',
    'DT_Avg',
    'TCDT_Avg',
    'DBTCDT_Avg',
    'Original_WindDir',
    'Original_WindDir_Avg',
    'PTemp_C_Avg',
    'SlrFD_W_Avg',
    'Strikes_Tot',
    'Dist_km_Max',
    'WS_ms_Avg_2',
    'WindDir_2',
    'WindDir_SD1_WVT_2',
    'MaxWS_ms_Avg',
    'VP_hPa_Avg',
    'RHT_C_Avg',
    'TiltNS_deg_Avg',
    'TiltWE_deg_Avg',
    'SlrTF_MJ_Tot',
    'WindDir_SD1_WVT',
  ],
  '02MF009': [
    'BattV_Avg',
    'PTemp_C_Avg',
    'SlrFD_W_Avg',
    'Rain_mm_Tot',
    'Strikes_Tot',
    'Dist_km_Avg',
    'WS_ms_Avg',
    'WindDir',
    'WindDir_SD1',
    'MaxWS_ms_Avg',
    'AirT_C_Avg',
    'VP_hPa_Avg',
    'BP_hPa_Avg',
    'RH',
    'RHT_C_Avg',
    'TiltNS_deg_Avg',
    'TiltWE_deg_Avg',
    'SlrTF_MJ_Tot',
  ],
  '02PE002': [
    'BattV_Avg',
    'BP_hPa_Avg',
    'WS_ms_Avg',
    'WS_Std',
    'WindDir',
    'AirT_C_Avg',
    'RH',
    'Gtmp_24cm depth',
    'GTMP_13cm',
    'T109_AirT_C_Avg',
    'DT_Avg',
    'TCDT_Avg',
    'DBTCDT_Avg',
    'Rain_mm_Tot',
    'SlrFD_W_Avg',
    'SlrFD_W_Std',
    'SlrTF_MJ_Tot',
  ],
}

describe('variableLabel', () => {
  it("names every variable a station offers, from the stations' data dictionaries", () => {
    expect(variableLabel('Gtmp_10cm_Avg')).toBe('Ground temperature, 10 cm deep')
    expect(variableLabel('SWin_Avg')).toBe('Incoming shortwave radiation')
    expect(variableLabel('SV_TCDT_Avg')).toBe('Snow sensor distance to surface, temperature-corrected (SnowVue)')
    for (const [station, fields] of Object.entries(OFFERED)) {
      const unnamed = fields.filter((field) => variableLabel(field) === field)
      expect(unnamed, station).toEqual([])
      const labels = fields.map(variableLabel)
      expect(new Set(labels).size, `${station} shows two variables under one name`).toBe(labels.length)
    }
  })
})
