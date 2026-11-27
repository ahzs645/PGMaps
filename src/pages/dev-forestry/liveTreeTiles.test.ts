import { describe, expect, it } from 'vitest'
import { buildScenePackage } from './scenePackage'
import { createLiveTreeTiles, roadTreeArea, treeTileCandidates, TREE_TILE_METERS } from './liveTreeTiles'

describe('live road tree tiles', () => {
  it('keeps the ground frame independent of where the drive opens on a buffered route', () => {
    const route = [
      [-122.1, 54],
      [-122, 54.02],
    ]
    const a = roadTreeArea(route, { lng: -122.1, lat: 54 })
    const b = roadTreeArea(route, { lng: -122, lat: 54.02 })
    expect(a).toEqual(b)
    expect(a.radius).toBeGreaterThan(6000)
  })

  it('prefers the visible slope and defers work behind a ridge without excluding the trees', () => {
    const eye = [128, 128, 580] as const
    const open = treeTileCandidates(eye, 0, 60, new Set(), () => 575, 3000)
    const hills = treeTileCandidates(
      eye,
      0,
      60,
      new Set(),
      (x, y) => (y > 320 && y < 425 && Math.abs(x - 128) < 160 ? 710 : 575),
      3000,
    )
    const targetIndex = (tiles: typeof open) => tiles.findIndex(({ x, y }) => x === 0 && y === 2)
    expect(targetIndex(open)).toBeGreaterThanOrEqual(0)
    expect(targetIndex(hills)).toBeGreaterThan(targetIndex(open))
    expect(hills[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('transfers bounded, non-overlapping tiles and retains detail through a turn', () => {
    const eye = { lng: -122, lat: 54 }
    const ground = { elevationAt: () => 575 }
    const forest = { ...{ stands: [], clearings: [] }, standHeightMeters: 20 }
    const scene = buildScenePackage({
      eye,
      elevation: ground,
      forest,
      eyeHeightMeters: 1.5,
      bearingDegrees: 0,
      pitchDegrees: 0,
      verticalFovDegrees: 35,
      terrainRadiusMeters: 1500,
      terrainSpacingMeters: 50,
      includeModels: false,
      liveTreeTiles: { generation: 9, size: TREE_TILE_METERS },
    })
    expect(scene.trees.count).toBe(0)
    const stream = createLiveTreeTiles(scene, forest, ground)
    const original = stream.next([0, 0, 576.5], 0, 60)!
    expect(original.message.generation).toBe(9)
    expect(original.message.add).toHaveLength(2)
    expect(original.transfer).toHaveLength(2)
    const stride = original.message.fields.length
    const key = (x: number, y: number) => `${x}/${y}`
    const keys = new Set(original.message.add.map((tile) => key(tile.x, tile.y)))
    for (const tile of original.message.add) {
      expect(tile.data.length).toBeGreaterThan(0)
      for (let index = 0; index < tile.data.length; index += stride) {
        expect(Math.floor(tile.data[index] / TREE_TILE_METERS)).toBe(tile.x)
        expect(Math.floor(tile.data[index + 1] / TREE_TILE_METERS)).toBe(tile.y)
      }
    }
    original.commit()
    const turned = stream.next([0, 0, 576.5], 180, 60)!
    expect(turned.message.remove).toEqual([])
    expect(turned.message.add.every((tile) => !keys.has(key(tile.x, tile.y)))).toBe(true)
  })
})
