import { describe, expect, it } from 'vitest'

import type { Bounds } from './bcLayers'
import { MAX_RAILWAY_FEATURES, RAILWAY_LAYER, describeRailway, parseRailways, railwayQueryUrl } from './railways'

// The Tachie River, between Trembleur and Stuart lakes: TROPIK's test case.
const TACHIE: Bounds = [-125.3, 54.5, -124.4, 55.0]

/** A row as DataBC returned it for the Takla subdivision in November 2026. */
function taklaRow(overrides: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-124.61, 54.71],
        [-124.63, 54.73],
      ],
    },
    properties: {
      RAILWAY_TRACK_ID: 4821,
      TRACK_NAME: null,
      TRACK_CLASSIFICATION: 'Main',
      USE_TYPE: 'Freight',
      STATUS: 'Operational',
      OPERATOR_ENGLISH_NAME: 'Canadian National',
      SUBDIVISION1_NAME: 'Takla',
      GEOMETRY_REVISION_DATE: '2017-06-01Z',
      ...overrides,
    },
  }
}

describe('railwayQueryUrl', () => {
  it('puts the box in CQL_FILTER, longitude first, and never in bbox', () => {
    const url = new URL(railwayQueryUrl(TACHIE))
    expect(url.searchParams.get('typeNames')).toBe(RAILWAY_LAYER)
    expect(url.searchParams.get('CQL_FILTER')).toBe("BBOX(SHAPE,-125.30000,54.50000,-124.40000,55.00000,'EPSG:4326')")
    expect(url.searchParams.has('bbox')).toBe(false)
    expect(url.searchParams.get('count')).toBe(String(MAX_RAILWAY_FEATURES))
  })

  it('asks only for the columns the planner reads', () => {
    const columns = new URL(railwayQueryUrl(TACHIE)).searchParams.get('propertyName')?.split(',') ?? []
    expect(columns).toContain('SHAPE')
    expect(columns).toContain('STATUS')
    expect(columns.length).toBeLessThan(12)
  })
})

describe('parseRailways', () => {
  it('reads a row and keeps the recorded status with its year', () => {
    const { collection, truncated } = parseRailways({ features: [taklaRow()], numberMatched: 1 })
    expect(truncated).toBe(false)
    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].properties).toEqual({
      id: '4821',
      name: 'Takla',
      classification: 'Main',
      use: 'Freight',
      operator: 'Canadian National',
      recordedStatus: 'Operational',
      recordedYear: 2017,
      through: true,
    })
  })

  it('falls back to the track name and marks yards and spurs as not through track', () => {
    const { collection } = parseRailways({
      features: [
        taklaRow({ SUBDIVISION1_NAME: null, TRACK_NAME: 'Lumber Apollo Corporation', TRACK_CLASSIFICATION: 'Spur' }),
      ],
    })
    expect(collection.features[0].properties.name).toBe('Lumber Apollo Corporation')
    expect(collection.features[0].properties.through).toBe(false)
  })

  it('drops rows without a usable line instead of guessing', () => {
    const { collection } = parseRailways({
      features: [
        taklaRow(),
        { type: 'Feature', geometry: null, properties: {} },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-124.6, 54.7]] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-124.6, 54.7] }, properties: {} },
        null,
      ],
    })
    expect(collection.features).toHaveLength(1)
  })

  it('reports an answer the service cut short', () => {
    expect(parseRailways({ features: [taklaRow()], numberMatched: 10055 }).truncated).toBe(true)
  })

  it('answers an empty or malformed payload with no lines', () => {
    expect(parseRailways(null).collection.features).toEqual([])
    expect(parseRailways({ features: 'nope' }).collection.features).toEqual([])
  })
})

describe('describeRailway', () => {
  it('never presents the recorded status as current condition', () => {
    const { collection } = parseRailways({ features: [taklaRow()] })
    const card = describeRailway(collection.features[0].properties)
    expect(card.title).toBe('Takla rail line')
    expect(card.detail).toBe('Main · Freight · Canadian National')
    expect(card.caution).toBe('Recorded as "Operational" in 2017. Check imagery for its condition today.')
  })

  it('says so when the record gives no status or date', () => {
    const card = describeRailway({})
    expect(card.title).toBe('Rail line')
    expect(card.caution).toBe('Recorded as "Status not recorded", date unknown. Check imagery for its condition today.')
  })
})
