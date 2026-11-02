import { describe, expect, it } from 'vitest'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import type { MultiPolygon } from 'geojson'
import { castorProjectFromTables, type CastorInputTables } from './inputTables'
import { castorConfig, requireCastorProject } from './inputs'
import { runCastor } from './engine'
import { matchesPredicate } from './constraints'
import { parseLegacyPredicate } from './legacyPredicates'
import { castorLandingsGeoJson, castorMetricValues } from './outputs'
import { DEFAULT_CASTOR_CONFIG, type CastorPixel, type CastorProject } from './types'

const pixel = (id: number, values: Partial<CastorPixel> = {}): CastorPixel => ({
  id,
  blockId: String(id),
  compartment: 'A',
  areaHa: 1,
  thlbHa: 1,
  owned: true,
  age: 80,
  volume: 200,
  height: 20,
  eca: 0.1,
  distance: 500,
  salvageVolume: 0,
  zones: {},
  ...values,
})
const project = (pixels: CastorPixel[], values: Partial<CastorProject> = {}): CastorProject => ({
  schema: 'pgmaps-castor-project-v1',
  name: 'Adapter regression',
  description: 'Synthetic adapter/engine integration case.',
  provenance: { source: 'Regression fixture', notes: [], synthetic: true },
  pixels,
  yieldCurves: [],
  constraints: [],
  adjacency: [],
  landings: [],
  harvestFlows: [{ id: 'f1', compartment: 'A', period: 1, targetM3: 200, type: 'live' }],
  ...values,
})
function tables(): CastorInputTables {
  return {
    inventory: [{ ...pixel(1), curveId: '1', managedCurveId: '2' }],
    yields: [
      { curveId: '1', age: 0, volume: 200, height: 20, eca: 0.1 },
      { curveId: '1', age: 200, volume: 200, height: 20, eca: 0.1 },
      { curveId: '2', age: 0, volume: 100, height: 20, eca: 0.1 },
      { curveId: '2', age: 200, volume: 100, height: 20, eca: 0.1 },
    ],
    harvestFlow: [{ id: 'f1', compartment: 'A', period: 1, targetM3: 200, type: 'live' }],
  }
}

describe('Castor adapter and engine consistency', () => {
  it('normalizes known legacy identifier and alias case while preserving custom field case', () => {
    const predicate = parseLegacyPredicate('P.YIELDID > 0 AND P.BLOCKID BETWEEN 1 AND 10 AND P.CustomRank >= 5')!
    expect(predicate).toEqual({
      all: [
        { field: 'yieldid', op: 'gt', value: 0 },
        {
          all: [
            { field: 'blockid', op: 'ge', value: 1 },
            { field: 'blockid', op: 'le', value: 10 },
          ],
        },
        { field: 'CustomRank', op: 'ge', value: 5 },
      ],
    })
    expect(
      matchesPredicate(pixel(1, { curveId: '2', attributes: { yieldid: 2, blockid: 1, CustomRank: 8 } }), predicate),
    ).toBe(true)
    expect(parseLegacyPredicate('P.YIELDID = 2')).toEqual({ field: 'curveId', op: 'eq', value: '2' })
  })
  it('keeps uppercase legacy partial-cut systems active through import and simulation', () => {
    const input = tables()
    input.inventory[0].SILVSYSTEM = 2
    input.silvSystem = [
      { SILVSYSTEM: 2, ENTRY_VAR: 'age', ENTRY_REQ: 50, RESET_AGE: 0, TRANSITION_SILV: 1, START: 0, STOP: 100 },
    ]
    const imported = requireCastorProject(castorProjectFromTables(input, 'Uppercase columns'))
    expect(imported.pixels[0].treatmentId).toBeDefined()
    const result = runCastor(imported, castorConfig(imported, { periods: 1 }))
    expect(result.harvestPixelList[0]).toMatchObject({ type: 'partial', volumeM3: 100 })
    expect(result.finalPixels[0]).toMatchObject({ curveId: '2', volume: 100, attributes: { silvsystem: 1 } })
  })

  it('initializes only missing inventory volumes while retaining supplied observations', () => {
    const input = tables()
    input.inventory = [
      { ...pixel(1, { volume: 75 }), curveId: '1' },
      { ...pixel(2), volume: null, curveId: '1' },
    ]
    input.harvestFlow = []
    const imported = requireCastorProject(castorProjectFromTables(input, 'Mixed observed and derived volume'))
    expect(imported.pixels[0].volume).toBe(75)
    expect(imported.pixels[1].volume).toBe(200)
    const result = runCastor(imported, castorConfig(imported, { periods: 1 }))
    expect(result.summary.initialStockM3).toBe(275)
  })

  it('treats an empty optional managed-curve CSV cell as absent', () => {
    const input = tables()
    input.inventory[0].managedCurveId = ''
    const imported = requireCastorProject(castorProjectFromTables(input, 'Blank optional curve'))
    expect(imported.pixels[0].managedCurveId).toBeUndefined()
  })

  it('maps cumulative harvested volume across repeated entries, while the snapshot retains latest-event volume', () => {
    const input = project([pixel(1, { curveId: 'repeat', managedCurveId: 'repeat', volume: 100 })], {
      yieldCurves: [
        {
          id: 'repeat',
          points: [
            { age: 0, volume: 0, height: 0, eca: 1 },
            { age: 1, volume: 100, height: 20, eca: 0.1 },
            { age: 200, volume: 100, height: 20, eca: 0.1 },
          ],
        },
      ],
      harvestFlows: [1, 2].map((period) => ({
        id: `f${period}`,
        compartment: 'A',
        period,
        targetM3: 100,
        type: 'live',
      })),
    })
    const result = runCastor(input, { ...DEFAULT_CASTOR_CONFIG, periods: 2, stepYears: 1 })
    expect(result.harvestPixelList).toHaveLength(2)
    expect(result.snapshots[2].harvestedVolumeM3).toEqual([100])
    expect(castorMetricValues(result, 1, 'harvestVolume')).toEqual([100])
    expect(castorMetricValues(result, 2, 'harvestVolume')).toEqual([200])
  })

  it('exports a representative landing for disconnected MultiPolygon inventory units', () => {
    const geometry: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-123, 53],
            [-122.99, 53],
            [-122.99, 53.01],
            [-123, 53.01],
            [-123, 53],
          ],
        ],
        [
          [
            [-122.9, 53],
            [-122.89, 53],
            [-122.89, 53.01],
            [-122.9, 53.01],
            [-122.9, 53],
          ],
        ],
      ],
    }
    const input = project([pixel(1, { geometry })])
    const result = runCastor(input, { ...DEFAULT_CASTOR_CONFIG, periods: 1 })
    expect(result.landings).toHaveLength(1)
    const output = castorLandingsGeoJson(input, result)
    expect(output.features).toHaveLength(1)
    expect(booleanPointInPolygon(output.features[0], geometry)).toBe(true)
  })
})
