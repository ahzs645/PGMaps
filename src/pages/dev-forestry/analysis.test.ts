import { describe, expect, it } from 'vitest'

import { computeAnalysis } from './analysis'
import type { ElevationSource } from './terrain'
import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisInput, type TargetPolygon } from './types'
import { polygonAreaMeters } from './visibility'
import { vegHeightForSlope } from './vqo'

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

describe('visually effective green-up height', () => {
  /**
   * Ground that is flat over its western half and steep over its eastern half.
   * The 1998 procedures say to work out the hectares in each slope class and
   * area-weight each class's height — not to read one height off the mean slope,
   * which on ground like this lands in a class that barely exists.
   */
  const SPLIT: ElevationSource = {
    elevationAt: (lng) => (lng > 0 ? (lng - 0) * 111_320 * 0.55 : 0),
  }

  function greenUp(source: ElevationSource) {
    const block = box(-0.008, -0.004, 0.008, 0.004)
    const input: AnalysisInput = {
      viewpoint: { mode: 'spot', coordinates: [[-0.06, 0]] },
      targets: [
        { id: 'block', name: 'block', role: 'block', geometry: block, harvestYear: null, clearcutPercent: null },
      ],
      settings: {
        ...DEFAULT_ANALYSIS_SETTINGS,
        observerHeightMeters: 6000,
        maxViewDistanceMeters: 40000,
        sampleBudget: 900,
      },
      assessmentYear: 2026,
    }
    const target = computeAnalysis(source, input, TERRAIN).targets[0]
    return { slope: target.meanSlopePercent, height: target.vegHeightMeters }
  }

  it('gives flat ground the table floor', () => {
    const { slope, height } = greenUp(FLAT)
    expect(slope).toBeCloseTo(0, 3)
    // Table 6: 0–5% slope needs a 3.0 m tree.
    expect(height).toBeCloseTo(3.0, 5)
  })

  it('weights over the slope classes rather than reading the mean', () => {
    const { slope, height } = greenUp(SPLIT)

    // Half the block is flat and half is around 55%, so the mean lands in the
    // middle of the table while almost no ground is actually there.
    expect(slope).toBeGreaterThan(20)
    expect(slope).toBeLessThan(35)
    expect(vegHeightForSlope(slope!)).toBeGreaterThan(4.5)

    // The area-weighted answer sits between the two classes that exist: 3.0 m
    // over the flat half and 7.5–8.0 m over the steep half.
    expect(height).toBeGreaterThan(4.6)
    expect(height).toBeLessThan(6.2)
    expect(height).not.toBeCloseTo(vegHeightForSlope(slope!), 5)
  })
})

describe('the planimetric denominator', () => {
  const BLOCK = box(-0.004, -0.004, 0.004, 0.004)

  function planimetric(forested: GeoJSON.Polygon[]) {
    const input: AnalysisInput = {
      viewpoint: { mode: 'spot', coordinates: [[-0.06, 0]] },
      targets: [
        {
          id: 'landform',
          name: 'landform',
          role: 'landscape',
          geometry: LANDFORM,
          harvestYear: null,
          clearcutPercent: null,
        },
        { id: 'block', name: 'block', role: 'block', geometry: BLOCK, harvestYear: null, clearcutPercent: null },
      ],
      settings: {
        ...DEFAULT_ANALYSIS_SETTINGS,
        observerHeightMeters: 6000,
        maxViewDistanceMeters: 40000,
        sampleBudget: 900,
      },
      assessmentYear: 2026,
    }
    return computeAnalysis(FLAT, input, TERRAIN, undefined, [], forested)
  }

  it('divides by the whole landform when no inventory answered', () => {
    const result = planimetric([])
    const landform = result.targets.find((target) => target.role === 'landscape')!

    expect(landform.forestedAreaMeters).toBeNull()
    expect(result.landformForestedAreaMeters).toBeNull()
    expect(result.planimetricAlteration!.cumulativePercent).toBeCloseTo(shareOfLandform(BLOCK), 0)
  })

  it('divides by the treed part when the inventory did', () => {
    // Half the landform is treed; the other half is water, rock, or clearing.
    const treedHalf = box(-0.02, -0.01, 0, 0.01)
    const result = planimetric([treedHalf])
    const landform = result.targets.find((target) => target.role === 'landscape')!

    expect(landform.forestedAreaMeters).toBeCloseTo(landform.areaMeters / 2, -4)
    // The block is unchanged, so halving the denominator doubles the figure.
    // Dividing by the whole landform is what read it low.
    expect(result.planimetricAlteration!.cumulativePercent).toBeCloseTo(shareOfLandform(BLOCK) * 2, 0)
  })

  it('leaves the perspective figure alone — it divides by the visible face', () => {
    const treedHalf = box(-0.02, -0.01, 0, 0.01)
    expect(planimetric([treedHalf]).perspectiveAlteration!.cumulativePercent).toBeCloseTo(
      planimetric([]).perspectiveAlteration!.cumulativePercent,
      6,
    )
  })
})
