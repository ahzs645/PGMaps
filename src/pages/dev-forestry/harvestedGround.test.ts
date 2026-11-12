import { describe, expect, it } from 'vitest'
import { placeTrees } from './forest'
import { debrisMesh, placeDebris, placeEdgeTrees, roadScar } from './harvestedGround'
import { metersPerDegree, pointInPolygon, type PolygonGeometry } from './visibility'

const LAT = 53.9
const LNG = -122.6
const m = metersPerDegree(LAT)

/** A square of side `size` metres, south-west corner `east`/`north` metres from the origin. */
function square(east: number, north: number, size: number, hole?: [number, number, number]): GeoJSON.Polygon {
  const ring = (e: number, n: number, s: number) => [
    [LNG + e / m.lng, LAT + n / m.lat],
    [LNG + (e + s) / m.lng, LAT + n / m.lat],
    [LNG + (e + s) / m.lng, LAT + (n + s) / m.lat],
    [LNG + e / m.lng, LAT + (n + s) / m.lat],
    [LNG + e / m.lng, LAT + n / m.lat],
  ]
  return { type: 'Polygon', coordinates: hole ? [ring(east, north, size), ring(...hole)] : [ring(east, north, size)] }
}

const box = (west: number, south: number, east: number, north: number): [number, number, number, number] => [
  LNG + west / m.lng,
  LAT + south / m.lat,
  LNG + east / m.lng,
  LAT + north / m.lat,
]

describe('slash and stumps on harvested ground', () => {
  const block = square(0, 0, 200)
  const bounds = box(-100, -100, 300, 300)

  it('lies only on the opening, at about the density asked for', () => {
    const piles = placeDebris([block], bounds, 12)
    expect(piles.every((pile) => pointInPolygon(block as PolygonGeometry, pile.lng, pile.lat))).toBe(true)
    // 4 ha at one pile per 144 m² is about 278.
    expect(piles.length).toBeGreaterThan(240)
    expect(piles.length).toBeLessThan(320)
  })

  it('puts the same piles on the same ground however the area is tiled', () => {
    const whole = placeDebris([block], bounds, 12)
    const west = placeDebris([block], box(-100, -100, 100, 300), 12)
    const east = placeDebris([block], box(100, -100, 300, 300), 12)
    const key = (pile: { lng: number; lat: number }) => `${pile.lng.toFixed(8)},${pile.lat.toFixed(8)}`
    expect(new Set([...west, ...east].map(key))).toEqual(new Set(whole.map(key)))
  })

  it('draws a pile as low wood, about a metre tall at most', () => {
    const mesh = debrisMesh(1)
    const positions = mesh.attributes.positions.value
    let top = 0
    for (let i = 2; i < positions.length; i += 3) top = Math.max(top, positions[i])
    expect(top).toBeLessThan(0.75)
    expect(Array.from(mesh.attributes.bark!.value).every((value) => value === 1)).toBe(true)
  })
})

describe('a hard edge where the block meets the timber', () => {
  const block = square(0, 0, 200)
  const bounds = box(-100, -100, 300, 300)

  it('stands a row of stems just outside the opening, all the way round', () => {
    const trees = placeEdgeTrees({ openings: [block], clearings: [], bounds, spacingMeters: 6, setbackMeters: 2.5 })
    expect(trees.every((tree) => !pointInPolygon(block as PolygonGeometry, tree.lng, tree.lat))).toBe(true)
    // 800 m of edge at 6 m is about 133 stems.
    expect(trees.length).toBeGreaterThan(120)
    expect(trees.length).toBeLessThan(145)
    // Each within a few metres of the edge.
    const outside = (tree: { lng: number; lat: number }) => {
      const east = (tree.lng - LNG) * m.lng
      const north = (tree.lat - LAT) * m.lat
      const dx = Math.max(0 - east, 0, east - 200)
      const dy = Math.max(0 - north, 0, north - 200)
      return Math.hypot(dx, dy)
    }
    expect(Math.max(...trees.map(outside))).toBeLessThan(4)
  })

  it('leaves out stems that would stand in water, on a road or on ground that is not forest', () => {
    const lake = square(-50, 50, 45)
    const trees = placeEdgeTrees({
      openings: [block],
      clearings: [lake],
      bounds,
      inventory: [{ geometry: square(150, -60, 100), species: null, heightMeters: null, cover: 'rock' }],
    })
    expect(trees.some((tree) => pointInPolygon(lake as PolygonGeometry, tree.lng, tree.lat))).toBe(false)
    const rock = square(150, -60, 100) as PolygonGeometry
    expect(trees.some((tree) => pointInPolygon(rock, tree.lng, tree.lat))).toBe(false)
  })
})

describe('retention patches inside a block', () => {
  it('stay standing timber when the block carries them as holes', () => {
    // A 300 m block with a 60 m retention patch left in its middle.
    const block = square(0, 0, 300, [120, 120, 60])
    const trees = placeTrees({
      stands: [],
      clearings: [block],
      centre: { lng: LNG + 150 / m.lng, lat: LAT + 150 / m.lat },
      radiusMeters: 200,
      spacingMeters: 4,
      seed: 3,
    })
    const inPatch = trees.filter((tree) => {
      const east = (tree.lng - LNG) * m.lng
      const north = (tree.lat - LAT) * m.lat
      return east > 120 && east < 180 && north > 120 && north < 180
    })
    const inBlock = trees.filter((tree) => pointInPolygon(block as PolygonGeometry, tree.lng, tree.lat))
    // 0.36 ha at 550 stems/ha is about 200.
    expect(inPatch.length).toBeGreaterThan(150)
    expect(inBlock).toHaveLength(0)
  })
})

describe('road cut and fill', () => {
  // A road running north, on ground that rises to the west at 30%.
  const road: Array<[number, number]> = [0, 50, 100, 150, 200].map((n) => [LNG, LAT + n / m.lat])
  const sideSlope = (lng: number) => -((lng - LNG) * m.lng) * 0.3

  it('cuts a bank on the uphill side and spills fill down the other, by the bench geometry', () => {
    const strips = roadScar(road, (lng) => sideSlope(lng), { roadWidthMeters: 8 })
    const cut = strips.find((strip) => strip.kind === 'cut')!
    const fill = strips.find((strip) => strip.kind === 'fill')!
    // Half-width 4 on a 30% slope: a 1:1 cut reaches 4·0.3/0.7 = 1.71 m past the
    // road edge, a 1.5:1 fill 4·0.3/(0.667 − 0.3) = 3.27 m.
    const reach = (strip: typeof cut) =>
      Math.max(...strip.geometry.coordinates[0].map(([lng]) => Math.abs(lng - LNG) * m.lng)) - 4
    expect(reach(cut)).toBeCloseTo(1.71, 1)
    expect(reach(fill)).toBeCloseTo(3.27, 1)
    // Uphill is west, so the cut lies west of the road.
    expect(Math.max(...cut.geometry.coordinates[0].map(([lng]) => lng))).toBeLessThanOrEqual(LNG)
    expect(Math.min(...fill.geometry.coordinates[0].map(([lng]) => lng))).toBeGreaterThanOrEqual(LNG)
  })

  it('leaves flat ground unscarred', () => {
    expect(roadScar(road, () => 700, { roadWidthMeters: 8 })).toEqual([])
  })
})
