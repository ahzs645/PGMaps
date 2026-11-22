/**
 * The far bands' extras: a canopy tile and the slope under each stem. Both are display only, so
 * what is pinned here is that neither moves a stem and that a tile never roofs open ground.
 */
import { describe, expect, it } from 'vitest'

import { CANOPY_CLOSES_AT_METERS, placeTrees, type InventoryStand } from './forest'
import { canopyTileMeters, forestBands, forestPatches, growForestPatch, isFarBand } from './forestPatches'
import { lightBearing } from './GroundRelief'
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { pointInPolygon } from './visibility'

const CENTRE = { lng: -122.75, lat: 53.9 }
const EAST = 111_320 * Math.cos((CENTRE.lat * Math.PI) / 180)

/** A square of `metres` half-side, `east` and `north` metres from the centre. */
function square(metres: number, east = 0, north = 0): GeoJSON.Polygon {
  const lng = CENTRE.lng + east / EAST
  const lat = CENTRE.lat + north / 111_320
  const dLng = metres / EAST
  const dLat = metres / 111_320
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ],
    ],
  }
}

describe('canopy tiles', () => {
  const grow = (options: Partial<Parameters<typeof placeTrees>[0]> = {}) =>
    placeTrees({ stands: [], clearings: [], centre: CENTRE, radiusMeters: 1200, spacingMeters: 80, ...options })

  it('moves no stem: the stand is the same with tiles and without', () => {
    const without = grow()
    const withTiles = grow({ canopyTileMeters: 100 })
    expect(withTiles.length).toBe(without.length)
    expect(withTiles.length).toBeGreaterThan(300)
    expect(withTiles.map(({ canopy: _canopy, ...tree }) => tree)).toEqual(without)
    expect(without.every((tree) => tree.canopy === undefined)).toBe(true)
  })

  it('gives every stem of an unbroken stand its whole tile, cut out to the stand closure', () => {
    const trees = grow({ canopyTileMeters: 100, crownClosurePercent: 45 })
    expect(trees.every((tree) => tree.canopy?.reach === 1)).toBe(true)
    // A mature stand at the default height: the closure asked for.
    expect(trees.every((tree) => Math.abs((tree.canopy?.cover ?? 0) - 0.45) < 1e-9)).toBe(true)
  })

  it('never lays a tile over a block: a stem beside one keeps its tile short of the edge', () => {
    const block = square(300)
    const trees = grow({ clearings: [block], canopyTileMeters: 100 })
    let shortened = 0
    for (const tree of trees) {
      expect(pointInPolygon(block, tree.lng, tree.lat)).toBe(false)
      const half = 50 * (tree.canopy?.reach ?? 0)
      if ((tree.canopy?.reach ?? 0) < 1) shortened += 1
      // The tile's four corners and the middles of its sides: none on the cut ground.
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        const lng = tree.lng + (dx * half) / EAST
        const lat = tree.lat + (dy * half) / 111_320
        expect(pointInPolygon(block, lng, lat)).toBe(false)
      }
    }
    // The stems round the block are the ones held back; the rest of the stand is not.
    expect(shortened).toBeGreaterThan(4)
    expect(shortened).toBeLessThan(trees.length / 3)
  })

  it('holds a tile back from ground the inventory says is not forest', () => {
    const meadow: InventoryStand = { geometry: square(250, 500, 0), species: null, heightMeters: null, cover: 'herb' }
    const trees = grow({ inventory: [meadow], canopyTileMeters: 100 })
    const beside = trees.filter((tree) => {
      const east = (tree.lng - CENTRE.lng) * EAST - 500
      const north = (tree.lat - CENTRE.lat) * 111_320
      return Math.max(Math.abs(east), Math.abs(north)) < 280
    })
    expect(beside.length).toBeGreaterThan(0)
    expect(beside.every((tree) => (tree.canopy?.reach ?? 1) < 1)).toBe(true)
  })
})

describe('the far bands of a grown patch', () => {
  const bands = forestBands(8000)
  // Ground rising 1 in 5 to the east and falling 1 in 10 to the north.
  const tilted: ElevationSource = {
    elevationAt: (lng, lat) => 700 + (lng - CENTRE.lng) * EAST * 0.2 - (lat - CENTRE.lat) * 111_320 * 0.1,
    elevationAtMercator: () => 700,
  }
  const inputs = { stands: [], clearings: [], thinnings: [], inventory: [], heightMeters: 25 }
  const patchOf = (band: number) => forestPatches(CENTRE, bands, CENTRE.lat).find((patch) => patch.band === band)!

  it('are the coarse ones, and lay a tile a quarter wider than their spacing', () => {
    expect(bands.map(isFarBand)).toEqual([false, false, true, true])
    expect(canopyTileMeters(bands[2])).toBe(30)
    expect(canopyTileMeters(bands[3])).toBe(100)
  })

  it('read the slope under each stem, and give it a canopy tile', () => {
    const trees = growForestPatch(patchOf(3), bands[3], inputs, tilted, CENTRE.lat)
    expect(trees.length).toBeGreaterThan(50)
    for (const tree of trees) {
      expect(tree.slope?.[0]).toBeCloseTo(0.2, 3)
      expect(tree.slope?.[1]).toBeCloseTo(-0.1, 3)
      expect(tree.canopy?.reach).toBe(1)
    }
  })

  it('leave the near bands as they were: no slope, no tile', () => {
    const trees = growForestPatch(patchOf(0), bands[0], inputs, tilted, CENTRE.lat)
    expect(trees.length).toBeGreaterThan(50)
    expect(trees.every((tree) => tree.slope === undefined && tree.canopy === undefined)).toBe(true)
  })

  it('take ground past the edge of the elevation as level rather than guessed', () => {
    const edged: ElevationSource = {
      elevationAt: (lng, lat) => (lng > CENTRE.lng ? Number.NaN : tilted.elevationAt(lng, lat)),
      elevationAtMercator: () => 700,
    }
    const trees = growForestPatch(patchOf(3), bands[3], inputs, edged, CENTRE.lat)
    expect(trees.every((tree) => Number.isFinite(tree.slope?.[0]) && Number.isFinite(tree.slope?.[1]))).toBe(true)
  })
})

describe('a fresh block listed as regrowth over the inventory’s open ground', () => {
  // The page lists a recently cut block's regrowth stand (height 0 inside its regeneration lag) before the inventory,
  // whose VRI polygon over the same ground is herb. No canopy tile may roof the block.
  const level: ElevationSource = { elevationAt: () => 700, elevationAtMercator: () => 700 }
  const reachingInto = (
    trees: ReturnType<typeof growForestPatch>,
    tileMeters: number,
    middle: { lng: number; lat: number },
    half: number,
  ) => {
    const east = 111_320 * Math.cos((middle.lat * Math.PI) / 180)
    const inside = (lng: number, lat: number) =>
      Math.abs(lng - middle.lng) < half / east && Math.abs(lat - middle.lat) < half / 111_320
    return {
      stems: trees.filter((tree) => inside(tree.lng, tree.lat)).length,
      tiles: trees.filter((tree) => {
        const reach = (tileMeters / 2) * (tree.canopy?.reach ?? 0)
        return (
          reach > 0 &&
          [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
          ].some(([dx, dy]) => inside(tree.lng + (dx * reach) / east, tree.lat + (dy * reach) / 111_320))
        )
      }).length,
    }
  }
  const squareAt = (middle: { lng: number; lat: number }, metres: number): GeoJSON.Polygon => {
    const dLng = metres / (111_320 * Math.cos((middle.lat * Math.PI) / 180))
    const dLat = metres / 111_320
    return {
      type: 'Polygon',
      coordinates: [
        [
          [middle.lng - dLng, middle.lat - dLat],
          [middle.lng + dLng, middle.lat - dLat],
          [middle.lng + dLng, middle.lat + dLat],
          [middle.lng - dLng, middle.lat + dLat],
          [middle.lng - dLng, middle.lat - dLat],
        ],
      ],
    }
  }
  const inventoryOver = (block: GeoJSON.Polygon, regrowthHeight: number): InventoryStand[] => [
    { geometry: block, species: null, heightMeters: regrowthHeight, regenerationFraction: 1 },
    { geometry: block, species: null, heightMeters: null, cover: 'herb' },
  ]

  it('is not roofed in a core far band, as it was before the background band', () => {
    const bands = forestBands(3500)
    const patch = forestPatches(CENTRE, bands, CENTRE.lat).find((each) => each.band === 3)!
    const middle = { lng: (patch.bounds[0] + patch.bounds[2]) / 2, lat: (patch.bounds[1] + patch.bounds[3]) / 2 }
    const block = squareAt(middle, 300)
    const grow = (inventory: InventoryStand[]) =>
      growForestPatch(patch, bands[3], { stands: [], clearings: [], inventory, heightMeters: 25 }, level, CENTRE.lat)
    const herbOnly = grow([{ geometry: block, species: null, heightMeters: null, cover: 'herb' }])
    expect(herbOnly.length).toBeGreaterThan(50)
    expect(reachingInto(herbOnly, canopyTileMeters(bands[3]), middle, 300).tiles).toBe(0)
    // Listed first, a regrowth stand grows its own stems (as a stem reads the inventory), but any open polygon keeps
    // the tiles off in the core bands, even where the regrowth stand has grown past canopy closure.
    for (const height of [0, 8, 20]) {
      const trees = grow(inventoryOver(block, height))
      expect(reachingInto(trees, canopyTileMeters(bands[3]), middle, 300).tiles).toBe(0)
    }
  })

  it('is not roofed in the background band while its regrowth has not closed canopy', () => {
    const bands = forestBands(3500, 8000)
    const patch = forestPatches(CENTRE, bands, CENTRE.lat, 'read').find((each) => each.band === 4)!
    const middle = { lng: (patch.bounds[0] + patch.bounds[2]) / 2, lat: (patch.bounds[1] + patch.bounds[3]) / 2 }
    const block = squareAt(middle, 600)
    const grow = (inventory: InventoryStand[]) =>
      growForestPatch(patch, bands[4], { stands: [], clearings: [], inventory, heightMeters: 25 }, level, CENTRE.lat)
    for (const height of [0, CANOPY_CLOSES_AT_METERS]) {
      const seen = reachingInto(grow(inventoryOver(block, height)), canopyTileMeters(bands[4]), middle, 600)
      if (height === 0) expect(seen.stems).toBe(0)
      expect(seen.tiles).toBe(0)
    }
  })
})

describe('lightBearing', () => {
  it('gives where a light comes from, clockwise from north, for a direction in the mercator frame', () => {
    // x east, y south: a light in the south is +y.
    expect(lightBearing([0, 1, 1])).toBeCloseTo(180, 6)
    expect(lightBearing([1, 0, 1])).toBeCloseTo(90, 6)
    expect(lightBearing([0, -1, 1])).toBeCloseTo(0, 6)
    expect(lightBearing([-1, 0, 1])).toBeCloseTo(270, 6)
  })
})

describe('a road through a far stand', () => {
  /** A corridor `width` metres wide running north to south through the middle of the stand. */
  const corridor = (width: number): GeoJSON.Polygon => ({
    type: 'Polygon',
    coordinates: [
      [
        [CENTRE.lng - width / 2 / EAST, CENTRE.lat - 2000 / 111_320],
        [CENTRE.lng + width / 2 / EAST, CENTRE.lat - 2000 / 111_320],
        [CENTRE.lng + width / 2 / EAST, CENTRE.lat + 2000 / 111_320],
        [CENTRE.lng - width / 2 / EAST, CENTRE.lat + 2000 / 111_320],
        [CENTRE.lng - width / 2 / EAST, CENTRE.lat - 2000 / 111_320],
      ],
    ],
  })
  const tilesBeside = (width: number, spacingMeters: number, tile: number, radiusMeters: number) => {
    const trees = placeTrees({
      stands: [],
      clearings: [corridor(width)],
      centre: CENTRE,
      radiusMeters,
      spacingMeters,
      canopyTileMeters: tile,
    })
    expect(trees.length).toBeGreaterThan(300)
    for (const tree of trees) {
      const east = (tree.lng - CENTRE.lng) * EAST
      // The tile's near side stops short of the corridor's near edge.
      expect(Math.abs(east) - (tile / 2) * (tree.canopy?.reach ?? 0)).toBeGreaterThanOrEqual(width / 2)
    }
  }

  it('is not roofed in the 24 m band: no tile reaches across a 20 m corridor', () => {
    tilesBeside(20, 24, 30, 400)
  })

  it('is not roofed in the 80 m band once it is wider than its samples are apart', () => {
    // Past 3 km a tile's ground is sampled every 25 m: a 20 m road can pass between, a 30 m one cannot.
    tilesBeside(30, 80, 100, 1200)
  })
})

describe('the background band (Distant trees)', () => {
  const bands = forestBands(3500, 8000)
  const level: ElevationSource = { elevationAt: () => 700, elevationAtMercator: () => 700 }
  const patch = forestPatches(CENTRE, bands, CENTRE.lat, 'read').find((each) => each.band === 4)!
  const middle = {
    lng: (patch.bounds[0] + patch.bounds[2]) / 2,
    lat: (patch.bounds[1] + patch.bounds[3]) / 2,
  }
  const patchEast = 111_320 * Math.cos((middle.lat * Math.PI) / 180)
  /** A square of `metres` half-side round the patch's middle. */
  const middleSquare = (metres: number): GeoJSON.Polygon => {
    const dLng = metres / patchEast
    const dLat = metres / 111_320
    return {
      type: 'Polygon',
      coordinates: [
        [
          [middle.lng - dLng, middle.lat - dLat],
          [middle.lng + dLng, middle.lat - dLat],
          [middle.lng + dLng, middle.lat + dLat],
          [middle.lng - dLng, middle.lat + dLat],
          [middle.lng - dLng, middle.lat - dLat],
        ],
      ],
    }
  }
  const grow = (inventory: InventoryStand[]) =>
    growForestPatch(patch, bands[4], { stands: [], clearings: [], inventory, heightMeters: 25 }, level, CENTRE.lat)

  it('is a far band of 160 m stems laying 200 m tiles', () => {
    expect(isFarBand(bands[4])).toBe(true)
    expect(bands[4].spacing).toBe(160)
    expect(canopyTileMeters(bands[4])).toBe(200)
  })

  it('keeps its canopy tiles off the inventory’s open ground', () => {
    const meadow = middleSquare(600)
    const trees = grow([{ geometry: meadow, species: null, heightMeters: null, cover: 'herb' }])
    expect(trees.length).toBeGreaterThan(200)
    let shortened = 0
    for (const tree of trees) {
      expect(pointInPolygon(meadow, tree.lng, tree.lat)).toBe(false)
      const half = 100 * (tree.canopy?.reach ?? 0)
      if ((tree.canopy?.reach ?? 0) < 1) shortened += 1
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ])
        expect(pointInPolygon(meadow, tree.lng + (dx * half) / patchEast, tree.lat + (dy * half) / 111_320)).toBe(false)
    }
    expect(shortened).toBeGreaterThan(4)
  })

  it('cuts its tiles out to the stand’s recorded crown closure', () => {
    const stand: InventoryStand = {
      geometry: middleSquare(5000),
      species: 'spruce',
      heightMeters: 28,
      crownClosurePercent: 55,
    }
    const trees = grow([stand])
    expect(trees.length).toBeGreaterThan(200)
    expect(trees.every((tree) => tree.canopy?.reach === 1)).toBe(true)
    expect(trees.every((tree) => Math.abs((tree.canopy?.cover ?? 0) - 0.55) < 1e-9)).toBe(true)
  })

  it('lays its tiles over a stand listed before open ground, as the stems read it', () => {
    // A core stand (a regrowth stand, the core's read) listed before the background's open polygon over the same
    // ground: the stems grow there, and the canopy is not held back from them.
    const ground = middleSquare(5000)
    const trees = grow([
      { geometry: ground, species: 'spruce', heightMeters: 28, crownClosurePercent: 55 },
      { geometry: ground, species: null, heightMeters: null, cover: 'herb' },
    ])
    expect(trees.length).toBeGreaterThan(200)
    expect(trees.every((tree) => tree.canopy?.reach === 1)).toBe(true)
  })
})
