import { describe, expect, it, vi } from 'vitest'
import {
  buildProvincialQuery,
  loadBcStreamContext,
  normalizeProvincialContext,
  STREAM_QUERY_PAGE_SIZE,
} from './bcStreamData'
import {
  BC_STREAM_SOURCES,
  mergeProvincialStreams,
  parseProvincialStreamData,
  streamQueryBounds,
  type ProvincialDataset,
  type StreamQueryBounds,
} from './provincialStreamData'
import { assessmentFingerprint, EMPTY_STREAM_ASSESSMENT, RIPARIAN_RULES, streamStatus } from './streamClass'
import { createDemoProject } from './terrain'
import { importContextGeoJson, parseProject, projectGeoJson, serializeProject } from './project'

const bounds: StreamQueryBounds = [-122.84, 53.87, -122.8, 53.9]
const date = '2026-11-07T17:00:00.000Z'
const line = (id: number): GeoJSON.Feature<GeoJSON.LineString, Record<string, unknown>> => ({
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.83, 53.88],
      [-122.81, 53.89],
    ],
  },
  properties: { OBJECTID: id, GNIS_NAME: `Stream ${id}`, BLUE_LINE_KEY: 123, EDGE_TYPE: 1000, STREAM_ORDER: 2 },
})
const fish: GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>> = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-122.82, 53.885] },
  properties: {
    OBJECTID: 8,
    FISH_OBSERVATION_POINT_ID: 99,
    SPECIES_NAME: 'Rainbow trout',
    OBSERVATION_DATE: Date.parse('2011-05-10'),
  },
}
const watershed: GeoJSON.Feature<GeoJSON.Polygon, Record<string, unknown>> = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.84, 53.87],
        [-122.8, 53.87],
        [-122.8, 53.9],
        [-122.84, 53.9],
        [-122.84, 53.87],
      ],
    ],
  },
  properties: { OBJECTID: 9, WLS_CW_SYSID: 90, CW_NAME: 'Test watershed', CW_LEGISLATION: 'FRPA' },
}
const fixture = () => ({ streams: [line(1)], fish: [fish], watersheds: [watershed] })
const normalized = () => normalizeProvincialContext(fixture(), bounds, date)

function fetchFixture(data = fixture(), alter?: (url: URL, raw: unknown, call: number) => unknown) {
  let call = 0
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const dataset = (Object.keys(BC_STREAM_SOURCES) as ProvincialDataset[]).find((k) =>
      url.href.startsWith(BC_STREAM_SOURCES[k].serviceUrl),
    )!
    const records = data[dataset]
    const ids = url.searchParams.get('objectIds')?.split(',')
    const raw = ids
      ? { type: 'FeatureCollection', features: records.filter((f) => ids.includes(String(f.properties?.OBJECTID))) }
      : { objectIdFieldName: 'OBJECTID', objectIds: records.map((f) => f.properties?.OBJECTID) }
    return new Response(JSON.stringify(alter ? alter(url, raw, ++call) : raw), {
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

describe('provincial stream loading', () => {
  it('accepts ArcGIS null only when it identifies a successful empty OBJECTID inventory', async () => {
    const empty = { streams: [], fish: [], watersheds: [] }
    const fetcher = fetchFixture(empty, () => ({ objectIdFieldName: 'OBJECTID', objectIds: null }))
    await expect(loadBcStreamContext(bounds, undefined, fetcher)).resolves.toMatchObject({
      streams: [],
      data: { sourceCounts: { streams: 0, fish: 0, watersheds: 0 } },
    })
    await expect(
      loadBcStreamContext(
        bounds,
        undefined,
        fetchFixture(empty, () => ({ objectIds: null })),
      ),
    ).rejects.toThrow(/ID inventory/)
  })
  it('uses explicit geographic queries and rejects wide extents instead of clipping their coverage', () => {
    const query = new URL(buildProvincialQuery('streams', bounds))
    expect(query.searchParams.get('geometry')).toBe(bounds.join(','))
    expect(query.searchParams.get('inSR')).toBe('4326')
    expect(query.searchParams.get('returnIdsOnly')).toBe('true')
    expect(() =>
      streamQueryBounds([
        [-122, 54],
        [-121, 54],
      ]),
    ).toThrow(/shorter active road/)
    expect(() => buildProvincialQuery('fish', bounds, ['1) OR 1=1'])).toThrow(/record IDs/)
  })

  it('loads every ID page and rechecks all three inventories, including empty sources', async () => {
    const data = {
      streams: Array.from({ length: STREAM_QUERY_PAGE_SIZE + 1 }, (_, i) => line(i)),
      fish: [],
      watersheds: [],
    }
    const fetcher = fetchFixture(data)
    const result = await loadBcStreamContext(bounds, undefined, fetcher)
    expect(result.streams).toHaveLength(STREAM_QUERY_PAGE_SIZE + 1)
    expect(result.data.sourceCounts).toEqual({ streams: STREAM_QUERY_PAGE_SIZE + 1, fish: 0, watersheds: 0 })
    expect(fetcher).toHaveBeenCalledTimes(8)
    expect(result.streams.every((f) => !f.streamAssessment)).toBe(true)
  })

  it('rejects omitted or duplicate records rather than accepting a partial stream inventory', async () => {
    for (const features of [[], [line(1), line(1)]]) {
      const fetcher = fetchFixture(fixture(), (url, raw) =>
        url.href.startsWith(BC_STREAM_SOURCES.streams.serviceUrl) && url.searchParams.has('objectIds')
          ? { type: 'FeatureCollection', features }
          : raw,
      )
      await expect(loadBcStreamContext(bounds, undefined, fetcher)).rejects.toThrow(/incomplete/)
    }
  })

  it('refuses a truncated result and an inventory that changes during retrieval', async () => {
    await expect(
      loadBcStreamContext(
        bounds,
        undefined,
        fetchFixture(fixture(), (_url, raw) => ({ ...(raw as object), exceededTransferLimit: true })),
      ),
    ).rejects.toThrow(/truncated/)
    let seen = 0
    const fetcher = fetchFixture(fixture(), (url, raw) =>
      url.href.startsWith(BC_STREAM_SOURCES.streams.serviceUrl) && url.searchParams.has('returnIdsOnly') && ++seen === 2
        ? { objectIds: [1, 2] }
        : raw,
    )
    await expect(loadBcStreamContext(bounds, undefined, fetcher)).rejects.toThrow(/changed during loading/)
  })

  it('does not return partially loaded streams when another evidence source fails', async () => {
    const fetcher = fetchFixture(fixture(), (url, raw) =>
      url.href.startsWith(BC_STREAM_SOURCES.fish.serviceUrl) ? { error: { message: 'unavailable' } } : raw,
    )
    await expect(loadBcStreamContext(bounds, undefined, fetcher)).rejects.toThrow(/could not complete/)
  })

  it('honours a pre-aborted request and caps records before downloading geometry', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(loadBcStreamContext(bounds, controller.signal, fetchFixture())).rejects.toThrow()
    const fetcher = fetchFixture(fixture(), (url, raw) =>
      url.href.startsWith(BC_STREAM_SOURCES.streams.serviceUrl)
        ? { objectIds: Array.from({ length: 451 }, (_, i) => i) }
        : raw,
    )
    await expect(loadBcStreamContext(bounds, undefined, fetcher)).rejects.toThrow(/Too many/)
  })
})

describe('provincial stream evidence and persistence', () => {
  it('preserves raw stream order and fish dates without assigning a class or fish absence', () => {
    const { streams, data } = normalized()
    expect(streams[0].id).toBe('bc-fwa-1-0')
    expect(streams[0].streamSource?.streamOrder).toBe(2)
    expect(streams[0].streamAssessment).toBeUndefined()
    expect(data.fish[0].observedOn).toBe('2011-05-10T00:00:00.000Z')
    expect(data.watersheds[0].name).toBe('Test watershed')
  })

  it('round trips source metadata, observations and polygons through actual project formats', () => {
    const { streams, data } = normalized()
    const project = { ...createDemoProject(), context: streams, provincialStreamData: data }
    const reopened = parseProject(serializeProject(project))
    expect(reopened.provincialStreamData).toEqual(data)
    expect(reopened.context[0].streamSource).toEqual(streams[0].streamSource)
    const exported = projectGeoJson(reopened, new Map())
    const contextOnly = {
      type: 'FeatureCollection',
      features: exported.features.filter((f) => f.properties?.kind === 'stream'),
    }
    expect(importContextGeoJson(contextOnly)[0].streamSource).toEqual(streams[0].streamSource)
  })

  it('retains a review and its price on refresh but stales it if the source geometry changes', () => {
    const { streams } = normalized()
    const assessment = {
      ...EMPTY_STREAM_ASSESSMENT,
      channelWidthM: 3,
      fish: 'present' as const,
      reviewedClass: 'S3' as const,
      reviewedRules: RIPARIAN_RULES.id + '@' + RIPARIAN_RULES.consolidatedTo,
    }
    const existing = [
      {
        ...streams[0],
        crossingCost: 30000,
        streamAssessment: {
          ...assessment,
          reviewedFingerprint: assessmentFingerprint(assessment, streams[0].geometry.coordinates),
        },
      },
    ]
    expect(
      streamStatus(mergeProvincialStreams(existing, streams)[0].streamAssessment, streams[0].geometry.coordinates),
    ).toBe('reviewed')
    const changed = structuredClone(streams)
    changed[0].geometry.coordinates[0] = [-122.82, 53.88]
    const merged = mergeProvincialStreams(existing, changed)[0]
    expect(merged.crossingCost).toBe(30000)
    expect(merged.streamAssessment?.reviewedClass).toBe('S3')
    expect(streamStatus(merged.streamAssessment, merged.geometry.coordinates)).toBe('needs-review')
  })

  it('refuses identity collisions, inconsistent retained counts and malformed watershed geometry', () => {
    const { streams, data } = normalized()
    expect(() => mergeProvincialStreams([{ ...streams[0], streamSource: undefined }], streams)).toThrow(/conflicts/)
    expect(() => parseProvincialStreamData({ ...data, fish: [] })).toThrow(/counts/)
    const invalid = structuredClone(data)
    invalid.watersheds[0].geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [-122, 54],
          [-122, 55],
          [-123, 55],
          [-123, 54],
        ],
      ],
    }
    expect(() => parseProvincialStreamData(invalid)).toThrow(/closed/)
  })
})
