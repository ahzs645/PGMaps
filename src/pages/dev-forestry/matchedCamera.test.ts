import { describe, expect, it } from 'vitest'

import { MATCHED_CAMERA_MAX_SHIFT_METERS, matchedCameraChecks, parseMatchedCamera } from './matchedCamera'

// A case file as the photo-matching bench writes it (coordinates made up).
const CASE = {
  photo: '../IMG_0001.png',
  out: 'out-0001',
  platform: 'air',
  pose: {
    lng: -122.5,
    lat: 54.1,
    alt: 912.4,
    bearing: 409.35,
    pitch: -5.8,
    roll: 0.2,
    hfov: 53.06,
    source: 'solve (skyline + controls; held hfov)',
  },
  results: {
    orientation: { trustworthy: true, ambiguous: false },
    solve: {
      groups: [
        { name: 'pond shore', heldOut: 2.1, mPerPx: 1.3 },
        { name: 'broken', heldOut: null },
      ],
    },
  },
}

describe('parseMatchedCamera', () => {
  it('reads the camera, how it was found and its held-out accuracy from a case file', () => {
    const camera = parseMatchedCamera(JSON.stringify(CASE))
    expect(camera).toMatchObject({ lng: -122.5, lat: 54.1, altitudeMeters: 912.4, pitch: -5.8, roll: 0.2, hfov: 53.06 })
    expect(camera.bearing).toBeCloseTo(49.35, 9)
    expect(camera.method).toBe('solve (skyline + controls; held hfov)')
    expect(camera.trusted).toBe(true)
    expect(camera.photoName).toBe('IMG_0001.png')
    expect(camera.heldOut).toHaveLength(1)
    expect(camera.heldOut[0].name).toBe('pond shore')
    expect(camera.heldOut[0].metres).toBeCloseTo(2.73, 9)
  })

  it('reads a bare camera object too', () => {
    const camera = parseMatchedCamera(
      JSON.stringify({ lng: 10, lat: 20, alt: 100, bearing: 0, pitch: 0, roll: 0, hfov: 60 }),
    )
    expect(camera).toMatchObject({
      lng: 10,
      lat: 20,
      altitudeMeters: 100,
      method: 'not stated',
      trusted: null,
      photoName: null,
    })
  })

  it('names what is wrong instead of returning a half camera', () => {
    expect(() => parseMatchedCamera('not json')).toThrow(/not JSON/)
    expect(() => parseMatchedCamera(JSON.stringify({ photo: 'a.png' }))).toThrow(/no camera yet/)
    expect(() => parseMatchedCamera(JSON.stringify({ ...CASE, pose: { ...CASE.pose, lat: 95 } }))).toThrow(/position/)
    expect(() => parseMatchedCamera(JSON.stringify({ ...CASE, pose: { ...CASE.pose, alt: undefined } }))).toThrow(
      /altitude/,
    )
    expect(() => parseMatchedCamera(JSON.stringify({ ...CASE, pose: { ...CASE.pose, hfov: 170 } }))).toThrow(
      /field of view/,
    )
  })
})

describe('matchedCameraChecks', () => {
  const camera = parseMatchedCamera(JSON.stringify(CASE))
  it('says nothing for the photo it was made for, near its own GPS fix', () => {
    // A JPEG and the PNG exported from it share the name stem.
    expect(
      matchedCameraChecks(camera, { name: 'IMG_0001.JPEG', gpsPosition: { lng: -122.5003, lat: 54.1002 } }),
    ).toEqual([])
  })
  it('keeps a transferred camera provisional even when the case says the skyline passed', () => {
    const transferred = parseMatchedCamera(JSON.stringify({ ...CASE, pose: { ...CASE.pose, source: 'photo-overlap' } }))
    expect(transferred.trusted).toBe(false)
    expect(matchedCameraChecks(transferred, { name: 'IMG_0001.HEIC', gpsPosition: null })).toEqual([
      'This camera came from an overlapping photo. Check independent landmarks before accepting it.',
    ])
  })
  it('keeps a visually preferred camera provisional for the matching photo', () => {
    const reviewed = parseMatchedCamera(JSON.stringify({ ...CASE, pose: { ...CASE.pose, source: 'review-candidate' } }))
    expect(reviewed.trusted).toBe(false)
    expect(matchedCameraChecks(reviewed, { name: 'img_0001.HEIC', gpsPosition: null })).toEqual([
      'This is a starting camera from photo review. Compare landmarks before accepting it.',
    ])
  })
  it('flags another photo, a camera far from the GPS fix, and an untrusted fit', () => {
    const far = { lng: -122.5, lat: 54.1 + (MATCHED_CAMERA_MAX_SHIFT_METERS + 100) / 111195 }
    const untrusted = { ...camera, trusted: false }
    const checks = matchedCameraChecks(untrusted, { name: 'IMG_0002.png', gpsPosition: far })
    expect(checks).toHaveLength(3)
    expect(checks[0]).toMatch(/IMG_0001\.png, not IMG_0002\.png/)
    expect(checks[1]).toMatch(/400 m from this photo/)
    expect(checks[2]).toMatch(/did not trust/)
  })
})
