import { describe, expect, it } from 'vitest'

import {
  MAX_PHOTO_FEATURES,
  PHOTO_FEATURE_SOURCES,
  photoFeatureSummary,
  photoFeatureUrl,
  photoFeaturesForOverlay,
  photoSeenBounds,
  readPhotoFeatures,
  type Box,
  type PhotoFeatureSourceId,
} from './photoFeatures'
import type { HitBuffer } from './photoHitBuffer'

// A made-up box; nothing here is a real photo's.
const BOX: Box = [-122.6, 53.6, -122.4, 53.8]
const source = (id: PhotoFeatureSourceId) => PHOTO_FEATURE_SOURCES.find((entry) => entry.id === id)!

const params = (url: string) => new URL(url).searchParams

const polygon: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.5, 53.7],
      [-122.49, 53.7],
      [-122.49, 53.71],
      [-122.5, 53.7],
    ],
  ],
}
const line: GeoJSON.LineString = {
  type: 'LineString',
  coordinates: [
    [-122.5, 53.7, 812],
    [-122.49, 53.71, 820],
  ],
}

/** A stand-in for DataBC: answers by layer, or fails the layers listed. */
function stubFetch(replies: Partial<Record<string, unknown>>, fail: string[] = []) {
  const seen: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    seen.push(url)
    const typeName = params(url).get('typeNames')!
    if (fail.includes(typeName)) return new Response('', { status: 503 })
    return new Response(JSON.stringify(replies[typeName] ?? { type: 'FeatureCollection', features: [] }), {
      status: 200,
    })
  }) as typeof fetch
  return { fetcher, seen }
}

describe('photoFeatureUrl', () => {
  it('puts the box in CQL_FILTER longitude first on the named geometry field', () => {
    const query = params(photoFeatureUrl(source('lakes'), BOX, 1996))
    expect(query.get('typeNames')).toBe('WHSE_BASEMAPPING.FWA_LAKES_POLY')
    expect(query.get('CQL_FILTER')).toBe("BBOX(GEOMETRY,-122.6,53.6,-122.4,53.8,'EPSG:4326')")
    expect(query.get('propertyName')).toBe('WATERBODY_POLY_ID,GNIS_NAME_1,GEOMETRY')
    expect(query.get('bbox')).toBeNull()
    expect(query.get('srsName')).toBe('EPSG:4326')
    expect(query.get('count')).toBe(String(MAX_PHOTO_FEATURES))
  })

  it('reads streams of order 2 and up, and cutblocks harvested since the year given, on SHAPE', () => {
    expect(params(photoFeatureUrl(source('streams'), BOX, 1996)).get('CQL_FILTER')).toBe(
      "STREAM_ORDER >= 2 AND BBOX(GEOMETRY,-122.6,53.6,-122.4,53.8,'EPSG:4326')",
    )
    const cutblocks = params(photoFeatureUrl(source('cutblocks'), BOX, 1996))
    expect(cutblocks.get('CQL_FILTER')).toBe(
      "HARVEST_START_YEAR_CALENDAR >= 1996 AND BBOX(SHAPE,-122.6,53.6,-122.4,53.8,'EPSG:4326')",
    )
    expect(cutblocks.get('propertyName')!.split(',')).toContain('SHAPE')
  })

  it('refuses an empty box', () => {
    expect(() => photoFeatureUrl(source('roads'), [-122.5, 53.7, -122.5, 53.7], 1996)).toThrow()
  })
})

describe('readPhotoFeatures', () => {
  it('reads every source and keeps a failed one as an error that reads Not read', async () => {
    const { fetcher, seen } = stubFetch(
      {
        'WHSE_BASEMAPPING.FWA_LAKES_POLY': {
          features: [
            { id: 'lake.1', properties: { GNIS_NAME_1: 'Made-up Lake' }, geometry: polygon },
            // A line where polygons are read is dropped, not drawn as a lake.
            { id: 'lake.2', properties: {}, geometry: line },
          ],
        },
        'WHSE_FOREST_VEGETATION.VEG_CONSOLIDATED_CUT_BLOCKS_SP': {
          numberMatched: 5000,
          features: [
            { id: 'cb.1', properties: { HARVEST_START_YEAR_CALENDAR: 2012, OPENING_ID: 7 }, geometry: polygon },
          ],
        },
        'WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW': {
          features: [
            {
              id: 'road.1',
              properties: { ROAD_SECTION_NAME: 'Made-up FSR', FILE_TYPE_DESCRIPTION: 'Forest Service Road' },
              geometry: line,
            },
          ],
        },
      },
      ['WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP'],
    )
    const reads = await readPhotoFeatures(BOX, fetcher, { year: 2026 })
    expect(seen).toHaveLength(PHOTO_FEATURE_SOURCES.length)

    expect(reads.streams).toEqual({ status: 'error', error: 'DataBC answered 503.' })
    expect(photoFeatureSummary(source('streams'), reads.streams).value).toBe('Not read')

    const lakes = reads.lakes.status === 'ready' ? reads.lakes.collection.features : []
    expect(lakes).toHaveLength(1)
    expect(lakes[0].properties).toMatchObject({ kind: 'lake', label: 'Made-up Lake', layer: 'lakes' })

    expect(reads.cutblocks).toMatchObject({ status: 'ready', truncated: true })
    expect(photoFeatureSummary(source('cutblocks'), reads.cutblocks).value).toBe('1+')

    expect(reads.wetlands).toMatchObject({ status: 'ready', truncated: false })
    expect(photoFeatureSummary(source('wetlands'), reads.wetlands).value).toBe('None')

    const overlay = photoFeaturesForOverlay(reads)
    expect(overlay.map((feature) => feature.layer).sort()).toEqual(['lakes', 'openings', 'roads'])
    expect(overlay.find((feature) => feature.layer === 'roads')).toMatchObject({
      label: 'Made-up FSR',
      properties: { forestServiceRoad: true },
    })
    expect(overlay.find((feature) => feature.layer === 'openings')).toMatchObject({
      label: 'Harvested 2012',
      properties: { harvestYear: 2012 },
    })

    // Recent: the 30 years before the year given.
    const cutblockUrl = seen.find((url) => url.includes('CONSOLIDATED'))!
    expect(params(cutblockUrl).get('CQL_FILTER')).toContain('HARVEST_START_YEAR_CALENDAR >= 1996')
  })

  it('treats a refused query or a reply with no feature list as not read', async () => {
    const { fetcher } = stubFetch({
      'WHSE_BASEMAPPING.FWA_LAKES_POLY': { exceptions: [{ code: 'InvalidParameterValue' }] },
      'WHSE_BASEMAPPING.FWA_RIVERS_POLY': { error: 'nothing' },
    })
    const reads = await readPhotoFeatures(BOX, fetcher, { year: 2026 })
    expect(reads.lakes).toEqual({ status: 'error', error: 'DataBC refused the query.' })
    expect(reads.rivers.status).toBe('error')
    expect(photoFeatureSummary(source('rivers'), reads.rivers).value).toBe('Not read')
    expect(photoFeatureSummary(source('rivers'), undefined).value).toBe('Not read')
  })

  it('throws when aborted, so a superseded camera’s answers never land', async () => {
    const controller = new AbortController()
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      controller.abort()
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return new Response('{}')
    }) as typeof fetch
    await expect(readPhotoFeatures(BOX, fetcher, { signal: controller.signal })).rejects.toThrow('Aborted')
  })
})

describe('photoSeenBounds', () => {
  it('boxes every hit, padded, and is null with no ground', () => {
    const nan = Number.NaN
    const buf: HitBuffer = {
      width: 2,
      height: 2,
      photoWidth: 2,
      photoHeight: 2,
      poseKey: 'made-up',
      lng: new Float64Array([nan, -122.5, -122.45, -122.48]),
      lat: new Float64Array([nan, 53.7, 53.72, 53.69]),
      distance: new Float32Array([nan, 1000, 2000, 1500]),
      elevation: new Float32Array([nan, 800, 800, 800]),
    }
    const [w, s, e, n] = photoSeenBounds(buf, 0)!
    expect([w, s, e, n]).toEqual([-122.5, 53.69, -122.45, 53.72])
    const padded = photoSeenBounds(buf, 250)!
    expect(padded[1]).toBeCloseTo(53.69 - 250 / 110574, 9)
    expect(padded[0]).toBeLessThan(-122.5)
    const sky = { ...buf, lng: new Float64Array(4).fill(nan), lat: new Float64Array(4).fill(nan) }
    expect(photoSeenBounds(sky)).toBeNull()
  })
})
