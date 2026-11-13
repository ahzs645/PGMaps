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
  it('writes the chosen local date and time with that day’s offset, and the place', () => {
    const message = engineEnvironment(
      { date: '2026-07-15', time: '9:30', ground: 'snow', weather: 'overcast' },
      { lng: -122.645589, lat: 53.910421 },
      new Date(2026, 10, 13),
    )
    const local = new Date(2026, 6, 15, 9, 30)
    expect(new Date(message.dateTime).getTime()).toBe(local.getTime())
    expect(message.dateTime.startsWith('2026-07-15T09:30:00')).toBe(true)
    expect(message).toMatchObject({ latitude: 53.91042, longitude: -122.64559, ground: 'snow', weather: 'overcast' })
  })

  it('takes today when no date is chosen, and the default time for a malformed one', () => {
    const message = engineEnvironment(
      { ...DEFAULT_ENGINE_ENVIRONMENT, time: 'noon' },
      { lng: 0, lat: 0 },
      new Date(2026, 10, 13, 8),
    )
    expect(message.dateTime.startsWith('2026-11-13T14:00:00')).toBe(true)
    expect(message).toMatchObject({ ground: 'bare', weather: 'clear' })
  })
})
