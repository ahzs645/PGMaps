import { describe, expect, it } from 'vitest'
import { buildScenePackage, type ScenePackageInput } from './scenePackage'
import { standOnGrid } from './sceneStand'
import { metersPerDegree } from './visibility'

const eye = { lng: -122.8, lat: 53.9 },
  m = metersPerDegree(eye.lat)
const rect = (east: number, north: number, width: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [east, north],
      [east + width, north],
      [east + width, north + width],
      [east, north + width],
      [east, north],
    ].map(([x, y]) => [eye.lng + x / m.lng, eye.lat + y / m.lat]),
  ],
})
const input: ScenePackageInput = {
  eye,
  eyeHeightMeters: 1.6,
  bearingDegrees: 0,
  pitchDegrees: 0,
  verticalFovDegrees: 40,
  elevation: { elevationAt: () => 800 },
  forest: { anchorLatitude: eye.lat, stands: [], clearings: [], inventory: [], standHeightMeters: 25 },
  treeRadiusMeters: 80,
  terrainRadiusMeters: 1600,
  terrainSpacingMeters: 100,
  includeModels: false,
}

describe('distant resolved stand data', () => {
  it('distinguishes a 40 m hemlock stand from 6 m cottonwood beyond the explicit stems at equal closure', () => {
    const geometry = rect(850, -200, 500)
    const make = (species: 'hemlock' | 'cottonwood', heightMeters: number) =>
      buildScenePackage({
        ...input,
        forest: { ...input.forest, inventory: [{ geometry, species, heightMeters, crownClosurePercent: 45 }] },
      })
    const mature = make('hemlock', 40),
      young = make('cottonwood', 6)
    expect(mature.trees).toEqual(young.trees)
    expect(mature.terrain.canopy).toEqual(young.terrain.canopy)
    expect(mature.terrain.stand).not.toEqual(young.terrain.stand)
    expect(mature.terrain.stand!.records).toContainEqual({
      heightMeters: 40,
      species: [{ species: 'hemlock', share: 1, heightMeters: 40 }],
      source: 'inventory',
    })
    expect(young.terrain.stand!.records).toContainEqual({
      heightMeters: 6,
      species: [{ species: 'cottonwood', share: 1, heightMeters: 6 }],
      source: 'inventory',
    })
  })

  it('preserves all recorded composition and its per-species heights, with regional fallback labelled separately', () => {
    const scene = buildScenePackage({
      ...input,
      forest: {
        ...input.forest,
        inventory: [
          {
            geometry: rect(500, -200, 500),
            species: null,
            heightMeters: 20,
            speciesMix: [
              { species: 'hemlock', share: 0.3, heightMeters: 30 },
              { species: 'cottonwood', share: 0.7, heightMeters: 10 },
            ],
          },
        ],
      },
    })
    const record = scene.terrain.stand!.records.find((r) => r.source === 'inventory')!
    expect(record.heightMeters).toBeCloseTo(16)
    expect(record.species).toEqual([
      { species: 'hemlock', share: 0.3, heightMeters: 30 },
      { species: 'cottonwood', share: 0.7, heightMeters: 10 },
    ])
    expect(scene.terrain.stand!.records.some((r) => r.source === 'regional')).toBe(true)
  })

  it('uses the same first inventory record and thinning height rule as native placement', () => {
    const geometry = rect(-100, -100, 200)
    const result = standOnGrid(
      { west: 0, south: 0, spacing: 10, columns: 1, rows: 1, heights: [800], canopy: [0.4] },
      () => [eye.lng, eye.lat],
      {
        stands: [],
        clearings: [],
        heightMeters: 25,
        inventory: [
          { geometry, species: 'pine', heightMeters: 8 },
          { geometry, species: 'hemlock', heightMeters: 40 },
        ],
        thinnings: [{ geometry, keepFraction: 0.5, heightMeters: 12 }],
      },
    )
    expect(result.records).toEqual([
      { heightMeters: 12, species: [{ species: 'pine', share: 1, heightMeters: 12 }], source: 'inventory' },
    ])
    expect(result.cells).toEqual([0])
  })

  it('keeps missing terrain, water and cleared posts out of the palette', () => {
    const scene = buildScenePackage({
      ...input,
      water: [rect(500, 500, 400)],
      forest: { ...input.forest, clearings: [rect(-400, -400, 300)] },
      elevation: { elevationAt: (lng) => (lng > eye.lng + 1000 / m.lng ? NaN : 800) },
    })
    const grid = scene.terrain
    expect(grid.stand!.cells).toHaveLength(grid.heights.length)
    for (let i = 0; i < grid.heights.length; i++)
      if (grid.heights[i] == null || grid.canopy![i] === 0) expect(grid.stand!.cells[i]).toBe(-1)
  })
})
