import { describe, expect, it } from 'vitest'
import { beforeHarvestCells } from './beforeHarvestCells'
import { buildStand, buildStandFromImport } from './standTrees'
import { applyPrescription, DEFAULT_PRESCRIPTION } from './prescription'
import { prescribedCells } from './prescribedCells'
import { buildScenePackage, type ScenePackageInput } from '../scenePackage'
import { finalStandSteps } from '../finalStand'
import { metersPerDegree } from '../visibility'

const eye = { lng: -122.8, lat: 53.9 },
  metres = metersPerDegree(eye.lat)
const geometry: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-40, -40],
      [40, -40],
      [40, 40],
      [-40, 40],
      [-40, -40],
    ].map(([x, y]) => [eye.lng + x / metres.lng, eye.lat + y / metres.lat]),
  ],
}
const elevation = { elevationAt: () => 800 }
const standInput = { geometry, inventory: [], anchorLatitude: eye.lat }
const imported = buildStandFromImport({
  ...standInput,
  trees: [
    {
      id: 'wide',
      lng: eye.lng,
      lat: eye.lat,
      species: 'cottonwood',
      heightMeters: 6,
      crownWidthMeters: 5,
      dbhCm: 18,
      crownBaseMeters: 0,
    },
    {
      id: 'tall',
      lng: eye.lng + 8 / metres.lng,
      lat: eye.lat,
      species: 'hemlock',
      heightMeters: 25,
      crownWidthMeters: 4,
      dbhCm: 32,
      crownBaseMeters: 17,
    },
  ],
}).stand!
const prescription = {
  ...DEFAULT_PRESCRIPTION,
  order: 'fromAbove' as const,
  target: { kind: 'stemShare' as const, value: 50 },
}
const result = applyPrescription(imported, prescription)
const forest = (cells: NonNullable<ReturnType<typeof beforeHarvestCells>>): ScenePackageInput['forest'] => ({
  anchorLatitude: eye.lat,
  stands: [],
  clearings: [],
  thinnings: [{ geometry, keepFraction: 1, prescribed: cells }],
  standHeightMeters: 25,
})
const scene = (cells: NonNullable<ReturnType<typeof beforeHarvestCells>>) =>
  buildScenePackage({
    eye,
    elevation,
    eyeHeightMeters: 1.6,
    bearingDegrees: 0,
    pitchDegrees: 0,
    verticalFovDegrees: 40,
    forest: forest(cells),
    treeRadiusMeters: 120,
    terrainRadiusMeters: 150,
    terrainSpacingMeters: 25,
    includeModels: false,
  })
const final = (cells: NonNullable<ReturnType<typeof beforeHarvestCells>>) => {
  const steps = finalStandSteps(
    { origin: eye, eye, elevation, forest: forest(cells), radiusMeters: 120, bearings: [0, 360] },
    Infinity,
  )
  for (;;) {
    const next = steps.next()
    if (next.done) return next.value
  }
}

describe('before-harvest source stand selection', () => {
  it('draws the same imported individuals with ordinary colours or treatment marking, before and after a final capture', () => {
    const before = beforeHarvestCells(imported, result, false)!,
      marked = beforeHarvestCells(imported, result, true)!
    expect(before.markOnly).toBe(true)
    expect(before.tints).toBeUndefined()
    expect(marked.tints!.size).toBeGreaterThan(0)
    const uncoloured = scene(before),
      coloured = scene(marked),
      captured = final(before)
    expect(uncoloured.trees).toEqual(coloured.trees)
    const identities = (ids: string[]) => ids.filter((id) => id.startsWith('imported:')).sort()
    expect(identities(uncoloured.trees.ids!)).toHaveLength(2)
    expect(identities(captured.ids!)).toEqual(identities(uncoloured.trees.ids!))
    for (const table of [uncoloured.trees, captured]) {
      const i = table.ids!.findIndex((id) => id.endsWith(':wide')),
        at = i * table.fields.length
      expect(Array.from(table.data).slice(at + 4, at + 6)).toEqual([6, 5])
      expect(table.data[at + 7]).toBe(0)
      expect(table.data[at + 8]).toBe(18)
      expect(table.data[at + 11]).toBe(2)
    }
    const after = final(prescribedCells(imported, result))
    const retained = identities(after.ids!)
    expect(retained).toHaveLength(1)
    expect(retained[0]).toBe(uncoloured.trees.ids!.find((id) => id.endsWith(':wide')))
  })

  it('keeps the existing generated-stand override limited to treatment marking', () => {
    const drawn = buildStand({ ...standInput, stands: [], clearings: [] }).stand!,
      treatment = applyPrescription(drawn, prescription)
    expect(drawn.source).toBe('drawn')
    expect(beforeHarvestCells(drawn, treatment, false)).toBeNull()
    const marked = beforeHarvestCells(drawn, treatment, true)!
    expect(marked.markOnly).toBe(true)
    expect(marked.tints!.size).toBeGreaterThan(0)
    expect(marked.replace).toBeUndefined()
  })
})
