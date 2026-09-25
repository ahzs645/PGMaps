import { describe, expect, it } from 'vitest'

import { landformFromTerrain, traceRings } from './landformFromTerrain'
import type { ElevationSource } from './terrain'
import { metersPerDegree, pointInPolygon, polygonAreaMeters } from './visibility'

const ORIGIN = { lng: -122.6, lat: 53.9 }
const SCALE = metersPerDegree(ORIGIN.lat)
const at = (east: number, north: number): [number, number] => [ORIGIN.lng + east / SCALE.lng, ORIGIN.lat + north / SCALE.lat]
const metres = (lng: number, lat: number) => ({ east: (lng - ORIGIN.lng) * SCALE.lng, north: (lat - ORIGIN.lat) * SCALE.lat })
const rect = (e0: number, n0: number, e1: number, n1: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[at(e0, n0), at(e1, n0), at(e1, n1), at(e0, n1), at(e0, n0)]],
})

/**
 * A north–south ridge 400 m high: a flat valley floor west of 0 m east, the
 * west face rising to a crest at 1.5 km, the east face falling to 3 km. It
 * tapers out north and south of ±2 km.
 */
function ridge({ gully = false, lopsided = false, bench = false } = {}): ElevationSource {
  return {
    elevationAt: (lng, lat) => {
      const { east, north } = metres(lng, lat)
      const along = Math.max(0, 1 - Math.max(0, Math.abs(north) - 2000) / 800)
      const across = east <= 0 || east >= 3000 ? 0 : east <= 1500 ? east / 1500 : (3000 - east) / 1500
      // A 200 m bench halfway up the west face: flat, then the face again.
      const rise = bench && east > 0 && east < 1500 ? (east < 600 ? east : east < 800 ? 600 : east - 200) / 1300 : across
      let height = 400 * (bench && east > 0 && east < 1500 ? rise : across) * along
      // A V-shaped gully down the west face along north = 0.
      if (gully && east > 0 && east < 1500) height -= 80 * Math.max(0, 1 - Math.abs(north) / 250) * (east / 1500)
      // One steep side and one gentle: flow gathers on a single line, as it does on real ground.
      if (lopsided && east > 0 && east < 1500) height -= 80 * Math.max(0, 1 - Math.abs(north) / (north > 0 ? 300 : 120)) * (east / 1500)
      return 600 + height
    },
  }
}

const VIEWER = (() => { const [lng, lat] = at(-3000, 0); return { lng, lat } })()
const contains = (geometry: GeoJSON.Polygon, east: number, north: number) => pointInPolygon(geometry, ...at(east, north))

describe('a landform from the terrain', () => {
  it('takes the face turned to the viewer, stopping at the crest and the valley floor', () => {
    const block = rect(500, 900, 900, 1300)
    const landform = landformFromTerrain(ridge(), block, VIEWER, { radiusMeters: 4000 })!
    expect(landform).not.toBeNull()
    // The west face, both sides of the block and up to the crest.
    for (const [e, n] of [[700, 1100], [200, -1500], [1300, 1800], [1400, 0]]) expect(contains(landform.geometry, e, n), `${e},${n}`).toBe(true)
    // Not the far side of the ridge, nor the valley floor, nor past the ridge's end.
    for (const [e, n] of [[2200, 0], [1800, 1000], [-500, 0], [700, 3200]]) expect(contains(landform.geometry, e, n), `${e},${n}`).toBe(false)
    expect(landform.boundedBy['faces-away']).toBeGreaterThan(0.2)
    expect(landform.boundedBy.flat).toBeGreaterThan(0.2)
    expect(landform.reachedLimit).toBe(false)
    // Roughly 1.5 km up the face by 4–5 km along it.
    expect(landform.areaHectares).toBeGreaterThan(450)
    expect(landform.areaHectares).toBeLessThan(900)
    expect(polygonAreaMeters(landform.geometry) / 10_000).toBeCloseTo(landform.areaHectares, -2)
  })

  it('stops at a shoreline', () => {
    const lake = rect(-500, -3000, 600, 3000)
    const landform = landformFromTerrain(ridge(), rect(900, 900, 1200, 1300), VIEWER, { radiusMeters: 4000, water: [lake] })!
    expect(contains(landform.geometry, 300, 0)).toBe(false)
    expect(contains(landform.geometry, 1000, 0)).toBe(true)
    expect(landform.boundedBy.water).toBeGreaterThan(0)
  })

  it('keeps a drainage big enough to matter out of the face', () => {
    // A perfectly symmetric V splits D8 flow into two parallel lines, each
    // carrying about half the gully, so the threshold sits below that half.
    const landform = landformFromTerrain(ridge({ gully: true }), rect(500, 900, 900, 1300), VIEWER, { radiusMeters: 4000, drainageAreaKm2: 0.15 })!
    expect(landform.boundedBy.drainage).toBeGreaterThan(0)
    // The gully's lower reach, where it drains most of the face, is a valley.
    expect(contains(landform.geometry, 100, 0)).toBe(false)
  })

  it('finds no face for a block on the valley floor', () => {
    const landform = landformFromTerrain(ridge(), rect(-1500, -200, -1100, 200), VIEWER, { radiusMeters: 4000 })!
    expect(landform.blockOnly).toBe(true)
    expect(landform.areaHectares).toBeLessThan(40)
    expect(landformFromTerrain(ridge(), rect(500, 900, 900, 1300), VIEWER, { radiusMeters: 4000 })!.blockOnly).toBe(false)
  })

  it('does not smooth a single-line drainage away with the rest of the outline', () => {
    const landform = landformFromTerrain(ridge({ lopsided: true }), rect(500, 900, 900, 1300), VIEWER, { radiusMeters: 4000, drainageAreaKm2: 0.3 })!
    expect(landform.boundedBy.drainage).toBeGreaterThan(0)
    for (const east of [100, 300]) expect(contains(landform.geometry, east, 0), `${east} m up the gully`).toBe(false)
  })

  it('stays quick with a lake-rich basemap', () => {
    // Forty 2,000-vertex lakes scattered off the face.
    const lakes: GeoJSON.Polygon[] = Array.from({ length: 40 }, (_, k) => {
      const cx = -3500 + (k % 8) * 120, cy = -2500 + Math.floor(k / 8) * 1200
      const ring = Array.from({ length: 2000 }, (_, i) => at(cx + 40 * Math.cos((i / 2000) * 2 * Math.PI), cy + 40 * Math.sin((i / 2000) * 2 * Math.PI)))
      return { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
    })
    const started = performance.now()
    landformFromTerrain(ridge(), rect(500, 900, 900, 1300), VIEWER, { radiusMeters: 4000, water: lakes })
    expect(performance.now() - started).toBeLessThan(3000)
  })

  it('takes a bench on the face in, up to the crest above it', () => {
    const landform = landformFromTerrain(ridge({ bench: true }), rect(200, 900, 450, 1300), VIEWER, { radiusMeters: 4000 })!
    expect(contains(landform.geometry, 700, 1000), 'the bench').toBe(true)
    expect(contains(landform.geometry, 1300, 1000), 'the face above it').toBe(true)
    expect(contains(landform.geometry, 2200, 0), 'the far side').toBe(false)
  })

  it('does not bridge a saddle onto the next hill', () => {
    // Two round hills 3 km apart, north and south, joined by a saddle about 60 m
    // up; the block sits low on the northern hill's west foot, below the saddle.
    const hills: ElevationSource = {
      elevationAt: (lng, lat) => {
        const { east, north } = metres(lng, lat)
        const hill = (n: number) => 300 * Math.exp(-(east * east + (north - n) ** 2) / (2 * 700 * 700))
        return 600 + hill(1500) + hill(-1500)
      },
    }
    const landform = landformFromTerrain(hills, rect(-1300, 1400, -1100, 1600), VIEWER, { radiusMeters: 4000 })!
    expect(contains(landform.geometry, -600, 1500), 'its own hill').toBe(true)
    expect(contains(landform.geometry, -600, -1500), 'the next hill').toBe(false)
  })

  it('reads the face toward a road on the same slope as a whole', () => {
    // The road runs across the lower face, 1 km from the block.
    const [lng, lat] = at(150, 0)
    const landform = landformFromTerrain(ridge(), rect(500, 900, 900, 1300), { lng, lat }, { radiusMeters: 4000 })!
    expect(landform.viewerClose).toBe(true)
    // The face either side of the road, not a sliver cut off at it.
    for (const [e, n] of [[700, -1200], [700, 1800], [1300, 0]]) expect(contains(landform.geometry, e, n), `${e},${n}`).toBe(true)
    expect(landform.areaHectares).toBeGreaterThan(400)
  })

  it('says so when the face runs past the search area', () => {
    const landform = landformFromTerrain(ridge(), rect(500, 900, 900, 1300), VIEWER, { radiusMeters: 1500 })!
    expect(landform.reachedLimit).toBe(true)
    expect(landform.boundedBy['search-limit']).toBeGreaterThan(0)
  })

  it('has nothing to offer without terrain under the block', () => {
    const nothing: ElevationSource = { elevationAt: () => Number.NaN }
    expect(landformFromTerrain(nothing, rect(500, 900, 900, 1300), VIEWER, { radiusMeters: 1000 })).toBeNull()
  })
})

describe('tracing an outline of cells', () => {
  it('walks an L shape as one ring with the cells on its left', () => {
    // ##
    // #.
    const mask = new Uint8Array([1, 0, 1, 1])
    const rings = traceRings(mask, 2, 2)
    expect(rings).toHaveLength(1)
    let area = 0
    const ring = rings[0]
    for (let i = 0; i < ring.length; i += 1) area += ring[i][0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * ring[i][1]
    expect(area / 2).toBe(3)
  })

  it('closes two cells that touch only at a corner as two rings', () => {
    expect(traceRings(new Uint8Array([1, 0, 0, 1]), 2, 2)).toHaveLength(2)
  })
})
