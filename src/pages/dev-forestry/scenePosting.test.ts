import { describe, expect, it } from 'vitest'

import type { ScenePackage } from './scenePackage'
import { ACCEPTS_PACKED_ARRAYS, engineAccepts, PACK_MIN_LENGTH, packScene, unpackScene } from './scenePosting'

/** A small package in the real shape: grids with nulls, stems, rings, short lists. */
function scene(over: (pkg: Record<string, unknown>) => void = () => {}): ScenePackage {
  const posts = 40 * 40
  const grid = (seed: number) => ({
    west: -600,
    south: -600,
    spacing: 30,
    columns: 40,
    rows: 40,
    heights: Array.from({ length: posts }, (_, i) => (i % 97 === 0 ? null : 700 + Math.sin(i * seed) * 80.123456789)),
    canopy: Array.from({ length: posts }, (_, i) => (i % 5 === 0 ? null : (i % 11) / 10)),
    cover: Array.from({ length: posts }, (_, i) => i % 8),
    burntYear: Array.from({ length: posts }, () => null),
  })
  const pkg: Record<string, unknown> = {
    format: 'pgmaps-forest-scene',
    version: 1,
    createdAt: '2026-11-15T00:00:00.000Z',
    origin: { lng: -116.97, lat: 50.26, elevationMeters: 540 },
    frame: 'local metres: x east, y north, z up; heights absolute',
    terrain: grid(0.37),
    farTerrain: grid(0.11),
    trees: {
      fields: ['x', 'y', 'z', 'species', 'height', 'crownWidth', 'tone'],
      species: ['fir', 'aspen'],
      count: 300,
      data: Array.from({ length: 300 * 7 }, (_, i) => (i % 7 === 3 ? i % 2 : -0.5 + i * 0.731)),
    },
    species: {},
    openings: [
      {
        kind: 'harvested',
        rings: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 0],
          ],
        ],
        ageYears: null,
      },
    ],
    debris: { fields: ['x', 'y', 'z', 'footprint'], count: 1, data: [1, 2, 3, 4] },
    roadScars: [],
    water: [{ rings: [Array.from({ length: 1500 }, (_, i) => [i, -i] as [number, number])], elevationMeters: null }],
    camera: { position: [0, 0, 541.6], bearingDegrees: 12 },
    treeRadiusMeters: 500,
    notes: ['a note'],
  }
  over(pkg)
  return pkg as unknown as ScenePackage
}

describe('posting a scene package', () => {
  it('packs the long numeric arrays, and unpacking gives the package back value for value', () => {
    const original = scene()
    const untouched = structuredClone(original)
    const packed = packScene(original)
    expect(original).toEqual(untouched)
    const sent = packed.scene as ScenePackage
    expect(sent.terrain.heights).toBeInstanceOf(Float64Array)
    expect(sent.terrain.burntYear).toBeInstanceOf(Float64Array)
    expect(sent.trees.data).toBeInstanceOf(Float64Array)
    // Short arrays, lists of words and rings of pairs stay as they are.
    expect(Array.isArray(sent.debris.data)).toBe(true)
    expect(Array.isArray(sent.notes)).toBe(true)
    expect(Array.isArray(sent.water?.[0].rings[0])).toBe(true)
    expect(packed.transfer).toHaveLength(9)
    // What crosses is what structured clone delivers; the engine's unpack restores the plain package exactly.
    const arrived = structuredClone(packed.scene, { transfer: packed.transfer })
    expect(unpackScene(arrived)).toEqual(untouched)
    expect((sent.terrain.heights as unknown as Float64Array).length).toBe(0)
  })

  it('leaves an array alone when it holds anything but finite numbers and nulls', () => {
    const odd = scene((pkg) => {
      const terrain = pkg.terrain as { heights: unknown[]; cover: unknown[] }
      terrain.heights[5] = Number.POSITIVE_INFINITY
      terrain.cover[7] = Number.NaN
    })
    const sent = packScene(odd).scene as ScenePackage
    expect(Array.isArray(sent.terrain.heights)).toBe(true)
    expect(Array.isArray(sent.terrain.cover)).toBe(true)
    expect(sent.terrain.canopy).toBeInstanceOf(Float64Array)
    expect(PACK_MIN_LENGTH).toBeGreaterThan(4)
  })

  it('keys a package by its content: the stamp apart, any changed value changes the key', () => {
    const key = packScene(scene()).key
    expect(packScene(scene()).key).toBe(key)
    expect(packScene(scene((pkg) => (pkg.createdAt = '2027-01-01T00:00:00.000Z'))).key).toBe(key)
    const changed = [
      scene((pkg) => ((pkg.terrain as { heights: Array<number | null> }).heights[800] = 700.0000001)),
      scene((pkg) => ((pkg.terrain as { heights: Array<number | null> }).heights[801] = null)),
      scene((pkg) => ((pkg.farTerrain as { cover: number[] }).cover[3] = 6)),
      scene((pkg) => ((pkg.trees as { data: number[] }).data[2099] += 0.001)),
      scene((pkg) => ((pkg.camera as { bearingDegrees: number }).bearingDegrees = 13)),
      scene((pkg) => (pkg.notes as string[]).push('another')),
      scene((pkg) => ((pkg.water as Array<{ rings: number[][][] }>)[0].rings[0][700][1] = 0.5)),
      scene((pkg) => delete pkg.farTerrain),
    ]
    const keys = new Set(changed.map((pkg) => packScene(pkg).key))
    expect(keys.size).toBe(changed.length)
    expect(keys.has(key)).toBe(false)
    // Two layers swapping their values is a change too.
    const swapped = scene((pkg) => {
      const terrain = pkg.terrain as { canopy: unknown; cover: unknown }
      ;[terrain.canopy, terrain.cover] = [terrain.cover, terrain.canopy]
    })
    expect(packScene(swapped).key).not.toBe(key)
  })

  it('reads what an engine accepts from its hello', () => {
    expect(engineAccepts([ACCEPTS_PACKED_ARRAYS], ACCEPTS_PACKED_ARRAYS)).toBe(true)
    expect(engineAccepts(undefined, ACCEPTS_PACKED_ARRAYS)).toBe(false)
    expect(engineAccepts('packed-arrays', ACCEPTS_PACKED_ARRAYS)).toBe(false)
  })
})
