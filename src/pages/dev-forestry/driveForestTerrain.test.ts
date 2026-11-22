import { describe, expect, it } from 'vitest'
import {
  DRIVE_FOREST_CONTEXT_MAX_TILES,
  backgroundStands,
  driveForestTerrainRange,
  forestBackground,
  forestGround,
  type BackgroundVriStand,
} from './driveForestTerrain'
import type { InventoryStand } from './forest'
import { canopyRange, canopyTileMeters, forestBands, forestPatches, growForestPatch } from './forestPatches'
import type { PolygonGeometry } from './visibility'

const square = (w: number, s: number, e: number, n: number): PolygonGeometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
})
const land = (level2: string, level4: string | null = null, level3: string | null = null) => ({
  level2,
  level3,
  level4,
  level5: null,
})

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

  it('reads the background inventory by the core’s rules: open ground clear, tall shrub a thicket, unknown not open', () => {
    const stands: BackgroundVriStand[] = [
      { geometry: square(1, 1, 2, 2), landCover: land('N', 'RO') },
      { geometry: square(2, 1, 3, 2), landCover: land('N', 'ST') },
      { geometry: square(3, 1, 4, 2), landCover: land('N', 'SL') },
      // Unclassified: the record does not say what covers it.
      { geometry: square(4, 1, 5, 2) },
      {
        geometry: square(5, 1, 6, 2),
        landCover: land('T'),
        speciesCode: 'PLI',
        heightMeters: 14,
        crownClosurePercent: 15,
      },
    ]
    const read = backgroundStands(stands)
    expect(read.map((stand) => stand.cover ?? null)).toEqual(['rock', 'shrubTall', 'shrubLow', null])
    expect(read[3]).toMatchObject({ species: 'pine', heightMeters: 14, crownClosurePercent: 15 })
  })

  it('leaves the core read to decide on its own ground', () => {
    const stands: BackgroundVriStand[] = [
      { geometry: square(1, 1, 2, 2), landCover: land('N', 'HE') },
      { geometry: square(8, 1, 9, 2), landCover: land('N', 'HE') },
    ]
    expect(backgroundStands(stands, [[0, 0, 5, 5]]).map((stand) => stand.geometry)).toEqual([stands[1].geometry])
  })

  it('keeps open ground and unread background free of trees, past the road view’s own ground only', () => {
    const coreStand: InventoryStand = { geometry: square(1, 1, 2, 2), species: 'spruce', heightMeters: 30 }
    const background = forestBackground(
      {
        key: 'k',
        source: { elevationAt: () => 700 },
        complete: [[-5, -5, 5, 5]],
        stands: [{ geometry: square(1, 1, 2, 2), landCover: land('N', 'RO') }],
      },
      { elevationAt: (lng) => (lng < -1 ? 600 : NaN) },
      [coreStand],
    )
    expect(background.elevation.elevationAt(-2, 0)).toBe(600)
    expect(background.elevation.elevationAt(0, 0)).toBe(700)
    expect(background.elevation.elevationAt(6, 6)).toBeNaN()
    expect(background.knownAt(6, 6)).toBe(false)
    expect(background.knownAt(0, 0)).toBe(true)
    // The core's stand first: where both hold a polygon, the core's answer is the one a stem reads.
    expect(background.inventory[0]).toBe(coreStand)
    expect(background.inventory[1].cover).toBe('rock')
  })

  it('adds the background band after the others and only once its read names a key', () => {
    const bands = forestBands(3500, 8000)
    expect(bands.map((band) => !!band.background)).toEqual([false, false, false, false, true])
    expect(bands[4].spacing).toBe(160)
    expect(canopyRange(bands, 4)).toEqual([3200, 3500, 7700, 8000])
    const eye = { lng: -122, lat: 53 }
    const without = forestPatches(eye, bands, eye.lat)
    expect(without.some((patch) => patch.band === 4)).toBe(false)
    const withBackground = forestPatches(eye, bands, eye.lat, 'read-1')
    // The other bands keep their patches and keys; the band order is the original one, the background last.
    expect(withBackground.filter((patch) => patch.band < 4)).toEqual(without)
    expect(withBackground.map((patch) => patch.band)).toEqual([...withBackground.map((p) => p.band)].sort())
    const own = withBackground.filter((patch) => patch.band === 4)
    expect(own.length).toBeGreaterThan(0)
    expect(own.every((patch) => patch.key.endsWith('@read-1'))).toBe(true)
    // With no background band, the order is 0, 1, 2, 3, as it always was.
    const core = forestBands(3500)
    const bandsInOrder = forestPatches(eye, core, eye.lat).map((patch) => patch.band)
    expect(bandsInOrder).toEqual([...bandsInOrder].sort())
  })

  it('grows background stems on the background ground and keeps their canopy off unread ground', () => {
    const bands = forestBands(3500, 8000)
    const eye = { lng: -122, lat: 53 }
    const patch = forestPatches(eye, bands, eye.lat, 'k').find((each) => each.band === 4)!
    // The read reaches only the west half of the patch.
    const middle = (patch.bounds[0] + patch.bounds[2]) / 2
    const background = forestBackground(
      { key: 'k', source: { elevationAt: () => 700 }, complete: [[-180, -90, middle, 90]], stands: [] },
      { elevationAt: () => NaN },
      [],
    )
    const trees = growForestPatch(
      patch,
      bands[4],
      { stands: [], clearings: [], inventory: background.inventory, canopyKnownAt: background.knownAt },
      background.elevation,
      eye.lat,
    )
    expect(trees.length).toBeGreaterThan(50)
    expect(trees.every((tree) => tree.elevationMeters === 700 && tree.lng <= middle)).toBe(true)
    const half = canopyTileMeters(bands[4]) / 2 / (111_320 * Math.cos((eye.lat * Math.PI) / 180))
    // No tile reaches east over the unread half; a stem far from it keeps its whole tile.
    for (const tree of trees) expect(tree.lng + half * (tree.canopy?.reach ?? 0)).toBeLessThanOrEqual(middle + 1e-9)
    expect(trees.some((tree) => tree.canopy?.reach === 1)).toBe(true)
    expect(trees.some((tree) => (tree.canopy?.reach ?? 1) < 1)).toBe(true)
  })
})
