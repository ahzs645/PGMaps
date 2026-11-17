import { describe, expect, it } from 'vitest'

import { DRIVE_TERRAIN_MAX_TILES, DRIVE_TERRAIN_ZOOMS, driveTerrainRange } from './useDriveTerrain'
import { photoStandReach } from './viewpointStand'

// A made-up place: a 1 km block and a camera 20 km west of it.
const BLOCK: [number, number, number, number] = [-123.0, 54.1, -122.985, 54.109]
const EYE = { lng: -123.3, lat: 54.1 }

describe('the road view’s terrain', () => {
  it('loads a road and its block at the finest zoom', () => {
    const { zoom, tooLarge } = driveTerrainRange(BLOCK)
    expect(zoom).toBe(DRIVE_TERRAIN_ZOOMS.finest)
    expect(tooLarge).toBe(false)
  })

  it('reaches a photo viewpoint’s view at a coarser zoom, within the same tile budget', () => {
    const reach = photoStandReach(EYE, { altitudeMeters: 1200, hfov: 50 }, 90)!
    const near = driveTerrainRange(BLOCK)
    const far = driveTerrainRange(BLOCK, reach)
    expect(far.zoom).toBeLessThan(near.zoom)
    expect(far.zoom).toBeGreaterThanOrEqual(DRIVE_TERRAIN_ZOOMS.coarsest)
    expect(far.tooLarge).toBe(false)
    expect(far.range.tileCount).toBeLessThanOrEqual(DRIVE_TERRAIN_MAX_TILES)
    // The range covers the camera and the far end of its view.
    const tileLng = (x: number) => (x / 2 ** far.zoom) * 360 - 180
    expect(tileLng(far.range.minX)).toBeLessThanOrEqual(EYE.lng)
    expect(tileLng(far.range.maxX + 1)).toBeGreaterThanOrEqual(reach[2])
  })
})
