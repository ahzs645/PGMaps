import { describe, expect, it } from 'vitest'
import {
  buildRoadNetwork,
  createBridgeLoadRatingEvidence,
  createRoadNetworkEvidence,
  createRoadNetworkPolicy,
  parseRoadNetworkEvidence,
  parseBridgeLoadRatingEvidence,
  evaluateNetworkRoad,
  parseRoadNetworkPolicy,
  shortestRoadNetworkPath,
} from './roadNetwork'
import type {
  BridgeLoadRatingEvidence,
  RoadNetworkEvidence,
  RoadNetworkInput,
  RoadNetworkPolicy,
} from './roadNetworkTypes'
import type { Coordinate, ExistingRoadEvidence } from './types'

const origin: Coordinate = [-123, 54]
const point = (x: number, y: number): Coordinate => [
  origin[0] + x / (111195.0802335329 * Math.cos((origin[1] * Math.PI) / 180)),
  origin[1] + y / 111195.0802335329,
]
const policy = (patch: Partial<RoadNetworkPolicy> = {}): RoadNetworkPolicy => ({
  ...createRoadNetworkPolicy('2026-10-29'),
  requireCurrentConditionEvidence: false,
  season: 'summer',
  vehicleClass: 'log-truck',
  vehicleWeightTonnes: 30,
  ...patch,
})
function road(id: string, points: Coordinate[]): RoadNetworkInput {
  return {
    id,
    name: id,
    coordinates: points,
    evidence: { source: 'scenario', condition: 'serviceable', conditionBasis: 'assumed', reuseAllowed: true },
    network: {
      ...createRoadNetworkEvidence(),
      access: 'allowed',
      seasons: ['summer'],
      vehicleClasses: ['log-truck'],
      maxVehicleWeightTonnes: 50,
      bridgeStatus: 'none',
      level: 0,
      rehabilitationCostPerM: 0,
      accessCost: 0,
      structureCost: 0,
      fixedCost: 0,
    },
  }
}
const cost = { distanceRatePerM: 1 }

const currentRating = (patch: Partial<BridgeLoadRatingEvidence> = {}): BridgeLoadRatingEvidence => ({
  ...createBridgeLoadRatingEvidence(50),
  sourceReference: 'Synthetic bridge load-rating report B-12',
  reviewer: 'Fixture reviewer',
  ratedAt: '2026-10-20',
  validUntil: '2026-11-20',
  vehicleClasses: ['log-truck'],
  ...patch,
})

describe('dated bridge load-rating evidence', () => {
  const ratedRoad = () => {
    const input = road('rated-road', [point(0, 0), point(100, 0)])
    input.network = { ...input.network!, bridgeStatus: 'reviewed', bridgeLoadTonnes: 50, bridgeRating: currentRating() }
    return input
  }
  it('accepts a current applicable separately reviewed capacity, including the final validity day', () => {
    expect(evaluateNetworkRoad(ratedRoad(), policy()).eligible).toBe(true)
    expect(evaluateNetworkRoad(ratedRoad(), policy({ asOf: '2026-11-20' })).eligible).toBe(true)
    expect(evaluateNetworkRoad(ratedRoad(), policy({ asOf: '2026-11-21' })).eligible).toBe(false)
  })
  it.each([
    ['missing reference', { sourceReference: '' }],
    ['unreviewed', { reviewer: '' }],
    ['missing date', { ratedAt: null }],
    ['future rating', { ratedAt: '2026-11-01' }],
    ['unknown expiry', { validUntil: null }],
    ['expired rating', { validUntil: '2026-10-28' }],
    ['unknown applicability', { vehicleClasses: null }],
    ['unknown documented capacity', { ratedLoadTonnes: null }],
  ] as [string, Partial<BridgeLoadRatingEvidence>][])(
    'keeps %s unresolved under the strict restriction policy',
    (_name, patch) => {
      const input = ratedRoad()
      input.network!.bridgeRating = currentRating(patch)
      const checked = evaluateNetworkRoad(input, policy())
      expect(checked.eligible).toBe(false)
      expect(checked.reasons.join(' ')).toContain('Bridge load rating is unresolved')
    },
  )
  it('does not treat recent overall imagery as a bridge load rating', () => {
    const input = ratedRoad()
    input.network!.bridgeRating = null
    input.evidence = {
      ...input.evidence!,
      observations: [
        {
          id: 'recent-imagery',
          source: 'imagery',
          component: 'overall',
          observedAt: '2026-10-28',
          sourceUrl: 'https://example.com/synthetic-image',
          notes: 'Visible road surface only',
          finding: 'serviceable',
          review: { reviewer: 'Fixture reviewer', reviewedAt: '2026-10-28' },
        },
      ],
      conditionPolicy: { maxInspectionAgeDays: 30, maxImageryAgeDays: 30 },
    }
    const checked = evaluateNetworkRoad(input, policy({ requireCurrentConditionEvidence: true }))
    expect(checked.reasons.join(' ')).not.toContain('No consistent current positive condition')
    expect(checked.eligible).toBe(false)
    expect(checked.reasons.join(' ')).toContain('separate dated load-rating evidence is missing')
  })
  it('records an explicit unknown-rating assumption but cannot override a closed, overloaded or inapplicable bridge', () => {
    const input = ratedRoad(),
      permissive = policy({ allowUnknownRestrictions: true })
    input.network!.bridgeRating = null
    const assumed = evaluateNetworkRoad(input, permissive)
    expect(assumed.eligible).toBe(true)
    expect(assumed.warnings.join(' ')).toContain('Explicitly assumed unrestricted')
    input.network!.bridgeStatus = 'closed'
    expect(evaluateNetworkRoad(input, permissive).eligible).toBe(false)
    input.network!.bridgeStatus = 'reviewed'
    input.network!.bridgeLoadTonnes = 20
    expect(evaluateNetworkRoad(input, permissive).eligible).toBe(false)
    input.network!.bridgeLoadTonnes = 100
    input.network!.bridgeRating = currentRating({ ratedLoadTonnes: 20 })
    const oldLimit = evaluateNetworkRoad(input, permissive)
    expect(oldLimit.eligible).toBe(false)
    expect(oldLimit.reasons.join(' ')).toContain('Documented bridge load limit of 20 t')
    input.network!.bridgeRating = currentRating({ vehicleClasses: ['light-truck'] })
    expect(evaluateNetworkRoad(input, permissive).eligible).toBe(false)
    input.network!.bridgeRating = currentRating({ vehicleClasses: [] })
    expect(evaluateNetworkRoad(input, permissive).eligible).toBe(false)
    expect(evaluateNetworkRoad(input, { ...permissive, vehicleClass: null }).eligible).toBe(false)
  })
  it('round-trips the rating and rejects invalid dates, capacity and oversized evidence', () => {
    const input = ratedRoad()
    expect(parseRoadNetworkEvidence(JSON.parse(JSON.stringify(input.network))).bridgeRating).toEqual(currentRating())
    expect(parseRoadNetworkEvidence({}).bridgeRating).toBeNull()
    expect(() => parseBridgeLoadRatingEvidence({ ...currentRating(), ratedAt: '2026-02-30' })).toThrow(/valid/)
    expect(() => parseBridgeLoadRatingEvidence({ ...currentRating(), validUntil: '2026-10-01' })).toThrow(/on or after/)
    expect(() => parseBridgeLoadRatingEvidence({ ...currentRating(), ratedLoadTonnes: -1 })).toThrow(/tonnes/)
    expect(() => parseBridgeLoadRatingEvidence({ ...currentRating(), sourceReference: 'x'.repeat(2001) })).toThrow(
      /reference/,
    )
  })
})

describe('reviewed connected road network', () => {
  it.each(['access', 'direction', 'bridgeStatus'] as const)(
    'rejects non-string %s values that can coerce to a valid enum',
    (key) => {
      const value = key === 'direction' ? 'reverse' : 'closed'
      expect(() => parseRoadNetworkEvidence({ [key]: [value] })).toThrow(/Invalid/)
      expect(() => parseRoadNetworkEvidence({ [key]: { toString: () => value } })).toThrow(/Invalid/)
    },
  )
  it.each([
    ['season', { seasons: [] }, { season: null }],
    ['vehicle class', { vehicleClasses: [] }, { vehicleClass: null }],
  ] as [string, Partial<RoadNetworkEvidence>, Partial<RoadNetworkPolicy>][])(
    'never overrides explicitly no permitted %s with an unknown planning tag',
    (_name, restriction, missingTag) => {
      const input = road('none-permitted', [point(0, 0), point(100, 0)])
      input.network = { ...input.network!, ...restriction }
      const checked = evaluateNetworkRoad(input, policy({ ...missingTag, allowUnknownRestrictions: true }))
      expect(checked.eligible).toBe(false)
      expect(checked.reasons.join(' ')).toContain('is permitted on this road')
    },
  )
  it('keeps geometric crossings disconnected until a shared at-grade junction is declared', () => {
    const a = road('horizontal', [point(-100, 0), point(100, 0)]),
      b = road('vertical', [point(0, -100), point(0, 100)])
    const attachments = [
      { id: 'start', coordinate: point(-100, 0), roadId: a.id },
      { id: 'end', coordinate: point(0, 100), roadId: b.id },
    ]
    expect(shortestRoadNetworkPath(buildRoadNetwork([a, b], policy(), attachments), 'start', 'end', cost)).toBeNull()
    a.network!.junctions = [{ id: 'reviewed-junction', coordinate: point(0, 0) }]
    b.network!.junctions = [{ id: 'reviewed-junction', coordinate: point(0, 0) }]
    const path = shortestRoadNetworkPath(buildRoadNetwork([a, b], policy(), attachments), 'start', 'end', cost)!
    expect(path.lengthM).toBeCloseTo(200, 2)
    expect(path.roadIds).toEqual(['horizontal', 'vertical'])
    expect(path.coordinates).toContainEqual(point(0, 0))
    b.network!.level = 1
    expect(() => buildRoadNetwork([a, b], policy(), attachments)).toThrow(/different grade-separation levels/)
  })

  it('snaps reviewed same-level endpoints only within tolerance and counts the small assumed gap', () => {
    const a = road('a', [point(0, 0), point(100, 0)]),
      b = road('b', [point(100.5, 0), point(200, 0)])
    const at = [
      { id: 'a', coordinate: point(0, 0) },
      { id: 'b', coordinate: point(200, 0) },
    ]
    const path = shortestRoadNetworkPath(buildRoadNetwork([a, b], policy(), at), 'a', 'b', cost)!
    expect(path.lengthM).toBeCloseTo(200, 2)
    expect(path.junctionGapM).toBeCloseTo(0.5, 3)
    expect(path.reusedLengthM).toBeCloseTo(199.5, 2)
    expect(path.warnings.join(' ')).toContain('assumed junction')
    expect(
      shortestRoadNetworkPath(buildRoadNetwork([a, b], policy({ snapToleranceM: 0.1 }), at), 'a', 'b', cost),
    ).toBeNull()
    b.network!.level = null
    expect(shortestRoadNetworkPath(buildRoadNetwork([a, b], policy(), at), 'a', 'b', cost)).toBeNull()
    expect(
      shortestRoadNetworkPath(
        buildRoadNetwork([a, b], policy({ allowUnverifiedEndpointSnaps: true }), at),
        'a',
        'b',
        cost,
      ),
    ).not.toBeNull()
    b.network!.level = 1
    expect(
      shortestRoadNetworkPath(
        buildRoadNetwork([a, b], policy({ allowUnverifiedEndpointSnaps: true }), at),
        'a',
        'b',
        cost,
      ),
    ).toBeNull()
  })

  it('projects attachments onto segment interiors, never bridges an off-road gap beyond tolerance', () => {
    const a = road('road', [point(0, 0), point(200, 0)])
    const graph = buildRoadNetwork([a], policy(), [
      { id: 'source', coordinate: point(50, 0.5) },
      { id: 'entry', coordinate: point(150, 0) },
      { id: 'offroad', coordinate: point(100, 10) },
    ])
    const path = shortestRoadNetworkPath(graph, 'source', 'entry', cost)!
    expect(path.lengthM).toBeCloseTo(100.5, 2)
    expect(path.attachmentDistanceM).toBeCloseTo(0.5, 3)
    expect(graph.attachments.get('offroad')?.reason).toContain('tolerance')
    expect(shortestRoadNetworkPath(graph, 'offroad', 'entry', cost)).toBeNull()
  })

  it('rejects an ambiguous source at unjoined crossing levels unless its actual road is identified', () => {
    const ground = road('ground', [point(-100, 0), point(100, 0)]),
      bridge = road('bridge', [point(0, -100), point(0, 100)])
    bridge.network!.level = 1
    const ambiguous = buildRoadNetwork([ground, bridge], policy(), [{ id: 'entrance', coordinate: point(0, 0) }])
    expect(ambiguous.attachments.get('entrance')?.nodeId).toBeNull()
    expect(ambiguous.attachments.get('entrance')?.reason).toContain('unjoined road sections')
    const explicit = buildRoadNetwork([ground, bridge], policy(), [
      { id: 'entrance', coordinate: point(0, 0), roadId: 'ground' },
      { id: 'outlet', coordinate: point(100, 0), roadId: 'ground' },
    ])
    expect(shortestRoadNetworkPath(explicit, 'entrance', 'outlet', cost)?.roadIds).toEqual(['ground'])
  })

  it('never uses a nearby disconnected road as a cost shortcut', () => {
    const actual = road('actual', [point(0, 0), point(100, 0)]),
      nearby = road('nearby', [point(0, 5), point(100, 5)])
    actual.network!.rehabilitationCostPerM = 10
    const graph = buildRoadNetwork([actual, nearby], policy(), [
      { id: 'start', coordinate: point(0, 0) },
      { id: 'end', coordinate: point(100, 0) },
    ])
    const path = shortestRoadNetworkPath(graph, 'start', 'end', cost)!
    expect(path.roadIds).toEqual(['actual'])
    expect(path.rehabilitationCost).toBeCloseTo(1000, 2)
  })

  it('blocks closed roads/bridges, unknown access, season, class and overloaded trucks', () => {
    const a = road('only-road', [point(0, 0), point(100, 0)])
    const at = [
      { id: 'a', coordinate: point(0, 0) },
      { id: 'b', coordinate: point(100, 0) },
    ]
    const blocked = (input: RoadNetworkInput, p = policy()) =>
      expect(shortestRoadNetworkPath(buildRoadNetwork([input], p, at), 'a', 'b', cost)).toBeNull()
    blocked({ ...a, network: { ...a.network!, access: 'unknown' } })
    blocked(
      { ...a, network: { ...a.network!, access: 'closed' } },
      policy({ allowUnknownAccess: true, allowPermissionRequired: true }),
    )
    blocked({ ...a, network: { ...a.network!, bridgeStatus: 'closed' } }, policy({ allowUnknownRestrictions: true }))
    blocked({ ...a, network: { ...a.network!, bridgeStatus: 'reviewed', bridgeLoadTonnes: 20 } })
    blocked({ ...a, network: { ...a.network!, maxVehicleWeightTonnes: 20 } })
    blocked({ ...a, network: { ...a.network!, seasons: ['winter'] } })
    blocked({ ...a, network: { ...a.network!, vehicleClasses: ['light-vehicle'] } })
    blocked({ ...a, evidence: { ...a.evidence!, condition: 'closed' } }, policy({ allowUnknownCondition: true }))
    blocked({ ...a, evidence: { ...a.evidence!, reuseAllowed: false } })
    expect(
      shortestRoadNetworkPath(
        buildRoadNetwork(
          [{ ...a, network: { ...a.network!, access: 'unknown' } }],
          policy({ allowUnknownAccess: true }),
          at,
        ),
        'a',
        'b',
        cost,
      )?.warnings.join(' '),
    ).toContain('explicitly assumed')
  })

  it('respects road direction and directional known vehicle grade limits', () => {
    const a = road('slope', [point(0, 0), point(100, 0)])
    const at = [
      { id: 'a', coordinate: point(0, 0) },
      { id: 'b', coordinate: point(100, 0) },
    ]
    a.network!.direction = 'forward'
    let graph = buildRoadNetwork([a], policy(), at)
    expect(shortestRoadNetworkPath(graph, 'a', 'b', cost)).not.toBeNull()
    expect(shortestRoadNetworkPath(graph, 'b', 'a', cost)).toBeNull()
    a.network!.direction = 'both'
    a.network!.forwardUphillGradePercent = 12
    a.network!.forwardDownhillGradePercent = 2
    graph = buildRoadNetwork([a], policy({ maxUphillGradePercent: 10, maxDownhillGradePercent: 20 }), at)
    expect(shortestRoadNetworkPath(graph, 'a', 'b', cost)).toBeNull()
    expect(shortestRoadNetworkPath(graph, 'b', 'a', cost)).not.toBeNull()
  })

  it('finds the actual directed return circuit rather than reversing an outbound one-way shortcut', () => {
    const outbound = road('outbound', [point(0, 0), point(100, 0)])
    const returnNorth = road('return-north', [point(100, 0), point(100, 100)])
    const returnWest = road('return-west', [point(100, 100), point(0, 0)])
    for (const input of [outbound, returnNorth, returnWest]) input.network!.direction = 'forward'
    const graph = buildRoadNetwork([outbound, returnNorth, returnWest], policy(), [
      { id: 'source', coordinate: point(0, 0), roadId: outbound.id },
      { id: 'entry', coordinate: point(100, 0), roadId: outbound.id },
    ])
    const loaded = shortestRoadNetworkPath(graph, 'source', 'entry', cost)!
    const empty = shortestRoadNetworkPath(graph, 'entry', 'source', { ...cost, paidCostItemIds: loaded.costItemIds })!
    expect(loaded.roadIds).toEqual(['outbound'])
    expect(empty.roadIds).toEqual(['return-north', 'return-west'])
    expect(empty.lengthM).toBeGreaterThan(loaded.lengthM * 2)
  })

  it('requires current reviewed observations when requested and retains unresolved historical closures', () => {
    const a = road('dated', [point(0, 0), point(100, 0)])
    const at = [
      { id: 'a', coordinate: point(0, 0) },
      { id: 'b', coordinate: point(100, 0) },
    ]
    const current = policy({ requireCurrentConditionEvidence: true })
    expect(buildRoadNetwork([a], current, at).excludedRoads[0].reasons.join(' ')).toContain('current positive')
    const observed = {
      ...a.evidence!,
      observations: [
        {
          id: 'inspection',
          source: 'inspection',
          component: 'overall',
          observedAt: '2026-10-01',
          sourceUrl: 'https://example.org/inspection',
          notes: 'Entered test observation',
          finding: 'serviceable',
          review: { reviewer: 'Test reviewer', reviewedAt: '2026-10-02' },
        },
      ],
      conditionPolicy: { maxInspectionAgeDays: 90, maxImageryAgeDays: null },
    }
    a.evidence = observed as ExistingRoadEvidence
    expect(shortestRoadNetworkPath(buildRoadNetwork([a], current, at), 'a', 'b', cost)).not.toBeNull()
    a.evidence = {
      ...observed,
      observations: [
        {
          ...observed.observations[0],
          finding: 'closed',
          observedAt: '2020-01-01',
          review: { reviewer: 'Test reviewer', reviewedAt: '2020-01-02' },
        },
      ],
    } as ExistingRoadEvidence
    expect(
      buildRoadNetwork([a], policy({ allowUnknownCondition: true }), at).excludedRoads[0].reasons.join(' '),
    ).toContain('closure')
  })

  it('charges road allowances once despite attachment splits and deduplicates overlapping rehabilitation', () => {
    const a = road('shared', [point(0, 0), point(200, 0)])
    Object.assign(a.network!, { rehabilitationCostPerM: 2, accessCost: 50, structureCost: 100, fixedCost: 200 })
    const graph = buildRoadNetwork([a], policy(), [
      { id: 'start', coordinate: point(0, 0) },
      { id: 'mid', coordinate: point(100, 0) },
      { id: 'end', coordinate: point(200, 0) },
    ])
    const first = shortestRoadNetworkPath(graph, 'start', 'mid', { distanceRatePerM: 0 })!
    const second = shortestRoadNetworkPath(graph, 'mid', 'end', {
      distanceRatePerM: 0,
      paidCostItemIds: first.costItemIds,
    })!
    expect(first.totalCost).toBeCloseTo(550, 2)
    expect(second.totalCost).toBeCloseTo(200, 2)
    const whole = shortestRoadNetworkPath(graph, 'start', 'end', { distanceRatePerM: 0 })!
    expect(whole.totalCost).toBeCloseTo(750, 2)
    expect(whole.costItems.filter((item) => item.kind === 'structure')).toHaveLength(1)
    const overlap = shortestRoadNetworkPath(graph, 'start', 'mid', {
      distanceRatePerM: 1,
      paidCostItemIds: whole.costItemIds,
    })!
    expect(overlap.rehabilitationCost).toBe(0)
    expect(overlap.totalCost).toBeCloseTo(100, 2)
  })

  it('selects a longer cheaper connected path and distinguishes unknown prices from zero', () => {
    const direct = road('direct', [point(0, 0), point(100, 0)]),
      detour = road('detour', [point(0, 0), point(50, 100), point(100, 0)])
    direct.network!.fixedCost = 1000
    const at = [
      { id: 'start', coordinate: point(0, 0), roadId: 'direct' },
      { id: 'end', coordinate: point(100, 0), roadId: 'direct' },
    ]
    const graph = buildRoadNetwork([direct, detour], policy(), at)
    expect(shortestRoadNetworkPath(graph, 'start', 'end', cost)!.roadIds).toEqual(['detour'])
    expect(shortestRoadNetworkPath(graph, 'start', 'end', { ...cost, objective: 'distance' })!.roadIds).toEqual([
      'direct',
    ])
    direct.network!.fixedCost = null
    const unknown = buildRoadNetwork([direct], policy(), at)
    expect(shortestRoadNetworkPath(unknown, 'start', 'end', cost)).toBeNull()
    const path = shortestRoadNetworkPath(unknown, 'start', 'end', {
      ...cost,
      objective: 'distance',
      allowUnpricedCosts: true,
    })!
    expect(path.totalCost).toBeNull()
    expect(path.warnings.join(' ')).toContain('unpriced')
  })

  it('preserves explicit unknowns, validates restrictions and refuses oversized rather than partial networks', () => {
    expect(parseRoadNetworkEvidence({}).accessCost).toBeNull()
    expect(parseRoadNetworkEvidence({ accessCost: 0 }).accessCost).toBe(0)
    expect(() => parseRoadNetworkEvidence({ bridgeLoadTonnes: -1 })).toThrow()
    expect(() => parseRoadNetworkPolicy({ asOf: '2026-02-30' })).toThrow()
    const a = road('same', [point(0, 0), point(100, 0)])
    expect(() => buildRoadNetwork([a, a], policy())).toThrow(/Duplicate/)
    expect(() =>
      buildRoadNetwork(
        Array.from({ length: 501 }, (_, i) => ({ ...a, id: `road-${i}` })),
        policy(),
      ),
    ).toThrow(/exceeds/)
    expect(() =>
      buildRoadNetwork([{ ...a, coordinates: Array.from({ length: 20001 }, (_, i) => point(i, 0)) }], policy()),
    ).toThrow(/vertices/)
  })
})
