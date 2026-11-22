import { describe, expect, it } from 'vitest'

import { checkFrames, shiftIsoDate, todayIsoDate } from './feed'
import {
  GIBS_HLS_FEED,
  gibsHlsFrames,
  isIsoDate,
  RECENT_IMAGERY_ARCHIVE_DAYS,
  RECENT_IMAGERY_LAG_DAYS,
  recentImageryRange,
  recentImageryTiles,
} from './gibsHlsFeed'

describe('dates', () => {
  it('steps days across months and years in UTC', () => {
    expect(shiftIsoDate('2026-11-04', -1)).toBe('2026-11-03')
    expect(shiftIsoDate('2026-11-01', -1)).toBe('2026-10-31')
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftIsoDate('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('reads today in UTC', () => {
    expect(todayIsoDate(new Date('2026-11-11T23:30:00Z'))).toBe('2026-11-11')
  })

  it('tells a date from other text', () => {
    expect(isIsoDate('2026-11-04')).toBe(true)
    expect(isIsoDate('2026-13-40')).toBe(false)
    expect(isIsoDate('04/11/2026')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })
})

describe('what GIBS serves', () => {
  it('ends a week back, where the newest image was on 11 November 2026', () => {
    expect(recentImageryRange('2026-11-11').latest).toBe('2026-11-04')
  })

  it('offers one frame a day, Landsat under Sentinel-2, oldest first', async () => {
    const frames = gibsHlsFrames('2026-11-11')
    expect(frames).toHaveLength(RECENT_IMAGERY_ARCHIVE_DAYS - RECENT_IMAGERY_LAG_DAYS + 1)
    expect(frames.at(-1)?.date).toBe('2026-11-04')
    expect(frames[0].layers.map((layer) => layer.tiles.split('/')[6])).toEqual([
      'HLS_L30_Nadir_BRDF_Adjusted_Reflectance',
      'HLS_S30_Nadir_BRDF_Adjusted_Reflectance',
    ])
    const listed = await GIBS_HLS_FEED.listFrames({
      today: '2026-11-11',
      signal: new AbortController().signal,
      fetch: () => Promise.reject(new Error('no network needed')),
    })
    expect(checkFrames(GIBS_HLS_FEED, listed)).toEqual(frames)
  })
})

describe('recentImageryTiles', () => {
  it('builds the GIBS template with row before column', () => {
    expect(recentImageryTiles('HLS_S30_Nadir_BRDF_Adjusted_Reflectance', '2026-11-03')).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/2026-11-03/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png',
    )
  })

  it('refuses anything that is not a date', () => {
    expect(() => recentImageryTiles('HLS_S30_Nadir_BRDF_Adjusted_Reflectance', '../../x')).toThrow(/Not a date/)
  })
})
