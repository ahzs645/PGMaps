import { describe, expect, it } from 'vitest'

import {
  MAX_VEGETATION_FEATURES,
  clampVegetationBounds,
  forestedGeometries,
  nonVegetatedNear,
  parseVegetationStands,
  vegetationQueryUrl,
} from './bcVegetationInventory'
import { polygonBounds } from './visibility'

const TABOR: [number, number, number, number] = [-122.65, 53.86, -122.45, 53.95]

function standFeature(properties: Record<string, unknown>, geometryType: string = 'Polygon') {
  return {
    type: 'Feature',
    geometry: {
      type: geometryType,
      coordinates: [
        [
          [-122.6, 53.87],
          [-122.55, 53.87],
          [-122.55, 53.9],
          [-122.6, 53.9],
          [-122.6, 53.87],
        ],
      ],
    },
    properties,
  }
}

describe('vegetationQueryUrl', () => {
  it('puts the box in the CQL filter, longitude first', () => {
    const url = new URL(vegetationQueryUrl(TABOR))
    const filter = url.searchParams.get('CQL_FILTER')!

    // WFS 2.0's own bbox parameter is latitude-first for EPSG:4326 while CQL's
    // BBOX is longitude-first; mixing them returns the wrong part of BC.
    expect(url.searchParams.get('bbox')).toBeNull()
    expect(filter).toBe("BBOX(GEOMETRY,-122.65,53.86,-122.45,53.95,'EPSG:4326')")
  })

  it('asks for the two dozen fields it uses, not all 189', () => {
    const fields = new URL(vegetationQueryUrl(TABOR)).searchParams.get('propertyName')!.split(',')

    expect(fields).toContain('BCLCS_LEVEL_2')
    expect(fields).toContain('SPECIES_CD_1')
    expect(fields).toContain('PROJ_HEIGHT_1')
    expect(fields).toContain('GEOMETRY')
    // The whole composition for the drawn mix, and the land cover classes
    // that say what non-treed ground is.
    expect(fields).toContain('SPECIES_CD_6')
    expect(fields).toContain('SPECIES_PCT_6')
    expect(fields).toContain('BCLCS_LEVEL_5')
    expect(fields.length).toBeLessThan(30)
  })

  it('reads every recorded species with its share, and the land cover', () => {
    const { stands } = parseVegetationStands({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
          properties: {
            BCLCS_LEVEL_2: 'T',
            BCLCS_LEVEL_4: 'TM',
            SPECIES_CD_1: 'AC',
            SPECIES_PCT_1: 30,
            SPECIES_CD_2: 'SX',
            SPECIES_PCT_2: 25,
            SPECIES_CD_3: 'EP',
            SPECIES_PCT_3: 25,
            SPECIES_CD_4: 'BL',
            SPECIES_PCT_4: 20,
            SPECIES_CD_5: null,
            PROJ_HEIGHT_1: 35.1,
            PROJ_HEIGHT_2: 33.5,
          },
        },
      ],
    })
    expect(stands[0].speciesComposition).toEqual([
      { code: 'AC', percent: 30, heightMeters: 35.1 },
      { code: 'SX', percent: 25, heightMeters: 33.5 },
      { code: 'EP', percent: 25, heightMeters: null },
      { code: 'BL', percent: 20, heightMeters: null },
    ])
    expect(stands[0].landCover).toEqual({ level2: 'T', level3: null, level4: 'TM', level5: null })
  })

  it('narrows to treed ground when only the canopy is wanted', () => {
    const filter = new URL(vegetationQueryUrl(TABOR, { treedOnly: true })).searchParams.get('CQL_FILTER')!
    expect(filter).toContain("BCLCS_LEVEL_2='T'")
    expect(filter).toContain('BBOX(GEOMETRY')
  })

  it('caps the answer and says which layer and format it wants', () => {
    const url = new URL(vegetationQueryUrl(TABOR, { maxFeatures: 250 }))
    expect(url.searchParams.get('count')).toBe('250')
    expect(url.searchParams.get('outputFormat')).toBe('application/json')
    expect(url.searchParams.get('srsName')).toBe('EPSG:4326')
    expect(url.searchParams.get('typeName')).toContain('VEG_COMP_LYR_R1_POLY')
  })
})

describe('clampVegetationBounds', () => {
  it('leaves a sensible view alone', () => {
    expect(clampVegetationBounds(TABOR)).toEqual(TABOR)
  })

  it('shrinks a province-wide box around its centre', () => {
    const [minLng, minLat, maxLng, maxLat] = clampVegetationBounds([-139, 48, -114, 60], 0.35)

    expect(maxLng - minLng).toBeCloseTo(0.35, 6)
    expect(maxLat - minLat).toBeCloseTo(0.35, 6)
    expect((minLng + maxLng) / 2).toBeCloseTo(-126.5, 6)
    expect((minLat + maxLat) / 2).toBeCloseTo(54, 6)
  })
})

describe('parseVegetationStands', () => {
  it('reads the fields the page turns on', () => {
    const { stands } = parseVegetationStands({
      type: 'FeatureCollection',
      features: [
        standFeature({
          FEATURE_ID: 17419958,
          BCLCS_LEVEL_2: 'T',
          SPECIES_CD_1: 'SX',
          PROJ_HEIGHT_1: 20.7,
          CROWN_CLOSURE: 35,
          PROJ_AGE_1: 60,
        }),
      ],
    })

    expect(stands).toHaveLength(1)
    expect(stands[0]).toMatchObject({
      featureId: 17419958,
      treed: true,
      speciesCode: 'SX',
      heightMeters: 20.7,
      crownClosurePercent: 35,
      ageYears: 60,
    })
  })

  it('calls water and rock what they are', () => {
    const { stands } = parseVegetationStands({
      type: 'FeatureCollection',
      features: [
        standFeature({ BCLCS_LEVEL_2: 'W', BCLCS_LEVEL_1: 'N' }),
        standFeature({ BCLCS_LEVEL_2: 'N', BCLCS_LEVEL_1: 'N' }),
        standFeature({ BCLCS_LEVEL_2: 't' }),
      ],
    })

    expect(stands.map((stand) => stand.treed)).toEqual([false, false, true])
    // Only non-vegetated *land* is rock for a figure; water is not.
    expect(stands.map((stand) => stand.nonVegetatedLand)).toEqual([false, false, false])
    const rock = parseVegetationStands({
      type: 'FeatureCollection',
      features: [standFeature({ BCLCS_LEVEL_1: 'N', BCLCS_LEVEL_2: 'L' })],
    }).stands
    expect(rock[0].nonVegetatedLand).toBe(true)
    const [w, s, e, n] = polygonBounds(rock[0].geometry)
    expect(nonVegetatedNear(rock, [w, s, e, n])).toHaveLength(1)
    expect(nonVegetatedNear(rock, [e + 1, n + 1, e + 2, n + 2])).toEqual([])
  })

  it('leaves missing attributes null rather than guessing', () => {
    const { stands } = parseVegetationStands({
      type: 'FeatureCollection',
      features: [standFeature({ BCLCS_LEVEL_2: 'T', SPECIES_CD_1: '   ', PROJ_HEIGHT_1: null })],
    })

    expect(stands[0].speciesCode).toBeNull()
    expect(stands[0].heightMeters).toBeNull()
    expect(stands[0].crownClosurePercent).toBeNull()
  })

  it('says when the answer was cut short', () => {
    const features = Array.from({ length: 3 }, () => standFeature({ BCLCS_LEVEL_2: 'T' }))

    expect(parseVegetationStands({ type: 'FeatureCollection', features, numberMatched: 3 }, 3).truncated).toBe(true)
    expect(parseVegetationStands({ type: 'FeatureCollection', features, numberMatched: 900 }, 4000).truncated).toBe(
      true,
    )
    expect(parseVegetationStands({ type: 'FeatureCollection', features, numberMatched: 3 }, 4000).truncated).toBe(false)
  })

  it('ignores anything that is not a polygon, and an answer that is not one', () => {
    expect(parseVegetationStands({ features: [standFeature({}, 'LineString')] }).stands).toHaveLength(0)
    expect(parseVegetationStands(null).stands).toHaveLength(0)
    expect(parseVegetationStands({ exceptions: [{ text: 'boom' }] }).stands).toHaveLength(0)
  })

  it('defaults its cap to the module constant', () => {
    const features = Array.from({ length: 2 }, () => standFeature({ BCLCS_LEVEL_2: 'T' }))
    expect(MAX_VEGETATION_FEATURES).toBeGreaterThan(features.length)
    expect(parseVegetationStands({ features }).truncated).toBe(false)
  })
})

describe('forestedGeometries', () => {
  it('keeps only the treed ground', () => {
    const { stands } = parseVegetationStands({
      features: [
        standFeature({ BCLCS_LEVEL_2: 'T' }),
        standFeature({ BCLCS_LEVEL_2: 'W' }),
        standFeature({ BCLCS_LEVEL_2: 'T' }),
      ],
    })

    expect(forestedGeometries(stands)).toHaveLength(2)
    expect(forestedGeometries([])).toEqual([])
  })
})
