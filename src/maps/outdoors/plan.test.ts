import { describe, expect, it } from 'vitest'

import {
  MAX_PLAN_WAYPOINTS,
  OUTDOORS_PLAN_SCHEMA,
  OUTDOORS_PLAN_VERSION,
  createEmptyPlan,
  decodeOutdoorsPlanToken,
  encodeOutdoorsPlanToken,
  normalizeOutdoorsPlan,
  parseOutdoorsPlanFile,
  planFileName,
  planToGeoJson,
  roundCoordinate,
  serializeOutdoorsPlan,
  type OutdoorsPlan,
} from './plan'

function samplePlan(): OutdoorsPlan {
  return {
    schema: OUTDOORS_PLAN_SCHEMA,
    version: OUTDOORS_PLAN_VERSION,
    name: 'Elk in MU 7-42',
    activity: 'hunt',
    species: 'Elk',
    startDate: '2026-09-10',
    endDate: '2026-09-14',
    notes: 'Check vehicle closure before the season.',
    wmus: [{ id: '7-42', name: 'MU 7-42' }],
    waypoints: [
      { id: 'wp1', name: 'Boat launch', kind: 'launch', lng: -122.75331, lat: 56.34992 },
      { id: 'wp2', name: 'Camp', kind: 'camp', lng: -122.7, lat: 56.3, notes: 'High bank' },
    ],
    routes: [
      {
        id: 'rt1',
        name: 'River run',
        kind: 'water-route',
        coordinates: [
          [-122.75, 56.35],
          [-122.72, 56.33],
          [-122.7, 56.3],
        ],
      },
    ],
    areas: [
      {
        id: 'ar1',
        name: 'Closed to vehicles',
        kind: 'closure',
        rings: [
          [
            [-122.8, 56.4],
            [-122.7, 56.4],
            [-122.7, 56.3],
            [-122.8, 56.4],
          ],
        ],
      },
    ],
    viewport: { center: [-122.7, 56.3], zoom: 9.5 },
  }
}

describe('normalizeOutdoorsPlan', () => {
  it('round-trips a valid plan unchanged', () => {
    expect(normalizeOutdoorsPlan(samplePlan())).toEqual(samplePlan())
  })

  it('rejects values that are not plan documents', () => {
    expect(normalizeOutdoorsPlan(null)).toBeNull()
    expect(normalizeOutdoorsPlan('plan')).toBeNull()
    expect(normalizeOutdoorsPlan({})).toBeNull()
    expect(normalizeOutdoorsPlan({ schema: 'other', version: 1 })).toBeNull()
    expect(normalizeOutdoorsPlan({ schema: OUTDOORS_PLAN_SCHEMA, version: 99 })).toBeNull()
  })

  it('coerces malformed fields instead of failing the whole plan', () => {
    const plan = normalizeOutdoorsPlan({
      schema: OUTDOORS_PLAN_SCHEMA,
      version: OUTDOORS_PLAN_VERSION,
      name: 42,
      activity: 'trap',
      startDate: 'next week',
      wmus: ['7-42', '7-42', { name: 'missing id' }, { id: ' 7-43 ' }],
      waypoints: [
        { name: 'bad coords', kind: 'camp', lng: 500, lat: 56 },
        { name: 'ok', kind: 'unknown-kind', lng: -122.123456789, lat: 56.987654321 },
      ],
      viewport: { center: [-122, 91], zoom: 9 },
    })

    expect(plan).not.toBeNull()
    expect(plan?.name).toBe('')
    expect(plan?.activity).toBe('hunt')
    expect(plan?.startDate).toBe('')
    expect(plan?.wmus).toEqual([{ id: '7-42' }, { id: '7-43' }])
    expect(plan?.waypoints).toHaveLength(1)
    expect(plan?.waypoints[0]).toMatchObject({ name: 'ok', kind: 'note', lng: -122.12346, lat: 56.98765 })
    expect(plan?.viewport).toBeUndefined()
  })

  it('coerces malformed routes and areas', () => {
    const plan = normalizeOutdoorsPlan({
      schema: OUTDOORS_PLAN_SCHEMA,
      version: OUTDOORS_PLAN_VERSION,
      routes: [
        { name: 'too short', kind: 'corridor', coordinates: [[-122, 56]] },
        {
          name: 'ok',
          kind: 'not-a-kind',
          coordinates: [
            [-122.123456789, 56.1],
            [-122.123456789, 56.1],
            [-122.2, 56.2],
          ],
        },
      ],
      areas: [
        { name: 'degenerate', kind: 'closure', rings: [[[-122, 56], [-122.1, 56]]] },
        {
          name: 'open ring',
          kind: 'water',
          rings: [
            [
              [-122, 56],
              [-122.1, 56],
              [-122.1, 56.1],
            ],
          ],
        },
      ],
    })

    expect(plan?.routes).toHaveLength(1)
    expect(plan?.routes[0]).toMatchObject({
      name: 'ok',
      kind: 'route',
      coordinates: [
        [-122.12346, 56.1],
        [-122.2, 56.2],
      ],
    })
    expect(plan?.areas).toHaveLength(1)
    expect(plan?.areas[0]?.rings[0]).toEqual([
      [-122, 56],
      [-122.1, 56],
      [-122.1, 56.1],
      [-122, 56],
    ])
  })

  it('drops null-island placeholder coordinates', () => {
    const plan = normalizeOutdoorsPlan({
      schema: OUTDOORS_PLAN_SCHEMA,
      version: OUTDOORS_PLAN_VERSION,
      waypoints: [{ name: 'no fix', kind: 'note', lng: 0, lat: 0 }],
      routes: [
        {
          name: 'with junk vertex',
          kind: 'route',
          coordinates: [
            [-122.1, 56.1],
            [0, 0],
            [-122.2, 56.2],
          ],
        },
      ],
    })
    expect(plan?.waypoints).toHaveLength(0)
    expect(plan?.routes[0]?.coordinates).toEqual([
      [-122.1, 56.1],
      [-122.2, 56.2],
    ])
  })

  it('downsamples oversized lines instead of rejecting them', () => {
    const coordinates = Array.from({ length: 2000 }, (_, index) => [
      -130 + index * 0.001,
      56,
    ])
    const plan = normalizeOutdoorsPlan({
      schema: OUTDOORS_PLAN_SCHEMA,
      version: OUTDOORS_PLAN_VERSION,
      routes: [{ name: 'long', kind: 'route', coordinates }],
    })
    const route = plan?.routes[0]
    expect(route?.coordinates.length).toBe(400)
    expect(route?.coordinates[0]).toEqual([-130, 56])
    expect(route?.coordinates[399]).toEqual([-128.001, 56])
  })

  it('caps runaway waypoint lists', () => {
    const waypoints = Array.from({ length: MAX_PLAN_WAYPOINTS + 25 }, (_, index) => ({
      name: `wp ${index}`,
      kind: 'note',
      lng: -122,
      lat: 56,
    }))
    const plan = normalizeOutdoorsPlan({
      schema: OUTDOORS_PLAN_SCHEMA,
      version: OUTDOORS_PLAN_VERSION,
      waypoints,
    })
    expect(plan?.waypoints).toHaveLength(MAX_PLAN_WAYPOINTS)
  })
})

describe('share tokens', () => {
  it('encodes and decodes a plan through the share engine', async () => {
    const token = await encodeOutdoorsPlanToken(samplePlan())
    expect(token.length).toBeGreaterThan(0)
    expect(token.length).toBeLessThan(12000)
    await expect(decodeOutdoorsPlanToken(token)).resolves.toEqual(samplePlan())
  })

  it('returns null for garbage tokens instead of throwing', async () => {
    await expect(decodeOutdoorsPlanToken('%7Bnot-a-token')).resolves.toBeNull()
  })
})

describe('file export and import', () => {
  it('round-trips through the exported plan JSON', () => {
    const text = serializeOutdoorsPlan(samplePlan())
    const result = parseOutdoorsPlanFile(text)
    expect(result?.source).toBe('plan')
    expect(result?.plan).toEqual(samplePlan())
  })

  it('names files from the plan title', () => {
    expect(planFileName(samplePlan(), 'plan.json')).toBe('elk-in-mu-7-42.plan.json')
    expect(planFileName(createEmptyPlan(), 'geojson')).toBe('outdoors-plan.geojson')
  })

  it('exports areas, routes, waypoints, and plan context as GeoJSON', () => {
    const collection = planToGeoJson(samplePlan()) as GeoJSON.FeatureCollection & {
      metadata?: { wmus?: unknown }
    }
    expect(collection.features).toHaveLength(4)
    expect(collection.features.map((feature) => feature.geometry.type)).toEqual([
      'Polygon',
      'LineString',
      'Point',
      'Point',
    ])
    expect(collection.metadata?.wmus).toEqual([{ id: '7-42', name: 'MU 7-42' }])
  })

  it('re-imports its own GeoJSON export with kinds intact', () => {
    const exported = JSON.stringify(planToGeoJson(samplePlan()))
    const result = parseOutdoorsPlanFile(exported)
    expect(result?.source).toBe('geojson')
    expect(result?.skippedCount).toBe(0)
    expect(result?.plan.areas[0]).toMatchObject({ name: 'Closed to vehicles', kind: 'closure' })
    expect(result?.plan.routes[0]).toMatchObject({ name: 'River run', kind: 'water-route' })
    expect(result?.plan.waypoints[0]).toMatchObject({ name: 'Boat launch', kind: 'launch' })
  })

  it('imports KML-derived planning GeoJSON, converting lines and skipping labels', () => {
    const result = parseOutdoorsPlanFile(
      JSON.stringify({
        type: 'FeatureCollection',
        name: 'MU-7-42',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-122.75331, 56.34992] },
            properties: { name: 'Ferry launch', planningClass: 'formal-access' },
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-122.7, 56.3] },
            properties: { name: 'Label', planningClass: 'map-label' },
          },
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-122.7, 56.3],
                [-122.6, 56.4],
              ],
            },
            properties: { name: 'River run', planningClass: 'navigable-water' },
          },
        ],
      }),
    )

    expect(result?.source).toBe('geojson')
    expect(result?.skippedCount).toBe(1)
    expect(result?.plan.name).toBe('MU-7-42')
    expect(result?.plan.waypoints).toHaveLength(1)
    expect(result?.plan.waypoints[0]).toMatchObject({ name: 'Ferry launch', kind: 'launch' })
    expect(result?.plan.routes).toHaveLength(1)
    expect(result?.plan.routes[0]).toMatchObject({ name: 'River run', kind: 'water-route' })
  })

  it('rejects files that are neither plans nor plan-like GeoJSON', () => {
    expect(parseOutdoorsPlanFile('not json')).toBeNull()
    expect(parseOutdoorsPlanFile('{"type":"FeatureCollection","features":[]}')).toBeNull()
  })
})

describe('roundCoordinate', () => {
  it('rounds to five decimal places', () => {
    expect(roundCoordinate(-122.123456789)).toBe(-122.12346)
    expect(roundCoordinate(56)).toBe(56)
  })
})
