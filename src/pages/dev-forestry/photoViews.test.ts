import { describe, expect, it } from 'vitest'
import type { PhotoPose } from './photoPose'
import {
  castRay,
  DRAPE_MAX_METERS,
  drapePhoto,
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

  it('renders a strip at a time into the same image as a whole render', () => {
    const whole = renderModelView(truth, terrain, stripes, 80)
    const into = {
      width: 80,
      height: modelViewHeight(truth, 80),
      data: new Uint8ClampedArray(80 * modelViewHeight(truth, 80) * 4),
    }
    for (let from = 0; from < into.height; from += 7)
      renderModelView(truth, terrain, stripes, 80, 60000, { from, to: from + 7, into })
    expect(Array.from(into.data)).toEqual(Array.from(whole.data))
  })

  it('samples a tile mosaic by slippy-map position', () => {
    const zoom = 12
    const [tx, ty] = tileXY(-122.5, 53.7, zoom)
    const mosaic = { width: 256, height: 256, data: new Uint8ClampedArray(256 * 256 * 4).fill(7) }
    const sample = mosaicSampler(mosaic, zoom, Math.floor(tx), Math.floor(ty))
    expect(sample(-122.5, 53.7)).toEqual([7, 7, 7])
    expect(sample(-121, 53.7)).toBeNull()
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
