/**
 * Turns a file someone drops on a map into a GeoJSON FeatureCollection with its
 * attributes intact: GeoJSON, zipped shapefiles, KML, and CSV with coordinate
 * columns. Everything runs in the page; nothing is uploaded anywhere.
 *
 * The text parsers are free of DOM access so they can be unit-tested; only
 * `readGeoFile` touches `File`.
 */

export const GEO_FILE_ACCEPT = '.geojson,.json,.zip,.kml,.csv'
export const GEO_FILE_FORMATS = 'GeoJSON, zipped shapefile, KML or CSV with latitude/longitude columns'

export interface ImportedCollection {
  /** File name without its extension, as a layer name. */
  name: string
  collection: GeoJSON.FeatureCollection
  /** Features or rows dropped because they had no usable geometry. */
  skipped: number
}

export class GeoFileImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeoFileImportError'
  }
}

function baseName(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Uploaded layer'
  )
}

const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'])

/** Flattens a Feature, FeatureCollection, bare geometry or an array of them into drawable features. */
export function toFeatureCollection(input: unknown): { collection: GeoJSON.FeatureCollection; skipped: number } {
  const features: GeoJSON.Feature[] = []
  let skipped = 0

  const visit = (node: unknown, properties: GeoJSON.GeoJsonProperties = {}) => {
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child))
      return
    }
    if (!node || typeof node !== 'object') return
    const item = node as {
      type?: string
      features?: unknown
      geometry?: unknown
      geometries?: unknown
      properties?: GeoJSON.GeoJsonProperties
    }
    if (item.type === 'FeatureCollection' && Array.isArray(item.features)) {
      item.features.forEach((feature) => visit(feature))
    } else if (item.type === 'Feature') {
      const geometry = item.geometry as GeoJSON.Geometry | null
      if (!geometry) {
        skipped += 1
      } else if (geometry.type === 'GeometryCollection') {
        geometry.geometries.forEach((child) => visit(child, item.properties ?? {}))
      } else if (GEOMETRY_TYPES.has(geometry.type)) {
        features.push({ type: 'Feature', geometry, properties: { ...(item.properties ?? {}) } })
      } else {
        skipped += 1
      }
    } else if (item.type === 'GeometryCollection' && Array.isArray(item.geometries)) {
      item.geometries.forEach((child) => visit(child, properties))
    } else if (typeof item.type === 'string' && GEOMETRY_TYPES.has(item.type)) {
      features.push({ type: 'Feature', geometry: node as GeoJSON.Geometry, properties: { ...(properties ?? {}) } })
    }
  }

  visit(input)
  return { collection: { type: 'FeatureCollection', features }, skipped }
}

export function parseGeoJsonText(text: string): { collection: GeoJSON.FeatureCollection; skipped: number } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new GeoFileImportError('This file is not valid JSON.')
  }
  const result = toFeatureCollection(parsed)
  if (result.collection.features.length === 0)
    throw new GeoFileImportError('No features with geometry were found in this GeoJSON.')
  return result
}

/** Minimal RFC 4180 reader: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

const LATITUDE_KEYS = ['latitude', 'lat', 'y', 'lat_dd', 'latitude_dd']
const LONGITUDE_KEYS = ['longitude', 'lon', 'lng', 'long', 'x', 'lon_dd', 'longitude_dd']

function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map((header) => header.trim().toLowerCase())
  for (const candidate of candidates) {
    const index = normalized.indexOf(candidate)
    if (index >= 0) return index
  }
  return -1
}

/** Numbers stay numbers so the table can sort and style them; everything else is text. */
function csvValue(raw: string): string | number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(trimmed) && !/^-?0\d/.test(trimmed)) return Number(trimmed)
  return trimmed
}

/** A point per row from latitude/longitude columns; rows without valid coordinates are skipped. */
export function parseCsvText(text: string): { collection: GeoJSON.FeatureCollection; skipped: number } {
  const rows = parseCsvRows(text)
  if (rows.length < 2) throw new GeoFileImportError('This CSV has no data rows.')
  const [headers, ...body] = rows
  const latIndex = findColumn(headers, LATITUDE_KEYS)
  const lonIndex = findColumn(headers, LONGITUDE_KEYS)
  if (latIndex < 0 || lonIndex < 0) {
    throw new GeoFileImportError(
      'Add latitude and longitude columns (named lat/latitude and lon/lng/longitude) to place CSV rows on the map.',
    )
  }
  const features: GeoJSON.Feature[] = []
  let skipped = 0
  for (const cells of body) {
    const lat = (cells[latIndex] ?? '').trim() === '' ? Number.NaN : Number(cells[latIndex])
    const lon = (cells[lonIndex] ?? '').trim() === '' ? Number.NaN : Number(cells[lonIndex])
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      skipped += 1
      continue
    }
    const properties: Record<string, unknown> = {}
    headers.forEach((header, index) => {
      if (index === latIndex || index === lonIndex) return
      properties[header.trim() || `Column ${index + 1}`] = csvValue(cells[index] ?? '')
    })
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties })
  }
  if (features.length === 0) throw new GeoFileImportError('No CSV rows had valid latitude and longitude values.')
  return { collection: { type: 'FeatureCollection', features }, skipped }
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

function tagContent(source: string, tag: string): string | null {
  const match = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i').exec(source)
  return match ? match[1] : null
}

function allTags(source: string, tag: string): string[] {
  return [...source.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'gi'))].map(
    (match) => match[1],
  )
}

function kmlCoordinates(text: string): Array<[number, number]> {
  return text
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(',').map(Number))
    .filter((parts) => parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]))
    .map(([lon, lat]) => [lon, lat])
}

function kmlGeometries(placemark: string): GeoJSON.Geometry[] {
  const geometries: GeoJSON.Geometry[] = []
  for (const point of allTags(placemark, 'Point')) {
    const [coordinate] = kmlCoordinates(tagContent(point, 'coordinates') ?? '')
    if (coordinate) geometries.push({ type: 'Point', coordinates: coordinate })
  }
  for (const line of allTags(placemark, 'LineString')) {
    const coordinates = kmlCoordinates(tagContent(line, 'coordinates') ?? '')
    if (coordinates.length >= 2) geometries.push({ type: 'LineString', coordinates })
  }
  for (const polygon of allTags(placemark, 'Polygon')) {
    const outer = kmlCoordinates(tagContent(tagContent(polygon, 'outerBoundaryIs') ?? '', 'coordinates') ?? '')
    if (outer.length < 4) continue
    const holes = allTags(polygon, 'innerBoundaryIs')
      .map((inner) => kmlCoordinates(tagContent(inner, 'coordinates') ?? ''))
      .filter((ring) => ring.length >= 4)
    geometries.push({ type: 'Polygon', coordinates: [outer, ...holes] })
  }
  return geometries
}

/** Placemarks with their name, description and ExtendedData as properties. */
export function parseKmlText(text: string): { collection: GeoJSON.FeatureCollection; skipped: number } {
  const features: GeoJSON.Feature[] = []
  let skipped = 0
  for (const placemark of allTags(text, 'Placemark')) {
    const properties: Record<string, unknown> = {}
    const name = tagContent(placemark, 'name')
    if (name != null) properties.name = decodeXml(name)
    const description = tagContent(placemark, 'description')
    if (description != null)
      properties.description = decodeXml(description)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    for (const match of placemark.matchAll(/<Data\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/Data>/gi)) {
      properties[match[1]] = decodeXml(tagContent(match[2], 'value') ?? '')
    }
    for (const match of placemark.matchAll(/<SimpleData\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/SimpleData>/gi)) {
      properties[match[1]] = decodeXml(match[2])
    }
    const geometries = kmlGeometries(placemark)
    if (geometries.length === 0) {
      skipped += 1
      continue
    }
    const geometry: GeoJSON.Geometry =
      geometries.length === 1 ? geometries[0] : { type: 'GeometryCollection', geometries }
    features.push({ type: 'Feature', geometry, properties })
  }
  // Multi-geometry placemarks become one feature per part.
  const result = toFeatureCollection({ type: 'FeatureCollection', features })
  if (result.collection.features.length === 0)
    throw new GeoFileImportError('No placemarks with geometry were found in this KML.')
  return { collection: result.collection, skipped: skipped + result.skipped }
}

/**
 * Reads a dropped or chosen file. A `.zip` goes through shpjs, which reprojects
 * from the shapefile's `.prj`; without one, coordinates are taken as degrees.
 */
export async function readGeoFile(file: File): Promise<ImportedCollection> {
  const lowerName = file.name.toLowerCase()
  const name = baseName(file.name)
  if (lowerName.endsWith('.zip')) {
    const shp = (await import('shpjs')).default
    let parsed: unknown
    try {
      parsed = await shp(await file.arrayBuffer())
    } catch {
      throw new GeoFileImportError('This zip does not contain a readable shapefile (.shp, .dbf and ideally .prj).')
    }
    const result = toFeatureCollection(parsed)
    if (result.collection.features.length === 0)
      throw new GeoFileImportError('The shapefile has no features with geometry.')
    return { name, ...result }
  }
  if (lowerName.endsWith('.geojson') || lowerName.endsWith('.json'))
    return { name, ...parseGeoJsonText(await file.text()) }
  if (lowerName.endsWith('.kml')) return { name, ...parseKmlText(await file.text()) }
  if (lowerName.endsWith('.csv')) return { name, ...parseCsvText(await file.text()) }
  throw new GeoFileImportError(`${file.name} is not a supported format. Use ${GEO_FILE_FORMATS}.`)
}
