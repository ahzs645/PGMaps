/**
 * Reads QGIS files into the style model: a layer style (`.qml`), a project (`.qgs`, or `.qgz`
 * holding one), a print-layout template (`.qpt`) and a Style Manager export (`<qgis_style>` XML).
 * What PGMaps wrote reads back as written; files QGIS wrote read as far as the model goes, and every
 * approximation or loss is a diagnostic. Throws only when the file is not one of these at all.
 * No DOM or network access.
 */
import { unzipSync } from 'fflate'
import type { ExchangeFormat, LayoutDocument, ReadResult, StyledLayer } from '../model'
import { attr, child, childElements, localName, parseXml, textOf, type XmlElement } from '../xml'
import { readQgisLayer } from './layerRead'
import { readQgisLayout } from './layoutXml'
import { authidOf } from './projectCrs'
import { Diagnostics } from './qgisXml'
import { readQgisStyleLibrary } from './qgisStyleLibrary'

/** Largest `.qgs` a `.qgz` may unpack to. */
export const MAX_QGZ_PROJECT_BYTES = 32 * 1024 * 1024

const stem = (fileName: string) => (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.[^.]+$/, '')

/** A file-safe layer id from a data source or name. */
function layerId(source: string, fallback: string): string {
  const file = source.split('|')[0].split(/[\\/]/).pop() ?? ''
  const candidate = file.replace(/\.[^.]+$/, '') || fallback
  const safe = candidate
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^[^A-Za-z]+/, '')
    .slice(0, 63)
  return safe || 'layer'
}

const result = (format: ExchangeFormat, diagnostics: Diagnostics, parts: Partial<ReadResult>): ReadResult => ({
  format,
  layers: parts.layers ?? [],
  symbols: parts.symbols ?? [],
  layouts: parts.layouts ?? [],
  diagnostics: diagnostics.list,
})

function readProject(root: XmlElement, diagnostics: Diagnostics): ReadResult {
  const projectCrs = authidOf(child(root, 'projectCrs'))
  const checked = new Map<string, boolean>()
  const treeOrder: string[] = []
  const walk = (group: XmlElement, visible: boolean) => {
    for (const node of childElements(group)) {
      const name = localName(node)
      const on = visible && attr(node, 'checked') !== 'Qt::Unchecked'
      if (name === 'layer-tree-layer') {
        const id = attr(node, 'id') ?? ''
        treeOrder.push(id)
        checked.set(id, on)
      } else if (name === 'layer-tree-group') walk(node, on)
    }
  }
  const tree = child(root, 'layer-tree-group')
  if (tree) walk(tree, true)
  const byQgisId = new Map<string, StyledLayer>()
  const ids = new Set<string>()
  for (const mapLayer of childElements(child(root, 'projectlayers') ?? root, 'maplayer')) {
    const qgisId = textOf(child(mapLayer, 'id'))
    const name = textOf(child(mapLayer, 'layername')) || qgisId
    if (attr(mapLayer, 'type') !== 'vector') {
      diagnostics.info(name, `The ${attr(mapLayer, 'type') ?? 'unknown'} layer has no vector style and was left out.`)
      continue
    }
    let id = layerId(textOf(child(mapLayer, 'datasource')), name)
    for (let n = 2; ids.has(id); n++) id = `${layerId(textOf(child(mapLayer, 'datasource')), name).slice(0, 58)}_${n}`
    const layer = readQgisLayer(mapLayer, { id, name, hidden: checked.get(qgisId) === false }, diagnostics)
    if (!layer) continue
    ids.add(id)
    byQgisId.set(qgisId, layer)
  }
  // The tree lists the top layer first; the model draws bottom first.
  const ordered = [...treeOrder]
    .reverse()
    .map((id) => byQgisId.get(id))
    .filter((layer): layer is StyledLayer => Boolean(layer))
  const rest = [...byQgisId.values()].filter((layer) => !ordered.includes(layer))
  const layouts = childElements(child(root, 'Layouts') ?? root, 'Layout')
    .map((layout) => readQgisLayout(layout, projectCrs, diagnostics))
    .filter((layout): layout is LayoutDocument => Boolean(layout))
  return result('qgs', diagnostics, { layers: [...rest, ...ordered], layouts })
}

function readQgz(fileName: string, bytes: Uint8Array): ReadResult {
  let total = 0
  const entries = unzipSync(bytes, {
    filter: (file) => {
      if (!/\.qgs$/i.test(file.name)) return false
      total += file.originalSize
      if (total > MAX_QGZ_PROJECT_BYTES)
        throw Error(`${fileName} unpacks to a project larger than ${MAX_QGZ_PROJECT_BYTES / 1048576} MB.`)
      return true
    },
  })
  const names = Object.keys(entries)
  if (!names.length) throw Error(`${fileName} holds no .qgs project.`)
  const diagnostics = new Diagnostics('qgs')
  if (names.length > 1)
    diagnostics.warning(undefined, `${fileName} holds ${names.length} projects; only ${names[0]} was read.`)
  const root = parseXml(new TextDecoder().decode(entries[names[0]]))
  if (localName(root) !== 'qgis') throw Error(`${names[0]} in ${fileName} is not a QGIS project.`)
  return readProject(root, diagnostics)
}

/** Reads a QGIS style, project, layout template or style library. */
export function readQgisFile(fileName: string, content: string | Uint8Array): ReadResult {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.qgz')) {
    if (typeof content === 'string') throw Error(`${fileName} is a zip, but was read as text.`)
    return readQgz(fileName, content)
  }
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content)
  const root = parseXml(text)
  const rootName = localName(root)
  if (rootName === 'qgis_style') {
    const diagnostics = new Diagnostics('qgis-style')
    return result('qgis-style', diagnostics, { symbols: readQgisStyleLibrary(root, diagnostics) })
  }
  if (rootName === 'Layout') {
    const diagnostics = new Diagnostics('qpt')
    const layout = readQgisLayout(root, null, diagnostics)
    return result('qpt', diagnostics, { layouts: layout ? [layout] : [] })
  }
  if (rootName === 'qgis') {
    if (child(root, 'projectlayers') || lower.endsWith('.qgs')) return readProject(root, new Diagnostics('qgs'))
    const diagnostics = new Diagnostics('qml')
    const name = stem(fileName)
    const layer = readQgisLayer(root, { id: layerId(name, 'layer'), name }, diagnostics)
    return result('qml', diagnostics, { layers: layer ? [layer] : [] })
  }
  throw Error(`${fileName} is XML, but not a QGIS style, project, layout or style library.`)
}
