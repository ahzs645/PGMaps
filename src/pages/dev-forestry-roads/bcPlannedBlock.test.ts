import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCESS_HISTORY_SOURCES } from './accessHistorySources'
import { buildBcPlannedBlockQuery, loadBcPlannedBlock, parseBcPlannedBlock } from './bcPlannedBlock'

const layer = (id: string) => `${ACCESS_HISTORY_SOURCES.find((source) => source.id === id)!.serviceUrl}/`

// Invented records and geometry, shaped like an FTEN block that has no RESULTS opening yet.
const at = '2026-11-17T12:00:00Z'
const key = '870001'
const geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.52, 53.72],
      [-122.51, 53.72],
      [-122.51, 53.73],
      [-122.52, 53.73],
      [-122.52, 53.72],
    ],
  ],
}
const properties = {
  CUT_BLOCK_SKEY: 870001,
  OPENING_ID: null,
  HARVEST_AUTH_FOREST_FILE_ID: 'ATEST01',
  HARVEST_AUTH_CUTTING_PERMIT_ID: 'A01',
  CUT_BLOCK_ID: 'TST001',
  TIMBER_MARK: 'TESTA01',
  CLIENT_NUMBER: '00000001',
  LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
  BLOCK_STATUS_CODE: 'HB',
  BLOCK_STATUS_DATE: Date.UTC(2026, 9, 26),
  HARVEST_AUTH_STATUS_CODE: 'HI',
  PLANNED_HARVEST_DATE: Date.UTC(2026, 9, 19),
  PLANNED_GROSS_BLOCK_AREA: 16.7423,
  PLANNED_NET_BLOCK_AREA: 15.79,
  DISTURBANCE_START_DATE: null,
  DISTURBANCE_END_DATE: null,
}
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features })
const block = (overrides: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry,
  properties: { ...properties, ...overrides },
})
const road = {
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.53, 53.725],
      [-122.515, 53.725],
    ],
  },
  properties: {
    OBJECTID: 7,
    FOREST_FILE_ID: 'RTEST01',
    ROAD_SECTION_ID: '01',
    CLIENT_NUMBER: '00000001',
    START_STATION: 0,
    END_STATION: 1.5,
    LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
    FILE_TYPE_CODE: 'B01',
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('FTEN block with no opening ID', () => {
  it('asks the configured cutblock layer for exactly one key', () => {
    const url = new URL(buildBcPlannedBlockQuery(key))
    expect(url.href.startsWith(`${layer('ften-cutblock')}query?`)).toBe(true)
    expect(url.searchParams.get('where')).toBe('CUT_BLOCK_SKEY=870001')
    expect(url.searchParams.get('outFields')).toContain('PLANNED_GROSS_BLOCK_AREA')
    expect(() => buildBcPlannedBlockQuery('0')).toThrow(/positive integer/)
    expect(() => buildBcPlannedBlockQuery('1 OR 1=1')).toThrow(/positive integer/)
  })

  it('keeps the source identity and status codes, and marks an unharvested block proposed', () => {
    const { record, blocks } = parseBcPlannedBlock(collection([block()]), key, at)
    expect(record).toMatchObject({
      id: 'ften-cutblock:870001',
      cutblockSKey: key,
      cutBlockId: 'TST001',
      forestFileId: 'ATEST01',
      cuttingPermitId: 'A01',
      blockStatusCode: 'HB',
      harvestAuthStatusCode: 'HI',
      blockStatusDate: '2026-10-26',
      plannedHarvestDate: '2026-10-19',
      plannedGrossAreaHa: 16.74,
      plannedNetAreaHa: 15.79,
    })
    expect(record.reportedOpeningId).toBeUndefined()
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ id: 'ften-cutblock:870001', kind: 'harvest' })
    expect(blocks[0].harvestEvidence).toMatchObject({
      source: 'bc-ften',
      status: 'proposed',
      sourceId: 'ften-cutblock:870001',
      yearMethod: 'unknown',
      areaHectares: 16.74,
    })
    expect(blocks[0].harvestEvidence?.startDate).toBeUndefined()
    expect(blocks[0].harvestEvidence?.dataSource).toMatch(/no RESULTS opening ID.*not a harvest authorization/)
  })

  it('keeps a reported harvest start as harvested rather than dropping it from a proposed block', () => {
    const { blocks } = parseBcPlannedBlock(collection([block({ DISTURBANCE_START_DATE: '2026-11-01' })]), key, at)
    expect(blocks[0].harvestEvidence).toMatchObject({
      status: 'harvested',
      startDate: '2026-11-01',
      yearMethod: 'start-only',
    })
  })

  it('keeps a zero or negative opening as reported and sends a positive one to its study', () => {
    expect(parseBcPlannedBlock(collection([block({ OPENING_ID: -5 })]), key, at).record.reportedOpeningId).toBe('-5')
    expect(() => parseBcPlannedBlock(collection([block({ OPENING_ID: 60677 })]), key, at)).toThrow(
      /opening 60677\. Open its study/,
    )
  })

  it('refuses a missing, duplicated, different or non-polygon record', () => {
    expect(() => parseBcPlannedBlock(collection([]), key, at)).toThrow(/No FTEN cutblock record has key/)
    expect(() => parseBcPlannedBlock(collection([block(), block()]), key, at)).toThrow(/more than one/)
    expect(() => parseBcPlannedBlock(collection([block({ CUT_BLOCK_SKEY: 1 })]), key, at)).toThrow(/different/)
    expect(() => parseBcPlannedBlock(collection([{ ...block(), geometry: road.geometry }]), key, at)).toThrow(/polygon/)
    expect(() => parseBcPlannedBlock({ error: { message: 'Service down' } }, key, at)).toThrow('Service down')
    expect(() => parseBcPlannedBlock(collection([block({ PLANNED_GROSS_BLOCK_AREA: -1 })]), key, at)).toThrow(
      /planned gross/,
    )
  })

  it('loads the block, then roads around its own footprint, with the gaps it cannot close', async () => {
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(JSON.stringify(url.includes(layer('ften-cutblock')) ? collection([block()]) : collection([road]))),
    )
    vi.stubGlobal('fetch', fetcher)
    const loaded = await loadBcPlannedBlock(key)
    expect(fetcher).toHaveBeenCalledTimes(2)
    const roadRequest = new URL(fetcher.mock.calls[1][0])
    expect(roadRequest.href.startsWith(`${layer('ften-road-segment')}query?`)).toBe(true)
    const [west, south, east, north] = loaded.bounds
    expect(west).toBeLessThan(-122.52)
    expect(east).toBeGreaterThan(-122.51)
    expect(south).toBeLessThan(53.72)
    expect(north).toBeGreaterThan(53.73)
    expect(loaded.blocks).toHaveLength(1)
    expect(loaded.roads).toHaveLength(1)
    expect(loaded.warnings).toHaveLength(3)
    expect(loaded.warnings[0]).toMatch(/no RESULTS opening ID.*block status HB/)
    expect(loaded.warnings[1]).toMatch(/candidate connection/)
    expect(loaded.warnings[2]).toMatch(/Forest Operations Map/)
  })

  it('says that no returned road is not evidence of no road, and opens nothing when a request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(JSON.stringify(url.includes(layer('ften-cutblock')) ? collection([block()]) : collection([]))),
      ),
    )
    expect((await loadBcPlannedBlock(key)).warnings[1]).toMatch(/not evidence that no road exists/)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes(layer('ften-cutblock'))
          ? new Response(JSON.stringify(collection([block()])))
          : new Response(JSON.stringify({ error: { message: 'Road service down' } })),
      ),
    )
    await expect(loadBcPlannedBlock(key)).rejects.toThrow(/Road service down/)
  })
})
