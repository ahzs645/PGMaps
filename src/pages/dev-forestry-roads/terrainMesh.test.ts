import { describe, expect, it } from 'vitest'
import { cachedTerrainSampler, MAX_DISPLAY_GAP_M, MAX_TERRAIN_MESH_SIDE, terrainMesh } from './terrainMesh'

describe('terrain preview coverage', () => {
  it('keeps the same ground triangles and gaps when the follow window shifts', () => {
    const sample = (x: number, y: number) => (x >= 40 && x <= 42 && y >= 40 && y <= 42 ? NaN : 700 + x / 10)
    const first = terrainMesh([0, 0, 96, 96], sample, [[50.5, 50.5]])
    const shifted = terrainMesh([0.3, 0.4, 96.3, 96.4], sample, [[50.5, 50.5]])
    const common = (mesh: typeof first) =>
      mesh.faces.filter((face) => face.every((point) => point.x >= 1 && point.x <= 95 && point.y >= 1 && point.y <= 95))
    expect(common(first)).toEqual(common(shifted))
  })

  it('reuses missing and finite terrain samples while bounding its cache', () => {
    let calls = 0
    const sample = cachedTerrainSampler((x) => {
      calls++
      return x === 0 ? NaN : x
    }, 2)
    expect(sample(0, 0)).toBeNaN()
    expect(sample(0, 0)).toBeNaN()
    expect(sample(1, 0)).toBe(1)
    expect(sample(1, 0)).toBe(1)
    expect(calls).toBe(2)
    sample(2, 0)
    sample(0, 0)
    expect(calls).toBe(4)
  })
  it('keeps a narrow analysis gap open even when no mesh vertex falls in it', () => {
    const sample = (x: number, y: number) => (Math.hypot(x - 50.5, y - 50.5) < 0.1 ? NaN : 700)
    const mesh = terrainMesh([0, 0, 96, 96], sample, [[50.5, 50.5]])
    expect(mesh.faces).toHaveLength(2 * (96 * 96 - 1))
    expect(mesh.faces.some((face) => face.every((p) => p.x >= 50 && p.x <= 51 && p.y >= 50 && p.y <= 51))).toBe(false)
  })

  it('opens all cells sharing a missing boundary sample without masking off-window gaps', () => {
    const mesh = terrainMesh([0, 0, 96, 96], () => 700, [
      [50, 50],
      [-1, 50],
      [97, 50],
    ])
    expect(mesh.faces).toHaveLength(2 * (96 * 96 - 4))
  })

  it('preserves missing source vertices and bounds work on a long narrow corridor', () => {
    let samples = 0
    const mesh = terrainMesh(
      [0, 0, 960, 100],
      (x) => {
        samples++
        return x === 0 ? NaN : 700 + x / 100
      },
      [],
    )
    expect(samples).toBeLessThanOrEqual((MAX_TERRAIN_MESH_SIDE + 1) ** 2)
    expect(mesh.spacing).toBe(10)
    expect(mesh.faces.length).toBeGreaterThan(0)
    expect(mesh.faces.every((face) => face.every((p) => Number.isFinite(p.z) && p.x > 0))).toBe(true)
  })

  it('closes an enclosed display hole while preserving the source sampler and measured faces', () => {
    const sample = (x: number, y: number) => (x >= 40 && x <= 42 && y >= 40 && y <= 42 ? NaN : 700 + x / 10 + y / 20)
    const strict = terrainMesh([0, 0, 96, 96], sample, [])
    const filled = terrainMesh([0, 0, 96, 96], sample, [], true)
    expect(filled.faces).toEqual(strict.faces)
    expect(filled.estimatedFaces.length).toBeGreaterThan(0)
    expect(filled.faces.length + filled.estimatedFaces.length).toBe(2 * 96 * 96)
    expect(filled.openGapCells).toBe(0)
    for (const face of filled.estimatedFaces)
      for (const point of face) expect(point.z).toBeCloseTo(700 + point.x / 10 + point.y / 20, 2)
    expect(sample(41, 41)).toBeNaN()
  })

  it('fills known narrow source gaps without inventing additional terrain samples', () => {
    const strict = terrainMesh([0, 0, 96, 96], () => 700, [[50.5, 50.5]])
    const filled = terrainMesh([0, 0, 96, 96], () => 700, [[50.5, 50.5]], true)
    expect(filled.faces).toEqual(strict.faces)
    expect(filled.estimatedFaces).toHaveLength(2)
    expect(filled.openGapCells).toBe(0)
  })

  it('never fills boundary gaps or unsupported areas larger than the display limit', () => {
    const sample = (x: number, y: number) =>
      x <= 2 || (x >= 50 && x <= 50 + MAX_DISPLAY_GAP_M && y >= 50 && y <= 55) ? NaN : 700
    const filled = terrainMesh([0, 0, 192, 192], sample, [], true)
    expect(filled.estimatedFaces).toHaveLength(0)
    expect(filled.openGapCells).toBeGreaterThan(0)
  })

  it('keeps estimated patches fixed when the camera window moves', () => {
    const sample = (x: number, y: number) => (Math.hypot(x - 50, y - 50) < 2 ? NaN : 700 + x / 10)
    const first = terrainMesh([0, 0, 96, 96], sample, [], true)
    const shifted = terrainMesh([0.3, 0.4, 96.3, 96.4], sample, [], true)
    expect(first.estimatedFaces).toEqual(shifted.estimatedFaces)
  })
})
