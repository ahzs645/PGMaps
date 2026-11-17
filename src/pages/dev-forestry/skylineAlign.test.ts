import { describe, expect, it } from 'vitest'

import { projectToPhoto, type PhotoPose } from './photoPose'
import { alignPixel, pixelRay, rayPixel, rollAbout, screenAngle, skylineHandles, wrapSigned } from './skylineAlign'

// A made-up camera: no real place.
const pose: PhotoPose = {
  lng: -120,
  lat: 50,
  altitudeMeters: 1200,
  bearing: 40,
  pitch: -6,
  roll: 3,
  width: 1200,
  height: 900,
  focalPx: 1000,
  k1: 0,
  k2: 0,
}

/** A ground point in front of the camera, and where it is drawn. */
const groundPoint = { lng: -119.97, lat: 50.02, altitude: 900 }

describe('drag-to-align', () => {
  it('reads a pixel as a direction and back again', () => {
    const ray = pixelRay(pose, pose, 300, 700)
    const back = rayPixel(pose, pose, ray)!
    expect(back.x).toBeCloseTo(300, 6)
    expect(back.y).toBeCloseTo(700, 6)
  })

  it('moves what is drawn at one pixel to where the pointer let go', () => {
    const before = projectToPhoto(pose, groundPoint.lng, groundPoint.lat, groundPoint.altitude)!
    const to = { x: before.x + 120, y: before.y - 45 }
    const angles = alignPixel(pose, before, to)!
    expect(angles.roll).toBe(pose.roll)
    const after = projectToPhoto({ ...pose, ...angles }, groundPoint.lng, groundPoint.lat, groundPoint.altitude)!
    expect(after.x).toBeCloseTo(to.x, 2)
    expect(after.y).toBeCloseTo(to.y, 2)
  })

  it('turns the camera left when the skyline is dragged right, and up when dragged down', () => {
    const centre = { x: pose.width / 2, y: pose.height / 2 }
    const right = alignPixel({ ...pose, roll: 0 }, centre, { x: centre.x + 100, y: centre.y })!
    expect(((right.bearing - pose.bearing + 540) % 360) - 180).toBeLessThan(0)
    const down = alignPixel({ ...pose, roll: 0 }, centre, { x: centre.x, y: centre.y + 100 })!
    expect(down.pitch).toBeGreaterThan(pose.pitch)
  })

  it('turns what is drawn clockwise about the cross by rolling, and keeps the cross where it was', () => {
    const cross = projectToPhoto(pose, groundPoint.lng, groundPoint.lat, groundPoint.altitude)!
    const other = projectToPhoto(pose, -119.99, 50.03, 1000)!
    const angles = rollAbout(pose, cross, 4)!
    const moved = { ...pose, ...angles }
    const crossAfter = projectToPhoto(moved, groundPoint.lng, groundPoint.lat, groundPoint.altitude)!
    expect(crossAfter.x).toBeCloseTo(cross.x, 2)
    expect(crossAfter.y).toBeCloseTo(cross.y, 2)
    const otherAfter = projectToPhoto(moved, -119.99, 50.03, 1000)!
    const turned = screenAngle(cross, otherAfter) - screenAngle(cross, other)
    expect(((turned + 540) % 360) - 180).toBeCloseTo(4, 0)
  })

  it('keeps a turn across the left of the cross a small roll, never one near 360°', () => {
    // Dragged from just above the left handle to just below it, the screen angle runs from about −179° to 179°:
    // a 2° turn anticlockwise, which unwrapped would be 358°.
    const delta = wrapSigned(179 - -179)
    expect(delta).toBeCloseTo(-2, 9)
    const angles = rollAbout({ ...pose, roll: -179 }, { x: 600, y: 450 }, 358)!
    expect(angles.roll).toBeGreaterThan(-180)
    expect(angles.roll).toBeLessThanOrEqual(180)
    expect(angles.roll).toBeCloseTo(179, 6)
    expect(wrapSigned(-180)).toBe(180)
    expect(wrapSigned(540)).toBe(180)
    expect(wrapSigned(-190)).toBeCloseTo(170, 9)
  })

  it('refuses a drag no camera can follow', () => {
    expect(alignPixel({ ...pose, pitch: 80 }, { x: 600, y: 450 }, { x: 600, y: 450 + 1e6 })).toBeNull()
  })

  it('puts the handles on the drawn skyline', () => {
    const skyline = Array.from({ length: 101 }, (_, i) => ({ x: i * 12, y: 300 + i }))
    const handles = skylineHandles(skyline, 1200, 900)
    expect(handles.centre).toEqual({ x: 600, y: 350 })
    expect(handles.left.y).toBe(320)
    expect(handles.right.y).toBe(380)
    // No skyline in frame: level with the frame's middle.
    expect(skylineHandles([null, null], 1200, 900).left).toEqual({ x: 240, y: 450 })
  })
})
