import { describe, expect, it } from 'vitest'
import { gibsHlsFrames } from '@/lib/imageryFeeds/gibsHlsFeed'
import { GIBS_HLS_FEED, SENTINEL2_FEED, WAYBACK_FEED } from '@/lib/imageryFeeds'
import { waybackFrame } from '@/lib/imageryFeeds/waybackFeed'
import { frameOverlays, MISSION_IMAGERY_FEEDS } from './DatedImageryPanel'
import { demoMission } from './demo'
import { parseMission } from './missionCodec'

describe('dated imagery in a mission', () => {
  it('offers only the feeds whose tiles a saved mission can carry', () => {
    expect(MISSION_IMAGERY_FEEDS).toContain(WAYBACK_FEED)
    expect(MISSION_IMAGERY_FEEDS).toContain(GIBS_HLS_FEED)
    expect(MISSION_IMAGERY_FEEDS).not.toContain(SENTINEL2_FEED)
  })

  it('adds one overlay a tile layer, named by the feed, the date and the layer, with its deepest zoom', () => {
    const wayback = frameOverlays(
      WAYBACK_FEED,
      waybackFrame({ id: '20', date: '2024-03-21', tiles: 'https://wayback.maptiles.arcgis.com/t/20/{z}/{y}/{x}' }),
    )
    expect(wayback.map((o) => [o.name, o.maxZoom])).toEqual([['Wayback · 2024-03-21', 18]])
    const day = gibsHlsFrames('2026-11-21').at(-1)!
    expect(frameOverlays(GIBS_HLS_FEED, day).map((o) => [o.name, o.maxZoom])).toEqual([
      [`NASA · ${day.date} · Landsat`, 12],
      [`NASA · ${day.date} · Sentinel-2`, 12],
    ])
  })

  it('saves and restores an overlay’s deepest zoom, and reads a mission without one as before', () => {
    const [overlay] = frameOverlays(GIBS_HLS_FEED, gibsHlsFrames('2026-11-21').at(-1)!)
    const restored = parseMission(JSON.parse(JSON.stringify({ ...demoMission(), tiles: [overlay] })))
    expect(restored.tiles[0].maxZoom).toBe(12)
    const old: Partial<typeof overlay> = { ...overlay }
    delete old.maxZoom
    expect(parseMission(JSON.parse(JSON.stringify({ ...demoMission(), tiles: [old] }))).tiles[0]).not.toHaveProperty(
      'maxZoom',
    )
  })
})
