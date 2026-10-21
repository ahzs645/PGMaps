import { describe, expect, it } from 'vitest'
import {
  inventoryDensity,
  parseVriVolumeProperties,
  pgAuditRatio,
  pgShelfLife,
  VRI_BASELINE_RULES,
  VRI_PG_SCENARIO,
} from './vriVolume'
const stand = (extra: Record<string, unknown> = {}) =>
  parseVriVolumeProperties({
    FEATURE_ID: 1,
    BCLCS_LEVEL_2: 'T',
    SPECIES_CD_1: 'SX',
    PROJ_AGE_1: 90,
    LIVE_STAND_VOLUME_125: 210,
    LIVE_STAND_VOLUME_175: 200,
    DEAD_STAND_VOLUME_175: 20,
    DEAD_STAND_VOLUME_125: 25,
    EARLIEST_NONLOGGING_DIST_DATE: '2015-01-01Z',
    ...extra,
  })
describe('shared forestry VRI volume conventions', () => {
  it('preserves unavailable numbers, recorded zero and negative sentinels distinctly', () => {
    const p = stand({
      LIVE_STAND_VOLUME_125: null,
      LIVE_STAND_VOLUME_175: 0,
      LIVE_STAND_VOLUME_225: -999,
      PROJ_AGE_1: null,
    })
    expect(p.live).toEqual({ 125: null, 175: 0, 225: null })
    expect(inventoryDensity(p, VRI_BASELINE_RULES)).toMatchObject({ density: 0, complete: true })
    expect(inventoryDensity(p, { ...VRI_BASELINE_RULES, minAge: 60 }).status).toContain('age unavailable')
    expect(inventoryDensity(p, { ...VRI_BASELINE_RULES, utilization: 225 }).density).toBeNull()
  })
  it('matches AVAST utilization, age, shelf-life and audit rule examples from main', () => {
    expect(inventoryDensity(stand(), VRI_BASELINE_RULES).density).toBe(200)
    expect(inventoryDensity(stand({ SPECIES_CD_1: 'PLI' }), { ...VRI_PG_SCENARIO, dead: 'none' }).density).toBe(210)
    expect(inventoryDensity(stand(), { ...VRI_PG_SCENARIO, dead: 'full' }).density).toBe(220)
    expect(inventoryDensity(stand(), VRI_PG_SCENARIO).density).toBeCloseTo(200 + 20 * (0.8 - (0.4 * 9) / 13), 9)
    expect([pgShelfLife(1), pgShelfLife(2), pgShelfLife(15), pgShelfLife(40)]).toEqual([1, 0.8, 0.4, 0.4])
    expect(['PLI', 'SX', 'BL', 'AT'].map(pgAuditRatio)).toEqual([0.836, 0.946, 1.246, 1.159])
    expect(inventoryDensity(stand({ PROJ_AGE_1: 45 }), VRI_PG_SCENARIO).density).toBeNull()
    expect(inventoryDensity(stand({ BCLCS_LEVEL_2: 'N' }), VRI_BASELINE_RULES).density).toBeNull()
  })
  it('reports partial known live sums when dead volume is unreported and exposes death assumptions', () => {
    expect(
      inventoryDensity(stand({ DEAD_STAND_VOLUME_175: null }), { ...VRI_BASELINE_RULES, dead: 'full' }),
    ).toMatchObject({ density: 200, includedDead: null, complete: false })
    expect(inventoryDensity(stand({ EARLIEST_NONLOGGING_DIST_DATE: null }), VRI_PG_SCENARIO)).toMatchObject({
      assumedDeathYears: true,
    })
    expect(inventoryDensity(stand({ EARLIEST_NONLOGGING_DIST_DATE: '2100-01-01Z' }), VRI_PG_SCENARIO)).toMatchObject({
      assumedDeathYears: true,
    })
    expect(
      inventoryDensity(stand({ DEAD_STAND_VOLUME_175: 0 }), { ...VRI_BASELINE_RULES, dead: 'full' }),
    ).toMatchObject({ complete: true, includedDead: 0 })
    expect(() => pgShelfLife(-1)).toThrow()
  })
})
