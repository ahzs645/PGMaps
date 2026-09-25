import { describe, expect, it } from 'vitest'

import {
  SPECIES_CROWN_RATIO,
  TREE_SPECIES_IDS,
  VARIANTS_PER_SPECIES,
  blockThinning,
  REGIONAL_STAND,
  bufferLine,
  coniferMesh,
  crownWidthForClosure,
  crownColor,
  placeTrees,
  speciesFromCode,
  speciesFromMix,
  viewingGapToward,
} from './forest'
import { pointInPolygon, polygonAreaMeters } from './visibility'

function box(minLng: number, minLat: number, maxLng: number, maxLat: number): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  }
}

const CENTRE = { lng: -122.75, lat: 53.9 }

describe('coniferMesh', () => {
  it('builds a closed, indexed mesh', () => {
    const mesh = coniferMesh()
    const vertexCount = mesh.attributes.positions.value.length / 3

    expect(vertexCount).toBeGreaterThan(20)
    expect(mesh.attributes.normals.value).toHaveLength(vertexCount * 3)
    expect(mesh.indices.value.length % 3).toBe(0)
    // Uint16 indices only hold 65535 vertices, and the mesh is drawn instanced.
    expect(vertexCount).toBeLessThan(65_535)
    expect(Math.max(...mesh.indices.value)).toBeLessThan(vertexCount)
  })

  it('stands on the ground and reaches exactly one unit', () => {
    const positions = coniferMesh().attributes.positions.value
    const zs = [...positions].filter((_, index) => index % 3 === 2)

    expect(Math.min(...zs)).toBeCloseTo(0, 6)
    expect(Math.max(...zs)).toBeCloseTo(1, 6)
  })

  it('gives every vertex a unit normal', () => {
    const { normals } = coniferMesh().attributes
    for (let index = 0; index < normals.value.length; index += 3) {
      const length = Math.hypot(normals.value[index], normals.value[index + 1], normals.value[index + 2])
      expect(length).toBeCloseTo(1, 5)
    }
  })

  it('tapers — a crown ring is never wider than the one below it', () => {
    const positions = coniferMesh({ whorls: 4 }).attributes.positions.value
    let previousZ = -1
    let previousRadius = Infinity
    for (let index = 0; index < positions.length; index += 3) {
      const z = positions[index + 2]
      const radius = Math.hypot(positions[index], positions[index + 1])
      // Only compare across whorls, where the base ring of each cone is emitted.
      if (z > previousZ + 0.05 && radius > 0.05) {
        expect(radius).toBeLessThanOrEqual(previousRadius + 1e-6)
        previousRadius = radius
        previousZ = z
      }
    }
  })
})

describe('placeTrees', () => {
  it('fills a patch at roughly the spacing asked for', () => {
    const trees = placeTrees({ stands: [], clearings: [], centre: CENTRE, radiusMeters: 200, spacingMeters: 4 })

    // A 200 m circle at 4 m spacing is about pi*200^2/16 ≈ 7850 cells, less the
    // gaps the placement leaves.
    expect(trees.length).toBeGreaterThan(5_000)
    expect(trees.length).toBeLessThan(9_000)
  })

  it('leaves the cut bare', () => {
    const clearing = box(CENTRE.lng - 0.001, CENTRE.lat - 0.001, CENTRE.lng + 0.001, CENTRE.lat + 0.001)
    const trees = placeTrees({
      stands: [],
      clearings: [clearing],
      centre: CENTRE,
      radiusMeters: 300,
      spacingMeters: 5,
    })

    expect(trees.length).toBeGreaterThan(100)
    expect(trees.some((tree) => pointInPolygon(clearing, tree.lng, tree.lat))).toBe(false)
  })

  it('keeps to the stand when one is given', () => {
    const stand = box(CENTRE.lng, CENTRE.lat, CENTRE.lng + 0.002, CENTRE.lat + 0.002)
    const trees = placeTrees({
      stands: [stand],
      clearings: [],
      centre: CENTRE,
      radiusMeters: 400,
      spacingMeters: 5,
    })

    expect(trees.length).toBeGreaterThan(50)
    expect(trees.every((tree) => pointInPolygon(stand, tree.lng, tree.lat))).toBe(true)
  })

  it('grows the same stems again for ground it has already covered', () => {
    const shared = { stands: [], clearings: [], radiusMeters: 250, spacingMeters: 4 }
    const first = placeTrees({ ...shared, centre: CENTRE })
    // The camera moves 50 m north; the ground both patches cover must match.
    const second = placeTrees({ ...shared, centre: { ...CENTRE, lat: CENTRE.lat + 0.00045 } })

    const key = (tree: { lng: number; lat: number }) => `${tree.lng.toFixed(9)},${tree.lat.toFixed(9)}`
    const secondKeys = new Set(second.map(key))
    // Both patches are circles, so only ground well inside each is in both.
    const overlap = first.filter(
      (tree) => tree.lat > CENTRE.lat && tree.lat < CENTRE.lat + 0.0009 && Math.abs(tree.lng - CENTRE.lng) < 0.0015,
    )

    expect(overlap.length).toBeGreaterThan(500)
    expect(overlap.every((tree) => secondKeys.has(key(tree)))).toBe(true)
  })

  it('thins out rather than overrunning the ceiling', () => {
    const trees = placeTrees({
      stands: [],
      clearings: [],
      centre: CENTRE,
      radiusMeters: 4000,
      spacingMeters: 3,
      maxTrees: 5_000,
    })

    expect(trees.length).toBeLessThanOrEqual(5_000)
    // Still covers the whole patch rather than stopping partway across it.
    expect(Math.max(...trees.map((tree) => tree.lat))).toBeGreaterThan(CENTRE.lat + 0.02)
  })

  it('leaves the middle clear for a finer patch to fill', () => {
    const shell = placeTrees({
      stands: [],
      clearings: [],
      centre: CENTRE,
      radiusMeters: 600,
      innerRadiusMeters: 300,
      spacingMeters: 20,
    })

    expect(shell.length).toBeGreaterThan(50)
    const metres = (tree: { lng: number; lat: number }) =>
      Math.hypot(
        (tree.lat - CENTRE.lat) * 111_320,
        (tree.lng - CENTRE.lng) * 111_320 * Math.cos((CENTRE.lat * Math.PI) / 180),
      )
    expect(Math.min(...shell.map(metres))).toBeGreaterThan(280)
    expect(Math.max(...shell.map(metres))).toBeLessThan(620)
  })

  it('varies height and colour within the stand', () => {
    const trees = placeTrees({
      stands: [],
      clearings: [],
      centre: CENTRE,
      radiusMeters: 150,
      spacingMeters: 5,
      heightMeters: 30,
    })
    const heights = trees.map((tree) => tree.heightMeters)

    expect(Math.min(...heights)).toBeGreaterThan(30 * 0.5)
    expect(Math.max(...heights)).toBeLessThan(30 * 1.31)
    expect(new Set(trees.map((tree) => tree.tone)).size).toBeGreaterThan(50)
  })

  it('returns nothing for a patch with no extent', () => {
    expect(placeTrees({ stands: [], clearings: [], centre: CENTRE, radiusMeters: 0 })).toEqual([])
    expect(placeTrees({ stands: [], clearings: [], centre: CENTRE, radiusMeters: 100, spacingMeters: 0 })).toEqual([])
  })
})

describe('bufferLine', () => {
  // A 1 km east–west run at the sample latitude.
  const road: Array<[number, number]> = [
    [CENTRE.lng, CENTRE.lat],
    [CENTRE.lng + 0.0152, CENTRE.lat],
  ]

  it('covers the road and roughly the right area', () => {
    const polygon = bufferLine(road, 20)!
    const area = polygonAreaMeters(polygon)

    // 1 km by 40 m is 40,000 m²; allow for the ends being square, not round.
    expect(area).toBeGreaterThan(34_000)
    expect(area).toBeLessThan(46_000)
    expect(pointInPolygon(polygon, CENTRE.lng + 0.0076, CENTRE.lat)).toBe(true)
  })

  it('reaches the stated half-width and no further', () => {
    const polygon = bufferLine(road, 20)!
    const midLng = CENTRE.lng + 0.0076
    const metresNorth = (metres: number) => CENTRE.lat + metres / 111_320

    expect(pointInPolygon(polygon, midLng, metresNorth(15))).toBe(true)
    expect(pointInPolygon(polygon, midLng, metresNorth(-15))).toBe(true)
    expect(pointInPolygon(polygon, midLng, metresNorth(30))).toBe(false)
  })

  it('closes its ring', () => {
    const ring = bufferLine(road, 20)!.coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('keeps trees off the road', () => {
    const corridor = bufferLine(road, 25)!
    const trees = placeTrees({
      stands: [],
      clearings: [corridor],
      centre: CENTRE,
      radiusMeters: 400,
      spacingMeters: 4,
    })
    expect(trees.length).toBeGreaterThan(100)
    expect(trees.some((tree) => pointInPolygon(corridor, tree.lng, tree.lat))).toBe(false)
  })

  it('has nothing to buffer', () => {
    expect(bufferLine([], 20)).toBeNull()
    expect(bufferLine([[0, 0]], 20)).toBeNull()
    expect(bufferLine(road, 0)).toBeNull()
  })
})

describe('speciesFromMix', () => {
  it('picks across the mix in proportion', () => {
    const counts = new Map<string, number>()
    for (let index = 0; index < 10_000; index += 1) {
      const species = speciesFromMix(index / 10_000)
      counts.set(species, (counts.get(species) ?? 0) + 1)
    }
    // Spruce-leading, pine a trace since the beetle — VRI around Prince George.
    expect(counts.get('spruce')! / 10_000).toBeCloseTo(0.37, 2)
    expect(counts.get('pine')! / 10_000).toBeCloseTo(0.06, 2)
    expect(new Set(counts.keys()).size).toBe(5)
  })

  it('handles the ends and a mix that adds to nothing', () => {
    expect(speciesFromMix(0)).toBe('spruce')
    expect(speciesFromMix(1)).toBe('pine')
    expect(speciesFromMix(0.5, [])).toBe('pine')
    expect(speciesFromMix(0.5, [{ species: 'fir', share: 1 }])).toBe('fir')
  })
})

describe('placeTrees species', () => {
  it('gives every stem a species and a drawn variant', () => {
    const trees = placeTrees({ stands: [], clearings: [], centre: CENTRE, radiusMeters: 200, spacingMeters: 5 })

    expect(trees.length).toBeGreaterThan(500)
    expect(trees.every((tree) => TREE_SPECIES_IDS.includes(tree.species))).toBe(true)
    expect(trees.every((tree) => tree.variant >= 0 && tree.variant < VARIANTS_PER_SPECIES)).toBe(true)
    // A stand is mixed, not one species repeated.
    expect(new Set(trees.map((tree) => tree.species)).size).toBe(TREE_SPECIES_IDS.length)
  })

  it('crowns each species around its own width', () => {
    const trees = placeTrees({ stands: [], clearings: [], centre: CENTRE, radiusMeters: 200, spacingMeters: 5 })
    const firs = trees.filter((tree) => tree.species === 'fir')
    const aspens = trees.filter((tree) => tree.species === 'aspen')
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

    expect(mean(firs.map((tree) => tree.slenderness))).toBeLessThan(mean(aspens.map((tree) => tree.slenderness)))
    // Width over height stays in the ratio the silhouettes are drawn at.
    const ratio = mean(aspens.map((tree) => tree.slenderness)) / mean(firs.map((tree) => tree.slenderness))
    expect(ratio).toBeCloseTo(SPECIES_CROWN_RATIO.aspen / SPECIES_CROWN_RATIO.fir, 1)
  })

  it('follows the mix it is handed', () => {
    const trees = placeTrees({
      stands: [],
      clearings: [],
      centre: CENTRE,
      radiusMeters: 150,
      spacingMeters: 5,
      speciesMix: [{ species: 'spruce', share: 1 }],
    })
    expect(trees.every((tree) => tree.species === 'spruce')).toBe(true)
  })
})

describe('speciesFromCode', () => {
  it('reads the codes the BC inventory actually uses', () => {
    expect(speciesFromCode('PL')).toBe('pine')
    expect(speciesFromCode('PLI')).toBe('pine')
    expect(speciesFromCode('SX')).toBe('spruce')
    expect(speciesFromCode('SE')).toBe('spruce')
    expect(speciesFromCode('BL')).toBe('fir')
    expect(speciesFromCode('FDI')).toBe('fir')
    expect(speciesFromCode('AT')).toBe('aspen')
    expect(speciesFromCode('EP')).toBe('birch')
  })

  it('falls back through the code to its stem and its genus', () => {
    // A code with a variant suffix we have no entry for still resolves.
    expect(speciesFromCode('SWB')).toBe('spruce')
    expect(speciesFromCode('BGXX')).toBe('fir')
    expect(speciesFromCode('pl')).toBe('pine')
  })

  it('says so rather than guessing when there is no code', () => {
    expect(speciesFromCode(null)).toBeNull()
    expect(speciesFromCode('')).toBeNull()
    expect(speciesFromCode('ZZ')).toBeNull()
  })
})

describe('placeTrees against surveyed stands', () => {
  const surveyed = box(CENTRE.lng - 0.002, CENTRE.lat - 0.002, CENTRE.lng + 0.002, CENTRE.lat + 0.002)

  it('draws what the province recorded where it recorded it', () => {
    const trees = placeTrees({
      stands: [],
      clearings: [],
      centre: CENTRE,
      radiusMeters: 400,
      spacingMeters: 6,
      heightMeters: 28,
      inventory: [{ geometry: surveyed, species: 'aspen', heightMeters: 9 }],
    })

    const inside = trees.filter((tree) => pointInPolygon(surveyed, tree.lng, tree.lat))
    const outside = trees.filter((tree) => !pointInPolygon(surveyed, tree.lng, tree.lat))

    expect(inside.length).toBeGreaterThan(100)
    expect(outside.length).toBeGreaterThan(100)
    expect(inside.every((tree) => tree.species === 'aspen')).toBe(true)
    // Nine-metre regeneration, not the 28 m default the rest of the view uses.
    expect(Math.max(...inside.map((tree) => tree.heightMeters))).toBeLessThan(28 * 0.55)
    expect(Math.max(...outside.map((tree) => tree.heightMeters))).toBeGreaterThan(20)
  })

  it('falls back to the mix where a stand carries no species or height', () => {
    const trees = placeTrees({
      stands: [],
      clearings: [],
      centre: CENTRE,
      radiusMeters: 300,
      spacingMeters: 6,
      inventory: [{ geometry: surveyed, species: null, heightMeters: null }],
    })
    const inside = trees.filter((tree) => pointInPolygon(surveyed, tree.lng, tree.lat))

    expect(inside.length).toBeGreaterThan(50)
    expect(new Set(inside.map((tree) => tree.species)).size).toBeGreaterThan(1)
  })
})

describe('crownColor', () => {
  it('stays in range and darkens at the low end', () => {
    for (const tone of [-1, 0, 0.5, 1, 2]) {
      const color = crownColor(tone)
      expect(color.every((channel) => channel >= 0 && channel <= 255)).toBe(true)
      expect(color.every(Number.isInteger)).toBe(true)
    }
    expect(crownColor(0)[1]).toBeLessThan(crownColor(1)[1])
  })
})

describe('thinned blocks', () => {
  const block = box(CENTRE.lng - 0.002, CENTRE.lat - 0.002, CENTRE.lng + 0.002, CENTRE.lat + 0.002)
  const grow = (thinnings: Parameters<typeof placeTrees>[0]['thinnings']) =>
    placeTrees({ stands: [], clearings: [], centre: CENTRE, radiusMeters: 400, spacingMeters: 5, heightMeters: 28, thinnings })
  const inBlock = (trees: ReturnType<typeof placeTrees>) => trees.filter((tree) => pointInPolygon(block, tree.lng, tree.lat))

  it('keeps about the recorded share of stems, and leaves the rest of the stand alone', () => {
    const full = grow([])
    const thinned = grow([blockThinning({ geometry: block, harvestSystem: 'retention', retentionPercent: 20 })!])
    const share = inBlock(thinned).length / inBlock(full).length
    expect(share).toBeGreaterThan(0.15)
    expect(share).toBeLessThan(0.25)
    const outside = (trees: ReturnType<typeof placeTrees>) => trees.filter((tree) => !pointInPolygon(block, tree.lng, tree.lat))
    expect(outside(thinned)).toEqual(outside(full))
  })

  it('stands a partial cut’s residuals at the height entered for them', () => {
    const trees = inBlock(grow([blockThinning({ geometry: block, harvestSystem: 'partial', volumeRemovedPercent: 60, residualHeightMeters: 12 })!]))
    expect(trees.length).toBeGreaterThan(50)
    expect(Math.max(...trees.map((tree) => tree.heightMeters))).toBeLessThanOrEqual(12 * 1.3)
  })

  it('draws a clearcut, or retention of nothing, as a clearing instead', () => {
    expect(blockThinning({ geometry: block })).toBeNull()
    expect(blockThinning({ geometry: block, harvestSystem: 'retention', retentionPercent: 0 })).toBeNull()
  })
})

describe('stand density and crown closure', () => {
  /** Closure as drawn: every crown rasterised at 1/16 of the spacing (0.5 m at least) over a central square. */
  function drawnClosure(options: Partial<Parameters<typeof placeTrees>[0]> & { spacingMeters: number }) {
    const spacing = options.spacingMeters
    const half = Math.max(150, spacing * 12), res = Math.max(0.5, spacing / 16)
    const trees = placeTrees({ stands: [], clearings: [], centre: CENTRE, radiusMeters: half * 1.6, maxTrees: 1e6, ...options })
    const metresPerLng = 111_320 * Math.cos((53.75 * Math.PI) / 180) // the placement grid's quantised anchor
    const n = Math.round((2 * half) / res), grid = new Uint8Array(n * n)
    for (const tree of trees) {
      const x = (tree.lng - CENTRE.lng) * metresPerLng + half, y = (tree.lat - CENTRE.lat) * 111_320 + half
      const r = (tree.slenderness * tree.heightMeters) / 2
      for (let gy = Math.max(0, Math.floor((y - r) / res)); gy <= Math.min(n - 1, Math.ceil((y + r) / res)); gy += 1)
        for (let gx = Math.max(0, Math.floor((x - r) / res)); gx <= Math.min(n - 1, Math.ceil((x + r) / res)); gx += 1)
          if ((gx * res + res / 2 - x) ** 2 + (gy * res + res / 2 - y) ** 2 <= r * r) grid[gy * n + gx] = 1
    }
    return { closure: grid.reduce((a, b) => a + b, 0) / grid.length, trees }
  }

  it('draws the regional mature stand: about 550 stems/ha at 45% closure', () => {
    const { closure, trees } = drawnClosure({ spacingMeters: 4 })
    const area = Math.PI * (150 * 1.6) ** 2
    expect((trees.length / area) * 10_000).toBeGreaterThan(500)
    expect((trees.length / area) * 10_000).toBeLessThan(600)
    expect(closure).toBeGreaterThan(0.42)
    expect(closure).toBeLessThan(0.48)
  })

  it('draws the same closure in every band, widening crowns rather than adding stems', () => {
    for (const spacing of [9, 24, 80]) {
      const { closure } = drawnClosure({ spacingMeters: spacing })
      expect(closure, `${spacing} m`).toBeGreaterThan(0.4)
      expect(closure, `${spacing} m`).toBeLessThan(0.5)
    }
    for (const target of [25, 60]) {
      const { closure } = drawnClosure({ spacingMeters: 9, crownClosurePercent: target })
      expect(Math.abs(closure * 100 - target), `${target}%`).toBeLessThan(4)
    }
  })

  it('draws a surveyed stand at its own recorded density and closure, whatever its species', () => {
    const surveyed = box(CENTRE.lng - 0.02, CENTRE.lat - 0.02, CENTRE.lng + 0.02, CENTRE.lat + 0.02)
    for (const species of ['fir', 'aspen'] as const) {
      const { closure, trees } = drawnClosure({
        spacingMeters: 4,
        inventory: [{ geometry: surveyed, species, heightMeters: 25, stemsPerHa: 300, crownClosurePercent: 30 }],
      })
      const perHa = (trees.length / (Math.PI * (150 * 1.6) ** 2)) * 10_000
      expect(perHa, species).toBeGreaterThan(260)
      expect(perHa, species).toBeLessThan(340)
      expect(Math.abs(closure * 100 - 30), species).toBeLessThan(4)
    }
  })

  it('gives unrecorded regeneration a young canopy, not mature crowns', () => {
    const young = box(CENTRE.lng - 0.02, CENTRE.lat - 0.02, CENTRE.lng + 0.02, CENTRE.lat + 0.02)
    const { closure, trees } = drawnClosure({ spacingMeters: 4, inventory: [{ geometry: young, species: 'spruce', heightMeters: 2 }] })
    expect(closure).toBeLessThan(0.12)
    const far = drawnClosure({ spacingMeters: 80, inventory: [{ geometry: box(CENTRE.lng - 0.1, CENTRE.lat - 0.1, CENTRE.lng + 0.1, CENTRE.lat + 0.1), species: 'spruce', heightMeters: 2 }] })
    // No hundred-metre strips a metre tall.
    expect(Math.max(...far.trees.map((tree) => tree.slenderness))).toBeLessThanOrEqual(4)
    expect(Math.max(...trees.map((tree) => tree.slenderness * tree.heightMeters))).toBeLessThan(4)
  })

  it('sizes a crown from closure the way the regional numbers imply', () => {
    // 45% at 550 stems/ha, crowns at random: about a 3.7 m crown.
    expect(crownWidthForClosure(REGIONAL_STAND.crownClosurePercent, REGIONAL_STAND.stemsPerHa / 10_000)).toBeCloseTo(3.7, 1)
    expect(crownWidthForClosure(45, 0)).toBe(0)
  })
})

describe('viewing gap toward a block', () => {
  const metresNorth = (m: number) => m / 111_320
  const metresEast = (m: number) => m / (111_320 * Math.cos((CENTRE.lat * Math.PI) / 180))
  // A block 200 m wide, 1 km due east of the eye.
  const block = box(CENTRE.lng + metresEast(1000), CENTRE.lat - metresNorth(100), CENTRE.lng + metresEast(1200), CENTRE.lat + metresNorth(100))

  it('points at the block, takes in its whole width, and stops short of its edge', () => {
    const gap = viewingGapToward(CENTRE, block)!
    expect(gap.bearingDegrees).toBeCloseTo(90, 0)
    // The block spans atan(100/1000) ≈ 5.7° either side, plus a margin.
    expect(gap.halfAngleDegrees).toBeGreaterThan(5.7)
    expect(gap.halfAngleDegrees).toBeLessThan(12)
    expect(gap.lengthMeters).toBeCloseTo(1000 - 30, -1)
  })

  it('caps how far out it reaches, and opens nothing from inside the block', () => {
    const far = box(CENTRE.lng + metresEast(5000), CENTRE.lat - metresNorth(100), CENTRE.lng + metresEast(5200), CENTRE.lat + metresNorth(100))
    expect(viewingGapToward(CENTRE, far)!.lengthMeters).toBe(1500)
    const around = box(CENTRE.lng - 0.01, CENTRE.lat - 0.01, CENTRE.lng + 0.01, CENTRE.lat + 0.01)
    expect(viewingGapToward(CENTRE, around)).toBeNull()
  })
})

