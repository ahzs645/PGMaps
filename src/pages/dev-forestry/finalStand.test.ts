import { describe, expect, it } from 'vitest'
import {
  FINAL_STAND_MAX_CROWN_TO_HEIGHT,
  finalStandBearings,
  finalStandRadius,
  finalStandSteps,
  moveStandOrigin,
  type FinalStand,
  type FinalStandInput,
} from './finalStand'
import { REGIONAL_STAND } from './forest'
import { SCENE_TREE_FIELDS } from './scenePackage'
import { metersPerDegree, pointInPolygon } from './visibility'

const eye = { lng: -122.905, lat: 50.846 }
const m = metersPerDegree(eye.lat)
const flat = { elevationAt: () => 800 }
const F = SCENE_TREE_FIELDS.length

/** A square `size` metres across, its south-west corner `east`, `north` metres from the eye; holes likewise. */
const ring = (east: number, north: number, size: number) => [
  [eye.lng + east / m.lng, eye.lat + north / m.lat],
  [eye.lng + (east + size) / m.lng, eye.lat + north / m.lat],
  [eye.lng + (east + size) / m.lng, eye.lat + (north + size) / m.lat],
  [eye.lng + east / m.lng, eye.lat + (north + size) / m.lat],
  [eye.lng + east / m.lng, eye.lat + north / m.lat],
]
const square = (east: number, north: number, size: number, hole?: [number, number, number]): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: hole ? [ring(east, north, size), ring(...hole).reverse()] : [ring(east, north, size)],
})

const forest = (change: Partial<FinalStandInput['forest']> = {}): FinalStandInput['forest'] => ({
  anchorLatitude: eye.lat,
  stands: [],
  clearings: [],
  openings: [],
  thinnings: [],
  inventory: [],
  standHeightMeters: REGIONAL_STAND.heightMeters,
  ...change,
})

const grow = (change: Partial<FinalStandInput> = {}): FinalStand => {
  const steps = finalStandSteps(
    { origin: eye, eye, radiusMeters: 600, bearings: [0, 60], forest: forest(), elevation: flat, ...change },
    1e9,
  )
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}

/** Each stem as a record, in metres from the eye. */
const stems = (stand: FinalStand) =>
  Array.from({ length: stand.count }, (_, i) => {
    const o = i * F
    const d = stand.data
    return { x: d[o], y: d[o + 1], z: d[o + 2], species: d[o + 3], height: d[o + 4], crown: d[o + 5], tone: d[o + 6] }
  })
const lngLat = (x: number, y: number) => [eye.lng + x / m.lng, eye.lat + y / m.lat] as const

describe('the final stand', () => {
  it('grows the stand at its real stem density, with real crowns', () => {
    const stand = grow()
    const trees = stems(stand)
    // 100–550 m in a 60° sector, clear of the ragged edges.
    const inRing = trees.filter((t) => {
      const d = Math.hypot(t.x, t.y)
      const b = (Math.atan2(t.x, t.y) * 180) / Math.PI
      return d >= 100 && d < 550 && b >= 5 && b < 55
    })
    const hectares = ((50 / 360) * Math.PI * (550 ** 2 - 100 ** 2)) / 10_000
    expect(inRing.length / hectares).toBeGreaterThan(REGIONAL_STAND.stemsPerHa * 0.93)
    expect(inRing.length / hectares).toBeLessThan(REGIONAL_STAND.stemsPerHa * 1.07)
    const crowns = trees.map((t) => t.crown).sort((a, b) => a - b)
    const median = crowns[crowns.length >> 1]
    expect(median).toBeGreaterThan(2.5)
    expect(median).toBeLessThan(4.5)
    for (const t of trees) expect(t.crown).toBeLessThanOrEqual(t.height * FINAL_STAND_MAX_CROWN_TO_HEIGHT + 1e-4)
    expect(stand.fields).toEqual(SCENE_TREE_FIELDS)
    expect(stand.clipped).toBe(false)
    expect(stand.radiusMeters).toBe(600)
  })

  it('keeps to the radius and the bearings', () => {
    const stand = grow({ bearings: [350, 380] })
    expect(stand.count).toBeGreaterThan(1000)
    for (const t of stems(stand)) {
      expect(Math.hypot(t.x, t.y)).toBeLessThan(600)
      const b = ((((Math.atan2(t.x, t.y) * 180) / Math.PI) % 360) + 360) % 360
      expect(b >= 350 || b <= 20).toBe(true)
    }
  })

  it('follows a surveyed stand’s own stem count', () => {
    const stand = grow({
      forest: forest({
        inventory: [
          {
            geometry: square(-2000, -2000, 4000),
            species: 'pine',
            heightMeters: 20,
            stemsPerHa: 300,
            crownClosurePercent: 30,
          },
        ],
      }),
    })
    const trees = stems(stand).filter((t) => Math.hypot(t.x, t.y) >= 100 && Math.hypot(t.x, t.y) < 550)
    const hectares = ((60 / 360) * Math.PI * (550 ** 2 - 100 ** 2)) / 10_000
    expect(trees.length / hectares).toBeGreaterThan(270)
    expect(trees.length / hectares).toBeLessThan(330)
    expect(new Set(trees.map((t) => t.species)).size).toBe(1)
  })

  it('is the same stand every time', () => {
    const a = grow()
    const b = grow()
    expect(a.count).toBe(b.count)
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('grows nothing in openings or water, and keeps a reserve’s stems', () => {
    // A block 200 m square with a 60 m reserve in it, and a lake beside it.
    const block = square(100, 200, 200, [170, 270, 60])
    const lake = square(320, 200, 150)
    const stand = grow({ forest: forest({ clearings: [block, lake], openings: [block] }) })
    const trees = stems(stand)
    const inBlock = trees.filter((t) => pointInPolygon(block, ...lngLat(t.x, t.y)))
    const inLake = trees.filter((t) => pointInPolygon(lake, ...lngLat(t.x, t.y)))
    expect(inBlock).toHaveLength(0)
    expect(inLake).toHaveLength(0)
    const reserve = trees.filter((t) => t.x >= 172 && t.x < 228 && t.y >= 272 && t.y < 328)
    // 56 m square at 550 stems/ha: about 172 stems.
    expect(reserve.length).toBeGreaterThan(140)
  })

  it('brings the radius in to the stem budget and stays complete inside it', () => {
    const full = grow({ radiusMeters: 1500 })
    const capped = grow({ radiusMeters: 1500, maxStems: Math.floor(full.count / 3) })
    expect(capped.clipped).toBe(true)
    expect(capped.radiusMeters).toBeLessThan(1500)
    expect(capped.count).toBeLessThanOrEqual(Math.floor(full.count / 3))
    // Every stem the full stand has inside the capped radius, and none past it.
    const inside = stems(full).filter((t) => Math.hypot(t.x, t.y) < capped.radiusMeters).length
    expect(capped.count).toBe(inside)
  })

  it('takes its span from the frames and its reach from the landform', () => {
    const frames = [
      { bearingDeg: 340, hfovDeg: 40 },
      { bearingDeg: 20, hfovDeg: 40 },
    ]
    expect(finalStandBearings(frames)).toEqual([317, 403])
    expect(finalStandBearings([{ bearingDeg: 90, hfovDeg: 40 }], 0)).toEqual([70, 110])
    expect(finalStandRadius(6307)).toBe(7400)
  })

  it('moves to another package origin', () => {
    const stand = grow({ radiusMeters: 200 })
    const x0 = stand.data[0]
    moveStandOrigin(stand, eye, { lng: eye.lng - 100 / m.lng, lat: eye.lat })
    expect(stand.data[0]).toBeCloseTo(x0 + 100, 2)
  })
})
