// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import {
  averageMonthlyNormals,
  deriveMonthlyAnomalies,
  parseDate,
  runSimulation,
  selectPreferredYears,
  simulationConfigurationJson,
  summarizeCalculatedYears,
  type ClimateDay,
  type MonthlyNormal,
  type ScenarioInput,
  type SimulationInput,
} from './index'

function years(first: number, last: number): ClimateDay[] {
  const climate: ClimateDay[] = []
  for (let day = Date.UTC(first, 0, 1); day < Date.UTC(last + 1, 0, 1); day += 86400000) {
    climate.push({ ...parseDate(new Date(day).toISOString().slice(0, 10)), tmn: 0, tmx: 10, ppt: 2 })
  }
  return climate
}

function normals(tmn: number, tmx: number, ppt: number): MonthlyNormal[] {
  return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, tmn, tmx, ppt }))
}

describe('explicit legacy preparation policies', () => {
  it('derives additive temperature and multiplicative precipitation anomalies after averaging normals', () => {
    const baseline = normals(1, 11, 20)
    const future = averageMonthlyNormals([normals(2, 13, 10), normals(4, 15, 20)])
    const anomaly = deriveMonthlyAnomalies(baseline, future)
    expect(anomaly[0]).toEqual({ month: 1, tminDelta: 2, tmaxDelta: 3, precipMultiplier: 0.75 })
    expect(deriveMonthlyAnomalies([...baseline].reverse(), [...future].reverse())).toEqual(anomaly)
    expect(() => deriveMonthlyAnomalies(normals(0, 10, 0), future)).toThrow(/undefined/)
    expect(() => averageMonthlyNormals([])).toThrow(/at least one/)
  })

  it('honours count and preferred windows with repeatable seed rather than claiming R RNG parity', () => {
    const climate = years(1958, 1965)
    const options = { count: 3, seed: 17 }
    const selected = selectPreferredYears(climate, options)
    expect(selected).toHaveLength(3)
    expect(selected.every((year) => year >= 1961 && year <= 1965)).toBe(true)
    expect(selectPreferredYears(climate, options)).toEqual(selected)
    const expanded = selectPreferredYears(climate, { count: 7, seed: 0 })
    expect(expanded).toHaveLength(7)
    expect(expanded).toEqual(expect.arrayContaining([1961, 1962, 1963, 1964, 1965]))
    expect(() => selectPreferredYears(climate, { count: 9 })).toThrow(/Only 8/)
    expect(() => selectPreferredYears(climate, { count: 0 })).toThrow(/positive integer/)
  })

  it('selects summaries after the continuous simulation while preserving the original state provenance', () => {
    const result = runSimulation({ climate: years(2000, 2002), latitude: 55 })
    const selected = summarizeCalculatedYears(result, [2002, 2000])
    expect(selected.sourceYears).toEqual([2000, 2001, 2002])
    expect(selected.selectedYears).toEqual([2000, 2002])
    expect(selected.baseline.annual).toEqual([result.baseline.annual[0], result.baseline.annual[2]])
    expect(() => summarizeCalculatedYears(result, [1999])).toThrow(/present/)
    expect(() => summarizeCalculatedYears(result, [2000, 2000])).toThrow(/unique/)
    const configuration = JSON.parse(simulationConfigurationJson(result))
    expect(configuration).toMatchObject({
      latitude: 55,
      years: [2000, 2001, 2002],
      summaryPolicy: 'day-weighted',
      scenarios: [],
    })
    expect(configuration.soils).toEqual(result.soils)
  })
})

describe('untyped scenario JSON boundaries', () => {
  const climate = years(2001, 2001)
  const valid: ScenarioInput = {
    id: 'valid',
    label: 'Imported sensitivity',
    monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, tminDelta: 1, tmaxDelta: 1, precipMultiplier: 1 })),
  }

  it('rejects missing, numeric and null scenario IDs instead of coercing them into export identities', () => {
    for (const id of [undefined, null, 42, true, {}, []]) {
      const imported = { ...valid, id } as unknown as ScenarioInput
      expect(() => runSimulation({ climate, latitude: 55, scenarios: [imported] })).toThrow(/Scenario IDs/)
    }
    const missing = { label: valid.label, monthly: valid.monthly } as unknown as ScenarioInput
    expect(() => runSimulation({ climate, latitude: 55, scenarios: [missing] })).toThrow(/Scenario IDs/)
    const duplicate = { ...valid }
    expect(() => runSimulation({ climate, latitude: 55, scenarios: [valid, duplicate] })).toThrow(/unique/)
    // String "42" remains a permitted stable ID; its numeric lookalike is rejected above.
    const result = runSimulation({ climate, latitude: 55, scenarios: [{ ...valid, id: '42' }] })
    expect(result.scenarios[0].id).toBe('42')
  })

  it('rejects malformed scenario arrays and entries with useful errors before calculation begins', () => {
    for (const scenarios of [null, {}, 'valid']) {
      const input = { climate, latitude: 55, scenarios } as unknown as SimulationInput
      expect(() => runSimulation(input)).toThrow(/Scenarios must be an array/)
    }
    for (const entry of [null, undefined, 42, 'valid', []]) {
      const input = { climate, latitude: 55, scenarios: [entry] } as unknown as SimulationInput
      expect(() => runSimulation(input)).toThrow(/Each scenario must be an object/)
    }
  })

  it('rejects absent or malformed monthly objects without a TypeError or partially calculated result', () => {
    const invalidMonthly: unknown[] = [
      undefined,
      null,
      {},
      'not an array',
      Array(12).fill(null),
      Array(12).fill(2),
      [...valid.monthly.slice(0, 11), []],
    ]
    for (const monthly of invalidMonthly) {
      const imported = { ...valid, monthly } as unknown as ScenarioInput
      const progress: number[] = []
      expect(() =>
        runSimulation({ climate, latitude: 55, scenarios: [imported] }, (fraction) => progress.push(fraction)),
      ).toThrow(/month/i)
      expect(progress).toEqual([])
    }
    const stringNumber = {
      ...valid,
      monthly: valid.monthly.map((month, i) => (i === 0 ? { ...month, tminDelta: '2' } : month)),
    } as unknown as ScenarioInput
    expect(() => runSimulation({ climate, latitude: 55, scenarios: [stringNumber] })).toThrow(
      /anomalies must be finite/,
    )
  })
})
