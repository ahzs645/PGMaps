import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'
import {
  CRS_OPTION_GROUPS,
  crsDefinition,
  csrsUtmZone,
  epsgCode,
  isMetricCrs,
  projectedCrsDefinition,
  projectionDefinition,
} from './projectedCrs'
import { toWgs84 } from '@/features/lidar-restoration/outputs'
import { castorToLonLat } from '@/features/forestry-castor/outputs'
import type { CastorProject } from '@/features/forestry-castor/types'

const lonAt = (epsg: number, x: number, y = 6_000_000) => proj4(projectionDefinition(epsg), 'EPSG:4326', [x, y])[0]

describe('shared projected CRS definitions', () => {
  it('maps the non-contiguous NAD83(CSRS) UTM codes to their real zones', () => {
    expect([2955, 2956, 2957, 3154, 3155, 3156, 3157, 3158, 3159, 3160].map(csrsUtmZone)).toEqual([
      11, 12, 13, 7, 8, 9, 10, 14, 15, 16,
    ])
    expect(csrsUtmZone(3161)).toBeNull()
    expect(isMetricCrs(3161)).toBe(false)
    // Central meridian of UTM zone z is 6z − 183°.
    for (const epsg of [2955, 2957, 3154, 3157, 3158, 3160])
      expect(lonAt(epsg, 500_000)).toBeCloseTo(6 * csrsUtmZone(epsg)! - 183, 3)
    for (const epsg of [26907, 26911, 32610]) expect(lonAt(epsg, 500_000)).toBeCloseTo(6 * (epsg % 100) - 183, 3)
    expect(proj4(projectionDefinition(32710), 'EPSG:4326', [500_000, 9_000_000])[1]).toBeLessThan(0)
  })
  it('places BC Albers with its 1,000,000 m false easting', () => {
    // Central meridian −126° is at x = 1,000,000 m, not x = 0.
    expect(lonAt(3005, 1_000_000, 1_000_000)).toBeCloseTo(-126, 6)
    expect(toWgs84(3005, [1_000_000, 1_000_000])[0]).toBeCloseTo(-126, 6)
    const castor = castorToLonLat({ crs: 'EPSG:3005' } as unknown as CastorProject)!
    expect(castor([1_000_000, 1_000_000])[0]).toBeCloseTo(-126, 6)
  })
  it('uses one definition per code for every caller and lists only codes it supports', () => {
    expect(projectedCrsDefinition(3157)).toContain('+towgs84=-0.991')
    expect(projectedCrsDefinition(4326)).toBeNull()
    expect(crsDefinition(4326)).toBe('EPSG:4326')
    expect(crsDefinition(3857)).toBe('EPSG:3857')
    expect(crsDefinition(2154)).toBeNull()
    expect(() => projectionDefinition(2154)).toThrow(/Unsupported projected CRS/)
    expect(epsgCode(' epsg:3005 ')).toBe(3005)
    expect(epsgCode('urn:ogc:def:crs:EPSG::3005')).toBeNull()
    const codes = CRS_OPTION_GROUPS.flatMap((g) => g.options.map((o) => epsgCode(o.value)!))
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(crsDefinition(code)).not.toBeNull()
    for (const code of [
      3005, 2955, 2956, 2957, 3154, 3155, 3156, 3157, 3158, 3159, 3160, 26910, 32610, 32710, 4326, 3857,
    ])
      expect(codes).toContain(code)
  })
})
