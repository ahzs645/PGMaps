import booleanIntersects from '@turf/boolean-intersects'
import { describe, expect, it } from 'vitest'
import { constraintFingerprint, parseConstraintPolicy, resolveConstraint, type ConstraintPolicy } from './constraints'
import { corridorFrame, optimizeRoadCorridor } from './corridorOptimizer'
import { importContextGeoJson, parseProject, projectGeoJson, serializeProject } from './project'
import {
  blockedRouteEnds,
  conservativeRiparianRadiusM,
  constraintRouteIssues,
  riparianArea,
  riparianMapFeatures,
  routingContext,
} from './riparian'
import { suggestRoutes } from './routing'
import {
  assessmentFingerprint,
  EMPTY_STREAM_ASSESSMENT,
  RIPARIAN_RULES,
  streamStatus,
  type StreamAssessment,
} from './streamClass'
import { createDemoProject, DEFAULT_ROAD_SETTINGS } from './terrain'
import type { ContextFeature } from './types'

const frame = corridorFrame([-122.72, 53.89])
const p = (x: number, y: number) => frame.fromXY([x, y])
const lineString = (coordinates: GeoJSON.Position[]): GeoJSON.LineString => ({ type: 'LineString', coordinates })
const flat = { elevationAt: () => 700 }
const settings = { ...DEFAULT_ROAD_SETTINGS, maxGradePercent: 12, minRadius: 20 }
const stream = (assessment?: Partial<StreamAssessment>): ContextFeature => ({
  id: 'creek',
  name: 'Test creek',
  kind: 'stream',
  geometry: { type: 'LineString', coordinates: [p(200, -50), p(200, 50)] },
  ...(assessment ? { streamAssessment: { ...EMPTY_STREAM_ASSESSMENT, ...assessment } } : {}),
})
const area = (policy?: ConstraintPolicy): ContextFeature => ({
  id: 'zone',
  name: 'Test area',
  kind: 'avoid',
  geometry: { type: 'Polygon', coordinates: [[p(150, -700), p(250, -700), p(250, 700), p(150, 700), p(150, -700)]] },
  ...(policy ? { constraint: policy } : {}),
})
const review = (feature: ContextFeature): ContextFeature => {
  const policy: ConstraintPolicy = {
    treatment: 'conditional',
    condition: 'Use the reviewed crossing location and measures.',
  }
  policy.review = {
    reviewer: 'Test reviewer',
    reviewedOn: '2026-11-07',
    basis: 'Recorded preliminary crossing plan.',
    fingerprint: constraintFingerprint(feature, policy),
  }
  return { ...feature, ...(feature.kind === 'stream' ? { riparianPolicy: policy } : { constraint: policy }) }
}
const route = (context: ContextFeature[]) =>
  suggestRoutes(p(0, 0), p(400, 0), flat, settings, context, { crossingCost: 1 }).routes[0]

describe('explicit planning constraints', () => {
  it('preserves legacy excluded and priced polygons', () => {
    expect(resolveConstraint(area()).blocked).toBe(true)
    const legacy = { ...area(), routeCostPerM: 50 }
    expect(resolveConstraint(legacy)).toMatchObject({ blocked: false, costPerM: 50, estimateCost: true })
    expect(route([legacy]).cost).toBeCloseTo(45000, -3)
    expect(() => route([area()])).toThrow(/No terrain-cost path/)
  })
  it('blocks conditional polygons until a current recorded condition review exists', () => {
    const pending = area({ treatment: 'conditional', condition: 'Review use.' })
    expect(() => route([pending])).toThrow(/No terrain-cost path/)
    const reviewed = review(pending)
    expect(resolveConstraint(reviewed)).toMatchObject({ blocked: false, reviewStatus: 'current' })
    expect(route([reviewed]).lengthM).toBeCloseTo(400, -1)
    const changed = { ...reviewed, constraint: { ...reviewed.constraint!, condition: 'Different condition' } }
    expect(resolveConstraint(changed)).toMatchObject({ blocked: true, reviewStatus: 'stale' })
    expect(() => route([changed])).toThrow(/No terrain-cost path/)
  })
  it('distinguishes avoidance penalties from additional construction allowances', () => {
    const avoidance = area({ treatment: 'avoid-where-practical', costPerM: 50 })
    const priced = area({ treatment: 'additional-cost', costPerM: 50 })
    expect(resolveConstraint(avoidance).estimateCost).toBe(false)
    expect(resolveConstraint(priced).estimateCost).toBe(true)
    const avoidedRoute = route([avoidance]),
      pricedRoute = route([priced])
    expect(avoidedRoute.searchScore).toBeCloseTo(pricedRoute.searchScore, 5)
    expect(avoidedRoute.cost).toBeCloseTo(40000, -3)
    expect(pricedRoute.cost).toBeCloseTo(45000, -3)
    expect(avoidedRoute.avoidancePenalty).toBeCloseTo(5000, -3)
    expect(pricedRoute.avoidancePenalty).toBe(0)
    expect(() => parseConstraintPolicy({ treatment: 'avoid-where-practical', costPerM: 0 })).toThrow(/positive/)
    expect(() => parseConstraintPolicy({ treatment: 'additional-cost' })).toThrow(/explicit/)
    expect(() => parseConstraintPolicy({ treatment: 'conditional', review: { reviewer: 'x' } })).toThrow()
  })
  it('retains a current review when saving normalizes surrounding condition whitespace', () => {
    const feature = area({ treatment: 'conditional', condition: '  Review the crossing location.  ' })
    feature.constraint!.review = {
      reviewer: 'Fixture reviewer',
      reviewedOn: '2026-11-07',
      basis: 'Location checked.',
      fingerprint: constraintFingerprint(feature),
    }
    expect(resolveConstraint(feature).reviewStatus).toBe('current')
    const restored = parseProject(serializeProject({ ...createDemoProject(), context: [feature] })).context[0]
    expect(restored.constraint!.condition).toBe('Review the crossing location.')
    expect(resolveConstraint(restored).reviewStatus).toBe('current')
  })
  it('does not bypass a pending constraint when the corridor search is used', () => {
    expect(() =>
      optimizeRoadCorridor(
        [p(0, 0), p(400, 0)],
        flat,
        settings,
        [area({ treatment: 'conditional', condition: 'Review' })],
        { objective: 'shortest', corridorHalfWidthM: 80, maxStates: 2000 },
      ),
    ).toThrow()
    const result = optimizeRoadCorridor([p(0, 0), p(400, 0)], flat, settings, [review(area())], {
      objective: 'shortest',
      corridorHalfWidthM: 80,
    })
    expect(result.lengthM).toBeCloseTo(400, 3)
  })
  it('steers around an avoid-where-practical area when a detour is cheaper than its penalty', () => {
    const zone: ContextFeature = {
      ...area({ treatment: 'avoid-where-practical', costPerM: 1 }),
      geometry: { type: 'Polygon', coordinates: [[p(150, -30), p(250, -30), p(250, 30), p(150, 30), p(150, -30)]] },
    }
    const low = route([zone])
    const high = route([{ ...zone, constraint: { treatment: 'avoid-where-practical', costPerM: 100000 } }])
    expect(low.avoidancePenalty).toBeGreaterThan(90)
    expect(high.avoidancePenalty).toBe(0)
    expect(high.lengthM).toBeGreaterThan(low.lengthM)
    expect(high.cost).toBeCloseTo(high.searchScore, 6)
  })
})

describe('a road end inside an area closed to routes', () => {
  // The creek runs along x = 200; unclassified, it screens 100 m either side until its review is recorded.
  const near =
    'The road\u2019s start is 50 m from Test creek, inside its 100 m riparian screening area, which is closed to routes until its review is recorded. Move that end at least 51 m further from the stream, or record the review or change the stream\u2019s route treatment under Terrain → Streams.'.replaceAll(
      '\u2019',
      "'",
    )
  it('names the end, the stream, the distance and what to change', () => {
    expect(blockedRouteEnds(p(150, 0), p(600, 0), [stream()])).toEqual([
      { end: 'start', featureId: 'creek', message: near },
    ])
    // Both ends, each with its own feature and distance.
    const both = blockedRouteEnds(p(-300, 0), p(200, 600), [stream(), area()])
    expect(both.map((entry) => entry.end)).toEqual(['end'])
    expect(both[0].message).toBe(
      "The road's end is inside Test area, an area excluded. Move that end outside it, or change its treatment under Terrain → Constraints.",
    )
    // A reviewed crossing, a priced area and a clear end block nothing.
    expect(blockedRouteEnds(p(150, 0), p(600, 0), [review(stream())])).toEqual([])
    expect(blockedRouteEnds(p(200, 0), p(600, 0), [area({ treatment: 'additional-cost', costPerM: 5 })])).toEqual([])
    expect(blockedRouteEnds(p(-300, 0), p(600, 0), [stream(), area()])).toEqual([])
  })
  it('is what both searches say, instead of an unnamed endpoint and exclusion', () => {
    expect(() =>
      optimizeRoadCorridor([p(150, 0), p(600, 0)], flat, settings, [stream()], {
        objective: 'shortest',
        corridorHalfWidthM: 80,
      }),
    ).toThrow(near)
    expect(() => suggestRoutes(p(150, 0), p(600, 0), flat, settings, [stream()], { crossingCost: 1 })).toThrow(near)
  })
})

describe('riparian geometry and search', () => {
  it('adds half the measured channel width to the reserve and total screening widths', () => {
    const creek = stream({ channelWidthM: 8, fish: 'present', communityWatershed: 'outside' })
    const result = riparianArea(creek)!
    expect(result).toMatchObject({
      riparianClass: 'S2',
      uncertain: false,
      channelHalfWidthM: 4,
      reserveM: 30,
      managementM: 20,
      outerRadiusM: 54,
    })
    expect(booleanIntersects(lineString([p(147, -10), p(147, 10)]), result.outer)).toBe(true)
    expect(booleanIntersects(lineString([p(145, -10), p(145, 10)]), result.outer)).toBe(false)
    expect(conservativeRiparianRadiusM(result.outerRadiusM)).toBeGreaterThan(54.2)
    expect(conservativeRiparianRadiusM(result.outerRadiusM)).toBeLessThan(54.3)
    expect(booleanIntersects(lineString([p(145.8, -10), p(145.8, 10)]), result.outer)).toBe(true)
    // At the midpoint of each polygon cap chord, a route within the nominal radius must still block.
    const angle = Math.PI / 32
    const nearCap = p(200 + 53.99 * Math.sin(angle), 50 + 53.99 * Math.cos(angle))
    expect(
      constraintRouteIssues([nearCap, p(200 + 53.99 * Math.sin(angle) + 0.001, 50 + 53.99 * Math.cos(angle))], [creek]),
    ).toHaveLength(1)
    expect(riparianMapFeatures([creek]).map((f) => f.properties?.riparianBand)).toEqual(['management', 'reserve'])
  })
  it('keeps unknown and stale classifications uncertain, and never removes their constraint', () => {
    const unknown = stream()
    expect(riparianArea(unknown)).toMatchObject({
      riparianClass: null,
      uncertain: true,
      channelHalfWidthM: null,
      outerRadiusM: 100,
    })
    expect(routingContext([unknown])).toHaveLength(2)
    expect(resolveConstraint(unknown).blocked).toBe(true)
    const creek = stream({
      channelWidthM: 2,
      fish: 'present',
      reviewedClass: 'S3',
      reviewedRules: 'old-rules',
      reviewedFingerprint: 'old',
    })
    expect(riparianArea(creek)).toMatchObject({ riparianClass: null, uncertain: true, outerRadiusM: 101 })
    expect(streamStatus(creek.streamAssessment, creek.geometry.coordinates)).toBe('needs-review')
  })
  it('changes the actual search path with class widths, without authorizing a crossing', () => {
    const small = stream({ channelWidthM: 2, fish: 'absent-assessed', communityWatershed: 'outside' })
    const large = stream({ channelWidthM: 8, fish: 'present', communityWatershed: 'outside' })
    const a = route([small]),
      b = route([large])
    expect(a.crossings).toBe(0)
    expect(b.crossings).toBe(0)
    expect(b.lengthM).toBeGreaterThan(a.lengthM + 10)
    expect(constraintRouteIssues(a.coordinates, [small])).toEqual([])
    expect(constraintRouteIssues(b.coordinates, [large])).toEqual([])
  })
  it('enables an explicitly reviewed crossing and invalidates it after evidence or geometry edits', () => {
    const creek = review(stream({ channelWidthM: 2, fish: 'present' }))
    expect(route([creek]).crossings).toBe(1)
    const changed = { ...creek, streamAssessment: { ...creek.streamAssessment!, channelWidthM: 6 } }
    expect(resolveConstraint(changed).reviewStatus).toBe('stale')
    expect(route([changed]).crossings).toBe(0)
    const moved = { ...creek, geometry: { type: 'LineString' as const, coordinates: [p(210, -50), p(210, 50)] } }
    expect(resolveConstraint(moved).reviewStatus).toBe('stale')
  })
  it('rejects final fitted routes that cross between their sampled vertices, while retaining holes', () => {
    expect(constraintRouteIssues([p(0, 0), p(400, 0)], [stream()])[0]).toContain('conditional riparian review pending')
    const hole = area()
    if (hole.geometry.type !== 'Polygon') throw Error('fixture')
    hole.geometry.coordinates.push([p(170, -10), p(230, -10), p(230, 10), p(170, 10), p(170, -10)])
    expect(constraintRouteIssues([p(180, 0), p(220, 0)], [hole])).toEqual([])
    expect(constraintRouteIssues([p(100, 0), p(300, 0)], [hole])).toHaveLength(1)
  })
  it('invalidates class reviews when the rules version changes even with identical geometry', () => {
    const creek = stream({
      channelWidthM: 2,
      fish: 'present',
      reviewedClass: 'S3',
      reviewedRules: `${RIPARIAN_RULES.id}@${RIPARIAN_RULES.consolidatedTo}`,
    })
    creek.streamAssessment!.reviewedFingerprint = assessmentFingerprint(
      creek.streamAssessment!,
      creek.geometry.coordinates,
    )
    expect(streamStatus(creek.streamAssessment, creek.geometry.coordinates)).toBe('reviewed')
    const changed = { ...creek.streamAssessment!, reviewedRules: 'fppr-s47@old' }
    expect(streamStatus(changed, creek.geometry.coordinates)).toBe('needs-review')
  })
  it('roundtrips policies and current review scope through project JSON and context GeoJSON', () => {
    const creek = review(stream({ channelWidthM: 2, fish: 'present', widthBasis: 'field', notes: 'Evidence retained' }))
    const zone = review(area())
    const project = { ...createDemoProject(), context: [creek, zone] }
    const restored = parseProject(JSON.parse(serializeProject(project)))
    expect(restored.context.map((f) => resolveConstraint(f).reviewStatus)).toEqual(['current', 'current'])
    const features = projectGeoJson({ ...project, alignments: [] }, new Map())
    const imported = importContextGeoJson({
      ...features,
      features: features.features.filter((f) => ['stream', 'avoid'].includes(f.properties?.kind)),
    })
    expect(imported.map((f) => resolveConstraint(f).reviewStatus)).toEqual(['current', 'current'])
    expect(imported[0].riparianPolicy).toEqual(creek.riparianPolicy)
  })
})
