import { describe, expect, it } from 'vitest'

import {
  fetchMapillaryImage,
  parseMapillaryInput,
  photoNearDrive,
  photoFieldOfView,
  photoPoseFor,
  rankPhotosToward,
  searchMapillaryImages,
  searchTiles,
  type MapillaryListing,
  type RoadPhoto,
} from './mapillary'

/** What the Graph API returned for image 433510958589782 on the Hart Highway. */
const HART_IMAGE = {
  id: '433510958589782',
  computed_geometry: { type: 'Point', coordinates: [-122.73708991762, 54.639435890052] },
  geometry: { type: 'Point', coordinates: [-122.7371746, 54.6394194] },
  computed_compass_angle: 312.26775114922,
  compass_angle: 0,
  computed_rotation: [1.2727802695681, 0.56020910208924, -0.70187491085786],
  computed_altitude: 685.74780630413,
  camera_type: 'perspective',
  camera_parameters: [0.57508859485652, -0.00025379500682925, -0.00081209258936009],
  captured_at: 1452059653247,
  creator: { username: 'rps333', id: '103097205262536' },
  width: 5184,
  height: 3888,
  make: 'GoPro',
  model: 'HERO9 Black',
  is_pano: false,
  sequence: 'aFgHBSEowC4YdGkR1lsxc6',
  thumb_2048_url: 'https://example.test/thumb.jpg',
}

function stubFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; auth: string | null }> = []
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('Authorization') })
    return new Response(JSON.stringify(typeof body === 'function' ? (body as (url: string) => unknown)(url) : body), {
      status,
    })
  }
  return { fetchImpl, calls }
}

describe('reading a Mapillary link', () => {
  it('takes the image key from the app link, a photo path, or a bare id', () => {
    expect(
      parseMapillaryInput(
        'https://www.mapillary.com/app/?lat=54.63966289999999&lng=-122.73758029999999&z=17&pKey=433510958589782&focus=photo',
      ),
    ).toBe('433510958589782')
    expect(parseMapillaryInput('https://www.mapillary.com/map/im/433510958589782')).toBe('433510958589782')
    expect(parseMapillaryInput(' 433510958589782 ')).toBe('433510958589782')
  })

  it('refuses links that are not Mapillary images', () => {
    expect(parseMapillaryInput('https://example.com/?pKey=433510958589782')).toBeNull()
    expect(parseMapillaryInput('https://www.mapillary.com/app/?lat=54.6')).toBeNull()
    expect(parseMapillaryInput('not a link')).toBeNull()
  })
})

describe('fetching an image', () => {
  it('sends the token as an OAuth header and turns the reconstruction into a pose', async () => {
    const { fetchImpl, calls } = stubFetch(HART_IMAGE)
    const image = await fetchMapillaryImage('433510958589782', 'MLY|test', { fetchImpl })
    expect(calls[0].auth).toBe('OAuth MLY|test')
    expect(calls[0].url).not.toContain('MLY|test')
    expect(image).toMatchObject({
      lng: -122.73708991762,
      lat: 54.639435890052,
      poseSource: 'computed',
      creator: 'rps333',
      camera: 'GoPro HERO9 Black',
      isPano: false,
    })
    expect(image.bearing).toBeCloseTo(312.27, 2)
    expect(image.pitch).toBeCloseTo(12.3, 1)
    const fov = photoFieldOfView(image)!
    expect(fov.vertical).toBeCloseTo(66.2, 0)
    expect(photoPoseFor(image, 700)?.focalPx).toBeCloseTo(0.57508859485652 * 5184, 3)
  })

  it('falls back to the compass when there is no reconstruction', async () => {
    const { fetchImpl } = stubFetch({ ...HART_IMAGE, computed_rotation: undefined })
    const image = await fetchMapillaryImage('433510958589782', 'MLY|test', { fetchImpl })
    expect(image).toMatchObject({ poseSource: 'compass', pitch: 0 })
    expect(image.bearing).toBeCloseTo(312.27, 2)
  })

  it("passes on Mapillary's own error message", async () => {
    const { fetchImpl } = stubFetch({ error: { message: 'Invalid OAuth 2.0 Access Token' } }, 400)
    await expect(fetchMapillaryImage('1', 'bad', { fetchImpl })).rejects.toThrow('Invalid OAuth 2.0 Access Token')
  })

  it('will not overlay a panorama', async () => {
    const { fetchImpl } = stubFetch({ ...HART_IMAGE, camera_type: 'spherical', is_pano: true })
    const image = await fetchMapillaryImage('1', 'MLY|test', { fetchImpl })
    expect(photoPoseFor(image, 700)).toBeNull()
  })
})

describe('searching along a road', () => {
  it('splits a corridor into small boxes, capped', () => {
    expect(searchTiles([-122.75, 54.63, -122.73, 54.65])).toHaveLength(4)
    expect(searchTiles([-123, 54, -122, 55])).toHaveLength(24)
  })

  it('merges images seen by neighbouring boxes', async () => {
    const row = {
      id: '7',
      computed_geometry: { type: 'Point', coordinates: [-122.74, 54.64] },
      computed_compass_angle: 320,
      captured_at: 1690318393383,
      is_pano: false,
    }
    const pano = { ...row, id: '9', is_pano: undefined }
    const { fetchImpl, calls } = stubFetch((url: string) => ({ data: url.includes('is_pano=true') ? [pano] : [row] }))
    const found = await searchMapillaryImages([-122.75, 54.63, -122.73, 54.65], 'MLY|test', { fetchImpl })
    // Each of four boxes asks once for photos and once for panoramas.
    expect(calls).toHaveLength(8)
    expect(found.images.find((image) => image.id === '9')?.isPano).toBe(true)
    expect(found.images).toHaveLength(2)
    expect(found.images[0]).toMatchObject({ id: '7', bearing: 320, capturedAt: '2023-07-25T20:53:13.383Z' })
  })

  it('keeps photos on the road that look toward the block, nearest first', () => {
    const target = { lng: -122.74, lat: 54.65 } // due north of the photos
    const at = (id: string, lat: number, bearing: number | null, isPano = false): MapillaryListing => ({
      id,
      lng: -122.74,
      lat,
      bearing,
      capturedAt: null,
      isPano,
      thumbUrl: null,
    })
    const photos = [
      at('far-facing', 54.62, 5),
      at('near-facing', 54.64, 355),
      at('looking-away', 54.63, 180),
      at('pano', 54.645, null, true),
      at('off-road', 54.635, 0),
    ]
    const offRoad = (point: { lat: number }) => (point.lat === 54.635 ? 200 : 5)
    expect(rankPhotosToward(photos, target, offRoad).map((photo) => photo.id)).toEqual([
      'near-facing',
      'far-facing',
      'pano',
    ])
  })
})

describe('street photos while driving', () => {
  const photo = (id: string, alongMeters: number, bearing: number | null, isPano = false): RoadPhoto => ({
    id,
    lng: 0,
    lat: 0,
    bearing,
    capturedAt: null,
    isPano,
    thumbUrl: null,
    alongMeters,
    offRoadMeters: 2,
  })
  const photos = [photo('east-100', 100, 90), photo('west-110', 110, 270), photo('east-400', 400, 92), photo('pano-700', 700, null, true)]

  it('shows the nearest photo looking the way the camera looks', () => {
    expect(photoNearDrive(photos, 105, 88)?.id).toBe('east-100')
    expect(photoNearDrive(photos, 105, 268)?.id).toBe('west-110')
  })

  it('shows nothing between photos, and takes a panorama whichever way the camera looks', () => {
    expect(photoNearDrive(photos, 250, 90)).toBeNull()
    expect(photoNearDrive(photos, 690, 180)?.id).toBe('pano-700')
  })
})

