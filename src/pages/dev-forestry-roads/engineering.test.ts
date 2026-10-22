import { describe, expect, it } from 'vitest'
import { COMPLETE_COVERAGE_PERCENT, hasCompleteCoverage } from './analysisResult'
import {
  alignmentLength,
  analyzeRoad,
  distance,
  horizontalCurveSummary,
  nearestStation,
  offsetCoordinate,
  verticalCurveSummary,
} from './engine'
import { haulCostLines, haulUnitCost } from './engineering'
import { createEngineeringDesign, DEFAULT_HAUL_SETTINGS } from './engineeringTypes'
import {
  sideValue,
  templateAt,
  templateFromStarter,
  validateEngineering,
  validateTemplate,
  type TemplateStarter,
} from './templates'
import type {
  Alignment,
  AlignmentEngineering,
  ContextFeature,
  Coordinate,
  Culvert,
  RoadSettings,
  RoadTemplate,
  TerrainSource,
} from './types'

const origin: Coordinate = [-122.8, 53.9]
const north = (m: number) => offsetCoordinate(origin, 0, m)
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
function road(height = 798, length = 100): Alignment {
  return {
    id: 'road',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: north(length), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: height, curveLength: 0 },
      { id: 'e', chainage: length, elevation: height, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0,
    },
    overrides: [],
    engineering: createEngineeringDesign(),
  }
}
function culvert(overrides: Partial<Culvert> = {}): Culvert {
  return {
    id: 'c1',
    name: 'Cross drain',
    chainage: 50,
    skewDegrees: 0,
    lengthM: 12,
    diameterM: 0.6,
    inletInvertM: 800,
    outletInvertM: 799.88,
    minCoverM: 0.5,
    unitCost: 100,
    fixedCost: 500,
    ...overrides,
  }
}

describe('resolved station templates', () => {
  it('preserves existing outputs when optional engineering is empty and haul is disabled', () => {
    const a = road(),
      withEngineering = analyzeRoad(a, flat, settings)
    delete a.engineering
    const original = analyzeRoad(a, flat, settings)
    expect(withEngineering.cutVolumeM3).toBeCloseTo(original.cutVolumeM3, 8)
    expect(withEngineering.balanceM3).toBeCloseTo(original.balanceM3, 8)
    expect(withEngineering.estimatedCost).toBeCloseTo(original.estimatedCost, 8)
    expect(withEngineering.stations.map((s) => s.massM3)).toEqual(original.stations.map((s) => s.massM3))
    expect(withEngineering.engineering!.haul.enabled).toBe(false)
  })

  it('resolves left-only assignments, real superelevation and taper breakpoints', () => {
    const a = road(800)
    a.engineering!.templates.push({
      id: 'wide',
      name: 'Wide bench',
      template: { ...a.template, leftWidth: 5, rightWidth: 12, leftCrossfallPercent: -10, rightCrossfallPercent: 10 },
    })
    a.engineering!.assignments.push({
      id: 'range',
      templateId: 'wide',
      side: 'left',
      start: 20,
      end: 60,
      transitionM: 10,
    })
    const at = templateAt(a, 25)
    expect(at.template.leftWidth).toBe(4)
    expect(at.template.rightWidth).toBe(3)
    expect(sideValue(at.template, 'left', 'CrossfallPercent')).toBe(-5)
    expect(sideValue(at.template, 'right', 'CrossfallPercent')).toBe(0)
    const result = analyzeRoad(a, flat, { ...settings, stationInterval: 17 })
    expect([20, 30, 50, 60].every((s) => result.stations.some((p) => Math.abs(s - p.chainage) < 1e-6))).toBe(true)
    const middle = result.stations.find((s) => s.chainage === 30)!
    expect(middle.leftWidth).toBe(5)
    expect(middle.rightWidth).toBe(3)
    expect(middle.section.find((p) => p.offset === -5)!.design).toBe(800.5)
    expect(result.engineering!.stations.find((s) => s.chainage === 30)!.template.leftName).toBe('Wide bench')
  })

  it('integrates simultaneous width and depth transitions without trapezoid bias', () => {
    const a = road(800)
    a.template.surfaceDepth = 0.2
    a.engineering!.templates.push({
      id: 'wide',
      name: 'Wide',
      template: { ...a.template, leftWidth: 5, leftSurfaceDepth: 0.4 },
    })
    a.engineering!.assignments.push({
      id: 'range',
      templateId: 'wide',
      side: 'left',
      start: 20,
      end: 60,
      transitionM: 10,
    })
    const result = analyzeRoad(a, flat, settings)
    // Baseline 120; 20m plateau adds 28; each 10m taper integrates r + 0.4 r².
    expect(result.surfaceVolumeM3).toBeCloseTo(120 + 28 + 20 * (0.5 + 0.4 / 3), 5)
  })

  it('does not smear a short stepped assignment across a long ordinary station interval', () => {
    const a = road()
    a.engineering!.templates.push({ id: 'wide', name: 'Wide', template: { ...a.template, leftWidth: 6 } })
    a.engineering!.assignments.push({
      id: 'range',
      templateId: 'wide',
      side: 'left',
      start: 21,
      end: 24,
      transitionM: 0,
    })
    const result = analyzeRoad(a, flat, { ...settings, stationInterval: 100 })
    // Constant two-metre cut: 3m additional width × 2m depth × 3m range.
    expect(result.cutVolumeM3).toBeCloseTo(1618, 3)
  })

  it('rejects same-side overlaps but permits independently assigned left and right sections', () => {
    const a = road()
    a.engineering!.templates.push({ id: 'one', name: 'One', template: { ...a.template } })
    a.engineering!.assignments = [
      { id: 'l', templateId: 'one', start: 0, end: 50, side: 'left', transitionM: 0 },
      { id: 'r', templateId: 'one', start: 0, end: 50, side: 'right', transitionM: 0 },
    ]
    expect(() => analyzeRoad(a, flat, settings)).not.toThrow()
    a.engineering!.assignments[1].side = 'both'
    expect(() => analyzeRoad(a, flat, settings)).toThrow(/overlap on the same side/i)
  })
})

describe('material intersections, mass and cost', () => {
  it('conserves excavation while integrating exact clipped layers through the cut batters', () => {
    const a = road()
    a.engineering!.materials = [
      { id: 'soil', name: 'Soil', color: '#987', cutRate: 5, reusableFraction: 0.5, compactionFactor: 0.8 },
      { id: 'rock', name: 'Rock', color: '#678', cutRate: 10, reusableFraction: 1, compactionFactor: 1.2 },
    ]
    a.engineering!.strata = [
      { id: 'top', materialId: 'soil', start: 0, end: 100, topDepthM: 0, bottomDepthM: 1 },
      { id: 'bottom', materialId: 'rock', start: 0, end: 100, topDepthM: 1, bottomDepthM: null },
    ]
    const r = analyzeRoad(a, flat, settings),
      e = r.engineering!
    const soil = e.materials.find((m) => m.materialId === 'soil')!,
      rock = e.materials.find((m) => m.materialId === 'rock')!
    expect(soil.bankCutM3).toBeCloseTo(900, 4)
    expect(rock.bankCutM3).toBeCloseTo(700, 4)
    expect(e.materials.reduce((sum, m) => sum + m.bankCutM3, 0)).toBeCloseTo(r.cutVolumeM3, 7)
    expect(e.usableCutM3).toBeCloseTo(1200, 4)
    expect(e.unusableCutM3).toBeCloseTo(450, 4)
    expect(r.balanceM3).toBeCloseTo(1200, 4)
    expect(r.stations.at(-1)!.massM3).toBeCloseTo(1200, 4)
    expect(e.costs.cut).toBeCloseTo(11500, 3)
    expect(e.costs.total).toBeCloseTo(12000, 3)
    expect(r.estimatedCost).toBe(e.costs.total)
  })

  it('reports cut-only stripping separately without changing ground or inventing removal beneath fill', () => {
    const a = road()
    a.engineering!.materials = [
      {
        id: 'organic',
        name: 'Surface organic',
        color: '#543',
        cutRate: 4,
        reusableFraction: 0,
        compactionFactor: 1,
        purpose: 'stripping',
      },
    ]
    a.engineering!.strata = [
      { id: 'strip', materialId: 'organic', start: 0, end: 100, topDepthM: 0, bottomDepthM: 0.2 },
    ]
    const r = analyzeRoad(a, flat, settings),
      e = r.engineering!
    expect(e.strippingCutM3).toBeCloseTo(196, 4)
    expect(e.costs.stripping).toBeCloseTo(784, 3)
    expect(e.usableCutM3).toBeCloseTo((1600 - 196) * 0.8, 3)
    expect(e.warnings.join(' ')).toMatch(/No ground removal or replacement fill/)
    a.vertical.forEach((p) => {
      p.elevation = 802
    })
    const filled = analyzeRoad(a, flat, settings)
    expect(filled.fillVolumeM3).toBeCloseTo(1600, 3)
    expect(filled.engineering!.strippingCutM3).toBeCloseTo(0, 8)
    a.engineering!.materials[0].reusableFraction = 0.2
    expect(() => analyzeRoad(a, flat, settings)).toThrow(/Stripping must have zero/)
  })

  it('retains explicit unclassified quantities outside a short station/depth horizon', () => {
    const a = road()
    a.engineering!.materials = [
      { id: 'soil', name: 'Soil', color: '#987', cutRate: 5, reusableFraction: 1, compactionFactor: 1 },
    ]
    a.engineering!.strata = [{ id: 'top', materialId: 'soil', start: 20, end: 40, topDepthM: 0, bottomDepthM: 1 }]
    const e = analyzeRoad(a, flat, { ...settings, stationInterval: 100 }).engineering!
    expect(e.materials.find((m) => m.materialId === 'soil')!.bankCutM3).toBeCloseTo(180, 3)
    expect(e.materials.find((m) => m.materialId === '__unclassified')!.bankCutM3).toBeCloseTo(1420, 3)
    a.engineering!.strata.push({
      id: 'overlap',
      materialId: 'soil',
      start: 30,
      end: 50,
      topDepthM: 0.5,
      bottomDepthM: 2,
    })
    expect(() => analyzeRoad(a, flat, settings)).toThrow(/cannot be counted twice/)
  })

  it('propagates missing sections into material areas and cumulative mass without bridging the gap', () => {
    const a = road()
    const hole: TerrainSource = {
      elevationAt: (lng, lat) => {
        const s = northing([lng, lat])
        return s > 39 && s < 61 ? NaN : 800
      },
    }
    const r = analyzeRoad(a, hole, settings),
      e = r.engineering!
    expect(r.coveragePercent).toBeLessThan(100)
    expect(e.materials.reduce((sum, m) => sum + m.bankCutM3, 0)).toBeCloseTo(r.cutVolumeM3, 6)
    expect(e.stations.find((s) => s.chainage === 50)!.materialAreas.every((m) => m.cutAreaM2 === null)).toBe(true)
    expect(e.stations.at(-1)!.massM3).toBeNull()
    expect(e.stations.at(-1)!.usableCutVolumeM3).toBeGreaterThan(0)
    expect(e.complete).toBe(false)
  })

  it('uses approach-side geology at a route end shared by adjacent horizon ranges', () => {
    const a = road()
    a.engineering!.materials = [
      { id: 'soil', name: 'Soil', color: '#887766', cutRate: 1, reusableFraction: 1, compactionFactor: 1 },
      { id: 'rock', name: 'Rock', color: '#777777', cutRate: 2, reusableFraction: 1, compactionFactor: 1 },
    ]
    a.engineering!.strata = [
      { id: 'before', materialId: 'soil', start: 0, end: 100, topDepthM: 0, bottomDepthM: null },
      { id: 'after', materialId: 'rock', start: 100, end: 200, topDepthM: 0, bottomDepthM: null },
    ]
    const e = analyzeRoad(a, flat, settings).engineering!
    expect(e.materials.find((m) => m.materialId === 'soil')!.bankCutM3).toBeCloseTo(1600, 4)
    expect(e.materials.find((m) => m.materialId === 'rock')!.bankCutM3).toBeCloseTo(0, 8)
    expect(e.stations.at(-1)!.layers.map((l) => l.materialId)).toEqual(['soil'])
  })
})

describe('culvert geometry and cover', () => {
  it('samples an actual barrel, its signed grade, subgrade cover and installed cost', () => {
    const a = road(802)
    a.engineering!.culverts.push(culvert())
    const r = analyzeRoad(a, flat, settings),
      c = r.engineering!.culverts[0]
    expect(distance(c.start, c.end)).toBeCloseTo(12, 5)
    expect(distance(c.profile[0].coordinate, c.start)).toBeLessThan(1e-5)
    expect(distance(c.profile.at(-1)!.coordinate, c.end)).toBeLessThan(1e-5)
    expect(c.requiredLengthM).toBeCloseTo(10, 4)
    expect(c.gradePercent).toBeCloseTo(-1, 7)
    expect(c.coverM).toBeCloseTo(1.43, 4)
    expect(c.barrelLengthM).toBeCloseTo(Math.hypot(12, 0.12), 8)
    expect(c.barrelInternalVolumeM3).toBeCloseTo(((Math.PI * 0.6 ** 2) / 4) * Math.hypot(12, 0.12), 8)
    expect(c.installedCost).toBeCloseTo(Math.hypot(12, 0.12) * 100 + 500, 8)
    expect(c.complete).toBe(true)
    expect(c.warnings).toEqual([])
    expect(r.engineering!.costs.structures).toBeCloseTo(Math.hypot(12, 0.12) * 100 + 500, 8)
  })

  it('uses the farther asymmetric daylight for a centred skewed barrel and flags insufficient cover', () => {
    const a = road(802)
    a.template.leftWidth = 6
    a.engineering!.culverts.push(culvert({ skewDegrees: 60, lengthM: 20, inletInvertM: 802, outletInvertM: 801.8 }))
    const c = analyzeRoad(a, flat, settings).engineering!.culverts[0]
    expect(c.requiredLengthM).toBeCloseTo(32, 4)
    expect(c.coverM).toBeLessThan(0)
    expect(c.warnings.join(' ')).toMatch(/shorter than the centred daylight span/)
    expect(c.warnings.join(' ')).toMatch(/below 0.50/)
  })

  it('keeps unknown inverts and missing terrain distinct from zero cover or grade', () => {
    const a = road(802)
    a.engineering!.culverts.push(culvert({ outletInvertM: null }))
    let c = analyzeRoad(a, flat, settings).engineering!.culverts[0]
    expect(c.coverM).toBeNull()
    expect(c.gradePercent).toBeNull()
    expect(c.barrelLengthM).toBeNull()
    expect(c.installedCost).toBe(1700)
    expect(c.warnings.join(' ')).toMatch(/provisionally use horizontal span/)
    expect(c.profile[0].invertElevation).toBe(800)
    expect(c.profile.at(-1)!.invertElevation).toBeNull()
    expect(c.complete).toBe(false)
    a.engineering!.culverts[0].outletInvertM = 799.88
    const hole: TerrainSource = {
      elevationAt: (lng, lat) => (northing([lng, lat]) > 49 && northing([lng, lat]) < 51 ? NaN : 800),
    }
    c = analyzeRoad(a, hole, settings).engineering!.culverts[0]
    expect(c.gradePercent).toBeCloseTo(-1, 7)
    expect(c.coverM).toBeNull()
    expect(c.requiredLengthM).toBeNull()
  })

  it('includes longitudinal road grade when checking formation cover along a skewed barrel', () => {
    const a = road(800)
    a.vertical[1].elevation = 810
    a.engineering!.culverts.push(culvert({ skewDegrees: 30, inletInvertM: 803, outletInvertM: 803 }))
    const c = analyzeRoad(a, flat, settings).engineering!.culverts[0]
    // At the downhill road edge, skew moves the station by 3*tan(30°).
    expect(c.coverM).toBeCloseTo(805 - 3 * Math.tan(Math.PI / 6) * 0.1 - 803.6, 3)
    expect(c.barrelLengthM).toBeCloseTo(12, 8)
  })

  it('flags a crossing displaced by a plan edit without retargeting the entered culvert station', () => {
    const a = road(802)
    const stream: ContextFeature = {
      id: 'stream',
      name: 'Creek',
      kind: 'stream',
      geometry: {
        type: 'LineString',
        coordinates: [offsetCoordinate(north(50), 270, 20), offsetCoordinate(north(50), 90, 20)],
      },
    }
    a.engineering!.culverts.push(culvert({ kind: 'stream', sourceFeatureId: stream.id }))
    const original = analyzeRoad(a, flat, settings, [stream]).engineering!.culverts[0]
    expect(original.complete).toBe(true)
    expect(original.warnings).toEqual([])
    a.points[0].coordinate = north(20)
    const result = analyzeRoad(a, flat, settings, [stream]),
      shifted = result.engineering!.culverts[0]
    expect(result.crossings[0].chainage).toBeCloseTo(30, 5)
    expect(shifted.chainage).toBe(50)
    expect(a.engineering!.culverts[0].chainage).toBe(50)
    expect(distance(shifted.coordinate, north(70))).toBeLessThan(1e-5)
    expect(shifted.warnings.join(' ')).toMatch(/associated crossing is at 30.00 m, 20.00 m/)
    expect(shifted.complete).toBe(false)
    expect(result.engineering!.complete).toBe(false)
    expect(result.warnings.join(' ')).toMatch(/crossing association/)
    expect(shifted.coverM).toBeCloseTo(original.coverM!, 5)
    expect(shifted.installedCost).toBeCloseTo(original.installedCost, 8)
  })

  it('flags a missing associated intersection even when an unrelated stream still crosses there', () => {
    const a = road(802)
    const unrelated: ContextFeature = {
      id: 'other-stream',
      name: 'Other creek',
      kind: 'stream',
      geometry: {
        type: 'LineString',
        coordinates: [offsetCoordinate(north(50), 270, 20), offsetCoordinate(north(50), 90, 20)],
      },
    }
    a.engineering!.culverts.push(culvert({ kind: 'stream', sourceFeatureId: 'deleted-stream' }))
    const result = analyzeRoad(a, flat, settings, [unrelated]),
      c = result.engineering!.culverts[0]
    expect(result.crossings).toHaveLength(1)
    expect(c.chainage).toBe(50)
    expect(c.warnings.join(' ')).toMatch(/associated feature has no current road intersection/)
    expect(c.complete).toBe(false)
    expect(result.engineering!.complete).toBe(false)
    expect(c.coverM).not.toBeNull()
  })

  it('chooses the nearest intersection of the associated feature and accepts a match within one metre', () => {
    const a = road(802)
    const stream: ContextFeature = {
      id: 'stream',
      name: 'Meandering creek',
      kind: 'stream',
      geometry: {
        type: 'LineString',
        coordinates: [
          offsetCoordinate(north(10), 270, 20),
          offsetCoordinate(north(10), 90, 20),
          offsetCoordinate(north(50.75), 90, 20),
          offsetCoordinate(north(50.75), 270, 20),
        ],
      },
    }
    a.engineering!.culverts.push(culvert({ kind: 'stream', sourceFeatureId: stream.id }))
    const result = analyzeRoad(a, flat, settings, [stream]),
      c = result.engineering!.culverts[0]
    expect(result.crossings).toHaveLength(2)
    expect(c.complete).toBe(true)
    expect(c.warnings).toEqual([])
    expect(c.chainage).toBe(50)
    a.engineering!.culverts[0].chainage = 49.5
    const outsideTolerance = analyzeRoad(a, flat, settings, [stream]).engineering!.culverts[0]
    expect(outsideTolerance.complete).toBe(false)
    expect(outsideTolerance.warnings.join(' ')).toMatch(/1.25 m from the entered culvert station/)
  })
})

describe('mass-haul allocation and unit costs', () => {
  it('conserves compacted cut-to-fill volumes and uses only distance beyond free haul for movement cost', () => {
    const a = road()
    a.vertical[1].elevation = 802
    Object.assign(a.engineering!.haul, {
      enabled: true,
      freeHaulDistanceM: 25,
      overhaulDistanceM: 70,
      overhaulRate: 2,
      endHaulRate: 3,
    })
    const r = analyzeRoad(a, flat, { ...settings, shrinkFactor: 1 }),
      e = r.engineering!
    expect(e.haul.borrowCompactedM3).toBeCloseTo(0, 4)
    expect(e.haul.wasteBankM3).toBeCloseTo(0, 4)
    expect(e.movements.reduce((sum, p) => sum + (p.compactedVolumeM3 ?? 0), 0)).toBeCloseTo(r.fillVolumeM3, 4)
    expect(e.movements.every((p) => p.volumeBasis === 'compacted')).toBe(true)
    for (const p of e.movements) {
      const rate = p.category === 'endhaul' ? 3 : p.category === 'overhaul' ? 2 : 0
      expect(p.haulCost).toBeCloseTo(((p.transportedVolumeM3 * Math.max(0, p.distanceM - 25)) / 1000) * rate, 8)
    }
    expect(e.costs.haul).toBeCloseTo(
      e.movements.reduce((sum, p) => sum + p.haulCost, 0),
      8,
    )
    expect(e.haul.haulM3Km).toBeGreaterThan(0)
    expect(e.haul.wasteHaulM3Km).toBe(0)
  })

  it('respects borrow site capacities and charges preparation once with explicit unallocated demand', () => {
    const a = road(802)
    Object.assign(a.engineering!.haul, { enabled: true, borrowRate: 9, mobilizationCost: 100, contingencyPercent: 10 })
    a.engineering!.sites = [
      {
        id: 'b1',
        name: 'A',
        kind: 'borrow',
        chainage: 50,
        accessDistanceM: 100,
        capacityM3: 1000,
        unitRate: 7,
        fixedCost: 500,
      },
      {
        id: 'b2',
        name: 'B',
        kind: 'borrow',
        chainage: 0,
        accessDistanceM: 0,
        capacityM3: 400,
        unitRate: 3,
        fixedCost: 50,
      },
    ]
    const e = analyzeRoad(a, flat, settings).engineering!
    expect(e.haul.borrowCompactedM3).toBeCloseTo(1600, 4)
    expect(e.haul.unallocatedBorrowM3).toBeCloseTo(200, 4)
    expect(
      e.movements.filter((p) => p.sourceId === 'b1').reduce((sum, p) => sum + p.transportedVolumeM3, 0),
    ).toBeCloseTo(1000, 6)
    expect(e.costs.borrow).toBeCloseTo(10000, 3)
    expect(e.costs.sitePreparation).toBe(550)
    expect(e.costs.contingency).toBeCloseTo(e.costs.subtotal * 0.1, 7)
    expect(e.costs.total).toBeCloseTo(e.costs.subtotal * 1.1, 7)
    expect(e.haul.complete).toBe(false)
    expect(e.warnings.join(' ')).toMatch(/unknown haul distance/)
  })

  it('keeps nonreusable waste in bank units separate from compacted haul metrics', () => {
    const a = road()
    a.engineering!.materials = [
      {
        id: 'strip',
        name: 'Nonreusable',
        color: '#876',
        cutRate: 4,
        reusableFraction: 0,
        compactionFactor: 1,
        purpose: 'stripping',
      },
    ]
    a.engineering!.strata = [{ id: 'all', materialId: 'strip', start: 0, end: 100, topDepthM: 0, bottomDepthM: null }]
    Object.assign(a.engineering!.haul, { enabled: true, wasteRate: 3 })
    a.engineering!.sites = [
      {
        id: 'w',
        name: 'Disposal',
        kind: 'waste',
        chainage: 50,
        accessDistanceM: 10,
        capacityM3: 500,
        unitRate: 2,
        fixedCost: 10,
      },
    ]
    const e = analyzeRoad(a, flat, settings).engineering!
    expect(e.haul.wasteBankM3).toBeCloseTo(1600, 4)
    expect(e.haul.unallocatedWasteM3).toBeCloseTo(1100, 4)
    expect(e.haul.freeHaulM3 + e.haul.overhaulM3 + e.haul.endHaulM3).toBe(0)
    expect(e.haul.wasteFreeHaulBankM3 + e.haul.wasteOverhaulBankM3 + e.haul.wasteEndHaulBankM3).toBeCloseTo(500, 6)
    expect(e.movements.every((p) => p.volumeBasis === 'bank' && p.compactedVolumeM3 === null)).toBe(true)
    expect(e.costs.waste).toBeCloseTo(4300, 3)
  })

  it('never matches cut to fill or a site across an unsupported road gap', () => {
    const a = road()
    a.vertical[1].elevation = 802
    a.engineering!.haul.enabled = true
    a.engineering!.sites = [
      {
        id: 'b',
        name: 'Borrow',
        kind: 'borrow',
        chainage: 90,
        accessDistanceM: 0,
        capacityM3: null,
        unitRate: 0,
        fixedCost: 0,
      },
      {
        id: 'w',
        name: 'Waste',
        kind: 'waste',
        chainage: 10,
        accessDistanceM: 0,
        capacityM3: null,
        unitRate: 0,
        fixedCost: 0,
      },
    ]
    const hole: TerrainSource = {
      elevationAt: (lng, lat) => {
        const s = northing([lng, lat])
        return s > 39 && s < 61 ? NaN : 800
      },
    }
    const e = analyzeRoad(a, hole, { ...settings, shrinkFactor: 1 }).engineering!
    expect(e.movements.some((p) => p.kind === 'cut-to-fill')).toBe(false)
    expect(e.haul.borrowCompactedM3).toBeGreaterThan(0)
    expect(e.haul.wasteBankM3).toBeGreaterThan(0)
    expect(
      e.movements.every(
        (p) => Math.max(p.fromChainage, p.toChainage) < 39 || Math.min(p.fromChainage, p.toChainage) > 61,
      ),
    ).toBe(true)
    expect(e.warnings.join(' ')).toMatch(/not moved across/)
  })
})

describe('truthful fitted-curve schedules', () => {
  it('distinguishes rejected vertical curves and only lists actually fitted horizontal arcs', () => {
    const a = road(800, 200)
    a.points = [
      { id: 's', coordinate: origin, radiusM: 0 },
      { id: 'p', coordinate: north(100), radiusM: 20 },
      { id: 'e', coordinate: offsetCoordinate(north(100), 90, 100), radiusM: 0 },
    ]
    expect(horizontalCurveSummary(a)).toHaveLength(1)
    expect(horizontalCurveSummary(a)[0].length).toBeCloseTo((20 * Math.PI) / 2, 3)
    a.points[1].radiusM = 200
    expect(horizontalCurveSummary(a)).toEqual([])
    a.vertical = [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'p', chainage: 100, elevation: 805, curveLength: 40 },
      { id: 'e', chainage: 200, elevation: 800, curveLength: 0 },
    ]
    expect(verticalCurveSummary(a)[0]).toMatchObject({ start: 80, end: 120, g1: 5, g2: -5, k: 4, valid: true })
    a.vertical[1].curveLength = 400
    expect(verticalCurveSummary(a)[0].valid).toBe(false)
  })
})

describe('haul unit cost', () => {
  it('follows the free-haul, overhaul and endhaul pieces with loading steps', () => {
    // RoadEng's example: free haul < 150 m at $8/(m³·km), overhaul to 1 km at $4 + $0.60 loading, endhaul $2 + $2.60.
    const h = {
      ...DEFAULT_HAUL_SETTINGS,
      freeHaulDistanceM: 150,
      overhaulDistanceM: 1000,
      freeHaulRate: 8,
      overhaulRate: 4,
      endHaulRate: 2,
      overhaulLoadingRate: 0.6,
      endHaulLoadingRate: 2.6,
    }
    expect(haulUnitCost(h, 100)).toBeCloseTo(0.8, 9)
    expect(haulUnitCost(h, 500)).toBeCloseTo(0.35 * 4 + 0.6, 9)
    expect(haulUnitCost(h, 1500)).toBeCloseTo(1.35 * 2 + 2.6, 9)
    // The defaults keep free haul free.
    expect(haulUnitCost(DEFAULT_HAUL_SETTINGS, 20)).toBe(0)
  })
})

describe('culvert ditch dip', () => {
  it('deepens the inlet-side ditch to the inlet invert and grades it back up at the dip', () => {
    // Formation 1 m below flat ground: both sides have a 0.5 m V ditch whose bottom sits at 798.5.
    const a = road(799)
    a.template = { ...a.template, ditchWidth: 1, ditchDepth: 0.5 }
    a.engineering!.culverts = [culvert({ inletInvertM: 797.5, ditchDipPercent: 2 })]
    const at = (chainage: number, side: 'left' | 'right') => {
      const s = analyzeRoad(a, flat, settings).stations.find((x) => Math.abs(x.chainage - chainage) < 1e-6)!
      return s.section.find((p) => Math.abs(p.offset - (side === 'left' ? -3.5 : 3.5)) < 1e-6)!.design!
    }
    expect(at(50, 'left')).toBeCloseTo(797.5, 6)
    expect(at(30, 'left')).toBeCloseTo(797.9, 6)
    // Beyond 50 m of dip the normal ditch is deeper than the dip line, and the right ditch never dips.
    expect(at(0, 'left')).toBeCloseTo(798.5, 6)
    expect(at(50, 'right')).toBeCloseTo(798.5, 6)
  })
})

describe('haul cost lines', () => {
  it('prices every line as quantity × rate, keeps compacted and bank work apart and sums to the costs', () => {
    // Cut at the start, fill at the end; half the cut is unusable, so there is waste, and borrow with no site.
    const a = road()
    a.vertical[1].elevation = 802
    a.engineering!.materials = [
      { id: 'soil', name: 'Soil', color: '#987', cutRate: 5, reusableFraction: 0.5, compactionFactor: 1 },
    ]
    a.engineering!.strata = [{ id: 'all', materialId: 'soil', start: 0, end: 100, topDepthM: 0, bottomDepthM: null }]
    Object.assign(a.engineering!.haul, {
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
    })
    a.engineering!.sites = [
      {
        id: 'w',
        name: 'Spoil',
        kind: 'waste',
        chainage: 10,
        accessDistanceM: 40,
        capacityM3: 50,
        unitRate: 2,
        fixedCost: 10,
      },
    ]
    const e = analyzeRoad(a, flat, settings).engineering!,
      lines = haulCostLines(a.engineering!, e)
    for (const line of lines) expect(line.amount).toBe(line.quantity * line.rate)
    const sum = (group: string) => lines.filter((l) => l.group === group).reduce((total, l) => total + l.amount, 0)
    expect(sum('haul')).toBeCloseTo(e.costs.haul, 6)
    expect(sum('borrow')).toBeCloseTo(e.costs.borrow, 6)
    expect(sum('waste')).toBeCloseTo(e.costs.waste, 6)
    expect(sum('sitePreparation')).toBe(e.costs.sitePreparation)
    expect(e.costs.sitePreparation).toBe(10)
    expect(e.costs.haul).toBeGreaterThan(0)
    expect(e.haul.unallocatedBorrowM3).toBeGreaterThan(0)
    expect(e.haul.unallocatedWasteM3).toBeGreaterThan(0)
    // Loading lines carry each basis's moved volume; no line mixes compacted and bank units.
    const loaded = (basis: string) =>
      lines.filter((l) => l.group === 'haul' && l.unit === `${basis} m³`).reduce((total, l) => total + l.quantity, 0)
    expect(loaded('compacted')).toBeCloseTo(e.haul.freeHaulM3 + e.haul.overhaulM3 + e.haul.endHaulM3, 6)
    expect(loaded('bank')).toBeCloseTo(
      e.haul.wasteFreeHaulBankM3 + e.haul.wasteOverhaulBankM3 + e.haul.wasteEndHaulBankM3,
      6,
    )
    expect(loaded('bank')).toBeGreaterThan(0)
    expect(lines.filter((l) => l.group === 'haul').every((l) => /^(compacted|bank) m³(·km)?$/.test(l.unit))).toBe(true)
    // Free haul is charged over its whole distance; overhaul and endhaul only beyond free haul.
    for (const basis of ['compacted', 'bank'] as const)
      for (const category of ['freehaul', 'overhaul', 'endhaul'] as const) {
        const expected = e.movements
          .filter((m) => m.category === category && m.volumeBasis === basis)
          .reduce(
            (total, m) =>
              total +
              (m.transportedVolumeM3 * (category === 'freehaul' ? m.distanceM : Math.max(0, m.distanceM - 25))) / 1000,
            0,
          )
        expect(lines.find((l) => l.id === `haul-${category}-${basis}`)?.quantity ?? 0).toBeCloseTo(expected, 6)
      }
    const site = lines.find((l) => l.id === 'waste-w')!
    expect(site.quantity).toBeCloseTo(50, 6)
    expect(site.rate).toBe(2)
    expect(lines.find((l) => l.id === 'waste-unallocated')!.rate).toBe(4)
    expect(lines.find((l) => l.id === 'borrow-unallocated')!.rate).toBe(6)
  })

  it('has no lines while haul allocation is off', () => {
    const a = road()
    a.vertical[1].elevation = 802
    expect(haulCostLines(a.engineering!, analyzeRoad(a, flat, settings).engineering!)).toEqual([])
  })
})

describe('culvert cover on a superelevated curve', () => {
  it('takes the formation from the superelevated section, not the template crown', () => {
    // North 200 m, then a right turn to the east on a 60 m radius, 2 m above flat ground.
    const corner = north(200)
    const a = road(802)
    a.points = [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: corner, radiusM: 60 },
      { id: 'c', coordinate: offsetCoordinate(corner, 90, 200), radiusM: 0 },
    ]
    a.vertical[1].chainage = alignmentLength(a)
    a.template = { ...a.template, crossfallPercent: 3 }
    a.curveDesign = {
      designSpeedKmh: 40,
      maxSuperelevationPercent: 8,
      sideFrictionFactor: 0.15,
      runoffLengthM: 30,
      wideningVehicleLengthM: 12,
    }
    a.engineering!.culverts.push(culvert({ chainage: 190 }))
    const r = analyzeRoad(a, flat, settings),
      c = r.engineering!.culverts[0],
      station = nearestStation(r.stations, 190)!
    expect(station.chainage).toBeCloseTo(190, 6)
    // The inside (right) edge, widened to 4.2 m, falls at e ≈ 6 % rather than the 3 % crown.
    const e = 1600 / 7620 - 0.15
    expect(station.rightWidth).toBeCloseTo(4.2, 6)
    const edge = station.section.find((p) => Math.abs(p.offset - station.rightWidth) < 1e-6)!.design!
    expect(edge).toBeCloseTo(802 - 4.2 * e, 6)
    // Inverts 800 → 799.88 over the 12 m span; the edge is 6 + 4.2 m from the inlet.
    const crown = 800 - (0.12 * (6 + 4.2)) / 12 + 0.6
    expect(c.coverM).toBeCloseTo(edge - crown, 3)
    expect(c.profile.find((p) => Math.abs(p.distanceM - (6 + 4.2)) < 1e-6)!.formationElevation).toBeCloseTo(edge, 3)
    // The template crossfall would have read about 0.13 m more cover.
    expect(802 - 4.2 * 0.03 - crown - c.coverM!).toBeGreaterThan(0.1)
  })
})

describe('template starters', () => {
  const uDitch: RoadTemplate = {
    leftWidth: 3,
    rightWidth: 3,
    crossfallPercent: 3,
    cutSlope: 1,
    fillSlope: 1.5,
    ditchWidth: 1.5,
    ditchDepth: 0.5,
    ditchBottomWidth: 1,
    surfaceDepth: 0.2,
    leftDitchWidth: 2,
    leftDitchBottomWidth: 1.5,
    rightDitchBottomWidth: 0.5,
    rightCrossfallPercent: -2,
  }
  const sideKeys = (t: RoadTemplate) => Object.keys(t).filter((key) => /^(left|right)(?!Width$)/.test(key))

  it('gives every starter a valid template from a U-ditch section, and the road keeps calculating', () => {
    validateTemplate(uDitch)
    for (const starter of ['current', 'single', 'double', 'landing', 'urban'] as TemplateStarter[]) {
      const template = templateFromStarter(uDitch, starter)
      expect(() => validateTemplate(template)).not.toThrow()
      if (starter !== 'current') expect(sideKeys(template)).toEqual([])
      const a = road()
      a.template = { ...uDitch }
      a.engineering!.templates.push({ id: starter, name: starter, template })
      a.engineering!.assignments.push({
        id: 'r',
        templateId: starter,
        side: 'both',
        start: 20,
        end: 80,
        transitionM: 0,
      })
      expect(() => analyzeRoad(a, flat, settings)).not.toThrow()
    }
    const crowned = templateFromStarter(uDitch, 'urban')
    expect(crowned).toMatchObject({ ditchWidth: 0, ditchDepth: 0, ditchBottomWidth: 0 })
    expect(templateFromStarter(uDitch, 'current')).toEqual(uDitch)
  })

  it('keeps a shared ditch bottom inside the shared ditch once side widths are dropped', () => {
    // Valid only through the side ditch widths: the shared bottom is wider than the shared ditch.
    const base: RoadTemplate = { ...uDitch, ditchWidth: 1, ditchBottomWidth: 2, leftDitchWidth: 3, rightDitchWidth: 3 }
    delete base.leftDitchBottomWidth
    delete base.rightDitchBottomWidth
    validateTemplate(base)
    expect(templateFromStarter(base, 'single').ditchBottomWidth).toBe(1)
  })

  it('refuses a starter that would copy an out-of-range section', () => {
    expect(() => templateFromStarter({ ...uDitch, cutSlope: 0.05 }, 'current')).toThrow(/supported ranges/)
  })
})

describe('engineering validation bounds', () => {
  const valid = (): AlignmentEngineering => {
    const e = createEngineeringDesign()
    e.materials = [{ id: 'm', name: 'Soil', color: '#987', cutRate: 10000, reusableFraction: 1, compactionFactor: 2 }]
    e.culverts = [culvert({ lengthM: 0.2, diameterM: 0.1, ditchDipPercent: 0.1 })]
    Object.assign(e.haul, { freeHaulRate: 100000, freeHaulLoadingRate: 100000, endHaulLoadingRate: 100000 })
    return e
  }

  it('accepts the editor and project-file limits', () => {
    expect(() => validateEngineering(valid())).not.toThrow()
    const e = valid()
    e.culverts[0].ditchDipPercent = 50
    e.materials[0].compactionFactor = 0.1
    expect(() => validateEngineering(e)).not.toThrow()
    expect(() => validateTemplate({ ...road().template, cutSlope: 0.1, fillSlope: 0.1 })).not.toThrow()
  })

  it.each<[string, (e: AlignmentEngineering) => void]>([
    ['free-haul rate', (e) => (e.haul.freeHaulRate = 100001)],
    ['free-haul loading rate', (e) => (e.haul.freeHaulLoadingRate = -1)],
    ['overhaul loading rate', (e) => (e.haul.overhaulLoadingRate = NaN)],
    ['endhaul loading rate', (e) => (e.haul.endHaulLoadingRate = 1e6)],
    ['overhaul rate', (e) => (e.haul.overhaulRate = 1e7)],
    ['ditch dip below 0.1 %', (e) => (e.culverts[0].ditchDipPercent = 0.05)],
    ['ditch dip above 50 %', (e) => (e.culverts[0].ditchDipPercent = 51)],
    ['ditch dip that is not finite', (e) => (e.culverts[0].ditchDipPercent = Infinity)],
    ['compaction factor above 2', (e) => (e.materials[0].compactionFactor = 2.5)],
    ['compaction factor below 0.1', (e) => (e.materials[0].compactionFactor = 0.05)],
    ['culvert span below 0.2 m', (e) => (e.culverts[0].lengthM = 0.15)],
    ['culvert diameter below 0.1 m', (e) => (e.culverts[0].diameterM = 0.07)],
    [
      'batter slope below 0.1',
      (e) => e.templates.push({ id: 't', name: 'T', template: { ...road().template, cutSlope: 0.07 } }),
    ],
  ])('rejects an out-of-range %s', (_, change) => {
    const e = valid()
    change(e)
    expect(() => validateEngineering(e)).toThrow()
  })
})

describe('complete coverage threshold', () => {
  it('is the engine rule, 100 % less 1e-5', () => {
    expect(COMPLETE_COVERAGE_PERCENT).toBe(100 - 1e-5)
    expect(hasCompleteCoverage({ coveragePercent: 99.999995 })).toBe(true)
    expect(hasCompleteCoverage({ coveragePercent: 99.9995 })).toBe(false)
    expect(hasCompleteCoverage(analyzeRoad(road(), flat, settings))).toBe(true)
  })
})
