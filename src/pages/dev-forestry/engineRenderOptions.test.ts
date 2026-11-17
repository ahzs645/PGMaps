import { describe, expect, it } from 'vitest'
import { captureForEngine } from './engineRequests'
import { DEFAULT_ENGINE_RENDER_OPTIONS, engineCaptureOptionsKey, parseEngineRenderOptions } from './engineRenderOptions'
import type { EngineCaptureRequest } from './engineCapture'
import { SCENE_TREE_FIELDS } from './sceneComponents'

describe('external renderer quality controls', () => {
  it('invalidates final images for dissolve changes and reuses them across live pacing changes', () => {
    const options = { ...DEFAULT_ENGINE_RENDER_OPTIONS }
    expect(engineCaptureOptionsKey({ ...options, resolutionScale: 0.5, maxFps: 30, maxInFlight: 1 })).toBe(
      engineCaptureOptionsKey(options),
    )
    expect(engineCaptureOptionsKey({ ...options, dissolveMode: 'pixels' })).not.toBe(engineCaptureOptionsKey(options))
  })
  it('normalizes persisted and partial values without changing valid zero frame limits', () => {
    expect(parseEngineRenderOptions(null)).toEqual(DEFAULT_ENGINE_RENDER_OPTIONS)
    const parsed = parseEngineRenderOptions({
      resolutionScale: 0.1,
      maxFps: 0,
      maxInFlight: 9,
      dissolvePixels: NaN,
      dissolveReferenceHeight: 9000,
      frustumCulling: false,
    })
    expect(parsed).toMatchObject({
      resolutionScale: 0.5,
      maxFps: 0,
      maxInFlight: 3,
      dissolvePixels: 4,
      dissolveReferenceHeight: 4320,
      frustumCulling: false,
    })
    expect(parseEngineRenderOptions({ maxFps: 8 }, parsed).maxFps).toBe(15)
    expect(parseEngineRenderOptions({ resolutionScale: 0.75 }, parsed)).toMatchObject({
      ...parsed,
      resolutionScale: 0.75,
    })
  })

  it('negotiates final stands and frozen quality together, keeping legacy engines readable', () => {
    const request: EngineCaptureRequest = {
      type: 'pgmaps-capture',
      id: 'test',
      position: [0, 0, 800],
      frames: [],
      classes: { terrain: [1, 2, 3], layers: [], vegetation: [4, 5, 6], water: [7, 8, 9] },
      stand: {
        fields: SCENE_TREE_FIELDS,
        species: ['spruce', 'hemlock'],
        count: 1,
        data: Float32Array.from([1, 2, 3, 1, 6, 5, 0, 0, 12, 4, 1, 2]),
        ids: ['measured-a'],
        radiusMeters: 100,
        bearings: [0, 90],
      },
    }
    const options = { ...DEFAULT_ENGINE_RENDER_OPTIONS, resolutionScale: 0.5 }
    const legacy = captureForEngine(request, [], options)
    expect(legacy.renderOptions).toBeUndefined()
    expect(legacy.stand!.fields).toHaveLength(7)
    expect(legacy.stand!.species[legacy.stand!.data[3]]).toBe('fir')
    expect(legacy.stand!.data[5]).toBe(5)
    expect(legacy.stand!.ids).toBeUndefined()
    const modern = captureForEngine(request, ['stand-components-v1', 'stand-fields-v1', 'render-options-v1'], options)
    options.resolutionScale = 1
    expect(modern.renderOptions!.resolutionScale).toBe(0.5)
    expect(modern.stand).toBe(request.stand)
    expect(request.stand!.fields).toHaveLength(12)
    expect(request.stand!.ids).toEqual(['measured-a'])
  })
})
