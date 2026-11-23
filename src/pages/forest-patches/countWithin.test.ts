import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { analyze, periodCalculator } from './analysis'
import { exampleProject, type Project } from './project'

const square = (west: number, south: number, size: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [west + size, south],
      [west + size, south + size],
      [west, south + size],
      [west, south],
    ],
  ],
})

describe('counting patches inside a reporting unit', () => {
  it('leaves every figure unchanged without a unit', () => {
    const plain = analyze(exampleProject(), 2031, 'proposed')
    const again = analyze({ ...exampleProject(), countWithin: undefined }, 2031, 'proposed')
    expect(again.timeline).toEqual(plain.timeline)
  })

  it('classes a patch by its whole size and counts only its young area inside the unit', () => {
    // One young opening about 1.3 km square (~160 ha), half of it inside the unit.
    const opening = square(-122.8, 53.9, 0.02)
    const project: Project = {
      format: 'pgmaps-patches-v1',
      type: 'FeatureCollection',
      district: 'Prince George',
      ndu: 'Moist Interior - Mountain',
      source: 'test',
      startYear: 2026,
      features: [{ type: 'Feature', geometry: opening, properties: { id: 'a', scenario: 'reference', year: 2020 } }],
    }
    const whole = periodCalculator(project, 2026, 'proposed')(2026, 'proposed')
    const unit = square(-122.81, 53.89, 0.02)
    unit.coordinates[0] = unit.coordinates[0].map(([x, y]) => [x <= -122.8 ? x : -122.79, y])
    const inside = periodCalculator({ ...project, countWithin: unit }, 2026, 'proposed')(2026, 'proposed')
    const binOf = (p: typeof whole) => p.classes.find((c) => (c.percent ?? 0) > 0)?.bin
    // The same class either way: the patch is sized whole.
    expect(binOf(inside)).toBe(binOf(whole))
    expect(inside.totalHa).toBeGreaterThan(0)
    expect(inside.totalHa).toBeLessThan(whole.totalHa * 0.75)
    expect(inside.patches).toBe(1)
    // A unit the opening never reaches counts nothing.
    const away = periodCalculator(
      { ...project, countWithin: square(-122.5, 53.5, 0.01) },
      2026,
      'proposed',
    )(2026, 'proposed')
    expect(away.totalHa).toBe(0)
    expect(away.patches).toBe(0)
  })
})
