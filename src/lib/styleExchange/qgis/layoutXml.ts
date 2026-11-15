/**
 * Printed sheets as QGIS print layouts (`<Layout>`, the root of a `.qpt` template and an entry of a
 * project's `<Layouts>`), and back. The page is the paper in millimetres; the map frame, title,
 * legend panel and the other panels sit where the sheet template puts them (fractions of the page).
 * Items are named so the reader finds them again: `map`, `title`, `subtitle`, `neatline`,
 * `legend`, `scalebar`, `north_arrow`, `panel:<id>` and `panel-title:<id>`. The layout's custom
 * properties keep the template id and the extent asked for, which the reader trusts only while the
 * map item still shows what was written. No DOM or network access.
 */
import {
  PAPER_SIZES,
  SHEET_TEMPLATES,
  fontSize,
  resolveSheet,
  type FractionRect,
  type PanelId,
  type PaperId,
  type Rect,
  type SheetTemplate,
} from '@/lib/mapSheet/layout'
import type { LayoutDocument } from '../model'
import { attr, child, childElements, el, num, type XmlElement, type XmlNodeSpec } from '../xml'
import {
  authidOf,
  groundPerUnit,
  isProjectCrs,
  projectExtent,
  spatialRefSys,
  unprojectExtent,
  BC_BOUNDS,
  type Extent,
  type ProjectCrsId,
} from './projectCrs'
import { Diagnostics, qgisColor } from './qgisXml'
import { qgisSymbolXml } from './symbolXml'

const MM_PER_PT = 25.4 / 72

/** QGIS layout item types (`QgsLayoutItemRegistry`). */
export const LAYOUT_ITEM = {
  page: 65638,
  map: 65639,
  picture: 65640,
  label: 65641,
  legend: 65642,
  shape: 65643,
  scalebar: 65646,
} as const

const PANEL_IDS: readonly PanelId[] = ['blockInfo', 'source', 'legend', 'roadTable', 'footer', 'comments', 'notes']
const NORTH_ARROW_SVG = ':/images/north_arrows/layout_default_north_arrow.svg'

/** Fixed item ids, so the same layout always writes the same file. */
const uuid = (n: number) => `{00000000-0000-4000-8000-${String(n).padStart(12, '0')}}`

interface MmRect {
  x: number
  y: number
  w: number
  h: number
}
const mm = (rect: Rect): MmRect => ({
  x: rect.x * MM_PER_PT,
  y: rect.y * MM_PER_PT,
  w: rect.w * MM_PER_PT,
  h: rect.h * MM_PER_PT,
})
const pair = (a: number, b: number) => `${num(a, 4)},${num(b, 4)},mm`

function item(
  type: number,
  id: string,
  rect: MmRect,
  z: number,
  attrs: Record<string, string | number> & { uuid: string },
  ...children: (XmlNodeSpec | null)[]
): XmlNodeSpec {
  return el(
    'LayoutItem',
    {
      type,
      id,
      templateUuid: attrs.uuid,
      position: pair(rect.x, rect.y),
      positionOnPage: pair(rect.x, rect.y),
      size: pair(rect.w, rect.h),
      zValue: z,
      visibility: 1,
      frame: 'false',
      background: 'false',
      referencePoint: 0,
      itemRotation: 0,
      opacity: 1,
      blendMode: 0,
      excludeFromExports: 0,
      outlineWidthM: '0.3,mm',
      frameJoinStyle: 'miter',
      positionLock: 'false',
      groupUuid: '',
      ...attrs,
    },
    el('FrameColor', { red: 0, green: 0, blue: 0, alpha: 255 }),
    el('BackgroundColor', { red: 255, green: 255, blue: 255, alpha: 255 }),
    el('LayoutObject', undefined, el('customproperties')),
    ...children,
  )
}

function textStyle(size: number, bold: boolean): XmlNodeSpec {
  return el(
    'text-style',
    {
      fontFamily: 'Arial',
      fontSize: num(size, 2),
      fontSizeUnit: 'Point',
      fontWeight: bold ? 700 : 400,
      fontItalic: 0,
      textColor: qgisColor('#000000'),
      textOpacity: 1,
      multilineHeight: 1,
      allowHtml: 0,
    },
    el('text-buffer', { bufferDraw: 0, bufferSize: 1, bufferSizeUnits: 'MM', bufferColor: '255,255,255,255' }),
  )
}

function label(
  id: string,
  text: string,
  rect: MmRect,
  z: number,
  own: string,
  size: number,
  bold: boolean,
  align: 'left' | 'right' | 'center',
) {
  return item(
    LAYOUT_ITEM.label,
    id,
    rect,
    z,
    {
      uuid: own,
      labelText: text,
      htmlState: 0,
      halign: align === 'left' ? 1 : align === 'right' ? 2 : 4,
      valign: 32,
      marginX: 1,
      marginY: 0,
    },
    textStyle(size, bold),
  )
}

/** Legend type sizes like the sheet's: a small title, layer headings and entries. */
function legendStyles(k: number): XmlNodeSpec {
  const style = (name: string, size: number, bold: boolean, margins: Record<string, number>) =>
    el('style', { name, alignment: 1, indent: 0, ...margins }, textStyle(Math.max(4.5, size * k), bold))
  return el(
    'styles',
    undefined,
    style('title', 9, true, { marginBottom: 2 }),
    style('group', 7, true, { marginTop: 2 }),
    style('subgroup', 7, true, { marginTop: 2 }),
    style('symbol', 6.5, false, { marginTop: 1.5 }),
    style('symbolLabel', 6.5, false, { marginTop: 1.5, marginLeft: 2 }),
  )
}

const frameSymbol = (width: number) =>
  qgisSymbolXml({ kind: 'area', label: 'Frame', outline: [{ color: '#000000', width }] }, '')

/** A "nice" scale-bar segment, metres: 1, 2 or 5 times a power of ten near `metres`. */
function niceSegment(metres: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(metres, 1e-6)))
  const scaled = metres / power
  return (scaled >= 5 ? 5 : scaled >= 2 ? 2 : 1) * power
}

export interface LayoutMapView {
  crs: ProjectCrsId
  /** The map item's extent in `crs`. */
  box: Extent
  scale: number
}

/**
 * Where the map frame looks: centred on the layout's (or document's) extent at the layout's scale,
 * or the extent fitted to the frame when no scale is given.
 */
export function layoutMapView(layout: LayoutDocument, crs: ProjectCrsId, fallback?: Extent): LayoutMapView {
  const sheet = resolveSheet(layout.template, layout.paper)
  const frame = mm(sheet.frame)
  const extent = layout.extent ?? fallback ?? BC_BOUNDS
  const centreLat = (extent[1] + extent[3]) / 2
  const k = groundPerUnit(crs, centreLat)
  const box = projectExtent(crs, extent)
  const cx = (box[0] + box[2]) / 2,
    cy = (box[1] + box[3]) / 2
  let scale = layout.scale
  if (!scale || !(scale > 0)) {
    const width = box[2] - box[0],
      height = box[3] - box[1]
    // Map units per frame millimetre to fit both directions, then the ground scale.
    const unitsPerMm = Math.max(width / frame.w, height / frame.h)
    scale = Math.max(1, Math.round(unitsPerMm * k * 1000))
  }
  const halfW = ((frame.w / 1000) * scale) / k / 2,
    halfH = ((frame.h / 1000) * scale) / k / 2
  return { crs, box: [cx - halfW, cy - halfH, cx + halfW, cy + halfH], scale }
}

/** A `<Layout>` element for the layout, its map drawn in `crs`. */
export function layoutXml(layout: LayoutDocument, crs: ProjectCrsId, fallbackExtent?: Extent): XmlNodeSpec {
  let next = 0
  const own = () => uuid(++next)
  const sheet = resolveSheet(layout.template, layout.paper)
  const page = { x: 0, y: 0, w: sheet.width * MM_PER_PT, h: sheet.height * MM_PER_PT }
  const view = layoutMapView(layout, crs, fallbackExtent)
  const mapUuid = uuid(1000)
  const frame = mm(sheet.frame)
  const items: XmlNodeSpec[] = []
  let z = 1
  items.push(
    item(
      LAYOUT_ITEM.shape,
      'neatline',
      mm(sheet.neatline),
      z++,
      { uuid: own(), shapeType: 1, cornerRadiusMeasure: '0,mm' },
      frameSymbol(1),
    ),
  )
  items.push(
    item(
      LAYOUT_ITEM.map,
      'map',
      frame,
      z++,
      {
        uuid: mapUuid,
        frame: 'true',
        background: 'true',
        keepLayerSet: 'false',
        drawCanvasItems: 'true',
        mapRotation: 0,
        followPreset: 'false',
        followPresetName: '',
        labelMargin: '0,mm',
        mapFlags: 0,
        isTemporal: 0,
      },
      el('Extent', {
        xmin: num(view.box[0], 3),
        ymin: num(view.box[1], 3),
        xmax: num(view.box[2], 3),
        ymax: num(view.box[3], 3),
      }),
      el('crs', undefined, spatialRefSys(crs)),
      el('LayerSet'),
      el('AtlasMap', { atlasDriven: 0, scalingMode: 2, margin: 0.1 }),
    ),
  )
  const titleRect = mm(sheet.title)
  items.push(label('title', layout.title, titleRect, z++, own(), fontSize(sheet, 12), true, 'left'))
  if (layout.subtitle)
    items.push(label('subtitle', layout.subtitle, titleRect, z++, own(), fontSize(sheet, 9), false, 'right'))
  const headerH = Math.min(fontSize(sheet, 8) * 1.8 * MM_PER_PT, 8)
  for (const panel of sheet.panels) {
    const rect = mm(panel.rect)
    if (panel.id === 'legend') {
      items.push(
        item(
          LAYOUT_ITEM.legend,
          'legend',
          rect,
          z++,
          {
            uuid: own(),
            frame: 'true',
            background: 'true',
            title: panel.title ?? 'Legend',
            map_uuid: mapUuid,
            resizeToContents: 0,
            syncMode: 'AllProjectLayers',
            columnCount: 1,
            symbolWidth: 7,
            symbolHeight: 4,
            boxSpace: 2,
            splitLayer: 0,
            equalColumnWidth: 0,
          },
          legendStyles(sheet.k),
        ),
      )
      continue
    }
    items.push(
      item(
        LAYOUT_ITEM.shape,
        `panel:${panel.id}`,
        rect,
        z++,
        { uuid: own(), shapeType: 1, cornerRadiusMeasure: '0,mm' },
        frameSymbol(0.75),
      ),
    )
    if (panel.title && !panel.bare)
      items.push(
        label(
          `panel-title:${panel.id}`,
          panel.title,
          { ...rect, h: Math.min(headerH, rect.h) },
          z++,
          own(),
          fontSize(sheet, 8),
          true,
          'left',
        ),
      )
  }
  const segmentMetres = niceSegment((frame.w * 0.12 * view.scale) / 1000)
  items.push(
    item(LAYOUT_ITEM.scalebar, 'scalebar', { x: frame.x + 4, y: frame.y + frame.h - 14, w: 60, h: 10 }, z++, {
      uuid: own(),
      mapUuid,
      style: 'Single Box',
      unitType: 'meters',
      unitLabel: 'm',
      numSegments: 2,
      numSegmentsLeft: 0,
      numSubdivisions: 1,
      numUnitsPerSegment: segmentMetres,
      numMapUnitsPerScaleBarUnit: 1,
      segmentSizeMode: 0,
      height: 2,
      labelBarSpace: 2,
      boxContentSpace: 1,
      alignment: 0,
      background: 'true',
    }),
  )
  items.push(
    item(LAYOUT_ITEM.picture, 'north_arrow', { x: frame.x + frame.w - 16, y: frame.y + 4, w: 12, h: 12 }, z++, {
      uuid: own(),
      file: NORTH_ARROW_SVG,
      mapUuid,
      northMode: 0,
      northOffset: 0,
      resizeMode: 0,
      anchorPoint: 0,
      svgFillColor: '255,255,255,255',
      svgBorderColor: '0,0,0,255',
      svgBorderWidth: 0.2,
      pictureRotation: 0,
    }),
  )
  const custom = el(
    'customproperties',
    undefined,
    el(
      'Option',
      { type: 'Map' },
      el('Option', { name: 'pgmaps:template', type: 'QString', value: layout.template.id }),
      el('Option', { name: 'pgmaps:mapExtent', type: 'QString', value: view.box.map((v) => num(v, 3)).join(',') }),
      el('Option', { name: 'pgmaps:scale', type: 'QString', value: num(view.scale, 3) }),
      layout.extent &&
        el('Option', { name: 'pgmaps:extent', type: 'QString', value: layout.extent.map((v) => num(v, 8)).join(',') }),
    ),
  )
  return el(
    'Layout',
    { name: layout.name, units: 'mm', printResolution: 300, worldFileMap: '' },
    el(
      'PageCollection',
      undefined,
      item(LAYOUT_ITEM.page, '', page, 0, { uuid: own(), background: 'true' }),
      el('GuideCollection', { visible: 1 }),
    ),
    ...items,
    custom,
  )
}

// ---- Reading ---------------------------------------------------------------------------------

const UNIT_TO_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  pt: MM_PER_PT,
  pica: MM_PER_PT * 12,
  px: 25.4 / 96,
}

/** A "x,y,unit" pair in millimetres. */
function readPair(text: string | null, diagnostics: Diagnostics, subject: string): [number, number] | null {
  if (!text) return null
  const [a, b, unit = 'mm'] = text.split(',')
  const factor = UNIT_TO_MM[unit.trim()]
  if (factor === undefined) {
    diagnostics.warning(subject, `Layout unit "${unit}" was read as millimetres.`)
    return [Number(a), Number(b)]
  }
  if (unit.trim() === 'px') diagnostics.warning(subject, 'Layout sizes in pixels were read at 96 dpi.')
  const x = Number(a) * factor,
    y = Number(b) * factor
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}

const round4 = (value: number) => Math.round(value * 10000) / 10000

function customProperties(layoutElement: XmlElement): Map<string, string> {
  const out = new Map<string, string>()
  const map = child(child(layoutElement, 'customproperties') ?? layoutElement, 'Option')
  if (map)
    for (const option of childElements(map, 'Option')) out.set(attr(option, 'name') ?? '', attr(option, 'value') ?? '')
  return out
}

const sameRect = (a: FractionRect, b: FractionRect) => a.every((value, i) => Math.abs(value - b[i]) < 0.0006)

/** The known template whose every rectangle matches, so a written layout reads back as the same template. */
function knownTemplate(template: SheetTemplate): SheetTemplate | null {
  return (
    SHEET_TEMPLATES.find(
      (known) =>
        known.orientation === template.orientation &&
        sameRect(known.neatline, template.neatline) &&
        sameRect(known.title, template.title) &&
        sameRect(known.frame, template.frame) &&
        known.panels.length === template.panels.length &&
        known.panels.every((panel) => {
          const other = template.panels.find((p) => p.id === panel.id)
          return (
            other &&
            sameRect(panel.rect, other.rect) &&
            (panel.title ?? '') === (other.title ?? '') &&
            Boolean(panel.bare) === Boolean(other.bare)
          )
        }),
    ) ?? null
  )
}

function paperFor(widthMm: number, heightMm: number, diagnostics: Diagnostics, subject: string): PaperId {
  const longPt = Math.max(widthMm, heightMm) / MM_PER_PT,
    shortPt = Math.min(widthMm, heightMm) / MM_PER_PT
  const ranked = (Object.keys(PAPER_SIZES) as PaperId[])
    .map((id) => ({ id, off: Math.abs(PAPER_SIZES[id].long - longPt) + Math.abs(PAPER_SIZES[id].short - shortPt) }))
    .sort((a, b) => a.off - b.off)
  if (ranked[0].off > 6)
    diagnostics.warning(
      subject,
      `The ${num(widthMm, 1)} × ${num(heightMm, 1)} mm page is not a PGMaps paper size; it was read as ${PAPER_SIZES[ranked[0].id].label}, with its parts kept at the same fractions of the page.`,
    )
  return ranked[0].id
}

const labelSize = (element: XmlElement) =>
  Number(attr(child(element, 'text-style'), 'fontSize') ?? attr(child(element, 'LabelFont'), 'pointsize') ?? 10)

/** A `<Layout>` as a layout document, or null when it has no map item. `projectCrs` is the map's CRS when the item names none. */
export function readQgisLayout(
  element: XmlElement,
  projectCrs: string | null,
  diagnostics: Diagnostics,
): LayoutDocument | null {
  const name = attr(element, 'name') ?? 'Layout'
  const pages = childElements(child(element, 'PageCollection') ?? element, 'LayoutItem').filter(
    (page) => Number(attr(page, 'type')) === LAYOUT_ITEM.page,
  )
  if (!pages.length) {
    diagnostics.error(name, 'The layout has no page.')
    return null
  }
  if (pages.length > 1) diagnostics.warning(name, 'Only the first page of the layout was read.')
  const pageSize = readPair(attr(pages[0], 'size'), diagnostics, name)
  if (!pageSize || !(pageSize[0] > 0) || !(pageSize[1] > 0)) {
    diagnostics.error(name, 'The page size could not be read.')
    return null
  }
  const [pageW, pageH] = pageSize
  const fraction = (itemElement: XmlElement): FractionRect | null => {
    const subject = `${name}: ${attr(itemElement, 'id') || 'item'}`
    const position = readPair(
      attr(itemElement, 'positionOnPage') ?? attr(itemElement, 'position'),
      diagnostics,
      subject,
    )
    const size = readPair(attr(itemElement, 'size'), diagnostics, subject)
    if (!position || !size) return null
    if (Number(attr(itemElement, 'itemRotation') ?? 0)) diagnostics.warning(subject, 'Item rotation is not kept.')
    return [
      round4(position[0] / pageW),
      round4(position[1] / pageH),
      round4((position[0] + size[0]) / pageW),
      round4((position[1] + size[1]) / pageH),
    ]
  }
  const items = childElements(element, 'LayoutItem')
  const typed = (type: number) => items.filter((i) => Number(attr(i, 'type')) === type)
  const byId = (id: string) => items.find((i) => attr(i, 'id') === id)
  const used = new Set<XmlElement>()
  const maps = typed(LAYOUT_ITEM.map)
  const map = byId('map') ?? maps[0]
  if (!map) {
    diagnostics.error(name, 'The layout has no map item.')
    return null
  }
  if (maps.length > 1) diagnostics.warning(name, 'Only one map item was read; the others are left out.')
  used.add(map)
  const frame = fraction(map)!
  const labels = typed(LAYOUT_ITEM.label)
  let titleItem = byId('title')
  if (!titleItem && labels.length) {
    titleItem = [...labels].sort((a, b) => labelSize(b) - labelSize(a))[0]
    diagnostics.warning(name, `The largest label, "${attr(titleItem, 'labelText')}", was taken as the title.`)
  }
  if (titleItem) used.add(titleItem)
  const subtitleItem = byId('subtitle')
  if (subtitleItem) used.add(subtitleItem)
  const neatlineItem = byId('neatline')
  if (neatlineItem) used.add(neatlineItem)
  else diagnostics.info(name, 'No item is named "neatline"; the sheet border was set to the page margins.')
  const panels: SheetTemplate['panels'][number][] = []
  const legend = byId('legend') ?? typed(LAYOUT_ITEM.legend)[0]
  if (legend) {
    used.add(legend)
    panels.push({ id: 'legend', rect: fraction(legend)!, title: attr(legend, 'title') || 'Legend' })
  }
  for (const shape of typed(LAYOUT_ITEM.shape)) {
    const id = /^panel:(\w+)$/.exec(attr(shape, 'id') ?? '')?.[1]
    if (!id || id === 'legend') continue
    if (!(PANEL_IDS as string[]).includes(id)) {
      diagnostics.warning(name, `The panel "${id}" is not one PGMaps sheets have; it was left out.`)
      used.add(shape)
      continue
    }
    used.add(shape)
    const titleLabel = byId(`panel-title:${id}`)
    if (titleLabel) used.add(titleLabel)
    const title = titleLabel ? (attr(titleLabel, 'labelText') ?? '') : ''
    panels.push({ id: id as PanelId, rect: fraction(shape)!, ...(title ? { title } : { bare: true }) })
  }
  for (const id of ['scalebar', 'north_arrow']) {
    const found = byId(id)
    if (found) used.add(found)
  }
  const others = items.filter((i) => !used.has(i))
  if (others.length)
    diagnostics.warning(
      name,
      `Layout items PGMaps sheets do not have were left out: ${others.map((i) => attr(i, 'id') || `type ${attr(i, 'type')}`).join(', ')}.`,
    )
  const orientation = pageW >= pageH ? 'landscape' : 'portrait'
  const properties = customProperties(element)
  const read: SheetTemplate = {
    id: properties.get('pgmaps:template') || `qgis-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    orientation,
    neatline: neatlineItem ? fraction(neatlineItem)! : [0.02, 0.02, 0.98, 0.98],
    title: titleItem ? fraction(titleItem)! : [frame[0], Math.max(0, frame[1] - 0.03), frame[2], frame[1]],
    frame,
    panels: PANEL_IDS.flatMap((id) => panels.filter((panel) => panel.id === id)),
  }
  const known = knownTemplate(read)
  const template =
    known && (!properties.get('pgmaps:template') || properties.get('pgmaps:template') === known.id) ? known : read
  const paper = paperFor(pageW, pageH, diagnostics, name)
  const layout: LayoutDocument = {
    name,
    paper,
    template,
    title: titleItem ? (attr(titleItem, 'labelText') ?? '') : name,
    ...(subtitleItem ? { subtitle: attr(subtitleItem, 'labelText') ?? '' } : {}),
  }
  // The map's extent and scale: what was written when the map still shows it, else measured.
  const extentElement = child(map, 'Extent')
  const box = ['xmin', 'ymin', 'xmax', 'ymax'].map((key) => Number(attr(extentElement, key))) as Extent
  const crs = authidOf(child(map, 'crs')) ?? projectCrs
  const written = (properties.get('pgmaps:mapExtent') ?? '').split(',').map(Number)
  const unchanged = written.length === 4 && written.every((value, i) => Math.abs(value - box[i]) < 0.01)
  if (unchanged) {
    const scale = Number(properties.get('pgmaps:scale'))
    const extent = (properties.get('pgmaps:extent') ?? '').split(',').map(Number)
    if (Number.isFinite(scale) && scale > 0) layout.scale = scale
    if (extent.length === 4 && extent.every(Number.isFinite)) layout.extent = extent as Extent
    return layout
  }
  if (!box.every(Number.isFinite)) {
    diagnostics.warning(name, 'The map item has no extent to read.')
    return layout
  }
  const frameWidthMm = (frame[2] - frame[0]) * pageW
  if (isProjectCrs(crs)) {
    const extent = unprojectExtent(crs, box)
    const lat = (extent[1] + extent[3]) / 2
    layout.extent = extent.map((v) => Math.round(v * 1e6) / 1e6) as Extent
    layout.scale = Math.round(((box[2] - box[0]) * groundPerUnit(crs, lat) * 1000) / frameWidthMm)
  } else if (crs === 'EPSG:4326') {
    layout.extent = box
    diagnostics.warning(name, 'The map is in longitude and latitude; its scale was not read.')
  } else
    diagnostics.warning(name, `The map's CRS ${crs ?? '(unnamed)'} is not read; its extent and scale were left out.`)
  return layout
}
