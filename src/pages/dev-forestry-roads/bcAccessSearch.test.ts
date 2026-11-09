import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BC_CUTBLOCK_SEARCH_MAX_BYTES,
  BC_CUTBLOCK_SEARCH_MAX_LIMIT,
  BC_CUTBLOCK_SEARCH_TIMEOUT_MS,
  buildBcCutblockSearchQuery,
  normalizeBcCutblockSearchFilters,
  parseBcCutblockSearch,
  searchBcCutblocks,
} from './bcAccessSearch'

// Invented identifiers and geometry; no provincial extract is a test fixture.
const at = '2026-11-09T12:00:00Z'
const geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.8, 53.8],
      [-122.79, 53.8],
      [-122.79, 53.81],
      [-122.8, 53.81],
      [-122.8, 53.8],
    ],
  ],
}
const feature = (key = 1, overrides: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry,
  properties: {
    CUT_BLOCK_SKEY: key,
    OPENING_ID: 12345,
    HARVEST_AUTH_FOREST_FILE_ID: 'ATEST01',
    HARVEST_AUTH_CUTTING_PERMIT_ID: '01',
    CUT_BLOCK_ID: '001',
    TIMBER_MARK: 'TEST01',
    CLIENT_NUMBER: '00000001',
    LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
    DISTURBANCE_START_DATE: '2001-01-01',
    DISTURBANCE_END_DATE: '2001-06-01',
    ...overrides,
  },
})
const collection = (features: unknown[], properties?: Record<string, unknown>) => ({
  type: 'FeatureCollection',
  features,
  ...(properties ? { properties } : {}),
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('bounded cutblock discovery', () => {
  it('generates exact whitelisted filters and preserves leading-zero business identifiers', () => {
    const query = new URL(
      buildBcCutblockSearchQuery({
        openingId: '0012345',
        forestFileId: ' atest01 ',
        cuttingPermitId: '01',
        cutBlockId: '001',
        timberMark: 'test01',
        limit: 10,
      }),
    )
    expect(query.searchParams.get('where')).toBe(
      "OPENING_ID=12345 AND HARVEST_AUTH_FOREST_FILE_ID='ATEST01' AND HARVEST_AUTH_CUTTING_PERMIT_ID='01' AND CUT_BLOCK_ID='001' AND TIMBER_MARK='TEST01'",
    )
    expect(query.searchParams.get('orderByFields')).toBe('CUT_BLOCK_SKEY')
    expect(query.searchParams.get('resultRecordCount')).toBe('11')
    expect(query.searchParams.get('outSR')).toBe('4326')
    expect(query.searchParams.has('maxAllowableOffset')).toBe(false)
    expect(query.searchParams.has('resultOffset')).toBe(false)
  })
  it('rejects free-form expressions, unsupported inputs, empty searches and broad or malformed extents before fetching', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    for (const filters of [
      {},
      { forestFileId: "ATEST01' OR 1=1--" },
      { timberMark: '%' },
      { cuttingPermitId: '01 OR 02' },
      { openingId: '-1' },
      { openingId: '1.5' },
      { openingId: '9007199254740993' },
      { forestFileId: 'ATEST01', limit: 0 },
      { forestFileId: 'ATEST01', limit: BC_CUTBLOCK_SEARCH_MAX_LIMIT + 1 },
      { bounds: [-123, 53, -121, 54] },
      { bounds: [-122.8, 53.8, -122.9, 53.9] },
      { bounds: [-122.8, 53.8, -122.7] },
      { where: '1=1' },
      { forestFileId: 123 },
    ]) {
      await expect(searchBcCutblocks(filters as Parameters<typeof searchBcCutblocks>[0])).rejects.toThrow()
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('retains a small area exactly instead of widening or clipping its bounds', () => {
    const filters = normalizeBcCutblockSearchFilters({ bounds: [-122.81, 53.79, -122.78, 53.82] })
    expect(filters.bounds).toEqual([-122.81, 53.79, -122.78, 53.82])
    const query = new URL(buildBcCutblockSearchQuery(filters))
    expect(query.searchParams.get('where')).toBe('1=1')
    expect(query.searchParams.get('geometry')).toBe('-122.81,53.79,-122.78,53.82')
    expect(query.searchParams.get('spatialRel')).toBe('esriSpatialRelIntersects')
  })
  it('keeps separate source identities sharing one opening and derives envelopes without retaining a geometry extract', () => {
    const result = parseBcCutblockSearch(collection([feature(10), feature(2)]), { forestFileId: 'ATEST01' }, at)
    expect(result.records.map((record) => record.id)).toEqual(['ften-cutblock:2', 'ften-cutblock:10'])
    expect(result.records[0]).toMatchObject({
      openingId: '12345',
      cuttingPermitId: '01',
      cutBlockId: '001',
      clientNumber: '00000001',
      disturbanceStartDate: '2001-01-01',
      disturbanceEndDate: '2001-06-01',
      bounds: [-122.8, 53.8, -122.79, 53.81],
    })
    expect(result.records[0]).not.toHaveProperty('geometry')
    expect(result.query.retrievedAt).toBe(at)
    expect(result.query.requestUrl).toBe(buildBcCutblockSearchQuery({ forestFileId: 'ATEST01' }))
    expect(result).toMatchObject({ returnedCount: 2, matchedCountLowerBound: 2, hasMore: false })
  })
  it('reports a capped discovery page explicitly, using its extra row and service flags without claiming a total', () => {
    const result = parseBcCutblockSearch(
      collection([feature(1), feature(2), feature(3)]),
      { forestFileId: 'ATEST01', limit: 2 },
      at,
    )
    expect(result).toMatchObject({ returnedCount: 2, matchedCountLowerBound: 3, hasMore: true })
    expect(result.records.map((record) => record.cutblockSKey)).toEqual(['1', '2'])
    const flagged = parseBcCutblockSearch(
      collection([feature()], { exceededTransferLimit: true }),
      { forestFileId: 'ATEST01' },
      at,
    )
    expect(flagged).toMatchObject({ returnedCount: 1, matchedCountLowerBound: 2, hasMore: true })
    expect(() =>
      parseBcCutblockSearch(
        collection([feature()], { exceededTransferLimit: 'true' }),
        { forestFileId: 'ATEST01' },
        at,
      ),
    ).toThrow(/transfer-limit/)
    expect(() =>
      parseBcCutblockSearch(
        collection([feature(1), feature(2), feature(3)]),
        { forestFileId: 'ATEST01', limit: 1 },
        at,
      ),
    ).toThrow(/record budget/)
  })
  it('retains missing opening IDs, absent geometry and unknown dates without fabricating a loadable opening or harvest year', () => {
    const missing = {
      ...feature(1, { OPENING_ID: null, DISTURBANCE_START_DATE: null, DISTURBANCE_END_DATE: null }),
      geometry: null,
    }
    const result = parseBcCutblockSearch(collection([missing]), { forestFileId: 'ATEST01' }, at)
    expect(result.records[0]).toMatchObject({ openingId: null, bounds: null })
    expect(result.records[0]).not.toHaveProperty('disturbanceStartDate')
    expect(result.records[0]).not.toHaveProperty('disturbanceEndDate')
  })
  it('preserves negative legacy opening values as source facts without dropping the other searchable rows', () => {
    const result = parseBcCutblockSearch(
      collection([feature(1, { OPENING_ID: -123450000 }), feature(2, { OPENING_ID: 0 }), feature(3)]),
      { forestFileId: 'ATEST01' },
      at,
    )
    expect(result.returnedCount).toBe(3)
    expect(result.records[0]).toMatchObject({ id: 'ften-cutblock:1', openingId: null, reportedOpeningId: '-123450000' })
    expect(result.records[0].studyUnavailableReason).toContain('positive RESULTS opening ID')
    expect(result.records[1]).toMatchObject({ id: 'ften-cutblock:2', openingId: null, reportedOpeningId: '0' })
    expect(result.records[2]).toMatchObject({ id: 'ften-cutblock:3', openingId: '12345' })
    expect(result.records[2]).not.toHaveProperty('studyUnavailableReason')
  })
  it('validates returned identity, dates, geometry and duplicates rather than accepting unrelated records', () => {
    for (const record of [
      feature(1, { OPENING_ID: -1.5 }),
      feature(1, { CUT_BLOCK_SKEY: 0 }),
      feature(1, { DISTURBANCE_START_DATE: '2001-02-30' }),
      feature(1, { DISTURBANCE_END_DATE: '2000-01-01' }),
      feature(1, { HARVEST_AUTH_FOREST_FILE_ID: 'OTHER' }),
      feature(1, { CLIENT_NUMBER: 1 }),
      { ...feature(), geometry: { type: 'Point', coordinates: [-122.8, 53.8] } },
      {
        ...feature(),
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-122.8, 53.8],
              [-122.79, 53.8],
              [-122.79, 53.81],
              [-122.8, 53.81],
            ],
          ],
        },
      },
    ])
      expect(() => parseBcCutblockSearch(collection([record]), { forestFileId: 'ATEST01' }, at)).toThrow()
    expect(() => parseBcCutblockSearch(collection([feature(), feature()]), { forestFileId: 'ATEST01' }, at)).toThrow(
      /Duplicate/,
    )
    expect(() => parseBcCutblockSearch(collection([feature()]), { openingId: '12346' }, at)).toThrow(/another opening/)
    expect(() => parseBcCutblockSearch(collection([feature()]), { bounds: [-122.7, 53.8, -122.6, 53.9] }, at)).toThrow(
      /outside the search envelope/,
    )
    expect(() => parseBcCutblockSearch({ ...collection([]), crs: {} }, { forestFileId: 'ATEST01' }, at)).toThrow(
      /WGS84/,
    )
  })
  it('distinguishes a successful zero-row query from HTTP or service failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(collection([]))))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Invalid source query' } })))
    vi.stubGlobal('fetch', fetcher)
    expect(await searchBcCutblocks({ timberMark: 'TEST01' })).toMatchObject({
      records: [],
      returnedCount: 0,
      hasMore: false,
      matchedCountLowerBound: 0,
    })
    await expect(searchBcCutblocks({ timberMark: 'TEST01' })).rejects.toThrow(/503/)
    await expect(searchBcCutblocks({ timberMark: 'TEST01' })).rejects.toThrow(/Invalid source query/)
  })
  it('cancels an oversized response and aborts a hanging request within the discovery budget', async () => {
    const cancel = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream({ cancel }), {
          headers: { 'content-length': String(BC_CUTBLOCK_SEARCH_MAX_BYTES + 1) },
        }),
      ),
    )
    await expect(searchBcCutblocks({ forestFileId: 'ATEST01' })).rejects.toThrow(/too large/)
    expect(cancel).toHaveBeenCalledOnce()
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          ),
      ),
    )
    const pending = expect(searchBcCutblocks({ forestFileId: 'ATEST01' })).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(BC_CUTBLOCK_SEARCH_TIMEOUT_MS)
    await pending
  })
  it('honors cancellation before a request and while reading a response', async () => {
    const cancelled = new AbortController()
    cancelled.abort(new Error('Closed discovery'))
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(searchBcCutblocks({ forestFileId: 'ATEST01' }, cancelled.signal)).rejects.toThrow(/Closed discovery/)
    expect(fetcher).not.toHaveBeenCalled()
    const controller = new AbortController(),
      cancel = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        const response = new Response(new ReadableStream({ cancel }))
        queueMicrotask(() => controller.abort(new Error('Cancelled result')))
        return response
      }),
    )
    await expect(searchBcCutblocks({ forestFileId: 'ATEST01' }, controller.signal)).rejects.toThrow(/Cancelled result/)
    expect(cancel).toHaveBeenCalledOnce()
  })
})
