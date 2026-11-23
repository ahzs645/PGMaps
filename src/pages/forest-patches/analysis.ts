import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import type Geometry from 'jsts/org/locationtech/jts/geom/Geometry.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js'
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js'
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import type { Polygon, MultiPolygon, Feature } from 'geojson'
import { albersToLngLat, lngLatToAlbers } from '../dev-avast/projection'
import {
  bins,
  order,
  parseProject,
  periodYears,
  scenarios,
  table,
  type Bin,
  type Project,
  type Scenario,
} from './project'

const factory = new GeometryFactory()
const reader = new GeoJSONReader(factory)
const writer = new GeoJSONWriter()
const ha = (g: Geometry) => g.getArea() / 10000
function projectGeometry(
  g: Polygon | MultiPolygon,
  transform: (x: number, y: number) => [number, number],
): MultiPolygon {
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return {
    type: 'MultiPolygon',
    coordinates: polygons.map((poly) => poly.map((ring) => ring.map(([x, y]) => transform(x, y)))),
  }
}
type Patch = { shape: Geometry; youngHa: number; parts: Geometry[] }
export function sizeClass(hectares: number): Bin | null {
  // Suppress sub-square-centimetre projection noise at printed boundaries.
  const area = Math.round(hectares * 1e8) / 1e8
  const match = table.classLimitsHa.find(
    (limit) =>
      (limit.minInclusive === undefined || area >= limit.minInclusive) &&
      (limit.minExclusive === undefined || area > limit.minExclusive) &&
      (limit.maxInclusive === undefined || area <= limit.maxInclusive) &&
      (limit.maxExclusive === undefined || area < limit.maxExclusive),
  )
  return match ? (match.key as Bin) : null
}
function dissolve(parts: Geometry[]): Geometry {
  return UnaryUnionOp.union(factory.createGeometryCollection(parts))
}
// Connect transitively, including exact buffer contact. Carry original young hectares
// separately so that a bridge across older forest never adds to the denominator.
function mergeStage(patches: Patch[], radius: number, joinDistance: number): Patch[] {
  const remaining = new Set(patches)
  const merged: Patch[] = []
  for (const seed of remaining) {
    remaining.delete(seed)
    const group = [seed]
    for (const member of group) {
      const bounds = member.shape.getEnvelopeInternal()
      for (const candidate of remaining) {
        if (bounds.distance(candidate.shape.getEnvelopeInternal()) > joinDistance + 1e-6) continue
        if (DistanceOp.distance(member.shape, candidate.shape) <= joinDistance + 1e-6) {
          remaining.delete(candidate)
          group.push(candidate)
        }
      }
    }
    if (group.length === 1) merged.push(seed)
    else {
      const expanded = dissolve(group.map((p) => BufferOp.bufferOp(p.shape, radius)))
      const shape = BufferOp.bufferOp(expanded, -radius)
      if (!(shape.getArea() > 0)) throw new Error('A patch disappeared during buffering. Review the input geometry.')
      merged.push({ shape, parts: group.flatMap((p) => p.parts), youngHa: group.reduce((n, p) => n + p.youngHa, 0) })
    }
  }
  return merged
}
function patchesAt(shapes: Geometry[]) {
  if (!shapes.length) return []
  const disjoint = dissolve(shapes)
  let patches: Patch[] = Array.from({ length: disjoint.getNumGeometries() }, (_, i) => {
    const shape = disjoint.getGeometryN(i)
    return { shape, youngHa: ha(shape), parts: [shape] }
  })
  for (const stage of order.implementationPolicy.patchMergeStages) {
    const active: Patch[] = [],
      inactive: Patch[] = []
    for (const p of patches) {
      const area = Math.round(ha(p.shape) * 1e8) / 1e8
      const eligible = stage.upperInitialPatchHa != null ? area < stage.upperInitialPatchHa : area > stage.lowerPatchHa!
      if (eligible) active.push(p)
      else inactive.push(p)
    }
    patches = [...inactive, ...mergeStage(active, stage.bufferMetres, stage.joinDistanceMetres)]
  }
  return patches
}
export function prepareFootprints(project: Project) {
  return project.features.map((f) => {
    const shape: Geometry = reader.read(projectGeometry(f.geometry, lngLatToAlbers))
    if (!IsValidOp.isValid(shape) || !(shape.getArea() > 0))
      throw new Error('Invalid polygon topology in ' + f.properties.id)
    return { shape, id: f.properties.id, scenario: f.properties.scenario, year: f.properties.year }
  })
}
// Each perturbation uses the same age filter, union, staged merges and area denominator as the map.
export function periodCalculator(input: Project, selectedYear: number, selectedScenario: Scenario) {
  const project = parseProject(input)
  if (!project.district || !project.ndu)
    throw Error('Select a historic district and sub-unit for Prince George patch analysis.')
  if (!periodYears(project.startYear).includes(selectedYear) || !scenarios.includes(selectedScenario))
    throw Error('Invalid projection period or schedule.')
  const inputs = prepareFootprints(project)
  // With a reporting unit, patches are built from every footprint (inside and beyond it) and counted inside.
  const within: Geometry | null = project.countWithin
    ? reader.read(projectGeometry(project.countWithin, lngLatToAlbers))
    : null
  const insideCache = new WeakMap<Patch, number>()
  const youngInside = (p: Patch) => {
    let value = insideCache.get(p)
    if (value === undefined) {
      const box = within!.getEnvelopeInternal()
      value = p.parts.reduce(
        (sum, part) =>
          part.getEnvelopeInternal().intersects(box) ? sum + ha(OverlayOp.intersection(part, within!)) : sum,
        0,
      )
      insideCache.set(p, value)
    }
    return value
  }
  const target = table.targets.find((t) => t.ndu === project.ndu)!.percent
  const [minAge, maxAge] = order.implementationPolicy.youngForestAgeYearsInclusive
  const cache = new Map<string, Patch[]>()
  return (year: number, scenario: Scenario, override?: { id: string; year: number }, map?: Feature<MultiPolygon>[]) => {
    const young = inputs.filter((f) => {
      const age = year - (override?.id === f.id ? override.year : f.year)
      return (f.scenario === 'reference' || f.scenario === scenario) && age >= minAge && age <= maxAge
    })
    const key = JSON.stringify(young.map((f) => f.id))
    let patches = cache.get(key)
    if (!patches) {
      patches = patchesAt(young.map((f) => f.shape))
      // A field comparison can generate many distinct landscapes. Bound the retained JSTS geometry.
      if (cache.size >= 33) cache.delete(cache.keys().next().value!)
      cache.set(key, patches)
    }
    const areaByBin = Object.fromEntries(bins.map((k) => [k, 0])) as Record<Bin, number>
    let totalHa = 0,
      unclassifiedHa = 0,
      counted = 0
    for (const p of patches) {
      const sizeHa = ha(p.shape),
        bin = sizeClass(sizeHa)
      // A patch is classed by its whole size; with a reporting unit only its young area inside counts.
      const countedHa = within ? youngInside(p) : p.youngHa
      if (within && !(countedHa > 0)) continue
      counted++
      totalHa += countedHa
      if (bin) areaByBin[bin] += countedHa
      else unclassifiedHa += countedHa
      if (map) {
        // Match original young interiors before buffering. Shared edges and artificial bridges add no source records.
        const footprintIds = young
          .filter((f) =>
            p.parts.some(
              (part) =>
                part.getEnvelopeInternal().intersects(f.shape.getEnvelopeInternal()) &&
                RelateOp.relate(part, f.shape).matches('T********'),
            ),
          )
          .map((f) => f.id)
        map.push({
          type: 'Feature',
          geometry: projectGeometry(writer.write(p.shape) as Polygon | MultiPolygon, albersToLngLat),
          properties: { id: map.length + 1, bin, sizeHa, youngHa: countedHa, footprintIds },
        })
      }
    }
    const classes = bins.map((bin) => {
      const percent = totalHa > 0 ? (100 * areaByBin[bin]) / totalHa : null
      return {
        bin,
        ha: areaByBin[bin],
        percent,
        target: target[bin],
        gapPoints: percent === null ? null : percent - target[bin],
      }
    })
    return { scenario, year, totalHa, unclassifiedHa, patches: counted, classes }
  }
}
export function analyze(project: Project, selectedYear: number, selectedScenario: Scenario) {
  const period = periodCalculator(project, selectedYear, selectedScenario)
  const features: Feature<MultiPolygon>[] = []
  const timeline = scenarios.flatMap((scenario) =>
    periodYears(project.startYear).map((year) =>
      period(year, scenario, undefined, year === selectedYear && scenario === selectedScenario ? features : undefined),
    ),
  )
  return { timeline, patchMap: { type: 'FeatureCollection' as const, features } }
}
export type Analysis = ReturnType<typeof analyze>
export type Period = Analysis['timeline'][number]
