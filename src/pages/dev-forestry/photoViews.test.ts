import { describe, expect, it } from 'vitest'
import type { PhotoPose } from './photoPose'
import {
  castRay,
  DRAPE_MAX_METERS,
  drapePhoto,
  imageryTileRange,
  modelAgreement,
  modelViewHeight,
  mosaicSampler,
  photoEdges,
  renderModelView,
  tileXY,
  type ImagerySampler,
} from './photoViews'

const RAD = Math.PI / 180
const mx = 111320 * Math.cos(53.7 * RAD)
// Ground rising gently to the north-east, with a 300 m hill 2 km north-east of the camera.
const terrain = {
  elevationAt(lng: number, lat: number) {
    const e = (lng + 122.5) * mx,
      n = (lat - 53.7) * 110574
    const hill = 300 * Math.exp(-(((e - 1400) ** 2 + (n - 1400) ** 2) / (350 * 350)))
    return 800 + 0.02 * e + 0.03 * n + hill
  },
}
// Imagery: stripes 200 m wide east–west and north–south, so a misplaced photo is easy to see.
const stripes: ImagerySampler = (lng, lat) => {
  const e = (lng + 122.5) * mx,
    n = (lat - 53.7) * 110574
  return [Math.floor(e / 200) % 2 ? 220 : 40, Math.floor(n / 200) % 2 ? 220 : 40, 120]
}
const camera = (bearing: number): PhotoPose => ({
  lng: -122.5,
  lat: 53.7,
  altitudeMeters: 1500,
  bearing,
  pitch: -25,
  roll: 0,
  width: 600,
  height: 450,
  focalPx: 600 / 2 / Math.tan(30 * RAD),
  k1: 0,
  k2: 0,
})

describe('a camera checked against the map', () => {
  const truth = camera(45)
  const photo = renderModelView(truth, terrain, stripes, 600)

  it('casts a pixel ray to the ground it shows', () => {
    const hit = castRay(truth, terrain, 300, 225)!
    expect(hit.distanceMeters).toBeGreaterThan(500)
    expect(Math.abs(hit.elevation - terrain.elevationAt(hit.lng, hit.lat))).toBeLessThan(1)
  })

  it('lays the photo back where it was taken from the true camera, and hides ground behind the hill', () => {
    const drape = drapePhoto(truth, terrain, photo, { maxMeters: 5000, maxCells: 40_000 })!
    expect(drape.seenShare).toBeGreaterThan(0.5)
    expect(drape.seenShare).toBeLessThan(1)
    const mismatch = (camera: PhotoPose) => {
      const laid = drapePhoto(camera, terrain, photo, { maxMeters: 5000, maxCells: 40_000 })!
      let checked = 0,
        wrong = 0
      for (let row = 0; row < laid.height; row++)
        for (let col = 0; col < laid.width; col++) {
          const o = (row * laid.width + col) * 4
          if (!laid.data[o + 3]) continue
          const lng = laid.bounds[0] + ((col + 0.5) / laid.width) * (laid.bounds[2] - laid.bounds[0])
          const lat = laid.bounds[3] - ((row + 0.5) / laid.height) * (laid.bounds[3] - laid.bounds[1])
          const truthColour = stripes(lng, lat)!
          checked++
          if (Math.abs(laid.data[o] - truthColour[0]) > 60 || Math.abs(laid.data[o + 1] - truthColour[1]) > 60) wrong++
        }
      return wrong / checked
    }
    expect(mismatch(truth)).toBeLessThan(0.15)
    expect(mismatch(camera(65))).toBeGreaterThan(0.35)
  })

  it("scores the true camera's model view above a wrong one against the photo", () => {
    const right = modelAgreement(photo, renderModelView(truth, terrain, stripes, 200))
    const wrong = modelAgreement(photo, renderModelView(camera(80), terrain, stripes, 200))
    expect(right.score).toBeGreaterThan(1.5)
    expect(wrong.score).toBeLessThan(right.score - 0.5)
  }, 20_000)

  it('leaves ground with missing imagery transparent and does not score it', () => {
    const model = renderModelView(truth, terrain, () => null, 100)
    expect(model.data.some((value, i) => i % 4 === 3 && value === 0)).toBe(true)
    expect(modelAgreement(photo, model)).toMatchObject({ coverage: 0, score: Number.NaN })
  })

  it('draws the picture a ray cast through every pixel draws', () => {
    // The model view comes from the hit buffer's one walk per azimuth; this is the slow way it replaced.
    const width = 90
    // Pitched up from the other tests' camera, so the frame's upper part is sky.
    const level = { ...truth, pitch: -10 }
    const view = renderModelView(level, terrain, stripes, width)
    const scale = width / level.width
    expect(view.height).toBe(modelViewHeight(level, width))
    let skyDiffers = 0,
      colourDiffers = 0,
      sky = 0
    for (let y = 0; y < view.height; y++)
      for (let x = 0; x < width; x++) {
        const hit = castRay(level, terrain, (x + 0.5) / scale, (y + 0.5) / scale)
        const i = (y * width + x) * 4
        const drawnSky = view.data[i] === 170 && view.data[i + 1] === 200 && view.data[i + 2] === 235
        if (!hit) sky++
        if (!hit !== drawnSky) {
          skyDiffers++
          continue
        }
        if (!hit) continue
        const haze = Math.min(0.6, hit.distanceMeters / 60000)
        const expected = stripes(hit.lng, hit.lat)!.map((v, k) => v * (1 - haze) + [175, 190, 215][k] * haze)
        if (expected.some((v, k) => Math.abs(v - view.data[i + k]) > 2)) colourDiffers++
      }
    const pixels = width * view.height
    expect(sky).toBeGreaterThan(pixels * 0.05)
    expect(sky).toBeLessThan(pixels * 0.95)
    expect(skyDiffers / pixels).toBeLessThan(0.005)
    // A stripe edge is a pixel wide here: a hit a metre apart can land on the other colour.
    expect(colourDiffers / pixels).toBeLessThan(0.02)
  })

  it('samples a tile mosaic by slippy-map position', () => {
    const zoom = 12
    const [tx, ty] = tileXY(-122.5, 53.7, zoom)
    const mosaic = { width: 256, height: 256, data: new Uint8ClampedArray(256 * 256 * 4).fill(7) }
    const sample = mosaicSampler(mosaic, zoom, Math.floor(tx), Math.floor(ty))
    expect(sample(-122.5, 53.7)).toEqual([7, 7, 7])
    expect(sample(-121, 53.7)).toBeNull()
    const x = Math.floor((tx % 1) * 256)
    const y = Math.floor((ty % 1) * 256)
    mosaic.data[(y * 256 + x) * 4 + 3] = 0
    expect(sample(-122.5, 53.7)).toBeNull()
  })

  it('interpolates across pixels and preserves the local color next to missing imagery', () => {
    const zoom = 12
    const [tx, ty] = tileXY(-122.5, 53.7, zoom)
    const mosaic = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 0, 0, 0, 255, 100, 100, 100, 255]),
    }
    const sample = mosaicSampler(mosaic, zoom, tx - 1 / 256, ty - 1 / 256)
    expect(sample(-122.5, 53.7)).toEqual([50, 50, 50])
    mosaic.data[3] = 0
    expect(sample(-122.5, 53.7)).toEqual([100, 100, 100])
  })

  it("traces the frame's footprint round the frame, around the ground the camera sees", () => {
    const drape = drapePhoto(truth, terrain, photo, { maxCells: 40_000 })!
    expect(drape.footprint).toHaveLength(96)
    // Every footprint point lies on the drape's box, and the centre ray's ground lies inside the ring.
    for (const [lng, lat] of drape.footprint) {
      expect(lng).toBeGreaterThanOrEqual(drape.bounds[0] - 1e-9)
      expect(lng).toBeLessThanOrEqual(drape.bounds[2] + 1e-9)
      expect(lat).toBeGreaterThanOrEqual(drape.bounds[1] - 1e-9)
      expect(lat).toBeLessThanOrEqual(drape.bounds[3] + 1e-9)
    }
    const centre = castRay(truth, terrain, 300, 225)!
    let inside = false
    const ring = drape.footprint
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
      if (
        ring[i][1] > centre.lat !== ring[j][1] > centre.lat &&
        centre.lng < ((ring[j][0] - ring[i][0]) * (centre.lat - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]
      )
        inside = !inside
    expect(inside).toBe(true)
    // The first quarter is the top edge, left to right: it runs across the view, from the left of the bearing.
    const [first, last] = [ring[0], ring[23]]
    const across = (p: readonly number[]) =>
      (p[0] + 122.5) * mx * Math.cos(45 * (Math.PI / 180)) - (p[1] - 53.7) * 110574 * Math.sin(45 * (Math.PI / 180))
    expect(across(last)).toBeGreaterThan(across(first))
  })

  it('tells ground hidden by terrain apart from ground out of frame', () => {
    const drape = drapePhoto(truth, terrain, photo, { maxCells: 40_000 })!
    let hidden = 0,
      outOfFrame = 0,
      seen = 0
    for (let cell = 0; cell < drape.width * drape.height; cell++) {
      const opaque = drape.data[cell * 4 + 3] === 255
      if (drape.hiddenMask[cell]) {
        expect(opaque).toBe(false)
        hidden++
      } else if (opaque) seen++
      else outOfFrame++
    }
    expect(hidden).toBeGreaterThan(50)
    expect(outOfFrame).toBeGreaterThan(50)
    expect(seen / (seen + hidden)).toBeCloseTo(drape.seenShare, 5)
    // The hidden cells sit behind the hill, 2 km north-east of the camera: further out than it along the bearing.
    let along = 0
    for (let cell = 0; cell < drape.width * drape.height; cell++) {
      if (!drape.hiddenMask[cell]) continue
      const col = cell % drape.width,
        row = Math.floor(cell / drape.width)
      const lng = drape.bounds[0] + ((col + 0.5) / drape.width) * (drape.bounds[2] - drape.bounds[0])
      const lat = drape.bounds[3] - ((row + 0.5) / drape.height) * (drape.bounds[3] - drape.bounds[1])
      along += ((lng + 122.5) * mx + (lat - 53.7) * 110574) / Math.SQRT2
    }
    expect(along / hidden).toBeGreaterThan(1980)
  })

  it('takes its range from the frame, capped where the frame reaches the sky', () => {
    // Looking well down, every edge ray meets ground within a few kilometres: the range is the furthest of them.
    const down = drapePhoto({ ...camera(45), pitch: -45 }, terrain, photo, { maxCells: 20_000 })!
    expect(down.rangeMeters).toBeGreaterThan(1500)
    expect(down.rangeMeters).toBeLessThan(8000)
    // Level, the top edge looks into the sky: the drape reaches the cap, past the old 8 km stop.
    const level = { ...camera(45), pitch: 0 }
    const far = drapePhoto(level, terrain, photo, { maxCells: 20_000 })!
    expect(far.rangeMeters).toBe(DRAPE_MAX_METERS)
    const span = (far.bounds[2] - far.bounds[0]) * mx
    expect(span).toBeGreaterThan(16000)
    expect(drapePhoto(level, terrain, photo, { maxMeters: 5000, maxCells: 20_000 })!.rangeMeters).toBe(5000)
  })

  it("drapes the photo's edges in the one colour it is given", () => {
    const colour = [12, 240, 200] as const
    const edges = drapePhoto(truth, terrain, photo, { maxCells: 40_000, edges: { rgb: colour } })!
    const filled = drapePhoto(truth, terrain, photo, { maxCells: 40_000 })!
    let drawn = 0,
      seen = 0
    for (let cell = 0; cell < edges.width * edges.height; cell++) {
      if (filled.data[cell * 4 + 3]) seen++
      if (!edges.data[cell * 4 + 3]) continue
      drawn++
      expect([edges.data[cell * 4], edges.data[cell * 4 + 1], edges.data[cell * 4 + 2]]).toEqual([...colour])
      expect(filled.data[cell * 4 + 3]).toBe(255)
    }
    expect(drawn / seen).toBeGreaterThan(0.03)
    expect(drawn / seen).toBeLessThan(0.6)
    const fewer = drapePhoto(truth, terrain, photo, { maxCells: 40_000, edges: { rgb: colour, share: 0.01 } })!
    expect(fewer.data.filter((_, i) => i % 4 === 3 && fewer.data[i] > 0).length).toBeLessThan(drawn)
    expect(Array.from(edges.hiddenMask)).toEqual(Array.from(filled.hiddenMask))
    expect(edges.seenShare).toBe(filled.seenShare)
    // Flat colour has no edges.
    const flat = { width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4).fill(128) }
    expect(photoEdges(flat).every((v) => v === 0)).toBe(true)
  })
})

describe('imageryTileRange', () => {
  // About 12 km square round a made-up place.
  const box: [number, number, number, number] = [-122.59, 53.85, -122.41, 53.95]

  it('takes the tiles the box touches at the zoom asked for when they are few enough', () => {
    const range = imageryTileRange(box, 11)
    expect(range.zoom).toBe(11)
    const [x0, y0] = tileXY(box[0], box[3], 11)
    expect([range.minX, range.minY]).toEqual([Math.floor(x0), Math.floor(y0)])
    expect(range.maxX).toBeGreaterThanOrEqual(range.minX)
  })

  it('drops the zoom until the box fits the tile budget', () => {
    const fine = imageryTileRange(box, 16, 64)
    expect(fine.zoom).toBeLessThan(16)
    expect((fine.maxX - fine.minX + 1) * (fine.maxY - fine.minY + 1)).toBeLessThanOrEqual(64)
    // One zoom finer would not have fitted.
    const finer = imageryTileRange(box, fine.zoom + 1, Infinity)
    expect((finer.maxX - finer.minX + 1) * (finer.maxY - finer.minY + 1)).toBeGreaterThan(64)
  })
})
