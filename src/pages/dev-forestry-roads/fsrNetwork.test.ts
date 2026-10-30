import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBcFsrRadiusQuery, buildBcRoadsQuery, importExistingRoads, parseBcExistingRoads } from './existingRoads'
import { loadNearestBcFsrs, nearestExistingRoadPoint, nearestFsrConnections } from './fsrNetwork'
import { parseProject } from './project'
import { createDemoProject } from './terrain'
import type { ContextFeature } from './types'

const origin: [number, number] = [-123, 54]
function road(id: string, offset = 0.01): ContextFeature {
  return {
    id,
    name: id,
    kind: 'existing-road',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-123.02, 54 + offset],
        [-122.98, 54 + offset],
      ],
    },
    roadEvidence: {
      source: 'bc-ften',
      sourceId: id,
      roadClass: 'fsr',
      fileTypeCode: 'B40',
      lifecycleStatus: 'ACTIVE',
      condition: 'unknown',
      conditionBasis: 'unreviewed',
      reuseAllowed: false,
    },
  }
}
const feature = (id: number, offset = 0.01) => ({
  type: 'Feature',
  geometry: road(String(id), offset).geometry,
  properties: {
    OBJECTID: id,
    ROAD_SECTION_NAME: `FSR ${id}`,
    FILE_TYPE_CODE: 'B40',
    FILE_TYPE_DESCRIPTION: 'Forest Service Road',
    LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
  },
})
const payload = (features: unknown[]) => ({ type: 'FeatureCollection', features })
afterEach(() => vi.unstubAllGlobals())

describe('FSR inventory and closest mapped centreline', () => {
  it('filters by the authoritative B40 type and active lifecycle rather than file or road names', () => {
    const url = new URL(buildBcRoadsQuery([-123.1, 53.9, -122.9, 54.1], { fsrOnly: true, activeOnly: true }))
    expect(url.searchParams.get('where')).toBe("FILE_TYPE_CODE='B40' AND LIFE_CYCLE_STATUS_CODE='ACTIVE'")
    const parsed = parseBcExistingRoads(
      payload([
        feature(1),
        {
          ...feature(2),
          properties: { ...feature(2).properties, ROAD_SECTION_NAME: 'FSR-looking permit', FILE_TYPE_CODE: 'B01' },
        },
      ]),
    )
    expect(parsed.map((r) => r.roadEvidence?.roadClass)).toEqual(['fsr', 'permit'])
    expect(parseProject({ ...createDemoProject(), context: parsed }).context[0].roadEvidence?.fileTypeCode).toBe('B40')
    const imported = importExistingRoads(payload([feature(3)]))
    expect(imported[0].roadEvidence).toMatchObject({
      source: 'user',
      roadClass: 'fsr',
      fileTypeCode: 'B40',
      reuseAllowed: false,
    })
  })
  it('projects onto a segment interior, retaining its exact line fraction', () => {
    const closest = nearestExistingRoadPoint(origin, road('fsr'))!
    expect(closest.coordinate[0]).toBeCloseTo(-123, 10)
    expect(closest.coordinate[1]).toBeCloseTo(54.01, 10)
    expect(closest.fraction).toBeCloseTo(0.5, 10)
    expect(closest.distanceM).toBeCloseTo(1111.95, 1)
    expect(closest.segmentIndex).toBe(0)
  })
  it('excludes permit, closed and retired records and deduplicates multipart source sections', () => {
    const active = road('active')
    const duplicate = { ...road('other-part', 0.02), roadEvidence: { ...active.roadEvidence! } }
    const closed = road('closed', 0.001)
    closed.roadEvidence!.condition = 'closed'
    const retired = road('retired', 0.002)
    retired.roadEvidence!.lifecycleStatus = 'RETIRED'
    const permit = road('permit', 0.003)
    permit.roadEvidence!.roadClass = 'permit'
    expect(nearestFsrConnections(origin, [duplicate, closed, retired, permit, active])).toMatchObject([
      { featureId: 'active' },
    ])
    expect(active.roadEvidence?.reuseAllowed).toBe(false)
  })
  it('expands the bounded radius, uses actual projected distance, and never claims provincial completeness', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload([]))))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload([feature(1, 0.03)]))))
    vi.stubGlobal('fetch', fetch)
    const result = await loadNearestBcFsrs(origin)
    expect(result.searchedRadiusM).toBe(5000)
    expect(result.nearest[0].distanceM).toBeGreaterThan(3000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('distance')).toBe('2000')
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('distance')).toBe('5000')
    const query = new URL(buildBcFsrRadiusQuery(origin, 10000))
    expect(query.searchParams.get('geometryType')).toBe('esriGeometryPoint')
    expect(query.searchParams.get('units')).toBe('esriSRUnit_Meter')
  })
  it('returns an explicit empty local result and obeys cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload([]))))),
    )
    expect(await loadNearestBcFsrs(origin)).toMatchObject({ roads: [], nearest: [], searchedRadiusM: 10000 })
    const controller = new AbortController()
    controller.abort()
    await expect(loadNearestBcFsrs(origin, controller.signal)).rejects.toThrow(/cancelled/)
    expect(() => buildBcFsrRadiusQuery(origin, 10001)).toThrow(/10,000/)
  })
  it('expands discovery to offer several choices even when the first radius contains one FSR', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload([feature(1)]))))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload([feature(1), feature(2, 0.02), feature(3, 0.03)]))))
    vi.stubGlobal('fetch', fetch)
    const result = await loadNearestBcFsrs(origin, undefined, 3)
    expect(result.nearest).toHaveLength(3)
    expect(result.searchedRadiusM).toBe(5000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
