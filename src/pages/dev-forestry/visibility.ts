/**
 * Line-of-sight and sampling maths for the visual-quality utility.
 *
 * Nothing here touches the network or the DOM: an {@link ElevationSource} is
 * the only input, so the same functions run in the analysis worker and in unit
 * tests against synthetic terrain.
 */

import { EARTH_RADIUS_METERS, lngLatToMercator, mercatorToLngLat, type ElevationSource } from './terrain'

export type GeoPoint = { lng: number; lat: number }

/** A point on the ground plus the elevation already read from the DEM. */
export type GroundPoint = GeoPoint & { groundElevationMeters: number }

export type SightlineOptions = {
  /** Eye height above the road surface, in metres. */
  observerHeightMeters: number
  /** Height added to the target's ground elevation — 0 for a bare cutblock floor. */
  targetOffsetMeters: number
  /** Ground distance between profile samples, in metres. */
  stepMeters: number
  /** Beyond this the target counts as out of view regardless of terrain. */
  maxDistanceMeters: number
  /**
   * Atmospheric refraction coefficient. 0.13 is the standard survey value: it
   * bends the ray downwards, so distant ground stays visible slightly further
   * than pure geometry would allow.
   */
  refractionCoefficient: number
  /**
   * How far terrain must rise above the ray before it counts as blocking.
   * Absorbs DEM interpolation noise near the target, where the ground and the
   * ray necessarily converge.
   */
  clearanceMeters: number
}

export const DEFAULT_SIGHTLINE_OPTIONS: SightlineOptions = {
  observerHeightMeters: 1.6,
  targetOffsetMeters: 0,
  stepMeters: 20,
  maxDistanceMeters: 12000,
  refractionCoefficient: 0.13,
  clearanceMeters: 0.5,
}

/** Hard cap on profile samples so one very long sightline cannot stall a run. */
const MAX_PROFILE_STEPS = 1200

export type SightlineResult = {
  visible: boolean
  distanceMeters: number
  /** Distance along the profile where terrain first cut the ray, or null when clear. */
  blockedAtMeters: number | null
}

/**
 * How far a distant point drops below the observer's horizontal plane, after
 * refraction. Subtracting it from both the terrain profile and the target
 * keeps long sightlines honest — over 10 km it is already ~6.9 m.
 */
export function earthCurvatureDropMeters(distanceMeters: number, refractionCoefficient = 0.13): number {
  return ((1 - refractionCoefficient) * distanceMeters * distanceMeters) / (2 * EARTH_RADIUS_METERS)
}

/** Great-circle distance in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Compass bearing in degrees from `a` to `b`, 0 = north. */
export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const toRad = Math.PI / 180
  const dLng = (b.lng - a.lng) * toRad
  const lat1 = a.lat * toRad
  const lat2 = b.lat * toRad
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Metres per degree of longitude and latitude near a latitude. */
export function metersPerDegree(latitude: number): { lng: number; lat: number } {
  const rad = (latitude * Math.PI) / 180
  return {
    lng: (Math.PI / 180) * EARTH_RADIUS_METERS * Math.cos(rad),
    lat: (Math.PI / 180) * EARTH_RADIUS_METERS,
  }
}

function sampleElevation(source: ElevationSource, mercX: number, mercY: number): number {
  if (source.elevationAtMercator) return source.elevationAtMercator(mercX, mercY)
  const [lng, lat] = mercatorToLngLat(mercX, mercY)
  return source.elevationAt(lng, lat)
}

/**
 * Whether the observer's eye can see the target over the intervening terrain.
 *
 * The test walks the ground profile once, comparing each terrain sample
 * against the straight ray to the target rather than tracking a running
 * horizon: the target's elevation is known up front, so the walk can stop at
 * the first obstruction. Terrain the DEM does not cover is skipped rather than
 * treated as sea level, which would invent sightlines through unloaded ground.
 */
export function testSightline(
  source: ElevationSource,
  observer: GroundPoint,
  target: GroundPoint,
  options: SightlineOptions,
): SightlineResult {
  const distanceMeters = haversineMeters(observer, target)
  if (distanceMeters > options.maxDistanceMeters) {
    return { visible: false, distanceMeters, blockedAtMeters: null }
  }

  const eyeElevation = observer.groundElevationMeters + options.observerHeightMeters
  const targetElevation = target.groundElevationMeters + options.targetOffsetMeters
  if (!Number.isFinite(eyeElevation) || !Number.isFinite(targetElevation)) {
    return { visible: false, distanceMeters, blockedAtMeters: null }
  }
  if (distanceMeters < 1) return { visible: true, distanceMeters, blockedAtMeters: null }

  // Slope of the ray, in metres of rise per metre of ground distance.
  const apparentTarget = targetElevation - earthCurvatureDropMeters(distanceMeters, options.refractionCoefficient)
  const raySlope = (apparentTarget - eyeElevation) / distanceMeters

  const steps = Math.min(MAX_PROFILE_STEPS, Math.max(2, Math.ceil(distanceMeters / options.stepMeters)))
  const start = lngLatToMercator(observer.lng, observer.lat)
  const end = lngLatToMercator(target.lng, target.lat)
  const stepX = (end[0] - start[0]) / steps
  const stepY = (end[1] - start[1]) / steps
  const stepDistance = distanceMeters / steps
  const curvatureFactor = (1 - options.refractionCoefficient) / (2 * EARTH_RADIUS_METERS)

  // A run walks tens of millions of these steps, so the profile advances by
  // increments and compares terrain against a single precomputed limit rather
  // than recomputing positions and curvature through helper calls.
  let mercX = start[0]
  let mercY = start[1]
  let groundDistance = 0

  for (let step = 1; step < steps; step += 1) {
    mercX += stepX
    mercY += stepY
    groundDistance += stepDistance

    const terrain = sampleElevation(source, mercX, mercY)
    if (Number.isNaN(terrain)) continue

    // Terrain blocks once it rises above the ray, after allowing for the drop
    // it takes over this distance and for interpolation noise.
    const limit =
      eyeElevation +
      raySlope * groundDistance +
      curvatureFactor * groundDistance * groundDistance +
      options.clearanceMeters
    if (terrain > limit) {
      return { visible: false, distanceMeters, blockedAtMeters: groundDistance }
    }
  }

  return { visible: true, distanceMeters, blockedAtMeters: null }
}

export type CorridorStation = GeoPoint & {
  /** Distance travelled from the start of the line, in metres. */
  distanceAlongMeters: number
}

/** Total length of a `[lng, lat]` polyline, in metres. */
export function lineLengthMeters(coordinates: ReadonlyArray<readonly [number, number]>): number {
  let total = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    const [aLng, aLat] = coordinates[index - 1]
    const [bLng, bLat] = coordinates[index]
    total += haversineMeters({ lng: aLng, lat: aLat }, { lng: bLng, lat: bLat })
  }
  return total
}

/**
 * Evenly spaced stations along a polyline, always including both ends.
 *
 * These are the places a viewer stops — one per station for a driven corridor,
 * or the single point of a spot viewpoint.
 */
export function sampleAlongLine(
  coordinates: ReadonlyArray<readonly [number, number]>,
  spacingMeters: number,
  maxStations = 400,
): CorridorStation[] {
  if (coordinates.length === 0) return []
  const [firstLng, firstLat] = coordinates[0]
  if (coordinates.length === 1) {
    return [{ lng: firstLng, lat: firstLat, distanceAlongMeters: 0 }]
  }

  const totalLength = lineLengthMeters(coordinates)
  if (totalLength === 0) {
    return [{ lng: firstLng, lat: firstLat, distanceAlongMeters: 0 }]
  }

  const spacing = Math.max(spacingMeters, totalLength / Math.max(1, maxStations - 1))
  const stations: CorridorStation[] = [{ lng: firstLng, lat: firstLat, distanceAlongMeters: 0 }]

  let segmentIndex = 1
  let segmentStartDistance = 0
  let segmentLength = haversineMeters(
    { lng: coordinates[0][0], lat: coordinates[0][1] },
    { lng: coordinates[1][0], lat: coordinates[1][1] },
  )

  for (let distance = spacing; distance < totalLength - spacing * 0.5; distance += spacing) {
    while (segmentIndex < coordinates.length - 1 && distance > segmentStartDistance + segmentLength) {
      segmentStartDistance += segmentLength
      segmentIndex += 1
      segmentLength = haversineMeters(
        { lng: coordinates[segmentIndex - 1][0], lat: coordinates[segmentIndex - 1][1] },
        { lng: coordinates[segmentIndex][0], lat: coordinates[segmentIndex][1] },
      )
    }
    if (segmentLength === 0) continue
    const fraction = (distance - segmentStartDistance) / segmentLength
    const [aLng, aLat] = coordinates[segmentIndex - 1]
    const [bLng, bLat] = coordinates[segmentIndex]
    stations.push({
      lng: aLng + (bLng - aLng) * fraction,
      lat: aLat + (bLat - aLat) * fraction,
      distanceAlongMeters: distance,
    })
  }

  const [lastLng, lastLat] = coordinates[coordinates.length - 1]
  stations.push({ lng: lastLng, lat: lastLat, distanceAlongMeters: totalLength })
  return stations
}

export type PolygonGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon

/** Every ring of a polygon or multipolygon, outer rings and holes alike. */
function polygonRingSets(geometry: PolygonGeometry): GeoJSON.Position[][][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
}

/** Even-odd ray casting against one polygon's rings, holes included. */
function pointInRings(rings: GeoJSON.Position[][], lng: number, lat: number): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside
      }
    }
  }
  return inside
}

/** Whether a position falls inside a polygon or multipolygon. */
export function pointInPolygon(geometry: PolygonGeometry, lng: number, lat: number): boolean {
  return polygonRingSets(geometry).some((rings) => pointInRings(rings, lng, lat))
}

export type Bounds = [number, number, number, number]

export function polygonBounds(geometry: PolygonGeometry): Bounds {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const rings of polygonRingSets(geometry)) {
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
  }
  return [minLng, minLat, maxLng, maxLat]
}

/**
 * Planar area in square metres, via a shoelace on a local equal-area
 * projection. Blocks are at most a few kilometres across, where this sits well
 * inside the DEM's own error.
 */
export function polygonAreaMeters(geometry: PolygonGeometry): number {
  const [, minLat, , maxLat] = polygonBounds(geometry)
  const referenceLat = (minLat + maxLat) / 2
  const scale = metersPerDegree(referenceLat)

  let total = 0
  for (const rings of polygonRingSets(geometry)) {
    rings.forEach((ring, ringIndex) => {
      let sum = 0
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const xi = ring[i][0] * scale.lng
        const yi = ring[i][1] * scale.lat
        const xj = ring[j][0] * scale.lng
        const yj = ring[j][1] * scale.lat
        sum += xj * yi - xi * yj
      }
      // Ring 0 is the outer boundary; the rest are holes to subtract.
      total += ringIndex === 0 ? Math.abs(sum) / 2 : -Math.abs(sum) / 2
    })
  }
  return Math.max(0, total)
}

export type GridSample = GeoPoint & {
  /** Ground area this sample stands for, in square metres. */
  areaMeters: number
}

/**
 * A regular grid of sample points covering a polygon.
 *
 * Rows step by a fixed north–south distance and columns by a fixed east–west
 * distance recomputed per row, so every cell covers the same ground area and
 * a simple sample count is an area ratio.
 */
export function polygonGridSamples(geometry: PolygonGeometry, spacingMeters: number): GridSample[] {
  const [minLng, minLat, maxLng, maxLat] = polygonBounds(geometry)
  if (!Number.isFinite(minLng) || spacingMeters <= 0) return []

  const latStep = spacingMeters / metersPerDegree((minLat + maxLat) / 2).lat
  const cellArea = spacingMeters * spacingMeters
  const samples: GridSample[] = []

  for (let lat = minLat + latStep / 2; lat <= maxLat; lat += latStep) {
    const lngStep = spacingMeters / Math.max(1, metersPerDegree(lat).lng)
    for (let lng = minLng + lngStep / 2; lng <= maxLng; lng += lngStep) {
      if (pointInPolygon(geometry, lng, lat)) samples.push({ lng, lat, areaMeters: cellArea })
    }
  }

  // A block smaller than one cell still deserves an answer: fall back to a
  // single sample at the centre of its bounding box, carrying its real area.
  if (samples.length === 0) {
    const lng = (minLng + maxLng) / 2
    const lat = (minLat + maxLat) / 2
    return [{ lng, lat, areaMeters: polygonAreaMeters(geometry) }]
  }
  return samples
}

/**
 * Grid spacing that keeps a polygon's sample count near `budget` without going
 * finer than the DEM can resolve.
 */
export function spacingForSampleBudget(geometry: PolygonGeometry, budget: number, minSpacingMeters: number): number {
  const area = polygonAreaMeters(geometry)
  if (area <= 0 || budget <= 0) return minSpacingMeters
  return Math.max(minSpacingMeters, Math.sqrt(area / budget))
}

export type Vector3 = [x: number, y: number, z: number]

/**
 * Unit normal of the terrain surface at a point, in local east/north/up metres.
 * Central differences over `spacingMeters` smooth the DEM enough that adjacent
 * samples do not flip orientation.
 */
export function terrainNormal(source: ElevationSource, lng: number, lat: number, spacingMeters: number): Vector3 {
  const scale = metersPerDegree(lat)
  const dLng = spacingMeters / Math.max(1, scale.lng)
  const dLat = spacingMeters / scale.lat

  const east = source.elevationAt(lng + dLng, lat)
  const west = source.elevationAt(lng - dLng, lat)
  const north = source.elevationAt(lng, lat + dLat)
  const south = source.elevationAt(lng, lat - dLat)
  if (Number.isNaN(east) || Number.isNaN(west) || Number.isNaN(north) || Number.isNaN(south)) {
    return [0, 0, 1]
  }

  const slopeEast = (east - west) / (2 * spacingMeters)
  const slopeNorth = (north - south) / (2 * spacingMeters)
  const length = Math.hypot(slopeEast, slopeNorth, 1)
  return [-slopeEast / length, -slopeNorth / length, 1 / length]
}

/**
 * How much of the viewer's field of view a ground sample takes up, as a solid
 * angle in steradians: area, foreshortened by the angle it is seen at, over
 * distance squared.
 *
 * Comparing these instead of raw ground area is what separates a block that
 * faces the road from one lying edge-on to it — the second covers far less of
 * the view for the same hectares.
 */
export function apparentSolidAngle(
  observer: GroundPoint & { eyeHeightMeters: number },
  sample: GroundPoint,
  sampleAreaMeters: number,
  normal: Vector3,
): number {
  const scale = metersPerDegree(sample.lat)
  const east = (observer.lng - sample.lng) * scale.lng
  const north = (observer.lat - sample.lat) * scale.lat
  const up = observer.groundElevationMeters + observer.eyeHeightMeters - sample.groundElevationMeters
  const distance = Math.hypot(east, north, up)
  if (!Number.isFinite(distance) || distance < 1) return 0

  const cosIncidence = Math.abs((normal[0] * east + normal[1] * north + normal[2] * up) / distance)
  return (sampleAreaMeters * cosIncidence) / (distance * distance)
}
