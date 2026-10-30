import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildBcRoadsQuery, importExistingRoads, loadBcExistingRoads, parseBcExistingRoads } from './existingRoads'
import { parseProject, projectGeoJson } from './project'
import { createDemoProject } from './terrain'
import { DEFAULT_ROUTE_OPTIONS } from './routing'
import { refreshedRoadEvidence } from './existingRoadEvidence'

const line = {
  type: 'LineString',
  coordinates: [
    [-122.8, 53.8],
    [-122.79, 53.81],
  ],
}
const feature = (id = 12) => ({
  type: 'Feature',
  geometry: line,
  properties: {
    OBJECTID: id,
    FOREST_FILE_ID: 'R12345',
    ROAD_SECTION_NAME: 'East branch',
    LIFE_CYCLE_STATUS_CODE: 'RETIRED',
    FILE_STATUS_CODE: 'HC',
    AWARD_DATE: Date.UTC(1999, 0, 1),
    RETIREMENT_DATE: Date.UTC(2012, 0, 1),
  },
})
const response = (features: unknown[]) => ({ type: 'FeatureCollection', features })
afterEach(() => vi.unstubAllGlobals())

describe('BC existing-road evidence', () => {
  it('accepts an empty BC query and refreshes source facts without discarding review assumptions', () => {
    expect(parseBcExistingRoads(response([]))).toEqual([])
    const old = {
      ...parseBcExistingRoads(response([feature()]))[0].roadEvidence!,
      condition: 'rehabilitation' as const,
      conditionBasis: 'assumed' as const,
      reuseAllowed: true,
      constructionYear: 2002,
    }
    const facts = {
      ...old,
      status: 'ACTIVE',
      awardDate: '2001-01-01',
      condition: 'unknown' as const,
      conditionBasis: 'unreviewed' as const,
      reuseAllowed: false,
    }
    expect(refreshedRoadEvidence(facts, old)).toMatchObject({
      status: 'ACTIVE',
      awardDate: '2001-01-01',
      condition: 'rehabilitation',
      conditionBasis: 'assumed',
      reuseAllowed: true,
      constructionYear: 2002,
    })
  })
  it('restores explicit route assumptions and scenario loading warnings without changing older projects', () => {
    const project = createDemoProject()
    expect(parseProject(project).routeSearch).toBeUndefined()
    const routeSearch = { ...DEFAULT_ROUTE_OPTIONS, reuseExistingRoads: true, streamBufferM: 30 }
    const scenario = {
      id: 'regional-example',
      contextWarnings: ['BC road query unavailable; road context is incomplete.'],
      terrainCoveragePercent: 98.2,
    }
    const restored = parseProject({ ...project, routeSearch, scenario })
    expect(restored.routeSearch).toEqual(routeSearch)
    expect(restored.scenario).toEqual(scenario)
    expect(() => parseProject({ ...project, scenario: { ...scenario, terrainCoveragePercent: 101 } })).toThrow(
      /coverage/,
    )
    expect(() => parseProject({ ...project, routeSearch: { ...routeSearch, existingRoadCostFactor: -1 } })).toThrow()
  })
  it('retains tenure dates and status without guessing age, condition or reuse eligibility', () => {
    const roads = parseBcExistingRoads(response([feature()]), '2026-10-28T00:00:00Z')
    expect(roads[0]).toMatchObject({
      kind: 'existing-road',
      name: 'R12345 · East branch',
      geometry: line,
      roadEvidence: {
        source: 'bc-ften',
        status: 'RETIRED / HC',
        awardDate: '1999-01-01',
        retirementDate: '2012-01-01',
        condition: 'unknown',
        conditionBasis: 'unreviewed',
        reuseAllowed: false,
      },
    })
    expect(roads[0].roadEvidence?.constructionYear).toBeUndefined()
  })
  it('uses stable feature/part identifiers across differently sized queries', () => {
    expect(parseBcExistingRoads(response([feature(2), feature(12)]))[1].id).toBe(
      parseBcExistingRoads(response([feature(12)]))[0].id,
    )
    const multi = {
      ...feature(),
      geometry: { type: 'MultiLineString', coordinates: [line.coordinates, line.coordinates] },
    }
    const roads = parseBcExistingRoads(response([multi]))
    expect(new Set(roads.map((r) => r.id)).size).toBe(2)
  })
  it('rejects partial or over-budget query results instead of implying a complete road network', () => {
    expect(() => parseBcExistingRoads({ ...response([feature()]), exceededTransferLimit: true })).toThrow(/partial/)
    expect(() => parseBcExistingRoads(response(Array.from({ length: 501 }, (_, i) => feature(i))))).toThrow(/Zoom in/)
    expect(() => buildBcRoadsQuery([-123, 53, -122, 54])).toThrow(/Zoom in/)
    const query = new URL(buildBcRoadsQuery([-122.8, 53.8, -122.7, 53.9]))
    expect(query.searchParams.get('inSR')).toBe('4326')
    expect(query.searchParams.get('outFields')).toContain('AWARD_DATE')
    expect(query.searchParams.get('resultRecordCount')).toBe('501')
  })
  it('keeps explicit review assumptions in projects and GeoJSON road imports', () => {
    const road = parseBcExistingRoads(response([feature()]))[0]
    road.roadEvidence = {
      ...road.roadEvidence!,
      condition: 'rehabilitation',
      conditionBasis: 'assumed',
      reuseAllowed: true,
      constructionYear: 2002,
    }
    const project = parseProject({ ...createDemoProject(), context: [road] })
    expect(project.context[0].roadEvidence).toEqual(road.roadEvidence)
    const geojson = projectGeoJson({ ...project, alignments: [], cables: [] }, new Map())
    const imported = importExistingRoads(geojson)
    expect(imported[0].roadEvidence).toEqual(road.roadEvidence)
    expect(imported[0].geometry).toEqual(road.geometry)
  })
  it('never enables an imported unreviewed road and rejects invalid evidence or polygon roads', () => {
    expect(importExistingRoads(response([feature()]))[0].roadEvidence).toMatchObject({
      source: 'user',
      condition: 'unknown',
      reuseAllowed: false,
    })
    const road = parseBcExistingRoads(response([feature()]))[0]
    expect(() =>
      parseProject({
        ...createDemoProject(),
        context: [{ ...road, roadEvidence: { ...road.roadEvidence, condition: 'closed', reuseAllowed: true } }],
      }),
    ).toThrow(/closed/)
    expect(() =>
      importExistingRoads(response([{ ...feature(), geometry: { type: 'Polygon', coordinates: [line.coordinates] } }])),
    ).toThrow(/LineString/)
  })
  it('surfaces service errors and refuses oversized responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"message":"Service unavailable"}}')))
    await expect(loadBcExistingRoads([-122.8, 53.8, -122.7, 53.9])).rejects.toThrow('Service unavailable')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { headers: { 'content-length': String(11 * 1024 * 1024) } })),
    )
    await expect(loadBcExistingRoads([-122.8, 53.8, -122.7, 53.9])).rejects.toThrow(/too large/)
  })
})
