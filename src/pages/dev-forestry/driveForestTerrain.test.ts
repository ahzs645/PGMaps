import { describe, expect, it } from 'vitest'
import {
  DRIVE_FOREST_CONTEXT_MAX_TILES,
  driveForestTerrainRange,
  forestContextCover,
  forestGround,
} from './driveForestTerrain'
import { SCENE_COVER } from './sceneCover'
import { canopyRange, forestBands, forestPatches, growForestPatch } from './forestPatches'

describe('road-view forest context', () => {
  it('uses a bounded coarse mosaic and leaves a large route on its existing terrain', () => {
    const range = driveForestTerrainRange([-122.15, 53.0, -122.05, 53.05])
    expect(range).not.toBeNull()
    expect(range!.zoom).toBeLessThanOrEqual(11)
    expect(range!.tileCount).toBeLessThanOrEqual(DRIVE_FOREST_CONTEXT_MAX_TILES)
    expect(driveForestTerrainRange([-125, 51, -121, 53])).toBeNull()
  })

  it('prefers the road terrain even where the coarser ground measures a different height', () => {
    const ground = forestGround({ elevationAt: (lng) => (lng > 1 ? NaN : 625) }, { elevationAt: () => 641 })
    expect(ground.elevationAt(0, 52)).toBe(625)
    expect(ground.elevationAt(2, 52)).toBe(641)
  })

  it('uses inventory to keep recorded open ground and unread background free of trees', () => {
    const coverage = forestContextCover(
      {
        complete: [[-5, -5, 5, 5]],
        polygons: [
          {
            cover: SCENE_COVER.rock,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [1, 1],
                  [2, 1],
                  [2, 2],
                  [1, 2],
                  [1, 1],
                ],
              ],
            },
          },
        ],
      },
      [-5, -5, 5, 5],
    )
    const ground = forestGround({ elevationAt: () => NaN }, { elevationAt: () => 700 }, coverage.treedAt)
    expect(ground.elevationAt(0, 0)).toBe(700)
    expect(ground.elevationAt(1.5, 1.5)).toBeNaN()
    expect(ground.elevationAt(6, 6)).toBeNaN()
    expect(coverage.openGround).toHaveLength(1)
  })

  it('draws a sparse background band before the denser middle and grows trees past the core DEM', () => {
    const bands = forestBands(3500, 8000)
    expect(bands[3].spacing).toBe(80)
    expect(bands[4].spacing).toBeGreaterThan(bands[3].spacing)
    expect(canopyRange(bands, 4)).toEqual([3200, 3500, 7700, 8000])
    const eye = { lng: -122, lat: 53 }
    const patches = forestPatches(eye, bands, eye.lat)
    expect(patches.findIndex((patch) => patch.band === 4)).toBeLessThan(patches.findIndex((patch) => patch.band === 2))
    const contextPatch = patches.find((patch) => patch.band === 4)!
    const farGround = forestGround({ elevationAt: () => NaN }, { elevationAt: () => 700 })
    const trees = growForestPatch(contextPatch, bands[4], { stands: [], clearings: [] }, farGround, eye.lat)
    expect(trees.length).toBeGreaterThan(0)
    expect(trees.every((tree) => tree.elevationMeters === 700)).toBe(true)
  })
})
