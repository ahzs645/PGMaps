import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACCESS_HISTORY_SOURCES,
  ACCESS_SOURCE_TIMEOUT_MS,
  blockIdentitySources,
  buildBcBlockIdentityQuery,
  buildBcRoadSegmentsQuery,
  combineBlockIdentityRecords,
  importHistoricalStructures,
  loadBcBlockIdentity,
  loadBcRoadSegments,
  MAX_IDENTITY_RESPONSE_BYTES,
  parseBcBlockIdentityRecords,
  parseBcRoadSegments,
  roadSegmentSources,
} from './accessHistorySources'
import { parseRoadEvidence, refreshedRoadEvidence, unreviewedRoadEvidence } from './existingRoadEvidence'
import { importExistingRoads, parseBcExistingRoads } from './existingRoads'
import { createAccessHistoryState, parseAccessHistoryState } from './accessHistory'

// These are invented examples; no provincial source rows are bundled with the tests.
const retrievedAt = '2026-11-08T12:00:00Z'
const line = {
  type: 'LineString',
  coordinates: [
    [-122.8, 53.8],
    [-122.79, 53.8],
  ],
}
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features })
const result = (overrides: Record<string, unknown> = {}) => ({
  attributes: {
    OPENING_ID: 321,
    FOREST_FILE_ID: 'A00001',
    CUTTING_PERMIT_ID: '01',
    CUT_BLOCK_ID: '001',
    TIMBER_MARK: 'TEST01',
    CLIENT_NUMBER: '00000001',
    DISTURBANCE_START_DATE: '2000-01-01',
    DISTURBANCE_END_DATE: '2000-03-01',
    ...overrides,
  },
})
const cutblock = (overrides: Record<string, unknown> = {}) => ({
  attributes: {
    OPENING_ID: 321,
    CUT_BLOCK_SKEY: 901,
    HARVEST_AUTH_FOREST_FILE_ID: 'A00001',
    HARVEST_AUTH_CUTTING_PERMIT_ID: '01',
    CUT_BLOCK_ID: '001',
    TIMBER_MARK: 'TEST01',
    CLIENT_NUMBER: '00000001',
    LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
    ...overrides,
  },
})
const segment = (overrides: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: line,
  properties: {
    OBJECTID: 91,
    FOREST_FILE_ID: 'R00001',
    ROAD_SECTION_ID: '01',
    START_STATION: 0,
    END_STATION: 650,
    CLIENT_NUMBER: '00000001',
    TIMBER_MARK: 'ROAD01',
    FILE_TYPE_CODE: 'B01',
    LIFE_CYCLE_STATUS_CODE: 'RETIRED',
    RETIREMENT_DATE: '2001-03-01',
    ...overrides,
  },
})
const bridge = (overrides: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-122.795, 53.8] },
  properties: {
    RRI_BMC_SP_SYSID: 1,
    CROSSING_SITE_ID: 22,
    CROSSING_STRUCTURE_NAME: 'TEST-BRIDGE',
    CROSSING_SITE_TYPE_CODE: 'CRS',
    STRUCTURE_TYPE_CLASS_CODE: 'PB',
    FOREST_FILE_ID: 'R00001',
    ROAD_SECTION_ID: '01',
    CURRENT_LOAD_RATING: 40,
    LAST_INSPECTION_DATE: '2024-08-01',
    ...overrides,
  },
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('block administrative identity crosswalk', () => {
  it('joins exact opening IDs while retaining namespaced records and leading-zero business codes', () => {
    const records = [
      ...parseBcBlockIdentityRecords(collection([result()]), 'results-opening', '321', retrievedAt),
      ...parseBcBlockIdentityRecords(collection([cutblock()]), 'ften-cutblock', '321', retrievedAt),
    ]
    const lookup = combineBlockIdentityRecords('321', records, retrievedAt)
    expect(lookup.records.map((record) => record.id)).toEqual(['results-opening:321', 'ften-cutblock:901'])
    expect(lookup.records[0]).toMatchObject({ cuttingPermitId: '01', cutBlockId: '001', clientNumber: '00000001' })
    expect(lookup.matches).toEqual([
      { resultsRecordId: 'results-opening:321', ftenRecordId: 'ften-cutblock:901', basis: 'opening-id', conflicts: [] },
    ])
    expect(lookup.missingSources).toEqual([])
    expect(blockIdentitySources(lookup)[0].description).toContain('no road service')
    expect(lookup.records[1]).not.toHaveProperty('constructionDate')
  })
  it('retains unmatched records and reports supporting-key conflicts without hiding them', () => {
    const records = parseBcBlockIdentityRecords(collection([result()]), 'results-opening', '321', retrievedAt)
    expect(combineBlockIdentityRecords('321', records).missingSources).toEqual(['ften-cutblock'])
    const tenure = parseBcBlockIdentityRecords(
      collection([cutblock({ HARVEST_AUTH_CUTTING_PERMIT_ID: '02' })]),
      'ften-cutblock',
      '321',
      retrievedAt,
    )
    expect(combineBlockIdentityRecords('321', [...records, ...tenure]).matches[0].conflicts).toEqual([
      { field: 'cuttingPermitId', resultsValue: '01', ftenValue: '02' },
    ])
    expect(combineBlockIdentityRecords('321', []).missingSources).toEqual(['results-opening', 'ften-cutblock'])
  })
  it('persists typed source snapshots and conflicts across reopening, versioning only changed facts', () => {
    const results = parseBcBlockIdentityRecords(collection([result()]), 'results-opening', '321', retrievedAt)
    const tenure = parseBcBlockIdentityRecords(
      collection([cutblock({ HARVEST_AUTH_CUTTING_PERMIT_ID: '02' })]),
      'ften-cutblock',
      '321',
      retrievedAt,
    )
    const lookup = combineBlockIdentityRecords('321', [...results, ...tenure], retrievedAt)
    const sources = blockIdentitySources(lookup)
    expect(sources[0].id).toMatch(/^results-opening:321:v[0-9a-f]+$/)
    expect(sources[0].blockIdentity).toMatchObject({
      entityId: 'results-opening:321',
      openingId: '321',
      cuttingPermitId: '01',
      cutBlockId: '001',
      clientNumber: '00000001',
      timberMark: 'TEST01',
      disturbanceStartDate: '2000-01-01',
    })
    expect(sources[0].description).toContain('Supporting business-key conflicts: cuttingPermitId')
    expect(sources[0].description).toContain('timber mark TEST01')
    expect(sources[0].description).toContain('reported disturbance 2000-01-01 to 2000-03-01')
    expect(sources[1].description).toContain('administrative lifecycle ACTIVE')
    const reopened = parseAccessHistoryState(JSON.parse(JSON.stringify({ ...createAccessHistoryState(), sources })), [])
    expect(reopened.sources).toEqual(sources)
    expect(reopened.events).toEqual([])
    const later = '2026-11-09T12:00:00Z'
    expect(
      blockIdentitySources({
        ...lookup,
        retrievedAt: later,
        records: lookup.records.map((record) => ({ ...record, retrievedAt: later })),
      }).map((source) => source.id),
    ).toEqual(sources.map((source) => source.id))
    const changedTenure = parseBcBlockIdentityRecords(collection([cutblock()]), 'ften-cutblock', '321', retrievedAt)
    const reconciled = blockIdentitySources(
      combineBlockIdentityRecords('321', [...results, ...changedTenure], retrievedAt),
    )
    expect(reconciled[0].id).not.toBe(sources[0].id)
    expect(reconciled[1].id).not.toBe(sources[1].id)
    expect(blockIdentitySources(combineBlockIdentityRecords('321', results, retrievedAt))[0].description).toContain(
      'No record returned from ften-cutblock',
    )
    const absent = blockIdentitySources(combineBlockIdentityRecords('321', [], retrievedAt))
    expect(absent).toHaveLength(1)
    expect(absent[0].description).toContain('not evidence of absence')
    expect(absent[0].blockIdentity).toBeUndefined()
  })
  it('does not treat duplicate, unrelated, truncated or service-error records as a complete lookup', () => {
    const parse = (raw: unknown) => parseBcBlockIdentityRecords(raw, 'results-opening', '321', retrievedAt)
    expect(() => parse(collection([result({ OPENING_ID: 322 })]))).toThrow(/another opening/)
    expect(() => parse(collection([result(), result()]))).toThrow(/Duplicate/)
    expect(() => parse({ ...collection([result()]), exceededTransferLimit: true })).toThrow(/truncated/)
    expect(() => parse({ ...collection([]), properties: { exceededTransferLimit: true } })).toThrow(/truncated/)
    expect(() => parse(collection(Array.from({ length: 101 }, () => result())))).toThrow(/100 records/)
    expect(() => parse({ error: { message: 'Source unavailable' } })).toThrow('Source unavailable')
  })
  it('rejects unsafe identifiers, numeric business codes and impossible or reversed dates', () => {
    for (const opening of ['1 OR 1=1', '-1', '0', '1.1', 'NaN', '99999999999999999999'])
      expect(() => buildBcBlockIdentityQuery(opening, 'results-opening')).toThrow(/identifier/)
    for (const attributes of [
      { CUTTING_PERMIT_ID: 1 },
      { FOREST_FILE_ID: 'A00001 <script>' },
      { DISTURBANCE_START_DATE: '2023-02-29' },
      { DISTURBANCE_END_DATE: '1999-01-01' },
    ])
      expect(() => parseBcBlockIdentityRecords(collection([result(attributes)]), 'results-opening', '321')).toThrow()
    const query = new URL(buildBcBlockIdentityQuery('321', 'ften-cutblock'))
    expect(query.searchParams.get('where')).toBe('OPENING_ID=321')
    expect(query.searchParams.get('returnGeometry')).toBe('false')
    expect(query.searchParams.get('resultRecordCount')).toBe('101')
    expect(query.searchParams.get('outFields')).toContain('CUT_BLOCK_SKEY')
    expect(new URL(buildBcBlockIdentityQuery('321', 'results-opening')).searchParams.has('orderByFields')).toBe(false)
  })
  it('loads both open datasets and surfaces a failure instead of substituting an empty source', async () => {
    const fetcher = vi.fn(
      async (url: string) => new Response(JSON.stringify(collection([url.includes('/26/') ? result() : cutblock()]))),
    )
    vi.stubGlobal('fetch', fetcher)
    expect((await loadBcBlockIdentity('321')).matches).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/26/')
          ? new Response('unavailable', { status: 503 })
          : new Response(JSON.stringify(collection([]))),
      ),
    )
    await expect(loadBcBlockIdentity('321')).rejects.toThrow(/503/)
  })
})

describe('bounded OGL road-segment source', () => {
  it('retains typed section identifiers through raw imports, live parsing and evidence refresh', () => {
    const road = parseBcRoadSegments(collection([segment()]), retrievedAt)[0]
    expect(road.id).toBe('ften-road-segment-91-0')
    expect(road.roadEvidence).toMatchObject({
      forestFileId: 'R00001',
      roadSectionId: '01',
      segmentStartStation: 0,
      segmentEndStation: 650,
      clientNumber: '00000001',
      timberMark: 'ROAD01',
      retirementDate: '2001-03-01',
      condition: 'unknown',
      reuseAllowed: false,
    })
    expect(road.roadEvidence).not.toHaveProperty('deactivation')
    expect(road.roadEvidence).not.toHaveProperty('constructionYear')
    expect(importExistingRoads(collection([segment()]))[0].roadEvidence?.roadSectionId).toBe('01')
    expect(parseBcExistingRoads(collection([segment()]))[0].roadEvidence?.roadSectionId).toBe('01')
    const refreshed = refreshedRoadEvidence(unreviewedRoadEvidence('bc-ften'), road.roadEvidence)
    expect(refreshed.roadSectionId).toBe('01')
    expect(roadSegmentSources([road, road])).toHaveLength(1)
  })
  it('keeps different segment rows and multipart pieces separate despite a shared permit/section', () => {
    const roads = parseBcRoadSegments(
      collection([
        segment(),
        {
          ...segment({ OBJECTID: 92 }),
          geometry: {
            type: 'MultiLineString',
            coordinates: [line.coordinates, line.coordinates],
          },
        },
      ]),
    )
    expect(roads.map((road) => road.id)).toEqual([
      'ften-road-segment-91-0',
      'ften-road-segment-92-0',
      'ften-road-segment-92-1',
    ])
    expect(roadSegmentSources(roads)).toHaveLength(2)
  })
  it('rejects bad business identifiers, stations, dates and incomplete networks', () => {
    for (const values of [
      { ROAD_SECTION_ID: 1 },
      { START_STATION: -1 },
      { END_STATION: -1 },
      { START_STATION: 700 },
      { FOREST_FILE_ID: null },
      { RETIREMENT_DATE: '2025-02-30' },
    ])
      expect(() => parseBcRoadSegments(collection([segment(values)]))).toThrow()
    expect(() => parseRoadEvidence({ ...unreviewedRoadEvidence(), clientNumber: 1 })).toThrow(/identifier as text/)
    expect(() =>
      parseRoadEvidence({
        ...unreviewedRoadEvidence(),
        roadSectionId: '01',
        segmentStartStation: 2,
        segmentEndStation: 1,
      }),
    ).toThrow(/precede/)
    expect(() => parseBcRoadSegments({ ...collection([]), exceededTransferLimit: true })).toThrow(/truncated/)
    expect(() => buildBcRoadSegmentsQuery([-123, 53, -122, 54])).toThrow(/Zoom in/)
    const query = new URL(buildBcRoadSegmentsQuery([-122.8, 53.8, -122.7, 53.9]))
    expect(query.pathname).toContain('/21/query')
    expect(query.searchParams.get('outFields')).toContain('ROAD_SECTION_ID,START_STATION,END_STATION')
    expect(query.searchParams.get('where')).toBe('1=1')
  })
  it('rejects oversized declared and streamed source responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{}', { headers: { 'content-length': String(MAX_IDENTITY_RESPONSE_BYTES + 1) } }),
        ),
    )
    await expect(loadBcBlockIdentity('321')).rejects.toThrow(/too large/)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response(' '.repeat(MAX_IDENTITY_RESPONSE_BYTES + 1)))),
    )
    await expect(loadBcBlockIdentity('321')).rejects.toThrow(/too large/)
  })
  it('cancels before loading and while a streamed source is still pending', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled test', 'AbortError'))
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(loadBcBlockIdentity('321', controller.signal)).rejects.toThrow('Cancelled test')
    expect(fetcher).not.toHaveBeenCalled()
    const streamCancelled = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel: streamCancelled }))))
    const pending = new AbortController()
    const load = loadBcRoadSegments([-122.8, 53.8, -122.7, 53.9], pending.signal)
    const rejected = expect(load).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    pending.abort()
    await rejected
    expect(streamCancelled).toHaveBeenCalled()
  })
  it('times out a stalled source without producing partial records', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream())))
    const load = loadBcRoadSegments([-122.8, 53.8, -122.7, 53.9])
    const rejected = expect(load).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(ACCESS_SOURCE_TIMEOUT_MS)
    await rejected
  })
})

describe('user-provided structure evidence', () => {
  it('keeps multiple structures at one crossing and never makes inspection dates construction dates', () => {
    const roads = parseBcRoadSegments(collection([segment()]), retrievedAt)
    const imported = importHistoricalStructures(
      collection([bridge(), bridge({ RRI_BMC_SP_SYSID: 2, CROSSING_STRUCTURE_NAME: 'TEST-SECOND' })]),
      'mof-structures',
      { context: roads, retrievedAt },
    )
    expect(imported.structures).toHaveLength(2)
    expect(imported.structures.map((structure) => structure.id)).toEqual(['mof-structures:1', 'mof-structures:2'])
    expect(imported.structures[0]).toMatchObject({
      crossingSiteId: 'rri:22',
      structureId: 'rri:TEST-BRIDGE',
      name: 'TEST-BRIDGE',
      roadId: roads[0].id,
      attachment: 'identifier-match',
      construction: null,
      removal: null,
    })
    expect(imported.structures[0].evidence[0]).toMatchObject({ ratedLoadTonnes: 40, validFrom: null, validUntil: null })
    expect(imported.sources[0].description).toContain('not a construction or rating-effective date')
    expect(imported.sources[0].description).toContain('crossing site 22; structure identifier TEST-BRIDGE')
  })
  it('refuses automatic attachment for ambiguous, differently padded or distant road keys', () => {
    const roads = parseBcRoadSegments(collection([segment(), segment({ OBJECTID: 92 })]))
    expect(
      importHistoricalStructures(collection([bridge()]), 'mof-structures', { context: roads }).structures[0].roadId,
    ).toBeNull()
    expect(
      importHistoricalStructures(collection([bridge({ ROAD_SECTION_ID: '1' })]), 'mof-structures', {
        context: roads.slice(0, 1),
      }).structures[0].roadId,
    ).toBeNull()
    const far = { ...bridge(), geometry: { type: 'Point', coordinates: [-122.795, 53.9] } }
    expect(
      importHistoricalStructures(collection([far]), 'mof-structures', { context: roads.slice(0, 1) }).structures[0]
        .roadId,
    ).toBeNull()
    expect(
      importHistoricalStructures(
        collection([
          bridge({ CROSSING_SITE_TYPE_CODE: 'STRG' }),
          bridge({ CROSSING_SITE_TYPE_CODE: 'REC' }),
          bridge({ CROSSING_SITE_TYPE_CODE: null, CROSSING_SITE_TYPE_DESC: 'Storage' }),
        ]),
        'mof-structures',
      ).structures,
    ).toEqual([])
    expect(
      importHistoricalStructures(collection([bridge({ CROSSING_SITE_TYPE_CODE: null })]), 'mof-structures', {
        context: roads.slice(0, 1),
      }).structures[0].roadId,
    ).toBeNull()
    expect(
      importHistoricalStructures(
        collection([bridge({ CROSSING_SITE_TYPE_CODE: null, CROSSING_SITE_TYPE_DESC: 'Crossing' })]),
        'mof-structures',
        { context: roads.slice(0, 1) },
      ).structures[0].roadId,
    ).toBe(roads[0].id)
  })
  it('keeps fish-passage barriers separate from vehicle restrictions and load ratings', () => {
    const assessment = {
      ...bridge(),
      properties: {
        ASSESSMENT_ID: 99,
        STREAM_CROSSING_ID: 22,
        CROSSING_SUBTYPE_CODE: 'ROUND CULVERT',
        ASSESSMENT_DATE: '2019-08-01',
        CURRENT_BARRIER_DESCRIPTION: 'Barrier',
        ROAD_TENURE: 'R00001',
      },
    }
    const imported = importHistoricalStructures(collection([assessment]), 'pscis', { retrievedAt })
    expect(imported.structures[0]).toMatchObject({
      kind: 'culvert',
      crossingSiteId: 'pscis:22',
      roadKey: null,
      roadId: null,
      evidence: [],
    })
    expect(imported.sources[0].description).toContain('This is not a vehicle closure')
  })
  it('rejects malformed dates, geometry and duplicate source rows', () => {
    expect(() =>
      importHistoricalStructures(collection([bridge({ LAST_INSPECTION_DATE: '2025-02-30' })]), 'mof-structures'),
    ).toThrow(/date/)
    expect(() => importHistoricalStructures(collection([bridge(), bridge()]), 'mof-structures')).toThrow(/Duplicate/)
    expect(() =>
      importHistoricalStructures(
        collection([{ ...bridge(), geometry: { type: 'Point', coordinates: [1200000, 900000] } }]),
        'mof-structures',
      ),
    ).toThrow(/WGS84/)
    expect(() => importHistoricalStructures({ ...collection([]), crs: {} }, 'pscis')).toThrow(/Reproject/)
    expect(() =>
      importHistoricalStructures(collection([bridge({ CURRENT_LOAD_RATING: 1001 })]), 'mof-structures'),
    ).toThrow(/1000 tonnes/)
    expect(() =>
      importHistoricalStructures(collection([bridge()]), 'mof-structures', { retrievedAt: '2026-11-08' }),
    ).toThrow(/ISO timestamp/)
    expect(() =>
      importHistoricalStructures(collection([bridge({ CROSSING_STRUCTURE_NAME: 'a'.repeat(201) })]), 'mof-structures'),
    ).toThrow(/200 characters/)
    const imported = importHistoricalStructures(collection([bridge()]), 'mof-structures', { retrievedAt })
    expect(parseAccessHistoryState({ ...createAccessHistoryState(), ...imported }, []).structures).toEqual(
      imported.structures,
    )
  })
  it('does not provide a live query route for Access Only or protected datasets', () => {
    const live = ACCESS_HISTORY_SOURCES.filter((source) => source.use === 'bounded-live-query')
    expect(live.map((source) => source.id)).toEqual(['results-opening', 'ften-cutblock', 'ften-road-segment'])
    expect(
      live.every(
        (source) => source.licence === 'Open Government Licence – British Columbia' && source.access === 'public',
      ),
    ).toBe(true)
    expect(ACCESS_HISTORY_SOURCES.find((source) => source.id === 'bcts-block-access')).toMatchObject({
      access: 'restricted',
      use: 'reference-only',
    })
  })
})
