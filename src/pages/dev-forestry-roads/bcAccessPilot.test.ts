import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAccessHistoryState, parseAccessHistoryState } from './accessHistory'
import {
  buildBcOpeningFootprintQuery,
  loadBcOpeningFootprints,
  MAX_BC_OPENING_POLYGON_BYTES,
  MAX_BC_OPENING_POLYGONS,
  parseBcOpeningFootprints,
} from './accessHistorySources'
import {
  BC_PILOT_MAX_ROADS,
  BC_PILOT_SOURCE_TIMEOUT_MS,
  loadBcAccessPilot,
  makeHistoricalSourceQuery,
} from './bcAccessPilot'
import type { HistoricalSourceQuery } from './accessHistoryTypes'

// Entirely invented records and geometry; no ministry responses are checked into this fixture.
const at = '2026-11-09T12:00:00Z'
const openingId = '12345'
const geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.81, 53.8],
      [-122.8, 53.8],
      [-122.8, 53.81],
      [-122.81, 53.81],
      [-122.81, 53.8],
    ],
  ],
}
const properties = {
  OPENING_ID: 12345,
  CUT_BLOCK_SKEY: 678,
  HARVEST_AUTH_FOREST_FILE_ID: 'ATEST01',
  HARVEST_AUTH_CUTTING_PERMIT_ID: '01',
  CUT_BLOCK_ID: '001',
  TIMBER_MARK: 'TEST01',
  CLIENT_NUMBER: '00000001',
  LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
  DISTURBANCE_START_DATE: '2001-01-01',
  DISTURBANCE_END_DATE: '2001-06-01',
}
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features })
const block = (overrides: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry,
  properties: { ...properties, ...overrides },
})
const result = (overrides: Record<string, unknown> = {}) => ({
  attributes: {
    OPENING_ID: 12345,
    FOREST_FILE_ID: 'ATEST01',
    CUTTING_PERMIT_ID: '01',
    CUT_BLOCK_ID: '001',
    TIMBER_MARK: 'TEST01',
    CLIENT_NUMBER: '00000001',
    DISTURBANCE_START_DATE: '2001-01-01',
    DISTURBANCE_END_DATE: '2001-06-01',
    ...overrides,
  },
})
const road = (
  objectId = 99,
  coordinates = [
    [-122.815, 53.805],
    [-122.795, 53.805],
  ],
) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties: {
    OBJECTID: objectId,
    FOREST_FILE_ID: 'RTEST01',
    ROAD_SECTION_ID: '01',
    CLIENT_NUMBER: '00000001',
    TIMBER_MARK: 'ROAD01',
    START_STATION: 0,
    END_STATION: 2,
    LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
    FILE_TYPE_CODE: 'B01',
  },
})
const stub = (data: { results?: unknown; blocks?: unknown; roads?: unknown } = {}) => {
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('/26/')
            ? (data.results ?? collection([result()]))
            : url.includes('/8/')
              ? (data.blocks ?? collection([block()]))
              : (data.roads ?? collection([road()])),
        ),
      ),
  )
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('authoritative FTEN opening footprint', () => {
  it('retains unmodified geometry and business identities without inferring completed harvest or road chronology', () => {
    const parsed = parseBcOpeningFootprints(collection([block()]), openingId, at)
    expect(parsed.records[0]).toMatchObject({
      id: 'ften-cutblock:678',
      openingId,
      cuttingPermitId: '01',
      cutBlockId: '001',
      clientNumber: '00000001',
    })
    expect(parsed.blocks[0].geometry).toEqual(geometry)
    expect(parsed.blocks[0].id).toBe('ften-cutblock:678')
    expect(parsed.blocks[0].harvestEvidence).toMatchObject({
      source: 'bc-ften',
      sourceId: 'ften-cutblock:678',
      openingId,
      startDate: '2001-01-01',
      endDate: '2001-06-01',
      yearMethod: 'estimated-range',
    })
    expect(parsed.blocks[0].harvestEvidence).not.toHaveProperty('status')
    expect(parsed.blocks[0]).not.toHaveProperty('roadEvidence')
    const query = new URL(buildBcOpeningFootprintQuery(openingId))
    expect(query.searchParams.get('f')).toBe('geojson')
    expect(query.searchParams.get('returnGeometry')).toBe('true')
    expect(query.searchParams.get('outSR')).toBe('4326')
    expect(query.searchParams.get('resultRecordCount')).toBe(String(MAX_BC_OPENING_POLYGONS + 1))
    expect(query.searchParams.has('maxAllowableOffset')).toBe(false)
  })
  it('retains multipart footprints and distinguishes partial or missing harvest dates', () => {
    const parsed = parseBcOpeningFootprints(
      collection([
        {
          ...block({ DISTURBANCE_END_DATE: null }),
          geometry: { type: 'MultiPolygon', coordinates: [geometry.coordinates, geometry.coordinates] },
        },
      ]),
      openingId,
      at,
    )
    expect(parsed.blocks.map((feature) => feature.id)).toEqual(['ften-cutblock:678-part-1', 'ften-cutblock:678-part-2'])
    expect(parsed.blocks.every((feature) => feature.harvestEvidence?.sourceId === 'ften-cutblock:678')).toBe(true)
    expect(parsed.blocks[0].harvestEvidence?.yearMethod).toBe('start-only')
    expect(
      parseBcOpeningFootprints(
        collection([block({ DISTURBANCE_START_DATE: null, DISTURBANCE_END_DATE: null })]),
        openingId,
        at,
      ).blocks[0].harvestEvidence?.yearMethod,
    ).toBe('unknown')
  })
  it('rejects unrelated, malformed, truncated, oversized and over-budget footprint responses atomically', async () => {
    expect(() => parseBcOpeningFootprints(collection([block({ OPENING_ID: 1 })]), openingId, at)).toThrow(
      /another opening/,
    )
    expect(() =>
      parseBcOpeningFootprints(
        collection([{ ...block(), geometry: { type: 'Point', coordinates: [-122.8, 53.8] } }]),
        openingId,
        at,
      ),
    ).toThrow(/polygon/)
    expect(() =>
      parseBcOpeningFootprints({ ...collection([block()]), exceededTransferLimit: true }, openingId, at),
    ).toThrow(/truncated/)
    expect(() =>
      parseBcOpeningFootprints(
        collection(Array.from({ length: MAX_BC_OPENING_POLYGONS + 1 }, (_, i) => block({ CUT_BLOCK_SKEY: 678 + i }))),
        openingId,
        at,
      ),
    ).toThrow(/25 records/)
    expect(() =>
      parseBcOpeningFootprints(
        { ...collection([block()]), crs: { type: 'name', properties: { name: 'EPSG:3005' } } },
        openingId,
        at,
      ),
    ).toThrow(/WGS84/)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/8/')
          ? new Response('{}', { headers: { 'content-length': String(MAX_BC_OPENING_POLYGON_BYTES + 1) } })
          : new Response(JSON.stringify(collection([result()]))),
      ),
    )
    await expect(loadBcOpeningFootprints(openingId)).rejects.toThrow(/too large/)
  })
})

describe('bounded real BC pilot assembly', () => {
  it('joins real-source schemas, queries around the actual polygon and saves reproducible outcomes without invented access', async () => {
    const fetcher = stub({
      roads: collection([
        road(),
        road(100, [
          [-122.819, 53.8189],
          [-122.818, 53.8189],
        ]),
      ]),
    })
    const pilot = await loadBcAccessPilot(openingId)
    expect(pilot.status).toBe('loaded')
    expect(pilot.identity.matches).toHaveLength(1)
    expect(pilot.blocks).toHaveLength(1)
    expect(pilot.roads).toHaveLength(2)
    expect(pilot.roadCandidates).toEqual([
      expect.objectContaining({
        roadId: 'ften-road-segment-99-0',
        distanceM: 0,
        sharedClient: true,
        sharedTimberMark: false,
      }),
    ])
    expect(pilot.queries.map((query) => [query.source, query.status, query.recordCount])).toEqual([
      ['results-opening', 'success', 1],
      ['ften-cutblock', 'success', 1],
      ['ften-road-segment', 'success', 2],
    ])
    expect(pilot.bounds![0]).toBeLessThan(-122.81)
    expect(pilot.bounds![2]).toBeGreaterThan(-122.8)
    const requestedRoads = new URL(fetcher.mock.calls.find(([url]) => url.includes('/21/'))![0])
    expect(requestedRoads.searchParams.get('geometry')).toBe(pilot.bounds!.join(','))
    expect(requestedRoads.searchParams.get('resultRecordCount')).toBe(String(BC_PILOT_MAX_ROADS + 1))
    expect(pilot.sources.some((source) => source.synthetic)).toBe(false)
    expect(pilot.findings.find((finding) => finding.id === 'crossing-evidence')?.text).toContain('were not queried')
    expect(pilot.findings.find((finding) => finding.id === 'road-chronology')?.text).toContain('no physical road')
    expect(pilot.roads.every((road) => road.roadEvidence?.reuseAllowed === false)).toBe(true)
    const state = parseAccessHistoryState(
      JSON.parse(JSON.stringify({ ...createAccessHistoryState(), sources: pilot.sources })),
      [...pilot.blocks, ...pilot.roads],
    )
    expect(state.sources.filter((source) => source.query)).toHaveLength(3)
    expect(state.events).toEqual([])
    expect(state.anchors).toEqual([])
    expect(state.structures).toEqual([])
    expect(state.paths).toEqual([])
  })
  it('distinguishes successful zero-row responses from skipped searches and preserves unmatched identities', async () => {
    const fetcher = stub({ blocks: collection([]) })
    const missing = await loadBcAccessPilot(openingId)
    expect(missing.status).toBe('no-block-found')
    expect(missing.identity.records).toHaveLength(1)
    expect(missing.blocks).toEqual([])
    expect(missing.bounds).toBeNull()
    expect(missing.queries.map((query) => [query.status, query.recordCount])).toEqual([
      ['success', 1],
      ['success', 0],
      ['skipped', 0],
    ])
    expect(fetcher).toHaveBeenCalledTimes(2)
    stub({ roads: collection([]) })
    const emptyRoads = await loadBcAccessPilot(openingId)
    expect(emptyRoads.status).toBe('loaded')
    expect(emptyRoads.queries[2]).toMatchObject({ status: 'success', recordCount: 0 })
    expect(emptyRoads.sources.find((source) => source.query?.source === 'ften-road-segment')?.description).toContain(
      'not evidence of absence',
    )
  })
  it('keeps business-code conflicts visible instead of accepting an inconsistent identity join', async () => {
    stub({ results: collection([result({ CUTTING_PERMIT_ID: '02' })]) })
    const pilot = await loadBcAccessPilot(openingId)
    expect(pilot.identity.matches[0].conflicts).toEqual([
      { field: 'cuttingPermitId', resultsValue: '02', ftenValue: '01' },
    ])
    expect(pilot.findings.find((finding) => finding.id === 'identity-conflicts')).toMatchObject({ kind: 'gap' })
    expect(
      pilot.sources.filter((source) => source.blockIdentity).map((source) => source.blockIdentity?.cuttingPermitId),
    ).toEqual(['02', '01'])
  })
  it('rejects source failures and truncated road searches instead of returning a partial successful pilot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/21/')
          ? new Response('{}', { status: 503 })
          : new Response(JSON.stringify(url.includes('/26/') ? collection([result()]) : collection([block()]))),
      ),
    )
    await expect(loadBcAccessPilot(openingId)).rejects.toThrow(/503/)
    stub({ roads: { ...collection([road()]), exceededTransferLimit: true } })
    await expect(loadBcAccessPilot(openingId)).rejects.toThrow(/truncated/)
    stub({ roads: collection(Array.from({ length: BC_PILOT_MAX_ROADS + 1 }, (_, i) => road(i + 1))) })
    await expect(loadBcAccessPilot(openingId)).rejects.toThrow(/250 records/)
  })
  it('rejects an opening too broad for the bounded query before requesting any roads', async () => {
    const fetcher = stub({
      blocks: collection([
        {
          ...block(),
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-123, 53],
                [-122, 53],
                [-122, 54],
                [-123, 54],
                [-123, 53],
              ],
            ],
          },
        },
      ]),
    })
    await expect(loadBcAccessPilot(openingId)).rejects.toThrow(/Zoom in/)
    expect(fetcher.mock.calls.every(([url]) => !url.includes('/21/'))).toBe(true)
  })
  it('cancels a pending road phase and times out stalled first-phase sources without returning records', async () => {
    const controller = new AbortController()
    const cancelled = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/21/')) {
          queueMicrotask(() => controller.abort(new DOMException('Cancel pilot test', 'AbortError')))
          return new Response(new ReadableStream({ cancel: cancelled }))
        }
        return new Response(JSON.stringify(url.includes('/26/') ? collection([result()]) : collection([block()])))
      }),
    )
    await expect(loadBcAccessPilot(openingId, controller.signal)).rejects.toThrow('Cancel pilot test')
    expect(cancelled).toHaveBeenCalled()
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new ReadableStream())),
    )
    const loading = loadBcAccessPilot(openingId)
    const rejection = expect(loading).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(BC_PILOT_SOURCE_TIMEOUT_MS)
    await rejection
  })
  it('versions changed query responses while retaining the identity of unchanged rechecks', () => {
    const query: HistoricalSourceQuery = {
      source: 'ften-road-segment',
      status: 'success',
      recordCount: 1,
      requestUrl: 'https://example.test/query',
      bounds: [-123, 53, -122.9, 53.1],
    }
    const first = makeHistoricalSourceQuery(query, at, [{ id: 'road1', retrievedAt: at }])
    const rechecked = makeHistoricalSourceQuery(query, '2026-11-10T12:00:00Z', [
      { id: 'road1', retrievedAt: '2026-11-10T12:00:00Z' },
    ])
    const changed = makeHistoricalSourceQuery(query, at, [{ id: 'road2', retrievedAt: at }])
    expect(first.id).toBe(rechecked.id)
    expect(first.id).not.toBe(changed.id)
    expect(first.recordId).toContain('extent:')
  })
})
