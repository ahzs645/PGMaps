import { describe, expect, it } from 'vitest'
import {
  applyMapViewToQuery,
  isMapViewValid,
  parseMapViewHash,
  parseNumberField,
  parseZoomField,
  queryHasMapView,
  readMapViewFromQuery,
  serializeMapViewHash,
  type MapViewUrlOptions,
} from './map-url-state'

const PG: MapViewUrlOptions = {
  defaultView: { center: [-122.75, 53.91], zoom: 10 },
  minZoom: 0,
  maxZoom: 22,
}

// Mirrors aqmap's config (zoom clamp 2-16, fallback Canada center).
const AQ: MapViewUrlOptions = {
  defaultView: { center: [-96, 56], zoom: 3.1 },
  minZoom: 2,
  maxZoom: 16,
}

describe('parseNumberField', () => {
  it('returns the parsed number when finite', () => {
    expect(parseNumberField('-122.75', 0)).toBe(-122.75)
  })
  it('falls back on null, blank, or non-numeric input', () => {
    expect(parseNumberField(null, 7)).toBe(7)
    expect(parseNumberField('   ', 7)).toBe(7)
    expect(parseNumberField('abc', 7)).toBe(7)
  })
})

describe('parseZoomField', () => {
  it('keeps in-range zooms', () => {
    expect(parseZoomField('8', AQ)).toBe(8)
  })
  it('falls back to the default zoom when out of range', () => {
    expect(parseZoomField('99', AQ)).toBe(3.1)
    expect(parseZoomField('1', AQ)).toBe(3.1)
  })
})

describe('isMapViewValid', () => {
  it('rejects non-finite or out-of-mercator latitudes', () => {
    expect(isMapViewValid({ center: [0, 90], zoom: 5 }, AQ)).toBe(false)
    expect(isMapViewValid({ center: [Number.NaN, 0], zoom: 5 }, AQ)).toBe(false)
  })
  it('rejects out-of-range zoom', () => {
    expect(isMapViewValid({ center: [0, 0], zoom: 17 }, AQ)).toBe(false)
  })
  it('accepts a valid view', () => {
    expect(isMapViewValid({ center: [-122.75, 53.91], zoom: 10 }, PG)).toBe(true)
  })
})

describe('compact hash round-trip', () => {
  it('serializes view + codes as #/zoom/lat/lng/...codes', () => {
    expect(
      serializeMapViewHash({ center: [-120.8048, 67.7556], zoom: 2 }, ['B1', 'L1', 'L2'], AQ),
    ).toBe('#/2.00/67.7556/-120.8048/B1/L1/L2')
  })

  it('parses the exact example hash back to view + codes', () => {
    const parsed = parseMapViewHash('#/2.00/67.7556/-120.8048/B1/L1/L2', AQ)
    expect(parsed).not.toBeNull()
    expect(parsed!.view).toEqual({ center: [-120.8048, 67.7556], zoom: 2 })
    expect(parsed!.codes).toEqual(['B1', 'L1', 'L2'])
  })

  it('returns null for a non-view hash so callers can fall back', () => {
    expect(parseMapViewHash('', AQ)).toBeNull()
    expect(parseMapViewHash('#section', AQ)).toBeNull()
  })

  it('drops empty codes when serializing', () => {
    expect(serializeMapViewHash({ center: [0, 0], zoom: 5 }, ['', 'L1', ''], AQ)).toBe('#/5.00/0.0000/0.0000/L1')
  })

  it('survives a full serialize -> parse cycle', () => {
    const view = { center: [-122.1234, 53.4321] as [number, number], zoom: 11 }
    const codes = ['B2', 'L3']
    const hash = serializeMapViewHash(view, codes, PG)
    const parsed = parseMapViewHash(hash, PG)
    expect(parsed!.view).toEqual(view)
    expect(parsed!.codes).toEqual(codes)
  })
})

describe('query params', () => {
  it('reads lng/lat/z with defaults for missing keys', () => {
    const view = readMapViewFromQuery(new URLSearchParams('lng=-120&lat=60'), AQ)
    expect(view).toEqual({ center: [-120, 60], zoom: 3.1 })
  })

  it('reports whether the URL pins a view', () => {
    expect(queryHasMapView(new URLSearchParams('lng=-120'), AQ)).toBe(true)
    expect(queryHasMapView(new URLSearchParams('metric=pop'), AQ)).toBe(false)
  })

  it('writes lng/lat/z and preserves unrelated params', () => {
    const params = new URLSearchParams('level=ct&metric=pop')
    applyMapViewToQuery(params, { center: [-122.5, 53.8], zoom: 12 }, PG)
    expect(params.get('lng')).toBe('-122.5000')
    expect(params.get('lat')).toBe('53.8000')
    expect(params.get('z')).toBe('12.00')
    expect(params.get('level')).toBe('ct')
  })

  it('removes view params when the view rounds to the default (clean URLs)', () => {
    const params = new URLSearchParams('lng=-1&lat=-1&z=5&keep=1')
    applyMapViewToQuery(params, PG.defaultView, PG)
    expect(params.has('lng')).toBe(false)
    expect(params.has('lat')).toBe(false)
    expect(params.has('z')).toBe(false)
    expect(params.get('keep')).toBe('1')
  })

  it('leaves params untouched for an invalid view', () => {
    const params = new URLSearchParams('lng=-122&lat=53&z=10')
    applyMapViewToQuery(params, { center: [0, 200], zoom: 10 }, PG)
    expect(params.get('lat')).toBe('53')
  })
})
