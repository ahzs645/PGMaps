import { describe, expect, it } from 'vitest'
import {
  gravelArcgisUrl,
  gravelCandidateUrl,
  importGravelCandidates,
  loadGravelCandidates,
  parseGravelCandidates,
} from './gravelCandidates'

const feature = {
  type: 'Feature',
  id: 'pit-1',
  properties: {
    FOREST_FILE_ID: 'S123',
    MAP_LABEL: 'Example',
    SPECIAL_USE_DESCRIPTION: 'Gravel Pit, Rock Quarry',
    LIFE_CYCLE_STATUS_CODE: 'ACTIVE',
    FILE_STATUS_CODE: 'HI',
  },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-123, 53],
        [-122.99, 53],
        [-122.99, 53.01],
        [-123, 53],
      ],
    ],
  },
}
const collection = { type: 'FeatureCollection', numberMatched: 1, numberReturned: 1, features: [feature] }

describe('bounded BC gravel candidate discovery', () => {
  it('uses a longitude-first CQL bbox and gravel/quarry filters', () => {
    const query = new URL(
      gravelCandidateUrl([
        [-123, 53],
        [-122.99, 53.01],
      ]),
    ).searchParams
    expect(query.has('bbox')).toBe(false)
    expect(query.get('CQL_FILTER')).toContain("SPECIAL_USE_DESCRIPTION IN ('Gravel Pit, Rock Quarry','Quarrying')")
    expect(query.get('CQL_FILTER')).toMatch(/BBOX\(GEOMETRY,-123\./)
    expect(query.get('count')).toBe('101')
    expect(() =>
      gravelCandidateUrl([
        [-123, 53],
        [-121, 54],
      ]),
    ).toThrow(/30 km/)
    const arc = new URL(gravelArcgisUrl([[-123, 53]]))
    expect(arc.pathname).toContain('/615/query')
    expect(arc.searchParams.get('geometryType')).toBe('esriGeometryEnvelope')
    expect(arc.searchParams.get('inSR')).toBe('4326')
  })
  it('preserves lifecycle evidence without inventing supply price, capacity or permission', () => {
    const candidate = parseGravelCandidates(collection)[0]
    expect(candidate.fileId).toBe('S123')
    expect(candidate.status).toBe('ACTIVE / HI')
    expect(candidate.coordinate[0]).toBeCloseTo(-122.995)
    expect(candidate).not.toHaveProperty('price')
    expect(candidate).not.toHaveProperty('available')
    expect(importGravelCandidates(JSON.stringify({ type: 'FeatureCollection', features: [feature] }))).toEqual([
      candidate,
    ])
  })
  it('rejects truncated results, invalid geometry and missing advertised counts', () => {
    expect(() => parseGravelCandidates({ ...collection, numberMatched: 2 })).toThrow(/incomplete/)
    expect(() => parseGravelCandidates({ ...collection, numberMatched: undefined })).toThrow(/incomplete/)
    expect(() =>
      parseGravelCandidates({
        ...collection,
        features: [{ ...feature, geometry: { type: 'Polygon', coordinates: [[[-123, NaN]]] } }],
      }),
    ).toThrow(/invalid coordinates/)
  })
  it('makes browser CORS/network failures explicit and supports the manual export path', async () => {
    const failed = (async () => {
      throw Error('Failed to fetch')
    }) as typeof fetch
    await expect(loadGravelCandidates([[-123, 53]], failed)).rejects.toThrow(/GeoJSON export/)
  })
  it('reads ArcGIS results while rejecting transfer-limited or oversized responses', async () => {
    const source = (async () =>
      new Response(JSON.stringify({ type: 'FeatureCollection', features: [feature] }))) as typeof fetch
    expect(await loadGravelCandidates([[-123, 53]], source)).toHaveLength(1)
    const truncated = (async () =>
      new Response(
        JSON.stringify({ type: 'FeatureCollection', features: [feature], exceededTransferLimit: true }),
      )) as typeof fetch
    await expect(loadGravelCandidates([[-123, 53]], truncated)).rejects.toThrow(/service limit/)
    const oversized = (async () => new Response('x'.repeat(4 * 1024 * 1024 + 1))) as typeof fetch
    await expect(loadGravelCandidates([[-123, 53]], oversized)).rejects.toThrow(/4 MB/)
  })
})
