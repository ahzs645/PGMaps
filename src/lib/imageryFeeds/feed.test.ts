import { describe, expect, it } from 'vitest'
import { checkFrames, defaultPlaceKey, MAX_FRAME_LAYERS, placeKeyOf, shiftIsoDate, type ImageryFrame } from './feed'

const frame = (id: string, date: string, layers = 1): ImageryFrame<null> => ({
  id,
  date,
  layers: Array.from({ length: layers }, (_, i) => ({ tiles: `https://example/${id}/${i}/{z}/{x}/{y}`, maxZoom: 12 })),
  source: null,
})

describe('checkFrames', () => {
  const feed = { label: 'Test feed' }

  it('passes frames oldest first with unique ids and real dates', () => {
    const frames = [frame('a', '2024-01-01'), frame('b', '2024-01-01'), frame('c', '2025-06-30', MAX_FRAME_LAYERS)]
    expect(checkFrames(feed, frames)).toEqual(frames)
  })

  it('names what is wrong with a feed’s answer', () => {
    expect(() => checkFrames(feed, [])).toThrow('Test feed returned no imagery dates.')
    expect(() => checkFrames(feed, [frame('a', '2024-01-01'), frame('a', '2024-02-01')])).toThrow(/listed a twice/)
    expect(() => checkFrames(feed, [frame('a', '2024-13-45')])).toThrow(/no readable date/)
    expect(() => checkFrames(feed, [frame('a', '2025-01-01'), frame('b', '2024-01-01')])).toThrow(/out of order/)
    expect(() => checkFrames(feed, [frame('a', '2024-01-01', MAX_FRAME_LAYERS + 1)])).toThrow(/1 to 4 can be drawn/)
    expect(() => checkFrames(feed, [frame('a', '2024-01-01', 0)])).toThrow(/0 layers/)
  })
})

describe('places', () => {
  it('rounds a place to about 10 m and its zoom unless the feed keys it itself', () => {
    expect(defaultPlaceKey({ lon: -124.123456, lat: 54.987654, zoom: 11.6 })).toBe('-124.1235,54.9877,12')
    expect(placeKeyOf({}, { lon: -124, lat: 54, zoom: 10 })).toBe('-124.0000,54.0000,10')
    expect(placeKeyOf({ placeKey: () => 'tile 1' }, { lon: -124, lat: 54, zoom: 10 })).toBe('tile 1')
  })

  it('steps days in UTC', () => {
    expect(shiftIsoDate('2026-11-01', -1)).toBe('2026-10-31')
  })
})
