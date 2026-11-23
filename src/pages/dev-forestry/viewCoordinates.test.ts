import { describe, expect, it } from 'vitest'

import {
  BC_UTM_ZONES,
  formatDms,
  formatUtm,
  lngLatToUtm,
  naturalUtmZone,
  parseLatLon,
  parseUtm,
  parseViewPlaceEntry,
  placeCrsLabel,
  placeEntryOf,
  placeInputOf,
  precisionLabel,
  readPlaceInput,
  utmToLngLat,
} from './viewCoordinates'
import { haversineMeters } from './visibility'

// Made-up places in BC, one in each zone's band.
const SAMPLES: Record<number, Array<{ lng: number; lat: number }>> = {
  7: [
    { lng: -138.6, lat: 59.5 },
    { lng: -138.9, lat: 59.9 },
  ],
  8: [
    { lng: -137.4, lat: 59.6 },
    { lng: -133.8, lat: 58.3 },
  ],
  9: [
    { lng: -130.6, lat: 54.1 },
    { lng: -128.5, lat: 50.6 },
  ],
  10: [
    { lng: -122.7, lat: 53.9 },
    { lng: -125.1, lat: 56.9 },
    { lng: -120.2, lat: 49.2 },
  ],
  11: [
    { lng: -116.9, lat: 50.3 },
    { lng: -114.3, lat: 58.8 },
  ],
}

describe('UTM in BC', () => {
  it('round-trips latitude and longitude through every BC zone to the millimetre', () => {
    for (const zone of BC_UTM_ZONES) {
      for (const point of SAMPLES[zone]) {
        expect(naturalUtmZone(point.lng)).toBe(zone)
        const utm = lngLatToUtm(point.lng, point.lat, zone)
        expect(utm.zone).toBe(zone)
        const back = utmToLngLat(zone, utm.easting, utm.northing)
        expect(haversineMeters(point, back)).toBeLessThan(0.001)
        // And through the parser, given to the millimetre.
        const parsed = parseUtm({ zone, easting: utm.easting.toFixed(3), northing: utm.northing.toFixed(3) })
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) continue
        expect(haversineMeters(point, parsed)).toBeLessThan(0.002)
        expect(parsed.precisionMeters).toBeCloseTo(0.0005, 9)
        expect(parsed.warnings).toEqual([])
      }
    }
  })

  it('treats NAD83 and WGS84 as the same: no shift is applied', () => {
    const nad = utmToLngLat(10, 512345, 5973210, 'NAD83')
    const wgs = utmToLngLat(10, 512345, 5973210, 'WGS84')
    expect(haversineMeters(nad, wgs)).toBeLessThan(0.001)
  })

  it('refuses a zone outside BC, a swapped pair and numbers no BC point has', () => {
    expect(parseUtm({ zone: 12, easting: '512345', northing: '5973210' })).toMatchObject({ ok: false })
    expect(parseUtm({ zone: 6, easting: '512345', northing: '5973210' })).toMatchObject({ ok: false })
    const swapped = parseUtm({ zone: 10, easting: '5973210', northing: '512345' })
    expect(swapped.ok).toBe(false)
    if (!swapped.ok) expect(swapped.error).toMatch(/swapped/)
    expect(parseUtm({ zone: 10, easting: '12345', northing: '5973210' })).toMatchObject({ ok: false })
    expect(parseUtm({ zone: 10, easting: '512345', northing: '4973210' })).toMatchObject({ ok: false })
    expect(parseUtm({ zone: 10, easting: '51a345', northing: '5973210' })).toMatchObject({ ok: false })
  })

  it('warns, never refuses, when the point lies outside its zone’s band', () => {
    // An easting far east of zone 9's centre lands in zone 10.
    const parsed = parseUtm({ zone: 9, easting: '850000', northing: '5973210' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.warnings[0]).toMatch(/outside zone 9's band, in zone 10/)
  })

  it('states precision from the digits given', () => {
    const metre = parseUtm({ zone: 10, easting: '512 345', northing: '5,973,210' })
    expect(metre.ok && metre.precisionMeters).toBe(0.5)
    const tenth = parseUtm({ zone: 10, easting: '512345.6', northing: '5973210' })
    expect(tenth.ok && tenth.precisionMeters).toBe(0.5)
    const both = parseUtm({ zone: 10, easting: '512345.6', northing: '5973210.4' })
    expect(both.ok && both.precisionMeters).toBeCloseTo(0.05, 9)
  })
})

describe('latitude and longitude', () => {
  it('reads decimal degrees, latitude first, with signs or hemisphere letters', () => {
    for (const text of [
      '53.91234, -122.71234',
      '53.91234 N, 122.71234 W',
      'N53.91234 W122.71234',
      '53.91234 -122.71234',
    ]) {
      const parsed = parseLatLon(text)
      expect(parsed, text).toMatchObject({ ok: true })
      if (!parsed.ok) continue
      expect(parsed.lat).toBeCloseTo(53.91234, 9)
      expect(parsed.lng).toBeCloseTo(-122.71234, 9)
    }
    // Hemisphere letters put a longitude given first in its place.
    const reversed = parseLatLon('122.71234 W, 53.91234 N')
    expect(reversed.ok && reversed.lat).toBeCloseTo(53.91234, 9)
  })

  it('reads degrees, minutes and seconds', () => {
    const parsed = parseLatLon(`53°54'44.4"N 122°42'44.4"W`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.lat).toBeCloseTo(53 + 54 / 60 + 44.4 / 3600, 9)
    expect(parsed.lng).toBeCloseTo(-(122 + 42 / 60 + 44.4 / 3600), 9)
    // A tenth of a second: 0.05″ of latitude, about 1.5 m.
    expect(parsed.precisionMeters).toBeCloseTo((0.05 / 3600) * 111_320, 6)
    const spaced = parseLatLon('53 54 44.4 N, 122 42 44.4 W')
    expect(spaced.ok && spaced.lat).toBeCloseTo(parsed.lat, 9)
    const curly = parseLatLon('53°54′44.4″ N, 122°42′44.4″ W')
    expect(curly.ok && curly.lng).toBeCloseTo(parsed.lng, 9)
    const minutes = parseLatLon('53 54.74 N, 122 42.74 W')
    expect(minutes.ok && minutes.lat).toBeCloseTo(53 + 54.74 / 60, 9)
  })

  it('states precision from the digits given, the larger axis', () => {
    const four = parseLatLon('53.9123, -122.7123')
    // Half of 0.0001° of latitude.
    expect(four.ok && four.precisionMeters).toBeCloseTo(0.00005 * 111_320, 6)
    const mixed = parseLatLon('53.912345, -122.71')
    // The longitude's two decimals rule: half of 0.01° at 53.9°N.
    expect(mixed.ok && mixed.precisionMeters).toBeCloseTo(0.005 * 111_320 * Math.cos((53.912345 * Math.PI) / 180), 6)
  })

  it('refuses what it cannot read rather than guessing', () => {
    // A dropped minus sign puts the view in Asia: refused, and the fix named.
    const east = parseLatLon('53.9, 122.7')
    expect(east.ok).toBe(false)
    if (!east.ok) expect(east.error).toMatch(/122.7 W/)
    expect(parseLatLon('-122.7, 53.9')).toMatchObject({ ok: false })
    expect(parseLatLon('-53.9, -122.7')).toMatchObject({ ok: false })
    expect(parseLatLon('53.9')).toMatchObject({ ok: false })
    expect(parseLatLon('53.5 30 N, 122 W')).toMatchObject({ ok: false })
    expect(parseLatLon('53 61 N, 122 W')).toMatchObject({ ok: false })
    expect(parseLatLon('53.9 N, 54.1 N')).toMatchObject({ ok: false })
    expect(parseLatLon('hello, world')).toMatchObject({ ok: false })
    expect(parseLatLon('')).toMatchObject({ ok: false })
  })

  it('warns when the point lies outside BC', () => {
    const parsed = parseLatLon('45.5, -73.6')
    expect(parsed.ok && parsed.warnings).toEqual(['It lies outside British Columbia.'])
  })
})

describe('a view’s typed place', () => {
  it('keeps the text, system, datum, zone and precision, and reads back', () => {
    const { entry } = readPlaceInput({
      system: 'utm',
      datum: 'NAD83',
      zone: 10,
      easting: '512345.6',
      northing: '5973210.4',
    })
    expect(entry).not.toBeNull()
    expect(entry!.text).toBe('10 512345.6 5973210.4')
    expect(placeCrsLabel(entry!)).toBe('NAD83 / UTM zone 10N (EPSG:26910)')
    expect(parseViewPlaceEntry(JSON.parse(JSON.stringify(entry)))).toEqual(entry)
    expect(placeInputOf(entry!)).toEqual({
      system: 'utm',
      datum: 'NAD83',
      zone: 10,
      easting: '512345.6',
      northing: '5973210.4',
    })
    expect(parseViewPlaceEntry({ ...entry, zone: 13 })).toBeNull()
    expect(parseViewPlaceEntry({ ...entry, datum: 'NAD27' })).toBeNull()
  })

  it('describes the view only while it still stands there', () => {
    const { entry } = readPlaceInput({ system: 'latlon', datum: 'WGS84', text: ' 53.91234 ,  -122.71234 ' })
    expect(entry!.text).toBe('53.91234 , -122.71234')
    expect(placeCrsLabel(entry!)).toBe('WGS84 latitude and longitude (EPSG:4326)')
    const view = { lng: entry!.lng, lat: entry!.lat, place: entry }
    expect(placeEntryOf(view)).toBe(entry)
    // Dragged a metre on the plan: the text now describes another point.
    expect(placeEntryOf({ ...view, lat: view.lat + 0.00001 })).toBeNull()
  })

  it('shows coordinates back in both systems', () => {
    const point = { lng: -122.71234, lat: 53.91234 }
    expect(formatDms(point.lng, point.lat)).toBe(`53°54'44.42" N, 122°42'44.42" W`)
    const utm = lngLatToUtm(point.lng, point.lat)
    expect(formatUtm(point.lng, point.lat)).toBe(
      `UTM 10N ${utm.easting.toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} E ${utm.northing.toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} N`,
    )
    expect(formatDms(-122.5, 53.99999999)).toBe(`54°00'00.00" N, 122°30'00.00" W`)
  })

  it('labels precision', () => {
    expect(precisionLabel(0.5)).toBe('±0.5 m')
    expect(precisionLabel(0.0005)).toBe('±0.05 m or better')
    expect(precisionLabel(5.566)).toBe('±5.6 m')
    expect(precisionLabel(556.6)).toBe('±557 m')
  })
})
