import { describe, expect, it } from 'vitest'

import { computeAnalysis } from './analysis'
import { createEmptyScene, parseScene, serializeScene, type ForestryScene } from './scene'
import { buildSceneInput, sceneFingerprint } from './sceneInput'
import type { ElevationSource } from './terrain'
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
  STOOD_AT_MAX_LENGTH_METERS,
  SURVEYED_EYE_REACH_METERS,
  parseSurveyedEye,
  standingPoint,
  surveyedEyeAt,
  surveyedEyeElevation,
  surveyedEyeFor,
} from './viewpointStand'
import { haversineMeters, pointInPolygon, polygonAreaMeters } from './visibility'

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
