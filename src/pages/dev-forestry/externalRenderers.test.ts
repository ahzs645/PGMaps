import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENGINE_ENVIRONMENT,
  engineEnvironment,
  engineCamera,
  engineStatsLine,
  needsNewPackage,
  readEngineMessage,
  roadRendererInfo,
  roadRendererUnavailable,
  roadRendererUrl,
  siteTimeZone,
} from './externalRenderers'
import { metersPerDegree } from './visibility'

const origin = { lng: -121.9567, lat: 53.8956, elevationMeters: 780.94 }

describe('other road-view renderers', () => {
  it('finds an engine from its variable, its dev server in development, and nowhere otherwise', () => {
    expect(roadRendererUrl('pgmaps', { DEV: true })).toBeNull()
    expect(roadRendererUrl('worldgen', { DEV: true })).toBe('http://127.0.0.1:8460/pgmaps-scene.html?embed')
    expect(roadRendererUrl('worldgen', { DEV: false })).toBeNull()
    expect(roadRendererUrl('nanite', { DEV: false, VITE_FORESTRY_NANITE_URL: ' https://example.org/nanite ' })).toBe(
      'https://example.org/nanite',
    )
  })

  it('says why an engine cannot be chosen', () => {
    expect(roadRendererUnavailable('pgmaps', { url: null, webGpu: false })).toBeNull()
    expect(roadRendererUnavailable('worldgen', { url: null, webGpu: true })).toMatch(/VITE_FORESTRY_WORLDGEN_URL/)
    // worldgen falls back to WebGL2; Nanite cannot.
    expect(roadRendererUnavailable('worldgen', { url: 'x', webGpu: false })).toBeNull()
    expect(roadRendererUnavailable('nanite', { url: 'x', webGpu: false })).toMatch(/WebGPU/)
  })

  it('puts the drive camera in the package frame the package itself uses', () => {
    const scale = metersPerDegree(origin.lat)
    const eye = { lng: origin.lng + 100 / scale.lng, lat: origin.lat - 50 / scale.lat, elevationMeters: 790.5 }
    const camera = engineCamera(origin, eye, { bearingDegrees: -172.2, pitchDegrees: -0.7, verticalFovDegrees: 36.87 })
    expect(camera.position[0]).toBeCloseTo(100, 1)
    expect(camera.position[1]).toBeCloseTo(-50, 1)
    expect(camera.position[2]).toBe(790.5)
    // Bearings are compass, 0–360, as the package's.
    expect(camera.bearingDegrees).toBeCloseTo(187.8, 5)
    expect(camera.pitchDegrees).toBe(-0.7)
  })

  it('sends the same physical eye and projection as a saved scene without rounding the lens', () => {
    const camera = engineCamera(
      origin,
      { lng: origin.lng, lat: origin.lat, elevationMeters: 782.451328 },
      {
        bearingDegrees: 187.812345,
        pitchDegrees: -0.712345,
        verticalFovDegrees: 36.86989764584402,
        viewport: { width: 1600, height: 900, pixelRatio: 2 },
      },
    )
    expect(camera.position).toEqual([0, 0, 782.451328])
    expect(camera.pitchDegrees).toBe(-0.712345)
    expect(camera.verticalFovDegrees).toBe(36.86989764584402)
    expect(camera.projection?.aspectRatio).toBe(16 / 9)
    expect(camera.rollDegrees).toBe(0)
  })

  it('asks for a new package once the eye leaves a third of the stand', () => {
    const scale = metersPerDegree(origin.lat)
    expect(needsNewPackage(origin, { lng: origin.lng + 150 / scale.lng, lat: origin.lat }, 600)).toBe(false)
    expect(needsNewPackage(origin, { lng: origin.lng, lat: origin.lat + 250 / scale.lat }, 600)).toBe(true)
  })

  it('reads only engine messages', () => {
    expect(readEngineMessage({ type: 'pgmaps-engine-ready', engine: 'nanite' })?.type).toBe('pgmaps-engine-ready')
    expect(readEngineMessage({ type: 'vite:ws' })).toBeNull()
    expect(readEngineMessage('pgmaps-engine-ready')).toBeNull()
    expect(engineStatsLine(roadRendererInfo('worldgen'), { drawn: 15867.2, fps: 141.4 })).toBe(
      'Drawn by threejs-worldgen · 15,867 trees · 141 fps',
    )
    expect(engineStatsLine(roadRendererInfo('nanite'), null)).toBe('Drawn by Nanite Forest')
  })
})

describe('engine environment', () => {
  const princeGeorge = { lng: -122.645589, lat: 53.910421 }

  it('reads the date and time on the site’s clock, whatever this computer’s', () => {
    const message = engineEnvironment(
      { ...DEFAULT_ENGINE_ENVIRONMENT, date: '2026-07-15', time: '9:30', ground: 'snow', weather: 'overcast' },
      princeGeorge,
      new Date(2026, 10, 13),
    )
    expect(message).toMatchObject({
      dateTime: '2026-07-15T09:30:00-07:00',
      utc: '2026-07-15T16:30:00.000Z',
      timeZone: 'America/Vancouver',
      latitude: 53.91042,
      longitude: -122.64559,
      sun: 'true',
      ground: 'snow',
      weather: 'overcast',
    })
    // Standard time in winter.
    const winter = engineEnvironment(
      { ...DEFAULT_ENGINE_ENVIRONMENT, date: '2026-01-20', time: '15:30' },
      princeGeorge,
      new Date(),
    )
    expect(winter.utc).toBe('2026-01-20T23:30:00.000Z')
    expect(winter.dateTime).toBe('2026-01-20T15:30:00-08:00')
    // The sun for that instant, worked out here so every engine lights the same moment alike.
    const late = engineEnvironment(
      { ...DEFAULT_ENGINE_ENVIRONMENT, date: '2026-01-20', time: '16:15' },
      princeGeorge,
      new Date(),
    )
    expect(late.sunPosition.elevationDegrees).toBeCloseTo(0.87, 1)
    expect(late.sunPosition.azimuthDegrees).toBeCloseTo(233.13, 1)
  })

  it('takes B.C.’s other clocks from the place, and an override from the choice', () => {
    expect(siteTimeZone({ lng: -120.235, lat: 55.76 })).toBe('America/Dawson_Creek') // Dawson Creek
    expect(siteTimeZone({ lng: -122.69, lat: 58.81 })).toBe('America/Dawson_Creek') // Fort Nelson
    expect(siteTimeZone({ lng: -116.51, lat: 49.1 })).toBe('America/Dawson_Creek') // Creston
    expect(siteTimeZone({ lng: -115.77, lat: 49.51 })).toBe('America/Edmonton') // Cranbrook
    expect(siteTimeZone({ lng: -116.96, lat: 51.3 })).toBe('America/Edmonton') // Golden
    for (const pacific of [
      { lng: -123.1, lat: 55.34 }, // Mackenzie
      { lng: -120.17, lat: 53.3 }, // McBride
      { lng: -116.91, lat: 49.91 }, // Kaslo
      { lng: -117.29, lat: 49.49 }, // Nelson
      { lng: -118.2, lat: 50.99 }, // Revelstoke
      { lng: -122.86, lat: 50.86 }, // Gun Lake
    ])
      expect(siteTimeZone(pacific)).toBe('America/Vancouver')
    // Dawson Creek keeps UTC−7 in July and January alike.
    const peace = { lng: -120.235, lat: 55.76 }
    expect(
      engineEnvironment({ ...DEFAULT_ENGINE_ENVIRONMENT, date: '2026-01-20', time: '12:00' }, peace, new Date()).utc,
    ).toBe('2026-01-20T19:00:00.000Z')
    const chosen = engineEnvironment(
      { ...DEFAULT_ENGINE_ENVIRONMENT, date: '2026-07-15', time: '12:00', timeZone: 'America/Edmonton' },
      princeGeorge,
      new Date(),
    )
    expect(chosen).toMatchObject({ timeZone: 'America/Edmonton', utc: '2026-07-15T18:00:00.000Z' })
    // An unknown zone falls back to the place's.
    expect(
      engineEnvironment({ ...DEFAULT_ENGINE_ENVIRONMENT, timeZone: 'Mars/Olympus' }, princeGeorge, new Date()).timeZone,
    ).toBe('America/Vancouver')
  })

  it('takes today at the site when no date is chosen, and the default time for a malformed one', () => {
    // 2026-11-14 03:00 UTC is still 13 November in B.C.
    const message = engineEnvironment(
      { ...DEFAULT_ENGINE_ENVIRONMENT, time: 'noon' },
      princeGeorge,
      new Date(Date.UTC(2026, 10, 14, 3)),
    )
    expect(message.dateTime).toBe('2026-11-13T14:00:00-08:00')
    expect(message).toMatchObject({ ground: 'bare', weather: 'clear', sun: 'true' })
  })

  it('sends calm water and the VIA look by default, and the wind and look chosen', () => {
    expect(DEFAULT_ENGINE_ENVIRONMENT).toMatchObject({ windMs: 0, look: 'via' })
    expect(engineEnvironment(DEFAULT_ENGINE_ENVIRONMENT, princeGeorge, new Date())).toMatchObject({
      windMs: 0,
      look: 'via',
    })
    expect(
      engineEnvironment({ ...DEFAULT_ENGINE_ENVIRONMENT, windMs: 9, look: 'photo' }, princeGeorge, new Date()),
    ).toMatchObject({ windMs: 9, look: 'photo' })
    // A choice saved before the two existed reads as calm and VIA.
    const older = { ...DEFAULT_ENGINE_ENVIRONMENT }
    delete older.windMs
    delete older.look
    expect(engineEnvironment(older, princeGeorge, new Date())).toMatchObject({ windMs: 0, look: 'via' })
  })

  it('says when an engine lit the scene from another sun than the one asked for', () => {
    const info = roadRendererInfo('nanite')
    expect(engineStatsLine(info, { fps: 60, sun: { elevation: 2.04, drawnElevation: 2.04 } })).toBe(
      'Drawn by Nanite Forest · 60 fps · sun 2.0°',
    )
    expect(engineStatsLine(info, { sun: { elevation: 2.04, drawnElevation: 6 } })).toBe(
      'Drawn by Nanite Forest · sun 2.0°, lit as 6.0°',
    )
  })
})
