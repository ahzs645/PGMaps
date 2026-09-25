import { describe, expect, it } from 'vitest'

import {
  clearingWidthForRoadClass,
  collectWaterFromMap,
  corridorRoadClass,
  waterFromFeatures,
  type BasemapQueryMap,
} from './basemapContext'
import type { RoadCandidate } from './roadSnap'

const square = (lng: number, lat: number, size = 0.01): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, lat],
      [lng + size, lat],
      [lng + size, lat + size],
      [lng, lat + size],
      [lng, lat],
    ],
  ],
})
const feature = (geometry: GeoJSON.Geometry): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry })

describe('water from the basemap', () => {
  it('keeps polygons once and drops lines and points', () => {
    const lake = square(-122.7, 54.6)
    const water = waterFromFeatures([
      feature(lake),
      feature(lake), // the same piece from a neighbouring tile
      feature({
        type: 'LineString',
        coordinates: [
          [-122.7, 54.6],
          [-122.6, 54.6],
        ],
      }),
      null,
    ])
    expect(water).toEqual([lake])
  })

  it('ignores water outside the area the drive can see', () => {
    const near = square(-122.7, 54.6)
    const far = square(-120, 50)
    expect(waterFromFeatures([feature(near), feature(far)], [-122.8, 54.5, -122.6, 54.7])).toEqual([near])
  })

  it('reads every source whose style draws a water layer', () => {
    const lake = square(-122.7, 54.6)
    const queried: string[] = []
    const map: BasemapQueryMap = {
      getStyle: () => ({
        layers: [
          { id: 'water', source: 'carto', 'source-layer': 'water' },
          { id: 'water_shadow', source: 'carto', 'source-layer': 'water' },
          { id: 'roads', source: 'carto', 'source-layer': 'transportation' },
        ],
      }),
      querySourceFeatures: (source, { sourceLayer }) => {
        queried.push(`${source}/${sourceLayer}`)
        return [feature(lake)]
      },
    }
    expect(collectWaterFromMap(map)).toEqual([lake])
    expect(queried).toEqual(['carto/water'])
  })
})

describe('the class of the road a corridor follows', () => {
  const highway: RoadCandidate = {
    id: 'h',
    name: 'Hart Highway',
    roadClass: 'trunk',
    coordinates: [
      [-122.74, 54.64],
      [-122.7, 54.62],
    ],
  }
  const track: RoadCandidate = {
    id: 't',
    name: 'Track',
    roadClass: 'track',
    coordinates: [
      [-122.74, 54.65],
      [-122.7, 54.63],
    ],
  }

  it('picks the road the corridor runs along', () => {
    const corridor: Array<[number, number]> = [
      [-122.735, 54.6375],
      [-122.705, 54.6225],
    ]
    expect(corridorRoadClass([track, highway], corridor)).toBe('trunk')
  })

  it('says nothing when no drawn road runs along it', () => {
    expect(
      corridorRoadClass(
        [track],
        [
          [-122.735, 54.6],
          [-122.705, 54.59],
        ],
      ),
    ).toBeNull()
  })

  it('widens the cleared strip for bigger roads', () => {
    expect(clearingWidthForRoadClass('trunk')).toBe(40)
    expect(clearingWidthForRoadClass('track')).toBe(12)
    expect(clearingWidthForRoadClass(null)).toBe(20)
    expect(clearingWidthForRoadClass('cycleway')).toBe(20)
  })
})
