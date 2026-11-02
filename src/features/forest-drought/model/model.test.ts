// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import {
  applyMonthlyAnomalies,
  ASMR_CLASSES,
  classifyAsmr,
  createExampleClimateCsv,
  DEFAULT_SOILS,
  MAX_SOIL_DAY_EVALUATIONS,
  parseClimateCsv,
  readCsv,
  runSimulation,
  selectYearRange,
  simulationDailyCsv,
  simulationSummaryCsv,
  validateClimate,
  type ClimateDay,
  type ScenarioInput,
} from './index'

function uniform(year: number, tmn: number, tmx: number, ppt: number): ClimateDay[] {
  const days: ClimateDay[] = []
  for (let time = Date.UTC(year, 0, 1); time < Date.UTC(year + 1, 0, 1); time += 86_400_000) {
    const date = new Date(time)
    days.push({
      date: date.toISOString().slice(0, 10),
      year,
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      tmn,
      tmx,
      ppt,
    })
  }
  return days
}

function scenario(id = 'custom'): ScenarioInput {
  return {
    id,
    label: 'Custom sensitivity',
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      tminDelta: 2,
      tmaxDelta: 3,
      precipMultiplier: 0.8,
    })),
  }
}

describe('climate import and chronological model preconditions', () => {
  it('parses the reproducible full-year example, quoted headers and explicit optional date columns', () => {
    const text = createExampleClimateCsv()
    const climate = parseClimateCsv(
      text.replace('date,tmn,tmx,ppt', '\uFEFF"date","tmn","tmx","ppt"').replace(/\n/g, '\r\n'),
    )
    expect(climate).toHaveLength(365)
    expect(climate[0].date).toBe('2001-01-01')
    expect(climate.at(-1)?.date).toBe('2001-12-31')
    expect(climate).toEqual(parseClimateCsv(text))
  })

  it('requires leap days, continuous ascending unique dates and complete years', () => {
    const leap = uniform(2000, -5, 5, 1)
    expect(leap).toHaveLength(366)
    expect(() => validateClimate(leap)).not.toThrow()
    expect(() => validateClimate(leap.filter((day) => day.date !== '2000-02-29'))).toThrow(/continuous/)
    expect(() => validateClimate([leap[0], ...leap])).toThrow(/unique/)
    expect(() => validateClimate([...leap].reverse())).toThrow(/chronological/)
    expect(() => validateClimate(leap.slice(1))).toThrow(/complete calendar/)
    expect(() => validateClimate([...leap, ...uniform(2002, -5, 5, 1)])).toThrow(/continuous/)
  })

  it('rejects invalid dates, missing values, numeric prefixes, duplicates and ragged rows', () => {
    const example = createExampleClimateCsv()
    expect(() => parseClimateCsv(example.replace('2001-01-01', '2001-02-29'))).toThrow(/valid calendar/)
    expect(() => parseClimateCsv(example.replace(/2001-01-01,[^,]+,/, '2001-01-01,,'))).toThrow(/Missing observations/)
    expect(() => parseClimateCsv(example.replace(/2001-01-01,[^,]+,/, '2001-01-01,0x10,'))).toThrow(/finite number/)
    expect(() => parseClimateCsv(example.replace('tmn,tmx', 'tmn,tmn'))).toThrow(/duplicate column/)
    expect(() => parseClimateCsv(example.replace('2001-01-01,', '2001-01-01,0,'))).toThrow(/fields/)
    expect(() => readCsv('a,"unclosed')).toThrow(/unclosed/)
    expect(() => readCsv('date,tmn,tmx,ppt\na,1,2,3\nb,1,2,3', 2)).toThrow(/observation limit/)
  })

  it('does not silently correct invalid physical observations or mutate imported data', () => {
    const climate = uniform(2001, 10, 20, 0)
    const broken = climate.map((day) => ({ ...day }))
    broken[3].tmn = 25
    expect(() => validateClimate(broken)).toThrow(/minimum temperature/)
    broken[3] = { ...climate[3], ppt: -1 }
    expect(() => validateClimate(broken)).toThrow(/precipitation/)
    broken[3] = { ...climate[3], ppt: Number.NaN }
    expect(() => validateClimate(broken)).toThrow(/finite/)
    const before = JSON.stringify(climate)
    runSimulation({ climate, latitude: 55 })
    expect(JSON.stringify(climate)).toBe(before)
  })

  it('selects an explicit continuous year range rather than joining random years', () => {
    const climate = [...uniform(2000, 0, 10, 2), ...uniform(2001, 0, 10, 2)]
    expect(selectYearRange(climate, 2001, 2001)).toHaveLength(365)
    expect(() => selectYearRange(climate, 1999, 2001)).toThrow(/not all available/)
    expect(() => selectYearRange(climate, 2001, 2000)).toThrow(/valid inclusive/)
  })
})

describe('original daily water-balance recurrence', () => {
  it('uses the final 47 snowfall records and gives PET-zero days a ratio of one', () => {
    const result = runSimulation({ climate: uniform(2000, -15, -8, 2), latitude: 55 })
    expect(result.baseline.initialSnowpack).toBe(94)
    expect(result.baseline.daily[0].snowpack).toBe(96)
    expect(result.baseline.daily[365].snowpack).toBe(826)
    expect(result.baseline.daily.every((day) => day.pet === 0 && day.soils.every((soil) => soil.ratio === 1))).toBe(
      true,
    )
    expect(
      result.baseline.summary.every(
        (soil) => soil.meanRatio === 1 && soil.ratioOfTotals === null && soil.asmrClass === 'F',
      ),
    ).toBe(true)
  })

  it('retains first-day initialization and runoff after clamping, including lateral recharge', () => {
    const result = runSimulation({ climate: uniform(2001, 10, 25, 0), latitude: 55 })
    const [first, second] = result.baseline.daily
    expect(first.soils.map((soil) => soil.storage)).toEqual(DEFAULT_SOILS.map((soil) => soil.afc))
    expect(first.soils.every((soil) => soil.ratio === 1 && soil.runoff === 0)).toBe(true)
    expect(second.soils.map((soil) => soil.runoff)).toEqual([7.5, 25.9, 24.9, 0, -28.4])
    for (let k = 0; k < 5; k++)
      expect(second.soils[k].storage).toBeCloseTo(DEFAULT_SOILS[k].afc - second.pet - second.soils[k].runoff, 12)
    expect(second.soils[4].storage).toBeGreaterThan(DEFAULT_SOILS[4].afc)
    expect(
      result.baseline.daily
        .at(-1)
        ?.soils.slice(0, 4)
        .every((soil) => soil.ratio === 0),
    ).toBe(true)
  })

  it('keeps the negative-infiltration branch for the third soil as in upstream', () => {
    const soils = DEFAULT_SOILS.map((soil) => ({ ...soil }))
    soils[2].infiltrationRate = -10
    const result = runSimulation({ climate: uniform(2001, 10, 25, 0), latitude: 55, soils })
    expect(result.baseline.daily[1].soils[2].runoff).toBe(-10)
    expect(result.baseline.daily[1].soils[2].storage).toBeGreaterThan(soils[2].afc)
  })

  it('allows only the three upstream latitude tables and enforces work budgets', () => {
    const climate = parseClimateCsv(createExampleClimateCsv())
    expect(() => runSimulation({ climate, latitude: 54 as 55 })).toThrow(/exactly 50, 55 or 60/)
    const at50 = runSimulation({ climate, latitude: 50 })
    const at60 = runSimulation({ climate, latitude: 60 })
    expect(at50.baseline.daily[180].pet).not.toBe(at60.baseline.daily[180].pet)
    const manyYears = Array.from({ length: 30 }, (_, i) => uniform(1980 + i, 0, 10, 2)).flat()
    const scenarios = Array.from({ length: 9 }, (_, i) => scenario(`s${i}`))
    expect(manyYears.length * 5 * 10).toBeGreaterThan(MAX_SOIL_DAY_EVALUATIONS)
    expect(() => runSimulation({ climate: manyYears, latitude: 55, scenarios })).toThrow(/soil-day budget/)
  })

  it('reports monotonic progress, validates all custom scenarios first, and leaves default soils intact', () => {
    const climate = parseClimateCsv(createExampleClimateCsv())
    const progress: number[] = []
    const before = JSON.stringify(DEFAULT_SOILS)
    runSimulation({ climate, latitude: 55, scenarios: [scenario()] }, (fraction) => progress.push(fraction))
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1)
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true)
    expect(JSON.stringify(DEFAULT_SOILS)).toBe(before)
    expect(() => runSimulation({ climate, latitude: 55, scenarios: [scenario('current')] })).toThrow(/reserved/)
    expect(() => runSimulation({ climate, latitude: 55, soils: [] })).toThrow(/exactly five/)
  })
})

describe('anomalies, classification and summary policies', () => {
  it('applies anomalies by month while preserving chronology and refusing undefined months', () => {
    const climate = uniform(2000, 0, 10, 10)
    const custom = scenario()
    custom.monthly.reverse()
    const adjusted = applyMonthlyAnomalies(climate, custom)
    expect(adjusted.map((day) => day.date)).toEqual(climate.map((day) => day.date))
    expect(adjusted[0]).toMatchObject({ tmn: 2, tmx: 13, ppt: 8 })
    expect(climate[0]).toMatchObject({ tmn: 0, tmx: 10, ppt: 10 })
    custom.monthly[0].month = custom.monthly[1].month
    expect(() => applyMonthlyAnomalies(climate, custom)).toThrow(/every month/)
    const negative = scenario()
    negative.monthly[0].precipMultiplier = -1
    expect(() => applyMonthlyAnomalies(climate, negative)).toThrow(/cannot be negative/)
  })

  it('reproduces the open-zero, closed-upper ASMR class intervals', () => {
    expect(classifyAsmr(0)).toBeNull()
    expect(classifyAsmr(-1)).toBeNull()
    expect(classifyAsmr(1.0001)).toBeNull()
    expect(classifyAsmr(Number.NaN)).toBeNull()
    for (const entry of ASMR_CLASSES) expect(classifyAsmr(entry.upper)).toBe(entry.label)
    expect(classifyAsmr(0.55000001)).toBe('VD1')
  })

  it('separates mean daily ratios from the ratio of totals and makes monthly weighting explicit', () => {
    const climate = parseClimateCsv(createExampleClimateCsv())
    const daily = runSimulation({ climate, latitude: 55, summaryPolicy: 'day-weighted' })
    const monthly = runSimulation({ climate, latitude: 55, summaryPolicy: 'equal-month' })
    const expectedDaily = daily.baseline.daily.reduce((total, day) => total + day.soils[0].ratio, 0) / 365
    const expectedMonthly = daily.baseline.monthly.reduce((total, month) => total + month.soils[0].meanRatio, 0) / 12
    expect(daily.baseline.summary[0].meanRatio).toBe(expectedDaily)
    expect(monthly.baseline.summary[0].meanRatio).toBe(expectedMonthly)
    expect(expectedDaily).not.toBe(expectedMonthly)
    expect(daily.baseline.summary[0].ratioOfTotals).not.toBe(expectedDaily)
    expect(daily.baseline.monthly).toEqual(monthly.baseline.monthly)
  })

  it('exports traceable summary and daily CSV without spreadsheet formulas in user labels', () => {
    const custom = scenario()
    custom.label = '=HYPERLINK("https://example.invalid")'
    const result = runSimulation({
      climate: parseClimateCsv(createExampleClimateCsv()),
      latitude: 55,
      scenarios: [custom],
    })
    const summary = readCsv(simulationSummaryCsv(result))
    expect(summary[0]).toContain('summary_policy')
    expect(summary[1]).toContain(result.model.sourceCommit)
    expect(summary.some((row) => row.includes(`'${custom.label}`))).toBe(true)
    const daily = readCsv(simulationDailyCsv(result))
    expect(daily).toHaveLength(366)
    expect(daily[0]).toContain('S5_runoff_mm')
    expect(() => simulationDailyCsv(result, 'absent')).toThrow(/Unknown scenario/)
  })
})
