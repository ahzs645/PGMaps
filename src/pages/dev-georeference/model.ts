/** Portable control points always address the exact source pixel frame, never its thumbnail. */
export const GEOREFERENCE_SCHEMA = 'pgmaps-georeference-v1' as const
export const PIXEL_CONVENTION = 'pixel-centres-x-right-y-down' as const
export const FIT_CRS = 'EPSG:3857' as const
export const MAX_CONTROL_PAIRS = 100
export const MAX_MERCATOR_LATITUDE = 85.0511287798066

export type Point = [number, number]
export type Pixel = Point
export type Coordinate = Point
export type TransformType = 'similarity' | 'affine' | 'thin-plate-spline'
export type PointRole = 'control' | 'check'

export interface GeoreferenceSource {
  id: string
  /** Null for an original local file that must be selected again when reopening. */
  url: string | null
  /** SHA-256 of the exact file containing this pixel frame; null means unverified. */
  sha256: string | null
  width: number
  height: number
  frame: {
    kind: 'original-image' | 'geotiff-pixel-grid' | 'derived-image'
    description: string
    /** Original raster CRS, when known. This does not change the control coordinates. */
    crs?: string
  }
  /** For geotiff-pixel-grid, dimensions and points address this TIFF's native pixels. */
  geotiff?: { url: string; sha256: string | null }
}

export interface ControlPair {
  id: string
  pixel: Pixel
  coordinate: Coordinate
  enabled: boolean
  role: PointRole
}

export interface GeoreferenceProject {
  schema: typeof GEOREFERENCE_SCHEMA
  pixelConvention: typeof PIXEL_CONVENTION
  fitCrs: typeof FIT_CRS
  source: GeoreferenceSource
  transform: TransformType
  points: ControlPair[]
  title?: string
  notes?: string
}

export class GeoreferenceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeoreferenceValidationError'
  }
}

function fail(message: string): never {
  throw new GeoreferenceValidationError(message)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, maximum = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    return fail(`${label} must be nonempty text of at most ${maximum} characters.`)
  }
  return value
}

function optionalText(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > maximum) {
    return fail(`${label} must be text of at most ${maximum} characters.`)
  }
  return value
}

function url(value: unknown, label: string): string {
  const result = text(value, label, 8192)
  try {
    const parsed = new URL(result)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return fail(`${label} must be an HTTP or HTTPS URL. Use null for a local file.`)
    }
    if (parsed.username || parsed.password) return fail(`${label} cannot contain credentials.`)
  } catch (error) {
    if (error instanceof GeoreferenceValidationError) throw error
    return fail(`${label} must be an absolute HTTP or HTTPS URL.`)
  }
  return result
}

function hash(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^[\da-f]{64}$/i.test(value)) {
    return fail(`${label} must be a SHA-256 hexadecimal string or null.`)
  }
  return value.toLowerCase()
}

function dimension(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1_000_000) {
    return fail(`${label} must be an integer from 1 to 1000000.`)
  }
  return value
}

function pair(value: unknown, label: string): Point {
  if (!Array.isArray(value) || value.length !== 2 || value.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
    return fail(`${label} must contain exactly two finite numbers.`)
  }
  return [value[0] as number, value[1] as number]
}

export function validateCoordinate(value: unknown, label = 'Coordinate'): Coordinate {
  const coordinate = pair(value, label)
  if (Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > MAX_MERCATOR_LATITUDE) {
    return fail(`${label} must use longitude ±180° and latitude within the Web Mercator limit.`)
  }
  return coordinate
}

/** Validates and returns a detached canonical object; it never trusts imported cached fit results. */
export function parseProject(input: unknown): GeoreferenceProject {
  let value = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown
    } catch {
      return fail('The project is not valid JSON.')
    }
  }
  const project = object(value, 'Project')
  if (project.schema !== GEOREFERENCE_SCHEMA) return fail('Unsupported georeferencing project schema.')
  if (project.pixelConvention !== PIXEL_CONVENTION) {
    return fail('The project must declare zero-based pixel centres, x right and y down.')
  }
  if (project.fitCrs !== FIT_CRS) return fail('This project version fits in EPSG:3857.')
  const transform = project.transform
  if (transform !== 'similarity' && transform !== 'affine' && transform !== 'thin-plate-spline') {
    return fail('Unknown transformation type.')
  }
  const rawSource = object(project.source, 'Source')
  const rawFrame = object(rawSource.frame, 'Source frame')
  const kind = rawFrame.kind
  if (kind !== 'original-image' && kind !== 'geotiff-pixel-grid' && kind !== 'derived-image') {
    return fail('Source frame kind must identify an original image, native GeoTIFF grid, or derived image.')
  }
  const crs = optionalText(rawFrame.crs, 'Source frame CRS', 1000)
  const source: GeoreferenceSource = {
    id: text(rawSource.id, 'Source id', 256),
    url: rawSource.url === null ? null : url(rawSource.url, 'Source URL'),
    sha256: hash(rawSource.sha256, 'Source SHA-256'),
    width: dimension(rawSource.width, 'Source width'),
    height: dimension(rawSource.height, 'Source height'),
    frame: {
      kind,
      description: text(rawFrame.description, 'Source frame description'),
      ...(crs !== undefined ? { crs } : {}),
    },
  }
  if (rawSource.geotiff !== undefined) {
    const tiff = object(rawSource.geotiff, 'Source GeoTIFF')
    source.geotiff = {
      url: url(tiff.url, 'GeoTIFF URL'),
      sha256: hash(tiff.sha256, 'GeoTIFF SHA-256'),
    }
  }
  if (!Array.isArray(project.points) || project.points.length > MAX_CONTROL_PAIRS) {
    return fail(`A project must contain at most ${MAX_CONTROL_PAIRS} control/check pairs.`)
  }
  const ids = new Set<string>()
  const points = project.points.map((raw, index): ControlPair => {
    const item = object(raw, `Point ${index + 1}`)
    const id = text(item.id, `Point ${index + 1} id`, 256)
    if (ids.has(id)) return fail('Point ids must be unique.')
    ids.add(id)
    const pixel = pair(item.pixel, `Point ${id} pixel`)
    if (pixel[0] < -0.5 || pixel[1] < -0.5 || pixel[0] > source.width - 0.5 || pixel[1] > source.height - 0.5) {
      return fail(`Point ${id} lies outside the declared source pixel frame.`)
    }
    if (typeof item.enabled !== 'boolean') return fail(`Point ${id} must declare enabled.`)
    if (item.role !== 'control' && item.role !== 'check') {
      return fail(`Point ${id} must be a control or a held-out check.`)
    }
    return {
      id,
      pixel,
      coordinate: validateCoordinate(item.coordinate, `Point ${id} coordinate`),
      enabled: item.enabled,
      role: item.role,
    }
  })
  const title = optionalText(project.title, 'Project title', 1000)
  const notes = optionalText(project.notes, 'Project notes', 20_000)
  return {
    schema: GEOREFERENCE_SCHEMA,
    pixelConvention: PIXEL_CONVENTION,
    fitCrs: FIT_CRS,
    source,
    transform,
    points,
    ...(title !== undefined ? { title } : {}),
    ...(notes !== undefined ? { notes } : {}),
  }
}

/** Stable field order and explicit conventions make the result suitable for the offline replay CLI. */
export function serializeProject(project: GeoreferenceProject): string {
  return `${JSON.stringify(parseProject(project), null, 2)}\n`
}

export const parseGeoreferenceProject = parseProject
export const serializeGeoreferenceProject = serializeProject
