/**
 * Objectives A and B of the 2004 order for one old forest unit, for each schedule and projection
 * year: old forest against the CFLB × Table 1–3 percentage, old non-pine-leading forest against the
 * policy's Tables 8–10, and old interior forest against the required old forest × Table 4–6
 * percentage. The assumptions are decisions recorded in docs/forestry-old-forest.md; each is
 * named where it acts.
 *
 * - **Age.** A VRI stand's age in year Y is `PROJ_AGE_1 + (Y − year(PROJECTED_DATE))`; VRI ages are
 *   already projected and are never aged again from the reference year. A stand harvested since is
 *   `Y − year(HARVEST_DATE)`. Before the projection date, a stand harvested after Y has an unknown
 *   age in Y (its age before harvest is not kept), counted apart and never as old.
 * - **Resets.** A baseline disturbance after the projection date, and every schedule's block, makes
 *   its ground young from its year. Within fifty years nothing it resets can become old again.
 * - **CFLB.** By default a proxy: VRI treed (`BCLCS_LEVEL_2 = 'T'`) on the forest management land
 *   base (`FOR_MGMT_LAND_BASE_IND = 'Y'`) within the unit (decision 2). A CFLB the reviewer states
 *   takes the proxy's shares: every area is measured on the proxy's ground and scaled by the stated
 *   CFLB over the proxy's, never set against the stated CFLB as measured.
 * - **D.1.** Legal OGMAs count whole whatever their age; non-legal OGMAs, parks and the reviewer's
 *   retention or recruitment areas count whole when switched on. Only their CFLB ground counts.
 * - **NFAs.** Old stands killed by beetle keep their VRI age and stay old until harvested (decision 3).
 * - **Interior.** 2005 method (decision 6): old ground less 200 m from young neighbours (60 years or
 *   less pine- or deciduous-leading, 80 years or less otherwise, or no age on the land base), reset
 *   ground and primary corridors; none against older stands or non-forest; and only where what is
 *   left is wider than 200 m. The 2004 method buffers against anything younger than old instead.
 *   Neighbours just outside the unit are read whole, so an edge at the boundary is a real edge.
 *
 * DOM- and network-free. Geometry is measured in BC Albers (EPSG:3005).
 */
import type { MultiPolygon, Polygon, Position } from 'geojson'
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import Envelope from 'jsts/org/locationtech/jts/geom/Envelope.js'
import PointLocation from 'jsts/org/locationtech/jts/algorithm/PointLocation.js'
import STRtree from 'jsts/org/locationtech/jts/index/strtree/STRtree.js'
import type Geometry from 'jsts/org/locationtech/jts/geom/Geometry.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import BufferParameters from 'jsts/org/locationtech/jts/operation/buffer/BufferParameters.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js'
import PrecisionModel from 'jsts/org/locationtech/jts/geom/PrecisionModel.js'
import GeometryPrecisionReducer from 'jsts/org/locationtech/jts/precision/GeometryPrecisionReducer.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'
import polygonClipping from 'polygon-clipping'
import { lngLatToAlbers } from '../../dev-avast/projection'
import type { Shape } from '../plan'
import type { CountedArea, Corridor, Stand } from './reads'
import type { OldForestUnit } from './units'
export { firstShortfall } from '../records'

export const INTERIOR_BUFFER_METRES = 200
/** Interior ground narrower than this is left out (the 2005 method's "> 200 m wide"). */
export const INTERIOR_MIN_WIDTH_METRES = 200
const SQ_M_PER_HA = 10_000

export type InteriorMethod = '2005' | '2004'

export interface OldForestSettings {
  countNonLegalOgmas: boolean
  countParks: boolean
  interiorMethod: InteriorMethod
  /** A CFLB the reviewer states (e.g. the LLOWG's). Null: the VRI proxy. */
  cflbEnteredHa: number | null
}

export const DEFAULT_OLD_FOREST_SETTINGS: OldForestSettings = {
  countNonLegalOgmas: true,
  countParks: false,
  interiorMethod: '2005',
  cflbEnteredHa: null,
}

/** Something that makes ground young from its year: a past disturbance or a schedule's block. */
export interface Reset {
  year: number
  geometry: Polygon | MultiPolygon
}

const factory = new GeometryFactory()
const reader = new GeoJSONReader(factory)
const writer = new GeoJSONWriter()

/** Projected coordinates on a 1 cm grid: noise below that is what makes JSTS's overlays fail to node. */
const snap = ([x, y]: number[]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]
/** Retries a failed overlay on a 10 cm grid, the usual cure for a non-noded intersection. */
const coarse = new PrecisionModel(10)
/** The polygons of a geometry: an overlay can leave lines and points beside them, and JSTS's overlay refuses mixed collections. */
function polygonal(g: Geometry): Geometry {
  const type = (x: Geometry) => (x as unknown as { getGeometryType(): string }).getGeometryType()
  if (type(g) !== 'GeometryCollection') return g
  const polys: Geometry[] = []
  const walk = (x: Geometry) => {
    const t = type(x)
    if (t === 'Polygon') polys.push(x)
    else if (t === 'MultiPolygon' || t === 'GeometryCollection')
      for (let i = 0; i < x.getNumGeometries(); i++) walk(x.getGeometryN(i))
  }
  walk(g)
  return factory.createMultiPolygon(polys as never) as unknown as Geometry
}

function robust<T>(op: (...g: Geometry[]) => T, ...raw: Geometry[]): T {
  const inputs = raw.map(polygonal)
  try {
    return op(...inputs)
  } catch (e) {
    if (!(e instanceof Error) || !/non-noded|TopologyException|found non-noded/i.test(`${e.name} ${e.message}`)) throw e
    return op(...inputs.map((g) => GeometryPrecisionReducer.reduce(g, coarse)))
  }
}

const toAlbers = (shape: { type: string; coordinates: unknown }): Geometry => {
  const ring = (r: Position[]) => r.map(([x, y]) => snap(lngLatToAlbers(x, y)))
  const project = (c: unknown, depth: number): unknown =>
    depth === 0 ? ring(c as Position[]) : (c as unknown[]).map((x) => project(x, depth - 1))
  const depth = { LineString: -1, MultiLineString: 0, Polygon: 1, MultiPolygon: 2 }[shape.type]
  if (depth === undefined) throw Error(`Unexpected geometry ${shape.type}.`)
  const coordinates =
    depth === -1
      ? (shape.coordinates as Position[]).map(([x, y]) => lngLatToAlbers(x, y))
      : project(shape.coordinates, depth)
  let g = reader.read({ type: shape.type, coordinates })
  if (g.getDimension() === 2 && !IsValidOp.isValid(g)) g = BufferOp.bufferOp(g, 0)
  return g
}

const area = (g: Geometry | null) => (g ? g.getArea() : 0)
/** Envelopes only: the overlay that follows finds whether they really meet. */
const intersects = (a: Geometry, b: Geometry) => a.getEnvelopeInternal().intersects(b.getEnvelopeInternal())
const intersection = (a: Geometry, b: Geometry): Geometry | null => {
  if (!intersects(a, b)) return null
  const g = robust((x, y) => OverlayOp.intersection(x, y), a, b)
  return g.isEmpty() || !(g.getArea() > 0) ? null : g
}
/**
 * Unions many polygons with polygon-clipping's sweep line: JSTS's cascaded union took 21 s for
 * A6's old stands (about 2,000 polygons) where this takes 0.4 s, with the same interior to the
 * hectare. JSTS takes over if both grids fail.
 */
function manyUnion(list: Geometry[]): Geometry | null {
  if (list.length < 2) return union(list)
  const coords = list.flatMap((g) => {
    const j = writer.write(polygonal(g)) as { type: string; coordinates: unknown }
    return j.type === 'Polygon' ? [j.coordinates] : j.type === 'MultiPolygon' ? (j.coordinates as unknown[]) : []
  }) as number[][][][]
  if (!coords.length) return null
  // polygon-clipping can fail to find a segment on near-coincident vertices; a coarser grid cures it.
  for (const grid of [0.1, 1]) {
    try {
      const snapped = coords.map((poly) =>
        poly.map((ring) => ring.map(([x, y]) => [Math.round(x / grid) * grid, Math.round(y / grid) * grid])),
      ) as Parameters<typeof polygonClipping.union>[0][]
      const [first, ...rest] = snapped
      const out = polygonClipping.union(first, ...rest)
      return out.length ? reader.read({ type: 'MultiPolygon', coordinates: out }) : null
    } catch {
      // Try the coarser grid, then JSTS.
    }
  }
  return union(list)
}

const union = (list: Geometry[]): Geometry | null =>
  list.length === 0
    ? null
    : list.length === 1
      ? list[0]
      : robust((c) => UnaryUnionOp.union(c), factory.createGeometryCollection(list))

/** Pine leads when the code starts with P; deciduous when it is none of the conifer letters. */
export function leadingGroup(code: string | null): 'pine' | 'deciduous' | 'conifer' | null {
  if (!code) return null
  if (code.startsWith('P')) return 'pine'
  return 'BCFHJLSTY'.includes(code[0]) ? 'conifer' : 'deciduous'
}

/**
 * Clips geometries to one area, skipping the overlay where it is not needed: a geometry whose
 * envelope no boundary segment of the area crosses lies wholly inside or wholly outside it, and one
 * point says which. Most stands lie well inside their unit, and an overlay against a unit of
 * thousands of vertices was most of the preparation's time (112 s for A6's 2,014 stands).
 */
function clipper(area: Geometry): (g: Geometry) => Geometry | null {
  type Coord = { x: number; y: number }
  type Ring = { getCoordinates(): Coord[] }
  type Poly = { getExteriorRing(): Ring; getNumInteriorRing(): number; getInteriorRingN(n: number): Ring }
  const segments = new STRtree()
  const polygons: { shell: Coord[]; holes: Coord[][] }[] = []
  const collect = (g: Geometry) => {
    if ((g as unknown as { getGeometryType(): string }).getGeometryType() === 'Polygon') {
      const p = g as unknown as Poly
      const shell = p.getExteriorRing().getCoordinates()
      const holes = Array.from({ length: p.getNumInteriorRing() }, (_, h) => p.getInteriorRingN(h).getCoordinates())
      polygons.push({ shell, holes })
      for (const c of [shell, ...holes])
        for (let j = 1; j < c.length; j++) segments.insert(new Envelope(c[j - 1].x, c[j].x, c[j - 1].y, c[j].y), j)
    } else for (let i = 0; i < g.getNumGeometries(); i++) if (g.getGeometryN(i) !== g) collect(g.getGeometryN(i))
  }
  collect(area)
  const inside = (p: Coord) =>
    polygons.some(
      ({ shell, holes }) => PointLocation.isInRing(p, shell) && !holes.some((h) => PointLocation.isInRing(p, h)),
    )
  const areaEnvelope = area.getEnvelopeInternal()
  return (g) => {
    const env = g.getEnvelopeInternal()
    if (!areaEnvelope.intersects(env)) return null
    const crossing = segments.query(env)
    if ((Array.isArray(crossing) ? crossing.length : crossing.size()) === 0)
      return inside((g as unknown as { getCoordinate(): Coord }).getCoordinate()) ? g : null
    return intersection(g, area)
  }
}

interface PreparedStand {
  stand: Stand
  /** The stand's ground inside the unit. Null when it only neighbours the unit. */
  inside: Geometry | null
  insideM2: number
  whole: Geometry
  cflb: boolean
  group: ReturnType<typeof leadingGroup>
  /**
   * Per counted kind, the stand's ground inside the unit that the kind covers. Clipped on first use:
   * only a stand that is not old in some year needs it.
   */
  counted: () => Partial<Record<CountedArea['kind'], Geometry>>
}

export interface PreparedUnit {
  unit: OldForestUnit
  stands: PreparedStand[]
  corridors: Geometry | null
  /** The latest VRI projection year: resets after it are not in the inventory. */
  projectedYear: number
  cflbProxyHa: number
  counts: { stands: number; standsInside: number; counted: Record<CountedArea['kind'], number>; corridors: number }
}

/** Projects and clips everything once; the per-year work only adds areas and, for interior, overlays. */
export function prepareUnit({
  unit,
  shape,
  stands,
  counted,
  corridors,
}: {
  unit: OldForestUnit
  shape: Shape
  stands: Stand[]
  counted: CountedArea[]
  corridors: Corridor[]
}): PreparedUnit {
  const unitGeom = toAlbers(shape)
  const countedByKind = new Map<CountedArea['kind'], Geometry[]>()
  for (const c of counted) countedByKind.set(c.kind, [...(countedByKind.get(c.kind) ?? []), toAlbers(c.geometry)])
  const countedUnion = new Map([...countedByKind].map(([k, list]) => [k, intersection(union(list)!, unitGeom)]))
  const clipTo = clipper(unitGeom)
  const countedClippers = new Map(
    [...countedUnion].flatMap(([k, g]) => (g ? [[k, { g, clip: clipper(g) }] as const] : [])),
  )
  let projectedYear = 0
  const prepared = stands.map((stand): PreparedStand => {
    const whole = toAlbers(stand.geometry)
    const inside = clipTo(whole)
    projectedYear = Math.max(projectedYear, stand.projectedYear ?? 0)
    const result: PreparedStand = {
      stand,
      inside,
      insideM2: area(inside),
      whole,
      cflb: stand.treed && stand.forestLandBase,
      group: leadingGroup(stand.leading),
      counted: () => {
        if (!clipped) {
          clipped = {}
          if (inside && result.cflb)
            for (const [kind, { clip }] of countedClippers) {
              const part = clip(inside)
              if (part) clipped[kind] = part
            }
        }
        return clipped
      },
    }
    let clipped: Partial<Record<CountedArea['kind'], Geometry>> | null = null
    return result
  })
  if (!projectedYear) throw Error('The VRI stands carry no projected date.')
  const corridorGeom = union(corridors.map((c) => toAlbers(c.geometry)))
  return {
    unit,
    stands: prepared,
    corridors: corridorGeom,
    projectedYear,
    cflbProxyHa: prepared.reduce((s, p) => s + (p.cflb ? p.insideM2 : 0), 0) / SQ_M_PER_HA,
    counts: {
      stands: stands.length,
      standsInside: prepared.filter((p) => p.inside).length,
      counted: {
        'ogma-legal': countedByKind.get('ogma-legal')?.length ?? 0,
        'ogma-non-legal': countedByKind.get('ogma-non-legal')?.length ?? 0,
        park: countedByKind.get('park')?.length ?? 0,
        retention: countedByKind.get('retention')?.length ?? 0,
      },
      corridors: corridors.length,
    },
  }
}

/** The stand's age in `year`; null when it has none or when it is not known (harvested after `year`). */
export function ageIn(stand: Stand, year: number): number | null {
  if (stand.harvestYear !== null && stand.harvestYear <= year) return year - stand.harvestYear
  if (stand.harvestYear !== null && stand.harvestYear > year) return null
  if (stand.projectedAge === null || stand.projectedYear === null) return null
  return stand.projectedAge + (year - stand.projectedYear)
}

const unknownBecauseHarvestedLater = (stand: Stand, year: number) =>
  stand.harvestYear !== null && stand.harvestYear > year

export interface YearFigures {
  year: number
  cflbHa: number
  requiredOldHa: number
  oldHa: number
  /** Of `oldHa`, ground counted by D.1 that is not old by age. */
  countedNotOldHa: number
  requiredNonPineHa: number | null
  nonPineOldHa: number
  /** CFLB ground harvested after this year and before the VRI projection: its age in the year is unknown. */
  unknownAgeHa: number
  requiredInteriorHa: number
  interiorHa: number | null
}

interface StandYear {
  oldPart: Geometry | null
  oldM2: number
  countedNotOldM2: number
  nonPineM2: number
  unknownM2: number
}

function countedGround(p: PreparedStand, settings: OldForestSettings): Geometry | null {
  const kinds: CountedArea['kind'][] = ['ogma-legal', 'retention']
  if (settings.countNonLegalOgmas) kinds.push('ogma-non-legal')
  if (settings.countParks) kinds.push('park')
  const counted = p.counted()
  return union(kinds.flatMap((k) => (counted[k] ? [counted[k]!] : [])))
}

function standYear(
  p: PreparedStand,
  year: number,
  unit: OldForestUnit,
  resets: Geometry | null,
  settings: OldForestSettings,
  needGeometry: boolean,
): StandYear {
  const none = { oldPart: null, oldM2: 0, countedNotOldM2: 0, nonPineM2: 0, unknownM2: 0 }
  if (!p.inside || !p.cflb) return none
  const age = ageIn(p.stand, year)
  const old = age !== null && age >= unit.oldFromAge
  const counted = old ? null : countedGround(p, settings)
  let part: Geometry | null = old ? p.inside : counted
  if (!part) return { ...none, unknownM2: unknownBecauseHarvestedLater(p.stand, year) ? p.insideM2 : 0 }
  const lost = resets ? intersection(part, resets) : null
  if (lost) part = robust((x, y) => OverlayOp.difference(x, y), part, lost)
  const m2 = area(part)
  return {
    oldPart: needGeometry && m2 > 0 ? part : null,
    oldM2: m2,
    countedNotOldM2: old ? 0 : m2,
    nonPineM2: old && p.group !== 'pine' ? m2 : 0,
    unknownM2: 0,
  }
}

/** True when a neighbour of old forest is young enough to make an edge under the chosen method. */
function makesEdge(p: PreparedStand, year: number, unit: OldForestUnit, method: InteriorMethod): boolean {
  if (!p.stand.treed && !p.stand.forestLandBase) return false
  const age = ageIn(p.stand, year)
  if (age === null) return p.stand.forestLandBase && !unknownBecauseHarvestedLater(p.stand, year)
  if (method === '2004') return age < unit.oldFromAge
  return p.group === 'pine' || p.group === 'deciduous' ? age <= 60 : age <= 80
}

function interiorOf(old: Geometry | null, edges: Geometry[]): number {
  if (!old) return 0
  const params = new BufferParameters(4)
  const type = (g: Geometry) => (g as unknown as { getGeometryType(): string }).getGeometryType()
  const lines = edges.filter((g) => /LineString/.test(type(g)))
  const areas = manyUnion(edges.filter((g) => !/LineString/.test(type(g))))
  const buffers = [
    ...(areas ? [BufferOp.bufferOp(areas, INTERIOR_BUFFER_METRES, params)] : []),
    ...(lines.length
      ? [BufferOp.bufferOp(factory.createGeometryCollection(lines), INTERIOR_BUFFER_METRES, params)]
      : []),
  ]
  const buffered = buffers.length > 1 ? manyUnion(buffers) : (buffers[0] ?? null)
  const interior = buffered ? robust((x, y) => OverlayOp.difference(x, y), old, buffered) : old
  let m2 = 0
  for (let i = 0; i < interior.getNumGeometries(); i++) {
    const part = interior.getGeometryN(i)
    if (part.getArea() <= 0) continue
    if (BufferOp.bufferOp(part, -INTERIOR_MIN_WIDTH_METRES / 2, params).isEmpty()) continue
    m2 += part.getArea()
  }
  return m2
}

export interface ScheduleFigures {
  schedule: string
  years: YearFigures[]
}

/**
 * The unit's figures for one set of resets (a schedule's, or the baseline's alone), at each year.
 * Interior is calculated only for `interiorYears`: it is the costly overlay.
 */
export function unitFigures(
  prepared: PreparedUnit,
  resets: Reset[],
  years: number[],
  interiorYears: number[],
  settings: OldForestSettings,
): YearFigures[] {
  const { unit } = prepared
  const resetGeoms = resets.map((r) => ({ year: r.year, geometry: toAlbers(r.geometry) }))
  const cflbHa = settings.cflbEnteredHa ?? prepared.cflbProxyHa
  // A stated CFLB takes the proxy's shares, not its hectares: on A6 and A10 the proxy's land base was
  // 37–38% larger than the LLOWG's while old forest's share of it was within a point of theirs.
  const perHa = (settings.cflbEnteredHa ? settings.cflbEnteredHa / prepared.cflbProxyHa : 1) / SQ_M_PER_HA
  const requiredOldHa = (cflbHa * unit.oldPercent) / 100
  return years.map((year) => {
    // Resets in the inventory already show in VRI ages: only later ones (and every block) apply.
    const active = union(
      resetGeoms.filter((r) => r.year <= year && r.year > prepared.projectedYear).map((r) => r.geometry),
    )
    const withInterior = interiorYears.includes(year)
    const totals = { old: 0, counted: 0, nonPine: 0, unknown: 0 }
    const oldParts: Geometry[] = []
    const edges: Geometry[] = []
    for (const p of prepared.stands) {
      const near = active && intersects(p.whole, active) ? active : null
      const s = standYear(p, year, unit, near, settings, withInterior)
      totals.old += s.oldM2
      totals.counted += s.countedNotOldM2
      totals.nonPine += s.nonPineM2
      totals.unknown += s.unknownM2
      if (withInterior) {
        if (s.oldPart) oldParts.push(s.oldPart)
        if (makesEdge(p, year, unit, settings.interiorMethod)) edges.push(p.whole)
      }
    }
    let interiorHa: number | null = null
    if (withInterior) {
      if (active) edges.push(active)
      if (prepared.corridors) edges.push(prepared.corridors)
      interiorHa = interiorOf(manyUnion(oldParts), edges) * perHa
    }
    const oldHa = totals.old * perHa
    return {
      year,
      cflbHa,
      requiredOldHa,
      oldHa,
      countedNotOldHa: totals.counted * perHa,
      requiredNonPineHa: unit.nonPinePercent === null ? null : (cflbHa * unit.nonPinePercent) / 100,
      nonPineOldHa: totals.nonPine * perHa,
      unknownAgeHa: totals.unknown * perHa,
      requiredInteriorHa: (requiredOldHa * unit.interiorPercent) / 100,
      interiorHa,
    }
  })
}

/** Joins WGS84 polygons into one shape (the Map 2 reader's `union`). */
export function joinShapes(shapes: Shape[]): Shape {
  const joined = union(
    shapes.map((s) => {
      let g = reader.read(s)
      if (!IsValidOp.isValid(g)) g = BufferOp.bufferOp(g, 0)
      return g
    }),
  )
  if (!joined) throw Error('The unit has no polygons.')
  const out = writer.write(joined) as Shape
  if (out.type !== 'Polygon' && out.type !== 'MultiPolygon') throw Error('The unit’s polygons did not form an area.')
  return out
}

/**
 * How much of a footprint each of `others` covers, in BC Albers hectares, through the same
 * projection and overlays as the calculation; `coveredHa` dissolves the overlaps, so ground two of
 * them share is counted once. Used for the grazing review's mapped evidence.
 */
export function overlapsWith(
  footprint: Shape,
  others: Shape[],
): { footprintHa: number; eachHa: number[]; coveredHa: number } {
  const base = toAlbers(footprint)
  const pieces = others.map((g) => intersection(base, toAlbers(g)))
  const covered = manyUnion(pieces.filter((g): g is Geometry => g !== null))
  return {
    footprintHa: area(base) / SQ_M_PER_HA,
    eachHa: pieces.map((g) => area(g) / SQ_M_PER_HA),
    coveredHa: area(covered) / SQ_M_PER_HA,
  }
}
