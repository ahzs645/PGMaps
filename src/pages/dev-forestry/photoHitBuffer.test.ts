import { describe, expect, it } from 'vitest'
import { buildHitBuffer, cameraDistance, hitAt, inSight, photoPoseKey } from './photoHitBuffer'
import { projectToPhoto, type PhotoPose } from './photoPose'
import { castRay } from './photoViews'

const RAD = Math.PI / 180
// A made-up place; nothing here is a real photo's.
const LNG = -122.5,
  LAT = 53.7
const mx = 111320 * Math.cos(LAT * RAD)
const toLngLat = (east: number, north: number) => [LNG + east / mx, LAT + north / 110574] as const
const local = (lng: number, lat: number) => [(lng - LNG) * mx, (lat - LAT) * 110574] as const

const plane = { elevationAt: () => 800 }
// Level ground at 800 m with an east–west ridge 400 m high 3 km north, and a 600 m plateau 12 km north.
const ridge = {
  elevationAt(lng: number, lat: number) {
    const [, n] = local(lng, lat)
    return 800 + 400 * Math.exp(-(((n - 3000) / 300) ** 2)) + 600 / (1 + Math.exp(-(n - 12000) / 200))
  },
}
// Gently rising ground with a hill, as photoViews.test.ts draws it.
const hill = {
  elevationAt(lng: number, lat: number) {
    const [e, n] = local(lng, lat)
    return 800 + 0.02 * e + 0.03 * n + 300 * Math.exp(-(((e - 1400) ** 2 + (n - 1400) ** 2) / (350 * 350)))
  },
}

const camera = (over: Partial<PhotoPose> = {}): PhotoPose => ({
  lng: LNG,
  lat: LAT,
  altitudeMeters: 1500,
  bearing: 0,
  pitch: -25,
  roll: 0,
  width: 600,
  height: 450,
  focalPx: 600 / 2 / Math.tan(30 * RAD),
  k1: 0,
  k2: 0,
  ...over,
})

/** Share of sampled pixels where the buffer and `castRay` agree (both empty, or within 2% and 30 m). */
function agreement(pose: PhotoPose, source: { elevationAt: (lng: number, lat: number) => number }) {
  const buf = buildHitBuffer(pose, source, { width: 120 })
  let checked = 0,
    agree = 0
  for (let y = 0; y < buf.height; y += 7)
    for (let x = 0; x < buf.width; x += 7) {
      const u = (x + 0.5) * (pose.width / buf.width),
        v = (y + 0.5) * (pose.height / buf.height)
      const ray = castRay(pose, source, u, v)
      const hit = hitAt(buf, u, v)
      checked++
      if (!ray || !hit) {
        if (!ray && !hit) agree++
        continue
      }
      const along = cameraDistance(pose, ray.lng, ray.lat, ray.elevation)
      const [e1, n1] = local(ray.lng, ray.lat),
        [e2, n2] = local(hit.lng, hit.lat)
      if (
        Math.abs(hit.distanceMeters - along) <= 0.02 * along + 30 &&
        Math.hypot(e1 - e2, n1 - n2) <= 0.02 * along + 30
      )
        agree++
    }
  return agree / checked
}

describe('the hit buffer', () => {
  it('meets level ground where the ray meets it, and keeps sky above the horizon empty', () => {
    const pose = camera({ pitch: -5 })
    const buf = buildHitBuffer(pose, plane, { width: 200 })
    expect(buf.width).toBe(200)
    expect(buf.height).toBe(150)
    expect(buf.photoWidth).toBe(600)
    // The top row looks 17.5° up: sky.
    expect(hitAt(buf, 300, 1)).toBeNull()
    // The bottom centre looks about 26° down from 700 m up: ground about 1.4 km out.
    const low = hitAt(buf, 300, 449)!
    const [, n] = local(low.lng, low.lat)
    const down = Math.atan2(449.5 * (450 / 450) - 225, pose.focalPx) + 5 * RAD
    expect(n).toBeGreaterThan(0)
    expect(Math.abs(n - 700 / Math.tan(down))).toBeLessThan(25)
    expect(low.elevation).toBeCloseTo(800, 3)
    expect(low.distanceMeters).toBeCloseTo(cameraDistance(pose, low.lng, low.lat, 800), -1)
    expect(agreement(pose, plane)).toBeGreaterThan(0.97)
  })

  it('agrees with castRay pixel by pixel on hills, rolled or not', () => {
    expect(agreement(camera({ bearing: 45 }), hill)).toBeGreaterThan(0.95)
    expect(agreement(camera({ bearing: 45, roll: 12 }), hill)).toBeGreaterThan(0.95)
    expect(agreement(camera({ bearing: 10, pitch: -3, roll: -8 }), ridge)).toBeGreaterThan(0.95)
  })

  it('rolls with the camera: a rolled frame meets the same ground at the same rotated pixel', () => {
    const level = camera({ pitch: -10 })
    const rolled = camera({ pitch: -10, roll: 15 })
    const a = buildHitBuffer(level, plane, { width: 300 })
    const b = buildHitBuffer(rolled, plane, { width: 300 })
    // A ground point straight ahead projects to the centre column in both, but off-centre it lands on rotated pixels.
    const [lng, lat] = toLngLat(1200, 2500)
    const pa = projectToPhoto(level, lng, lat, 800)!,
      pb = projectToPhoto(rolled, lng, lat, 800)!
    expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeGreaterThan(20)
    for (const [buf, p] of [
      [a, pa],
      [b, pb],
    ] as const) {
      const hit = hitAt(buf, p.x, p.y)!
      const [e, n] = local(hit.lng, hit.lat)
      expect(Math.hypot(e - 1200, n - 2500)).toBeLessThan(40)
    }
  })

  it('says a point behind a ridge is out of sight and ground in front of it or above it is in sight', () => {
    const pose = camera({ pitch: -4 })
    const buf = buildHitBuffer(pose, ridge)
    const check = (north: number) => {
      const [lng, lat] = toLngLat(0, north)
      const z = ridge.elevationAt(lng, lat)
      const p = projectToPhoto(pose, lng, lat, z)!
      return inSight(buf, p.x, p.y, cameraDistance(pose, lng, lat, z))
    }
    expect(check(1500)).toBe(true) // the ridge's near foot
    expect(check(2900)).toBe(true) // its face
    expect(check(4500)).toBe(false) // the valley behind it
    expect(check(6000)).toBe(false)
    expect(check(15000)).toBe(true) // the plateau, higher than the ridge seen from here
    // A point floating in front of the ground is in sight; outside the frame never is.
    const [lng, lat] = toLngLat(0, 1000)
    const p = projectToPhoto(pose, lng, lat, 1200)!
    expect(inSight(buf, p.x, p.y, cameraDistance(pose, lng, lat, 1200))).toBe(true)
    expect(inSight(buf, -5, 10, 100)).toBe(false)
  })

  it('leaves rays empty past its range or where the terrain runs out', () => {
    const short = buildHitBuffer(camera({ pitch: -2 }), plane, { width: 60, maxMeters: 3000 })
    const long = buildHitBuffer(camera({ pitch: -2 }), plane, { width: 60 })
    const count = (b: typeof short) => Array.from(b.lng).filter((v) => !Number.isNaN(v)).length
    expect(count(short)).toBeLessThan(count(long))
    const island = { elevationAt: (lng: number, lat: number) => (local(lng, lat)[1] < 2000 ? 800 : Number.NaN) }
    const cut = buildHitBuffer(camera({ pitch: -2 }), island, { width: 60 })
    for (let i = 0; i < cut.lng.length; i++)
      if (!Number.isNaN(cut.lat[i])) expect(local(LNG, cut.lat[i])[1]).toBeLessThan(2000)
  })

  it('keys a pose by everything that moves a ray', () => {
    const pose = camera()
    expect(photoPoseKey(pose)).toBe(photoPoseKey({ ...pose }))
    expect(photoPoseKey({ ...pose, bearing: 0.01 })).not.toBe(photoPoseKey(pose))
    expect(photoPoseKey({ ...pose, roll: 0.5 })).not.toBe(photoPoseKey(pose))
    expect(buildHitBuffer(pose, plane, { width: 20 }).poseKey).toBe(photoPoseKey(pose))
  })
})
