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
 *   CFLB over the proxy's, never set against the stated CFLB as measured. Ground the order does not
 *   apply to (`landBase.ts`: land that is not provincial Crown, woodlots, TFLs, community forests)
 *   is left out of the unit before anything is counted, so neither the proxy nor old forest nor D.1
 *   counts it; a young stand on it still makes an edge.
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
import type { LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon, Position } from 'geojson'
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import Envelope from 'jsts/org/locationtech/jts/geom/Envelope.js'
import PointLocation from 'jsts/org/locationtech/jts/algorithm/PointLocation.js'
import STRtree from 'jsts/org/locationtech/jts/index/strtree/STRtree.js'
import type Geometry from 'jsts/org/locationtech/jts/geom/Geometry.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import BufferParameters from 'jsts/org/locationtech/jts/operation/buffer/BufferParameters.js'
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js'
import PrecisionModel from 'jsts/org/locationtech/jts/geom/PrecisionModel.js'
import GeometryPrecisionReducer from 'jsts/org/locationtech/jts/precision/GeometryPrecisionReducer.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'
import TopologyPreservingSimplifier from 'jsts/org/locationtech/jts/simplify/TopologyPreservingSimplifier.js'
import polygonClipping from 'polygon-clipping'
import { albersToLngLat, lngLatToAlbers } from '../../dev-avast/projection'
import type { Shape } from '../plan'
import { EXCLUDED_KINDS, type ExcludedArea, type ExcludedKind } from './landBase'
import type { CountedArea, Corridor, Stand } from './reads'
import type { OldForestUnit } from './units'
import { MAP_SIMPLIFY_METRES, type DrawnFeature, type DrawnGround, type DrawnKind } from './drawing'
import { ageClass, RepresentationTally, standKeys, type RepresentationYear, type StandKeys } from './representation'
import { countsAsYounger, withYoungerCap, type YoungerStandsSettings, type YoungerStandsYear } from './youngerStands'
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
  /** D.4's younger stands (`youngerStands.ts`). Absent or null: off, and nothing below changes. */
  younger?: YoungerStandsSettings | null
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
  /**
   * The stand's ground in the unit that the order does not apply to. Never counted; its old forest
   * only shapes interior, so a tenure boundary is not an edge.
   */
  excludedPart?: Geometry | null
  whole: Geometry
  cflb: boolean
  group: ReturnType<typeof leadingGroup>
  /** D.3's rows for the stand (`representation.ts`). */
  keys: StandKeys
  /**
   * Per counted kind, the stand's ground inside the unit that the kind covers. Clipped on first use:
   * only a stand that is not old in some year needs it.
   */
  counted: () => Partial<Record<CountedArea['kind'], Geometry>>
}

export interface PreparedUnit {
  unit: OldForestUnit
  stands: PreparedStand[]
  /** The corridor lines, joined. */
  corridors: Geometry | null
  /** Corridors read as areas (pipeline rights-of-way), joined: buffered like the lines. */
  corridorAreas?: Geometry | null
  /** The latest VRI projection year: resets after it are not in the inventory. */
  projectedYear: number
  /** The proxy on the unit's Crown ground, after the excluded ground left it. */
  cflbProxyHa: number
  /** Ground left out of the unit, by kind: its whole area in the unit and the proxy CFLB on it. */
  excluded: ExcludedFigures[]
  /** Clips a geometry to the excluded ground in the unit; null when there is none. */
  excludedClip?: ((g: Geometry) => Geometry | null) | null
  /** For the map only: the unit's ground and the excluded ground, in BC Albers. */
  unitGeometry?: Geometry
  excludedGround?: Geometry | null
  counts: {
    stands: number
    standsInside: number
    counted: Record<CountedArea['kind'], number>
    corridors: number
    corridorKinds: Partial<Record<Corridor['kind'], number>>
  }
}

export interface ExcludedFigures {
  kind: ExcludedKind
  /** Records read for the kind. */
  records: number
  /** Its ground within the unit, less any reported under an earlier kind. */
  grossHa: number
  /** Of that, what the proxy would have counted as CFLB. */
  cflbHa: number
}

const difference = (a: Geometry, b: Geometry): Geometry | null => {
  const g = robust((x, y) => OverlayOp.difference(x, y), a, b)
  return g.isEmpty() || !(g.getArea() > 0) ? null : polygonal(g)
}

/**
 * The excluded ground in the unit, one disjoint piece per kind: ground two sources hold (a TFL in
 * the ownership layer and the TFL layer) is reported under the first kind in `EXCLUDED_KINDS`.
 */
function excludedGround(excluded: ExcludedArea[], unitGeom: Geometry) {
  const kinds: {
    kind: ExcludedKind
    records: number
    geometry: Geometry | null
    clip: ReturnType<typeof clipper> | null
  }[] = []
  let taken: Geometry | null = null
  for (const kind of EXCLUDED_KINDS) {
    const list = excluded.filter((e) => e.kind === kind)
    if (!list.length) continue
    const joined = manyUnion(list.map((e) => toAlbers(e.geometry)))
    let g = joined ? intersection(joined, unitGeom) : null
    if (g && taken) g = difference(g, taken)
    kinds.push({ kind, records: list.length, geometry: g, clip: g ? clipper(g) : null })
    if (g) taken = taken ? union([taken, g]) : g
  }
  return { kinds, clip: taken ? clipper(taken) : null }
}

/** Projects and clips everything once; the per-year work only adds areas and, for interior, overlays. */
export function prepareUnit({
  unit,
  shape,
  stands,
  counted,
  corridors,
  excluded = [],
}: {
  unit: OldForestUnit
  shape: Shape
  stands: Stand[]
  counted: CountedArea[]
  corridors: Corridor[]
  /** Ground the order does not apply to (`landBase.ts`). None: the unit's whole ground counts. */
  excluded?: ExcludedArea[]
}): PreparedUnit {
  const unitGeom = toAlbers(shape)
  const ground = excludedGround(excluded, unitGeom)
  const removedM2 = new Map<ExcludedKind, number>()
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
    let inside = clipTo(whole)
    // The excluded part of the stand leaves the unit: the order does not apply there.
    const lost = inside && ground.clip ? ground.clip(inside) : null
    if (inside && lost) {
      if (stand.treed && stand.forestLandBase)
        for (const k of ground.kinds) {
          const part = k.clip?.(lost)
          if (part) removedM2.set(k.kind, (removedM2.get(k.kind) ?? 0) + area(part))
        }
      inside = difference(inside, lost)
    }
    projectedYear = Math.max(projectedYear, stand.projectedYear ?? 0)
    const result: PreparedStand = {
      stand,
      inside,
      insideM2: area(inside),
      excludedPart: lost,
      whole,
      cflb: stand.treed && stand.forestLandBase,
      group: leadingGroup(stand.leading),
      keys: standKeys(stand),
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
  // Lines and areas apart: interior buffers each kind on its own, and a mixed union is neither.
  const isLine = (c: Corridor) => c.geometry.type === 'LineString' || c.geometry.type === 'MultiLineString'
  const corridorGeom = union(corridors.filter(isLine).map((c) => toAlbers(c.geometry)))
  const corridorAreas = manyUnion(corridors.filter((c) => !isLine(c)).map((c) => toAlbers(c.geometry)))
  const corridorKinds: Partial<Record<Corridor['kind'], number>> = {}
  for (const c of corridors) corridorKinds[c.kind] = (corridorKinds[c.kind] ?? 0) + 1
  return {
    unit,
    stands: prepared,
    corridors: corridorGeom,
    corridorAreas,
    projectedYear,
    cflbProxyHa: prepared.reduce((s, p) => s + (p.cflb ? p.insideM2 : 0), 0) / SQ_M_PER_HA,
    excluded: ground.kinds.map((k) => ({
      kind: k.kind,
      records: k.records,
      grossHa: area(k.geometry) / SQ_M_PER_HA,
      cflbHa: (removedM2.get(k.kind) ?? 0) / SQ_M_PER_HA,
    })),
    excludedClip: ground.clip,
    unitGeometry: unitGeom,
    excludedGround: union(ground.kinds.flatMap((k) => (k.geometry ? [k.geometry] : []))),
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
      corridorKinds,
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

export interface YearFigures extends Partial<YoungerStandsYear> {
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
  /** D.4's younger-stand ground (zero and null while D.4 is off). */
  youngerPart: Geometry | null
  youngerM2: number
}

/** A younger stand's ground that D.4 adds: inside the unit, less D.1 ground (already counted) and resets. */
function youngerGround(
  inside: Geometry,
  counted: Geometry | null,
  resets: Geometry | null,
  needGeometry: boolean,
): Pick<StandYear, 'youngerPart' | 'youngerM2'> {
  let g: Geometry = inside
  if (counted && intersection(g, counted)) g = robust((x, y) => OverlayOp.difference(x, y), g, counted)
  const lost = resets ? intersection(g, resets) : null
  if (lost) g = robust((x, y) => OverlayOp.difference(x, y), g, lost)
  const m2 = area(g)
  return { youngerPart: needGeometry && m2 > 0 ? g : null, youngerM2: m2 }
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
  const none = {
    oldPart: null,
    oldM2: 0,
    countedNotOldM2: 0,
    nonPineM2: 0,
    unknownM2: 0,
    youngerPart: null,
    youngerM2: 0,
  }
  if (!p.inside || !p.cflb) return none
  const age = ageIn(p.stand, year)
  const old = age !== null && age >= unit.oldFromAge
  const counted = old ? null : countedGround(p, settings)
  const younger =
    !old && settings.younger && countsAsYounger(age, unit, settings.younger)
      ? youngerGround(p.inside, counted, resets, needGeometry)
      : null
  let part: Geometry | null = old ? p.inside : counted
  if (!part) return { ...none, ...younger, unknownM2: unknownBecauseHarvestedLater(p.stand, year) ? p.insideM2 : 0 }
  const lost = resets ? intersection(part, resets) : null
  if (lost) part = robust((x, y) => OverlayOp.difference(x, y), part, lost)
  const m2 = area(part)
  return {
    oldPart: needGeometry && m2 > 0 ? part : null,
    oldM2: m2,
    countedNotOldM2: old ? 0 : m2,
    nonPineM2: old && p.group !== 'pine' ? m2 : 0,
    unknownM2: 0,
    youngerPart: younger?.youngerPart ?? null,
    youngerM2: younger?.youngerM2 ?? 0,
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

/**
 * Old forest by age on ground the order does not apply to, less resets: it is never counted, but an
 * old patch that runs across a tenure boundary is one patch, so it shapes interior.
 */
function excludedOld(p: PreparedStand, year: number, unit: OldForestUnit, resets: Geometry | null) {
  if (!p.excludedPart || !p.cflb) return null
  const age = ageIn(p.stand, year)
  if (age === null || age < unit.oldFromAge) return null
  const lost = resets ? intersection(p.excludedPart, resets) : null
  return lost ? difference(p.excludedPart, lost) : p.excludedPart
}

/**
 * Interior area of `old` away from `edges`. With `notCounted`, the ground it clips (the excluded
 * ground) shapes the patches and their width but is left out of the area. With `keep`, the interior
 * parts counted and the buffered edges come back too (for D.3's interior split and the map); the
 * area is the same either way.
 */
function interiorOf(
  old: Geometry | null,
  edges: Geometry[],
  notCounted: ((g: Geometry) => Geometry | null) | null = null,
  keep = false,
): { m2: number; kept: Geometry[]; buffered: Geometry | null } {
  if (!old) return { m2: 0, kept: [], buffered: null }
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
  const kept: Geometry[] = []
  for (let i = 0; i < interior.getNumGeometries(); i++) {
    const part = interior.getGeometryN(i)
    if (part.getArea() <= 0) continue
    if (BufferOp.bufferOp(part, -INTERIOR_MIN_WIDTH_METRES / 2, params).isEmpty()) continue
    const lost = notCounted?.(part) ?? null
    m2 += part.getArea() - area(lost)
    if (keep) {
      const counted = lost ? difference(part, lost) : part
      if (counted) kept.push(counted)
    }
  }
  return { m2, kept, buffered: keep ? buffered : null }
}

export interface ScheduleFigures {
  schedule: string
  years: YearFigures[]
}

export interface UnitYearsOptions {
  /** D.3's breakdown (`representation.ts`) for every year; where interior is calculated, its non-pine part. */
  representation?: boolean
  /** The year to draw on the map (`drawing.ts`); it must be among both the years and the interior years. */
  drawYear?: number
}

export interface UnitYears {
  figures: YearFigures[]
  representation?: RepresentationYear[]
  drawing?: DrawnGround
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
  return unitYears(prepared, resets, years, interiorYears, settings).figures
}

/**
 * `unitFigures`, and on request D.3's breakdown and the map's shapes, from the same per-stand areas
 * and overlays. The figures are the same with or without them (`oldForest.test.ts`).
 */
export function unitYears(
  prepared: PreparedUnit,
  resets: Reset[],
  years: number[],
  interiorYears: number[],
  settings: OldForestSettings,
  options: UnitYearsOptions = {},
): UnitYears {
  const { unit } = prepared
  const resetGeoms = resets.map((r) => ({ year: r.year, geometry: toAlbers(r.geometry) }))
  const cflbHa = settings.cflbEnteredHa ?? prepared.cflbProxyHa
  // A stated CFLB takes the proxy's shares, not its hectares: on A6 and A10 the proxy's land base was
  // 37–38% larger than the LLOWG's while old forest's share of it was within a point of theirs.
  const perHa = (settings.cflbEnteredHa ? settings.cflbEnteredHa / prepared.cflbProxyHa : 1) / SQ_M_PER_HA
  const requiredOldHa = (cflbHa * unit.oldPercent) / 100
  const representation: RepresentationYear[] = []
  let drawing: DrawnGround | undefined
  const figures = years.map((year) => {
    // Resets in the inventory already show in VRI ages: only later ones (and every block) apply.
    const active = union(
      resetGeoms.filter((r) => r.year <= year && r.year > prepared.projectedYear).map((r) => r.geometry),
    )
    const withInterior = interiorYears.includes(year)
    const draw = options.drawYear === year
    const tally = options.representation ? new RepresentationTally() : null
    const totals = { old: 0, counted: 0, nonPine: 0, unknown: 0, younger: 0 }
    const oldParts: Geometry[] = []
    const edges: Geometry[] = []
    const d4 = settings.younger ?? null
    const youngerParts: Geometry[] = []
    /** Edges under D.4: a younger stand it counts (or one of that age beside the unit) makes none. */
    const youngerEdges: Geometry[] = []
    /** Counted old ground alone (not the excluded ground that shapes interior), for D.3 and the map. */
    const countedOld: Geometry[] = []
    /** Old ground that is not non-pine old: pine-leading, or D.1 ground not old by age. Usually the smaller part. */
    const notNonPine: Geometry[] = []
    const countedNotOld: Geometry[] = []
    for (const p of prepared.stands) {
      const near = active && intersects(p.whole, active) ? active : null
      const s = standYear(p, year, unit, near, settings, withInterior || draw)
      totals.old += s.oldM2
      totals.counted += s.countedNotOldM2
      totals.nonPine += s.nonPineM2
      totals.unknown += s.unknownM2
      totals.younger += s.youngerM2
      if (tally && p.inside && p.cflb) {
        const ageKey = unknownBecauseHarvestedLater(p.stand, year) ? 'unknown' : ageClass(ageIn(p.stand, year))
        const reset = near ? area(intersection(p.inside, near)) : 0
        tally.stand(p.keys, { cflb: p.insideM2, reset, old: s.oldM2, nonPine: s.nonPineM2 }, ageKey)
      }
      if (s.oldPart && (draw || (tally && withInterior))) {
        countedOld.push(s.oldPart)
        if (s.nonPineM2 === 0) notNonPine.push(s.oldPart)
        if (s.countedNotOldM2 > 0) countedNotOld.push(s.oldPart)
      }
      if (withInterior) {
        if (s.oldPart) oldParts.push(s.oldPart)
        if (s.youngerPart) youngerParts.push(s.youngerPart)
        const shaping = p.excludedPart ? excludedOld(p, year, unit, near) : null
        if (shaping) oldParts.push(shaping)
        if (makesEdge(p, year, unit, settings.interiorMethod)) {
          edges.push(p.whole)
          const younger =
            d4 && p.stand.treed && p.stand.forestLandBase && countsAsYounger(ageIn(p.stand, year), unit, d4)
          if (d4 && !younger) youngerEdges.push(p.whole)
        }
      }
    }
    let interiorHa: number | null = null
    let d4InteriorSupplyHa: number | null = null
    let interior: ReturnType<typeof interiorOf> | null = null
    if (withInterior) {
      const corridorsAndResets = [
        ...(active ? [active] : []),
        ...(prepared.corridors ? [prepared.corridors] : []),
        ...(prepared.corridorAreas ? [prepared.corridorAreas] : []),
      ]
      edges.push(...corridorsAndResets)
      const notCounted = prepared.excludedClip ?? null
      interior = interiorOf(manyUnion(oldParts), edges, notCounted, draw || tally !== null)
      interiorHa = interior.m2 * perHa
      if (d4) {
        // D.4's interior is what the younger stands add when they count as old and make no edge.
        const withYounger = interiorOf(
          manyUnion([...oldParts, ...youngerParts]),
          [...youngerEdges, ...corridorsAndResets],
          notCounted,
        ).m2
        d4InteriorSupplyHa = Math.max(0, withYounger * perHa - interiorHa)
      }
    }
    const figures: YearFigures = {
      year,
      cflbHa,
      requiredOldHa,
      oldHa: totals.old * perHa,
      countedNotOldHa: totals.counted * perHa,
      requiredNonPineHa: unit.nonPinePercent === null ? null : (cflbHa * unit.nonPinePercent) / 100,
      nonPineOldHa: totals.nonPine * perHa,
      unknownAgeHa: totals.unknown * perHa,
      requiredInteriorHa: (requiredOldHa * unit.interiorPercent) / 100,
      interiorHa,
    }
    if (tally) {
      let interiorNonPineHa: number | null = null
      if (interior) {
        // Interior on non-pine-leading old ground (the policy's section 7 calls its share uncertain):
        // interior less what lies on the other old ground, the smaller overlay of the two.
        const other = manyUnion(notNonPine)
        const otherM2 = other ? interior.kept.reduce((sum, part) => sum + area(intersection(part, other)), 0) : 0
        interiorNonPineHa = Math.max(0, interior.m2 - otherM2) * perHa
      }
      representation.push({ year, interiorHa, interiorNonPineHa, by: tally.result(perHa) })
    }
    if (draw)
      drawing = drawnGround(prepared, year, {
        old: manyUnion(countedOld),
        interior: interior ? union(interior.kept) : null,
        buffered: interior?.buffered ?? null,
        counted: manyUnion(countedNotOld),
        younger: manyUnion(youngerParts),
      })
    if (!d4) return figures
    return withYoungerCap({ ...figures, d4OldSupplyHa: totals.younger * perHa, d4InteriorSupplyHa })
  })
  return {
    figures,
    ...(options.representation ? { representation } : {}),
    ...(drawing ? { drawing } : {}),
  }
}

/** JSTS's typings leave these off `Geometry`. */
const isEmpty = (g: Geometry) => (g as unknown as { isEmpty(): boolean }).isEmpty()
const dimensionOf = (g: Geometry) => (g as unknown as { getDimension(): number }).getDimension()

/** A BC Albers geometry simplified for display and put back in WGS84; null when nothing is left. */
function forDisplay(g: Geometry | null): DrawnFeature['geometry'] | null {
  if (!g || isEmpty(g)) return null
  const simple = TopologyPreservingSimplifier.simplify(g, MAP_SIMPLIFY_METRES) as Geometry
  if (isEmpty(simple)) return null
  const j = writer.write(simple) as { type: string; coordinates: unknown }
  const depth = ({ LineString: 0, MultiLineString: 1, Polygon: 1, MultiPolygon: 2 } as Record<string, number>)[j.type]
  // An overlay can leave a collection: draw its polygons.
  if (depth === undefined) return j.type === 'GeometryCollection' ? forDisplay(nonEmpty(polygonal(simple))) : null
  const round = (v: number) => Math.round(v * 1e6) / 1e6
  const back = (c: unknown, d: number): unknown =>
    d === 0
      ? (c as Position[]).map(([x, y]) => albersToLngLat(x, y).map(round) as Position)
      : (c as unknown[]).map((x) => back(x, d - 1))
  return { type: j.type, coordinates: back(j.coordinates, depth) } as DrawnFeature['geometry']
}

const nonEmpty = (g: Geometry) => (isEmpty(g) ? null : g)

/**
 * The year's shapes for the map, from the run's own overlays: old forest split into interior,
 * within 200 m of an edge and too narrow; the 200 m band; D.1 ground not old by age; D.4's younger
 * stands; the corridors; and the ground the order does not apply to. Areas are measured before
 * simplifying and are not scaled by a stated CFLB.
 */
function drawnGround(
  prepared: PreparedUnit,
  year: number,
  g: {
    old: Geometry | null
    interior: Geometry | null
    buffered: Geometry | null
    counted: Geometry | null
    younger: Geometry | null
  },
): DrawnGround {
  const unitGeom = prepared.unitGeometry ?? null
  const band = g.buffered && unitGeom ? intersection(g.buffered, unitGeom) : null
  const oldEdge = g.old && g.buffered ? intersection(g.old, g.buffered) : null
  let narrow = g.old && g.buffered ? difference(g.old, g.buffered) : g.old
  if (narrow && g.interior) narrow = difference(narrow, g.interior)
  const parts: [DrawnKind, Geometry | null][] = [
    ['excluded', prepared.excludedGround ?? null],
    ['edge-band', band],
    ['old-edge', oldEdge],
    ['old-narrow', narrow],
    ['interior', g.interior],
    ['younger', g.younger],
    ['counted', g.counted],
    ['corridor', prepared.corridors && unitGeom ? lineWithin(prepared.corridors, unitGeom) : null],
    ['corridor', prepared.corridorAreas && unitGeom ? intersection(prepared.corridorAreas, unitGeom) : null],
  ]
  const features: DrawnFeature[] = []
  const drawnHa: DrawnGround['drawnHa'] = {}
  for (const [kind, geom] of parts) {
    if (!geom) continue
    if (dimensionOf(geom) === 2) drawnHa[kind] = (drawnHa[kind] ?? 0) + geom.getArea() / SQ_M_PER_HA
    const geometry = forDisplay(geom)
    if (geometry) features.push({ kind, unit: prepared.unit.unit, geometry })
  }
  return { year, features, drawnHa }
}

/** The part of a line inside an area, retried on the 10 cm grid; null when none is. */
function lineWithin(line: Geometry, within: Geometry): Geometry | null {
  if (!intersects(line, within)) return null
  let g: Geometry
  try {
    g = OverlayOp.intersection(line, within)
  } catch {
    const [a, b] = [line, within].map((x) => GeometryPrecisionReducer.reduce(x, coarse))
    g = OverlayOp.intersection(a, b)
  }
  return isEmpty(g) ? null : g
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

/** A line overlay's length, retried on the 10 cm grid if JSTS fails to node it. */
function lengthWithin(line: Geometry, within: Geometry): number {
  if (!intersects(line, within)) return 0
  try {
    return OverlayOp.intersection(line, within).getLength()
  } catch (e) {
    if (!(e instanceof Error) || !/non-noded|TopologyException/i.test(`${e.name} ${e.message}`)) throw e
    const [a, b] = [line, within].map((g) => GeometryPrecisionReducer.reduce(g, coarse))
    return OverlayOp.intersection(a, b).getLength()
  }
}

/** A BC Albers area back in WGS84. */
function toLngLat(g: Geometry): Shape {
  const j = writer.write(polygonal(g)) as unknown as Shape
  const ring = (r: Position[]) => r.map(([x, y]) => albersToLngLat(x, y) as Position)
  return j.type === 'Polygon'
    ? { type: 'Polygon', coordinates: j.coordinates.map(ring) }
    : { type: 'MultiPolygon', coordinates: j.coordinates.map((poly) => poly.map(ring)) }
}

/** The footprint grown by `metres` in BC Albers, back in WGS84: what a read near the footprint asks for. */
export function grownFootprint(footprint: Shape, metres: number): Shape {
  return toLngLat(BufferOp.bufferOp(toAlbers(footprint), metres))
}

/**
 * Each line's length in metres inside the footprint and within `metres` of it (inside included),
 * and the same for all of them joined, so a stretch two records share is counted once.
 */
export function linesNearFootprint(
  footprint: Shape,
  metres: number,
  lines: (LineString | MultiLineString)[],
): { each: { insideM: number; nearM: number }[]; insideM: number; nearM: number } {
  const base = toAlbers(footprint)
  const grown = BufferOp.bufferOp(base, metres)
  const geoms = lines.map((l) => toAlbers(l))
  const each = geoms.map((g) => ({ insideM: lengthWithin(g, base), nearM: lengthWithin(g, grown) }))
  if (geoms.length < 2) return { each, insideM: each[0]?.insideM ?? 0, nearM: each[0]?.nearM ?? 0 }
  const collection = factory.createGeometryCollection(geoms)
  let joined: Geometry
  try {
    joined = UnaryUnionOp.union(collection)
  } catch {
    joined = UnaryUnionOp.union(GeometryPrecisionReducer.reduce(collection, coarse))
  }
  return { each, insideM: lengthWithin(joined, base), nearM: lengthWithin(joined, grown) }
}

/** How many of each record's points lie within `metres` of the footprint (inside included), and inside it. */
export function pointsNearFootprint(
  footprint: Shape,
  metres: number,
  points: (Point | MultiPoint)[],
): { insideCount: number; nearCount: number }[] {
  const base = toAlbers(footprint)
  return points.map((p) => {
    let insideCount = 0
    let nearCount = 0
    for (const [x, y] of p.type === 'Point' ? [p.coordinates] : p.coordinates) {
      const distance = DistanceOp.distance(
        base,
        reader.read({ type: 'Point', coordinates: lngLatToAlbers(x, y) }),
      ) as number
      if (distance <= metres) nearCount++
      if (distance === 0) insideCount++
    }
    return { insideCount, nearCount }
  })
}

/** The three overlays the grazing review's lines and points take (`NearOverlay` in `grazingEvidence.ts`). */
export const nearFootprint = { grow: grownFootprint, lines: linesNearFootprint, points: pointsNearFootprint }

/** The part of `a` inside `b`, in WGS84, or `null` where they share no area. */
export function clipShape(a: Shape, b: Shape): Shape | null {
  const g = intersection(toAlbers(a), toAlbers(b))
  return g ? toLngLat(g) : null
}

/**
 * Which items share area with which regions, `[region][item]`, each projected once. Touching along
 * an edge is not sharing ground. Used for the ground read's precedent (openings in an instrument).
 */
export function overlapMatrix(regions: Shape[], items: Shape[]): boolean[][] {
  const r = regions.map((s) => toAlbers(s))
  const it = items.map((s) => toAlbers(s))
  return r.map((region) => it.map((item) => intersection(region, item) !== null))
}

/** The overlays the ground read takes (`GroundOverlay` in `ground/groundRead.ts`). */
export const groundOverlay = { measure: overlapsWith, grow: grownFootprint, clip: clipShape, overlaps: overlapMatrix }
