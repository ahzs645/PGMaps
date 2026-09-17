import { describe, expect, it } from 'vitest'

import { computeAnalysis } from './analysis'
import type { ElevationSource } from './terrain'
import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisInput, type TargetPolygon } from './types'
import { polygonAreaMeters } from './visibility'

/** Perfectly flat ground, so the answer is the area arithmetic and nothing else. */
const FLAT: ElevationSource = { elevationAt: () => 0 }

const TERRAIN = { tileCount: 1, missingTileCount: 0, resolutionMeters: 25 }

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

/** 0.04° x 0.02° on the equator — about 4.4 km by 2.2 km. */
const LANDFORM = box(-0.02, -0.01, 0.02, 0.01)

type TargetSpec = Partial<TargetPolygon> & { id: string; role: TargetPolygon['role']; geometry: GeoJSON.Polygon }

function analyse(targets: TargetSpec[], settings: Partial<typeof DEFAULT_ANALYSIS_SETTINGS> = {}) {
  const input: AnalysisInput = {
    // A single viewpoint high above flat ground sees everything, so visibility
    // never confounds what these tests are measuring.
    viewpoint: { mode: 'spot', coordinates: [[-0.06, 0]] },
    targets: targets.map((target) => ({
      id: target.id,
      name: target.id,
      role: target.role,
      geometry: target.geometry,
      harvestYear: target.harvestYear ?? null,
      clearcutPercent: target.clearcutPercent ?? null,
    })),
    settings: {
      ...DEFAULT_ANALYSIS_SETTINGS,
      observerHeightMeters: 3000,
      maxViewDistanceMeters: 40000,
      sampleBudget: 400,
      ...settings,
    },
    assessmentYear: 2026,
  }
  return computeAnalysis(FLAT, input, TERRAIN)
}

/** Expected share of the landform an area occupies, in percent. */
function shareOfLandform(geometry: GeoJSON.Polygon): number {
  return (polygonAreaMeters(geometry) / polygonAreaMeters(LANDFORM)) * 100
}

describe('cumulative alteration', () => {
  const opening = box(-0.015, -0.005, -0.005, 0.005)
  const proposed = box(0.005, -0.005, 0.015, 0.005)

  it('splits existing from proposed and sums them', () => {
    const result = analyse([
      { id: 'landform', role: 'landscape', geometry: LANDFORM },
      { id: 'existing', role: 'harvested', geometry: opening, harvestYear: 2020, clearcutPercent: 100 },
      { id: 'proposed', role: 'block', geometry: proposed },
    ])

    const planimetric = result.planimetricAlteration!
    expect(planimetric.existingPercent).toBeCloseTo(shareOfLandform(opening), 0)
    expect(planimetric.proposedPercent).toBeCloseTo(shareOfLandform(proposed), 0)
    expect(planimetric.cumulativePercent).toBeCloseTo(planimetric.existingPercent + planimetric.proposedPercent, 10)
  })

  it('drops an opening that has grown back past green-up', () => {
    const recent = analyse([
      { id: 'landform', role: 'landscape', geometry: LANDFORM },
      { id: 'existing', role: 'harvested', geometry: opening, harvestYear: 2020, clearcutPercent: 100 },
    ])
    const old = analyse([
      { id: 'landform', role: 'landscape', geometry: LANDFORM },
      // Harvested in 1990, well past the 20-year default.
      { id: 'existing', role: 'harvested', geometry: opening, harvestYear: 1990, clearcutPercent: 100 },
    ])

    expect(recent.planimetricAlteration!.existingPercent).toBeGreaterThan(5)
    expect(old.planimetricAlteration!.existingPercent).toBe(0)
    expect(old.recoveredOpeningCount).toBe(1)
    expect(recent.recoveredOpeningCount).toBe(0)
  })

  it('follows the green-up age it is given', () => {
    const targets: TargetSpec[] = [
      { id: 'landform', role: 'landscape', geometry: LANDFORM },
      { id: 'existing', role: 'harvested', geometry: opening, harvestYear: 2010, clearcutPercent: 100 },
    ]
    // 16 years old: alteration under a 20-year rule, recovered under a 15-year one.
    expect(analyse(targets, { greenUpAgeYears: 20 }).planimetricAlteration!.existingPercent).toBeGreaterThan(5)
    expect(analyse(targets, { greenUpAgeYears: 15 }).planimetricAlteration!.existingPercent).toBe(0)
  })

  it('counts only the clearcut share of a partial cut', () => {
    const full = analyse([
      { id: 'landform', role: 'landscape', geometry: LANDFORM },
      { id: 'existing', role: 'harvested', geometry: opening, harvestYear: 2020, clearcutPercent: 100 },
    ])
    const partial = analyse([
      { id: 'landform', role: 'landscape', geometry: LANDFORM },
      { id: 'existing', role: 'harvested', geometry: opening, harvestYear: 2020, clearcutPercent: 40 },
    ])

    expect(partial.planimetricAlteration!.existingPercent).toBeCloseTo(
      full.planimetricAlteration!.existingPercent * 0.4,
      6,
    )
  })

  it('treats a missing clearcut percentage as fully cut', () => {
    const result = analyse([
      { id: 'landform', role: 'landscape', geometry: LANDFORM },
      { id: 'existing', role: 'harvested', geometry: opening, harvestYear: 2020 },
    ])
    expect(result.planimetricAlteration!.existingPercent).toBeCloseTo(shareOfLandform(opening), 0)
  })

  it('does not charge a proposed block for ground an opening already holds', () => {
    // The proposal sits exactly on top of the existing opening.
    const overlapping = analyse([
      { id: 'landform', role: 'landscape', geometry: LANDFORM },
      { id: 'existing', role: 'harvested', geometry: opening, harvestYear: 2020, clearcutPercent: 100 },
      { id: 'proposed', role: 'block', geometry: opening },
    ])

    const planimetric = overlapping.planimetricAlteration!
    expect(planimetric.existingPercent).toBeCloseTo(shareOfLandform(opening), 0)
    expect(planimetric.proposedPercent).toBeCloseTo(0, 5)
    // Cumulative is the union, not the sum of the two polygons.
    expect(planimetric.cumulativePercent).toBeCloseTo(planimetric.existingPercent, 5)
  })

  it('frees ground under a recovered opening for the proposal to claim', () => {
    const result = analyse([
      { id: 'landform', role: 'landscape', geometry: LANDFORM },
      { id: 'existing', role: 'harvested', geometry: opening, harvestYear: 1990, clearcutPercent: 100 },
      { id: 'proposed', role: 'block', geometry: opening },
    ])

    // The old opening no longer counts, so re-harvesting it is new alteration.
    expect(result.planimetricAlteration!.existingPercent).toBe(0)
    expect(result.planimetricAlteration!.proposedPercent).toBeCloseTo(shareOfLandform(opening), 0)
  })

  it('reports both scales, and nothing at all without a landform', () => {
    const withLandform = analyse([
      { id: 'landform', role: 'landscape', geometry: LANDFORM },
      { id: 'proposed', role: 'block', geometry: proposed },
    ])
    expect(withLandform.perspectiveAlteration).not.toBeNull()
    expect(withLandform.planimetricAlteration).not.toBeNull()

    const without = analyse([{ id: 'proposed', role: 'block', geometry: proposed }])
    expect(without.perspectiveAlteration).toBeNull()
    expect(without.planimetricAlteration).toBeNull()
    expect(without.landformAreaMeters).toBeNull()
  })

  it('ignores a block that falls outside the landform', () => {
    const outside = box(0.05, -0.005, 0.06, 0.005)
    const result = analyse([
      { id: 'landform', role: 'landscape', geometry: LANDFORM },
      { id: 'proposed', role: 'block', geometry: outside },
    ])
    expect(result.planimetricAlteration!.proposedPercent).toBeCloseTo(0, 5)
  })
})
