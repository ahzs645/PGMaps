import { describe, expect, it } from 'vitest'
import { filterSites, type SiteCollection } from './data'

const data: SiteCollection = { type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.7, 53.9] }, properties: { siteId: 123, name: 'Former depot', address: 'Main Street, Prince George', description: 'Unverified location', victoriaFile: '26250-20/123', regionalFile: null } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-123.1, 49.2] }, properties: { siteId: 456, name: null, address: null, description: null, victoriaFile: null, regionalFile: null } },
] }

describe('remediation site search', () => {
  it('matches case-insensitive terms across name and address', () => {
    expect(filterSites(data, 'DEPOT george').features.map((f) => f.properties.siteId)).toEqual([123])
  })
  it('searches registry IDs and file numbers with missing text fields', () => {
    expect(filterSites(data, '456').features).toHaveLength(1)
    expect(filterSites(data, '26250-20/123').features).toHaveLength(1)
    expect(filterSites(data, 'not a site').features).toHaveLength(0)
  })
  it('restores all features without modifying their geometry or properties', () => {
    expect(filterSites(data, '   ')).toBe(data)
    expect(filterSites(data, '123').features[0]).toBe(data.features[0])
    expect(data.features).toHaveLength(2)
  })
})
