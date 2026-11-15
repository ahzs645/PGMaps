/**
 * A symbol library as a QGIS style XML (`<qgis_style version="2">`), the file Style Manager imports
 * (Settings → Style Manager → Import/Export). Each symbol carries its category and tags as QGIS
 * tags, plus a `pgmaps-id:` tag naming its catalogue id so it reads back to the same entry; class
 * swatches add `pgmaps-kind:class`, since QGIS keeps them as plain fills. The reader also takes
 * style XML QGIS itself exported. No DOM or network access.
 */
import type { LibrarySymbol, SymbolLibrary, WriteResult } from '../model'
import { safeFileStem } from '../model'
import { attr, child, childElements, el, writeXml, XML_DECLARATION, type XmlElement } from '../xml'
import { Diagnostics } from './qgisXml'
import { readQgisSymbol } from './symbolRead'
import { qgisSymbolXml } from './symbolXml'

const ID_TAG = 'pgmaps-id:'
const CLASS_TAG = 'pgmaps-kind:class'

/** Tags QGIS stores as one comma-separated attribute, so commas inside a tag become spaces. */
const cleanTag = (tag: string) => tag.replace(/,/g, ' ').trim()

/** The library as QGIS style XML. */
export function qgisStyleLibraryXml(lib: SymbolLibrary): WriteResult {
  const used = new Set<string>()
  const symbols = lib.symbols.map((entry) => {
    let name = entry.name.trim() || entry.id
    if (used.has(name)) name = `${name} (${entry.id})`
    used.add(name)
    const tags = [entry.category, ...entry.tags.filter((tag) => tag !== entry.category)].map(cleanTag).filter(Boolean)
    tags.push(`${ID_TAG}${cleanTag(entry.id)}`)
    if (entry.symbol.kind === 'class') tags.push(CLASS_TAG)
    const node = qgisSymbolXml(entry.symbol, name)
    return { ...node, attrs: { ...node.attrs, tags: tags.join(','), favorite: 0 } }
  })
  const root = el(
    'qgis_style',
    { version: 2 },
    el('symbols', undefined, ...symbols),
    el('colorramps'),
    el('textformats'),
    el('labelsettings'),
    el('legendpatchshapes'),
    el('symbols3d'),
  )
  return {
    files: [
      {
        path: `${safeFileStem(lib.name)}.xml`,
        content: `${XML_DECLARATION}\n<!DOCTYPE qgis_style>\n${writeXml(root)}\n`,
        mime: 'application/xml',
      },
    ],
    diagnostics: [],
  }
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'symbol'

/** The symbols of a `<qgis_style>` root. */
export function readQgisStyleLibrary(root: XmlElement, diagnostics: Diagnostics): LibrarySymbol[] {
  const out: LibrarySymbol[] = []
  const ids = new Set<string>()
  for (const element of childElements(child(root, 'symbols') ?? root, 'symbol')) {
    const name = attr(element, 'name') ?? 'Symbol'
    const allTags = (attr(element, 'tags') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
    const idTag = allTags.find((tag) => tag.startsWith(ID_TAG))
    const isClass = allTags.includes(CLASS_TAG)
    const plain = allTags.filter((tag) => !tag.startsWith(ID_TAG) && tag !== CLASS_TAG)
    const ownId = idTag?.slice(ID_TAG.length)
    const label = ownId && name.endsWith(` (${ownId})`) ? name.slice(0, -ownId.length - 3) : name
    const read = readQgisSymbol(element, label, diagnostics, name)
    if (!read) continue
    let symbol = read
    if (isClass && read.kind === 'area' && read.fill && !read.hatches && !read.markerFill && !read.outline.length)
      symbol = { kind: 'class', label: read.label, color: read.fill, opacity: read.fillOpacity ?? 1 }
    let id = ownId ?? slug(name)
    for (let n = 2; ids.has(id); n++) id = `${ownId ?? slug(name)}-${n}`
    ids.add(id)
    out.push({ id, name: symbol.label, category: plain[0] ?? 'QGIS', tags: plain.slice(1), symbol })
  }
  for (const kind of ['colorramps', 'textformats', 'labelsettings', 'legendpatchshapes', 'symbols3d']) {
    const part = child(root, kind)
    if (part && childElements(part).length)
      diagnostics.info(undefined, `The style's ${kind} are not read; only symbols are.`)
  }
  return out
}
