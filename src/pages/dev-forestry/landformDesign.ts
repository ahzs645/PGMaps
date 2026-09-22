/** Appendix 5 review aids. These geometric diagnostics are engineering
 * heuristics, not the Handbook's qualitative design judgements or a VQO score. */
import type { ElevationSource } from './terrain'
import { bearingDegrees, earthCurvatureDropMeters, haversineMeters, metersPerDegree, pointInPolygon, type GroundPoint, type PolygonGeometry, type Vector3 } from './visibility'

export const LANDFORM_CONTEXT_RADIUS_METERS = 150
const RELIEF_THRESHOLD_METERS = 3
export type TerrainPosition = 'ridge' | 'hollow' | 'slope' | 'saddle' | 'unknown'
export type DesignPass = {
  target: { id: string; name: string; role: string; geometry: PolygonGeometry }
  samples: GroundPoint[]; areas: Float64Array; normals: Vector3[]; matrix: Uint8Array
}
export type LandformDesignReview = {
  contextRadiusMeters: number
  markers: Array<{ lng: number; lat: number; position: TerrainPosition }>
  blocks: Array<{
    id: string; name: string; sampleCount: number; unknownContextCount: number
    ridgeSamples: number; hollowSamples: number; upperSlopeSamples: number
    meanSlopePercent: number | null; visibleStations: number; unknownStations: number; stationCount: number
    mostVisibleStation: number | null; silhouetteStations: number[]
  }>
}

/** Opposite directional neighbours distinguish a convex crest from a planar
 * slope. Mixed convex/concave axes are saddles, not forced into either class.
 * This is a local relief cue, not a geomorphon implementation or ridge trace. */
export function terrainPosition(source: ElevationSource, lng: number, lat: number, radius = LANDFORM_CONTEXT_RADIUS_METERS): TerrainPosition {
  const z = source.elevationAt(lng, lat), scale = metersPerDegree(lat)
  if (!Number.isFinite(z)) return 'unknown'
  let ridge = false, hollow = false
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 4
    const dx = Math.cos(angle) * radius / scale.lng, dy = Math.sin(angle) * radius / scale.lat
    const a = source.elevationAt(lng + dx, lat + dy), b = source.elevationAt(lng - dx, lat - dy)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 'unknown'
    ridge ||= z - a > RELIEF_THRESHOLD_METERS && z - b > RELIEF_THRESHOLD_METERS
    hollow ||= a - z > RELIEF_THRESHOLD_METERS && b - z > RELIEF_THRESHOLD_METERS
  }
  return ridge && hollow ? 'saddle' : ridge ? 'ridge' : hollow ? 'hollow' : 'slope'
}

export function reviewLandformDesign(source: ElevationSource, land: DesignPass | undefined, proposals: DesignPass[], stations: GroundPoint[], eyeHeight: number): LandformDesignReview | null {
  if (!land) return null
  const known = land.samples.map(p => p.groundElevationMeters).filter(Number.isFinite)
  if (!known.length) return null
  const min = Math.min(...known), relief = Math.max(...known) - min
  const markers: LandformDesignReview['markers'] = []
  const stride = Math.max(1, Math.ceil(land.samples.length / 2048))
  for (let i = 0; i < land.samples.length; i += stride) {
    const p = land.samples[i], position = terrainPosition(source, p.lng, p.lat)
    if (position === 'ridge' || position === 'hollow' || position === 'saddle') markers.push({ lng: p.lng, lat: p.lat, position })
  }
  const apparent = (eye: GroundPoint, p: GroundPoint) => {
    const d = haversineMeters(eye, p)
    return Math.atan2(p.groundElevationMeters - earthCurvatureDropMeters(d) - eye.groundElevationMeters - eyeHeight, d) * 180 / Math.PI
  }
  const bin = (eye: GroundPoint, p: GroundPoint) => Math.floor(bearingDegrees(eye, p) / 2) % 180
  // A sampled LANDform silhouette, not the full terrain/canopy horizon.
  // Visibility is inherited from the existing run (including unknown values).
  const silhouettes = stations.map((eye, s) => {
    const angles = new Float64Array(180).fill(-Infinity)
    for (let i = 0; i < land.samples.length; i++) if (land.matrix[s * land.samples.length + i] === 1) {
      const p = land.samples[i], b = bin(eye, p)
      angles[b] = Math.max(angles[b], apparent(eye, p))
    }
    return angles
  })
  let remainingContextSamples = 4096
  const blocks = proposals.map((pass, blockIndex) => {
    const inside = pass.samples.map((p, index) => ({ p, index })).filter(({ p }) => pointInPolygon(land.target.geometry, p.lng, p.lat))
    const allowance = Math.max(1, Math.floor(remainingContextSamples / (proposals.length - blockIndex)))
    const step = Math.max(1, Math.ceil(inside.length / allowance))
    let sampleCount = 0, unknownContextCount = 0, ridgeSamples = 0, hollowSamples = 0, upperSlopeSamples = 0, slopeSum = 0, slopeArea = 0
    for (let j = 0; j < inside.length && remainingContextSamples > 0; j += step) {
      const { p, index } = inside[j], position = terrainPosition(source, p.lng, p.lat)
      remainingContextSamples--; sampleCount++
      if (position === 'unknown') unknownContextCount++
      if (position === 'ridge') ridgeSamples++
      if (position === 'hollow') hollowSamples++
      if (relief > 0 && p.groundElevationMeters >= min + relief * 2 / 3) upperSlopeSamples++
      const normal = pass.normals[index]
      if (normal && Number.isFinite(normal[2]) && normal[2] > 0) {
        slopeSum += Math.hypot(normal[0], normal[1]) / normal[2] * 100 * pass.areas[index]
        slopeArea += pass.areas[index]
      }
    }
    let visibleStations = 0, unknownStations = 0, mostVisibleStation: number | null = null, maxArea = 0
    const silhouetteStations: number[] = []
    stations.forEach((eye, s) => {
      if (inside.some(({ index }) => pass.matrix[s * pass.samples.length + index] === 2)) unknownStations++
      let visibleArea = 0, nearSilhouette = false
      for (const { p, index } of inside) if (pass.matrix[s * pass.samples.length + index] === 1) {
        visibleArea += pass.areas[index]
        const b = bin(eye, p), horizon = Math.max(...[-1, 0, 1].map(offset => silhouettes[s][(b + offset + 180) % 180]))
        if (Number.isFinite(horizon) && Math.abs(horizon - apparent(eye, p)) <= 0.5) nearSilhouette = true
      }
      if (visibleArea > 0) visibleStations++
      if (visibleArea > maxArea) { maxArea = visibleArea; mostVisibleStation = s }
      if (nearSilhouette) silhouetteStations.push(s)
    })
    return { id: pass.target.id, name: pass.target.name, sampleCount, unknownContextCount, ridgeSamples, hollowSamples, upperSlopeSamples, meanSlopePercent: slopeArea ? slopeSum / slopeArea : null, visibleStations, unknownStations, stationCount: stations.length, mostVisibleStation, silhouetteStations }
  })
  return { contextRadiusMeters: LANDFORM_CONTEXT_RADIUS_METERS, markers, blocks }
}
