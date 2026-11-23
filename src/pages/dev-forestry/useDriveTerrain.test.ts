import { describe, expect, it } from 'vitest'

import {
  DRIVE_TERRAIN_MAX_TILES,
  DRIVE_TERRAIN_ZOOMS,
  answeringContext,
  createHeldTerrain,
  driveTerrainKey,
  driveTerrainRange,
} from './useDriveTerrain'
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

  it('gives the same mosaic back for the same tiles, holding the last two', () => {
    const held = createHeldTerrain<{ name: string }>()
    const road = driveTerrainKey(driveTerrainRange(BLOCK).range)
    const reach = photoStandReach(EYE, { altitudeMeters: 1200, hfov: 50 }, 90)!
    const stood = driveTerrainKey(driveTerrainRange(BLOCK, reach).range)
    expect(stood).not.toBe(road)
    // The same box asked for again (a new array, as a restored viewpoint makes) is the same key.
    expect(driveTerrainKey(driveTerrainRange([...BLOCK]).range)).toBe(road)
    const ground = { name: 'along the road' }
    held.set(road, ground)
    held.set(stood, { name: 'at the view' })
    // Stand, step back, stand again: the very object comes back.
    expect(held.get(road)).toBe(ground)
    held.set('third', { name: 'elsewhere' })
    expect(held.peek(road)).toBe(ground)
    expect(held.peek(stood)).toBeUndefined()
    held.clear()
    expect(held.peek(road)).toBeUndefined()
  })
})

describe('the distant trees’ read', () => {
  const request = (attempt = 0) => ({ key: '12/1/2/3/4', attempt })

  it('shows loading, not the old failure, when the option is switched off and on again', () => {
    const first = request()
    const failed = { request: first, read: null }
    expect(answeringContext(failed, first)).toBe(failed)
    // Off: no request. On again: the same ground, the same attempt, a new request and a new read.
    expect(answeringContext(failed, null)).toBeNull()
    expect(answeringContext(failed, request())).toBeNull()
  })

  it('shows loading, not the old failure, on a retry', () => {
    const failed = { request: request(0), read: null }
    expect(answeringContext(failed, request(1))).toBeNull()
  })

  it('keeps a read that came for a new request over the same ground, and never another ground’s', () => {
    const read = { request: request(), read: { key: '12/1/2/3/4#1' } }
    expect(answeringContext(read, request())).toBe(read)
    expect(answeringContext(read, { key: '12/9/9/9/9', attempt: 0 })).toBeNull()
  })
})
