import { describe, expect, it } from 'vitest'
import {
  ACCEPTS_STAND_COMPONENTS,
  ACCEPTS_STAND_FIELDS,
  LEGACY_TREE_FIELDS,
  SCENE_TREE_FIELDS,
  finalStandForEngine,
  sceneForEngine,
  treeComponents,
} from './sceneComponents'
import { buildScenePackage, parseScenePackage, type ScenePackageInput } from './scenePackage'
import { finalStandSteps, type FinalStandInput } from './finalStand'
import { metersPerDegree } from './visibility'
import { buildStandFromImport } from './stand/standTrees'
import { applyPrescription, DEFAULT_PRESCRIPTION } from './stand/prescription'
import { prescribedCells } from './stand/prescribedCells'
import { packScene, unpackScene } from './scenePosting'

const eye = { lng: -122.8, lat: 53.9 },
  metres = metersPerDegree(eye.lat)
const elevation = { elevationAt: () => 800 }
const square = (side: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ].map(([x, y]) => [eye.lng + (x * side) / 2 / metres.lng, eye.lat + (y * side) / 2 / metres.lat]),
  ],
})
const forest = (patch: Partial<ScenePackageInput['forest']> = {}): ScenePackageInput['forest'] => ({
  anchorLatitude: eye.lat,
  stands: [],
  clearings: [],
  inventory: [],
  standHeightMeters: 25,
  ...patch,
})
const input = (f: ScenePackageInput['forest']): ScenePackageInput => ({
  eye,
  elevation,
  eyeHeightMeters: 1.6,
  bearingDegrees: 0,
  pitchDegrees: 0,
  verticalFovDegrees: 40,
  forest: f,
  treeRadiusMeters: 120,
  terrainRadiusMeters: 150,
  terrainSpacingMeters: 25,
  includeModels: false,
})
const grow = (f: FinalStandInput['forest']) => {
  const steps = finalStandSteps(
    { origin: eye, eye, elevation, forest: f, radiusMeters: 120, bearings: [0, 360] },
    Infinity,
  )
  for (;;) {
    const next = steps.next()
    if (next.done) return next.value
  }
}
const capabilities = [ACCEPTS_STAND_COMPONENTS, ACCEPTS_STAND_FIELDS]

describe('stand components across ordinary and final scenes', () => {
  it('keeps measured short, wide crowns, zero crown base, DBH and source identities through final capture', () => {
    const geometry = square(80)
    const trees = [
      {
        id: 'wide',
        lng: eye.lng,
        lat: eye.lat,
        species: 'cottonwood' as const,
        heightMeters: 6,
        crownWidthMeters: 5,
        dbhCm: 18,
        crownBaseMeters: 0,
      },
      {
        id: 'tall',
        lng: eye.lng + 8 / metres.lng,
        lat: eye.lat,
        species: 'hemlock' as const,
        heightMeters: 25,
        crownWidthMeters: 4,
        dbhCm: 32,
        crownBaseMeters: 17,
      },
    ]
    const make = (source = trees, keep = 100) => {
      const stand = buildStandFromImport({ geometry, trees: source, inventory: [], anchorLatitude: eye.lat }).stand!
      const result = applyPrescription(stand, {
        ...DEFAULT_PRESCRIPTION,
        order: 'fromAbove',
        target: { kind: 'stemShare', value: keep },
      })
      return forest({ thinnings: [{ geometry, keepFraction: 1, prescribed: prescribedCells(stand, result) }] })
    }
    const scene = buildScenePackage(input(make())),
      final = grow(make()),
      reordered = buildScenePackage(input(make([...trees].reverse())))
    for (const table of [scene.trees, final, reordered.trees]) {
      const row = table.ids!.findIndex((id) => id.endsWith(':wide'))
      expect(row).toBeGreaterThanOrEqual(0)
      const values = Array.from(table.data).slice(row * table.fields.length, (row + 1) * table.fields.length)
      const record = Object.fromEntries(table.fields.map((name, i) => [name, values[i]]))
      expect(record).toMatchObject({ height: 6, crownWidth: 5, crownBase: 0, dbhCm: 18, expansion: 1, source: 2 })
      expect(table.species[record.species]).toBe('cottonwood')
    }
    const importedIds = (ids: string[]) => ids.filter((id) => id.startsWith('imported:')).sort()
    expect(importedIds(final.ids!)).toEqual(importedIds(scene.trees.ids!))
    expect(importedIds(reordered.trees.ids!)).toEqual(importedIds(scene.trees.ids!))
    const after = grow(make(trees, 50)),
      kept = importedIds(after.ids!)
    expect(kept).toHaveLength(1)
    expect(kept[0]).toBe(scene.trees.ids!.find((id) => id.endsWith(':wide')))
    const afterRow = after.ids!.indexOf(kept[0])
    expect(after.data[afterRow * after.fields.length + 5]).toBe(5)
  })

  it.each([
    { species: 'hemlock' as const, heightMeters: 6, crownClosurePercent: 45, form: 1 },
    { species: null, heightMeters: null, cover: 'shrubTall' as const, form: 2 },
  ])('keeps native $form forms and crown widths when the view becomes a final stand', (stand) => {
    const f = forest({ inventory: [{ ...stand, geometry: square(400) }] })
    const scene = buildScenePackage(input(f)),
      final = grow(f)
    const native = new Map(scene.trees.ids!.map((id, i) => [id, scene.trees.data.slice(i * 12, (i + 1) * 12)]))
    expect(final.count).toBeGreaterThan(500)
    expect(final.ids).toHaveLength(final.count)
    for (let i = 0; i < final.count; i++) {
      const before = native.get(final.ids![i])!
      expect(before).toBeDefined()
      expect(final.data[i * 12 + 5]).toBeCloseTo(before[5], 1)
      expect(final.data[i * 12 + 10]).toBe(stand.form)
      expect(final.data[i * 12 + 11]).toBe(1)
    }
  })

  it('carries expansion when the near grid represents a denser inventory', () => {
    const make = (stemsPerHa: number) =>
      grow(
        forest({
          inventory: [
            { geometry: square(400), species: 'spruce', heightMeters: 25, crownClosurePercent: 45, stemsPerHa },
          ],
        }),
      )
    const sparse = make(800),
      dense = make(1600)
    expect(dense.ids).toEqual(sparse.ids)
    expect(dense.count).toBe(sparse.count)
    for (let i = 0; i < dense.count; i++) expect(dense.data[i * 12 + 9]).toBeCloseTo(2 * sparse.data[i * 12 + 9], 5)
  })
})

describe('old-engine compatibility', () => {
  const f = forest({
    inventory: [{ geometry: square(400), species: 'hemlock', heightMeters: 6, crownClosurePercent: 45 }],
  })

  it('keeps modern objects intact, but downgrades only the negotiated legacy payload without mutating it', () => {
    const scene = buildScenePackage(input(f)),
      before = JSON.stringify(scene)
    expect(sceneForEngine(scene, capabilities)).toBe(scene)
    const old = sceneForEngine(scene, undefined)
    expect(old.trees.fields).toEqual(LEGACY_TREE_FIELDS)
    expect(old.trees.ids).toBeUndefined()
    expect(old.trees.species).toEqual(['pine', 'spruce', 'fir', 'douglasFir', 'aspen', 'birch'])
    expect(old.terrain.stand).toBeUndefined()
    expect(old.trees.data).toHaveLength(scene.trees.count * 7)
    expect(old.trees.species[old.trees.data[3]]).toBe('fir')
    expect(old.trees.data.slice(0, 3)).toEqual(scene.trees.data.slice(0, 3))
    expect(parseScenePackage(old).trees.count).toBe(scene.trees.count)
    expect(JSON.stringify(scene)).toBe(before)
    expect(parseScenePackage(scene).trees.fields).toEqual(SCENE_TREE_FIELDS)
  })

  it('accepts structural final requests and retains a transferable Float32 buffer for an old engine', () => {
    const final = grow(f)
    const request = {
      fields: final.fields,
      species: final.species,
      count: final.count,
      data: final.data,
      ids: final.ids,
      radiusMeters: 120,
      bearings: [0, 360],
    }
    const old = finalStandForEngine(request, [])
    expect(old.data).toBeInstanceOf(Float32Array)
    expect(old.data).toHaveLength(final.count * 7)
    expect(old.ids).toBeUndefined()
    expect(old.radiusMeters).toBe(request.radiusMeters)
    expect(old.data.slice(0, 3)).toEqual(final.data.slice(0, 3))
    expect(finalStandForEngine(request, capabilities)).toBe(request)
  })

  it('rejects a mismatched ID list or an invalid stand-palette index', () => {
    const scene = buildScenePackage(input(f))
    expect(() => parseScenePackage({ ...scene, trees: { ...scene.trees, ids: [] } })).toThrow(/tree list/)
    expect(() =>
      parseScenePackage({ ...scene, terrain: { ...scene.terrain, stand: { cells: [-2], records: [] } } }),
    ).toThrow(/stand grid/)
  })

  it('roundtrips palette cells, composition and string identities through packed transferable arrays', () => {
    const scene = buildScenePackage({ ...input(f), terrainRadiusMeters: 800, terrainSpacingMeters: 25 })
    const sent = packScene(scene)
    expect(sent.transfer.length).toBeGreaterThan(0)
    const restored = unpackScene(structuredClone(sent.scene))
    expect(restored).toEqual(scene)
    expect(parseScenePackage(restored).terrain.stand).toEqual(scene.terrain.stand)
  })

  it('has explicit unknown numeric sentinels while preserving a supplied zero crown base', () => {
    const base = {
      lng: 0,
      lat: 0,
      elevationMeters: 0,
      heightMeters: 6,
      slenderness: 0.5,
      tone: 0.5,
      species: 'pine' as const,
      variant: 0,
    }
    expect(treeComponents(base)).toEqual([-1, 0, 1, 0, 0])
    expect(treeComponents({ ...base, crownBase: 0, source: 'imported', expansion: 2, form: 'young' })).toEqual([
      0, 0, 2, 1, 2,
    ])
  })
})
