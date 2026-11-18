/**
 * The one layer model every GIS writer here takes (`geoPackage.ts`, `kml.ts`, `kmz.ts` and, through
 * {@link shapeLayerFromGisLayer}, `shapefile.ts`): a named layer of one geometry family with typed
 * fields, its features in WGS84 longitude/latitude with an optional height. A tool builds its
 * layers once and hands the same array to every format, so no format has a feature builder of its
 * own. The road designer's shapefile layers come in through {@link gisLayerFromShapeLayer}.
 *
 * Nothing is guessed: a GeoJSON property becomes a number column only when every value is one, and
 * a date string stays text. Every value or geometry a conversion cannot carry is reported in
 * `warnings`, never dropped silently. No DOM or network access.
 */
import type { ShapeField, ShapeLayer } from './shapefile'

/** Longitude, latitude and, when the layer has heights, a height in metres. */
export type GisPosition = readonly number[]
export type GisGeometryFamily = 'point' | 'line' | 'polygon'
/**
 * `boolean` and the two date types earn a place because GeoPackage has columns for them that QGIS
 * and ArcGIS read as such; written as text, a date would not sort or filter as one. A `date` is
 * `YYYY-MM-DD`; a `datetime` an ISO 8601 instant in UTC.
 */
export type GisFieldType = 'text' | 'integer' | 'real' | 'boolean' | 'date' | 'datetime'

export interface GisField {
  /** The key of the value in each feature's `attributes`, and the column name where a format allows it. */
  name: string
  type: GisFieldType
  /** A readable name: a GeoPackage column alias and KML's `displayName`. */
  title?: string
  description?: string
  /** Hints for fixed-width formats (dBase): characters, and decimals of a `real`. Other formats ignore them. */
  width?: number
  decimals?: number
}

interface GisFeatureBase {
  /** Values by field name. A missing or null value is unknown, never zero or empty text. */
  attributes: Readonly<Record<string, unknown>>
}
/** One or more points (several make a multipoint). */
export interface GisPointFeature extends GisFeatureBase {
  points: readonly GisPosition[]
}
/** One or more lines (several make a multilinestring). */
export interface GisLineFeature extends GisFeatureBase {
  lines: readonly (readonly GisPosition[])[]
}
/** One or more polygons, each its outer ring and then its holes, as in GeoJSON. */
export interface GisPolygonFeature extends GisFeatureBase {
  polygons: readonly (readonly (readonly GisPosition[])[])[]
}
export type GisFeature = GisPointFeature | GisLineFeature | GisPolygonFeature

interface GisLayerBase {
  /** Machine name: the GeoPackage table, the shapefile's file name. Writers sanitise it and say so. */
  name: string
  /** Readable name: the GeoPackage identifier and the KML folder's name. Defaults to `name`. */
  title?: string
  description?: string
  fields: readonly GisField[]
}
export type GisLayer =
  | (GisLayerBase & { geometry: 'point'; features: readonly GisPointFeature[] })
  | (GisLayerBase & { geometry: 'line'; features: readonly GisLineFeature[] })
  | (GisLayerBase & { geometry: 'polygon'; features: readonly GisPolygonFeature[] })

/** A feature's parts: its points, lines or polygons, whichever its family has. */
export function featureParts(layer: GisLayer, feature: GisFeature): readonly unknown[] {
  if (layer.geometry === 'point') return (feature as GisPointFeature).points
  if (layer.geometry === 'line') return (feature as GisLineFeature).lines
  return (feature as GisPolygonFeature).polygons
}

/** Every position of a feature, in order. */
export function featurePositions(layer: GisLayer, feature: GisFeature): GisPosition[] {
  if (layer.geometry === 'point') return [...(feature as GisPointFeature).points]
  if (layer.geometry === 'line') return (feature as GisLineFeature).lines.flat()
  return (feature as GisPolygonFeature).polygons.flat(2)
}

const hasHeight = (position: GisPosition) => position.length >= 3 && Number.isFinite(position[2])

/** Whether any position in the layer has a finite height; a layer either has Z or it does not. */
export function layerHasZ(layer: GisLayer): boolean {
  return layer.features.some((feature) => featurePositions(layer, feature).some(hasHeight))
}

/** Positions of a Z layer that have no height, which each format has to write some way. */
export function positionsWithoutHeight(layer: GisLayer): number {
  let missing = 0
  for (const feature of layer.features)
    for (const position of featurePositions(layer, feature)) if (!hasHeight(position)) missing += 1
  return missing
}

/** Whether every multi-part feature is really one part, so the layer can be written as the single type. */
export function layerIsMulti(layer: GisLayer): boolean {
  return layer.features.some((feature) => featureParts(layer, feature).length > 1)
}

/** Twice a ring's signed area; positive when it runs counter-clockwise with y up. */
function signedArea(ring: readonly GisPosition[]) {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return sum
}

/**
 * A polygon's rings closed, the outer ring counter-clockwise and holes clockwise: the right-hand
 * order GeoPackage readers and KML clients expect. Closing a ring or reversing it changes no shape,
 * so nothing is reported.
 */
export function closedPolygonRings(polygon: readonly (readonly GisPosition[])[]): GisPosition[][] {
  return polygon.map((ring, index) => {
    if (!ring.length) return []
    const first = ring[0],
      last = ring[ring.length - 1]
    const closed = first[0] === last[0] && first[1] === last[1] ? [...ring] : [...ring, first]
    const counterClockwise = signedArea(closed) > 0
    return counterClockwise === (index === 0) ? closed : closed.reverse()
  })
}

/** The field a placemark or a message names a feature by: a field called "name", in any case. */
export function nameFieldOf(layer: GisLayer): GisField | undefined {
  return layer.fields.find((field) => field.name.toLowerCase() === 'name')
}

/**
 * Raised for a coordinate no format can write: not finite, or outside longitude/latitude, which is
 * almost always projected coordinates handed over by mistake. It names the layer and the feature
 * so the person can find it.
 */
export class GisCoordinateError extends Error {
  readonly layerName: string
  readonly featureIndex: number
  constructor(layerName: string, featureIndex: number, featureLabel: string | null, position: GisPosition) {
    const which = `feature ${featureIndex + 1}${featureLabel ? ` (${featureLabel})` : ''}`
    super(
      `Layer "${layerName}", ${which}: [${position.join(', ')}] is not a finite WGS84 longitude and latitude, so it cannot be written.`,
    )
    this.name = 'GisCoordinateError'
    this.layerName = layerName
    this.featureIndex = featureIndex
  }
}

/** A feature's label for messages: its name field's value, if it has one. */
export function featureLabel(layer: GisLayer, feature: GisFeature): string | null {
  const field = nameFieldOf(layer)
  const value = field ? feature.attributes[field.name] : null
  return value == null || value === '' ? null : String(value).slice(0, 80)
}

/** Throws {@link GisCoordinateError} at the first position that is not a finite longitude/latitude. */
export function assertWritableCoordinates(layer: GisLayer): void {
  layer.features.forEach((feature, index) => {
    for (const position of featurePositions(layer, feature)) {
      const [x, y] = position
      if (position.length < 2 || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90)
        throw new GisCoordinateError(layer.name, index, featureLabel(layer, feature), position)
    }
  })
}

// --- attribute values ---------------------------------------------------------------------------

export type GisValue = string | number | boolean | null

const pad = (n: number, width = 2) => String(n).padStart(width, '0')
function isoDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date : null
}

/**
 * A value as its field's type holds it, or why it cannot be: the writers turn `problem` into one
 * warning per field. Text takes anything (an object as JSON); a number field never takes text, and an
 * integer field never a fraction, so a value is never rounded or parsed into something it was not.
 */
export function fieldValue(field: GisField, value: unknown): { value: GisValue; problem?: string } {
  if (value == null) return { value: null }
  switch (field.type) {
    case 'text':
      if (typeof value === 'string') return { value }
      if (value instanceof Date) return { value: Number.isFinite(value.getTime()) ? value.toISOString() : null }
      if (typeof value === 'object') return { value: JSON.stringify(value) }
      return { value: String(value) }
    case 'integer':
      if (typeof value === 'number' && Number.isSafeInteger(value)) return { value }
      if (typeof value === 'bigint' && value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER)
        return { value: Number(value) }
      if (typeof value === 'number' && !Number.isFinite(value)) return { value: null }
      if (typeof value === 'boolean') return { value: value ? 1 : 0 }
      return { value: null, problem: typeof value === 'number' ? 'not a whole number' : 'not a number' }
    case 'real':
      if (typeof value === 'number') return { value: Number.isFinite(value) ? value : null }
      if (typeof value === 'bigint') return { value: Number(value) }
      return { value: null, problem: 'not a number' }
    case 'boolean':
      if (typeof value === 'boolean') return { value }
      if (value === 0 || value === 1) return { value: value === 1 }
      return { value: null, problem: 'not true or false' }
    case 'date':
    case 'datetime': {
      // A bare `YYYY-MM-DD` is the date as written: going through Date would move it a day west of UTC.
      if (field.type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { value }
      const date = isoDate(value)
      if (!date) return { value: null, problem: 'not a date' }
      if (field.type === 'datetime') return { value: date.toISOString() }
      return {
        value: `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
      }
    }
  }
}

/** Counts values a field could not hold, by field and reason, for one warning each. */
export class ValueProblems {
  private counts = new Map<string, number>()
  add(field: string, problem: string) {
    const key = `${field}\u0000${problem}`
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1)
  }
  warnings(layerName: string): string[] {
    return [...this.counts].map(([key, n]) => {
      const [field, problem] = key.split('\u0000')
      return `${layerName} ${field}: left blank in ${n} record${n === 1 ? '' : 's'}; the value is ${problem}.`
    })
  }
}

/** Attribute keys some feature carries that are not among the layer's fields, so no format writes them. */
export function unlistedAttributeWarnings(layer: GisLayer): string[] {
  const listed = new Set(layer.fields.map((field) => field.name))
  const unlisted = new Set<string>()
  for (const feature of layer.features)
    for (const key of Object.keys(feature.attributes)) if (!listed.has(key)) unlisted.add(key)
  return unlisted.size
    ? [`${layer.name}: ${[...unlisted].join(', ')} left out; the layer has no field of that name.`]
    : []
}

// --- GeoJSON ----------------------------------------------------------------------------------

/** A geometry's parts in its family, or null when it mixes families or is not one GeoJSON names. */
function geometryParts(geometry: GeoJSON.Geometry): { family: GisGeometryFamily; parts: unknown[] } | null {
  switch (geometry.type) {
    case 'Point':
      return { family: 'point', parts: [geometry.coordinates] }
    case 'MultiPoint':
      return { family: 'point', parts: geometry.coordinates }
    case 'LineString':
      return { family: 'line', parts: [geometry.coordinates] }
    case 'MultiLineString':
      return { family: 'line', parts: geometry.coordinates }
    case 'Polygon':
      return { family: 'polygon', parts: [geometry.coordinates] }
    case 'MultiPolygon':
      return { family: 'polygon', parts: geometry.coordinates }
    case 'GeometryCollection': {
      const members = geometry.geometries.map(geometryParts)
      const family = members[0]?.family
      if (!family || members.some((member) => member?.family !== family)) return null
      return { family, parts: members.flatMap((member) => member!.parts) }
    }
    default:
      return null
  }
}

/** A field's type from every value it holds: numbers only when all are, booleans only when all are. */
function inferType(values: unknown[]): GisFieldType {
  const known = values.filter((value) => value != null)
  if (!known.length) return 'text'
  if (known.every((value) => typeof value === 'boolean')) return 'boolean'
  if (known.every((value) => typeof value === 'number' && Number.isFinite(value)))
    return known.every((value) => Number.isSafeInteger(value)) ? 'integer' : 'real'
  return 'text'
}

/**
 * A FeatureCollection as layers, one per geometry family it holds: `name` alone when there is one
 * family, else `name_points`, `name_lines`, `name_polygons`. Fields are the union of the properties
 * in first-seen order, typed from their values; a feature id becomes an `id` field so every format
 * keeps it. A feature with no geometry, an unknown type or a collection that mixes families is left
 * out and counted in `warnings`.
 */
export function layersFromGeoJson(
  collection: GeoJSON.FeatureCollection,
  options: { name: string; title?: string; description?: string },
): { layers: GisLayer[]; warnings: string[] } {
  const warnings: string[] = []
  const groups = new Map<GisGeometryFamily, { parts: unknown[]; feature: GeoJSON.Feature }[]>()
  let empty = 0,
    mixed = 0
  for (const feature of collection.features) {
    if (!feature.geometry) {
      empty += 1
      continue
    }
    const split = geometryParts(feature.geometry)
    if (!split) {
      mixed += 1
      continue
    }
    const group = groups.get(split.family) ?? []
    group.push({ parts: split.parts, feature })
    groups.set(split.family, group)
  }
  const count = (n: number) => `${n} feature${n === 1 ? '' : 's'}`
  if (empty) warnings.push(`${options.name}: ${count(empty)} without a geometry left out.`)
  if (mixed)
    warnings.push(
      `${options.name}: ${count(mixed)} left out; a geometry collection that mixes points, lines and polygons, or a geometry type this writer does not know, fits no one layer.`,
    )
  const order: GisGeometryFamily[] = ['point', 'line', 'polygon']
  const suffix = { point: 'points', line: 'lines', polygon: 'polygons' } as const
  const families = order.filter((family) => groups.has(family))
  const layers = families.map((family): GisLayer => {
    const members = groups.get(family)!
    const keys: string[] = []
    const seen = new Set<string>()
    for (const { feature } of members)
      for (const key of Object.keys(feature.properties ?? {}))
        if (!seen.has(key)) {
          seen.add(key)
          keys.push(key)
        }
    const hasId = members.some(({ feature }) => feature.id != null)
    let idKey = 'id'
    for (let n = 2; hasId && seen.has(idKey); n++) idKey = n === 2 ? 'feature_id' : `feature_id_${n - 1}`
    const fields: GisField[] = keys.map((key) => ({
      name: key,
      type: inferType(members.map(({ feature }) => feature.properties?.[key])),
    }))
    if (hasId) fields.unshift({ name: idKey, type: inferType(members.map(({ feature }) => feature.id)) })
    const attributes = (feature: GeoJSON.Feature) => ({
      ...(hasId ? { [idKey]: feature.id ?? null } : {}),
      ...(feature.properties ?? {}),
    })
    const base = {
      name: families.length > 1 ? `${options.name}_${suffix[family]}` : options.name,
      title: options.title && families.length > 1 ? `${options.title} (${suffix[family]})` : options.title,
      description: options.description,
      fields,
    }
    if (family === 'point')
      return {
        ...base,
        geometry: 'point',
        features: members.map(({ parts, feature }) => ({
          points: parts as GisPosition[],
          attributes: attributes(feature),
        })),
      }
    if (family === 'line')
      return {
        ...base,
        geometry: 'line',
        features: members.map(({ parts, feature }) => ({
          lines: parts as GisPosition[][],
          attributes: attributes(feature),
        })),
      }
    return {
      ...base,
      geometry: 'polygon',
      features: members.map(({ parts, feature }) => ({
        polygons: parts as GisPosition[][][],
        attributes: attributes(feature),
      })),
    }
  })
  return { layers, warnings }
}

/** One feature's geometry as GeoJSON: the single type for one part, the multi type for several, null for none. */
export function featureGeometry(layer: GisLayer, feature: GisFeature): GeoJSON.Geometry | null {
  const parts = featureParts(layer, feature)
  if (!parts.length) return null
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  if (layer.geometry === 'point') {
    const points = copy((feature as GisPointFeature).points) as GeoJSON.Position[]
    return points.length === 1 ? { type: 'Point', coordinates: points[0] } : { type: 'MultiPoint', coordinates: points }
  }
  if (layer.geometry === 'line') {
    const lines = copy((feature as GisLineFeature).lines) as GeoJSON.Position[][]
    return lines.length === 1
      ? { type: 'LineString', coordinates: lines[0] }
      : { type: 'MultiLineString', coordinates: lines }
  }
  const polygons = copy((feature as GisPolygonFeature).polygons) as GeoJSON.Position[][][]
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons }
}

/** A layer as a FeatureCollection: its fields first, in order, then any other attribute a feature carries. */
export function layerToGeoJson(layer: GisLayer): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: layer.features.map((feature) => {
      const properties: Record<string, unknown> = {}
      for (const field of layer.fields) properties[field.name] = feature.attributes[field.name] ?? null
      for (const [key, value] of Object.entries(feature.attributes)) if (!(key in properties)) properties[key] = value
      return { type: 'Feature', properties, geometry: featureGeometry(layer, feature) } as GeoJSON.Feature
    }),
  }
}

// --- shapefile layers -------------------------------------------------------------------------

/**
 * A shapefile layer as a neutral layer, so the road designer's `roadShapefileLayers` feed GeoPackage
 * and KML without a second feature builder. A dBase number with decimals is `real`, without
 * `integer`; widths and decimals are kept as hints, so {@link shapeLayerFromGisLayer} gives the
 * same table back. A shapefile polygon record is one polygon (its first ring outer).
 */
export function gisLayerFromShapeLayer(layer: ShapeLayer): GisLayer {
  const fields = layer.fields.map(
    (field): GisField =>
      field.type === 'C'
        ? { name: field.name, type: 'text', width: field.length }
        : field.decimals
          ? { name: field.name, type: 'real', width: field.length, decimals: field.decimals }
          : { name: field.name, type: 'integer', width: field.length },
  )
  const base = { name: layer.name, fields }
  if (layer.type === 'point')
    return {
      ...base,
      geometry: 'point',
      features: layer.features.map((feature) => ({ points: [feature.point], attributes: feature.attributes })),
    }
  if (layer.type === 'polyline')
    return {
      ...base,
      geometry: 'line',
      features: layer.features.map((feature) => ({ lines: feature.parts, attributes: feature.attributes })),
    }
  return {
    ...base,
    geometry: 'polygon',
    features: layer.features.map((feature) => ({
      polygons: feature.parts.length ? [feature.parts] : [],
      attributes: feature.attributes,
    })),
  }
}

/** Most decimals a dBase number is given when its field states none; past it a value is rounded and reported. */
export const DBF_DEFAULT_MAX_DECIMALS = 8

/** Characters Windows refuses in a file name, and path separators. */
// eslint-disable-next-line no-control-regex -- control characters are among those refused
const UNSAFE_FILE_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g

/** Decimals a number needs to be written exactly, as its shortest round-trip text shows them. */
function decimalsOf(value: number): number {
  const text = String(Math.abs(value))
  const exponent = /e([+-]\d+)$/.exec(text)
  const mantissa = text.replace(/e[+-]\d+$/, '')
  const fraction = mantissa.split('.')[1]?.length ?? 0
  return Math.max(0, fraction - (exponent ? Number(exponent[1]) : 0))
}

/**
 * A neutral layer as a shapefile layer for `writeShapefileLayer`. dBase field names are 1-10
 * capitals, digits or `_`, so names are folded to that and de-duplicated; booleans and dates go in
 * as text (`true`/`false`, ISO 8601) because the dBase writer has only text and number fields. The
 * writer is 2D and one part per point or polygon record, so heights are left out and a multipoint
 * or multipolygon becomes one record per part, each with the feature's attributes. Every such change
 * is in `warnings`.
 */
export function shapeLayerFromGisLayer(layer: GisLayer): { layer: ShapeLayer; warnings: string[] } {
  const warnings = unlistedAttributeWarnings(layer)
  const name = layer.name.replace(UNSAFE_FILE_CHARACTERS, '_') || 'layer'
  if (name !== layer.name) warnings.push(`${layer.name}: written as the file name "${name}".`)
  const taken = new Set<string>()
  const problems = new ValueProblems()
  const rounded = new Map<string, number>()
  const columns = layer.fields.map((field) => {
    const folded = field.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'FIELD'
    let dbfName = folded.slice(0, 10)
    for (let n = 1; taken.has(dbfName); n++) dbfName = `${folded.slice(0, 10 - String(n).length - 1)}_${n}`
    taken.add(dbfName)
    if (dbfName !== field.name)
      warnings.push(
        `${name} ${field.name}: written as ${dbfName}; a dBase field name is up to 10 capitals, digits or _.`,
      )
    let shape: ShapeField
    if (field.type === 'integer') shape = { name: dbfName, type: 'N', length: field.width ?? 1, decimals: 0 }
    else if (field.type === 'real') {
      const needed = Math.max(
        0,
        ...layer.features.map((feature) => {
          const value = feature.attributes[field.name]
          return typeof value === 'number' && Number.isFinite(value) ? decimalsOf(value) : 0
        }),
      )
      const decimals = field.decimals ?? Math.min(needed, DBF_DEFAULT_MAX_DECIMALS)
      shape = { name: dbfName, type: 'N', length: field.width ?? 1, decimals }
    } else shape = { name: dbfName, type: 'C', length: field.width ?? 1 }
    return { field, shape }
  })
  const attributesOf = (feature: GisFeature) => {
    const out: Record<string, unknown> = {}
    for (const { field, shape } of columns) {
      const { value, problem } = fieldValue(field, feature.attributes[field.name])
      if (problem) problems.add(field.name, problem)
      if (
        field.type === 'real' &&
        typeof value === 'number' &&
        field.decimals == null &&
        decimalsOf(value) > (shape.decimals ?? 0)
      )
        rounded.set(field.name, (rounded.get(field.name) ?? 0) + 1)
      out[shape.name] = typeof value === 'boolean' ? String(value) : value
    }
    return out
  }
  const fields = columns.map(({ shape }) => shape)
  if (layerHasZ(layer)) warnings.push(`${name}: heights left out; the shapefile is written in 2D.`)
  let split = 0,
    withoutGeometry = 0
  let shape: ShapeLayer
  const flat = (position: GisPosition): [number, number] => [position[0], position[1]]
  if (layer.geometry === 'point') {
    const features: { point: [number, number]; attributes: Record<string, unknown> }[] = []
    for (const feature of layer.features) {
      if (!feature.points.length) withoutGeometry += 1
      if (feature.points.length > 1) split += 1
      const attributes = attributesOf(feature)
      for (const point of feature.points) features.push({ point: flat(point), attributes })
    }
    shape = { name, type: 'point', fields, features }
  } else if (layer.geometry === 'line') {
    shape = {
      name,
      type: 'polyline',
      fields,
      features: layer.features.map((feature) => ({
        parts: feature.lines.map((line) => line.map(flat)),
        attributes: attributesOf(feature),
      })),
    }
  } else {
    const features: { parts: [number, number][][]; attributes: Record<string, unknown> }[] = []
    for (const feature of layer.features) {
      if (feature.polygons.length > 1) split += 1
      const attributes = attributesOf(feature)
      if (!feature.polygons.length) features.push({ parts: [], attributes })
      for (const polygon of feature.polygons)
        features.push({ parts: polygon.map((ring) => ring.map(flat)), attributes })
    }
    shape = { name, type: 'polygon', fields, features }
  }
  // attributesOf runs as the records are built, so the value counts are complete only here.
  warnings.push(...problems.warnings(name))
  for (const [field, n] of rounded)
    warnings.push(
      `${name} ${field}: rounded to ${DBF_DEFAULT_MAX_DECIMALS} decimals in ${n} record${n === 1 ? '' : 's'}; give the field its decimals to choose another precision.`,
    )
  if (split)
    warnings.push(
      `${name}: ${split} multi-part feature${split === 1 ? '' : 's'} written as one record per part, each with the feature's attributes.`,
    )
  if (withoutGeometry)
    warnings.push(
      `${name}: ${withoutGeometry} point feature${withoutGeometry === 1 ? '' : 's'} without a point left out.`,
    )
  return { layer: shape, warnings }
}
