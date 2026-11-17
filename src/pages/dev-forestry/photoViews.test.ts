import { describe, expect, it } from 'vitest'
import type { PhotoPose } from './photoPose'
import {
  castRay,
  drapePhoto,
  modelAgreement,
  modelViewHeight,
  mosaicSampler,
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
  })

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
})
