/** Preliminary horizontal map/search envelopes. These are not surveyed slope-distance or legal boundaries. */
import booleanIntersects from '@turf/boolean-intersects'
import buffer from '@turf/buffer'
import { resolveConstraint } from './constraints'
import {
  RIPARIAN_WIDTHS,
  streamStatus,
  suggestRiparianClass,
  type RiparianClass,
  type StreamStatus,
} from './streamClass'
import type { ContextFeature, Coordinate } from './types'

export const UNKNOWN_RIPARIAN_SCREEN_M = 100
const BUFFER_STEPS = 8
// Turf approximates round caps with inscribed chords. Expand by their maximum radial deficit so
// the chord between adjacent vertices does not cut inside the nominal horizontal screen.
const BUFFER_CHORD_FACTOR = 1 / Math.cos(Math.PI / (4 * BUFFER_STEPS))
/** Radius used to construct the conservative polygon; nominal dimensions remain separate. */
export const conservativeRiparianRadiusM = (radiusM: number): number => radiusM * BUFFER_CHORD_FACTOR
export const RIPARIAN_MAP_COLORS = { reserve: '#7c3aed', management: '#0d9488', uncertain: '#d97706' } as const
export interface RiparianArea {
  riparianClass: RiparianClass | null
  status: StreamStatus
  uncertain: boolean
  channelHalfWidthM: number | null
  reserveM: number
  managementM: number
  outerRadiusM: number
  note: string
  outer: GeoJSON.Polygon | GeoJSON.MultiPolygon
  reserve: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
}
const cache = new WeakMap<ContextFeature, RiparianArea>()

/** Includes half the measured channel width before adding the bank-based minimum widths. */
export function riparianArea(stream: ContextFeature): RiparianArea | null {
  if (stream.kind !== 'stream' || stream.geometry.type !== 'LineString') return null
  const cached = cache.get(stream)
  if (cached) return cached
  const assessment = stream.streamAssessment
  const status = streamStatus(assessment, stream.geometry.coordinates)
  const suggestion = assessment ? suggestRiparianClass(assessment) : null
  const riparianClass =
    status === 'reviewed'
      ? assessment!.reviewedClass!
      : status === 'needs-review'
        ? null
        : (suggestion?.riparianClass ?? null)
  const channelHalfWidthM =
    assessment?.channelWidthM != null && assessment.channelWidthM > 0 ? assessment.channelWidthM / 2 : null
  // An unresolved or stale class never creates an empty constraint. This 100 m envelope is a
  // planning screen only: missing bank/floodplain data can extend the real area beyond it.
  const uncertain =
    !riparianClass ||
    channelHalfWidthM === null ||
    (riparianClass === 'S1-B' && status !== 'reviewed' && assessment?.oneKmAverageWidthM == null)
  const widths = riparianClass
    ? RIPARIAN_WIDTHS[riparianClass]
    : { reserveM: 0, managementM: UNKNOWN_RIPARIAN_SCREEN_M }
  const reserveM = widths.reserveM
  const managementM = uncertain
    ? Math.max(widths.managementM, UNKNOWN_RIPARIAN_SCREEN_M - reserveM)
    : widths.managementM
  const outerRadiusM = (channelHalfWidthM ?? 0) + reserveM + managementM
  const coordinates = stream.geometry.coordinates
  const envelope = (radius: number) => {
    const reach: GeoJSON.LineString = {
      type: 'LineString',
      coordinates: coordinates.map((p) => [p[0], p[1]]),
    }
    const result = buffer(reach, conservativeRiparianRadiusM(radius), {
      units: 'meters',
      steps: BUFFER_STEPS,
    })
    if (!result || (result.geometry.type !== 'Polygon' && result.geometry.type !== 'MultiPolygon'))
      throw Error(`Cannot construct the riparian screening area for ${stream.name}.`)
    return result.geometry
  }
  const result: RiparianArea = {
    riparianClass,
    status,
    uncertain,
    channelHalfWidthM,
    reserveM,
    managementM,
    outerRadiusM,
    outer: envelope(outerRadiusM),
    reserve: reserveM > 0 ? envelope((channelHalfWidthM ?? 0) + reserveM) : null,
    note: uncertain
      ? `Unresolved riparian extent: ${UNKNOWN_RIPARIAN_SCREEN_M} m horizontal screening allowance beyond ${channelHalfWidthM === null ? 'the mapped centreline (channel width unknown)' : 'the estimated bank'}. Stale classes are not used. Verify banks, slope distance and active floodplain extent.`
      : `${riparianClass} preliminary horizontal screen: channel half-width ${channelHalfWidthM} m + reserve ${reserveM} m + management ${managementM} m each side. Verify banks, slope distance and active floodplain extent.`,
  }
  cache.set(stream, result)
  return result
}

export function riparianMapFeatures(context: readonly ContextFeature[]): GeoJSON.Feature[] {
  return context.flatMap((stream) => {
    const area = riparianArea(stream)
    if (!area) return []
    const properties = {
      kind: 'stream',
      streamId: stream.id,
      name: stream.name,
      screening: true,
      preliminary: true,
      riparianClass: area.riparianClass,
      note: area.note,
    }
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        geometry: area.outer,
        properties: { ...properties, riparianBand: area.uncertain ? 'uncertain' : 'management' },
      },
    ]
    if (area.reserve)
      features.push({ type: 'Feature', geometry: area.reserve, properties: { ...properties, riparianBand: 'reserve' } })
    return features
  })
}

/** Search-only metadata is never persisted as a project feature. */
export interface RoutingContextFeature extends ContextFeature {
  searchPenaltyPerM?: number
}
/** Converts policy into the existing router's blocked/priced polygons; retains stream crossing prices. */
export function routingContext(context: readonly ContextFeature[]): RoutingContextFeature[] {
  return context.flatMap((feature) => {
    if (feature.kind === 'avoid') {
      const resolved = resolveConstraint(feature)
      return [
        {
          ...feature,
          constraint: undefined,
          routeCostPerM: resolved.blocked ? undefined : resolved.costPerM,
          searchPenaltyPerM: resolved.policy.treatment === 'avoid-where-practical' ? resolved.costPerM : 0,
        },
      ]
    }
    const area = riparianArea(feature)
    if (!area) return [feature]
    const resolved = resolveConstraint(feature)
    const polygons = area.outer.type === 'Polygon' ? [area.outer.coordinates] : area.outer.coordinates
    return [
      feature,
      ...polygons.map(
        (coordinates, i): RoutingContextFeature => ({
          id: `${feature.id}:riparian:${i}`,
          name: `${feature.name} riparian screening area`,
          kind: 'avoid',
          geometry: { type: 'Polygon', coordinates },
          ...(resolved.blocked ? {} : { routeCostPerM: resolved.costPerM }),
          searchPenaltyPerM: resolved.policy.treatment === 'avoid-where-practical' ? resolved.costPerM : 0,
        }),
      ),
    ]
  })
}

/** Final fitted-centreline gate, including boundary touches and short intersections between samples. */
export function constraintRouteIssues(
  coordinates: readonly Coordinate[],
  context: readonly ContextFeature[],
): string[] {
  if (coordinates.length < 2) return []
  const route: GeoJSON.LineString = { type: 'LineString', coordinates: coordinates.map((p) => [...p]) }
  const issues: string[] = []
  for (const feature of context) {
    if (feature.kind !== 'avoid' && feature.kind !== 'stream') continue
    const resolved = resolveConstraint(feature)
    if (!resolved.blocked) continue
    const geometry = feature.kind === 'stream' ? riparianArea(feature)?.outer : feature.geometry
    if (geometry && booleanIntersects(route, geometry))
      issues.push(
        `${feature.name}: ${resolved.policy.treatment === 'conditional' ? `conditional ${feature.kind === 'stream' ? 'riparian ' : ''}review ${resolved.reviewStatus}` : 'excluded area'} intersects the fitted route.`,
      )
  }
  return issues
}
