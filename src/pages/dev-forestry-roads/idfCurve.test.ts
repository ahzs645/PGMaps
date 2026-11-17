import { describe, expect, it } from 'vitest'
import {
  equationIntensity,
  idfCurveFromEccc,
  idfIntensity,
  logLogInterpolate,
  parseEcccIdfText,
  parseIdfCurve,
  type IdfCurve,
} from './idfCurve'

describe('IDF intensity', () => {
  it('interpolates linearly in log–log between table durations (hand calculation)', () => {
    // 100 mm/h at 10 min, 50 mm/h at 30 min. At 20 min:
    // ln i = ln 100 + (ln 2 / ln 3)(ln 50 − ln 100) → i = 100 · 2^(ln 0.5 / ln 3) = 64.576 mm/h.
    const table = [
      { durationMin: 10, intensityMmPerHr: 100 },
      { durationMin: 30, intensityMmPerHr: 50 },
    ]
    const reading = logLogInterpolate(table, 20)
    expect(reading.intensityMmPerHr).toBeCloseTo(64.576, 3)
    expect(reading.flag).toBeUndefined()
    // On a table point the point itself.
    expect(logLogInterpolate(table, 30).intensityMmPerHr).toBe(50)
    // A power law is reproduced exactly between its own points.
    const power = [5, 60, 1440].map((t) => ({ durationMin: t, intensityMmPerHr: 30 * (t / 60) ** -0.65 }))
    expect(logLogInterpolate(power, 15).intensityMmPerHr).toBeCloseTo(30 * 0.25 ** -0.65, 9)
  })

  it('never extrapolates: holds the end of the curve and flags it', () => {
    const table = [
      { durationMin: 5, intensityMmPerHr: 90 },
      { durationMin: 60, intensityMmPerHr: 25 },
    ]
    expect(logLogInterpolate(table, 2)).toEqual({ intensityMmPerHr: 90, readAtMin: 5, flag: 'below-idf' })
    expect(logLogInterpolate(table, 200)).toEqual({ intensityMmPerHr: 25, readAtMin: 60, flag: 'above-idf' })
  })

  it("reads ECCC's equation R = A·T^B with T in hours, within 5 min to 24 h", () => {
    const eq = { coefficientA: 30, exponentB: -0.65 }
    expect(equationIntensity(eq, 60).intensityMmPerHr).toBeCloseTo(30, 9)
    expect(equationIntensity(eq, 15).intensityMmPerHr).toBeCloseTo(73.8687, 3)
    expect(equationIntensity(eq, 2)).toMatchObject({ readAtMin: 5, flag: 'below-idf' })
    expect(equationIntensity(eq, 3000)).toMatchObject({ readAtMin: 1440, flag: 'above-idf' })
    const curve: IdfCurve = {
      stationName: 'Test',
      returnPeriodYears: 10,
      source: 'Entered by hand',
      use: 'equation',
      equation: eq,
    }
    expect(idfIntensity(curve, 60).intensityMmPerHr).toBeCloseTo(30, 9)
  })

  it('parses a curve by hand and refuses one that cannot be read', () => {
    const curve = {
      stationName: 'Test',
      returnPeriodYears: 10,
      source: 'Entered by hand',
      use: 'table',
      table: [
        { durationMin: 5, intensityMmPerHr: 90 },
        { durationMin: 60, intensityMmPerHr: 25 },
      ],
    }
    expect(parseIdfCurve(curve)).toEqual(curve)
    expect(() => parseIdfCurve({ ...curve, use: 'equation' })).toThrow(/equation but has none/)
    expect(() => parseIdfCurve({ ...curve, table: [...curve.table].reverse() })).toThrow(/must rise/)
    expect(() => parseIdfCurve({ ...curve, returnPeriodYears: 0 })).toThrow(/return period/)
  })
})

// The layout of an ECCC short-duration IDF station file, with invented numbers (no ECCC data).
const ECCC_LAYOUT = `
 Environment Canada/Environnement Canada

 Short Duration Rainfall Intensity-Duration-Frequency Data
 Données sur l'intensité, la durée et la fréquence des chutes de pluie de courte durée

 Gumbel - Method of moments/Méthode des moments

 2022/10/31

=========================================================================================================
     TEST STATION A                           BC     1000000
  Latitude: 54 00'N   Longitude: 122 00'W   Elevation/Altitude: 600 m
  Years/Années : 1970 - 2020   # Years/Années :  40
=========================================================================================================

*********************************************************************************
Table 2b :
Return Period Rainfall Rates (mm/h) -  95% Confidence limits
Intensité de la pluie (mm/h) par période de retour - Limites de confiance de 95%
*********************************************************************************
Duration/Durée        2       5      10      25      50     100    #Years
                   yr/ans  yr/ans  yr/ans  yr/ans  yr/ans  yr/ans  Années
   5 min           40.0    60.0    72.0    88.0   100.0   112.0     40
                 +/- 4.0 +/- 6.0 +/- 8.0 +/- 9.0 +/- 9.5 +/- 10.0   40
  10 min           30.0    45.0    54.0    66.0    75.0    84.0     40
                 +/- 3.0 +/- 4.0 +/- 5.0 +/- 6.0 +/- 7.0 +/- 8.0    40
  30 min           15.0    22.0   -99.9    32.0    36.0    40.0     40
   1 h             10.0    14.0    17.0    20.0    23.0    25.0     40
  24 h              1.0     1.5     1.8     2.2     2.5     2.8     40

*********************************************************************************
Table 3 : Interpolation Equation / Équation d'interpolation: R = A*T^B

  R = Interpolated Rainfall rate (mm/h)/Intensité interpolée de la pluie (mm/h)
  RR = Rainfall rate (mm/h) / Intensité de la pluie (mm/h)
  T = Rainfall duration (h) / Durée de la pluie (h)
*********************************************************************************
Statistics/Statistiques        2       5      10      25      50     100
                            yr/ans  yr/ans  yr/ans  yr/ans  yr/ans  yr/ans
Mean of RR/Moyenne de RR      19.2    28.5    34.1    41.6    47.3    52.8
Coefficient (A)               10.1    14.2    17.0    20.4    23.1    25.6
Exponent/Exposant (B)       -0.700  -0.690  -0.680  -0.670  -0.660  -0.650
Mean % Error/% erreur moyenne  5.0     5.5     6.0     6.5     7.0     7.5
`

describe('ECCC IDF station file', () => {
  it('reads the station line, Table 2b rates and Table 3 equation by hand', () => {
    const file = 'idf_v3-30_2022_10_31_100_BC_1000000_TEST_STATION_A.txt'
    const station = parseEcccIdfText(ECCC_LAYOUT, file)
    expect(station).toMatchObject({
      stationName: 'TEST STATION A',
      stationId: '1000000',
      province: 'BC',
      producedOn: '2022/10/31',
      version: '3.30',
      returnPeriodsYears: [2, 5, 10, 25, 50, 100],
    })
    // The "+/-" confidence lines are not durations.
    expect(station.rates.map((r) => r.durationMin)).toEqual([5, 10, 30, 60, 1440])
    expect(station.rates[2].mmPerHr[2]).toBeNull()
    expect(station.equations?.[2]).toEqual({ coefficientA: 17, exponentB: -0.68 })

    const curve = idfCurveFromEccc(station, 10, file)
    expect(curve.table?.map((p) => p.durationMin)).toEqual([5, 10, 60, 1440])
    expect(curve.table?.[0].intensityMmPerHr).toBe(72)
    expect(curve.equation).toEqual({ coefficientA: 17, exponentB: -0.68 })
    expect(curve.source).toMatch(/ECCC Engineering Climate Datasets IDF \(v3\.30, 2022\/10\/31\)/)
    expect(() => idfCurveFromEccc(station, 20, file)).toThrow(/no 20-year column/)
  })

  it('refuses a file without Table 2b', () => {
    expect(() => parseEcccIdfText('Station data\n5 min 40 50')).toThrow(/Table 2b/)
  })
})
