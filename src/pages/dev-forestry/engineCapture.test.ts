import { describe, expect, it } from 'vitest'
import { decodeClassRaster, FIGURE_CLASS, classColor } from '@/lib/forestry/viaFigure/composeFigure'
import {
  ENGINE_CLASS,
  ENGINE_CLASS_COLOUR,
  ENGINE_CLASS_PALETTE,
  cameraMismatch,
  captureRequest,
  captureTerrain,
  depthSummary,
  captureTransfer,
  illustrationLine,
  joinFrames,
  readCaptureReply,
  screeningCounts,
  type EngineCaptureRequest,
} from './engineCapture'
import type { ClassPassLayer } from './figureClassPass'
import { TREE_SPECIES_IDS } from './forest'
import { SCENE_TREE_FIELDS } from './scenePackage'
import { metersPerDegree } from './visibility'

const origin = { lng: -122.86, lat: 50.86, elevationMeters: 860 }
const m = metersPerDegree(origin.lat)
/** A square `size` metres across, its south-west corner `east`, `north` metres from the origin. */
const square = (east: number, north: number, size: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [origin.lng + east / m.lng, origin.lat + north / m.lat],
      [origin.lng + (east + size) / m.lng, origin.lat + north / m.lat],
      [origin.lng + (east + size) / m.lng, origin.lat + (north + size) / m.lat],
      [origin.lng + east / m.lng, origin.lat + (north + size) / m.lat],
      [origin.lng + east / m.lng, origin.lat + north / m.lat],
    ],
  ],
})
const layer = (id: ClassPassLayer['id'], geometry: GeoJSON.Polygon): ClassPassLayer => ({
  id,
  color: classColor(id as 'landform'),
  data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] },
})

const layers = [layer('landform', square(-1000, 3000, 2000)), layer('proposedIn', square(-200, 3600, 400))]

function request(): EngineCaptureRequest {
  return captureRequest({
    origin,
    eye: { lng: origin.lng + 10 / m.lng, lat: origin.lat - 20 / m.lat, elevation: 861.6 },
    frames: [
      { bearingDeg: -10, pitchDeg: 2, hfovDeg: 39.6, vfovDeg: 20 },
      { bearingDeg: 29.6, pitchDeg: 2, hfovDeg: 39.6, vfovDeg: 20 },
    ],
    frameWidth: 4,
    height: 2,
    layers,
    terrainColour: classColor('terrain'),
  })
}

const reply = (
  asked: EngineCaptureRequest,
  change: (frame: Record<string, unknown>, i: number) => void = () => {},
) => ({
  type: 'pgmaps-engine-capture',
  id: asked.id,
  engine: 'nanite',
  version: 'd838ab2',
  frames: asked.frames.map((frame, i) => {
    const out: Record<string, unknown> = {
      width: frame.width,
      height: frame.height,
      image: new Blob(['png'], { type: 'image/png' }),
      classes: new Uint8ClampedArray(frame.width * frame.height * 4),
      depth: new Float32Array(frame.width * frame.height),
      camera: {
        position: asked.position,
        bearingDegrees: frame.bearingDegrees,
        pitchDegrees: frame.pitchDegrees,
        horizontalFovDegrees: frame.horizontalFovDegrees,
        verticalFovDegrees: frame.verticalFovDegrees,
        near: 0.3,
        far: 30000,
      },
    }
    change(out, i)
    return out
  }),
  scene: { createdAt: '2026-11-13T19:00:00.000Z', origin },
  environment: { sun: { elevation: 30 } },
  maxTreeHeightMeters: 31.2,
  missing: ['The far terrain apron is invented.'],
})

describe('an engine capture request', () => {
  it('puts the eye and the class polygons in package metres, each frame at its size', () => {
    const asked = request()
    expect(asked.position).toEqual([10, -20, 861.6])
    expect(asked.frames[0]).toEqual({
      bearingDegrees: 350,
      pitchDegrees: 2,
      horizontalFovDegrees: 39.6,
      verticalFovDegrees: 20,
      width: 4,
      height: 2,
    })
    expect(asked.classes.layers.map((entry) => entry.id)).toEqual(['landform', 'proposedIn'])
    expect(asked.classes.layers[1].rgb).toEqual([255, 0, 0])
    expect(asked.classes.layers[1].polygons[0][0][0]).toEqual([-200, 3600])
    expect(asked.classes.layers[1].polygons[0][0][2]).toEqual([200, 4000])
    expect(asked.classes.terrain).toEqual([96, 96, 96])
    expect(request().id).not.toBe(asked.id)
  })

  it('asks for terrain out past the farthest class polygon, on a grid near 800 posts across', () => {
    const eye = { lng: origin.lng, lat: origin.lat }
    const reach = Math.hypot(1000, 5000)
    expect(captureTerrain(eye, layers)).toEqual({
      terrainRadiusMeters: 6500,
      terrainSpacingMeters: 17,
      // Stems half a kilometre past the farthest polygon; coarse ground to the skyline.
      treeRadiusMeters: 5600,
      farTerrainRadiusMeters: 15_000,
      farTerrainSpacingMeters: 60,
      reachMeters: Math.round(reach),
      clipped: false,
      // No skyline scan: nothing past the far terrain.
      skylineTerrainRadiusMeters: 0,
      skylineTerrainSpacingMeters: 0,
      skylineReachMeters: null,
      skylineClipped: false,
    })
    // Never less than the road view's own, and capped.
    expect(captureTerrain(eye, [layer('landform', square(10, 10, 50))]).terrainRadiusMeters).toBe(3000)
    expect(captureTerrain(eye, [layer('landform', square(0, 20_000, 100))])).toMatchObject({
      terrainRadiusMeters: 12_000,
      terrainSpacingMeters: 30,
      clipped: true,
    })
  })

  it('reaches past the far terrain to the frames’ farthest skyline, capped', () => {
    const eye = { lng: origin.lng, lat: origin.lat }
    // Lost Ledge: a peak on the left 19.4 km off, past the 15 km far terrain.
    expect(captureTerrain(eye, layers, undefined, { farthestMeters: 19_428, reachesLimit: false })).toMatchObject({
      farTerrainRadiusMeters: 15_000,
      farTerrainSpacingMeters: 60,
      skylineTerrainRadiusMeters: 22_000,
      skylineTerrainSpacingMeters: 88,
      skylineReachMeters: 19_428,
      skylineClipped: false,
    })
    // Marblehead VP2: the skyline at 11.3 km is inside the far terrain already.
    expect(captureTerrain(eye, layers, undefined, { farthestMeters: 11_289, reachesLimit: false })).toMatchObject({
      skylineTerrainRadiusMeters: 0,
      skylineReachMeters: 11_289,
    })
    expect(captureTerrain(eye, layers, undefined, { farthestMeters: 59_000, reachesLimit: true })).toMatchObject({
      skylineTerrainRadiusMeters: 60_000,
      skylineTerrainSpacingMeters: 240,
      skylineClipped: true,
    })
  })
})

describe('an engine capture reply', () => {
  it('is read when it answers the request frame for frame', () => {
    const asked = request()
    const read = readCaptureReply(reply(asked), asked)
    expect(read.frames).toHaveLength(2)
    expect(read).toMatchObject({ engine: 'nanite', version: 'd838ab2', maxTreeHeightMeters: 31.2 })
    expect(read.missing).toEqual(['The far terrain apron is invented.'])
    expect(cameraMismatch(read, asked)).toBeNull()
  })

  it('is refused with the reason when it does not', () => {
    const asked = request()
    expect(() => readCaptureReply({ ...reply(asked), id: 'other' }, asked)).toThrow(/Not this capture/)
    expect(() => readCaptureReply({ type: 'pgmaps-engine-capture', id: asked.id, error: 'GPU lost' }, asked)).toThrow(
      'GPU lost',
    )
    expect(() => readCaptureReply({ ...reply(asked), frames: reply(asked).frames.slice(1) }, asked)).toThrow(/1 frames/)
    expect(() =>
      readCaptureReply(
        reply(asked, (frame) => (frame.width = 5)),
        asked,
      ),
    ).toThrow(/5 × 2/)
    expect(() =>
      readCaptureReply(
        reply(asked, (frame) => (frame.depth = new Float32Array(3))),
        asked,
      ),
    ).toThrow(/depth/)
    expect(() =>
      readCaptureReply(
        reply(asked, (frame) => (frame.classes = new Uint8Array(8))),
        asked,
      ),
    ).toThrow(/class pass/)
  })

  it('names a frame drawn from another camera', () => {
    const asked = request()
    const turned = readCaptureReply(
      reply(asked, (frame, i) => {
        if (i === 1) (frame.camera as { bearingDegrees: number }).bearingDegrees += 1
      }),
      asked,
    )
    expect(cameraMismatch(turned, asked)).toBe('Frame 2 was drawn with turned.')
    const moved = readCaptureReply(
      reply(asked, (frame) => ((frame.camera as { position: number[] }).position = [10, -20, 870])),
      asked,
    )
    expect(cameraMismatch(moved, asked)).toMatch(/stood 8\.4 m from the eye/)
  })
})

describe('joining and reading the passes', () => {
  it('joins frames side by side, row by row', () => {
    const left = new Float32Array([1, 2, 3, 4])
    const right = new Float32Array([5, 6, 7, 8])
    expect(Array.from(joinFrames([left, right], 2, 2, 1, (n) => new Float32Array(n)))).toEqual([1, 2, 5, 6, 3, 4, 7, 8])
  })

  it('decodes trees and water as their own classes, outside the landform', () => {
    const pixels = [
      [...ENGINE_CLASS_COLOUR.vegetation, 255],
      [...ENGINE_CLASS_COLOUR.water, 255],
      [0, 160, 0, 255],
      [0, 0, 0, 0],
    ].flat()
    const raster = decodeClassRaster(pixels, 4, 1, ENGINE_CLASS_PALETTE)
    expect(Array.from(raster.codes)).toEqual([
      ENGINE_CLASS.vegetation,
      ENGINE_CLASS.water,
      FIGURE_CLASS.landform,
      FIGURE_CLASS.sky,
    ])
    expect(screeningCounts(raster)).toEqual({ vegetation: 1, water: 1 })
  })

  it('summarises depth with the sky left out', () => {
    expect(depthSummary(new Float32Array([0, 12.34, 4210.6, 0]))).toEqual({
      nearestM: 12.3,
      farthestM: 4211,
      skyShare: 0.5,
    })
    expect(depthSummary(new Float32Array(2))).toEqual({ nearestM: null, farthestM: null, skyShare: 1 })
  })

  it('says who drew the picture and its pixel measure', () => {
    expect(
      illustrationLine({
        renderer: 'Nanite Forest',
        version: 'd838ab2',
        capturedAt: '',
        sceneCreatedAt: null,
        environment: null,
        depth: { nearestM: 1, farthestM: 2, skyShare: 0 },
        missing: [],
      }),
    ).toBe('Picture and pixel measures: Nanite Forest d838ab2, one capture')
  })
})

describe('a final capture', () => {
  const stand = {
    fields: SCENE_TREE_FIELDS,
    species: TREE_SPECIES_IDS,
    count: 2,
    data: new Float32Array(14),
    radiusMeters: 4600,
    requestedRadiusMeters: 7400,
    bearings: [340, 420] as [number, number],
    clipped: true,
    spacingMeters: 4,
    millis: 450,
  }
  const finalRequest = (withStand = true): EngineCaptureRequest =>
    captureRequest({
      origin,
      eye: { lng: origin.lng, lat: origin.lat, elevation: 861.6 },
      frames: [{ bearingDeg: 20, pitchDeg: 2, hfovDeg: 39.6, vfovDeg: 20 }],
      frameWidth: 4,
      height: 2,
      layers,
      terrainColour: classColor('terrain'),
      final: { stand: withStand ? { ...stand, data: new Float32Array(14) } : null },
    })

  it('asks for the final quality with the stand, handed over rather than copied', () => {
    const asked = finalRequest()
    expect(asked).toMatchObject({ quality: 'final', samples: 24, canopyCutoffPx: 4 })
    expect(asked.stand).toMatchObject({ count: 2, radiusMeters: 4600, bearings: [340, 420], fields: SCENE_TREE_FIELDS })
    expect(captureTransfer(asked)).toEqual([asked.stand!.data.buffer])
    expect(captureTransfer(request())).toEqual([])
    expect(request().quality).toBeUndefined()
    expect(finalRequest(false).stand).toBeUndefined()
  })

  it('reads what the engine drew, or that it drew the active capture', () => {
    const asked = finalRequest()
    const drawn = readCaptureReply(
      { ...reply(asked), final: { samples: 24, stems: 1_380_000, canopyCutoffMeters: 5200, millis: 9100 } },
      asked,
    )
    expect(drawn.final).toEqual({ samples: 24, stems: 1_380_000, canopyCutoffMeters: 5200, millis: 9100 })
    expect(readCaptureReply(reply(asked), asked).final).toBeNull()
    const active = request()
    expect(readCaptureReply(reply(active), active).final).toBeUndefined()
    const base = {
      renderer: 'Nanite Forest',
      version: 'd838ab2',
      capturedAt: '',
      sceneCreatedAt: null,
      environment: null,
      depth: { nearestM: 1, farthestM: 2, skyShare: 0 },
      missing: [],
    }
    expect(illustrationLine({ ...base, final: drawn.final })).toBe(
      'Picture and pixel measures: Nanite Forest d838ab2, one capture; final render: 24 samples, 1.38 M stems',
    )
    expect(illustrationLine({ ...base, final: null })).toBe(
      'Picture and pixel measures: Nanite Forest d838ab2, one capture; active render (final not drawn)',
    )
  })
})
