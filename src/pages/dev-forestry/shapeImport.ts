/**
 * Bringing outside geometry onto the page: zipped shapefiles, GeoJSON, and
 * anything already parsed into feature collections.
 *
 * Polygons become assessable blocks and lines become candidate road
 * centrelines, so one drop of a planning package can supply both sides of a
 * visibility run.
 */

import { polygonAreaMeters, type PolygonGeometry } from './visibility'

export type ImportedPolygon = {
  name: string
  geometry: PolygonGeometry
  areaMeters: number
  /** Planning identifiers the attributes carried, for the block summary. */
  planning?: BlockPlanningIds
}

/** What a planning note heads a block with: block, licence, cutting permit, opening. */
export type BlockPlanningIds = {
  blockId?: string | null
  licenceId?: string | null
  permitId?: string | null
  openingId?: string | null
}

export type ImportedLine = {
  name: string
  coordinates: Array<[number, number]>
}

export type ImportedGeometry = {
  polygons: ImportedPolygon[]
  lines: ImportedLine[]
  /** Features that carried no polygon or line geometry. */
  skippedCount: number
}

/**
 * Attribute names worth showing as a block label, most specific first. Forestry
 * exports rarely use `name`; they use the opening or cut block identifier.
 */
const NAME_KEYS = [
  'CUT_BLOCK_ID',
  'CUTBLOCK_ID',
  'BLOCK_ID',
  'BLOCK',
  'OPENING_ID',
  'HARVEST_AREA_ID',
  'LICENCE_ID',
  'FEATURE_ID',
  'NAME',
  'Name',
  'name',
  'LABEL',
  'label',
  'TITLE',
  'title',
  'ID',
  'id',
]

/** The most useful label a feature's attributes offer, falling back to its index. */
export function featureName(
  properties: Record<string, unknown> | null | undefined,
  fallbackIndex: number,
  prefix = 'Polygon',
): string {
  return ownName(properties) ?? `${prefix} ${fallbackIndex + 1}`
}

/** The label a feature's own attributes give it, if any of `NAME_KEYS` is filled. */
function ownName(properties: Record<string, unknown> | null | undefined): string | null {
  return properties ? firstAttribute(properties, NAME_KEYS) : null
}

/**
 * Attributes that say where a block lies, most specific first: what an unnamed block is numbered
 * within ("Buckhorn 3"), so a reviewer can tell blocks apart and find them. A licensee's plan often
 * fills the block id on a few blocks only, while every block carries its operating area.
 *
 * Only text that names a place is taken: never the numeric area columns ArcGIS writes beside these
 * (`Area`, `Shape_Area`), which are not on the list, nor a value with no letter in it.
 */
const GROUP_KEYS = [
  'OPERATING_AREA',
  'OPER_AREA',
  'OP_AREA',
  'AREA_NAME',
  'SUPPLY_BLOCK',
  'LANDSCAPE_UNIT',
  'LU_NAME',
  'DRAINAGE',
  'LOCATION',
]

/** dBASE keeps 10 characters of a column name, so ArcGIS writes `OPERATING_AREA` as `Operating_`. */
const DBASE_FIELD_NAME_LENGTH = 10

/**
 * The operating area (or other place grouping) a feature's attributes name, ignoring case and
 * matching the 10-character name a shapefile cuts a longer column name to.
 */
export function featureGroup(properties: Record<string, unknown> | null | undefined): string | null {
  if (!properties) return null
  const columns = Object.keys(properties)
  for (const key of GROUP_KEYS) {
    const wanted = new Set([key.toLowerCase(), key.slice(0, DBASE_FIELD_NAME_LENGTH).toLowerCase()])
    for (const column of columns) {
      if (!wanted.has(column.toLowerCase())) continue
      const value = properties[column]
      if (typeof value === 'string' && /\p{L}/u.test(value)) return value.trim()
    }
  }
  return null
}

/**
 * Names for a collection's blocks, in file order. A block's own identifier is kept exactly; an
 * unnamed block is numbered within its operating area ("Buckhorn 2" is the area's second unnamed
 * block in the file), and one with no area either keeps `${prefix} N`, N its place among the
 * collection's polygons. A made-up name never repeats another block's name: it takes the next free
 * number instead.
 */
function blockNames(features: ReadonlyArray<Record<string, unknown>>, prefix: string): string[] {
  const own = features.map(ownName)
  const used = new Set(own.filter((name): name is string => name !== null))
  const counts = new Map<string, number>()
  return features.map((properties, index) => {
    const named = own[index]
    if (named) return named
    const group = featureGroup(properties)
    let number = group === null ? index : (counts.get(group) ?? 0)
    let name: string
    do {
      number += 1
      name = `${group ?? prefix} ${number}`
    } while (used.has(name))
    if (group !== null) counts.set(group, number)
    used.add(name)
    return name
  })
}

/**
 * An attribute by name, ignoring case: an ArcGIS export writes `Block_ID` where
 * a BCTS one writes `BLOCK_ID`, and both mean the same column.
 */
function attribute(properties: Record<string, unknown>, key: string): string | null {
  const direct = properties[key]
  const value =
    direct !== undefined
      ? direct
      : properties[Object.keys(properties).find((name) => name.toLowerCase() === key.toLowerCase()) ?? '']
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function firstAttribute(properties: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = attribute(properties, key)
    if (value) return value
  }
  return null
}

/** Block, licence, permit and opening, from the column names BCTS and RESULTS exports use. */
export function planningIds(properties: Record<string, unknown> | null | undefined): BlockPlanningIds | undefined {
  if (!properties) return undefined
  const ids: BlockPlanningIds = {
    blockId: firstAttribute(properties, ['CUT_BLOCK_ID', 'CUTBLOCK_ID', 'BLOCK_ID', 'BLOCK']),
    licenceId: firstAttribute(properties, ['LICENCE_ID', 'LICENSE_ID', 'FOREST_FILE_ID', 'LICN_LICEN']),
    permitId: firstAttribute(properties, ['PERMIT_ID', 'CUTTING_PERMIT_ID', 'CP_ID', 'CUT_PERMIT']),
    openingId: firstAttribute(properties, ['OPENING_ID', 'OPENING']),
  }
  return Object.values(ids).some(Boolean) ? ids : undefined
}

function isPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  )
}

/** Accepts a Feature, FeatureCollection, geometry, or an array of any of those. */
export function toFeatures(input: unknown): GeoJSON.Feature[] {
  if (Array.isArray(input)) return input.flatMap(toFeatures)
  if (!input || typeof input !== 'object') return []

  const node = input as { type?: string; features?: unknown; geometry?: unknown; geometries?: unknown }
  if (node.type === 'FeatureCollection' && Array.isArray(node.features)) {
    return node.features.flatMap(toFeatures)
  }
  if (node.type === 'Feature') return [input as GeoJSON.Feature]
  if (node.type === 'GeometryCollection' && Array.isArray(node.geometries)) {
    return node.geometries.flatMap((geometry) => toFeatures({ type: 'Feature', geometry, properties: {} }))
  }
  if (typeof node.type === 'string') {
    return [{ type: 'Feature', geometry: input as GeoJSON.Geometry, properties: {} }]
  }
  return []
}

/** Splits features into polygons and lines, dropping anything else. */
export function collectImportedGeometry(input: unknown, namePrefix = 'Polygon'): ImportedGeometry {
  const features = toFeatures(input)
  const polygons: ImportedPolygon[] = []
  const polygonProperties: Array<Record<string, unknown>> = []
  const lines: ImportedLine[] = []
  let skippedCount = 0

  features.forEach((feature, index) => {
    const geometry = feature.geometry
    const properties = (feature.properties ?? {}) as Record<string, unknown>

    if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') {
      const planning = planningIds(properties)
      polygonProperties.push(properties)
      polygons.push({
        // Named once the whole collection is read: an unnamed block is numbered within its area.
        name: '',
        geometry,
        areaMeters: polygonAreaMeters(geometry),
        ...(planning ? { planning } : {}),
      })
      return
    }

    if (geometry?.type === 'LineString' || geometry?.type === 'MultiLineString') {
      const parts = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
      let added = false
      for (const part of parts) {
        const coordinates = part.filter(isPosition).map(([lng, lat]) => [lng, lat] as [number, number])
        if (coordinates.length < 2) continue
        lines.push({ name: featureName(properties, lines.length, 'Road'), coordinates })
        added = true
      }
      if (!added) skippedCount += 1
      return
    }

    skippedCount += index >= 0 ? 1 : 0
  })

  const names = blockNames(polygonProperties, namePrefix)
  polygons.forEach((polygon, index) => {
    polygon.name = names[index]
  })

  return { polygons, lines, skippedCount }
}

/**
 * Reads a dropped file. A `.zip` goes through shpjs, which also reprojects via
 * the shapefile's `.prj` — BC planning data usually arrives in BC Albers, and
 * without the projection file its coordinates land in the ocean off Africa.
 */
export async function readShapeFile(file: File): Promise<ImportedGeometry> {
  const lowerName = file.name.toLowerCase()

  if (SHAPEFILE_PART.test(lowerName))
    throw new Error(
      `${file.name} is one part of a shapefile. Add its .shp, .dbf and .prj together, or zip them and import the .zip.`,
    )

  if (lowerName.endsWith('.zip')) {
    // Loaded on demand so the shapefile parser stays out of the page bundle.
    const shp = (await import('shpjs')).default
    const parsed = await shp(await file.arrayBuffer())
    return collectImportedGeometry(parsed)
  }

  if (lowerName.endsWith('.json') || lowerName.endsWith('.geojson')) {
    return collectImportedGeometry(JSON.parse(await file.text()))
  }

  throw new Error('Drop a zipped shapefile (.zip) or a GeoJSON file (.geojson)')
}

/** The parts of a shapefile the reader takes: geometry, attributes, projection and code page. */
const SHAPEFILE_PART = /\.(shp|dbf|prj|cpg)$/i
/**
 * What ArcGIS writes beside a shapefile and the reader needs nothing from: the index, the spatial
 * indexes, the metadata and the lock files a layer open in ArcGIS leaves (`.shp.<host>.<pid>.sr.lock`).
 */
const SHAPEFILE_EXTRA = /\.(shx|sbn|sbx|qix|fix|atx|ain|aih|xml|lock)$/i

/** What a file picker for shapes offers: GeoJSON, a zipped shapefile, or a loose one's parts. */
export const SHAPE_FILE_ACCEPT = '.zip,.geojson,.json,.shp,.dbf,.prj,.cpg,.shx'

export type ImportedFiles = ImportedGeometry & {
  /** What the blocks name as their source: the file, the shapefile's .shp, or a count of files. */
  sourceName: string
}

/** A shapefile's name without the part's extension: `Plan.shp` and `Plan.DBF` are one layer. */
function layerKey(name: string): string {
  return name.replace(SHAPEFILE_PART, '').toLowerCase()
}

/**
 * Reads files picked or dropped together. A loose shapefile arrives as its parts: the .shp, .dbf,
 * .prj and .cpg of one layer are joined by name and read as the zip of them would be, and what
 * ArcGIS keeps beside them (index, spatial index, metadata, lock files) is passed over. A .shp
 * without its .prj is refused: its coordinates are in a projection nothing names, and read as
 * longitude and latitude they land nowhere near BC. Zips and GeoJSON in the set are read one by one.
 */
export async function readShapeFiles(files: readonly File[]): Promise<ImportedFiles> {
  const layers = new Map<string, { shp?: File; dbf?: File; prj?: File; cpg?: File }>()
  const others: File[] = []
  for (const file of files) {
    const part = SHAPEFILE_PART.exec(file.name)?.[1]?.toLowerCase() as 'shp' | 'dbf' | 'prj' | 'cpg' | undefined
    if (part) {
      const key = layerKey(file.name)
      layers.set(key, { ...layers.get(key), [part]: file })
    } else if (!SHAPEFILE_EXTRA.test(file.name)) others.push(file)
  }

  const read: ImportedGeometry[] = []
  const names: string[] = []
  for (const parts of layers.values()) {
    const named = parts.shp ?? parts.dbf ?? parts.prj ?? parts.cpg
    if (!parts.shp)
      throw new Error(
        `${named?.name ?? 'A shapefile part'} came without its .shp. Add the layer's .shp, .dbf and .prj together.`,
      )
    if (!parts.prj)
      throw new Error(
        `${parts.shp.name} came without its .prj, so its coordinate system is unknown. Add the layer's .prj with it.`,
      )
    const shp = (await import('shpjs')).default
    const parsed = await shp({
      shp: await parts.shp.arrayBuffer(),
      dbf: parts.dbf ? await parts.dbf.arrayBuffer() : undefined,
      prj: await parts.prj.text(),
      cpg: parts.cpg ? await parts.cpg.text() : undefined,
    })
    read.push(collectImportedGeometry(parsed))
    names.push(parts.shp.name)
  }
  for (const file of others) {
    read.push(await readShapeFile(file))
    names.push(file.name)
  }

  if (read.length === 0)
    throw new Error(
      'None of these files hold shapes. Add a zipped shapefile, a .shp with its .dbf and .prj, or GeoJSON.',
    )
  return {
    polygons: read.flatMap((geometry) => geometry.polygons),
    lines: read.flatMap((geometry) => geometry.lines),
    skippedCount: read.reduce((sum, geometry) => sum + geometry.skippedCount, 0),
    sourceName: names.length === 1 ? names[0] : `${names.length} files`,
  }
}
