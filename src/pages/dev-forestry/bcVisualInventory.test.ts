import { describe, expect, it } from 'vitest'

import {
  BC_VISUAL_LAYERS,
  buildInventoryQueryUrl,
  clampQueryBounds,
  parseSensitivityUnits,
  summariseUnits,
  unitsToGeoJson,
  vacRatingForCode,
  visualQualityClassForCode,
  type BcSensitivityUnit,
} from './bcVisualInventory'

const SQUARE: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.6, 53.7],
      [-122.5, 53.7],
      [-122.5, 53.8],
      [-122.6, 53.8],
      [-122.6, 53.7],
    ],
  ],
}

function feature(properties: Record<string, unknown>): GeoJSON.Feature {
  return { type: 'Feature', geometry: SQUARE, properties }
}

describe('code mapping', () => {
  it('maps every established objective code the service publishes', () => {
    // Distinct values in REC_EVQO_CODE province-wide.
    expect(visualQualityClassForCode('P')).toBe('preservation')
    expect(visualQualityClassForCode('R')).toBe('retention')
    expect(visualQualityClassForCode('PR')).toBe('partial-retention')
    expect(visualQualityClassForCode('M')).toBe('modification')
    expect(visualQualityClassForCode('MM')).toBe('maximum-modification')
  })

  it('maps every VAC code the service publishes', () => {
    expect(vacRatingForCode('L')).toBe('low')
    expect(vacRatingForCode('M')).toBe('medium')
    expect(vacRatingForCode('H')).toBe('high')
  })

  it('keeps the two meanings of "M" apart', () => {
    // M is modification as an objective but medium as an absorption rating;
    // reading one through the other's table would silently mislabel a landform.
    expect(visualQualityClassForCode('M')).toBe('modification')
    expect(vacRatingForCode('M')).toBe('medium')
  })

  it('tolerates padding and case, and refuses anything else', () => {
    expect(visualQualityClassForCode(' pr ')).toBe('partial-retention')
    expect(vacRatingForCode('h')).toBe('high')
    expect(visualQualityClassForCode('')).toBeNull()
    expect(visualQualityClassForCode(null)).toBeNull()
    expect(visualQualityClassForCode(7)).toBeNull()
    expect(vacRatingForCode('X')).toBeNull()
  })
})

describe('buildInventoryQueryUrl', () => {
  const bounds: [number, number, number, number] = [-122.9, 53.7, -122.2, 54.05]

  it('asks the sensitivity unit layer for GeoJSON over a bbox', () => {
    const url = new URL(buildInventoryQueryUrl(BC_VISUAL_LAYERS.sensitivityUnits, bounds))
    expect(url.pathname).toContain('/MapServer/6/query')
    expect(url.searchParams.get('geometry')).toBe('-122.9,53.7,-122.2,54.05')
    expect(url.searchParams.get('geometryType')).toBe('esriGeometryEnvelope')
    expect(url.searchParams.get('inSR')).toBe('4326')
    expect(url.searchParams.get('outSR')).toBe('4326')
    expect(url.searchParams.get('f')).toBe('geojson')
  })

  it('requests the fields the page reads', () => {
    const fields = new URL(buildInventoryQueryUrl(6, bounds)).searchParams.get('outFields') ?? ''
    for (const field of [
      'VLI_POLYGON_NO',
      'REC_EVQO_CODE',
      'REC_VAC_FINAL_VALUE_CODE',
      'REC_VSC_FINAL_VALUE_CODE',
      'SCENIC_AREA_IND',
    ]) {
      expect(fields).toContain(field)
    }
  })

  it('generalises geometry by default and can be asked not to', () => {
    // Full-resolution units are ~110 KB each; generalising is what makes a
    // live query viable at all.
    expect(new URL(buildInventoryQueryUrl(6, bounds)).searchParams.get('maxAllowableOffset')).toBeTruthy()
    expect(
      new URL(buildInventoryQueryUrl(6, bounds, { simplifyDegrees: 0 })).searchParams.get('maxAllowableOffset'),
    ).toBeNull()
  })
})

describe('clampQueryBounds', () => {
  it('leaves a local view alone', () => {
    const local: [number, number, number, number] = [-122.9, 53.7, -122.2, 54.05]
    expect(clampQueryBounds(local)).toEqual(local)
  })

  it('shrinks a province-wide view around its centre', () => {
    const [minLng, minLat, maxLng, maxLat] = clampQueryBounds([-139, 48, -114, 60])
    expect(maxLng - minLng).toBeCloseTo(1.5, 10)
    expect(maxLat - minLat).toBeCloseTo(1.5, 10)
    // Still centred where the viewer was looking.
    expect((minLng + maxLng) / 2).toBeCloseTo(-126.5, 10)
    expect((minLat + maxLat) / 2).toBeCloseTo(54, 10)
  })
})

describe('parseSensitivityUnits', () => {
  it('reads the fields that decide what a block is held to', () => {
    const [unit] = parseSensitivityUnits({
      type: 'FeatureCollection',
      features: [
        feature({
          VLI_POLYGON_NO: 1668,
          REC_EVQO_CODE: 'PR',
          REC_VAC_FINAL_VALUE_CODE: 'M',
          REC_VSC_FINAL_VALUE_CODE: '2',
          SCENIC_AREA_IND: 'Y',
          RATIONALE: 'Highway 16 corridor',
        }),
      ],
    })

    expect(unit.polygonNumber).toBe('1668')
    expect(unit.name).toBe('VLI 1668')
    expect(unit.objectiveId).toBe('partial-retention')
    expect(unit.vac).toBe('medium')
    expect(unit.vsc).toBe('2')
    expect(unit.scenicArea).toBe(true)
    expect(unit.rationale).toBe('Highway 16 corridor')
  })

  it('leaves an unrated unit unrated rather than inventing a class', () => {
    // Most of the inventory near Prince George looks like this.
    const [unit] = parseSensitivityUnits({
      type: 'FeatureCollection',
      features: [feature({ VLI_POLYGON_NO: 1672, REC_VSC_FINAL_VALUE_CODE: 'W' })],
    })
    expect(unit.objectiveId).toBeNull()
    expect(unit.vac).toBeNull()
    expect(unit.scenicArea).toBe(false)
    expect(unit.rationale).toBeNull()
  })

  it('carries the recommended class separately from the established one', () => {
    const [unit] = parseSensitivityUnits({
      type: 'FeatureCollection',
      features: [feature({ VLI_POLYGON_NO: 9, REC_RVQC_CODE: 'R' })],
    })
    expect(unit.objectiveId).toBeNull()
    expect(unit.recommendedId).toBe('retention')
  })

  it('drops features with no polygon or no identifier', () => {
    expect(
      parseSensitivityUnits({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { VLI_POLYGON_NO: 1 } },
          feature({}),
        ],
      }),
    ).toHaveLength(0)
  })

  it('returns nothing for a non-collection', () => {
    expect(parseSensitivityUnits(null)).toHaveLength(0)
    expect(parseSensitivityUnits({ error: { message: 'bad' } })).toHaveLength(0)
  })
})

describe('summariseUnits and unitsToGeoJson', () => {
  const units: BcSensitivityUnit[] = parseSensitivityUnits({
    type: 'FeatureCollection',
    features: [
      feature({ VLI_POLYGON_NO: 1, REC_EVQO_CODE: 'PR', REC_VAC_FINAL_VALUE_CODE: 'M', SCENIC_AREA_IND: 'Y' }),
      feature({ VLI_POLYGON_NO: 2, REC_EVQO_CODE: 'M', SCENIC_AREA_IND: 'Y' }),
      feature({ VLI_POLYGON_NO: 3 }),
    ],
  })

  it('counts how much of the inventory is actually rated', () => {
    expect(summariseUnits(units)).toEqual({ total: 3, withObjective: 2, withVac: 1, scenicAreas: 2 })
  })

  it('flags rated units so the map can draw the unrated ones back', () => {
    const collection = unitsToGeoJson(units)
    expect(collection.features).toHaveLength(3)
    expect(collection.features.map((entry) => entry.properties?.rated)).toEqual([1, 1, 0])
    expect(collection.features[0].properties?.vac).toBe('medium')
    expect(collection.features[2].properties?.objectiveId).toBe('')
  })
})
