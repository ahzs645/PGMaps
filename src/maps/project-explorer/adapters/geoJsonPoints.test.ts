import { describe, expect, it } from 'vitest'

import { normalizeProjectPackage } from '@/lib/projectPackages'

import rawPackage from '../../../../public/data/projects/ecolens.json'
import { filterResearchRecords } from './filterResearchRecords'
import { normalizeGeoJsonPoints } from './geoJsonPoints'

const pin = (id: string, url: string) => ({
  type: 'Feature' as const,
  id,
  geometry: { type: 'Point' as const, coordinates: [-123, 49] },
  properties: { title: id, region: 'mainland-southwest', tags: ['air-quality'], month: '2026-11', url },
})

describe('GeoJSON points explorer', () => {
  it('loads a bundled project and preserves overlapping stories, filters, and HTTPS source links', () => {
    const workspace = normalizeProjectPackage(rawPackage)?.workspace
    expect(workspace?.type).toBe('map-explorer')
    if (workspace?.type !== 'map-explorer') throw new Error('EcoLens explorer configuration is missing')
    expect(workspace.data).toMatchObject({ adapter: 'geojson-points-v1', url: '/data/ecolens/story-pins.geojson' })

    const url = 'https://ecolens.ca/explore/abnormal-moss/'
    const [overview, records, locations] = normalizeGeoJsonPoints(
      { type: 'FeatureCollection', features: [pin('Moss', url), pin('Smoke', 'javascript:alert(1)')] },
      workspace.data.categories,
    )
    expect(overview.submissionsTotal).toBe(2)
    expect(overview.yearRange).toEqual({ min: 2026, max: 2026 })
    expect(locations[0]).toMatchObject({ id: 'Moss', coordinates: { lon: -123, lat: 49 }, source: { url } })
    expect(locations[1].source).toBeUndefined()
    expect(filterResearchRecords(records, 'air quality', new Set(['mainland-southwest']), ['tags'])).toHaveLength(2)
    expect(filterResearchRecords(records, 'air quality', new Set(['outside-bc']), ['tags'])).toHaveLength(0)
  })

  it('rejects duplicate feature IDs and invalid project source URLs', () => {
    const feature = pin('Moss', 'https://ecolens.ca/explore/abnormal-moss/')
    expect(() => normalizeGeoJsonPoints({ type: 'FeatureCollection', features: [feature, feature] }, [])).toThrow(
      'invalid or duplicate',
    )
    const workspace = { ...rawPackage.workspace, data: { ...rawPackage.workspace.data, url: '//example.org/pins' } }
    expect(normalizeProjectPackage({ ...rawPackage, workspace })?.workspace).toBeUndefined()
  })
})
