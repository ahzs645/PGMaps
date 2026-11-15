import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'

import {
  formatCoordinate,
  formatDdm,
  formatDecimalDegrees,
  formatDms,
  formatLatLngPlain,
  formatUtm,
  googleMapsUrl,
  nextCoordinateFormat,
  toUtm,
  utmBand,
  utmZone,
  wrapLongitude,
} from './coordinateFormat'

// Prince George city hall, roughly.
const PG: [number, number] = [-122.7497, 53.9171]

describe('coordinate formats', () => {
  it('prints decimal degrees with hemispheres and a plain lat, lng for copying', () => {
    expect(formatDecimalDegrees(...PG)).toBe('53.91710° N, 122.74970° W')
    expect(formatLatLngPlain(...PG)).toBe('53.91710, -122.74970')
  })

  it('prints DMS and DDM, carrying a value that rounds up to 60', () => {
    expect(formatDms(...PG)).toBe('53°55′01.6″ N, 122°44′58.9″ W')
    expect(formatDdm(...PG)).toBe('53°55.026′ N, 122°44.982′ W')
    // 0.99999999° rounds to 1°00′00.0″, never 0°59′60.0″.
    expect(formatDms(0.99999999, 0.99999999)).toBe('1°00′00.0″ N, 1°00′00.0″ E')
    expect(formatDdm(0.99999999, -0.99999999)).toBe('1°00.000′ S, 1°00.000′ E')
  })

  it('wraps a longitude from another world copy', () => {
    expect(wrapLongitude(237.2503)).toBeCloseTo(-122.7497, 9)
    expect(wrapLongitude(-180)).toBe(-180)
    expect(wrapLongitude(180)).toBe(-180)
    expect(formatDecimalDegrees(237.2503, 53.9171)).toBe('53.91710° N, 122.74970° W')
  })

  it('cycles the formats in order', () => {
    expect(nextCoordinateFormat('dd')).toBe('dms')
    expect(nextCoordinateFormat('utm')).toBe('dd')
  })
})

describe('UTM', () => {
  it('matches proj4 to under a millimetre across BC and the world', () => {
    const points: Array<[number, number]> = [
      PG,
      [-123.1207, 49.2827], // Vancouver
      [-139.06, 60.0], // Yukon border, zone 7
      [-114.07, 49.0], // zone 11 edge
      [151.2093, -33.8688], // Sydney, southern hemisphere
      [2.35, 48.85],
      [-0.0001, 0.0001],
      [10.75, 59.91], // Oslo, Norway exception zone 32
    ]
    for (const [lng, lat] of points) {
      const utm = toUtm(lng, lat)!
      const definition = `+proj=utm +zone=${utm.zone}${lat < 0 ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`
      const [e, n] = proj4('EPSG:4326', definition, [lng, lat])
      expect(Math.abs(utm.easting - e)).toBeLessThan(0.001)
      expect(Math.abs(utm.northing - n)).toBeLessThan(0.001)
    }
  })

  it('names the zone and band, including the Norway and Svalbard exceptions', () => {
    expect(utmZone(...PG)).toBe(10)
    expect(utmBand(PG[1])).toBe('U')
    expect(utmZone(5, 60)).toBe(32)
    expect(utmZone(15, 78)).toBe(33)
    expect(utmBand(84)).toBe('X')
    expect(utmBand(-80)).toBe('C')
    expect(utmBand(85)).toBeNull()
  })

  it('prints UTM and falls back to degrees where UTM has no value', () => {
    expect(formatUtm(...PG)).toMatch(/^10U \d{6} E \d{7} N$/)
    expect(formatUtm(0, 86)).toBeNull()
    expect(formatCoordinate(0, 86, 'utm')).toBe('86.00000° N, 0.00000° E')
  })

  it('links to Google Maps with latitude first', () => {
    expect(googleMapsUrl(...PG)).toBe('https://www.google.com/maps/search/?api=1&query=53.917100,-122.749700')
  })
})
