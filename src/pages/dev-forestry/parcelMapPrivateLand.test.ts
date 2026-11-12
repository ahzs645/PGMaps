import { describe, expect, it, vi } from 'vitest'
import {
  fetchPrivateParcels,
  parcelMaskFields,
  parsePrivateParcels,
  privateParcelQueryUrl,
} from './parcelMapPrivateLand'

const square: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.6, 53.9],
      [-122.59, 53.9],
      [-122.59, 53.91],
      [-122.6, 53.91],
      [-122.6, 53.9],
    ],
  ],
}
const feature = (properties: Record<string, unknown>, geometry: unknown = square) => ({
  type: 'Feature',
  geometry,
  properties,
})

describe('private land from ParcelMap BC', () => {
  it('puts the box in the CQL filter, longitude first, and asks only for private parcels', () => {
    const url = new URL(privateParcelQueryUrl([-122.65, 53.86, -122.45, 53.95]))
    expect(url.searchParams.get('bbox')).toBeNull()
    expect(url.searchParams.get('CQL_FILTER')).toBe(
      "OWNER_TYPE='Private' AND BBOX(SHAPE,-122.65,53.86,-122.45,53.95,'EPSG:4326')",
    )
    expect(url.searchParams.get('propertyName')).not.toContain('OWNER_NAME')
    expect(() => privateParcelQueryUrl([-123, 53, -122, 54])).toThrow(/too large/)
    expect(() => privateParcelQueryUrl([1, 1, 1, 1])).toThrow()
  })

  it('keeps private polygons with area and names the mask from the PID', () => {
    const { parcels, truncated } = parsePrivateParcels({
      features: [
        feature({
          PARCEL_FABRIC_POLY_ID: 7,
          PID_FORMATTED: '012-345-678',
          OWNER_TYPE: 'Private',
          PARCEL_CLASS: 'Subdivision',
        }),
        feature({ PARCEL_FABRIC_POLY_ID: 8, OWNER_TYPE: 'Crown Provincial' }),
        feature({ PARCEL_FABRIC_POLY_ID: 9, OWNER_TYPE: 'Private' }, { type: 'Point', coordinates: [0, 0] }),
      ],
      numberMatched: 3,
    })
    expect(parcels).toHaveLength(1)
    expect(truncated).toBe(true)
    expect(parcels[0]).toMatchObject({ id: '7', pid: '012-345-678' })
    expect(parcels[0].areaMeters).toBeGreaterThan(50_000)
    expect(parcelMaskFields(parcels[0])).toEqual({
      name: 'Private land, PID 012-345-678',
      source: 'ParcelMap BC parcel fabric (DataBC WFS), parcel 7, Subdivision; added by the reviewer',
    })
    expect(parsePrivateParcels(null)).toEqual({ parcels: [], truncated: false })
  })

  it('reports a refused query as an error, never as no private land', async () => {
    const refuse = vi.fn(async () => new Response(JSON.stringify({ exceptions: ['bad'] }), { status: 200 }))
    await expect(fetchPrivateParcels([-122.65, 53.86, -122.45, 53.95], refuse)).rejects.toThrow(/refused/)
    const down = vi.fn(async () => new Response('', { status: 503 }))
    await expect(fetchPrivateParcels([-122.65, 53.86, -122.45, 53.95], down)).rejects.toThrow(/503/)
  })
})
