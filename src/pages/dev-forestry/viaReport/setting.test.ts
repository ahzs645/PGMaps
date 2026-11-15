import { describe, expect, it } from 'vitest'

import { collectPlacesFromMap, placesFromFeatures, type BasemapQueryMap } from '../basemapContext'
import { compassWord, groundAspect, placesAround, reportSetting, speciesName, standCharacter } from './setting'

// A square of ground near 50° N, about 1.4 km a side; names are placeholders.
const square = (west: number, south: number, size = 0.02): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [west + size, south],
      [west + size, south + size],
      [west, south + size],
      [west, south],
    ],
  ],
})

/** A grid of samples over a plane falling `drop` metres per metre toward `downhill` (east or north). */
function plane(downhill: 'east' | 'north' | 'flat', drop = 0.4) {
  const positions: number[] = [],
    elevations: number[] = []
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 10; j++) {
      const lng = -123 + i * 0.001,
        lat = 50 + j * 0.001
      positions.push(lng, lat)
      const x = i * 0.001 * 111_320 * Math.cos((50 * Math.PI) / 180),
        y = j * 0.001 * 110_540
      elevations.push(500 - (downhill === 'east' ? x * drop : downhill === 'north' ? y * drop : 0))
    }
  return { positions, elevations }
}

describe('report setting', () => {
  it('names the eight compass directions', () => {
    expect([0, 44, 46, 90, 181, 225, 270, 337.6].map(compassWord)).toEqual([
      'north',
      'northeast',
      'northeast',
      'east',
      'south',
      'southwest',
      'west',
      'north',
    ])
  })

  it('reads the way ground faces from the plane through its samples, and none on flat ground', () => {
    const east = plane('east')
    expect(groundAspect(east.positions, east.elevations)).toBe('east')
    const north = plane('north')
    expect(groundAspect(north.positions, north.elevations)).toBe('north')
    const flat = plane('flat')
    expect(groundAspect(flat.positions, flat.elevations)).toBeNull()
    expect(groundAspect([], [])).toBeNull()
  })

  it('places the blocks from the nearest places of each kind, giving the blocks’ direction from each', () => {
    const places = placesAround(
      [
        { name: 'Town', kind: 'settlement', lngLat: [-123, 49.94] },
        { name: 'Hamlet', kind: 'settlement', lngLat: [-123.01, 50.006] },
        { name: 'Far City', kind: 'settlement', lngLat: [-125, 50] },
        { name: 'Third Village', kind: 'settlement', lngLat: [-123, 49.9] },
        { name: 'Inlet', kind: 'water', lngLat: [-123.04, 50] },
        { name: 'Locality', kind: 'other', lngLat: [-123, 50.001] },
      ],
      [-123, 50],
    )
    expect(places.map((p) => `${p.name} ${p.distanceKm.toFixed(1)} ${p.direction}`)).toEqual([
      'Hamlet 1.0 southeast',
      'Inlet 2.9 east',
      'Town 6.7 north',
    ])
  })

  it('reads the stands over the samples by species share and height, naming the inventory’s codes', () => {
    expect(['FDC', 'Hw', 'CW', 'PLI', 'XX'].map(speciesName)).toEqual([
      'Douglas-fir',
      'western hemlock',
      'western redcedar',
      'lodgepole pine',
      null,
    ])
    const stands = [
      {
        geometry: square(-123, 50, 0.005),
        heightMeters: 30,
        speciesComposition: [
          { code: 'FDC', percent: 70, heightMeters: 30 },
          { code: 'HW', percent: 25, heightMeters: 26 },
          { code: 'CW', percent: 5, heightMeters: null },
        ],
      },
      { geometry: square(-122.995, 50, 0.005), heightMeters: 20, speciesCode: 'HW' },
    ]
    // Three samples in the first stand, one in the second, one in neither.
    const positions = [-122.999, 50.001, -122.998, 50.002, -122.997, 50.003, -122.994, 50.001, -122.9, 50.1]
    expect(standCharacter(stands, positions)).toEqual({
      species: [
        { name: 'Douglas-fir', percent: 52 },
        { name: 'western hemlock', percent: 44 },
      ],
      heightM: 27.5,
      coverPercent: 80,
    })
    expect(standCharacter([], positions)).toBeNull()
  })

  it('assembles the setting from the blocks, the run and the labels, each part empty when its source is', () => {
    const east = plane('east')
    const setting = reportSetting({
      blocks: [square(-123, 50, 0.009)],
      targets: [
        { role: 'block', ...east, meanSlopePercent: 40, areaMeters: 1 },
        {
          role: 'landscape',
          positions: east.positions,
          elevations: east.elevations,
          meanSlopePercent: 30,
          areaMeters: 3,
        },
        { role: 'landscape', positions: [], elevations: [], meanSlopePercent: 50, areaMeters: 1 },
      ],
      places: [{ name: 'Town', kind: 'settlement', lngLat: [-123, 49.9] }],
    })
    expect(setting.ground).toEqual({ aspect: 'east', slopePercent: 40 })
    expect(setting.landformSlopePercent).toBe(35)
    expect(setting.places.map((p) => [p.name, p.direction])).toEqual([['Town', 'north']])
    expect(setting.stand).toBeNull()
    expect(reportSetting({ blocks: [] })).toEqual({ places: [], ground: null, landformSlopePercent: null, stand: null })
  })
})

describe('basemap place labels', () => {
  const point = (name: string, cls: string, at: [number, number], extra = {}): GeoJSON.Feature => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: at },
    properties: { name, class: cls, ...extra },
  })

  it('reads settlements, water and peaks once each, preferring English names and leaving out regions', () => {
    const places = placesFromFeatures(
      [
        point('Townsite', 'town', [-123, 50]),
        point('Townsite', 'town', [-123, 50]),
        point('Province', 'state', [-124, 51]),
        point('Isle', 'island', [-123.1, 50]),
        point('Nom', 'village', [-123.2, 50], { 'name:en': 'English Name' }),
        null,
      ],
      'place',
    )
    expect(places.map((p) => `${p.name}:${p.kind}`)).toEqual([
      'Townsite:settlement',
      'Isle:island',
      'English Name:settlement',
    ])
    const water = placesFromFeatures(
      [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-123, 50],
              [-123.01, 50.01],
              [-123.02, 50.02],
            ],
          },
          properties: { name: 'Long Inlet', class: 'bay' },
        },
      ],
      'water_name',
    )
    expect(water).toEqual([{ name: 'Long Inlet', kind: 'water', lngLat: [-123.01, 50.01] }])
  })

  it('collects from every vector source that carries the place or water layers', () => {
    const map: BasemapQueryMap = {
      getStyle: () => ({
        layers: [
          { id: 'water', source: 'base', 'source-layer': 'water' },
          { id: 'roads', source: 'other', 'source-layer': 'transportation' },
        ],
      }),
      querySourceFeatures: (source, { sourceLayer }) =>
        source === 'base' && sourceLayer === 'mountain_peak' ? [point('Summit', 'peak', [-123, 50.1])] : [],
    }
    expect(collectPlacesFromMap(map)).toEqual([{ name: 'Summit', kind: 'peak', lngLat: [-123, 50.1] }])
  })
})
