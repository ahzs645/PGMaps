import { describe, expect, it } from 'vitest'

import {
  arrowAxis,
  clampViewpointBounds,
  parseArrows,
  parseRecSites,
  parseTenureRoads,
  parseViewpoints,
  pulloutThrough,
  roadsNearBlock,
  tenureRoadLabel,
  viewpointLayerUrl,
  viewpointsNearBlock,
} from './viewpointInventory'
import { bearingDegrees, haversineMeters, type PolygonGeometry } from './visibility'

/*
 * Three real landscape arrows north-west of Bear Lake with their viewpoints
 * (DataBC WFS, November 2026). Two have the viewpoint at the rounded end and
 * the head away from it; their COMPASS_BEARING is 0, like every row's.
 */
const ARROWS = [
  {
    id: 8468,
    vp: [-122.99134, 54.956582],
    arrow: [
      [-123.036539, 54.94237],
      [-123.036831, 54.942664],
      [-123.038594, 54.94161],
      [-123.036182, 54.942011],
      [-123.036415, 54.942245],
      [-122.991257, 54.956528],
      [-122.991418, 54.956642],
      [-123.036539, 54.94237],
    ],
  },
  {
    id: 8494,
    vp: [-123.0328, 54.988283],
    arrow: [
      [-122.99967, 55.002048],
      [-122.999336, 55.001784],
      [-122.997781, 55.002943],
      [-123.000107, 55.002392],
      [-122.999817, 55.002164],
      [-123.032874, 54.988341],
      [-123.032888, 54.988333],
      [-123.032916, 54.98831],
      [-123.032925, 54.988282],
      [-123.032916, 54.988255],
      [-123.032888, 54.988232],
      [-123.032848, 54.988216],
      [-123.0328, 54.988211],
      [-123.032752, 54.988216],
      [-123.032726, 54.988224],
      [-122.99967, 55.002048],
    ],
  },
]

const point = (lng: number, lat: number, properties: Record<string, unknown>) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties,
})

describe('arrow bearings', () => {
  it('points from the viewpoint to the head', () => {
    const [southWest, northEast] = ARROWS.map((entry) => arrowAxis(entry.arrow, { lng: entry.vp[0], lat: entry.vp[1] }))
    // 8468 runs from its viewpoint south-west to the head at -123.0386.
    expect(southWest!.from).toBe('viewpoint')
    expect(southWest!.bearing).toBeGreaterThan(225)
    expect(southWest!.bearing).toBeLessThan(250)
    expect(southWest!.tip[0]).toBeCloseTo(-123.038594, 6)
    expect(southWest!.lengthMeters).toBeGreaterThan(3000)
    // 8494 runs north-east.
    expect(northEast!.bearing).toBeGreaterThan(45)
    expect(northEast!.bearing).toBeLessThan(65)
  })

  it('reads the head off the shape when the viewpoint is not in hand', () => {
    const axis = arrowAxis(ARROWS[1].arrow)
    expect(axis!.from).toBe('shape')
    expect(axis!.bearing).toBeGreaterThan(45)
    expect(axis!.bearing).toBeLessThan(65)
  })

  it('joins arrows to their viewpoints on VIEWPOINT_ID', () => {
    const { viewpoints } = parseViewpoints({
      features: [point(ARROWS[0].vp[0], ARROWS[0].vp[1], { VIEWPOINT_ID: 1, REC_VIEWPOINT_TYPE_CODE: 'MAJVP' })],
    })
    const arrows = parseArrows(
      {
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [ARROWS[0].arrow] },
            properties: {
              VIEWING_DIRECTION_ID: 8468,
              VIEWPOINT_ID: 1,
              VIEWING_DIRECTION_TYPE: 'LARGE LANDSCAPE ARROW',
            },
          },
          {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [ARROWS[1].arrow] },
            properties: {
              VIEWING_DIRECTION_ID: 8494,
              VIEWPOINT_ID: 99,
              VIEWING_DIRECTION_TYPE: 'SMALL LANDSCAPE ARROW',
            },
          },
        ],
      },
      viewpoints,
    )
    expect(arrows.map((arrow) => [arrow.id, arrow.size, arrow.bearingFrom])).toEqual([
      ['8468', 'large', 'viewpoint'],
      ['8494', 'small', 'shape'],
    ])
  })
})

describe('records', () => {
  it('drops viewpoints the inventory typed ERROR and keeps the rest despite expiry', () => {
    const parsed = parseViewpoints({
      features: [
        point(-122.6, 54.5, { VIEWPOINT_ID: 1, REC_VIEWPOINT_TYPE_CODE: 'PHOTOP', EXPIRY_DATE: '2004-01-15Z' }),
        point(-122.6, 54.5, { VIEWPOINT_ID: 2, REC_VIEWPOINT_TYPE_CODE: 'ERROR' }),
        { type: 'Feature', geometry: null, properties: { VIEWPOINT_ID: 3 } },
      ],
    })
    expect(parsed.viewpoints.map((v) => [v.id, v.typeLabel, v.expiry])).toEqual([['1', 'Photopoint', '2004-01-15']])
    expect(parsed.droppedErrors).toBe(1)
  })

  it('names rec sites and forest service roads as notes write them', () => {
    expect(
      parseRecSites({
        features: [point(-122.6, 54.5, { FOREST_FILE_ID: 'REC1130', PROJECT_NAME: 'Davie Lake South' })],
      })[0].name,
    ).toBe('Davie Lake South Rec Site')
    expect(tenureRoadLabel('DAVIE LAKE FSR', true)).toBe('Davie Lake FSR')
    expect(tenureRoadLabel('DAVIE-BEAR LAKE FSR', true)).toBe('Davie-Bear Lake FSR')
    expect(tenureRoadLabel('CHUCHINKA-COLBOURNE', true)).toBe('Chuchinka-Colbourne FSR')
    expect(tenureRoadLabel('DABE 2000', false)).toBe('DABE 2000')
  })

  it('splits multi-part roads and marks retired ones', () => {
    const roads = parseTenureRoads({
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [0, 0],
                [0, 1],
              ],
              [
                [1, 0],
                [1, 1],
              ],
            ],
          },
          properties: {
            OBJECTID: 5,
            ROAD_SECTION_NAME: 'DAVIE LAKE FSR',
            FILE_TYPE_DESCRIPTION: 'Forest Service Road',
            LIFE_CYCLE_STATUS_CODE: 'RETIRED',
          },
        },
      ],
    })
    expect(roads.map((road) => [road.id, road.name, road.retired])).toEqual([
      ['5-0', 'Davie Lake FSR', true],
      ['5-1', 'Davie Lake FSR', true],
    ])
  })

  it('asks the WFS with a longitude-first CQL box, never a bbox parameter', () => {
    const url = new URL(viewpointLayerUrl('arrows', [-123, 54, -122.5, 54.5]))
    expect(url.searchParams.get('bbox')).toBeNull()
    expect(url.searchParams.get('CQL_FILTER')).toBe("BBOX(GEOMETRY,-123,54,-122.5,54.5,'EPSG:4326')")
    expect(url.searchParams.get('typeName')).toBe('WHSE_FOREST_VEGETATION.REC_VIEWING_DIRECTION_LIN')
    expect(clampViewpointBounds([-130, 50, -110, 60])).toEqual([-120.4, 54.6, -119.6, 55.4])
  })
})

describe('ranking near a block', () => {
  const block: PolygonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [-123.04, 54.94],
        [-123.035, 54.94],
        [-123.035, 54.943],
        [-123.04, 54.943],
        [-123.04, 54.94],
      ],
    ],
  }

  it('raises a viewpoint whose arrow aims at the block', () => {
    const viewpoints = [
      {
        id: 'a',
        number: 1,
        typeCode: 'MINVP',
        typeLabel: 'Minor viewpoint',
        lng: -122.99134,
        lat: 54.956582,
        expiry: null,
      },
      { id: 'b', number: 2, typeCode: 'MINVP', typeLabel: 'Minor viewpoint', lng: -123.08, lat: 54.93, expiry: null },
    ]
    const arrows = parseArrows(
      {
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [ARROWS[0].arrow] },
            properties: { VIEWING_DIRECTION_ID: 1, VIEWPOINT_ID: 'a' },
          },
        ],
      },
      viewpoints,
    )
    const rows = viewpointsNearBlock(block, { viewpoints, arrows, recSites: [] })
    expect(rows[0].key).toBe('vli:a')
    expect(rows[0].arrow?.aims).toBe(true)
    expect(rows[0].name).toBe('VLI minor viewpoint 1')
    expect(rows.find((row) => row.key === 'vli:b')?.arrow).toBeNull()
  })

  it('keeps every arrow of a viewpoint, the one aimed at the block first', () => {
    const viewpoints = [
      {
        id: 'a',
        number: 1,
        typeCode: 'MINVP',
        typeLabel: 'Minor viewpoint',
        lng: -122.99134,
        lat: 54.956582,
        expiry: null,
      },
    ]
    // The same arrow, and a second one turned to point the other way from the viewpoint.
    const [vpLng, vpLat] = ARROWS[0].vp
    const turned = ARROWS[0].arrow.map(([lng, lat]) => [2 * vpLng - lng, 2 * vpLat - lat])
    const arrows = parseArrows(
      {
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [turned] },
            properties: { VIEWING_DIRECTION_ID: 2, VIEWPOINT_ID: 'a' },
          },
          {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [ARROWS[0].arrow] },
            properties: { VIEWING_DIRECTION_ID: 1, VIEWPOINT_ID: 'a' },
          },
        ],
      },
      viewpoints,
    )
    const [row] = viewpointsNearBlock(block, { viewpoints, arrows, recSites: [] })
    expect(row.arrows).toHaveLength(2)
    expect(row.arrows[0].aims).toBe(true)
    expect(row.arrows[1].aims).toBe(false)
    expect(row.arrows[1].offsetDegrees).toBeGreaterThan(150)
    expect(row.arrow).toEqual(row.arrows[0])
  })

  it('lists active roads by distance from the boundary', () => {
    const roads = [
      {
        id: '1',
        name: 'Near FSR',
        fileId: null,
        forestServiceRoad: true,
        retired: false,
        coordinates: [
          [-123.05, 54.9435],
          [-123.03, 54.9435],
        ] as Array<[number, number]>,
      },
      {
        id: '2',
        name: 'Old',
        fileId: null,
        forestServiceRoad: false,
        retired: true,
        coordinates: [
          [-123.05, 54.9432],
          [-123.03, 54.9432],
        ] as Array<[number, number]>,
      },
    ]
    const near = roadsNearBlock(block, roads)
    expect(near.map((road) => road.name)).toEqual(['Near FSR'])
    expect(near[0].distanceMeters).toBeGreaterThan(40)
    expect(near[0].distanceMeters).toBeLessThan(70)
  })
})

describe('standing at a viewpoint', () => {
  it('lays a 30 m pullout across the line of sight, centred on the viewpoint', () => {
    const point = { lng: -122.66, lat: 54.5 }
    const block = { lng: -122.7, lat: 54.52 }
    const [a, b] = pulloutThrough(point, block)
    expect(haversineMeters({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] })).toBeCloseTo(30, 0)
    expect((a[0] + b[0]) / 2).toBeCloseTo(point.lng, 9)
    expect((a[1] + b[1]) / 2).toBeCloseTo(point.lat, 9)
    const across = bearingDegrees({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] })
    const sight = bearingDegrees(point, block)
    expect(Math.abs(((across - sight + 540) % 360) - 180)).toBeCloseTo(90, 0)
  })
})
