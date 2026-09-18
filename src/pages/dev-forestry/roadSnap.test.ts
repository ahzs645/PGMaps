import { describe, expect, it } from 'vitest'

import {
  chainSegments,
  collectRoadsFromMap,
  nearestPointOnLine,
  roadLayerIds,
  roadsFromFeatures,
  sliceLine,
  snapCorridorToRoad,
  type RoadCandidate,
  type RoadQueryMap,
} from './roadSnap'
import { lineLengthMeters } from './visibility'

/** A straight east–west road along the equator, 0.04° long (~4.4 km). */
const STRAIGHT: Array<[number, number]> = [
  [0, 0],
  [0.02, 0],
  [0.04, 0],
]

function lineFeature(coordinates: Array<[number, number]>, properties: Record<string, unknown> = {}): GeoJSON.Feature {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties }
}

describe('roadsFromFeatures', () => {
  it('merges the segments a vector tile splits one road into', () => {
    const roads = roadsFromFeatures([
      lineFeature(
        [
          [0, 0],
          [0.01, 0],
        ],
        { name: 'Highway 16', class: 'trunk' },
      ),
      lineFeature(
        [
          [0.01, 0],
          [0.02, 0],
        ],
        { name: 'Highway 16', class: 'trunk' },
      ),
    ])

    expect(roads).toHaveLength(1)
    expect(roads[0].name).toBe('Highway 16')
    expect(roads[0].coordinates).toHaveLength(3)
  })

  it('keeps unconnected unnamed roads apart instead of lumping them together', () => {
    const roads = roadsFromFeatures([
      lineFeature(
        [
          [0, 0],
          [0.01, 0],
        ],
        { class: 'track' },
      ),
      lineFeature(
        [
          [0.5, 0.5],
          [0.51, 0.5],
        ],
        { class: 'track' },
      ),
    ])
    expect(roads).toHaveLength(2)
    expect(roads.every((road) => road.name === 'Unnamed resource road')).toBe(true)
  })

  it('chains the fragments a tile splits one unnamed road into', () => {
    const roads = roadsFromFeatures([
      lineFeature(
        [
          [0, 0],
          [0.01, 0],
        ],
        { class: 'track' },
      ),
      lineFeature(
        [
          [0.01, 0],
          [0.02, 0],
        ],
        { class: 'track' },
      ),
      // Given out of order, and connecting through the second piece's far end.
      lineFeature(
        [
          [0.03, 0],
          [0.02, 0],
        ],
        { class: 'track' },
      ),
    ])
    expect(roads).toHaveLength(1)
    expect(roads[0].coordinates).toHaveLength(4)
  })

  it('reads a highway number as a name', () => {
    const roads = roadsFromFeatures([
      lineFeature(
        [
          [0, 0],
          [0.01, 0],
        ],
        { class: 'trunk', ref: 'BC 16' },
      ),
    ])
    expect(roads[0].name).toBe('BC 16')
  })

  it('drops classes nobody drives a visual assessment along', () => {
    const roads = roadsFromFeatures([
      lineFeature(
        [
          [0, 0],
          [0.01, 0],
        ],
        { class: 'path', name: 'Trail' },
      ),
      lineFeature(
        [
          [0, 0.01],
          [0.01, 0.01],
        ],
        { class: 'ferry' },
      ),
      lineFeature(
        [
          [0, 0.02],
          [0.01, 0.02],
        ],
        { class: 'track', name: 'FSR 200' },
      ),
    ])
    expect(roads.map((road) => road.name)).toEqual(['FSR 200'])
  })

  it('ignores features with no usable line', () => {
    expect(
      roadsFromFeatures([
        null,
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { class: 'minor' } },
        lineFeature([[0, 0]], { class: 'minor' }),
      ]),
    ).toHaveLength(0)
  })

  it('drops the casing copy a style draws under every road', () => {
    const shape: Array<[number, number]> = [
      [0, 0],
      [0.01, 0],
    ]
    const roads = roadsFromFeatures([
      lineFeature(shape, { name: 'Highway 16', class: 'trunk' }),
      lineFeature(shape, { name: 'Highway 16', class: 'trunk' }),
      // The same line the other way round is still the same line.
      lineFeature([...shape].reverse(), { name: 'Highway 16', class: 'trunk' }),
    ])
    expect(roads).toHaveLength(1)
    expect(roads[0].coordinates).toHaveLength(2)
  })

  it('reads a multilinestring', () => {
    const roads = roadsFromFeatures([
      {
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [0, 0],
              [0.01, 0],
            ],
            [
              [0.01, 0],
              [0.02, 0],
            ],
          ],
        },
        properties: { name: 'Split road', class: 'minor' },
      },
    ])
    expect(roads[0].coordinates).toHaveLength(3)
  })
})

describe('chainSegments', () => {
  it('joins segments given in any order or direction', () => {
    const chained = chainSegments([
      [
        [0.02, 0],
        [0.01, 0],
      ],
      [
        [0.02, 0],
        [0.03, 0],
      ],
      [
        [0, 0],
        [0.01, 0],
      ],
    ])
    expect(chained).toHaveLength(4)
    const lngs = chained.map(([lng]) => lng)
    // One continuous run, ascending or descending but never jumping.
    expect([...lngs].sort((a, b) => a - b)).toEqual([0, 0.01, 0.02, 0.03])
  })

  it('keeps a disconnected piece rather than dropping it', () => {
    const chained = chainSegments([
      [
        [0, 0],
        [0.01, 0],
      ],
      [
        [5, 5],
        [5.01, 5],
      ],
    ])
    expect(chained).toHaveLength(4)
  })

  it('handles nothing usable', () => {
    expect(chainSegments([])).toEqual([])
    expect(chainSegments([[[0, 0]]])).toEqual([])
  })
})

describe('nearestPointOnLine', () => {
  it('projects a point onto the nearest place on the line', () => {
    const nearest = nearestPointOnLine(STRAIGHT, { lng: 0.01, lat: 0.002 })!
    expect(nearest.position[0]).toBeCloseTo(0.01, 6)
    expect(nearest.position[1]).toBeCloseTo(0, 6)
    // 0.002° of latitude is about 222 m.
    expect(nearest.offsetMeters).toBeGreaterThan(200)
    expect(nearest.offsetMeters).toBeLessThan(240)
    expect(nearest.distanceAlongMeters).toBeCloseTo(lineLengthMeters(STRAIGHT) / 4, -1)
  })

  it('clamps to the ends rather than running off them', () => {
    const before = nearestPointOnLine(STRAIGHT, { lng: -0.01, lat: 0 })!
    expect(before.distanceAlongMeters).toBeCloseTo(0, 5)
    const after = nearestPointOnLine(STRAIGHT, { lng: 0.06, lat: 0 })!
    expect(after.distanceAlongMeters).toBeCloseTo(lineLengthMeters(STRAIGHT), -1)
  })

  it('handles a degenerate line', () => {
    expect(nearestPointOnLine([], { lng: 0, lat: 0 })).toBeNull()
    expect(nearestPointOnLine([[0, 0]], { lng: 0, lat: 0.001 })!.offsetMeters).toBeGreaterThan(50)
  })
})

describe('sliceLine', () => {
  it('returns the stretch between two distances', () => {
    const total = lineLengthMeters(STRAIGHT)
    const slice = sliceLine(STRAIGHT, total * 0.25, total * 0.75)
    expect(slice[0][0]).toBeCloseTo(0.01, 4)
    expect(slice[slice.length - 1][0]).toBeCloseTo(0.03, 4)
    expect(lineLengthMeters(slice)).toBeCloseTo(total / 2, -1)
  })

  it('does not care which way round the bounds come', () => {
    const total = lineLengthMeters(STRAIGHT)
    expect(lineLengthMeters(sliceLine(STRAIGHT, total * 0.75, total * 0.25))).toBeCloseTo(total / 2, -1)
  })
})

describe('snapCorridorToRoad', () => {
  const highway: RoadCandidate = { id: 'hwy', name: 'Highway 16', roadClass: 'trunk', coordinates: STRAIGHT }
  const sideRoad: RoadCandidate = {
    id: 'side',
    name: 'Side Rd',
    roadClass: 'minor',
    coordinates: [
      [0, 0.02],
      [0.04, 0.02],
    ],
  }

  it('picks the road the drawing was tracing', () => {
    // Sketched just north of the highway, wobbling as a hand-drawn line does.
    const drawn: Array<[number, number]> = [
      [0.008, 0.0004],
      [0.018, -0.0003],
      [0.028, 0.0005],
    ]
    const snapped = snapCorridorToRoad(drawn, [highway, sideRoad])!

    expect(snapped.road.name).toBe('Highway 16')
    expect(snapped.meanOffsetMeters).toBeLessThan(80)
    // Every returned vertex sits on the road itself.
    expect(snapped.coordinates.every(([, lat]) => Math.abs(lat) < 1e-9)).toBe(true)
  })

  it('trims to the stretch that was drawn rather than the whole road', () => {
    const drawn: Array<[number, number]> = [
      [0.008, 0.0002],
      [0.016, 0.0002],
    ]
    const snapped = snapCorridorToRoad(drawn, [highway])!
    const length = lineLengthMeters(snapped.coordinates)

    expect(length).toBeGreaterThan(700)
    expect(length).toBeLessThan(1100)
    expect(length).toBeLessThan(lineLengthMeters(STRAIGHT))
  })

  it('gives a short run of road around a single dropped point', () => {
    const snapped = snapCorridorToRoad([[0.02, 0.0002]], [highway])!
    expect(lineLengthMeters(snapped.coordinates)).toBeGreaterThan(500)
  })

  it('leaves a line alone when no road is near enough', () => {
    const drawn: Array<[number, number]> = [
      [0.01, 0.05],
      [0.02, 0.05],
    ]
    expect(snapCorridorToRoad(drawn, [highway])).toBeNull()
    // Raising the tolerance lets the same drawing snap.
    expect(snapCorridorToRoad(drawn, [highway], { maxOffsetMeters: 20000 })).not.toBeNull()
  })

  it('handles an empty request', () => {
    expect(snapCorridorToRoad([], [highway])).toBeNull()
    expect(snapCorridorToRoad([[0, 0]], [])).toBeNull()
  })
})

describe('collectRoadsFromMap', () => {
  const style = {
    layers: [
      { id: 'road_trunk_case', type: 'line', 'source-layer': 'transportation' },
      { id: 'road_trunk_fill', type: 'line', 'source-layer': 'transportation' },
      { id: 'water', type: 'fill', 'source-layer': 'water' },
      { id: 'transportation_name', type: 'symbol', 'source-layer': 'transportation_name' },
    ],
  }

  function fakeMap(features: GeoJSON.Feature[]): RoadQueryMap & { queried: string[][] } {
    const queried: string[][] = []
    return {
      queried,
      getStyle: () => style,
      queryRenderedFeatures: ({ layers }) => {
        queried.push(layers)
        return features
      },
    }
  }

  it('queries the road fills and skips the casings', () => {
    expect(roadLayerIds(fakeMap([]))).toEqual(['road_trunk_fill'])
  })

  it('returns usable roads from what the map has drawn', () => {
    const map = fakeMap([lineFeature(STRAIGHT, { name: 'Highway 16', class: 'trunk' })])
    const roads = collectRoadsFromMap(map)

    expect(map.queried).toEqual([['road_trunk_fill']])
    expect(roads).toHaveLength(1)
    expect(roads[0].name).toBe('Highway 16')
  })

  it('asks for nothing when the style has no road layers', () => {
    const map: RoadQueryMap & { queried: string[][] } = {
      queried: [],
      getStyle: () => ({ layers: [] }),
      queryRenderedFeatures: ({ layers }) => {
        map.queried.push(layers)
        return []
      },
    }
    expect(collectRoadsFromMap(map)).toHaveLength(0)
    expect(map.queried).toHaveLength(0)
  })

  it('survives a style that is not ready yet', () => {
    expect(collectRoadsFromMap({ getStyle: () => undefined, queryRenderedFeatures: () => [] })).toEqual([])
  })
})
