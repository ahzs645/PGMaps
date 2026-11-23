import { describe, expect, it } from 'vitest'

import { computeAnalysis } from './analysis'
import { createEmptyScene, parseScene, serializeScene, type ForestryScene } from './scene'
import { buildSceneInput, sceneFingerprint } from './sceneInput'
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisInput } from './types'
import {
  DEFAULT_VIEWPOINT_CLEARING,
  VIEWPOINT_CLEARING,
  VIEWPOINT_CLEARING_ID,
  parseViewpointClearing,
  viewpointClearingArea,
} from './treeFreeAreas'
import { PULLOUT_METERS, pulloutThrough } from './viewpointInventory'
import {
  PHOTO_STAND_REACH_METERS,
  photoStandReach,
  STOOD_AT_MAX_LENGTH_METERS,
  SURVEYED_EYE_REACH_METERS,
  parseStandEyeHeight,
  parseSurveyedEye,
  standEyeHeight,
  standEyeHeightFor,
  standingPoint,
  surveyedEyeAt,
  surveyedEyeElevation,
  surveyedEyeFor,
} from './viewpointStand'
import { haversineMeters, pointInPolygon, polygonAreaMeters } from './visibility'
import { viewCaptureCamera } from './viewCamera'

// Marblehead VP2, Duncan Dam Scenic Viewpoint, as printed in its VIA.
const VP2 = { lng: -116.95101397, lat: 50.25611033 }

function sceneAt(viewpoint: ForestryScene['viewpoint']): ForestryScene {
  return { ...createEmptyScene(), viewpoint }
}

describe('a stood-at viewpoint', () => {
  it('is a spot, or a pullout no longer than the road view treats as a spot', () => {
    expect(STOOD_AT_MAX_LENGTH_METERS).toBe(2 * PULLOUT_METERS)
    expect(standingPoint({ mode: 'spot', coordinates: [[VP2.lng, VP2.lat]] })).toEqual(VP2)
    const pullout = pulloutThrough(VP2, { lng: VP2.lng - 0.01, lat: VP2.lat })
    const middle = standingPoint({ mode: 'corridor', coordinates: pullout })!
    expect(haversineMeters(middle, VP2)).toBeLessThan(0.01)
    const road: Array<[number, number]> = [
      [VP2.lng, VP2.lat],
      [VP2.lng + 0.01, VP2.lat],
    ]
    expect(standingPoint({ mode: 'corridor', coordinates: road })).toBeNull()
    expect(standingPoint({ mode: 'corridor', coordinates: [] })).toBeNull()
  })

  it('keeps a surveyed eye elevation only for the point it was entered at', () => {
    const viewpoint = {
      id: 'vp',
      name: 'VP2',
      mode: 'spot' as const,
      coordinates: [[VP2.lng, VP2.lat]] as Array<[number, number]>,
    }
    const surveyedEye = surveyedEyeFor(viewpoint, 637.6)!
    expect(surveyedEye).toEqual({ elevationMeters: 637.6, ...VP2 })
    expect(surveyedEyeElevation({ ...viewpoint, surveyedEye })).toBe(637.6)
    // Moved 50 m: kept, but it no longer applies.
    const moved = { ...viewpoint, coordinates: [[VP2.lng + 0.0007, VP2.lat]] as Array<[number, number]>, surveyedEye }
    expect(surveyedEyeElevation(moved)).toBeNull()
    expect(surveyedEyeFor(viewpoint, null)).toBeUndefined()
    expect(
      surveyedEyeFor(
        {
          mode: 'corridor',
          coordinates: [
            [0, 0],
            [0.1, 0],
          ],
        },
        600,
      ),
    ).toBeUndefined()
  })

  it('reads a saved record, dropping a malformed one rather than the scene', () => {
    expect(parseSurveyedEye({ elevationMeters: 636, ...VP2 })).toEqual({ elevationMeters: 636, ...VP2 })
    expect(parseSurveyedEye({ elevationMeters: 'high', ...VP2 })).toBeUndefined()
    expect(parseSurveyedEye({ elevationMeters: 99999, ...VP2 })).toBeUndefined()
    expect(parseSurveyedEye({ elevationMeters: 636 })).toBeUndefined()
    expect(parseSurveyedEye(null)).toBeUndefined()
  })

  it('stands the road view eye at the surveyed elevation near its point, and on the terrain model beyond', () => {
    const surveyed = { elevationMeters: 637.6, ...VP2 }
    expect(surveyedEyeAt(surveyed, VP2)).toBe(637.6)
    const metresEast = (m: number) => ({
      lng: VP2.lng + m / (111_320 * Math.cos((VP2.lat * Math.PI) / 180)),
      lat: VP2.lat,
    })
    expect(surveyedEyeAt(surveyed, metresEast(SURVEYED_EYE_REACH_METERS - 1))).toBe(637.6)
    expect(surveyedEyeAt(surveyed, metresEast(SURVEYED_EYE_REACH_METERS + 1))).toBeNull()
    expect(surveyedEyeAt(null, VP2)).toBeNull()
  })
})

describe('the surveyed eye elevation in the scene and the run', () => {
  const viewpoint = {
    id: 'VP2',
    name: 'Duncan Dam',
    mode: 'spot' as const,
    coordinates: [[VP2.lng, VP2.lat]] as Array<[number, number]>,
  }

  it('survives a save, and a scene saved without one still reads', () => {
    const scene = sceneAt({ ...viewpoint, surveyedEye: { elevationMeters: 637.6, ...VP2 } })
    const back = parseScene(JSON.parse(serializeScene(scene)))!
    expect(back.viewpoint.surveyedEye).toEqual({ elevationMeters: 637.6, ...VP2 })
    const old = parseScene(JSON.parse(serializeScene(sceneAt(viewpoint))))!
    expect(old.viewpoint.surveyedEye).toBeUndefined()
    expect(old.viewpointClearing).toBeUndefined()
  })

  it('is a run input: it reaches the analysis input and the fingerprint', () => {
    const plain = sceneAt(viewpoint)
    const surveyed = sceneAt({ ...viewpoint, surveyedEye: { elevationMeters: 637.6, ...VP2 } })
    expect(buildSceneInput(plain).viewpoint.eyeElevationMeters).toBeUndefined()
    expect(buildSceneInput(surveyed).viewpoint.eyeElevationMeters).toBe(637.6)
    expect(sceneFingerprint(surveyed)).not.toBe(sceneFingerprint(plain))
    const other = sceneAt({ ...viewpoint, surveyedEye: { elevationMeters: 640, ...VP2 } })
    expect(sceneFingerprint(other)).not.toBe(sceneFingerprint(surveyed))
    // One left behind at another point is not read, so it does not stale the run either.
    const lapsed = sceneAt({
      ...viewpoint,
      surveyedEye: { elevationMeters: 637.6, lng: VP2.lng + 0.001, lat: VP2.lat },
    })
    expect(buildSceneInput(lapsed).viewpoint.eyeElevationMeters).toBeUndefined()
    expect(sceneFingerprint(lapsed)).toBe(sceneFingerprint(plain))
  })

  it('stands every station eye there, keeping the terrain model ground beside it', () => {
    // Flat ground with a 20 m wall between the eye and the block: the terrain model's eye
    // (1.6 m up) cannot see over it; a surveyed eye 60 m up can.
    const wall: ElevationSource = { elevationAt: (lng) => (lng > -0.0405 && lng < -0.0395 ? 20 : 0) }
    const input = (eyeElevationMeters?: number): AnalysisInput => ({
      viewpoint: {
        mode: 'spot',
        coordinates: [[-0.06, 0]],
        ...(eyeElevationMeters !== undefined ? { eyeElevationMeters } : {}),
      },
      targets: [
        {
          id: 'block',
          name: 'Block',
          role: 'block',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-0.02, -0.005],
                [-0.01, -0.005],
                [-0.01, 0.005],
                [-0.02, 0.005],
                [-0.02, -0.005],
              ],
            ],
          },
          harvestYear: null,
          clearcutPercent: null,
        },
      ],
      settings: { ...DEFAULT_ANALYSIS_SETTINGS, sampleBudget: 200, maxViewDistanceMeters: 20000 },
      assessmentYear: 2026,
    })
    const terrain = { tileCount: 1, missingTileCount: 0, resolutionMeters: 25 }
    const onModel = computeAnalysis(wall, input(), terrain)
    expect(onModel.stations[0].groundElevationMeters).toBe(0)
    expect(onModel.stations[0].terrainGroundElevationMeters).toBeUndefined()
    expect(onModel.targets[0].stations[0].visiblePercent).toBe(0)
    const surveyed = computeAnalysis(wall, input(60), terrain)
    expect(surveyed.stations[0].groundElevationMeters).toBeCloseTo(
      60 - DEFAULT_ANALYSIS_SETTINGS.observerHeightMeters,
      9,
    )
    expect(surveyed.stations[0].terrainGroundElevationMeters).toBe(0)
    expect(surveyed.targets[0].stations[0].visiblePercent).toBeGreaterThan(90)
  })
})

describe("a view's eye height above the ground, at its stand", () => {
  // A made-up place: a pullout through a lookout, square to a block to the east.
  const LOOKOUT = { lng: -122.4, lat: 54.2 }
  const pullout = pulloutThrough(LOOKOUT, { lng: -122.35, lat: 54.2 })
  const stand = { id: 'stand-lookout', name: 'Lookout', mode: 'corridor' as const, coordinates: pullout }
  const height = (meters: number, at = LOOKOUT) => ({ heightMeters: meters, lng: at.lng, lat: at.lat })

  it('applies only at the point it was set for, and a surveyed elevation wins over it', () => {
    const record = standEyeHeightFor(stand, 3)!
    expect(haversineMeters(record, LOOKOUT)).toBeLessThan(0.01)
    expect(standEyeHeight({ ...stand, standEyeHeight: record })).toBe(3)
    // Moved 50 m: kept, but it no longer applies.
    expect(standEyeHeight({ ...stand, standEyeHeight: height(3, { ...LOOKOUT, lng: LOOKOUT.lng + 0.0007 }) })).toBe(
      null,
    )
    // A road is not stood at; a height out of range or blank is no record.
    const road: Array<[number, number]> = [
      [LOOKOUT.lng, LOOKOUT.lat],
      [LOOKOUT.lng + 0.01, LOOKOUT.lat],
    ]
    expect(standEyeHeightFor({ mode: 'corridor', coordinates: road }, 3)).toBeUndefined()
    expect(standEyeHeightFor(stand, 0)).toBeUndefined()
    expect(standEyeHeightFor(stand, null)).toBeUndefined()
    const both = { ...stand, standEyeHeight: record, surveyedEye: surveyedEyeFor(stand, 812.4) }
    expect(standEyeHeight(both)).toBeNull()
    expect(surveyedEyeElevation(both)).toBe(812.4)
  })

  it("is what standing at a view with its own height above the ground sets, and the elevation's wins", () => {
    const view = { focalMm: 50, eye: { reference: 'ground' as const, meters: 3 } }
    const camera = viewCaptureCamera(view)
    expect(camera).toMatchObject({ eyeHeightMeters: 3, surveyedEyeMeters: null })
    const scene = sceneAt({ ...stand, standEyeHeight: standEyeHeightFor(stand, camera.eyeHeightMeters) })
    expect(buildSceneInput(scene).viewpoint).toEqual({ mode: 'corridor', coordinates: pullout, eyeHeightMeters: 3 })
    const surveyed = viewCaptureCamera({ focalMm: 50, eye: { reference: 'elevation', meters: 812.4 } })
    expect(surveyed).toMatchObject({ eyeHeightMeters: null, surveyedEyeMeters: 812.4 })
    // A stand holding both reads the elevation alone.
    const both = sceneAt({ ...scene.viewpoint, surveyedEye: surveyedEyeFor(stand, 812.4) })
    expect(buildSceneInput(both).viewpoint).toEqual({
      mode: 'corridor',
      coordinates: pullout,
      eyeElevationMeters: 812.4,
    })
    expect(sceneFingerprint(both)).toBe(
      sceneFingerprint(sceneAt({ ...stand, surveyedEye: both.viewpoint.surveyedEye })),
    )
  })

  it('is a run input at its stand: it reaches the analysis input and the fingerprint, and a lapsed one does not', () => {
    const plain = sceneAt(stand)
    const raised = sceneAt({ ...stand, standEyeHeight: height(3) })
    expect(buildSceneInput(plain).viewpoint.eyeHeightMeters).toBeUndefined()
    expect('eyeHeightMeters' in buildSceneInput(plain).viewpoint).toBe(false)
    expect(sceneFingerprint(raised)).not.toBe(sceneFingerprint(plain))
    expect(sceneFingerprint(sceneAt({ ...stand, standEyeHeight: height(4) }))).not.toBe(sceneFingerprint(raised))
    const lapsed = sceneAt({ ...stand, standEyeHeight: height(3, { ...LOOKOUT, lng: LOOKOUT.lng + 0.001 }) })
    expect(buildSceneInput(lapsed)).toEqual(buildSceneInput(plain))
    expect(sceneFingerprint(lapsed)).toBe(sceneFingerprint(plain))
  })

  it('survives a save, drops a malformed record rather than the scene, and a scene without one still reads', () => {
    const scene = sceneAt({ ...stand, standEyeHeight: height(3) })
    expect(parseScene(JSON.parse(serializeScene(scene)))!.viewpoint.standEyeHeight).toEqual(height(3))
    expect(parseScene(JSON.parse(serializeScene(sceneAt(stand))))!.viewpoint).toEqual(stand)
    expect(parseStandEyeHeight({ heightMeters: 'tall', ...LOOKOUT })).toBeUndefined()
    expect(parseStandEyeHeight({ heightMeters: 0, ...LOOKOUT })).toBeUndefined()
    expect(parseStandEyeHeight({ heightMeters: 3 })).toBeUndefined()
    expect(parseStandEyeHeight(null)).toBeUndefined()
  })

  describe('in the run', () => {
    // Flat ground with a low bank between the eye and the block: 1.6 m up cannot see over it, 3 m up can.
    const BANK_METERS = 1.2
    const bank: ElevationSource = { elevationAt: (lng) => (lng > -0.0405 && lng < -0.0395 ? BANK_METERS : 0) }
    const input = (viewpoint: Partial<AnalysisInput['viewpoint']> = {}, observerHeightMeters = 1.6): AnalysisInput => ({
      viewpoint: { mode: 'spot', coordinates: [[-0.06, 0]], ...viewpoint },
      targets: [
        {
          id: 'landform',
          name: 'Landform',
          role: 'landscape',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-0.025, -0.01],
                [-0.005, -0.01],
                [-0.005, 0.01],
                [-0.025, 0.01],
                [-0.025, -0.01],
              ],
            ],
          },
          harvestYear: null,
          clearcutPercent: null,
        },
        {
          id: 'block',
          name: 'Block',
          role: 'block',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-0.02, -0.005],
                [-0.01, -0.005],
                [-0.01, 0.005],
                [-0.02, 0.005],
                [-0.02, -0.005],
              ],
            ],
          },
          harvestYear: null,
          clearcutPercent: null,
        },
      ],
      settings: { ...DEFAULT_ANALYSIS_SETTINGS, observerHeightMeters, sampleBudget: 200, maxViewDistanceMeters: 20000 },
      assessmentYear: 2026,
      activeLandformId: 'landform',
    })
    const terrain = { tileCount: 1, missingTileCount: 0, resolutionMeters: 25 }
    const block = (result: ReturnType<typeof computeAnalysis>) => result.targets.find((t) => t.targetId === 'block')!
    // Everything a result holds but the time it took and the input it echoes.
    const figures = (result: ReturnType<typeof computeAnalysis>) => {
      const rest: Partial<typeof result> = { ...result }
      delete rest.elapsedMs
      delete rest.inputSignature
      delete rest.inputSnapshot
      return JSON.parse(JSON.stringify(rest))
    }

    it('sees from the stand’s own eye height, as the scene’s set to it would, and says so in its settings', () => {
      const scenes = computeAnalysis(bank, input(), terrain)
      expect(block(scenes).stations[0].visiblePercent).toBe(0)
      const own = computeAnalysis(bank, input({ eyeHeightMeters: 3 }), terrain)
      expect(block(own).stations[0].visiblePercent).toBeGreaterThan(90)
      // The figure a sheet prints beside a picture taken from 3 m is the figure from 3 m.
      expect(own.settings.observerHeightMeters).toBe(3)
      expect(own.inputSnapshot!.settings.observerHeightMeters).toBe(1.6)
      expect(own.inputSnapshot!.viewpoint.eyeHeightMeters).toBe(3)
      expect(figures(own)).toEqual(figures(computeAnalysis(bank, input({}, 3), terrain)))
    })

    it('leaves a run without one exactly as it was', () => {
      const result = computeAnalysis(bank, input(), terrain)
      expect(result.settings).toEqual(input().settings)
      expect(result.inputSignature).not.toContain('eyeHeightMeters')
    })

    it('takes the elevation where both are given, the stand’s height only placing the ground under it', () => {
      const surveyed = computeAnalysis(bank, input({ eyeElevationMeters: 1.6 }), terrain)
      const both = computeAnalysis(bank, input({ eyeElevationMeters: 1.6, eyeHeightMeters: 3 }), terrain)
      expect(block(both).stations[0].visiblePercent).toBe(block(surveyed).stations[0].visiblePercent)
      expect(both.stations[0].groundElevationMeters).toBeCloseTo(1.6 - 3, 9)
    })
  })
})

describe('the viewpoint clearing', () => {
  it('opens a fan toward the view and a circle round the eye', () => {
    const area = viewpointClearingArea(VP2, 270, DEFAULT_VIEWPOINT_CLEARING)!
    expect(area.id).toBe(VIEWPOINT_CLEARING_ID)
    const metres = (bearing: number, m: number) => {
      const r = (bearing * Math.PI) / 180
      return {
        lng: VP2.lng + (Math.sin(r) * m) / (111_320 * Math.cos((VP2.lat * Math.PI) / 180)),
        lat: VP2.lat + (Math.cos(r) * m) / 110_574,
      }
    }
    const inside = (p: { lng: number; lat: number }) => pointInPolygon(area.geometry, p.lng, p.lat)
    expect(inside(metres(270, 100))).toBe(true)
    expect(inside(metres(270 + 60, 100))).toBe(true)
    expect(inside(metres(270, 130))).toBe(false)
    expect(inside(metres(270 - 80, 50))).toBe(false)
    // Behind the eye, only the circle.
    expect(inside(metres(90, 10))).toBe(true)
    expect(inside(metres(90, 20))).toBe(false)
    // About 140/360 of a 120 m circle, plus the rest of the 15 m one.
    const expected = (Math.PI * 120 ** 2 * 140) / 360 + (Math.PI * 15 ** 2 * 220) / 360
    expect(polygonAreaMeters(area.geometry)).toBeGreaterThan(expected * 0.97)
    expect(polygonAreaMeters(area.geometry)).toBeLessThan(expected * 1.01)
  })

  it('is the eye circle alone with nothing to face, nothing when off, and clamps the radius', () => {
    const circle = viewpointClearingArea(VP2, null, DEFAULT_VIEWPOINT_CLEARING)!
    expect(polygonAreaMeters(circle.geometry)).toBeLessThan(Math.PI * 15 ** 2 * 1.01)
    expect(viewpointClearingArea(VP2, 270, { enabled: false, radiusMeters: 120 })).toBeNull()
    expect(parseViewpointClearing(undefined)).toEqual({ enabled: true, radiusMeters: VIEWPOINT_CLEARING.radiusMeters })
    expect(parseViewpointClearing({ enabled: false, radiusMeters: 5000 })).toEqual({
      enabled: false,
      radiusMeters: VIEWPOINT_CLEARING.maxRadiusMeters,
    })
  })

  it('is display only: out of the run input and the fingerprint', () => {
    const viewpoint = {
      id: 'VP2',
      name: 'VP2',
      mode: 'spot' as const,
      coordinates: [[VP2.lng, VP2.lat]] as Array<[number, number]>,
    }
    const on = sceneAt(viewpoint)
    const off = { ...on, viewpointClearing: { enabled: false, radiusMeters: 200 } }
    expect(sceneFingerprint(off)).toBe(sceneFingerprint(on))
    expect(JSON.stringify(buildSceneInput(off))).toBe(JSON.stringify(buildSceneInput(on)))
    expect(parseScene(JSON.parse(serializeScene(off)))!.viewpointClearing).toEqual(off.viewpointClearing)
  })
})

describe('clearing private land', () => {
  it('is saved with the scene and never stales the run', () => {
    const plain = createEmptyScene()
    const cleared: ForestryScene = { ...plain, clearPrivateLand: true }
    expect(parseScene(JSON.parse(serializeScene(cleared)))!.clearPrivateLand).toBe(true)
    expect(parseScene(JSON.parse(serializeScene(plain)))!.clearPrivateLand).toBeUndefined()
    expect(sceneFingerprint(cleared)).toBe(sceneFingerprint(plain))
    expect(JSON.stringify(buildSceneInput(cleared))).toBe(JSON.stringify(buildSceneInput(plain)))
  })
})

describe('a photo viewpoint', () => {
  // A made-up place; nothing here is a real photo's.
  const EYE = { lng: -123.2, lat: 54.1 }
  const BLOCK_CENTRE = { lng: -123.05, lat: 54.12 }

  it('stands the eye at the photo’s altitude through the stand’s pullout', () => {
    const viewpoint = { mode: 'corridor' as const, coordinates: pulloutThrough(EYE, BLOCK_CENTRE) }
    const surveyedEye = surveyedEyeFor(viewpoint, 1240)!
    expect(haversineMeters(surveyedEye, EYE)).toBeLessThan(0.01)
    expect(surveyedEyeElevation({ ...viewpoint, surveyedEye })).toBe(1240)
    // The road view stands there while the walker keeps to the pullout.
    expect(surveyedEyeAt(surveyedEye, EYE)).toBe(1240)
  })

  it('loads ground ahead of an aerial camera, not round a ground one', () => {
    expect(photoStandReach(EYE, { altitudeMeters: null, hfov: 50 }, 90)).toBeNull()
    const reach = photoStandReach(EYE, { altitudeMeters: 1200, hfov: 50 }, 90)!
    const [west, south, east, north] = reach
    // Facing east: from the eye out to the reach, and as wide as the frame and its margins.
    expect(west).toBeCloseTo(EYE.lng, 9)
    const far = haversineMeters(EYE, { lng: east, lat: EYE.lat })
    expect(far).toBeGreaterThan(PHOTO_STAND_REACH_METERS * 0.995)
    expect(far).toBeLessThan(PHOTO_STAND_REACH_METERS * 1.005)
    const across = haversineMeters({ lng: EYE.lng, lat: south }, { lng: EYE.lng, lat: north })
    // Half-angle 35°: 2 × 25 km × sin 35° ≈ 28.7 km.
    expect(across).toBeGreaterThan(28_000)
    expect(across).toBeLessThan(29_500)
    expect(photoStandReach(EYE, { altitudeMeters: 1200, hfov: Number.NaN }, 90)).toBeNull()
  })
})
