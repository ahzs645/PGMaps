import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BC_HARVEST_SERVICE,
  buildHarvestHistoryQueryUrl,
  harvestAge,
  harvestAgeSummary,
  harvestHistoryStyle,
  importHarvestHistory,
  loadBcHarvestHistory,
  MAX_HARVEST_RESPONSE_BYTES,
  nearbyRoadCandidates,
  parseHarvestEvidence,
} from './harvestHistory'
import { importContextGeoJson, parseProject, projectGeoJson, serializeProject } from './project'
import { createTrainingScenario } from './scenarios'
import { createDemoProject } from './terrain'
import type { ContextFeature } from './types'

const ring = [
  [-122.01, 53],
  [-122, 53],
  [-122, 53.01],
  [-122.01, 53.01],
  [-122.01, 53],
]
const bcFeature = (properties: Record<string, unknown> = {}) => ({
  type: 'Feature',
  properties: {
    VCCB_SYSID: 4633,
    OBJECTID: 100,
    OPENING_ID: null,
    DATA_SOURCE: 'Satellite Imagery - Change Detection',
    HARVEST_START_DATE: null,
    HARVEST_END_DATE: null,
    HARVEST_START_YEAR_CALENDAR: 2003,
    HARVEST_MID_YEAR_CALENDAR: 2003,
    ...properties,
  },
  geometry: { type: 'Polygon', coordinates: [ring] },
})
const collection = (...features: unknown[]) => ({ type: 'FeatureCollection', features })
const road = (id: string, coordinates: number[][]): ContextFeature => ({
  id,
  name: id,
  kind: 'existing-road',
  geometry: { type: 'LineString', coordinates },
})
const block: ContextFeature = {
  id: 'block',
  name: 'block',
  kind: 'harvest',
  geometry: { type: 'Polygon', coordinates: [ring] },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('historical harvest evidence', () => {
  it('retains FTEN provenance without inventing a harvest completion date from a tenure polygon', () => {
    const evidence = parseHarvestEvidence({
      source: 'bc-ften',
      sourceId: 'FTEN-CUTBLOCK-123',
      openingId: '60677',
      sourceUrl: 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/forest_tenure/MapServer/0',
      retrievedAt: '2026-11-09T00:00:00Z',
      yearMethod: 'unknown',
    })
    expect(evidence.source).toBe('bc-ften')
    expect(evidence.startDate).toBeUndefined()
    expect(evidence.endYear).toBeUndefined()
    expect(harvestAgeSummary(evidence, 2026)).toBe('Harvest date unknown')
    const project = createDemoProject()
    project.context = [{ ...block, harvestEvidence: evidence }]
    expect(parseProject(serializeProject(project)).context[0].harvestEvidence).toEqual(evidence)
  })
  it('retains the unique consolidated record, source, estimated midpoint and null opening without inventing completion', () => {
    const [feature] = importHarvestHistory(collection(bcFeature()), { retrievedAt: '2026-11-07T12:00:00Z' })
    expect(feature.id).toBe('bc-harvest-4633')
    expect(feature.harvestEvidence).toEqual({
      source: 'bc-consolidated',
      status: 'harvested',
      sourceId: '4633',
      sourceUrl: BC_HARVEST_SERVICE,
      retrievedAt: '2026-11-07T12:00:00Z',
      dataSource: 'Satellite Imagery - Change Detection',
      startYear: 2003,
      midYear: 2003,
      yearMethod: 'estimated-midpoint',
    })
    expect(harvestAgeSummary(feature.harvestEvidence, 2026)).toContain('About 23 calendar years')
    expect(feature.harvestEvidence?.endYear).toBeUndefined()
  })

  it('retains explicit estimated dates and provenance and displays a range rather than midpoint as completion', () => {
    const [feature] = importHarvestHistory(
      collection(
        bcFeature({
          HARVEST_START_DATE: '2010-08-01T00:00:00Z',
          HARVEST_END_DATE: Date.parse('2012-09-15T00:00:00Z'),
          HARVEST_START_YEAR_CALENDAR: 2010,
          HARVEST_MID_YEAR_CALENDAR: 2011,
          DATA_SOURCE: 'RESULTS',
          DATA_SOURCE_DATE: '2024-01-01',
          PUBLISHED_DATE: '2024-11-01',
          AREA_HA: 12.5,
        }),
      ),
    )
    expect(feature.harvestEvidence).toMatchObject({
      startDate: '2010-08-01',
      endDate: '2012-09-15',
      startYear: 2010,
      endYear: 2012,
      midYear: 2011,
      yearMethod: 'estimated-range',
      areaHectares: 12.5,
      sourceDate: '2024-01-01',
      publishedDate: '2024-11-01',
    })
    expect(harvestAgeSummary(feature.harvestEvidence, 2026)).toContain('About 14–16 calendar years')
  })

  it('keeps undated, start-only, proposed and future evidence honest and never reads generic stand ages', () => {
    const [unknown] = importHarvestHistory({
      type: 'Feature',
      properties: { age: 90, STAND_AGE: 90, HARVEST_YEAR: 1980, FIRE_YEAR: 2020 },
      geometry: block.geometry,
    })
    expect(harvestAge(unknown.harvestEvidence, 2026)).toEqual({ kind: 'unknown' })
    expect(harvestHistoryStyle(undefined, 2026).key).toBe('unknown')
    const startOnly = parseHarvestEvidence({ source: 'user', startYear: 2010, yearMethod: 'start-only' })
    expect(harvestAgeSummary(startOnly, 2026)).toBe('Harvest started 2010 · completion unknown')
    expect(harvestHistoryStyle(startOnly, 2026).key).toBe('unknown')
    expect(harvestAgeSummary({ source: 'user', endYear: 2030, yearMethod: 'reported-year' }, 2026)).toContain(
      'after reference year',
    )
    expect(harvestHistoryStyle({ source: 'user', status: 'proposed', yearMethod: 'unknown' }, 2026).key).toBe(
      'proposed',
    )
  })

  it.each(['reported-dates', 'estimated-range'] as const)(
    'describes a %s interval spanning the reference year without changing its age classification',
    (yearMethod) => {
      const evidence = parseHarvestEvidence({
        source: 'bc-ften',
        startDate: '1988-07-01',
        endDate: '1990-06-01',
        yearMethod,
      })
      const qualification = yearMethod === 'estimated-range' ? ' (may be estimated)' : ''
      expect(harvestAgeSummary(evidence, 1989)).toBe(
        `Reported harvest interval spans reference year 1989 · completion recorded for 1990${qualification}`,
      )
      expect(harvestAgeSummary(evidence, 1988)).toBe(
        `Reported harvest interval spans reference year 1988 · completion recorded for 1990${qualification}`,
      )
      expect(harvestAgeSummary(evidence, 1987)).toBe('Harvest record is after reference year 1987')
      expect(harvestAgeSummary(evidence, 1990)).not.toContain('spans reference year')
      expect(harvestAge(evidence, 1989)).toEqual({ kind: 'future' })
      expect(harvestHistoryStyle(evidence, 1989).key).toBe('unknown')
    },
  )

  it('uses whole calendar-year colour bins and retains uncertain cross-bin intervals', () => {
    const evidence = (startYear: number, endYear = startYear) => ({
      source: 'user' as const,
      startYear,
      endYear,
      yearMethod: 'reported-year' as const,
    })
    expect(harvestHistoryStyle(evidence(2016), 2026).key).toBe('recent')
    expect(harvestHistoryStyle(evidence(2015), 2026).key).toBe('medium')
    expect(harvestHistoryStyle(evidence(1996), 2026).key).toBe('medium')
    expect(harvestHistoryStyle(evidence(1995), 2026).key).toBe('older')
    expect(harvestHistoryStyle(evidence(2015, 2017), 2026).key).toBe('unknown')
  })

  it.each([
    { startYear: 2010.5 },
    { startYear: 180 },
    { startDate: '2025-02-30' },
    { sourceDate: '2024-09-30Tnot-a-time' },
    { startYear: 2020, endYear: 2010 },
    { startYear: 2010, startDate: '2011-01-01' },
    { startYear: 2010, endYear: 2012, midYear: 2000 },
    { sourceUrl: 'javascript:alert(1)' },
    { status: 'proposed', endYear: 2020 },
    { yearMethod: 'reported-dates' },
    { yearMethod: 'reported-year' },
    { yearMethod: 'estimated-midpoint' },
    { yearMethod: 'start-only', startYear: 2000, endYear: 2001 },
    { yearMethod: 'unknown', endYear: 2001 },
  ])('rejects invalid or contradictory evidence %j', (patch) => {
    expect(() => parseHarvestEvidence({ source: 'user', yearMethod: 'unknown', ...patch })).toThrow()
  })

  it('preserves evidence and IDs through project JSON and GeoJSON import/export', () => {
    const project = createDemoProject()
    project.context = importHarvestHistory(collection(bcFeature()))
    project.harvestHistoryYear = 2026
    const restored = parseProject(serializeProject(project))
    expect(restored).toEqual(project)
    const exported = projectGeoJson(project, new Map())
    const context = { ...exported, features: exported.features.filter((f) => f.properties?.kind === 'harvest') }
    expect(importContextGeoJson(context)).toEqual(project.context)
    expect(importHarvestHistory(context)).toEqual(project.context)
    expect(() => parseProject({ ...project, harvestHistoryYear: 2026.5 })).toThrow('integer')
  })

  it('splits multipart geometries with holes, keeps stable source IDs independent of query order, and rejects duplicates', () => {
    const multipart = {
      ...bcFeature(),
      geometry: { type: 'MultiPolygon', coordinates: [[ring], [ring.map(([x, y]) => [x + 0.05, y])]] },
    }
    const parts = importHarvestHistory(collection(multipart))
    expect(parts.map((part) => part.id)).toEqual(['bc-harvest-4633-part-1', 'bc-harvest-4633-part-2'])
    const wider = importHarvestHistory(collection(bcFeature({ VCCB_SYSID: 4653 }), multipart))
    expect(wider.slice(1)).toEqual(parts)
    expect(() => importHarvestHistory(collection(bcFeature(), bcFeature()))).toThrow('unique')
  })

  it('refuses truncation, oversized geometry counts, wrong geometry or CRS, and malformed service results', () => {
    expect(() => importHarvestHistory({ ...collection(), exceededTransferLimit: true })).toThrow('record limit')
    expect(() => importHarvestHistory({ ...collection(), properties: { exceededTransferLimit: true } })).toThrow(
      'record limit',
    )
    expect(() => importHarvestHistory(collection(...Array(501).fill(bcFeature())))).toThrow('500')
    expect(() => importHarvestHistory({ type: 'LineString', coordinates: ring })).toThrow('Polygon')
    expect(() =>
      importHarvestHistory({ ...collection(), crs: { type: 'name', properties: { name: 'EPSG:3005' } } }),
    ).toThrow('WGS84')
    expect(() => importHarvestHistory({ error: { message: 'Service offline' } })).toThrow('Service offline')
  })
})

describe('bounded BC harvest loading', () => {
  it('requests actual source fields, no simplification or fabricated end-year field, within a local extent', () => {
    const query = new URL(buildHarvestHistoryQueryUrl([-122.01, 53, -122, 53.01])).searchParams
    expect(query.get('outFields')).toContain('VCCB_SYSID')
    expect(query.get('outFields')).toContain('HARVEST_END_DATE')
    expect(query.get('outFields')).not.toContain('HARVEST_END_YEAR_CALENDAR')
    expect(query.has('maxAllowableOffset')).toBe(false)
    expect(query.get('resultRecordCount')).toBe('501')
    expect(() => buildHarvestHistoryQueryUrl([-123, 53, -122, 54])).toThrow('smaller')
  })

  it('loads complete data, carries the AbortSignal and retrieval provenance, and accepts a genuinely empty area', async () => {
    const controller = new AbortController()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(collection(bcFeature()))))
      .mockResolvedValueOnce(new Response(JSON.stringify(collection())))
    vi.stubGlobal('fetch', fetch)
    const loaded = await loadBcHarvestHistory([-122.01, 53, -122, 53.01], controller.signal)
    expect(loaded[0].harvestEvidence?.retrievedAt).toMatch(/^\d{4}-/)
    expect(fetch.mock.calls[0][1]).toEqual({ signal: controller.signal })
    expect(await loadBcHarvestHistory([-122.01, 53, -122, 53.01])).toEqual([])
  })

  it('rejects oversized streaming bodies and source errors instead of returning partial rows', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('x', { headers: { 'content-length': String(MAX_HARVEST_RESPONSE_BYTES + 1) } }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(MAX_HARVEST_RESPONSE_BYTES + 1)))
    vi.stubGlobal('fetch', fetch)
    await expect(loadBcHarvestHistory([-122.01, 53, -122, 53.01])).rejects.toThrow('10 MB')
    await expect(loadBcHarvestHistory([-122.01, 53, -122, 53.01])).rejects.toThrow('10 MB')
  })
})

describe('nearby road candidates', () => {
  it('measures minimum footprint-to-line separation, including midsegment crossings and tangencies, sorted without enabling reuse', () => {
    const context = [
      road('crossing', [
        [-122.02, 53.005],
        [-121.99, 53.005],
      ]),
      road('outside', [
        [-122.012, 53.002],
        [-122.012, 53.008],
      ]),
      road('corner', [
        [-122.02, 53],
        [-122.01, 53],
      ]),
      road('far', [
        [-122.1, 53],
        [-122.1, 53.01],
      ]),
    ]
    const snapshot = JSON.stringify(context)
    const candidates = nearbyRoadCandidates(block, context, { maxDistanceM: 1000 })
    expect(candidates.map((candidate) => candidate.road.id)).toEqual(['corner', 'crossing', 'outside'])
    expect(candidates[0].distanceM).toBe(0)
    expect(candidates[1].distanceM).toBe(0)
    expect(candidates[2].distanceM).toBeGreaterThan(100)
    expect(candidates[2].distanceM).toBeLessThan(150)
    expect(JSON.stringify(context)).toBe(snapshot)
  })

  it('respects a hole; a road entirely inside the hole has positive separation from the harvested footprint', () => {
    const hole = [
      [-122.008, 53.002],
      [-122.002, 53.002],
      [-122.002, 53.008],
      [-122.008, 53.008],
      [-122.008, 53.002],
    ]
    const withHole: ContextFeature = { ...block, geometry: { type: 'Polygon', coordinates: [ring, hole] } }
    const candidate = road('hole', [
      [-122.006, 53.004],
      [-122.004, 53.006],
    ])
    expect(nearbyRoadCandidates(withHole, [candidate])[0].distanceM).toBeGreaterThan(100)
    expect(nearbyRoadCandidates(block, [candidate])[0].distanceM).toBe(0)
  })

  it('includes all parts of one source opening, without claiming a connection to another opening', () => {
    const parts = importHarvestHistory({
      ...bcFeature(),
      geometry: { type: 'MultiPolygon', coordinates: [[ring], [ring.map(([x, y]) => [x + 0.05, y])]] },
    })
    const otherPartRoad = road('other-part', [
      [-121.955, 53.003],
      [-121.955, 53.007],
    ])
    expect(nearbyRoadCandidates(parts[0], [...parts, otherPartRoad])[0].distanceM).toBe(0)
    expect(nearbyRoadCandidates({ ...parts[0], harvestEvidence: undefined }, [...parts, otherPartRoad])).toEqual([])
  })

  it('stops a pathological comparison with crop guidance rather than returning incomplete candidates', () => {
    const many = Array.from({ length: 1600 }, (_, i) => [
      -122.01 + 0.001 * Math.cos((i / 1599) * Math.PI * 2),
      53 + 0.001 * Math.sin((i / 1599) * Math.PI * 2),
    ])
    many[many.length - 1] = many[0]
    const detailed: ContextFeature = { ...block, geometry: { type: 'Polygon', coordinates: [many] } }
    const detailedRoad = road(
      'detailed',
      Array.from({ length: 1600 }, (_, i) => [-122.02, 53 + i * 0.000001]),
    )
    expect(() => nearbyRoadCandidates(detailed, [detailedRoad])).toThrow('Crop or simplify')
  })
})

describe('harvest history training scenario', () => {
  it('shows dated, estimated, unknown and proposed blocks with explicit synthetic road events and no automatic reuse', () => {
    const project = createTrainingScenario('training-harvest-history')
    expect(project.harvestHistoryYear).toBe(2026)
    expect(
      new Set(
        project.context
          .filter((feature) => feature.kind === 'harvest')
          .map((feature) => harvestHistoryStyle(feature.harvestEvidence, 2026).key),
      ),
    ).toEqual(new Set(['recent', 'medium', 'older', 'unknown', 'proposed']))
    const roads = project.context.filter((feature) => feature.kind === 'existing-road')
    expect(roads.some((feature) => feature.roadEvidence?.deactivation?.deactivatedOn === '2016-09-15')).toBe(true)
    expect(roads.every((feature) => feature.roadEvidence?.reuseAllowed === false)).toBe(true)
    expect(parseProject(serializeProject(project))).toEqual(project)
  })
})
