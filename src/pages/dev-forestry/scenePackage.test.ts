import { describe, expect, it } from 'vitest'
import { forestBands, forestPatches, growForestPatch } from './forestPatches'
import {
  SCENE_TREE_FIELDS,
  buildScenePackage,
  packageHeightAt,
  parseScenePackage,
  type ScenePackageInput,
} from './scenePackage'
import type { ElevationSource } from './terrain'
import { metersPerDegree } from './visibility'
import { DEFAULT_ENGINE_ENVIRONMENT, engineEnvironment } from './externalRenderers'

const EYE = { lng: -122.6, lat: 53.9 }
const m = metersPerDegree(EYE.lat)
/** Ground rising 5% to the north from 700 m. */
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
const input: ScenePackageInput = {
  eye: EYE,
  eyeHeightMeters: 1.5,
  bearingDegrees: 10,
  pitchDegrees: 2,
  verticalFovDegrees: 40,
  forest: { anchorLatitude: EYE.lat, stands: [], clearings: [block], openings: [block], standHeightMeters: 25 },
  elevation: slope,
  treeRadiusMeters: 400,
  terrainRadiusMeters: 600,
  terrainSpacingMeters: 20,
  createdAt: new Date('2026-11-12T12:00:00Z'),
}

describe('the road view as a scene package', () => {
  const scene = buildScenePackage(input)
  const stride = SCENE_TREE_FIELDS.length
  const trees = Array.from({ length: scene.trees.count }, (_, i) =>
    scene.trees.data.slice(i * stride, (i + 1) * stride),
  )

  it('keeps every stem outside the block identical before and after it is cut', () => {
    // The engines key a tree's shape to its own record; a harvest must remove stems, never move or resize the rest.
    const before = buildScenePackage({ ...input, forest: { ...input.forest, clearings: [], openings: [] } })
    const rows = (pkg: typeof scene) =>
      new Map(
        Array.from({ length: pkg.trees.count }, (_, i) => {
          const row = Array.from(pkg.trees.data.slice(i * stride, (i + 1) * stride))
          return [`${row[0]},${row[1]}`, row.join(',')] as const
        }),
      )
    const was = rows(before)
    const now = rows(scene)
    expect(was.size).toBeGreaterThan(now.size)
    for (const [key, row] of now) expect(was.get(key)).toBe(row)
  })

  it('writes the road view’s own stems, each once', () => {
    // Every stem in the package is one the road view grows, at the same place and height.
    const bands = forestBands(400)
    const grown = forestPatches(EYE, bands, EYE.lat).flatMap((patch) =>
      growForestPatch(
        patch,
        bands[patch.band],
        { stands: [], clearings: [block], openings: [block], heightMeters: 25 },
        slope,
        EYE.lat,
      ),
    )
    // A 1 m spatial hash, matched within 2 cm (the package rounds to the centimetre).
    const cell = (x: number, y: number) => `${Math.floor(x)},${Math.floor(y)}`
    const known = new Map<string, Array<{ x: number; y: number; height: number }>>()
    for (const tree of grown) {
      const x = (tree.lng - EYE.lng) * m.lng
      const y = (tree.lat - EYE.lat) * m.lat
      const list = known.get(cell(x, y)) ?? []
      list.push({ x, y, height: tree.heightMeters })
      known.set(cell(x, y), list)
    }
    const find = (x: number, y: number) => {
      for (const dx of [-1, 0, 1])
        for (const dy of [-1, 0, 1])
          for (const tree of known.get(cell(x + dx, y + dy)) ?? [])
            if (Math.hypot(tree.x - x, tree.y - y) < 0.02) return tree
      return null
    }
    expect(scene.trees.count).toBeGreaterThan(1000)
    for (const [x, y, , , height] of trees) {
      const tree = find(x, y)
      expect(tree).not.toBeNull()
      expect(tree!.height).toBeCloseTo(height, 1)
    }
    const key = (x: number, y: number) => `${x},${y}`
    // No stem twice where the bands overlap.
    expect(new Set(trees.map(([x, y]) => key(x, y))).size).toBe(trees.length)
    expect(Math.max(...trees.map(([x, y]) => Math.hypot(x, y)))).toBeLessThan(400)
  })

  it('keeps the block open and puts slash on it', () => {
    const inBlock = (x: number, y: number) => x > 40 && x < 240 && y > 60 && y < 260
    expect(trees.some(([x, y]) => inBlock(x, y))).toBe(false)
    expect(scene.debris.count).toBeGreaterThan(100)
    const debris = Array.from({ length: scene.debris.count }, (_, i) => scene.debris.data.slice(i * 4, i * 4 + 4))
    expect(debris.every(([x, y]) => inBlock(x, y))).toBe(true)
    expect(scene.openings[0].rings[0][0]).toEqual([40, 60])
  })

  it('carries the water reaching the terrain, at the lowest ground round its shore', () => {
    const lake = (west: number, south: number): GeoJSON.Polygon => ({
      type: 'Polygon',
      coordinates: [
        [
          [EYE.lng + west / m.lng, EYE.lat + south / m.lat],
          [EYE.lng + (west + 100) / m.lng, EYE.lat + south / m.lat],
          [EYE.lng + (west + 100) / m.lng, EYE.lat + (south + 80) / m.lat],
          [EYE.lng + west / m.lng, EYE.lat + south / m.lat],
        ],
      ],
    })
    // The terrain reaches 600 m each way; a river 2 km long is cut to it.
    const river: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [EYE.lng - 1000 / m.lng, EYE.lat + 400 / m.lat],
          [EYE.lng + 1000 / m.lng, EYE.lat + 400 / m.lat],
          [EYE.lng + 1000 / m.lng, EYE.lat + 450 / m.lat],
          [EYE.lng - 1000 / m.lng, EYE.lat + 450 / m.lat],
          [EYE.lng - 1000 / m.lng, EYE.lat + 400 / m.lat],
        ],
      ],
    }
    const wet = buildScenePackage({
      ...input,
      includeModels: false,
      water: [lake(-300, -200), lake(5000, 5000), river],
    })
    expect(wet.water).toHaveLength(2)
    const corners = wet.water![0].rings[0]
    expect(corners).toContainEqual([-300, -200])
    const reach = wet.water![1].rings[0].map(([x]) => Math.abs(x))
    expect(Math.max(...reach)).toBeCloseTo(600, 0)
    // The slope rises north, so the shore's lowest point is its south edge.
    expect(wet.water![0].elevationMeters).toBeCloseTo(700 - 200 * 0.05, 1)
    expect(scene.water).toEqual([])
  })

  it('carries the drawn ground and stands each stem on it', () => {
    expect(scene.terrain.columns).toBe(61)
    expect(packageHeightAt(scene, 0, 0)).toBeCloseTo(700, 1)
    expect(packageHeightAt(scene, 33, 210)).toBeCloseTo(700 + 210 * 0.05, 1)
    for (const [x, y, z] of trees.slice(0, 50)) expect(z).toBeCloseTo(packageHeightAt(scene, x, y), 0)
  })

  it('puts the eye at its height over the ground, facing the way it faced', () => {
    expect(scene.camera).toEqual({
      position: [0, 0, 701.5],
      bearingDegrees: 10,
      pitchDegrees: 2,
      verticalFovDegrees: 40,
      rollDegrees: 0,
    })
  })

  it('reopens the exact physical eye, perspective framing and resolved site environment', () => {
    const environment = engineEnvironment(DEFAULT_ENGINE_ENVIRONMENT, EYE, input.createdAt!)
    const saved = buildScenePackage({
      ...input,
      includeModels: false,
      eyeElevationMeters: 701.513728,
      bearingDegrees: 10.1298736,
      pitchDegrees: -0.7234567,
      verticalFovDegrees: 36.86989764584402,
      viewport: { width: 1600, height: 900, pixelRatio: 2 },
      environment,
    })
    const reopened = parseScenePackage(JSON.parse(JSON.stringify(saved)))
    expect(reopened.camera).toEqual(saved.camera)
    expect(reopened.camera.position[2]).toBe(701.513728)
    expect(reopened.camera.bearingDegrees).toBeCloseTo(10.1298736, 10)
    expect(reopened.camera.pitchDegrees).toBe(-0.7234567)
    expect(reopened.camera.projection).toMatchObject({ kind: 'perspective', aspectRatio: 16 / 9 })
    expect(reopened.camera.projection!.horizontalFovDegrees).toBeCloseTo(61.301335914105735, 10)
    expect(reopened.environment).toEqual(environment)
    expect(reopened.environment?.utc).toBe('2026-11-12T22:00:00.000Z')
    environment.weather = 'snow'
    expect(saved.environment?.weather).toBe('clear')
    expect(() =>
      parseScenePackage({
        ...saved,
        camera: { ...saved.camera, projection: { ...saved.camera.projection, aspectRatio: 1 } },
      }),
    ).toThrow(/projection/)
  })

  it('carries each species’ own model at unit height and unit crown width', () => {
    for (const id of scene.trees.species) {
      const model = scene.models![id]
      expect(model.positions.length % 9).toBe(0)
      expect(model.normals.length).toBe(model.positions.length)
      expect(model.bark.length * 3).toBe(model.positions.length)
      let top = 0
      let widest = 0
      for (let i = 0; i < model.positions.length; i += 3) {
        top = Math.max(top, model.positions[i + 2])
        widest = Math.max(widest, Math.hypot(model.positions[i], model.positions[i + 1]))
      }
      expect(top).toBeCloseTo(1, 3)
      expect(widest).toBeCloseTo(0.5, 2)
    }
    expect(buildScenePackage({ ...input, includeModels: false }).models).toBeUndefined()
  })

  it('reads back, and refuses what is not a package', () => {
    expect(parseScenePackage(JSON.parse(JSON.stringify(scene))).trees.count).toBe(scene.trees.count)
    expect(() => parseScenePackage({ format: 'other' })).toThrow(/Not a PGMaps/)
    expect(() => parseScenePackage({ ...scene, trees: { ...scene.trees, count: 1 } })).toThrow(/tree list/)
  })
})

describe('the canopy and openings the package carries', () => {
  const square = (west: number, south: number, size: number, hole?: [number, number, number]): GeoJSON.Polygon => {
    const ring = (w: number, s: number, d: number) => [
      [EYE.lng + w / m.lng, EYE.lat + s / m.lat],
      [EYE.lng + (w + d) / m.lng, EYE.lat + s / m.lat],
      [EYE.lng + (w + d) / m.lng, EYE.lat + (s + d) / m.lat],
      [EYE.lng + w / m.lng, EYE.lat + (s + d) / m.lat],
      [EYE.lng + w / m.lng, EYE.lat + s / m.lat],
    ]
    return {
      type: 'Polygon',
      coordinates: hole ? [ring(west, south, size), ring(...hole).reverse()] : [ring(west, south, size)],
    }
  }
  // A cut block with a 60 m reserve left standing in it, as the page passes it: the reserve cut out of the opening.
  const cut = square(40, 60, 200, [110, 130, 60])
  const recorded = square(-300, -300, 200)
  const meadow = square(-300, 100, 150)
  const lake = square(300, -300, 150)
  const young = square(300, 200, 150)
  const thinnedBlock = square(-500, -100, 100)
  const forest: ScenePackageInput['forest'] = {
    anchorLatitude: EYE.lat,
    stands: [],
    clearings: [cut, lake],
    openings: [cut],
    thinnings: [{ geometry: thinnedBlock, keepFraction: 0.5 }],
    standHeightMeters: 25,
    inventory: [
      { geometry: recorded, species: 'spruce', heightMeters: 28, crownClosurePercent: 60 },
      { geometry: meadow, species: null, heightMeters: null, cover: 'herb' },
      { geometry: young, species: 'pine', heightMeters: 6 },
    ],
  }
  // No ground past 500 m east: the canopy there is unknown, not open.
  const edged: ElevationSource = {
    elevationAt: (lng, lat) => ((lng - EYE.lng) * m.lng > 500 ? NaN : slope.elevationAt(lng, lat)),
  }
  const scene = buildScenePackage({
    ...input,
    includeModels: false,
    forest,
    elevation: edged,
    water: [lake],
    farTerrainRadiusMeters: 1500,
    farTerrainSpacingMeters: 50,
  })
  const canopyAt = (grid: NonNullable<typeof scene.farTerrain>, x: number, y: number) => {
    const column = Math.round((x - grid.west) / grid.spacing)
    const row = Math.round((y - grid.south) / grid.spacing)
    return grid.canopy![row * grid.columns + column]
  }

  it('closes the canopy where the stand is, as recorded or regional, and opens it on cut, wet and open ground', () => {
    const t = scene.terrain
    expect(t.canopy).toHaveLength(t.heights.length)
    expect(canopyAt(t, -200, -200)).toBe(0.6) // VRI crown closure
    expect(canopyAt(t, -100, 400)).toBe(0.45) // the regional stand
    expect(canopyAt(t, 100, 100)).toBe(0) // the cut block
    expect(canopyAt(t, 360, -240)).toBe(0) // the lake
    expect(canopyAt(t, -220, 160)).toBe(0) // VRI herb ground
    // Regeneration the inventory gives no closure for closes with height: 6 m of 12.
    expect(Math.abs(canopyAt(t, 360, 260)! - 0.45 * 0.5)).toBeLessThan(0.006)
    // Half the stems kept at full crown width: 1 − 0.55^0.5.
    expect(canopyAt(t, -460, -60)).toBe(0.26)
    expect(canopyAt(t, 560, 0)).toBeNull()
  })

  it('keeps the reserve standing: its stems, its closure, and a hole in the opening', () => {
    expect(canopyAt(scene.terrain, 140, 160)).toBe(0.45)
    const stride = SCENE_TREE_FIELDS.length
    const inReserve = Array.from({ length: scene.trees.count }, (_, i) =>
      scene.trees.data.slice(i * stride, i * stride + 2),
    ).filter(([x, y]) => x > 112 && x < 168 && y > 132 && y < 188)
    expect(inReserve.length).toBeGreaterThan(50)
    expect(scene.openings[0].rings).toHaveLength(2)
  })

  it('carries the same closure on the far grid', () => {
    const far = scene.farTerrain!
    expect(far.canopy).toHaveLength(far.heights.length)
    expect(canopyAt(far, -200, -200)).toBe(0.6)
    expect(canopyAt(far, 100, 100)).toBe(0)
    expect(canopyAt(far, -1000, 1000)).toBe(0.45)
    expect(canopyAt(far, 1000, 0)).toBeNull()
  })

  it('ages each opening from its harvest year and says how much of the stand it keeps', () => {
    const block = (geometry: GeoJSON.Polygon, extra: object = {}) => ({
      role: 'block' as const,
      geometry,
      harvestYear: null,
      clearcutPercent: null,
      ...extra,
    })
    const road = square(-100, -500, 80)
    const old = square(600, 600, 100)
    const greenedUp = square(800, 600, 100)
    const reten = square(1000, 600, 100)
    const regrowth = (geometry: GeoJSON.Polygon, year: number, fraction: number) => ({
      geometry,
      species: null,
      heightMeters: 1,
      regenerationFraction: fraction,
      basis: 'harvest estimate' as const,
      referenceYear: year,
      recordId: `r-${year}-${fraction}`,
    })
    const aged = buildScenePackage({
      ...input,
      includeModels: false,
      terrainRadiusMeters: 200,
      forest: {
        ...forest,
        clearings: [cut, road],
        openings: [cut, road],
        inventory: [regrowth(old, 2015, 0.87), regrowth(greenedUp, 1990, 1), regrowth(reten, 2020, 0)],
      },
      targets: [
        block(cut, { harvestYear: 2022 }),
        block(thinnedBlock, { harvestSystem: 'retention', retentionPercent: 50 }),
        { role: 'harvested', geometry: road, harvestYear: null, clearcutPercent: 100, siteDisturbance: true },
      ],
      assessmentYear: 2023,
    })
    expect(aged.openings.map(({ ageYears, retainedShare }) => [ageYears, retainedShare])).toEqual([
      [1, 0], // harvested in 2022, a clearcut with its reserve cut out
      [null, 0], // a road right-of-way with no year
      [0, 0.5], // a retention block just cut, half its stems kept
      [8, 0.13], // an existing opening, 87 % clearcut
    ])
    // Without the targets, a proposed block is still cut ground, but its age is unknown.
    expect(scene.openings.map((o) => [o.ageYears, o.retainedShare])).toEqual([
      [null, null],
      [null, 0.5],
    ])
    expect(buildScenePackage({ ...input, includeModels: false }).openings[0]).toMatchObject({ ageYears: null })
    const proposed = buildScenePackage({
      ...input,
      includeModels: false,
      targets: [block(input.forest.openings![0] as GeoJSON.Polygon)],
    })
    expect(proposed.openings[0]).toMatchObject({ ageYears: 0, retainedShare: 0 })
  })

  it('reads a 500 × 500 far grid against thousands of stands quickly', () => {
    const stands = Array.from({ length: 3000 }, (_, i) => ({
      geometry: square(-7000 + (i % 60) * 230, -7000 + Math.floor(i / 60) * 280, 200),
      species: 'spruce' as const,
      heightMeters: 20,
      crownClosurePercent: 30 + (i % 40),
    }))
    const started = performance.now()
    const wide = buildScenePackage({
      ...input,
      includeModels: false,
      treeRadiusMeters: 50,
      terrainRadiusMeters: 300,
      forest: { ...forest, inventory: stands },
      farTerrainRadiusMeters: 7500,
      farTerrainSpacingMeters: 30,
    })
    expect(wide.farTerrain!.columns).toBe(501)
    expect(performance.now() - started).toBeLessThan(5000)
    expect(canopyAt(wide.farTerrain!, -7000 + 100, -7000 + 100)).toBe(0.3)
  })
})
