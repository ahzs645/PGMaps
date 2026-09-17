/**
 * The planning question asked the other way round: given this block, where can
 * it be seen from?
 *
 * The forward run answers "how much of the block does this road see", which
 * needs you to already know which road matters. Working backwards from the
 * polygon finds that for you — every road within view distance is sampled and
 * scored, so the answer is a ranked list of roads rather than a single number.
 *
 * It is the same sightline maths with the ends swapped, so terrain, curvature,
 * refraction and screening all behave identically.
 */

import type { CanopySource } from './canopy'
import type { ElevationSource } from './terrain'
import {
  DEFAULT_SIGHTLINE_OPTIONS,
  haversineMeters,
  lineLengthMeters,
  polygonAreaMeters,
  polygonBounds,
  polygonGridSamples,
  sampleAlongLine,
  testSightline,
  type GroundPoint,
  type PolygonGeometry,
} from './visibility'

export type ReverseRoad = {
  id: string
  name: string
  /** Road class from the basemap, such as `motorway` or `track`. */
  roadClass: string | null
  coordinates: Array<[number, number]>
}

export type ReverseViewshedSettings = {
  observerHeightMeters: number
  targetOffsetMeters: number
  maxViewDistanceMeters: number
  /** Distance between sampled points along each road. */
  stationSpacingMeters: number
  /** Grid samples across the block. Coarser than a forward run: this ranks roads. */
  sampleBudget: number
  demResolutionMeters: number
}

export const DEFAULT_REVERSE_SETTINGS: ReverseViewshedSettings = {
  observerHeightMeters: 1.6,
  targetOffsetMeters: 0,
  maxViewDistanceMeters: 8000,
  stationSpacingMeters: 250,
  sampleBudget: 220,
  demResolutionMeters: 11,
}

/** Hard ceiling on sightlines, so a road-dense view cannot stall the page. */
const MAX_REVERSE_SIGHTLINES = 200_000

export type ReverseStation = {
  lng: number
  lat: number
  roadId: string
  distanceAlongMeters: number
  distanceToBlockMeters: number
  /** Share of the block visible from this point, in percent. */
  visiblePercent: number
}

export type ReverseRoadResult = {
  roadId: string
  name: string
  roadClass: string | null
  lengthMeters: number
  stationCount: number
  /** Stations that can see any part of the block. */
  seeingStationCount: number
  /** Share of the road's length from which the block is visible at all. */
  exposedLengthFraction: number
  /** The most the block is ever exposed from this road, in percent. */
  maxVisiblePercent: number
  /** Mean over the stations that see it at all. */
  meanVisiblePercentWhereSeen: number
  nearestDistanceMeters: number
}

export type ReverseViewshedResult = {
  roads: ReverseRoadResult[]
  stations: ReverseStation[]
  blockAreaMeters: number
  sampleCount: number
  /** Roads dropped for sitting beyond the maximum view distance. */
  outOfRangeRoadCount: number
  elapsedMs: number
}

/** Shortest distance from a point to a bounding box, in metres. */
function distanceToBounds(point: { lng: number; lat: number }, bounds: [number, number, number, number]): number {
  const [minLng, minLat, maxLng, maxLat] = bounds
  return haversineMeters(point, {
    lng: Math.min(maxLng, Math.max(minLng, point.lng)),
    lat: Math.min(maxLat, Math.max(minLat, point.lat)),
  })
}

/**
 * Scores every road by how much of the block it can see.
 *
 * Roads are sampled rather than the landscape at large: a viewshed over open
 * ground is mostly places nobody stands, whereas "which road sees this, and for
 * how long" is the question a visual assessment actually turns on.
 */
export function computeReverseViewshed(
  source: ElevationSource,
  blocks: PolygonGeometry[],
  roads: ReverseRoad[],
  settings: ReverseViewshedSettings = DEFAULT_REVERSE_SETTINGS,
  canopy?: CanopySource,
): ReverseViewshedResult {
  const startedAt = Date.now()
  if (blocks.length === 0 || roads.length === 0) {
    return {
      roads: [],
      stations: [],
      blockAreaMeters: 0,
      sampleCount: 0,
      outOfRangeRoadCount: 0,
      elapsedMs: 0,
    }
  }

  const blockArea = blocks.reduce((total, block) => total + polygonAreaMeters(block), 0)
  const spacing = Math.max(
    settings.demResolutionMeters * 0.75,
    Math.sqrt(Math.max(1, blockArea) / Math.max(1, settings.sampleBudget)),
  )

  const samples: GroundPoint[] = blocks
    .flatMap((block) => polygonGridSamples(block, spacing))
    .map((sample) => ({
      lng: sample.lng,
      lat: sample.lat,
      groundElevationMeters: source.elevationAt(sample.lng, sample.lat),
    }))
    .filter((sample) => !Number.isNaN(sample.groundElevationMeters))

  const blockBounds = blocks.reduce<[number, number, number, number]>(
    (box, block) => {
      const bounds = polygonBounds(block)
      return [
        Math.min(box[0], bounds[0]),
        Math.min(box[1], bounds[1]),
        Math.max(box[2], bounds[2]),
        Math.max(box[3], bounds[3]),
      ]
    },
    [Infinity, Infinity, -Infinity, -Infinity],
  )

  const options = {
    ...DEFAULT_SIGHTLINE_OPTIONS,
    observerHeightMeters: settings.observerHeightMeters,
    targetOffsetMeters: settings.targetOffsetMeters,
    maxDistanceMeters: settings.maxViewDistanceMeters,
    stepMeters: Math.max(5, settings.demResolutionMeters * 0.9),
  }

  // Thin the stations rather than the block grid if the view holds a lot of
  // road: a coarse block still ranks roads correctly, too few stations misses
  // the one bend that sees it.
  const roadLengths = roads.map((road) => lineLengthMeters(road.coordinates))
  const estimatedStations = roadLengths.reduce(
    (total, length) => total + Math.max(2, Math.ceil(length / settings.stationSpacingMeters)),
    0,
  )
  const budgetedSpacing =
    estimatedStations * samples.length > MAX_REVERSE_SIGHTLINES
      ? settings.stationSpacingMeters * ((estimatedStations * samples.length) / MAX_REVERSE_SIGHTLINES)
      : settings.stationSpacingMeters

  const stations: ReverseStation[] = []
  const results: ReverseRoadResult[] = []
  let outOfRangeRoadCount = 0

  roads.forEach((road, roadIndex) => {
    const lengthMeters = roadLengths[roadIndex]
    const roadStations = sampleAlongLine(road.coordinates, budgetedSpacing)
    if (roadStations.length === 0) return

    // A road whose closest point is already beyond the view distance cannot see
    // anything, and skipping it here saves walking every sightline to find out.
    const nearest = roadStations.reduce(
      (closest, station) => Math.min(closest, distanceToBounds(station, blockBounds)),
      Number.POSITIVE_INFINITY,
    )
    if (nearest > settings.maxViewDistanceMeters) {
      outOfRangeRoadCount += 1
      return
    }

    let seeingStations = 0
    let maxVisiblePercent = 0
    let visibleSum = 0
    let nearestDistance = Number.POSITIVE_INFINITY

    for (const station of roadStations) {
      const observer: GroundPoint = {
        lng: station.lng,
        lat: station.lat,
        groundElevationMeters: source.elevationAt(station.lng, station.lat),
      }
      if (Number.isNaN(observer.groundElevationMeters)) continue

      let visibleSamples = 0
      let closest = Number.POSITIVE_INFINITY
      for (const sample of samples) {
        const result = testSightline(source, observer, sample, options, canopy)
        if (!result.visible) continue
        visibleSamples += 1
        if (result.distanceMeters < closest) closest = result.distanceMeters
      }

      const visiblePercent = samples.length > 0 ? (visibleSamples / samples.length) * 100 : 0
      stations.push({
        lng: station.lng,
        lat: station.lat,
        roadId: road.id,
        distanceAlongMeters: station.distanceAlongMeters,
        distanceToBlockMeters: Number.isFinite(closest) ? closest : distanceToBounds(station, blockBounds),
        visiblePercent,
      })

      if (visiblePercent > 0) {
        seeingStations += 1
        visibleSum += visiblePercent
        if (visiblePercent > maxVisiblePercent) maxVisiblePercent = visiblePercent
        if (closest < nearestDistance) nearestDistance = closest
      }
    }

    results.push({
      roadId: road.id,
      name: road.name,
      roadClass: road.roadClass,
      lengthMeters,
      stationCount: roadStations.length,
      seeingStationCount: seeingStations,
      exposedLengthFraction: roadStations.length > 0 ? seeingStations / roadStations.length : 0,
      maxVisiblePercent,
      meanVisiblePercentWhereSeen: seeingStations > 0 ? visibleSum / seeingStations : 0,
      nearestDistanceMeters: Number.isFinite(nearestDistance) ? nearestDistance : Number.POSITIVE_INFINITY,
    })
  })

  // Worst first: the road that sees the most of the block is the one an
  // assessment gets written from.
  results.sort((a, b) => b.maxVisiblePercent - a.maxVisiblePercent || a.nearestDistanceMeters - b.nearestDistanceMeters)

  return {
    roads: results,
    stations,
    blockAreaMeters: blockArea,
    sampleCount: samples.length,
    outOfRangeRoadCount,
    elapsedMs: Date.now() - startedAt,
  }
}

/**
 * The searched roads themselves, graded by exposure.
 *
 * Same reasoning as the forward corridor: stations are a sampling interval, not
 * a property of the road, and a line of dots reads as the former. Each segment
 * joins two consecutive stations on one road and carries the mean of their two
 * figures, so nothing is drawn that was not computed.
 */
export function reverseRoadsToGeoJson(result: ReverseViewshedResult | null): GeoJSON.FeatureCollection {
  if (!result) return { type: 'FeatureCollection', features: [] }

  const byRoad = new Map<string, ReverseStation[]>()
  for (const station of result.stations) {
    const existing = byRoad.get(station.roadId)
    if (existing) existing.push(station)
    else byRoad.set(station.roadId, [station])
  }

  const features: GeoJSON.Feature[] = []
  for (const [roadId, stations] of byRoad) {
    // Stations come back in the order they were walked, but sorting makes the
    // segments independent of that and costs nothing at these counts.
    stations.sort((a, b) => a.distanceAlongMeters - b.distanceAlongMeters)
    for (let index = 1; index < stations.length; index += 1) {
      const from = stations[index - 1]
      const to = stations[index]
      const id = `${roadId}-seg-${index}`
      features.push({
        type: 'Feature',
        id,
        geometry: {
          type: 'LineString',
          coordinates: [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ],
        },
        properties: {
          id,
          roadId,
          visiblePercent: (from.visiblePercent + to.visiblePercent) / 2,
          seen: from.visiblePercent > 0 || to.visiblePercent > 0 ? 1 : 0,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** Sampled road points as map features, for colouring by exposure. */
export function reverseStationsToGeoJson(result: ReverseViewshedResult | null): GeoJSON.FeatureCollection {
  if (!result) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: result.stations.map((station, index) => ({
      type: 'Feature',
      id: `${station.roadId}-${index}`,
      geometry: { type: 'Point', coordinates: [station.lng, station.lat] },
      properties: {
        id: `${station.roadId}-${index}`,
        roadId: station.roadId,
        visiblePercent: station.visiblePercent,
        seen: station.visiblePercent > 0 ? 1 : 0,
        distanceKm: station.distanceToBlockMeters / 1000,
      },
    })),
  }
}
