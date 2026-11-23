import { describe, expect, it } from 'vitest'
import { albersToLngLat } from '../../../src/pages/dev-avast/projection'
import { analyze } from '../../../src/pages/forest-patches/analysis'
import { explainPatches } from '../../../src/pages/forest-patches/explanation'
import { fieldComparison, fieldPriorities } from '../../../src/pages/forest-patches/fieldComparison'
import {
  disturbanceBasis,
  exampleProject,
  importLayer,
  type Footprint,
} from '../../../src/pages/forest-patches/project'

function footprint(id: string, year: number, width: number, offset: number): Footprint {
  return {
    type: 'Feature',
    properties: { id, year, scenario: 'reference' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [width, 0],
          [width, width],
          [0, width],
          [0, 0],
        ].map(([x, y]) => albersToLngLat(1200000 + offset + x, 850000 + y)),
      ],
    },
  }
}
const small = footprint('Verified stand', 2015, 200, 0)
const large = footprint('Inventory stand', 2006, 800, 2000)
const project = { ...exampleProject(), ndu: 'McGregor Plateau', features: [small, large] }
const base = { project, year: 2031, scenario: 'proposed' as const }
const input = {
  ...base,
  id: large.properties.id,
  earliest: 1990,
  latest: 2040,
  source: 'Disturbance record under review',
}

describe('Attribution and field sensitivity for a proposed harvest', () => {
  it('accounts for every classified hectare once, including overlapping sources', () => {
    const result = analyze(
      {
        ...project,
        features: [small, { ...small, properties: { ...small.properties, id: 'Overlapping record' } }, large],
      },
      2026,
      'proposed',
    )
    const e = explainPatches(result, 2026, 'proposed')
    expect(e.totalHa).toBeCloseTo(68)
    expect(e.screen).toBeNull()
    for (const c of e.classes) {
      expect(c.patches.reduce((n, p) => n + p.youngHa, 0)).toBeCloseTo(c.ha)
      expect(c.patches.reduce((n, p) => n + p.sharePoints, 0)).toBeCloseTo(c.percent!)
    }
    expect(e.classes[0].patches[0].footprintIds).toEqual(['Verified stand', 'Overlapping record'])
    expect(e.classes[1].patches[0].footprintIds).toEqual(['Inventory stand'])
    expect(e.classes[1].patches[0].youngHa).toBeCloseTo(64)
  })
  it('matches a full rerun at every integer year including interior flips and joined footprints', () => {
    // The neighbour overlaps the inventory stand. Recalculate the union after each date change.
    const extra = footprint('Neighbour', 2015, 700, 2750)
    const bridging = { ...project, features: [small, large, extra] }
    const tested = fieldComparison({ ...input, project: bridging })
    for (let year = 1990; year <= 2040; year++) {
      const rerun = analyze(
        {
          ...bridging,
          features: bridging.features.map((f) =>
            f === large ? { ...large, properties: { ...large.properties, year } } : f,
          ),
        },
        2031,
        'proposed',
      )
      const actual = explainPatches(rerun, 2031, 'proposed')
      const entry = tested.cases.find((c) => c.from <= year && c.through >= year)!
      expect(entry.screen).toBe(actual.screen)
    }
    const measured = fieldComparison(input)
    expect(measured.baselineScreen).toBe(true)
    expect(measured.canFlip).toBe(true)
    expect(measured.minFlipYears).toBe(1)
    expect(measured.cases.map((c) => [c.from, c.through, c.screen])).toEqual([
      [1990, 2005, false],
      [2006, 2010, true],
      [2011, 2026, false],
      [2027, 2031, true],
      [2032, 2040, false],
    ])
    expect(measured.cases[2].maxClassShift).toBeCloseTo((100 * 64) / 68)
    expect(measured.cases[2].maxTrendShift).toBeGreaterThan(0)
    expect(large.properties.year).toBe(2006)
  })
  it('ranks evidence that can flip the review ahead of a date with no effect', () => {
    const ranked = fieldPriorities({ ...base, tolerance: 1 })
    expect(ranked.rows.map((r) => [r.id, r.canFlip, r.minFlipYears])).toEqual([
      ['Inventory stand', true, 1],
      ['Verified stand', false, null],
    ])
    // Only the earlier period changes in this range.
    expect(ranked.rows[0].maxClassShift).toBe(0)
    expect(ranked.rows[0].maxTrendShift).toBeGreaterThan(0)
    expect(fieldPriorities({ ...base, tolerance: 0 }).rows.every((r) => !r.canFlip && r.maxTrendShift === 0)).toBe(true)
  })
  it('keeps missing evidence, a zero-area period and an off-schedule event distinct', () => {
    const one = { ...project, features: [large] }
    const test = fieldComparison({ ...input, project: one })
    expect(test.baselineScreen).toBeNull()
    expect(test.cases.some((c) => c.screen === null && c.maxClassShift === null)).toBe(true)
    expect(test.cases.some((c) => c.screen === false)).toBe(true)
    expect(fieldPriorities({ ...base, project: one, tolerance: 5 }).rows[0].canResolve).toBe(true)
    const all = fieldComparison({ ...input, project: { ...project, features: [small] }, id: small.properties.id })
    expect(all.canLoseEvidence).toBe(true)
    expect(fieldComparison({ ...input, year: 2026 }).cases.every((c) => c.screen === null)).toBe(true)
    expect(() =>
      fieldComparison({
        ...input,
        project: { ...project, features: [{ ...large, properties: { ...large.properties, scenario: 'alternative' } }] },
      }),
    ).toThrow(/schedule/)
    expect(() => fieldComparison({ ...input, earliest: 2041 })).toThrow(/ordered/)
  })
  it('records a missing import year and retains that provenance through GeoJSON exchange', () => {
    const p = { ...project, features: [] }
    const added = importLayer(p, { ...small, properties: { id: 'No source date' } }, 'VRI sample', 2015, 'reference')
    expect(added.features[0].properties.yearBasis).toBe('editor-default')
    expect(disturbanceBasis(added.features[0])).toContain('missing')
    expect(importLayer(p, added.features[0], 'export.geojson', 2026, 'proposed').features[0].properties.yearBasis).toBe(
      'editor-default',
    )
    expect(importLayer(p, small, 'dated.geojson', 2026, 'proposed').features[0].properties.yearBasis).toBe(
      'source-attribute',
    )
  })
})
