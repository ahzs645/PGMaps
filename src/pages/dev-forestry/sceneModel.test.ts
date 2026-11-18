import { describe, expect, it } from 'vitest'
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import type { MeshPart } from '@/lib/model3d/model'
import { buildScenePackage, SCENE_TREATED_FIELDS, SCENE_TREATED_KINDS, type ScenePackage } from './scenePackage'
import { SCENE_TREE_FIELDS } from './sceneComponents'
import { sceneModel, sceneModelExport, SCENE_MODEL_CROWN_SIDES, SCENE_MODEL_TRIANGLE_BUDGET } from './sceneModel'
import { metersPerDegree } from './visibility'
import { TREE_DRAWINGS } from './impostor'

const EYE = { lng: -122.6, lat: 53.9 }
const m = metersPerDegree(EYE.lat)

/** A hand-made package: a 5 × 5 grid at 10 m, one opening over the north-east cells, and the stems given. */
function pkg(trees: number[][], extra: Partial<ScenePackage> = {}): ScenePackage {
  const heights: Array<number | null> = []
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) heights.push(700 + r)
  return {
    format: 'pgmaps-forest-scene',
    version: 1,
    createdAt: '2026-11-18T00:00:00.000Z',
    origin: { lng: EYE.lng, lat: EYE.lat, elevationMeters: 702 },
    frame: 'local metres: x east, y north, z up; heights absolute',
    terrain: { west: -20, south: -20, spacing: 10, columns: 5, rows: 5, heights },
    trees: {
      fields: SCENE_TREE_FIELDS,
      species: ['pine', 'spruce', 'fir', 'douglasFir', 'aspen', 'birch', 'hemlock', 'blackSpruce', 'cottonwood'],
      count: trees.length,
      data: trees.flat(),
    },
    species: {},
    openings: [
      {
        kind: 'harvested',
        rings: [
          [
            [0, 0],
            [20, 0],
            [20, 20],
            [0, 20],
          ],
        ],
      },
    ],
    debris: { fields: ['x', 'y', 'z', 'footprint'], count: 0, data: [] },
    roadScars: [],
    camera: { position: [0, 0, 703.5], bearingDegrees: 10, pitchDegrees: 0, verticalFovDegrees: 40 },
    treeRadiusMeters: 600,
    notes: [],
    ...extra,
  }
}
/** A stem row: x, y, z, species, height, crown width, tone, crown base, DBH, expansion, form, source. */
const stem = (
  x: number,
  y: number,
  species: number,
  height: number,
  width: number,
  crownBase = -1,
  dbh = 0,
  form = 0,
) => [x, y, 700, species, height, width, 0.5, crownBase, dbh, 1, form, 0]

const triangles = (parts: MeshPart[]) => parts.reduce((sum, p) => sum + p.indices.length / 3, 0)
const byName = (parts: MeshPart[], name: string) => parts.find((p) => p.name === name)!
const zRange = (part: MeshPart) => {
  let lo = Infinity,
    hi = -Infinity
  for (let i = 2; i < part.positions.length; i += 3) {
    lo = Math.min(lo, part.positions[i])
    hi = Math.max(hi, part.positions[i])
  }
  return [lo, hi]
}

describe('scene model', () => {
  it('draws the ground grid facing up, the opening as cut ground, z from the origin', () => {
    const model = sceneModel(pkg([]))
    const ground = byName(model.parts, 'Ground'),
      cut = byName(model.parts, 'Cut ground (openings)')
    // 4 × 4 cells, two triangles each; the 2 × 2 north-east cells are cut.
    expect(triangles([ground])).toBe(24)
    expect(triangles([cut])).toBe(8)
    for (const part of [ground, cut]) {
      const p = part.positions
      for (let t = 0; t < part.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => part.indices[t + k])
        const cross =
          (p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) - (p[c * 3] - p[a * 3]) * (p[b * 3 + 1] - p[a * 3 + 1])
        expect(cross).toBeGreaterThan(0)
      }
      // Smooth normals lean away from the rise to the north.
      for (let i = 0; i < part.normals!.length; i += 3) {
        expect(part.normals![i + 2]).toBeGreaterThan(0.99)
        expect(part.normals![i + 1]).toBeLessThan(0)
      }
    }
    expect(zRange(ground)).toEqual([-2, 2])
    expect(model.origin).toEqual({ kind: 'lonlat', longitude: EYE.lng, latitude: EYE.lat, elevation: 702 })
    expect(model.extras?.camera).toMatchObject({ position: [0, 0, 1.5] })
    expect(model.notes[0]).toMatch(/^Display only/)
  })

  it('leaves a cell with an unknown post open and says so', () => {
    const scene = pkg([])
    scene.terrain.heights[0] = null
    const model = sceneModel(scene)
    expect(triangles(model.parts)).toBe(30)
    expect(model.notes.join(' ')).toMatch(/1 cells with an unknown post are left open/)
  })

  it('builds each stem from its own height, crown width and crown base, coloured by drawing', () => {
    const model = sceneModel(
      pkg([
        stem(-10, -10, 0, 20, 4, 0.5, 30), // pine, crown from 10 m, 30 cm DBH
        stem(5, -10, 4, 15, 6), // aspen: round crown, species' crown base
        stem(-10, 5, 1, 4, 1.2, -1, 0, 1), // young spruce: one cone
      ]),
    )
    const pine = byName(model.parts, 'Trees: Lodgepole pine')
    const pineStem = byName(model.parts, 'Trees: Lodgepole pine, stems')
    expect(zRange(pine)).toEqual([8, 18])
    // The crown is as wide as the stem's: 2 m from its axis.
    let reach = 0
    for (let i = 0; i < pine.positions.length; i += 3)
      reach = Math.max(reach, Math.hypot(pine.positions[i] + 10, pine.positions[i + 1] + 10))
    expect(reach).toBeCloseTo(2, 5)
    let trunk = 0
    for (let i = 0; i < pineStem.positions.length; i += 3)
      trunk = Math.max(trunk, Math.hypot(pineStem.positions[i] + 10, pineStem.positions[i + 1] + 10))
    expect(trunk).toBeCloseTo(0.15, 5)
    expect(pine.attributes).toMatchObject({ layer: 'trees', drawing: 'pine', stems: 1 })
    expect(pine.color.map((c) => Math.round(c * 255))).toEqual([62, 96, 60])
    // Eight sides: the two-tier conifer is 6 × 8 triangles, its trunk 4 × 4; one young cone 2 × 8.
    expect(triangles([pine])).toBe(48)
    expect(triangles([pineStem])).toBe(16)
    expect(triangles([byName(model.parts, `Trees: ${TREE_DRAWINGS.spruceYoung.label}`)])).toBe(16)
    expect(byName(model.parts, `Trees: ${TREE_DRAWINGS.aspen.label}`).attributes?.layer).toBe('trees')
  })

  it('winds tree solids outward', () => {
    const model = sceneModel(pkg([stem(0, 0, 1, 20, 4)]))
    for (const part of model.parts.filter((p) => p.attributes?.layer === 'trees' || p.attributes?.layer === 'trunks')) {
      const p = part.positions
      for (let t = 0; t < part.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => part.indices[t + k])
        const u = [0, 1, 2].map((k) => p[b * 3 + k] - p[a * 3 + k]),
          v = [0, 1, 2].map((k) => p[c * 3 + k] - p[a * 3 + k])
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        // The face's normal agrees with its corners' vertex normals.
        const vn = [0, 1, 2].map((k) => part.normals![a * 3 + k] + part.normals![b * 3 + k] + part.normals![c * 3 + k])
        expect(n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2]).toBeGreaterThan(0)
      }
    }
  })

  it('draws treated stems standing or lying along their heading', () => {
    const scene = pkg([], {
      treated: {
        fields: SCENE_TREATED_FIELDS,
        kinds: SCENE_TREATED_KINDS,
        count: 3,
        // A stump, a log lying east (heading 90°) 6 m long, 0.4 m across, and a 9 m snag.
        data: [0, 0, 702, 0, 0.3, 0.4, 0, 5, 5, 702, 2, 6, 0.4, 90, -5, -5, 702, 3, 9, 0.3, 0],
      },
    })
    const model = sceneModel(scene)
    const log = byName(model.parts, 'Treated: logs')
    const xs: number[] = [],
      zs: number[] = []
    for (let i = 0; i < log.positions.length; i += 3) {
      xs.push(log.positions[i])
      zs.push(log.positions[i + 2])
    }
    expect(Math.min(...xs)).toBeCloseTo(5, 5)
    expect(Math.max(...xs)).toBeCloseTo(11, 5)
    expect(Math.min(...zs)).toBeCloseTo(0, 5)
    expect(Math.max(...zs)).toBeCloseTo(0.4, 5)
    expect(zRange(byName(model.parts, 'Treated: snags'))[1]).toBeCloseTo(9, 5)
    expect(model.notes.join(' ')).toMatch(/1 stumps, 1 logs, 1 snags/)
  })

  it('keeps within the triangle budget: fewer sides first, then the farthest stems', () => {
    const trees = Array.from({ length: 50 }, (_, i) => stem(i * 2 - 50, 0, 2, 20, 3))
    const ground = triangles(sceneModel(pkg([])).parts)
    const full = sceneModel(pkg(trees))
    // Fir at 8 sides: 48 + 16 triangles a stem.
    expect(triangles(full.parts)).toBe(ground + 50 * 64)

    const sixSides = sceneModel(pkg(trees), { triangleBudget: ground + 50 * 48 })
    expect(triangles(sixSides.parts)).toBe(ground + 50 * (36 + 12))
    expect(sixSides.notes.join(' ')).toMatch(/drawn with 6 sides \(fewer than 8/)

    const thinned = sceneModel(pkg(trees), { triangleBudget: ground + 20 * 36 })
    expect(triangles(thinned.parts)).toBeLessThanOrEqual(ground + 20 * 36)
    expect(byName(thinned.parts, `Trees: ${TREE_DRAWINGS.fir.label}`).attributes?.stems).toBe(20)
    expect(thinned.notes.join(' ')).toMatch(/30 stems past \d+ m from the eye left out/)
    // The nearest twenty are kept: none farther than the farthest kept.
    const fir = byName(thinned.parts, `Trees: ${TREE_DRAWINGS.fir.label}`)
    let far = 0
    for (let i = 0; i < fir.positions.length; i += 3) far = Math.max(far, Math.abs(fir.positions[i]))
    expect(far).toBeLessThan(25)
    expect(SCENE_MODEL_CROWN_SIDES[SCENE_MODEL_CROWN_SIDES.length - 1]).toBe(4)
  })

  it('draws the ground at every second post when the grid alone would take more than half the budget', () => {
    const model = sceneModel(pkg([]), { triangleBudget: 40 })
    expect(triangles(model.parts)).toBe(8)
    expect(model.notes.join(' ')).toMatch(/every second post \(20 m\)/)
  })

  it('models a real package: one solid per stem, every part valid, within the default budget', () => {
    const slope: ElevationSource = { elevationAt: (_lng, lat) => 700 + (lat - EYE.lat) * m.lat * 0.05 }
    const block: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [EYE.lng + 40 / m.lng, EYE.lat + 60 / m.lat],
          [EYE.lng + 240 / m.lng, EYE.lat + 60 / m.lat],
          [EYE.lng + 240 / m.lng, EYE.lat + 260 / m.lat],
          [EYE.lng + 40 / m.lng, EYE.lat + 260 / m.lat],
          [EYE.lng + 40 / m.lng, EYE.lat + 60 / m.lat],
        ],
      ],
    }
    const scene = buildScenePackage({
      eye: EYE,
      eyeHeightMeters: 1.5,
      bearingDegrees: 10,
      pitchDegrees: 2,
      verticalFovDegrees: 40,
      forest: { anchorLatitude: EYE.lat, stands: [], clearings: [block], openings: [block], standHeightMeters: 25 },
      elevation: slope,
      treeRadiusMeters: 200,
      terrainRadiusMeters: 300,
      terrainSpacingMeters: 20,
      includeModels: false,
      createdAt: new Date('2026-11-12T12:00:00Z'),
    })
    expect(scene.trees.count).toBeGreaterThan(0)
    const model = sceneModel(scene)
    const drawn = model.parts
      .filter((p) => p.attributes?.layer === 'trees')
      .reduce((sum, p) => sum + Number(p.attributes?.stems), 0)
    expect(drawn).toBe(scene.trees.count)
    expect(triangles(model.parts)).toBeLessThanOrEqual(SCENE_MODEL_TRIANGLE_BUDGET)
    expect(model.parts.some((p) => p.name === 'Cut ground (openings)')).toBe(true)
    for (const format of ['glb', 'obj', 'stl'] as const) {
      const out = sceneModelExport(scene, format)
      expect(out.files[0].name).toBe(`forestry-visual-quality-scene.${format}`)
      expect(out.notes[0]).toMatch(/^Display only/)
    }
    const stl = sceneModelExport(scene, 'stl').files[0].bytes
    expect(stl.byteLength).toBe(84 + 50 * triangles(model.parts))
  })
})
