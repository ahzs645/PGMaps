import { describe, expect, it } from 'vitest'
import { CONE_BASE_DIAMETER, type TreeInstance } from '../forest'
import { SCENE_TREATED_FIELDS, SCENE_TREATED_KINDS, buildScenePackage, type ScenePackageInput } from '../scenePackage'
import type { ElevationSource } from '../terrain'
import { metersPerDegree } from '../visibility'

const EYE = { lng: -122.6, lat: 53.9 }
const m = metersPerDegree(EYE.lat)
const flat: ElevationSource = { elevationAt: () => 700 }
const input: ScenePackageInput = {
  eye: EYE,
  eyeHeightMeters: 1.5,
  bearingDegrees: 0,
  pitchDegrees: 0,
  verticalFovDegrees: 40,
  forest: { anchorLatitude: EYE.lat, stands: [], clearings: [], openings: [], standHeightMeters: 25 },
  elevation: flat,
  treeRadiusMeters: 300,
  terrainRadiusMeters: 400,
  terrainSpacingMeters: 50,
  includeModels: false,
  createdAt: new Date('2026-11-15T12:00:00Z'),
}

const at = (east: number, north: number, patch: Partial<TreeInstance>): TreeInstance => ({
  lng: EYE.lng + east / m.lng,
  lat: EYE.lat + north / m.lat,
  elevationMeters: 0,
  heightMeters: 1,
  slenderness: 1,
  tone: 0.5,
  species: 'spruce',
  variant: 0,
  ...patch,
})

describe('a prescription’s treated stems in the scene package', () => {
  it('is absent when no block has a prescription', () => {
    expect(buildScenePackage(input).treated).toBeUndefined()
  })

  it('carries stumps, lying stems and snags within the tree radius, sized as drawn', () => {
    const treated = {
      stump: [at(10, 20, { heightMeters: 0.35, slenderness: (0.3 * CONE_BASE_DIAMETER) / 0.35 })],
      felled: [at(30, 40, { heightMeters: 0.3, slenderness: (24 * CONE_BASE_DIAMETER) / 0.3, headingDegrees: 120 })],
      log: [at(5000, 0, { heightMeters: 0.3, slenderness: 10 })],
      snag: [at(-20, 15, { heightMeters: 6, slenderness: (0.4 * CONE_BASE_DIAMETER) / 6 })],
    }
    const scene = buildScenePackage({ ...input, forest: { ...input.forest, treated } })
    expect(scene.treated?.kinds).toEqual(SCENE_TREATED_KINDS)
    const stride = SCENE_TREATED_FIELDS.length
    const rows = Array.from({ length: scene.treated!.count }, (_, i) =>
      scene.treated!.data.slice(i * stride, (i + 1) * stride),
    )
    // The log 5 km out is past the tree radius.
    expect(rows).toHaveLength(3)
    const [stump, felled, snag] = rows
    expect(stump.slice(3)).toEqual([0, 0.35, 0.3, 0])
    expect(felled.slice(3)).toEqual([1, 24, 0.3, 120])
    expect(snag.slice(3)).toEqual([3, 6, 0.4, 0])
    expect(felled[2]).toBe(700)
  })
})
