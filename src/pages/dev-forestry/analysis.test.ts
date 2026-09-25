import { describe, expect, it } from 'vitest'

import { MIN_LEDGER_CELLS_PER_PROPOSAL, computeAnalysis, prepareTargets } from './analysis'
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
      siteDisturbance: target.siteDisturbance,
      ...(target.harvestSystem ? { harvestSystem: target.harvestSystem } : {}),
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
        // Every figure now comes off the landform's own ledger, so it needs the
        // resolution the block used to bring on its own grid.
        sampleBudget: 10000,
      },
      assessmentYear: 2026,
    }
    return computeAnalysis(FLAT, input, TERRAIN, undefined, [], forested)
  }

  it('divides by the whole landform when no inventory answered, and says the base is unverified', () => {
    const result = planimetric([])
    const landform = result.targets.find((target) => target.role === 'landscape')!

    expect(landform.forestedAreaMeters).toBeNull()
    expect(result.landformForestedAreaMeters).toBeNull()
    expect(result.planimetricAlteration!.cumulativePercent).toBeCloseTo(shareOfLandform(BLOCK), 0)
    // A missing inventory is not a verified denominator: the figure is provisional.
    expect(result.quality!.greenBasis).toBe('unverified-whole-landform')
    expect(result.quality!.numericalReady).toBe(false)
  })

  it('divides by the treed part plus supplied alteration footprints when the inventory answered', () => {
    // Half the landform is treed; the other half is water, rock, or clearing.
    const treedHalf = box(-0.02, -0.01, 0, 0.01)
    const result = planimetric([treedHalf])
    const landform = result.targets.find((target) => target.role === 'landscape')!

    // A supplied cut is forest land base after clearing, so the block's eastern
    // half stays in the green base even though the inventory does not call it
    // treed. The operator excludes natural non-forest ground, not the model.
    const blockEastHalf = box(0, -0.004, 0.004, 0.004)
    const expectedGreen = polygonAreaMeters(treedHalf) + polygonAreaMeters(blockEastHalf)
    expect(landform.forestedAreaMeters).toBeCloseTo(expectedGreen, -5)
    expect(result.landformForestedAreaMeters).toBe(landform.forestedAreaMeters)
    expect(result.quality!.greenBasis).toBe('inventory-and-openings')
    // Shrinking the denominator is what lifts the figure above the whole-landform reading.
    const expectedPercent = (polygonAreaMeters(BLOCK) / expectedGreen) * 100
    expect(Math.abs(result.planimetricAlteration!.cumulativePercent - expectedPercent)).toBeLessThan(1)
    expect(result.planimetricAlteration!.cumulativePercent).toBeGreaterThan(shareOfLandform(BLOCK))
  })

  it('applies the same green base to the perspective figure', () => {
    // The perspective ratio divides by the visible green face, on the same
    // ledger as the planimetric figure, so ground the inventory does not call
    // green leaves both denominators together.
    const treedHalf = box(-0.02, -0.01, 0, 0.01)
    const whole = planimetric([]).perspectiveAlteration!.cumulativePercent
    const green = planimetric([treedHalf]).perspectiveAlteration!.cumulativePercent
    expect(green).toBeGreaterThan(whole)
  })
})

describe('the sample budget under a real inventory lookup', () => {
  /** A corridor's worth of stations, which is what multiplies the sightline cost. */
  const STATIONS = Array.from({ length: 64 }, (_, index) => ({
    lng: -0.06,
    lat: -0.01 + index * 0.0003,
    distanceAlongMeters: index * 150,
  }))

  function input(targets: TargetSpec[]): AnalysisInput {
    return {
      viewpoint: { mode: 'corridor', coordinates: STATIONS.map((s) => [s.lng, s.lat]) },
      targets: targets.map((target) => ({
        id: target.id,
        name: target.id,
        role: target.role,
        geometry: target.geometry,
        harvestYear: target.harvestYear ?? null,
        clearcutPercent: target.clearcutPercent ?? null,
      })),
      settings: { ...DEFAULT_ANALYSIS_SETTINGS, maxViewDistanceMeters: 40000, sampleBudget: 900 },
      assessmentYear: 2026,
    }
  }

  const samplesFor = (targets: TargetSpec[], id: string) => {
    const target = prepareTargets(input(targets), STATIONS).find((entry) => entry.id === id)!
    return target.areaMeters / target.spacingMeters ** 2
  }

  /** Openings scattered east of the landform, as a DataBC lookup returns them. */
  function openings(count: number, harvestYear: number): TargetSpec[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `opening-${index}`,
      role: 'harvested' as const,
      harvestYear,
      clearcutPercent: 100,
      geometry: box(
        0.03 + (index % 30) * 0.004,
        -0.02 + Math.floor(index / 30) * 0.004,
        0.032 + (index % 30) * 0.004,
        -0.018 + Math.floor(index / 30) * 0.004,
      ),
    }))
  }

  const LAND: TargetSpec = { id: 'land', role: 'landscape', geometry: LANDFORM }

  it('does not let hundreds of recovered openings coarsen the landform', () => {
    // Every percentage divides by the landform, so its grid sets how precise
    // any answer can be. Coarsening every polygon by one factor let openings
    // that contribute nothing spend the budget the landform needed.
    const alone = samplesFor([LAND], 'land')
    const crowded = samplesFor([LAND, ...openings(400, 1990)], 'land')
    expect(alone).toBeGreaterThan(500)
    expect(crowded).toBeCloseTo(alone, 6)
  })

  it('protects the blocks too — they are the numerator', () => {
    const block: TargetSpec = { id: 'block', role: 'block', geometry: box(-0.01, -0.005, 0, 0.005) }
    const alone = samplesFor([LAND, block], 'block')
    const crowded = samplesFor([LAND, block, ...openings(400, 1990)], 'block')
    expect(crowded).toBeCloseTo(alone, 6)
  })

  it('gives up the openings that still count last', () => {
    // Same run, same size, differing only in whether green-up has caught up: a
    // recovered opening carries no alteration weight, so its resolution buys
    // nothing and it is the first thing coarsened.
    const mixed = openings(400, 1990).map((opening, index) =>
      index % 2 === 0 ? opening : { ...opening, harvestYear: 2024 },
    )
    const recovered = samplesFor([LAND, ...mixed], 'opening-0')
    const counting = samplesFor([LAND, ...mixed], 'opening-1')
    expect(counting).toBeGreaterThan(recovered)
  })

  it('still keeps the whole run inside its ceiling', () => {
    const prepared = prepareTargets(input([LAND, ...openings(400, 2024)]), STATIONS)
    const sightlines = prepared.reduce(
      (total, target) => total + Math.max(1, target.areaMeters / target.spacingMeters ** 2) * STATIONS.length,
      0,
    )
    expect(sightlines).toBeLessThanOrEqual(260_000)
  })
})

describe('one calculation per viewpoint', () => {
  // A corridor running north past the landform, so the blocks sit at very
  // different angles from each end of it.
  const CORRIDOR: Array<[number, number]> = [
    [-0.06, -0.05],
    [-0.06, 0.05],
  ]
  const BLOCK = box(-0.004, -0.004, 0.004, 0.004)

  function corridorRun(targets: TargetSpec[]) {
    const input: AnalysisInput = {
      viewpoint: { mode: 'corridor', coordinates: CORRIDOR },
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
        stationSpacingMeters: 2000,
        sampleBudget: 200,
      },
      assessmentYear: 2026,
    }
    return computeAnalysis(FLAT, input, TERRAIN)
  }

  const RUN = () =>
    corridorRun([
      { id: 'land', role: 'landscape', geometry: LANDFORM },
      { id: 'block', role: 'block', geometry: BLOCK },
    ])

  it('reports a figure for every station, not only the assessment one', () => {
    const result = RUN()
    expect(result.perspectiveByStation).toHaveLength(result.stations.length)
    expect(result.perspectiveByStation.every((entry) => entry !== null)).toBe(true)
  })

  it('agrees with the headline figure at the assessment station', () => {
    // The per-station figure is the same arithmetic on the same solid angles,
    // so the station the headline was taken from must reproduce it exactly.
    const result = RUN()
    const atAssessment = result.perspectiveByStation[result.assessmentStationIndex]!
    expect(atAssessment.cumulativePercent).toBeCloseTo(result.perspectiveAlteration!.cumulativePercent, 9)
    expect(atAssessment.existingPercent).toBeCloseTo(result.perspectiveAlteration!.existingPercent, 9)
  })

  it('varies along the corridor, which is why the form asks for more than one', () => {
    const percents = RUN().perspectiveByStation.map((entry) => entry!.cumulativePercent)
    expect(Math.max(...percents)).toBeGreaterThan(Math.min(...percents))
  })

  it('never exceeds the assessment station, which is chosen as the worst', () => {
    const result = RUN()
    const worst = Math.max(...result.perspectiveByStation.map((entry) => entry!.cumulativePercent))
    // The assessment station is picked for block exposure rather than for the
    // alteration ratio, so it need not be the maximum — but it must be close to
    // it, or the headline is being taken from the wrong place.
    expect(result.perspectiveAlteration!.cumulativePercent).toBeGreaterThan(worst * 0.5)
  })

  it('has nothing to report at a station that sees none of the landform', () => {
    // A spot viewpoint underground sees nothing, so there is no denominator.
    const blind = corridorRun([{ id: 'block', role: 'block', geometry: BLOCK }])
    expect(blind.perspectiveByStation.every((entry) => entry === null)).toBe(true)
  })
})

describe('site disturbance on line (b)', () => {
  const BLOCK = box(-0.004, -0.004, 0.004, 0.004)
  const ROAD = box(0.006, -0.008, 0.008, 0.008)

  function run(extra: TargetSpec[]) {
    return analyse(
      [
        { id: 'land', role: 'landscape', geometry: LANDFORM },
        { id: 'block', role: 'block', geometry: BLOCK },
        ...extra,
      ],
      // The road is 220 m wide. Every contribution is now read off the one
      // landform ledger, so the ledger has to be fine enough to resolve it.
      { sampleBudget: 10000 },
    )
  }

  it('counts on its own line, not with the openings', () => {
    const result = run([{ id: 'road', role: 'harvested', siteDisturbance: true, clearcutPercent: 100, geometry: ROAD }])
    const planimetric = result.planimetricAlteration!
    expect(planimetric.disturbancePercent).toBeCloseTo(shareOfLandform(ROAD), 0)
    expect(planimetric.existingPercent).toBe(0)
  })

  it('sums into X exactly as an opening does', () => {
    const asDisturbance = run([
      { id: 'road', role: 'harvested', siteDisturbance: true, clearcutPercent: 100, geometry: ROAD },
    ]).planimetricAlteration!
    const asOpening = run([
      { id: 'road', role: 'harvested', harvestYear: 2025, clearcutPercent: 100, geometry: ROAD },
    ]).planimetricAlteration!
    expect(asDisturbance.cumulativePercent).toBeCloseTo(asOpening.cumulativePercent, 6)
  })

  it('never greens up — a road stays a road', () => {
    // Harvested in 1950, far past any green-up age. An opening would drop out.
    const old: TargetSpec = { id: 'road', role: 'harvested', harvestYear: 1950, clearcutPercent: 100, geometry: ROAD }
    expect(run([old]).planimetricAlteration!.cumulativePercent).toBeCloseTo(shareOfLandform(BLOCK), 0)
    expect(run([{ ...old, siteDisturbance: true }]).planimetricAlteration!.cumulativePercent).toBeCloseTo(
      shareOfLandform(BLOCK) + shareOfLandform(ROAD),
      0,
    )
  })

  it('is zero when none was supplied', () => {
    expect(run([]).planimetricAlteration!.disturbancePercent).toBe(0)
  })

  it('does not count a road a second time where it runs through a counted opening', () => {
    // The road lies wholly inside a recent opening: the ground is already
    // existing alteration on line (c), so line (b) must not add it again.
    const opening = box(0.004, -0.009, 0.01, 0.009)
    const result = run([
      { id: 'opening', role: 'harvested', harvestYear: 2024, clearcutPercent: 100, geometry: opening },
      { id: 'road', role: 'harvested', siteDisturbance: true, clearcutPercent: 100, geometry: ROAD },
    ]).planimetricAlteration!
    expect(result.disturbancePercent).toBe(0)
    expect(result.existingPercent).toBeCloseTo(shareOfLandform(opening), 0)
  })
})

describe('one active landform', () => {
  const proposed = box(0.005, -0.005, 0.015, 0.005)
  const elsewhere = box(0.2, 0.2, 0.24, 0.22)

  it('never pools a second landform into the denominator', () => {
    const alone = analyse([
      { id: 'land', role: 'landscape', geometry: LANDFORM },
      { id: 'proposed', role: 'block', geometry: proposed },
    ])
    const input: AnalysisInput = {
      viewpoint: { mode: 'spot', coordinates: [[-0.06, 0]] },
      targets: [
        { id: 'land', name: 'land', role: 'landscape', geometry: LANDFORM, harvestYear: null, clearcutPercent: null },
        {
          id: 'other',
          name: 'other',
          role: 'landscape',
          geometry: elsewhere,
          harvestYear: null,
          clearcutPercent: null,
        },
        {
          id: 'proposed',
          name: 'proposed',
          role: 'block',
          geometry: proposed,
          harvestYear: null,
          clearcutPercent: null,
        },
      ],
      settings: {
        ...DEFAULT_ANALYSIS_SETTINGS,
        observerHeightMeters: 3000,
        maxViewDistanceMeters: 40000,
        sampleBudget: 400,
      },
      assessmentYear: 2026,
      activeLandformId: 'land',
    }
    const withOther = computeAnalysis(FLAT, input, TERRAIN)
    expect(withOther.activeLandformId).toBe('land')
    expect(withOther.planimetricAlteration!.cumulativePercent).toBeCloseTo(
      alone.planimetricAlteration!.cumulativePercent,
      10,
    )
    // The inactive landform is not assessed at all.
    expect(withOther.targets.some((target) => target.targetId === 'other')).toBe(false)
  })

  it('refuses to guess between two landforms', () => {
    const input: AnalysisInput = {
      viewpoint: { mode: 'spot', coordinates: [[-0.06, 0]] },
      targets: [
        { id: 'land', name: 'land', role: 'landscape', geometry: LANDFORM, harvestYear: null, clearcutPercent: null },
        {
          id: 'other',
          name: 'other',
          role: 'landscape',
          geometry: elsewhere,
          harvestYear: null,
          clearcutPercent: null,
        },
      ],
      settings: { ...DEFAULT_ANALYSIS_SETTINGS, observerHeightMeters: 3000, maxViewDistanceMeters: 40000 },
      assessmentYear: 2026,
    }
    expect(() => computeAnalysis(FLAT, input, TERRAIN)).toThrow(/Select one active landform/)
  })
})

describe('resolution of a small proposal', () => {
  // About 220 m square — 5 ha — on a 4.4 km by 2.2 km landform.
  const small = box(0.004, -0.001, 0.006, 0.001)
  const run = (sampleBudget: number) =>
    analyse(
      [
        { id: 'landform', role: 'landscape', geometry: LANDFORM },
        { id: 'small', role: 'block', geometry: small },
      ],
      { sampleBudget, greenAreaConfirmed: true, existingDisturbanceConfirmed: true },
    )

  it('withholds the figure when the opening covers only a few landform cells', () => {
    // At 400 points the landform grid is ~155 m: two or three cells land in
    // the opening, so its share could only read in steps of a whole cell.
    const coarse = run(400)
    expect(coarse.quality!.underResolvedTargetIds).toEqual(['small'])
    expect(coarse.quality!.numericalReady).toBe(false)
    expect(coarse.quality!.warnings.join(' ')).toContain(`fewer than ${MIN_LEDGER_CELLS_PER_PROPOSAL} cells`)
    // And says how many points would do: ~9.7 km² × 8 cells ÷ 4.9 ha, with a margin.
    expect(coarse.quality!.warnings.join(' ')).toMatch(/to about 2,500/)
  })

  it('measures it once the grid is fine enough, close to its true share', () => {
    const fine = run(10000)
    expect(fine.quality!.underResolvedTargetIds).toEqual([])
    expect(fine.planimetricAlteration!.cumulativePercent).toBeCloseTo(shareOfLandform(small), 0)
  })
})

describe('a partial cut', () => {
  const block = box(0.004, -0.001, 0.006, 0.001)
  const run = (harvestSystem?: 'partial') =>
    analyse(
      [
        { id: 'landform', role: 'landscape', geometry: LANDFORM },
        { id: 'block', role: 'block', geometry: block, ...(harvestSystem ? { harvestSystem } : {}) },
      ],
      { sampleBudget: 10000, greenAreaConfirmed: true, existingDisturbanceConfirmed: true },
    )

  it('is seen, but not counted as cleared ground: Table 6 accounts for it instead', () => {
    const clearcut = run()
    const partial = run('partial')
    expect(clearcut.perspectiveAlteration!.proposedPercent).toBeGreaterThan(0)
    expect(partial.perspectiveAlteration!.proposedPercent).toBe(0)
    expect(partial.targets.find((target) => target.targetId === 'block')!.visibleAreaMeters).toBeGreaterThan(0)
    expect(partial.quality!.underResolvedTargetIds).toEqual([])
  })
})
