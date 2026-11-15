/**
 * Reads any style file the exchange understands, choosing the reader by extension and, for `.xml`
 * and `.json`, by what the file holds. A `.zip` is opened and every style file inside is read, so a
 * whole exported bundle can be read back. Nothing is guessed: a file no reader recognises is an
 * error naming it. No DOM or network access; sql.js is passed in for `.stylx`.
 */
import { unzipSync } from 'fflate'
import type { SqlJsStatic } from 'sql.js'
import { readArcgisFile } from './arcgis/read'
import type { ReadResult } from './model'
import { readQgisFile } from './qgis/read'
import { readGeolibreFile } from './web/geolibre'
import { readMaplibreStyle } from './web/maplibre'
import { readSld } from './web/sld'

/** Largest style file, or zip, read. */
export const MAX_STYLE_FILE_BYTES = 50 * 1024 * 1024
/** Most style files read from one zip. */
export const MAX_ZIP_STYLE_FILES = 200

export { STYLE_FILE_ACCEPT } from './fileTypes'

export interface StyleFileRead {
  fileName: string
  result?: ReadResult
  error?: string
}

const extension = (name: string) => {
  const lower = name.toLowerCase()
  if (lower.endsWith('.geolibre.style.json')) return '.geolibre.style.json'
  if (lower.endsWith('.geolibre.json')) return '.geolibre'
  const dot = lower.lastIndexOf('.')
  return dot < 0 ? '' : lower.slice(dot)
}
const decode = (content: string | Uint8Array) =>
  typeof content === 'string' ? content : new TextDecoder().decode(content)

/** What a `.xml` file is, from its root element. */
function xmlKind(text: string): 'qgis' | 'sld' | null {
  const head = text.slice(0, 4096)
  if (/<(\w+:)?StyledLayerDescriptor[\s>]/.test(head)) return 'sld'
  if (/<(qgis_style|qgis|Layout)[\s>]/.test(head)) return 'qgis'
  return null
}

/** What a `.json` file is, from its top-level keys. */
function jsonKind(text: string): 'maplibre' | 'arcgis' | 'geolibre' | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.type === 'string' && raw.type.startsWith('CIM')) return 'arcgis'
  if (raw.version === 8 && Array.isArray(raw.layers)) return 'maplibre'
  if (typeof raw.version === 'string' && Array.isArray(raw.layers) && raw.styles && typeof raw.styles === 'object')
    return 'geolibre'
  if (Array.isArray(raw.entries) || Array.isArray(value)) return 'geolibre'
  return null
}

/** Reads one file that is not a zip. Throws an Error naming what is wrong. */
export function readOneStyleFile(
  fileName: string,
  content: string | Uint8Array,
  options: { SQL?: SqlJsStatic } = {},
): ReadResult {
  const ext = extension(fileName)
  switch (ext) {
    case '.qml':
    case '.qgs':
    case '.qgz':
    case '.qpt':
      return readQgisFile(fileName, content)
    case '.lyrx':
    case '.mapx':
    case '.pagx':
    case '.stylx':
      if (ext === '.stylx' && !options.SQL) throw Error('Reading an ArcGIS Pro style needs sql.js, which did not load.')
      return readArcgisFile(fileName, content, options)
    case '.sld':
      return readSld(decode(content))
    case '.geolibre':
    case '.geolibre.style.json':
      return readGeolibreFile(fileName, decode(content))
    case '.xml': {
      const text = decode(content)
      const kind = xmlKind(text)
      if (kind === 'sld') return readSld(text)
      if (kind === 'qgis') return readQgisFile(fileName, text)
      throw Error(`${fileName} is XML, but neither an SLD nor a QGIS style.`)
    }
    case '.json': {
      const text = decode(content)
      const kind = jsonKind(text)
      if (kind === 'maplibre') return readMaplibreStyle(text)
      if (kind === 'arcgis') return readArcgisFile(fileName, text, options)
      if (kind === 'geolibre') return readGeolibreFile(fileName, text)
      throw Error(`${fileName} is not a MapLibre style, a GeoLibre file or ArcGIS CIM JSON.`)
    }
    default:
      throw Error(`${fileName} is not a style file this tool reads.`)
  }
}

const READABLE = new Set([
  '.qml',
  '.qgs',
  '.qgz',
  '.qpt',
  '.lyrx',
  '.mapx',
  '.pagx',
  '.stylx',
  '.sld',
  '.geolibre',
  '.geolibre.style.json',
  '.xml',
  '.json',
])

/** Reads a style file or every style file in a zip; each file succeeds or fails on its own. */
export function readStyleFile(
  fileName: string,
  content: Uint8Array,
  options: { SQL?: SqlJsStatic } = {},
): StyleFileRead[] {
  if (content.length > MAX_STYLE_FILE_BYTES)
    return [{ fileName, error: `${fileName} is larger than ${MAX_STYLE_FILE_BYTES / 1048576} MB.` }]
  const attempt = (name: string, bytes: Uint8Array): StyleFileRead => {
    try {
      return { fileName: name, result: readOneStyleFile(name, bytes, options) }
    } catch (error) {
      return { fileName: name, error: error instanceof Error ? error.message : `${name} could not be read.` }
    }
  }
  if (extension(fileName) !== '.zip') return [attempt(fileName, content)]
  let entries: Record<string, Uint8Array>
  try {
    let total = 0
    entries = unzipSync(content, {
      filter: (file) => {
        if (!READABLE.has(extension(file.name)) || file.name.startsWith('__MACOSX/')) return false
        total += file.originalSize
        if (total > MAX_STYLE_FILE_BYTES)
          throw Error(`${fileName} unpacks to more than ${MAX_STYLE_FILE_BYTES / 1048576} MB.`)
        return true
      },
    })
  } catch (error) {
    return [{ fileName, error: error instanceof Error ? error.message : `${fileName} is not a readable zip.` }]
  }
  const names = Object.keys(entries)
    // GeoJSON data inside an exported bundle is not a style.
    // Nor is a sprite sheet's index.
    .filter((name) => !/(^|\/)geojson\//.test(name) && !/(^|\/)sprite(@\d+x)?\.json$/.test(name))
    .sort()
  if (!names.length) return [{ fileName, error: `${fileName} holds no style file this tool reads.` }]
  if (names.length > MAX_ZIP_STYLE_FILES)
    return [{ fileName, error: `${fileName} holds more than ${MAX_ZIP_STYLE_FILES} style files.` }]
  return names.map((name) => attempt(`${fileName}/${name}`, entries[name]))
}
