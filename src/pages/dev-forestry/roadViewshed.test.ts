import { describe, expect, it } from 'vitest'
import { roadPath, roadPlacement } from './driveMath'
import { roadViewshedSelection } from './roadViewshed'

describe('road stretch selection', () => {
  it('includes selected endpoints, follows bends, and clips the highlighted centreline', () => {
    const path = roadPath([
      [0, 0],
      [0.003, 0],
      [0.003, 0.003],
    ])
    const selection = roadViewshedSelection(path, 100, 550)
    expect(selection.stations[0]).toEqual(roadPlacement(path, 100))
    expect(selection.stations.at(-1)).toEqual(roadPlacement(path, 550))
    expect(selection.spacing).toBeLessThanOrEqual(100)
    expect(selection.coordinates).toContainEqual([0.003, 0])
    expect(selection.stations.some((point) => point.lng === 0.003 && point.lat > 0)).toBe(true)
  })
  it('uses at most 32 samples and reports the wider interval on a long road', () => {
    const path = roadPath([
      [0, 0],
      [0.2, 0],
    ])
    const selection = roadViewshedSelection(path, 0, Infinity)
    expect(selection.stations).toHaveLength(32)
    expect(selection.spacing).toBeGreaterThan(100)
    expect(selection.stations.at(-1)?.distanceAlongMeters).toBe(path.at(-1)?.distanceAlongMeters)
  })
  it('handles an empty road without observers', () => {
    expect(roadViewshedSelection([], 0, 100).stations).toEqual([])
  })
})
