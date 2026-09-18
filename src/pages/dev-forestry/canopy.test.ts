import { describe, expect, it } from 'vitest'

import { CanopyGrid, buildCanopyGrid, type CanopyStand } from './canopy'
import type { ElevationSource } from './terrain'
import { DEFAULT_SIGHTLINE_OPTIONS, testSightline } from './visibility'

const BOUNDS: [number, number, number, number] = [-0.02, -0.01, 0.06, 0.01]

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

function stand(geometry: GeoJSON.Polygon, heightMeters: number, crownClosurePercent: number | null): CanopyStand {
  return { geometry, heightMeters, crownClosurePercent }
}

describe('CanopyGrid', () => {
  it('paints a stand only where it covers the ground', () => {
    const grid = new CanopyGrid(BOUNDS, 25)
    grid.paint(box(0.01, -0.004, 0.03, 0.004), 24)

    expect(grid.heightAt(0.02, 0)).toBe(24)
    expect(grid.heightAt(0.05, 0)).toBe(0)
    expect(grid.heightAt(0.02, 0.008)).toBe(0)
  })

  it('keeps the taller of two overlapping stands', () => {
    const grid = new CanopyGrid(BOUNDS, 25)
    grid.paint(box(0.0, -0.005, 0.03, 0.005), 18)
    grid.paint(box(0.01, -0.005, 0.04, 0.005), 30)
    expect(grid.heightAt(0.02, 0)).toBe(30)
    expect(grid.heightAt(0.005, 0)).toBe(18)
  })

  it('clears canopy from harvested ground', () => {
    const grid = new CanopyGrid(BOUNDS, 25)
    grid.paint(box(0.0, -0.005, 0.04, 0.005), 26)
    expect(grid.heightAt(0.02, 0)).toBe(26)

    grid.clear(box(0.015, -0.005, 0.025, 0.005))
    expect(grid.heightAt(0.02, 0)).toBe(0)
    // Ground outside the opening still carries its stand.
    expect(grid.heightAt(0.005, 0)).toBe(26)
  })

  it('reads nothing outside its own bounds', () => {
    const grid = new CanopyGrid(BOUNDS, 25)
    grid.paint(box(0.0, -0.005, 0.04, 0.005), 26)
    expect(grid.heightAt(5, 5)).toBe(0)
    expect(grid.heightAtMercator(-1, -1)).toBe(0)
  })
})

describe('buildCanopyGrid', () => {
  const dense = stand(box(0.0, -0.005, 0.02, 0.005), 25, 60)
  const open = stand(box(0.03, -0.005, 0.05, 0.005), 25, 10)
  const unrated = stand(box(-0.015, -0.005, -0.005, 0.005), 20, null)

  it('drops stands more open than the screening threshold', () => {
    const grid = buildCanopyGrid([dense, open], BOUNDS)
    expect(grid.heightAt(0.01, 0)).toBe(25)
    expect(grid.heightAt(0.04, 0)).toBe(0)
  })

  it('takes an unrated stand at face value rather than as open ground', () => {
    // Missing crown closure is missing inventory, not evidence of a clearing.
    expect(buildCanopyGrid([unrated], BOUNDS).heightAt(-0.01, 0)).toBe(20)
  })

  it('follows the threshold it is given', () => {
    expect(buildCanopyGrid([open], BOUNDS, [], { minCrownClosurePercent: 5 }).heightAt(0.04, 0)).toBe(25)
  })

  it('clears the ground it is told has been harvested', () => {
    const grid = buildCanopyGrid([dense], BOUNDS, [box(0.005, -0.005, 0.015, 0.005)])
    expect(grid.heightAt(0.01, 0)).toBe(0)
    expect(grid.heightAt(0.018, 0)).toBe(25)
  })

  it('reports how much of the area carries canopy', () => {
    expect(buildCanopyGrid([], BOUNDS).coverageFraction()).toBe(0)
    const partial = buildCanopyGrid([dense], BOUNDS).coverageFraction()
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(1)
  })
})

describe('canopy in the sightline', () => {
  /** Flat ground, so only the canopy can block anything. */
  const FLAT: ElevationSource = { elevationAt: () => 0 }
  const observer = { lng: 0, lat: 0, groundElevationMeters: 0 }
  const target = { lng: 0.04, lat: 0, groundElevationMeters: 0 }

  it('leaves a clear view clear', () => {
    expect(testSightline(FLAT, observer, target, DEFAULT_SIGHTLINE_OPTIONS).visible).toBe(true)
  })

  it('blocks a view through a stand of mature timber', () => {
    // A 25 m stand across the middle of an otherwise flat 4.4 km sightline.
    const grid = buildCanopyGrid([stand(box(0.015, -0.005, 0.025, 0.005), 25, 70)], BOUNDS)
    const result = testSightline(FLAT, observer, target, DEFAULT_SIGHTLINE_OPTIONS, grid)
    expect(result.visible).toBe(false)
    expect(result.blockedAtMeters).toBeGreaterThan(1000)
  })

  it('opens the same view once that ground is harvested', () => {
    const screen = box(0.015, -0.005, 0.025, 0.005)
    const cleared = buildCanopyGrid([stand(screen, 25, 70)], BOUNDS, [screen])
    expect(testSightline(FLAT, observer, target, DEFAULT_SIGHTLINE_OPTIONS, cleared).visible).toBe(true)
  })

  it('lets a viewer above the canopy see over it', () => {
    const grid = buildCanopyGrid([stand(box(0.015, -0.005, 0.025, 0.005), 25, 70)], BOUNDS)
    const fromTower = testSightline(
      FLAT,
      observer,
      { ...target, groundElevationMeters: 60 },
      { ...DEFAULT_SIGHTLINE_OPTIONS, observerHeightMeters: 60 },
      grid,
    )
    expect(fromTower.visible).toBe(true)
  })

  it('does not block a view that never crosses the stand', () => {
    const grid = buildCanopyGrid([stand(box(0.015, 0.004, 0.025, 0.009), 30, 70)], BOUNDS)
    expect(testSightline(FLAT, observer, target, DEFAULT_SIGHTLINE_OPTIONS, grid).visible).toBe(true)
  })
})
