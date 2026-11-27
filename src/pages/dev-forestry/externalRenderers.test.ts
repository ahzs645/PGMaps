import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENGINE_ENVIRONMENT,
  engineEnvironment,
  engineCamera,
  engineStatsLine,
  needsNewPackage,
  readEngineMessage,
  engineKindOf,
  roadRendererInfo,
  roadRendererUnavailable,
  DEFAULT_ENGINE_BROWSER_OPTIONS,
  parseEngineBrowserOptions,
  roadRendererUrl,
  siteTimeZone,
  separateSiteUrl,
} from './externalRenderers'
import { metersPerDegree } from './visibility'

const origin = { lng: -121.9567, lat: 53.8956, elevationMeters: 780.94 }

describe('other road-view renderers', () => {
  it('runs both engines as workers from the site’s own engines folder, under its base', () => {
    expect(roadRendererUrl('pgmaps', {})).toBeNull()
    for (const id of ['worldgen', 'nanite'] as const) {
      const worker = `/engines/${id}/pgmaps-engine.js?embed`
      expect(roadRendererUrl(id, {})).toBe(worker)
      expect(roadRendererUrl(id, { BASE_URL: '/' })).toBe(worker)
      expect(roadRendererUrl(id, { BASE_URL: '/PGMaps/' })).toBe(`/PGMaps${worker}`)
      expect(roadRendererUrl(id, { BASE_URL: '/PGMaps' })).toBe(`/PGMaps${worker}`)
      expect(engineKindOf(worker)).toBe('worker')
    }
    expect(engineKindOf('/engines/nanite/pgmaps-engine.js?embed&treecache=1')).toBe('worker')
  })

  it('runs an engine’s page in a frame instead when its variable names one', () => {
    const page = roadRendererUrl('worldgen', { VITE_FORESTRY_WORLDGEN_URL: ' https://example.org/wg/x.html?embed ' })
    expect(page).toBe('https://example.org/wg/x.html?embed')
    expect(engineKindOf(page!)).toBe('frame')
    expect(
      roadRendererUrl('nanite', { VITE_FORESTRY_NANITE_URL: 'http://127.0.0.1:8461/examples/pgmaps-scene.html?embed' }),
    ).toBe('http://127.0.0.1:8461/examples/pgmaps-scene.html?embed')
    expect(engineKindOf('http://127.0.0.1:8460/pgmaps-scene.html?embed')).toBe('frame')
    // A blank variable is no variable.
    expect(roadRendererUrl('nanite', { VITE_FORESTRY_NANITE_URL: '  ' })).toBe('/engines/nanite/pgmaps-engine.js?embed')
  })

  it('puts this browser’s choice to keep grown trees on Nanite Forest’s address only', () => {
    const keep = { keepGrownTrees: true }
    expect(roadRendererUrl('nanite', {}, keep)).toBe('/engines/nanite/pgmaps-engine.js?embed&treecache=1')
    expect(roadRendererUrl('worldgen', {}, keep)).toBe('/engines/worldgen/pgmaps-engine.js?embed')
    expect(roadRendererUrl('pgmaps', {}, keep)).toBeNull()
    // What storage holds is read strictly: only a stored true keeps them.
    expect(parseEngineBrowserOptions({ keepGrownTrees: true })).toEqual(keep)
    for (const stored of [null, 'yes', {}, { keepGrownTrees: 'true' }, { keepGrownTrees: 1 }])
      expect(parseEngineBrowserOptions(stored)).toEqual(DEFAULT_ENGINE_BROWSER_OPTIONS)
    expect(DEFAULT_ENGINE_BROWSER_OPTIONS.keepGrownTrees).toBe(false)
  })

  it('says why an engine cannot be chosen', () => {
    expect(roadRendererUnavailable('pgmaps', { url: null, webGpu: false })).toBeNull()
    expect(roadRendererUnavailable('worldgen', { url: null, webGpu: true })).toMatch(/Not set up/)
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
    expect(
      engineStatsLine(roadRendererInfo('nanite'), { fps: 60, completedFps: 30, queue: { completionLatencyMs: 55 } }),
    ).toBe('Drawn by Nanite Forest · 60 submitted fps · 30 completed fps · 55 ms GPU completion')
  })
})

describe('an engine on a site of its own', () => {
  it('moves a loopback engine to the other loopback name, so it runs in its own process', () => {
    expect(
      separateSiteUrl('http://127.0.0.1:8460/pgmaps-scene.html?embed', 'http://127.0.0.1:5173/dev/forestry'),
    ).toEqual({
      url: 'http://localhost:8460/pgmaps-scene.html?embed',
      shared: false,
    })
    expect(separateSiteUrl('http://localhost:8461/x.html', 'http://localhost:5173/').url).toBe(
      'http://127.0.0.1:8461/x.html',
    )
    // Already apart: left as it is.
    expect(separateSiteUrl('http://127.0.0.1:8460/x.html', 'http://localhost:5173/')).toEqual({
      url: 'http://127.0.0.1:8460/x.html',
      shared: false,
    })
    expect(separateSiteUrl('https://engines.example.net/w.html', 'https://maps.example.org/')).toMatchObject({
      shared: false,
    })
    // A same-site engine elsewhere cannot be moved, and says so.
    expect(separateSiteUrl('https://engine.example.org/w.html', 'https://maps.example.org/')).toMatchObject({
      shared: true,
    })
  })
})

describe('engine environment', () => {
  it('sends bounded exposure compensation independently of the sun and clock', () => {
    const today = new Date('2026-11-26T20:00:00Z')
    const place = { lng: -122.7, lat: 53.9 }
    const base = engineEnvironment(DEFAULT_ENGINE_ENVIRONMENT, place, today)
    expect(engineEnvironment({ ...DEFAULT_ENGINE_ENVIRONMENT, exposureStops: 4 }, place, today)).toEqual({
      ...base,
      exposureStops: 2,
    })
  })
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
    // 2026-07-14 03:00 UTC is still 13 July in B.C. (A summer date: tzdata 2026e keeps B.C. on daylight time from
    // November 2026, so a winter offset depends on the platform's time-zone data.)
    const message = engineEnvironment(
      { ...DEFAULT_ENGINE_ENVIRONMENT, time: 'noon' },
      princeGeorge,
      new Date(Date.UTC(2026, 6, 14, 3)),
    )
    expect(message.dateTime).toBe('2026-07-13T14:00:00-07:00')
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
