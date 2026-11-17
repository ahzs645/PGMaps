import { describe, expect, it } from 'vitest'

import { bearingTicks, distanceContours, horizonLine, photoOverlay, type PhotoFeature } from './photoOverlay'
import { buildHitBuffer, hitAt, type HitBuffer } from './photoHitBuffer'
import type { PhotoPose } from './photoPose'

const RAD = Math.PI / 180
// A made-up place; nothing here is a real photo's.
const LNG = -122.5,
  LAT = 53.7
const mx = 111320 * Math.cos(LAT * RAD)
const at = (east: number, north: number): [number, number] => [LNG + east / mx, LAT + north / 110574]
const local = (lng: number, lat: number) => [(lng - LNG) * mx, (lat - LAT) * 110574] as const

const plane = { elevationAt: () => 800 }
// Level ground at 800 m with an east–west ridge 400 m high 3 km north.
const ridge = {
  elevationAt(lng: number, lat: number) {
    const [, n] = local(lng, lat)
    return 800 + 400 * Math.exp(-(((n - 3000) / 300) ** 2))
  },
}

const camera = (over: Partial<PhotoPose> = {}): PhotoPose => ({
  lng: LNG,
  lat: LAT,
  altitudeMeters: 900,
  bearing: 0,
  pitch: -2,
  roll: 0,
  width: 600,
  height: 450,
  focalPx: 600 / 2 / Math.tan(30 * RAD),
  k1: 0,
  k2: 0,
  ...over,
})

const square = (layer: string, east: number, north: number, half: number, id = layer): PhotoFeature => ({
  layer,
  id,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        at(east - half, north - half),
        at(east + half, north - half),
        at(east + half, north + half),
        at(east - half, north + half),
        at(east - half, north - half),
      ],
    ],
  },
})

const allPoints = (paths: { visibleParts: number[][][]; hiddenParts: number[][][] }) => [
  ...paths.visibleParts.flat(),
  ...paths.hiddenParts.flat(),
]

describe('photoOverlay', () => {
  const pose = camera()
  const buf = buildHitBuffer(pose, ridge, { width: 300 })

  it('draws a block in front of the ridge in sight and one behind it hidden', () => {
    const [front, behind] = photoOverlay(
      pose,
      buf,
      [square('proposedBlocks', 0, 1500, 150, 'front'), square('proposedBlocks', 0, 5000, 300, 'behind')],
      { ground: ridge },
    )
    expect(front.id).toBe('front')
    expect(front.visible.length).toBeGreaterThan(0)
    expect(front.hidden).toEqual([])
    expect(front.labelAnchor).not.toBeNull()
    expect(behind.visible).toEqual([])
    expect(behind.hidden.length).toBeGreaterThan(0)
    expect(behind.labelAnchor).toBeNull()
  })

  it('joins a ring seen whole into one closed run', () => {
    const [front] = photoOverlay(pose, buf, [square('lakes', 0, 1500, 150)], { ground: ridge })
    expect(front.visibleParts).toHaveLength(1)
    const run = front.visibleParts[0]
    expect(run[0][0]).toBeCloseTo(run[run.length - 1][0], 6)
    expect(run[0][1]).toBeCloseTo(run[run.length - 1][1], 6)
    expect(front.visible[0].startsWith('M')).toBe(true)
  })

  it('splits a line where it goes behind the ridge, and joins the two parts there', () => {
    const line: PhotoFeature = {
      layer: 'roads',
      geometry: { type: 'LineString', coordinates: [at(0, 1000), at(0, 6000)] },
    }
    const [drawn] = photoOverlay(pose, buf, [line], { ground: ridge })
    expect(drawn.visibleParts.length).toBeGreaterThan(0)
    expect(drawn.hiddenParts.length).toBeGreaterThan(0)
    // The hidden part starts where a visible part ends: the line is unbroken on the photo.
    const ends = drawn.visibleParts.map((run) => run[run.length - 1])
    const start = drawn.hiddenParts[0][0]
    expect(ends.some(([x, y]) => Math.hypot(x - start[0], y - start[1]) < 1e-9)).toBe(true)
  })

  it('densifies a long edge so it follows the terrain over the ridge', () => {
    const line: PhotoFeature = {
      layer: 'roads',
      geometry: { type: 'LineString', coordinates: [at(-200, 1000), at(-200, 2900)] },
    }
    const [drawn] = photoOverlay(pose, buf, [line], { ground: ridge })
    const points = drawn.visibleParts.flat()
    expect(points.length).toBeGreaterThan(20)
    // Up the ridge's face the line bends: its middle sits well off the chord between its ends.
    const first = points[0],
      last = points[points.length - 1],
      middle = points[Math.floor(points.length / 2)]
    const chordY = first[1] + ((middle[0] - first[0]) / (last[0] - first[0] || 1)) * (last[1] - first[1])
    expect(Math.abs(middle[1] - chordY)).toBeGreaterThan(1)
  })

  it('clips at the frame and leaves out what is behind the camera', () => {
    const [wide, back] = photoOverlay(pose, buf, [square('vri', 0, 2000, 4000), square('vri', 0, -2000, 300)], {
      ground: ridge,
    })
    const points = allPoints(wide)
    expect(points.length).toBeGreaterThan(0)
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(-1e-6)
      expect(x).toBeLessThanOrEqual(pose.width + 1e-6)
      expect(y).toBeGreaterThanOrEqual(-1e-6)
      expect(y).toBeLessThanOrEqual(pose.height + 1e-6)
    }
    expect(back.visible).toEqual([])
    expect(back.hidden).toEqual([])
    expect(back.markers).toEqual([])
  })

  it('marks points in front of the ridge in sight and behind it hidden', () => {
    const [front, behind] = photoOverlay(
      pose,
      buf,
      [
        { layer: 'viewsOfInterest', geometry: { type: 'Point', coordinates: at(100, 1500) } },
        { layer: 'viewsOfInterest', geometry: { type: 'Point', coordinates: at(100, 5000) } },
      ],
      { ground: ridge },
    )
    expect(front.markers).toEqual([expect.objectContaining({ visible: true })])
    expect(front.labelAnchor).toEqual({ x: front.markers[0].x, y: front.markers[0].y })
    expect(behind.markers).toEqual([expect.objectContaining({ visible: false })])
  })
})

describe('horizonLine', () => {
  it('draws the level line across the middle of a level camera, dropped a little by the earth', () => {
    const pose = camera({ pitch: 0 })
    const d = horizonLine(pose)!
    const ys = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]))
    expect(ys.length).toBeGreaterThan(10)
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(pose.height / 2 - 0.1)
      expect(y).toBeLessThan(pose.height / 2 + 1)
    }
  })

  it('tilts with roll and leaves the frame when the camera looks well down', () => {
    const d = horizonLine(camera({ pitch: 0, roll: 10 }))!
    const ys = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]))
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(50)
    expect(horizonLine(camera({ pitch: -60 }))).toBeNull()
  })
})

describe('bearingTicks', () => {
  it('puts north at the middle of a camera facing north, with up pointing up', () => {
    const pose = camera({ pitch: 0 })
    const ticks = bearingTicks(pose)
    const north = ticks.find((tick) => tick.label === 'N')!
    expect(north.x).toBeCloseTo(pose.width / 2, 3)
    expect(north.onEdge).toBe(false)
    expect(north.up[0]).toBeCloseTo(0, 6)
    expect(north.up[1]).toBeCloseTo(-1, 6)
    // A 60° lens facing north spans 330° to 030°.
    expect(ticks.map((tick) => tick.bearing).sort((a, b) => a - b)).toEqual([
      0, 5, 10, 15, 20, 25, 30, 330, 335, 340, 345, 350, 355,
    ])
    expect(ticks.find((tick) => tick.bearing === 25)?.label).toBe('025°')
  })

  it('moves ticks to the top edge when the level line is above the frame', () => {
    const pose = camera({ pitch: -60 })
    const ticks = bearingTicks(pose)
    expect(ticks.length).toBeGreaterThan(0)
    const north = ticks.find((tick) => tick.label === 'N')!
    expect(north.onEdge).toBe(true)
    expect(north.y).toBeCloseTo(0, 6)
  })
})

describe('distanceContours', () => {
  it('traces each distance where the hit buffer reads it, and skips distances the photo does not reach', () => {
    const pose = camera({ altitudeMeters: 1000, pitch: -8 })
    const buf = buildHitBuffer(pose, plane, { width: 200 })
    const [one, two, far] = distanceContours(buf, [1000, 2000, 50_000])
    for (const contour of [one, two]) {
      expect(contour.parts.length).toBeGreaterThan(0)
      expect(contour.labelAnchor).not.toBeNull()
      for (const [x, y] of contour.parts.flat()) {
        const hit = hitAt(buf, Math.min(x, pose.width - 1e-6), y)
        // Within a working pixel of the line: the distance a pixel spans there.
        expect(Math.abs(hit!.distanceMeters - contour.meters) / contour.meters).toBeLessThan(0.08)
      }
    }
    // The 2 km line lies above the 1 km line in the photo.
    const meanY = (parts: number[][][]) => parts.flat().reduce((sum, [, y]) => sum + y, 0) / parts.flat().length
    expect(meanY(two.parts)).toBeLessThan(meanY(one.parts))
    expect(far.d).toBe('')
    expect(far.labelAnchor).toBeNull()
  })

  it('never runs a contour along the skyline', () => {
    // Two rows of ground at 900 m and 1100 m, then sky: the 1 km level falls between the rows, the 5 km level never.
    const nan = Number.NaN
    const buf: HitBuffer = {
      width: 3,
      height: 3,
      photoWidth: 300,
      photoHeight: 300,
      poseKey: 'made-up',
      lng: new Float64Array([nan, nan, nan, 0, 0, 0, 0, 0, 0]),
      lat: new Float64Array([nan, nan, nan, 0, 0, 0, 0, 0, 0]),
      distance: new Float32Array([nan, nan, nan, 1100, 1100, 1100, 900, 900, 900]),
      elevation: new Float32Array([nan, nan, nan, 0, 0, 0, 0, 0, 0]),
    }
    const [one, five] = distanceContours(buf, [1000, 5000])
    expect(one.parts).toHaveLength(1)
    expect(one.parts[0].map(([, y]) => y)).toEqual([200, 200, 200])
    expect(five.parts).toEqual([])
  })
})
