import { describe, expect, it } from 'vitest'
import { alignmentLength, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import {
  analyzeFullCostConnector,
  buildFullCostDemands,
  compareFullCostCandidates,
  fullCostNetworkAttachments,
  type FullCostCandidateInput,
} from './fullCostComparison'
import {
  createRoadPlanSource,
  createTotalCostPlanningDefaults,
  parseTotalCostPlanning,
  type RoadPlanSource,
  type TotalCostPlanning,
} from './fullCostPlanning'
import { buildRoadNetwork, createRoadNetworkEvidence, shortestRoadNetworkPath } from './roadNetwork'
import type { RoadNetworkEvidence, RoadNetworkInput } from './roadNetworkTypes'
import type { Alignment, Coordinate, ExistingRoadEvidence, RoadSettings } from './types'

const origin: Coordinate = [-122.72, 53.89]
const point = (x: number, y: number): Coordinate => offsetCoordinate(offsetCoordinate(origin, 90, x), 0, y)
const a = point(100, 0),
  b = point(-400, 0),
  upperA = point(100, 1000),
  upperB = point(-400, 1000)
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 999,
  clearingRate: 1,
  shrinkFactor: 0.8,
}
const terrain = { elevationAt: () => 800 }
function candidate(id: string, end: Coordinate, elevation = 800): FullCostCandidateInput {
  const alignment: Alignment = {
    id,
    name: id,
    color: '#16817a',
    points: [
      { id: `${id}-start`, coordinate: origin, radiusM: 0 },
      { id: `${id}-end`, coordinate: end, radiusM: 0 },
    ],
    vertical: [],
    overrides: [],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0.2,
    },
    engineering: createEngineeringDesign(),
  }
  const length = alignmentLength(alignment)
  alignment.vertical = [
    { id: `${id}-v0`, chainage: 0, elevation, curveLength: 0 },
    { id: `${id}-v1`, chainage: length, elevation, curveLength: 0 },
  ]
  return {
    id,
    name: id,
    alignment,
    analysis: analyzeFullCostConnector(alignment, terrain, settings),
    entryChainage: length,
    entryRoadId: id === 'long-b' ? 'arm-b' : 'arm-a',
    checks: { adoptable: true, failures: [], unknowns: [] },
  }
}
const reviewedRoad: ExistingRoadEvidence = {
  source: 'scenario',
  condition: 'serviceable',
  conditionBasis: 'field-verified',
  reuseAllowed: true,
  observations: [
    {
      id: 'inspection',
      source: 'inspection',
      component: 'overall',
      observedAt: '2026-10-28',
      sourceUrl: 'https://example.com/synthetic-inspection',
      notes: 'Synthetic test only',
      finding: 'serviceable',
      review: { reviewer: 'Test fixture', reviewedAt: '2026-10-28' },
    },
  ],
  conditionPolicy: { maxInspectionAgeDays: 30, maxImageryAgeDays: 30 },
}
const networkEvidence = (patch: Partial<RoadNetworkEvidence> = {}): RoadNetworkEvidence => ({
  ...createRoadNetworkEvidence(),
  access: 'allowed',
  seasons: ['summer'],
  vehicleClasses: ['logging-truck'],
  maxVehicleWeightTonnes: 80,
  bridgeStatus: 'none',
  bridgeLoadTonnes: null,
  level: 0,
  forwardUphillGradePercent: 0,
  forwardDownhillGradePercent: 0,
  rehabilitationCostPerM: 0,
  accessCost: 0,
  structureCost: 0,
  fixedCost: 0,
  ...patch,
})
function roads(patch: Partial<RoadNetworkEvidence> = {}): RoadNetworkInput[] {
  return [
    {
      id: 'arm-a',
      name: 'A access',
      coordinates: [a, upperA],
      evidence: reviewedRoad,
      network: networkEvidence(patch),
    },
    {
      id: 'top',
      name: 'Upper connection',
      coordinates: [upperA, upperB],
      evidence: reviewedRoad,
      network: networkEvidence(),
    },
    { id: 'arm-b', name: 'B access', coordinates: [upperB, b], evidence: reviewedRoad, network: networkEvidence() },
  ]
}
function source(id = 'aggregate', patch: Partial<RoadPlanSource> = {}): RoadPlanSource {
  return {
    ...createRoadPlanSource(id),
    enabled: true,
    entrance: b,
    entranceRoadId: 'arm-b',
    accessConfirmed: true,
    qualityConfirmed: true,
    acquisitionRate: 10,
    processingRate: 0,
    loadingRate: 0,
    placementRate: 0,
    fixedCost: 0,
    ...patch,
  }
}
function plan(patch: Partial<TotalCostPlanning> = {}): TotalCostPlanning {
  const value = createTotalCostPlanningDefaults('2026-10-28')
  return {
    ...value,
    connectorChecks: {
      ...value.connectorChecks,
      loadedDirection: 'start-to-end',
      maxAdverseGradePercent: 12,
      maxFavourableGradePercent: 15,
    },
    newConstructionFixedCost: 0,
    haulRatePerM3Km: 0,
    returnHaulRatePerM3Km: 0,
    outlet: upperB,
    outletRoadId: 'arm-b',
    sources: [source()],
    networkPolicy: {
      ...value.networkPolicy,
      season: 'summer',
      vehicleClass: 'logging-truck',
      vehicleWeightTonnes: 40,
      maxUphillGradePercent: 12,
      maxDownhillGradePercent: 15,
    },
    ...patch,
  }
}
function compare(candidates: FullCostCandidateInput[], planning: TotalCostPlanning, network = roads()) {
  const graph = buildRoadNetwork(network, planning.networkPolicy, fullCostNetworkAttachments(candidates, planning))
  return compareFullCostCandidates(candidates, planning, (from, to, options) =>
    shortestRoadNetworkPath(graph, from, to, options),
  )
}

describe('checked horizontal full-cost comparison', () => {
  it('retains named surface-layer quantities and requires a matching external material class', () => {
    const c = candidate('short-a', a)
    c.alignment.engineering!.materials = [
      {
        id: 'rock',
        name: 'Rock',
        color: '#888888',
        cutRate: 2,
        reusableFraction: 1,
        compactionFactor: 0.8,
        quality: 90,
      },
    ]
    c.alignment.template.layers = [
      { id: 'base', name: 'Rock base', side: 'both', depthM: 0.1, materialId: 'rock' },
      { id: 'finish', name: 'Finish', side: 'both', depthM: 0.2 },
    ]
    c.analysis = analyzeFullCostConnector(c.alignment, terrain, settings)
    const demands = buildFullCostDemands(c.alignment, c.analysis, c.entryChainage)
    expect(demands.filter((d) => d.layer === 'base').reduce((s, d) => s + d.volumeM3, 0)).toBeCloseTo(60, 4)
    expect(demands.filter((d) => d.layer === 'finish').reduce((s, d) => s + d.volumeM3, 0)).toBeCloseTo(120, 4)
    expect(compare([c], plan()).candidates[0].status).toBe('infeasible')
    const result = compare([c], plan({ sources: [source('classified', { materialIds: ['rock'], quality: 90 })] }))
      .candidates[0]
    expect(result.status).toBe('feasible')
    expect(
      result.allocations.some((allocation) => allocation.demandLayer === 'base' && allocation.materialId === 'rock'),
    ).toBe(true)
  })
  it('reserves shared external capacity for high-quality subgrade and keeps a low-quality surface source eligible', () => {
    const c = candidate('short-a', a, 802)
    c.alignment.engineering!.fillRequirements = [
      { id: 'quality', start: 0, end: 1000, layer: 'subgrade', minQuality: 80, replaceable: true },
    ]
    c.analysis = analyzeFullCostConnector(c.alignment, terrain, settings)
    const result = compare(
      [c],
      plan({
        sources: [
          source('high', { capacityM3: 1600, quality: 90 }),
          source('common', { uses: ['surfacing'], capacityM3: 120, quality: 20 }),
        ],
      }),
    ).candidates[0]
    expect(result.status).toBe('feasible')
    expect(
      result.allocations
        .filter((allocation) => allocation.use === 'fill')
        .every((allocation) => allocation.sourceId === 'high'),
    ).toBe(true)
    expect(
      result.allocations
        .filter((allocation) => allocation.use === 'surfacing')
        .every((allocation) => allocation.sourceId === 'common'),
    ).toBe(true)
  })
  it('blocks external deliveries that would cross an incompatible construction-direction range', () => {
    const c = candidate('short-a', a)
    c.alignment.engineering!.haul.directionRanges = [{ id: 'forward', start: 0, end: 1000, direction: 'forward' }]
    c.analysis = analyzeFullCostConnector(c.alignment, terrain, settings)
    const result = compare([c], plan()).candidates[0]
    expect(result.status).toBe('infeasible')
    expect(result.blockers.join(' ')).toContain('construction-direction')
  })
  it('uses internal rock in a surface course without subtracting it from embankment fill or buying it twice', () => {
    const c = candidate('short-a', a, 798)
    c.alignment.engineering!.materials = [
      {
        id: 'rock',
        name: 'Rock',
        color: '#888888',
        cutRate: 2,
        reusableFraction: 1,
        compactionFactor: 0.8,
        quality: 90,
      },
    ]
    c.alignment.engineering!.strata = [
      { id: 'all', start: 0, end: 1000, materialId: 'rock', topDepthM: 0, bottomDepthM: null },
    ]
    c.alignment.template.layers = [
      { id: 'rock-course', name: 'Rock course', side: 'both', depthM: 0.2, materialId: 'rock' },
    ]
    c.analysis = analyzeFullCostConnector(c.alignment, terrain, settings)
    const demands = buildFullCostDemands(c.alignment, c.analysis, c.entryChainage)
    expect(demands.some((d) => d.use === 'surfacing' || d.use === 'fill')).toBe(false)
    expect(demands.filter((d) => d.use === 'waste').reduce((s, d) => s + d.volumeM3, 0)).toBeCloseTo(1450, 3)
    const result = compare([c], plan({ sources: [source('spoil', { uses: ['waste'], materialIds: ['rock'] })] }))
      .candidates[0]
    expect(result.status).toBe('feasible')
    expect(result.allocations.every((allocation) => allocation.use === 'waste')).toBe(true)
    expect(result.ledger!.newConstruction).toBeGreaterThan(3200 + 120 * settings.fillRate)
  })
  it('changes the winning horizontal geometry when actual connected gravel haul is priced', () => {
    const candidates = [candidate('short-a', a), candidate('long-b', b)]
    expect(compare(candidates, plan()).winnerId).toBe('short-a')
    const hauled = compare(candidates, plan({ haulRatePerM3Km: 40 }))
    expect(hauled.winnerId).toBe('long-b')
    expect(hauled.candidates.every((item) => item.status === 'feasible')).toBe(true)
    expect(hauled.candidates[0].allocations[0].networkDistanceM).toBeGreaterThan(2400)
    expect(hauled.candidates[1].allocations[0].networkDistanceM).toBeLessThan(0.01)
    expect(hauled.candidates[0].ledger!.supplyNetworkHaul).toBeGreaterThan(11000)
    // The old $999/m³ base surfacing component is replaced, not added again.
    expect(hauled.candidates[0].totalCost).toBeLessThan(20000)
  })
  it('makes reviewed rehabilitation cost change the horizontal winner', () => {
    const candidates = [candidate('short-a', a), candidate('long-b', b)]
    expect(compare(candidates, plan()).winnerId).toBe('short-a')
    const rehabilitation = compare(candidates, plan(), roads({ rehabilitationCostPerM: 10 }))
    expect(rehabilitation.winnerId).toBe('long-b')
    expect(rehabilitation.candidates[0].ledger!.networkRehabilitation).toBeGreaterThan(9900)
    expect(rehabilitation.candidates[1].ledger!.networkRehabilitation).toBe(0)
  })
  it.each([
    { bridgeStatus: 'closed' },
    { maxVehicleWeightTonnes: 20 },
    { seasons: ['winter'] },
    { access: 'closed' },
  ] as Partial<RoadNetworkEvidence>[])('rejects a disconnected/restricted outlet route: %j', (restriction) => {
    const result = compare([candidate('short-a', a), candidate('long-b', b)], plan(), roads(restriction))
    expect(result.winnerId).toBe('long-b')
    expect(result.candidates[0].status).toBe('infeasible')
    expect(result.candidates[0].totalCost).toBeNull()
  })
  it('excludes a geographically nearby free pit when its road network is disconnected', () => {
    const near = point(105, 5)
    const planning = plan({
      haulRatePerM3Km: 2,
      sources: [
        source('near-free', { entrance: near, entranceRoadId: 'isolated-pit', acquisitionRate: 0 }),
        source('far-connected'),
      ],
    })
    const network = [
      ...roads(),
      {
        id: 'isolated-pit',
        name: 'Disconnected pit spur',
        coordinates: [point(105, 4), point(105, 6)],
        evidence: reviewedRoad,
        network: networkEvidence(),
      },
    ]
    const result = compare([candidate('short-a', a)], planning, network).candidates[0]
    expect(result.status).toBe('feasible')
    expect(result.allocations.every((allocation) => allocation.sourceId === 'far-connected')).toBe(true)
    expect(result.warnings.join(' ')).toContain('no connected permitted route')
  })
  it('keeps loading, preparation and actual truck costs when acquisition is explicitly zero', () => {
    const result = compare(
      [candidate('short-a', a)],
      plan({ haulRatePerM3Km: 3, sources: [source('free', { acquisitionRate: 0, loadingRate: 2, fixedCost: 100 })] }),
    ).candidates[0]
    expect(result.status).toBe('feasible')
    expect(result.ledger!.sourceMaterials).toBeCloseTo(240, 4)
    expect(result.ledger!.sourcePreparation).toBe(100)
    expect(result.ledger!.supplyNetworkHaul).toBeGreaterThan(890)
    expect(result.ledger!.supplyConnectorHaul).toBeCloseTo(18, 3)
  })
  it('uses finite priced alternate supply and rejects unmet demand without a base-rate shortcut', () => {
    const c = candidate('short-a', a)
    const limited = source('limited', { capacityM3: 40, acquisitionRate: 0 })
    const result = compare([c], plan({ sources: [limited, source('alternate', { acquisitionRate: 20 })] }))
      .candidates[0]
    expect(result.status).toBe('feasible')
    expect(result.allocations.find((allocation) => allocation.sourceId === 'limited')!.volumeM3).toBeCloseTo(40, 5)
    expect(result.allocations.find((allocation) => allocation.sourceId === 'alternate')!.volumeM3).toBeCloseTo(80, 5)
    const insufficient = compare([c], plan({ sources: [limited] }))
    expect(insufficient.winnerId).toBeNull()
    expect(insufficient.candidates[0].totalCost).toBeNull()
  })
  it('reserves shared aggregate capacity for fill that a surfacing-only source cannot supply', () => {
    const c = candidate('fill-road', a, 802)
    const result = compare(
      [c],
      plan({
        sources: [
          source('shared-fill', { capacityM3: 1600, acquisitionRate: 0 }),
          source('surface-only', { uses: ['surfacing'], capacityM3: 120, acquisitionRate: 20 }),
        ],
      }),
    ).candidates[0]
    expect(result.status).toBe('feasible')
    expect(
      result.allocations
        .filter((allocation) => allocation.use === 'fill')
        .reduce((sum, allocation) => sum + allocation.volumeM3, 0),
    ).toBeCloseTo(1600, 4)
    expect(
      result.allocations
        .filter((allocation) => allocation.use === 'surfacing')
        .reduce((sum, allocation) => sum + allocation.volumeM3, 0),
    ).toBeCloseTo(120, 4)
  })
  it('pays shared physical rehabilitation and setup items once across outlet and supply paths', () => {
    const network = roads().map((road) => ({
      ...road,
      network: networkEvidence({ rehabilitationCostPerM: 1, fixedCost: 100 }),
    }))
    const result = compare(
      [candidate('short-a', a)],
      plan({ sources: [source('one', { capacityM3: 40 }), source('two')] }),
      network,
    ).candidates[0]
    expect(result.status).toBe('feasible')
    expect(result.ledger!.networkRehabilitation).toBeCloseTo(2500, 0)
    expect(result.ledger!.networkFixed).toBe(300)
    expect(new Set(result.networkCostItems.map((item) => item.id)).size).toBe(result.networkCostItems.length)
  })
  it('leaves unknown quotes, gates and network costs out of the ranked winner set', () => {
    const c = candidate('short-a', a)
    expect(compare([c], plan({ sources: [source('unpriced', { loadingRate: null })] })).candidates[0].status).toBe(
      'unpriced',
    )
    expect(compare([c], plan(), roads({ rehabilitationCostPerM: null })).candidates[0].status).toBe('unpriced')
    const unchecked = {
      ...c,
      checks: { adoptable: false, failures: [], unknowns: [{ message: 'Independent formation not designed.' }] },
    }
    expect(compare([unchecked], plan()).winnerId).toBeNull()
    expect(compare([unchecked], plan()).candidates[0].blockers).toContain('Independent formation not designed.')
  })
  it('conserves exact surfacing and external borrow/waste volumes from the engine', () => {
    for (const elevation of [798, 800, 802]) {
      const c = candidate('quantities', a, elevation),
        demands = buildFullCostDemands(c.alignment, c.analysis, c.entryChainage)
      expect(
        demands.filter((demand) => demand.use === 'surfacing').reduce((sum, demand) => sum + demand.volumeM3, 0),
      ).toBeCloseTo(c.analysis.surfaceVolumeM3, 6)
      expect(
        demands.filter((demand) => demand.use === 'fill').reduce((sum, demand) => sum + demand.volumeM3, 0),
      ).toBeCloseTo(c.analysis.engineering!.haul.borrowCompactedM3, 6)
      expect(
        demands.filter((demand) => demand.use === 'waste').reduce((sum, demand) => sum + demand.volumeM3, 0),
      ).toBeCloseTo(c.analysis.engineering!.haul.wasteBankM3, 6)
    }
  })
  it('prices bank waste and applies contingency once without retaining old external site costs', () => {
    const c = candidate('cut-road', a, 798)
    c.alignment.engineering!.haul.contingencyPercent = 25
    c.analysis = analyzeFullCostConnector(c.alignment, terrain, settings)
    const result = compare(
      [c],
      plan({
        haulRatePerM3Km: 1,
        sources: [
          source('surface'),
          source('disposal', { uses: ['waste'], acquisitionRate: 2, loadingRate: 3, placementRate: 1, fixedCost: 50 }),
        ],
      }),
    ).candidates[0]
    expect(result.status).toBe('feasible')
    const waste = result.allocations.find((allocation) => allocation.use === 'waste')!
    expect(waste.volumeBasis).toBe('bank')
    expect(waste.volumeM3).toBeCloseTo(c.analysis.engineering!.haul.wasteBankM3, 5)
    expect(waste.materialCost).toBeCloseTo(waste.volumeM3 * 6, 5)
    expect(result.ledger!.sourcePreparation).toBe(50)
    expect(result.ledger!.contingency).toBeCloseTo(result.ledger!.subtotal * 0.25, 6)
    expect(result.totalCost).toBeCloseTo(result.ledger!.subtotal * 1.25, 6)
  })
  it('prices the additional clearing strips by entered rate and fitted length, with contingency once', () => {
    const candidates = [candidate('short-a', a), candidate('long-b', b)]
    for (const c of candidates) c.alignment.engineering!.haul.contingencyPercent = 25
    for (const clearingRate of [1, 3]) {
      for (const c of candidates)
        c.analysis = analyzeFullCostConnector(c.alignment, terrain, { ...settings, clearingRate })
      const basePlan = plan()
      const baseline = compare(candidates, basePlan)
      const widened = compare(candidates, {
        ...basePlan,
        connectorChecks: { ...basePlan.connectorChecks, clearingExtraM: 2 },
      })
      for (const [index, c] of candidates.entries()) {
        const base = baseline.candidates[index],
          extra = widened.candidates[index]
        const additional = 2 * 2 * c.analysis.length * clearingRate
        expect(extra.status).toBe('feasible')
        expect(extra.ledger!.newConstruction - base.ledger!.newConstruction).toBeCloseTo(additional, 6)
        expect(extra.ledger!.sourceMaterials).toBeCloseTo(base.ledger!.sourceMaterials, 6)
        expect(extra.ledger!.contingency - base.ledger!.contingency).toBeCloseTo(additional * 0.25, 6)
        expect(extra.totalCost! - base.totalCost!).toBeCloseTo(additional * 1.25, 6)
        expect(extra.warnings.some((message) => message.includes('Additional clearing allowance'))).toBe(true)
      }
      const shortExtra = widened.candidates[0].ledger!.newConstruction - baseline.candidates[0].ledger!.newConstruction
      const longExtra = widened.candidates[1].ledger!.newConstruction - baseline.candidates[1].ledger!.newConstruction
      expect(longExtra / shortExtra).toBeCloseTo(candidates[1].analysis.length / candidates[0].analysis.length, 6)
    }
  })
  it('replaces external fill placement rather than charging both engine placement and source placement', () => {
    const c = candidate('fill-road', a, 802)
    const result = compare([c], plan({ sources: [source('all', { placementRate: 7 })] })).candidates[0]
    expect(result.status).toBe('feasible')
    expect(result.ledger!.newConstruction).toBeCloseTo(c.analysis.engineering!.costs.clearing, 6)
    expect(result.ledger!.sourceMaterials).toBeCloseTo((c.analysis.fillVolumeM3 + c.analysis.surfaceVolumeM3) * 17, 5)
  })
  it('retains material-aware internal transfers and prices them exactly once', () => {
    const c = candidate('balanced-road', a, 798),
      engineering = c.alignment.engineering!
    c.alignment.vertical[1].elevation = 802
    engineering.materials = [
      {
        id: 'soil',
        name: 'Entered partly reusable soil',
        color: '#997744',
        reusableFraction: 0.6,
        compactionFactor: 0.7,
        cutRate: 2,
      },
    ]
    engineering.strata = [
      { id: 'soil-all', materialId: 'soil', start: 0, end: c.analysis.length, topDepthM: 0, bottomDepthM: null },
    ]
    Object.assign(engineering.haul, {
      freeHaulDistanceM: 0,
      overhaulDistanceM: 0,
      endHaulRate: 1,
      endHaulLoadingRate: 2,
      contingencyPercent: 10,
    })
    c.analysis = analyzeFullCostConnector(c.alignment, terrain, settings)
    const result = compare(
      [c],
      plan({
        sources: [source('supply', { acquisitionRate: 0 }), source('waste', { uses: ['waste'], acquisitionRate: 0 })],
      }),
    ).candidates[0]
    expect(result.status).toBe('feasible')
    const e = c.analysis.engineering!,
      internal = e.movements.filter((movement) => movement.kind === 'cut-to-fill')
    expect(internal.length).toBeGreaterThan(0)
    expect(e.haul.borrowCompactedM3).toBeLessThan(c.analysis.fillVolumeM3)
    expect(result.ledger!.internalMaterialHaul).toBeCloseTo(
      internal.reduce((sum, movement) => sum + movement.haulCost, 0),
      6,
    )
    expect(result.ledger!.internalMaterialHaul).toBeGreaterThan(0)
    expect(
      result.allocations
        .filter((allocation) => allocation.use === 'fill')
        .reduce((sum, allocation) => sum + allocation.volumeM3, 0),
    ).toBeCloseTo(e.haul.borrowCompactedM3, 6)
    expect(
      result.allocations
        .filter((allocation) => allocation.use === 'waste')
        .reduce((sum, allocation) => sum + allocation.volumeM3, 0),
    ).toBeCloseTo(e.haul.wasteBankM3, 6)
    expect(result.totalCost).toBeCloseTo(result.ledger!.subtotal * 1.1, 6)
  })
  it('rejects stale geometry quantities and an unmodeled interior network tie-in', () => {
    const c = candidate('short-a', a)
    expect(() => buildFullCostDemands(c.alignment, c.analysis, c.analysis.length / 2)).toThrow(/endpoint/)
    const changed = { ...c.alignment, points: [{ ...c.alignment.points[0], coordinate: b }, c.alignment.points[1]] }
    expect(() => buildFullCostDemands(changed, c.analysis, c.entryChainage)).toThrow(/do not match/)
  })
  it('checks the actual incoming loaded aggregate direction even when outbound timber would pass', () => {
    const c = candidate('downhill-outbound', a)
    c.alignment.vertical[0].elevation = 810
    c.analysis = analyzeFullCostConnector(c.alignment, terrain, settings)
    const planning = plan()
    planning.connectorChecks.maxAdverseGradePercent = 8
    planning.connectorChecks.maxFavourableGradePercent = 12
    const result = compare([c], planning).candidates[0]
    expect(result.status).toBe('infeasible')
    expect(result.blockers.join(' ')).toContain('Incoming aggregate')
  })
  it('rejects a loaded supply route without a permitted directed empty return path', () => {
    const network = roads()
    network[2].network!.direction = 'reverse'
    const result = compare([candidate('short-a', a)], plan(), network).candidates[0]
    expect(result.status).toBe('infeasible')
    expect(result.totalCost).toBeNull()
    expect(result.warnings.join(' ')).toContain('both loaded and return trips')
  })
  it('prices a different directed empty return network route and both connector legs', () => {
    const network = roads()
    network[2].network!.direction = 'reverse'
    network.push({
      id: 'empty-return-loop',
      name: 'One-way return loop',
      coordinates: [upperB, point(-900, 500), b],
      evidence: reviewedRoad,
      network: networkEvidence({ direction: 'forward' }),
    })
    const result = compare([candidate('short-a', a)], plan({ haulRatePerM3Km: 3, returnHaulRatePerM3Km: 2 }), network)
      .candidates[0]
    expect(result.status).toBe('feasible')
    const allocation = result.allocations[0]
    expect(allocation.returnNetworkDistanceM).toBeGreaterThan(allocation.networkDistanceM + 400)
    expect(allocation.networkHaulCost).toBeCloseTo(
      (allocation.volumeM3 * allocation.path.weightedLengthM * 3) / 1000,
      6,
    )
    expect(allocation.returnNetworkHaulCost).toBeCloseTo(
      (allocation.volumeM3 * allocation.returnPath.weightedLengthM * 2) / 1000,
      6,
    )
    expect(result.ledger!.supplyNetworkHaul).toBeCloseTo(
      allocation.networkHaulCost + allocation.returnNetworkHaulCost,
      6,
    )
    expect(allocation.returnConnectorHaulCost).toBeCloseTo(12, 4)
  })
})

describe('persistent full-cost planning inputs', () => {
  it('round-trips explicit zero prices and separates bank waste capacity from compacted supply', () => {
    const planning = plan({ sources: [source('aggregate'), source('waste', { uses: ['waste'], acquisitionRate: 0 })] })
    expect(parseTotalCostPlanning(JSON.parse(JSON.stringify(planning)))).toEqual(planning)
    expect(() =>
      parseTotalCostPlanning({ ...planning, sources: [source('mixed', { uses: ['waste', 'fill'] })] }),
    ).toThrow(/separate bank-volume/)
    expect(() => parseTotalCostPlanning({ ...planning, sources: [source('same'), source('same')] })).toThrow(/unique/)
    expect(() =>
      parseTotalCostPlanning({ ...planning, sources: [{ ...source('nested'), uses: [['waste']] }] }),
    ).toThrow(/Source uses/)
  })
  it('does not replace unknown entrance, quote or fixed costs with convenient defaults', () => {
    const value = createTotalCostPlanningDefaults('2026-10-28')
    expect(value.newConstructionFixedCost).toBeNull()
    expect(value.haulRatePerM3Km).toBeNull()
    expect(value.returnHaulRatePerM3Km).toBeNull()
    expect(createRoadPlanSource('source').entrance).toBeNull()
    expect(() =>
      parseTotalCostPlanning({
        ...value,
        sources: [{ ...createRoadPlanSource('missing'), acquisitionRate: undefined }],
      }),
    ).toThrow(/acquisition/)
    expect(() => parseTotalCostPlanning({ ...value, asOf: '2026-02-30' })).toThrow(/valid/)
    expect(parseTotalCostPlanning({ ...value, outletRoadId: undefined }).outletRoadId).toBeNull()
    expect(
      parseTotalCostPlanning({ ...value, sources: [{ ...createRoadPlanSource('source'), entranceRoadId: undefined }] })
        .sources[0].entranceRoadId,
    ).toBeNull()
    expect(() => parseTotalCostPlanning({ ...value, outletRoadId: 'x'.repeat(201) })).toThrow(/road ID/)
  })
})
