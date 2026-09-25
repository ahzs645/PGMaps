import { describe, expect, it } from 'vitest'

import {
  cameraAxes,
  fieldOfView,
  orientationFromRotation,
  panoViewPose,
  projectToPhoto,
  reprojectEquirect,
  terrainSkyline,
  type PhotoPose,
} from './photoPose'
import type { ElevationSource } from './terrain'

/** Mapillary image 433510958589782, Hart Highway: its computed rotation and compass angle. */
const HART_ROTATION: [number, number, number] = [1.2727802695681, 0.56020910208924, -0.70187491085786]
const HART_COMPASS = 312.26775114922

const flatPose = (patch: Partial<PhotoPose> = {}): PhotoPose => ({
  lng: -122.7,
  lat: 54.6,
  altitudeMeters: 700,
  bearing: 0,
  pitch: 0,
  roll: 0,
  width: 4000,
  height: 3000,
  focalPx: 2000,
  k1: 0,
  k2: 0,
  ...patch,
})

const METRES_PER_DEGREE_LAT = 110574
const metresPerDegreeLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)

describe('orientation from a Mapillary rotation', () => {
  it("reproduces Mapillary's own computed compass angle", () => {
    expect(orientationFromRotation(HART_ROTATION).bearing).toBeCloseTo(HART_COMPASS, 3)
  })

  it('reads the mount: level side to side, tipped up about 12°', () => {
    const { pitch, roll } = orientationFromRotation(HART_ROTATION)
    // The GoPro was aimed a little high, which is why the road's vanishing
    // point sits in the lower third of the photo rather than at its centre.
    expect(pitch).toBeCloseTo(12.3, 1)
    expect(Math.abs(roll)).toBeLessThan(1)
  })

  it('agrees with the axes it is rebuilt into', () => {
    const orientation = orientationFromRotation(HART_ROTATION)
    const { forward } = cameraAxes(orientation)
    // Forward from the rebuilt axes points along the same bearing.
    expect(((Math.atan2(forward[0], forward[1]) * 180) / Math.PI + 360) % 360).toBeCloseTo(HART_COMPASS, 3)
  })
})

describe('field of view', () => {
  it('turns a normalised focal length into degrees', () => {
    // The Hart Highway GoPro: 0.575 of 5184 px.
    const fov = fieldOfView(0.57508859485652, 5184, 3888)
    expect(fov.horizontal).toBeCloseTo(82.0, 0)
    expect(fov.vertical).toBeCloseTo(66.2, 0)
  })
})

describe('projecting into the photo', () => {
  it('puts a point straight ahead at the centre', () => {
    const pose = flatPose({ bearing: 90 })
    const p = projectToPhoto(pose, pose.lng + 500 / metresPerDegreeLng(pose.lat), pose.lat, pose.altitudeMeters)!
    expect(p.x).toBeCloseTo(2000, 0)
    expect(p.y).toBeCloseTo(1500, 0)
  })

  it('puts higher ground above the centre and ground to the right on the right', () => {
    const pose = flatPose()
    const ahead = pose.lat + 1000 / METRES_PER_DEGREE_LAT
    const high = projectToPhoto(pose, pose.lng, ahead, pose.altitudeMeters + 100)!
    expect(high.y).toBeCloseTo(1500 - 200, 0) // focal 2000 × 100/1000
    const east = projectToPhoto(pose, pose.lng + 100 / metresPerDegreeLng(pose.lat), ahead, pose.altitudeMeters)!
    expect(east.x).toBeCloseTo(2000 + 200, 0)
  })

  it('tilts the frame the way the camera rolls', () => {
    const rolled = flatPose({ roll: 10 })
    const ahead = rolled.lat + 1000 / METRES_PER_DEGREE_LAT
    const east = projectToPhoto(
      rolled,
      rolled.lng + 100 / metresPerDegreeLng(rolled.lat),
      ahead,
      rolled.altitudeMeters,
    )!
    // Right side raised: a level point to the right drops lower in the frame.
    expect(east.y).toBeGreaterThan(1500)
  })

  it('says nothing about points behind the camera', () => {
    const pose = flatPose()
    expect(projectToPhoto(pose, pose.lng, pose.lat - 0.01, pose.altitudeMeters)).toBeNull()
  })
})

describe('terrain skyline', () => {
  it('draws a ridge where it stands in the frame, and stops where the data does', () => {
    const pose = flatPose({ altitudeMeters: 1.6 })
    // Flat plain at 0 m with a 100 m wall 2 km north; nothing past 3 km.
    const ridge: ElevationSource = {
      elevationAt: (_lng, lat) => {
        const north = (lat - pose.lat) * METRES_PER_DEGREE_LAT
        if (north > 3000) return Number.NaN
        return north >= 2000 ? 100 : 0
      },
    }
    const skyline = terrainSkyline(pose, ridge, { columns: 9, maxDistanceMeters: 20000 })
    const centre = skyline[4]
    expect(centre.x).toBeCloseTo(2000, -1)
    // atan(98.4 / 2000) at 2000 px focal, less curvature: about 98 px above centre.
    expect(1500 - centre.y).toBeGreaterThan(90)
    expect(1500 - centre.y).toBeLessThan(105)
    expect(centre.reachMeters).toBeLessThanOrEqual(3000)
  })
})

describe('views cut from a 360° photo', () => {
  // An equirectangular image whose red channel is its longitude (0–255 left to
  // right) and green channel its latitude (0 at the top): each pixel says where
  // on the sphere it came from.
  const W = 720, H = 360
  const data = new Uint8ClampedArray(W * H * 4)
  for (let v = 0; v < H; v += 1) for (let u = 0; u < W; u += 1) data.set([Math.floor((u / W) * 256), Math.floor((v / H) * 256), 0, 255], (v * W + u) * 4)
  const pano = { width: W, height: H, data }
  const centre = (pixels: Uint8ClampedArray, w: number, h: number) => {
    const i = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4
    return { lon: (pixels[i] / 256) * 360 - 180, lat: 90 - (pixels[i + 1] / 256) * 180 }
  }

  it("looks along the panorama's own centre when the view faces the camera's bearing", () => {
    const out = reprojectEquirect(pano, { rotation: null, bearing: 40 }, { bearing: 40, pitch: 0, verticalFovDegrees: 60, width: 64, height: 48 })
    const at = centre(out, 64, 48)
    expect(Math.abs(at.lon)).toBeLessThan(1.5)
    expect(Math.abs(at.lat)).toBeLessThan(1.5)
  })

  it('turns the view by the difference in bearing, and tilts it by the pitch', () => {
    const out = reprojectEquirect(pano, { rotation: null, bearing: 40 }, { bearing: 130, pitch: 20, verticalFovDegrees: 60, width: 64, height: 48 })
    const at = centre(out, 64, 48)
    expect(at.lon).toBeCloseTo(90, -0.5)
    expect(at.lat).toBeCloseTo(20, -0.5)
  })

  it('agrees with a rotation that says the same thing as the compass', () => {
    // A level camera facing 95°, as an OpenSfM angle-axis.
    const byRotation = reprojectEquirect(pano, { rotation: [1.104727, -1.205598, 1.31568], bearing: 0 }, { bearing: 185, pitch: 0, verticalFovDegrees: 60, width: 32, height: 24 })
    const byCompass = reprojectEquirect(pano, { rotation: null, bearing: 95 }, { bearing: 185, pitch: 0, verticalFovDegrees: 60, width: 32, height: 24 })
    // The rotation also pitches the camera 5°; compare longitudes only.
    const lon = (pixels: Uint8ClampedArray) => centre(pixels, 32, 24).lon
    expect(Math.abs(lon(byRotation) - lon(byCompass))).toBeLessThan(2)
  })

  it('gives the cut view a pinhole camera to draw on', () => {
    const pose = panoViewPose({ lng: -119.5, lat: 49.9, altitudeMeters: 400 }, { bearing: 10, pitch: 0, verticalFovDegrees: 60, width: 800, height: 600 })
    expect(pose.focalPx).toBeCloseTo(300 / Math.tan(Math.PI / 6), 6)
  })
})

