import { describe, expect, it } from 'vitest'

import {
  SPECIES_CROWN_RATIO,
  TREE_SPECIES_IDS,
  VARIANTS_PER_SPECIES,
  bufferLine,
  coniferMesh,
  crownColor,
  placeTrees,
  speciesFromCode,
  speciesFromMix,
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
    // Pine-leading, aspen a minor component — the default interior mix.
    expect(counts.get('pine')! / 10_000).toBeCloseTo(0.42, 2)
    expect(counts.get('aspen')! / 10_000).toBeCloseTo(0.12, 2)
    expect(new Set(counts.keys()).size).toBe(4)
  })

  it('handles the ends and a mix that adds to nothing', () => {
    expect(speciesFromMix(0)).toBe('pine')
    expect(speciesFromMix(1)).toBe('aspen')
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
    expect(new Set(trees.map((tree) => tree.species)).size).toBe(4)
  })

  it('crowns each species around its own width', () => {
    const trees = placeTrees({ stands: [], clearings: [], centre: CENTRE, radiusMeters: 200, spacingMeters: 5 })
    const firs = trees.filter((tree) => tree.species === 'fir')
    const aspens = trees.filter((tree) => tree.species === 'aspen')
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

    expect(mean(firs.map((tree) => tree.slenderness))).toBeLessThan(mean(aspens.map((tree) => tree.slenderness)))
    expect(mean(firs.map((tree) => tree.slenderness))).toBeCloseTo(SPECIES_CROWN_RATIO.fir, 1)
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
    expect(speciesFromCode('EP')).toBe('aspen')
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
