import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { newCrossingCostItem, synchronizeCrossingRecords } from './crossingPlan'
import {
  costBreakdownRows,
  PERCENTAGE_OF_SUBTOTAL,
  ROAD_WIDE_LUMP_SUM,
  SHARED_CROSSING_COSTS,
} from './costBreakdownRows'
import {
  attributeCosts,
  COST_INTENSITY_BINS,
  costIntensityClasses,
  costStretches,
  rankStretches,
  type CostAttribution,
  type CostInterval,
} from './costAttribution'
import type { CrossingCostItem } from './crossingPlanTypes'
import type {
  Alignment,
  ContextFeature,
  Coordinate,
  GroundMaterial,
  RoadAnalysis,
  RoadSettings,
  RoadTemplate,
  TerrainSource,
} from './types'

const origin: Coordinate = [-122.8, 53.9]
const xy = (x: number, y: number): Coordinate => offsetCoordinate(offsetCoordinate(origin, 90, x), 0, y)
const northing = (p: Coordinate) => (((p[1] - origin[1]) * Math.PI) / 180) * 6371008.8
const flat: TerrainSource = { elevationAt: () => 800 }
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 0.8,
}
const template: RoadTemplate = {
  leftWidth: 3,
  rightWidth: 3,
  crossfallPercent: 0,
  cutSlope: 1,
  fillSlope: 1,
  ditchWidth: 0,
  ditchDepth: 0,
  surfaceDepth: 0.3,
}
/** 100 m due north, from `start` m to `end` m elevation over flat ground at 800 m: cut, then fill. */
function road(start = 798, end = 802, engineering = true): Alignment {
  return {
    id: 'road',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: xy(0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: start, curveLength: 0 },
      { id: 'e', chainage: 100, elevation: end, curveLength: 0 },
    ],
    template,
    overrides: [],
    ...(engineering ? { engineering: createEngineeringDesign() } : {}),
  }
}
const stream = (id: string, y: number): ContextFeature => ({
  id,
  name: id,
  kind: 'stream',
  geometry: { type: 'LineString', coordinates: [xy(-30, y), xy(30, y)] },
})
const context = [stream('creek', 25)]
const item = (id: string, rate: number): CrossingCostItem => ({
  ...newCrossingCostItem(id),
  unitRate: rate,
  source: 'Synthetic test quote',
  sourceUrl: 'https://example.com/quote',
  priceDate: '2026-11-07',
})
/** The road with a priced, reviewed record for each stream crossing it makes. */
function withCrossings(a: Alignment, terrain: TerrainSource = flat): Alignment {
  const crossings = analyzeRoad(a, terrain, settings, context).crossings
  return {
    ...a,
    crossingRecords: synchronizeCrossingRecords(a, crossings, context).map((record) => ({
      ...record,
      structure: 'bridge',
      evidence: 'Site review fixture',
      items: [item(`${record.id}-price`, 4000)],
    })),
  }
}

function attribute(a: Alignment, analysis: RoadAnalysis, s: RoadSettings = settings) {
  const breakdown = costBreakdownRows({ analysis, alignment: a, settings: s })
  return { breakdown, attribution: attributeCosts({ analysis, alignment: a, breakdown }) }
}

/** Every row's placed amounts plus its unplaced amount are its amount; the rows are the total. */
function expectConserved(attribution: CostAttribution, analysis: RoadAnalysis) {
  const close = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(expected)))
  for (const row of attribution.rows) {
    const placed = row.placed.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    close(placed, row.placedTotal)
    close(placed + row.unplaced, row.amount)
    expect(row.placed).toHaveLength(attribution.intervals.length)
    expect(row.quantity).toHaveLength(attribution.intervals.length)
    if (Math.abs(row.unplaced) > 1e-6) expect(row.unplacedReason).toBeTruthy()
  }
  close(attribution.totalAmount, analysis.estimatedCost)
  close(attribution.placedTotal + attribution.unplacedTotal, analysis.estimatedCost)
  close(
    attribution.total.reduce((sum, value) => sum + value, 0),
    attribution.placedTotal,
  )
}

const row = (attribution: CostAttribution, id: string) => attribution.rows.find((r) => r.rowId === id)!
const intervalEndingAt = (attribution: CostAttribution, chainage: number) =>
  attribution.intervals.findIndex((interval) => Math.abs(interval.end - chainage) < 1e-6)
/** The documented rule: the first interval ending at or after the chainage. */
const intervalContaining = (attribution: CostAttribution, chainage: number) =>
  attribution.intervals.findIndex((interval) => interval.end >= chainage - 1e-9)
const sumOf = (values: (number | null)[]) => values.reduce<number>((sum, value) => sum + (value ?? 0), 0)

describe('cost rows', () => {
  it('lists the plain rows with stable ids and adds priced crossings, so the rows are the total', () => {
    const a = withCrossings(road(798, 802, false))
    const analysis = analyzeRoad(a, flat, settings, context)
    const { breakdown } = attribute(a, analysis)
    expect(breakdown.rows.map((r) => r.id)).toEqual(['cut', 'fill', 'surfacing', 'clearing', 'structures'])
    expect(breakdown.rows.at(-1)).toMatchObject({ item: 'Stream crossings', quantity: 1, amount: 4000 })
    expect(breakdown.rows.reduce((sum, r) => sum + r.amount, 0)).toBeCloseTo(analysis.estimatedCost, 6)
    expect(breakdown.contingency).toBeUndefined()
    // Without crossings the plain dialog is exactly the four rows it always was.
    const bare = road(798, 802, false)
    expect(attribute(bare, analyzeRoad(bare, flat, settings)).breakdown.rows.map((r) => r.id)).toEqual([
      'cut',
      'fill',
      'surfacing',
      'clearing',
    ])
  })

  it('names which input each rate edits, and leaves out what the dialog cannot edit', () => {
    const a = road()
    a.engineering!.materials = [
      { id: 'soil', name: 'Soil', color: '#987', cutRate: 5, reusableFraction: 1, compactionFactor: 1 },
    ]
    a.engineering!.strata = [{ id: 'all', materialId: 'soil', start: 0, end: 100, topDepthM: 0, bottomDepthM: null }]
    const analysis = analyzeRoad(a, flat, settings)
    const editable = costBreakdownRows({ analysis, alignment: a, settings })
    expect(editable.rows.find((r) => r.id === 'material-soil')!.rate!.edit).toEqual({
      kind: 'material',
      materialId: 'soil',
    })
    expect(editable.rows.find((r) => r.id === 'clearing')!.rate!.edit).toEqual({ kind: 'setting', key: 'clearingRate' })
    expect(editable.contingency!.rate!.edit).toEqual({ kind: 'haul', key: 'contingencyPercent' })
    const readOnly = costBreakdownRows({
      analysis,
      alignment: a,
      settings,
      editable: { haul: false, materialRate: false },
    })
    expect(readOnly.rows.find((r) => r.id === 'material-soil')!.rate).toBeUndefined()
    expect(readOnly.rows.find((r) => r.id === 'mobilization')!.rate).toBeUndefined()
    expect(readOnly.contingency!.rate).toBeUndefined()
  })
})

describe('cost attribution', () => {
  it('spreads a plain road by its own section quantities and places a crossing where it is', () => {
    const a = withCrossings(road(798, 802, false))
    const analysis = analyzeRoad(a, flat, settings, context)
    const { attribution } = attribute(a, analysis)
    expectConserved(attribution, analysis)
    expect(attribution.unplacedTotal).toBeCloseTo(0, 9)
    // Cut by the interval's cut volume: the rate times the volume, interval by interval.
    const cut = row(attribution, 'cut')
    attribution.intervals.forEach((interval, k) => {
      expect(cut.quantity[k]).toBeCloseTo(analysis.stations[interval.stationIndex].cutVolumeM3!, 9)
      expect(cut.placed[k]).toBeCloseTo(analysis.stations[interval.stationIndex].cutVolumeM3! * settings.cutRate, 6)
    })
    expect(row(attribution, 'clearing').driverLabel).toBe('m² cleared')
    expect(sumOf(row(attribution, 'clearing').quantity)).toBeCloseTo(analysis.clearingAreaM2, 6)
    // The crossing at 25 m is placed whole in the interval containing it.
    const crossing = row(attribution, 'structures')
    const at = analysis.crossings[0].chainage
    expect(at).toBeCloseTo(25, 3)
    const k = intervalContaining(attribution, at)
    expect(attribution.intervals[k].start).toBeLessThan(at)
    expect(crossing.placed[k]).toBe(4000)
    expect(sumOf(crossing.placed)).toBe(4000)
  })

  it('traces an engineering road: materials, haul ends, sites, culverts, crossings and road-wide lines', () => {
    const base = road()
    base.engineering!.materials = [
      { id: 'soil', name: 'Soil', color: '#987', cutRate: 5, reusableFraction: 0.5, compactionFactor: 1 },
    ]
    base.engineering!.strata = [{ id: 'all', materialId: 'soil', start: 0, end: 100, topDepthM: 0, bottomDepthM: null }]
    Object.assign(base.engineering!.haul, {
      enabled: true,
      freeHaulDistanceM: 25,
      overhaulDistanceM: 70,
      freeHaulRate: 1,
      overhaulRate: 2,
      endHaulRate: 3,
      freeHaulLoadingRate: 0.5,
      overhaulLoadingRate: 0.7,
      endHaulLoadingRate: 0.9,
      borrowRate: 6,
      wasteRate: 4,
      mobilizationCost: 1500,
      contingencyPercent: 10,
    })
    base.engineering!.sites = [
      {
        id: 'w',
        name: 'Spoil',
        kind: 'waste',
        chainage: 10,
        accessDistanceM: 40,
        capacityM3: 50,
        unitRate: 2,
        fixedCost: 300,
      },
    ]
    base.engineering!.culverts = [
      {
        id: 'c1',
        name: 'Cross drain',
        chainage: 50,
        skewDegrees: 0,
        lengthM: 12,
        diameterM: 0.6,
        inletInvertM: 799,
        outletInvertM: 798.88,
        minCoverM: 0.5,
        unitCost: 100,
        fixedCost: 500,
      },
    ]
    const a = withCrossings(base)
    const shared = [item('mobilize-crane', 900)]
    const analysis = analyzeRoad(a, flat, settings, context, { sharedCrossingCosts: shared })
    const e = analysis.engineering!
    expect(e.movements.length).toBeGreaterThan(1)
    const { breakdown, attribution } = attribute(a, analysis)
    expect(breakdown.rows.reduce((sum, r) => sum + r.amount, 0)).toBeCloseTo(breakdown.subtotal!, 6)
    expectConserved(attribution, analysis)

    // A material's bank cut per interval is the engine's: it adds up to the row's quantity.
    const soil = row(attribution, 'material-soil')
    expect(sumOf(soil.quantity)).toBeCloseTo(e.materials.find((m) => m.materialId === 'soil')!.bankCutM3, 6)
    expect(soil.unplaced).toBe(0)

    // Loading is charged on volume: each movement's half lands at each of its ends.
    for (const r of breakdown.rows.filter((x) => x.driver.kind === 'haul' && x.id.startsWith('loading-'))) {
      const rate = r.rate!.value
      const expected = attribution.intervals.map(() => 0)
      const [, category, basis] = r.id.split('-')
      for (const m of e.movements) {
        if (m.disposalMethod === 'sidecast' || m.category !== category || m.volumeBasis !== basis) continue
        for (const end of [
          [m.sourceId, m.fromChainage],
          [m.targetId, m.toChainage],
        ] as const) {
          const match = /^interval-(\d+)$/.exec(end[0])
          const k = match
            ? Number(match[1]) - 1
            : attribution.intervals.findIndex((interval) => interval.end >= end[1] - 1e-9)
          expected[k] += (m.transportedVolumeM3 / 2) * rate
        }
      }
      const placed = row(attribution, r.id).placed
      expected.forEach((value, k) => expect(placed[k]).toBeCloseTo(value, 6))
    }

    // The waste site's disposal and preparation sit at its chainage, 10 m: the first interval.
    expect(row(attribution, 'site-w').placed[0]).toBe(300)
    expect(row(attribution, 'waste-w').placed[0]).toBeCloseTo(row(attribution, 'waste-w').amount, 9)
    // Unallocated borrow follows the intervals short of fill: the fill end of the road.
    const borrow = row(attribution, 'borrow-unallocated')
    expect(sumOf(borrow.placed.slice(0, 5))).toBeCloseTo(0, 6)
    expect(sumOf(borrow.placed.slice(5))).toBeCloseTo(borrow.amount, 6)

    // The culvert at 50 m is on a station: it goes to the interval ending there. The crossing at
    // 25 m to the interval containing it, and the shared crossing cost has no place.
    const structures = row(attribution, 'structures')
    const culvert = e.culverts[0]
    expect(structures.placed[intervalEndingAt(attribution, 50)]).toBeCloseTo(culvert.installedCost, 9)
    expect(structures.placed[intervalContaining(attribution, analysis.crossings[0].chainage)]).toBe(4000)
    expect(structures.unplaced).toBeCloseTo(900, 9)
    expect(structures.unplacedReason).toBe(SHARED_CROSSING_COSTS)
    expect(structures.amount).toBeCloseTo(culvert.installedCost + 4000 + 900, 9)

    expect(row(attribution, 'mobilization')).toMatchObject({
      unplaced: 1500,
      unplacedReason: ROAD_WIDE_LUMP_SUM,
      placedTotal: 0,
    })
    const contingency = row(attribution, 'contingency')
    expect(contingency.unplaced).toBeCloseTo(e.costs.contingency, 9)
    expect(contingency.unplacedReason).toBe(PERCENTAGE_OF_SUBTOTAL)
    expect(attribution.unplacedTotal).toBeCloseTo(1500 + 900 + e.costs.contingency, 6)
  })

  it('leaves incomplete intervals unknown, never zero, and out of every share', () => {
    const a = road(796, 796)
    a.engineering!.materials = [
      { id: 'soil', name: 'Soil', color: '#987', cutRate: 5, reusableFraction: 1, compactionFactor: 1 },
    ]
    a.engineering!.strata = [{ id: 'all', materialId: 'soil', start: 0, end: 100, topDepthM: 0, bottomDepthM: null }]
    a.engineering!.culverts = [
      {
        id: 'c1',
        name: 'In the gap',
        chainage: 45,
        skewDegrees: 0,
        lengthM: 12,
        diameterM: 0.6,
        inletInvertM: 795,
        outletInvertM: 794.88,
        minCoverM: 0.5,
        unitCost: 100,
        fixedCost: 500,
      },
    ]
    const hole: TerrainSource = {
      elevationAt: (lng, lat) => {
        const s = northing([lng, lat])
        return s > 39 && s < 61 ? NaN : 800
      },
    }
    const analysis = analyzeRoad(a, hole, settings)
    expect(analysis.coveragePercent).toBeLessThan(100)
    const { attribution } = attribute(a, analysis)
    expectConserved(attribution, analysis)
    const unknown = attribution.intervals.flatMap((interval, k) => (interval.complete ? [] : [k]))
    expect(unknown.length).toBeGreaterThan(0)
    for (const id of ['material-soil', 'fill', 'surfacing', 'clearing']) {
      const r = row(attribution, id)
      for (const k of unknown) {
        expect(r.placed[k]).toBeNull()
        expect(r.quantity[k]).toBeNull()
      }
      expect(r.unplaced).toBe(0)
    }
    // The cut's amount is all on the known intervals, in proportion to their cut.
    const soil = row(attribution, 'material-soil')
    expect(soil.placedTotal).toBeCloseTo(soil.amount, 6)
    // A located item in the gap is still placed; the interval's total is then a lower bound.
    const k = attribution.intervals.findIndex((interval) => interval.end >= 45)
    expect(unknown).toContain(k)
    expect(row(attribution, 'structures').placed[k]).toBeGreaterThan(0)
    expect(attribution.total[k]).toBeCloseTo(row(attribution, 'structures').placed[k]!, 9)
    const intensity = costIntensityClasses(attribution, 'total')
    for (const j of unknown) {
      expect(intensity.classes[j]).toBe('unknown')
      expect(intensity.perMetre[j]).toBeNull()
    }
    const stretches = costStretches(attribution, 'material-soil', 50)
    expect(stretches.map((s) => s.unknownM)).toEqual([expect.any(Number), expect.any(Number)])
    expect(stretches[0].unknownM + stretches[1].unknownM).toBeCloseTo(
      unknown.reduce((sum, j) => sum + attribution.intervals[j].lengthM, 0),
      9,
    )
  })

  it('spreads cut on the curvature-corrected basis, rock rows included', () => {
    const soil: GroundMaterial = {
      id: 'soil',
      name: 'Till',
      color: '#a16207',
      cutRate: 5,
      reusableFraction: 1,
      compactionFactor: 1,
    }
    const granite: GroundMaterial = {
      id: 'granite',
      name: 'Granite',
      color: '#6b7280',
      cutRate: 30,
      shallowCutRate: 10,
      overbreakRate: 45,
      reusableFraction: 1,
      compactionFactor: 1.4,
      rock: true,
    }
    // A 10 m deep through cut at 110 m, rock 2 m down, round a 60 m curve.
    const curved = (): Alignment => {
      const engineering = createEngineeringDesign()
      engineering.materials = [soil, granite]
      engineering.strata = [
        { id: 'h-soil', start: 0, end: 400, materialId: 'soil', topDepthM: 0, bottomDepthM: 2 },
        { id: 'h-rock', start: 0, end: 400, materialId: 'granite', topDepthM: 2, bottomDepthM: null },
      ]
      const b = offsetCoordinate(origin, 0, 100)
      return {
        id: 'rock',
        name: 'Rock cut',
        color: '#16817a',
        points: [
          { id: 'a', coordinate: origin, radiusM: 0 },
          { id: 'b', coordinate: b, radiusM: 60 },
          { id: 'c', coordinate: offsetCoordinate(b, 90, 100), radiusM: 0 },
        ],
        vertical: [
          { id: 'a', chainage: 0, elevation: 100, curveLength: 0 },
          { id: 'b', chainage: 300, elevation: 100, curveLength: 0 },
        ],
        template: {
          ...template,
          surfaceDepth: 0,
          rightRockCut: { cutSlope: 0.25, blastDepthM: 0.75, shallowDepthM: 1 },
        },
        overrides: [],
        engineering,
      }
    }
    const ground110 = { elevationAt: () => 110 }
    const rockSettings = { ...settings, shrinkFactor: 1 }
    for (const correction of [undefined, 'apply'] as const) {
      const s = { ...rockSettings, ...(correction ? { curvatureCorrection: correction } : {}) }
      const a = curved()
      const analysis = analyzeRoad(a, ground110, s)
      expect(analysis.curvatureCorrection?.applied === true).toBe(correction === 'apply')
      const { attribution } = attribute(a, analysis, s)
      expectConserved(attribution, analysis)
      const rock = analysis.engineering!.materials.find((m) => m.materialId === 'granite')!
      expect(rock.rock!.shallowBankM3).toBeGreaterThan(0)
      expect(rock.rock!.overbreakBankM3).toBeGreaterThan(0)
      // Each row's interval quantities add up to the row's own quantity: the same basis as its total.
      expect(sumOf(row(attribution, 'material-granite').quantity)).toBeCloseTo(
        rock.bankCutM3 - rock.rock!.shallowBankM3,
        6,
      )
      expect(sumOf(row(attribution, 'material-granite-shallow').quantity)).toBeCloseTo(rock.rock!.shallowBankM3, 6)
      expect(sumOf(row(attribution, 'material-granite-overbreak').quantity)).toBeCloseTo(rock.rock!.overbreakBankM3, 6)
      expect(sumOf(row(attribution, 'material-soil').quantity)).toBeCloseTo(
        analysis.engineering!.materials.find((m) => m.materialId === 'soil')!.bankCutM3,
        6,
      )
      expect(sumOf(row(attribution, 'fill').quantity)).toBeCloseTo(analysis.fillVolumeM3, 6)
    }
  })
})

describe('stretches and intensity', () => {
  // Eleven 10 m intervals. Known: costs per metre at 0.25, 0.75, 1.5, 3 and 4.5 times 10 $/m and
  // five that cost nothing, so the road's average is exactly 10 $/m. The last is incomplete.
  const amounts = [25, 75, 150, 300, 450, 0, 0, 0, 0, 0, 500]
  const intervals: CostInterval[] = amounts.map((_, k) => ({
    stationIndex: k + 1,
    start: k * 10,
    end: (k + 1) * 10,
    lengthM: 10,
    complete: k < 10,
  }))
  const placedTotal = amounts.reduce((sum, value) => sum + value, 0)
  const synthetic: CostAttribution = {
    intervals,
    rows: [
      {
        rowId: 'fill',
        label: 'Fill placement',
        amount: 1000,
        placed: amounts.map((value, k) => (k < 10 ? value : null)),
        placedTotal: 1000,
        unplaced: 0,
        driverLabel: 'm³',
        quantity: amounts.map((value, k) => (k < 10 ? value / 3 : null)),
      },
    ],
    total: amounts,
    totalAmount: placedTotal,
    placedTotal,
    unplacedTotal: 0,
  }

  it('classes cost per metre against the road average over its known length', () => {
    const intensity = costIntensityClasses(synthetic, 'total')
    expect(intensity.averagePerMetre).toBeCloseTo(10, 12)
    expect(intensity.classes).toEqual([0, 1, 2, 3, 4, 'none', 'none', 'none', 'none', 'none', 'unknown'])
    expect(intensity.perMetre.slice(0, 5)).toEqual([2.5, 7.5, 15, 30, 45])
    expect(COST_INTENSITY_BINS.map((bin) => [bin.minRatio, bin.maxRatio])).toEqual([
      [0, 0.5],
      [0.5, 1],
      [1, 2],
      [2, 4],
      [4, Infinity],
    ])
    expect(COST_INTENSITY_BINS.every((bin) => bin.label.length > 0)).toBe(true)
    // A row's unknown intervals are its nulls.
    expect(costIntensityClasses(synthetic, 'fill').classes.at(-1)).toBe('unknown')
    expect(() => costIntensityClasses(synthetic, 'nope')).toThrow(RangeError)
  })

  it('splits intervals across fixed-length stretches by length and keeps the sum', () => {
    const stretches = costStretches(synthetic, 'fill', 25)
    expect(stretches.map((s) => [s.start, s.end])).toEqual([
      [0, 25],
      [25, 50],
      [50, 75],
      [75, 100],
      [100, 110],
    ])
    // 0–25 m: 25 + 75 + half of 150.
    expect(stretches[0].amount).toBeCloseTo(175, 9)
    expect(stretches[0].quantity).toBeCloseTo(175 / 3, 9)
    expect(stretches[0].share).toBeCloseTo(0.175, 9)
    expect(stretches[1].amount).toBeCloseTo(75 + 300 + 450, 9)
    expect(stretches[1].peakChainage).toBe(50)
    expect(stretches[1].peakStationIndex).toBe(5)
    expect(stretches[3]).toMatchObject({ amount: 0, peakChainage: null, unknownM: 0 })
    expect(stretches[4].unknownM).toBe(10)
    expect(stretches.reduce((sum, s) => sum + s.amount, 0)).toBeCloseTo(1000, 9)
    expect(rankStretches(stretches, 2).map((s) => s.start)).toEqual([25, 0])
    expect(rankStretches(stretches).every((s) => s.amount > 0)).toBe(true)
    // The total keeps the incomplete interval's located part.
    expect(costStretches(synthetic, 'total', 25).reduce((sum, s) => sum + s.amount, 0)).toBeCloseTo(placedTotal, 9)
    expect(() => costStretches(synthetic, 'total', 0)).toThrow(RangeError)
  })
})
