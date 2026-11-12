import { describe, expect, it } from 'vitest'
import { visibleFaceLandform } from './ridgeLayers'
import { metersPerDegree, pointInPolygon, polygonBounds } from './visibility'

/**
 * Looking north from a lakeshore: lake to 800 m, a face rising to a crest at 3 km, a hidden valley,
 * and a higher ridge behind from 4 km to 7 km.
 */
const STATION = { lng: -124.5, lat: 50.2 }
const m = metersPerDegree(STATION.lat)
const at = (x: number, y: number): [number, number] => [STATION.lng + x / m.lng, STATION.lat + y / m.lat]
const local = (lng: number, lat: number) => [(lng - STATION.lng) * m.lng, (lat - STATION.lat) * m.lat]
const ground = {
  elevationAt(lng: number, lat: number) {
    const [, y] = local(lng, lat)
    if (y < 800) return 500
    if (y < 3000) return 500 + ((y - 800) / 2200) * 400
    if (y < 4000) return 900 - ((y - 3000) / 1000) * 300
    if (y < 7000) return 600 + ((y - 4000) / 3000) * 700
    return 1300
  },
}
const box = (x0: number, y0: number, x1: number, y1: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]],
})
const LAKE = box(-8000, -200, 8000, 800)
const ON_FACE = box(-300, 1500, 300, 2000)
const BEHIND_CREST = box(-300, 3400, 300, 3700)

const yRange = (geometry: GeoJSON.Polygon) => {
  const [w, s, e, n] = polygonBounds(geometry)
  return { south: local(w, s)[1], north: local(e, n)[1], west: local(w, s)[0], east: local(e, n)[0] }
}

describe('the visible face from the viewpoint', () => {
  it('is the front face: from the shoreline to its crest, never the lake or the ridge behind', () => {
    const face = visibleFaceLandform(ground, ON_FACE, STATION, { water: [LAKE] })!
    expect(face.method).toBe('visible-face')
    expect(face.seededBy).toBe('block')
    const r = yRange(face.geometry)
    expect(r.south).toBeGreaterThan(700)
    expect(r.north).toBeLessThan(3200)
    expect(r.north).toBeGreaterThan(2700)
    expect(pointInPolygon(face.geometry, ...at(0, 400))).toBe(false)
    expect(pointInPolygon(face.geometry, ...at(0, 5000))).toBe(false)
    expect(pointInPolygon(face.geometry, ...at(0, 2500))).toBe(true)
    expect(face.boundedBy.water ?? 0).toBeGreaterThan(0.05)
  })

  it('stays inside the viewing frame', () => {
    const face = visibleFaceLandform(ground, ON_FACE, STATION, {
      water: [LAKE],
      frame: { bearingDeg: 0, hfovDeg: 40 },
    })!
    const r = yRange(face.geometry)
    // At most 3 km out, 20° either side is about 1.1 km.
    expect(Math.max(Math.abs(r.west), Math.abs(r.east))).toBeLessThan(1300)
    expect(face.frame).toEqual({ bearingDeg: 0, hfovDeg: 40 })
  })

  it('takes the face in front of a hidden block', () => {
    const face = visibleFaceLandform(ground, BEHIND_CREST, STATION, { water: [LAKE] })!
    expect(face.seededBy).toBe('in-front')
    expect(pointInPolygon(face.geometry, ...at(0, 2500))).toBe(true)
    expect(pointInPolygon(face.geometry, ...at(0, 3500))).toBe(false)
  })

  it('runs the first-crest and draw options, which stay off by default', () => {
    const plain = visibleFaceLandform(ground, ON_FACE, STATION, { water: [LAKE] })!
    const crest = visibleFaceLandform(ground, ON_FACE, STATION, { water: [LAKE], stopAtFirstCrest: true })!
    const draws = visibleFaceLandform(ground, ON_FACE, STATION, { water: [LAKE], splitAtDraws: true })!
    // On a plain face neither has anything to cut.
    expect(crest.areaHectares).toBeCloseTo(plain.areaHectares, -1)
    expect(draws.areaHectares).toBeGreaterThan(0)
  })

  it('without water the lake is foreground land, not a break', () => {
    const dry = visibleFaceLandform(ground, ON_FACE, STATION)!
    expect(yRange(dry.geometry).south).toBeLessThan(700)
  })
})

describe('against a landform drawn on a BC VIA sheet', () => {
  it('reads close to the study’s back-projected landform (doc 22, sheet p027)', async () => {
    const { readFileSync } = await import('node:fs')
    const { ridgeLayerLandform } = await import('./ridgeLayers')
    const fixture = JSON.parse(
      readFileSync(new URL('./fixtures/visible-face-sheet22-p027.json', import.meta.url), 'utf8'),
    ) as {
      grid: { west: number; south: number; cellMeters: number; width: number; height: number; int16Base64: string }
      camera: { lng: number; lat: number; eyeElevation: number; bearingDeg: number; hfovDeg: number }
      landform: GeoJSON.Polygon | GeoJSON.MultiPolygon
      blocks: Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>
    }
    const { grid, camera } = fixture
    const bytes = Buffer.from(grid.int16Base64, 'base64')
    const values = new Int16Array(bytes.buffer, bytes.byteOffset, grid.width * grid.height)
    const gm = metersPerDegree(camera.lat)
    // Bilinear, as the page's elevation grid reads: nearest-cell steps hide the back of every step.
    const source = {
      elevationAt(lng: number, lat: number) {
        const x = ((lng - grid.west) * gm.lng) / grid.cellMeters - 0.5,
          y = ((lat - grid.south) * gm.lat) / grid.cellMeters - 0.5
        const i = Math.floor(x),
          j = Math.floor(y)
        if (i < 0 || j < 0 || i + 1 >= grid.width || j + 1 >= grid.height) return NaN
        const fx = x - i,
          fy = y - j
        const v = (a: number, b: number) => values[b * grid.width + a]
        return (
          v(i, j) * (1 - fx) * (1 - fy) +
          v(i + 1, j) * fx * (1 - fy) +
          v(i, j + 1) * (1 - fx) * fy +
          v(i + 1, j + 1) * fx * fy
        )
      },
    }
    const block = fixture.blocks[0]
    const station = { lng: camera.lng, lat: camera.lat }
    const face = visibleFaceLandform(source, block, station, {
      frame: { bearingDeg: camera.bearingDeg, hfovDeg: camera.hfovDeg },
      waterLevelMeters: 0,
      eyeHeightMeters: camera.eyeElevation - Math.max(0, source.elevationAt(camera.lng, camera.lat)),
    })!
    const ridge = ridgeLayerLandform(source, block, [station], { eyeHeightMeters: camera.eyeElevation })
    // Intersection over union on a 30 m grid over the reference landform's surroundings.
    const iou = (a: GeoJSON.Polygon | GeoJSON.MultiPolygon | null) => {
      if (!a) return 0
      const [w, s, e, n] = polygonBounds(fixture.landform)
      const pad = 0.03
      let both = 0,
        either = 0
      for (let lat = s - pad; lat <= n + pad; lat += 30 / gm.lat)
        for (let lng = w - pad * 1.6; lng <= e + pad * 1.6; lng += 30 / gm.lng) {
          const inA = pointInPolygon(a, lng, lat),
            inB = pointInPolygon(fixture.landform, lng, lat)
          if (inA && inB) both++
          if (inA || inB) either++
        }
      return both / Math.max(1, either)
    }
    const faceIou = iou(face.geometry)
    // The study's prototype read 0.58 here on a 12 m DEM; this fixture's ground is 60 m.
    expect(faceIou).toBeGreaterThan(0.35)
    expect(faceIou).toBeGreaterThan(iou(ridge?.geometry ?? null))
  }, 20_000)
})
