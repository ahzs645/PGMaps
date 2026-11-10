/**
 * Lays out a block map sheet as drawing operations: the map frame with its base raster, contours
 * and vector layers, the title bar, block information, legend, road table, scale bar, north arrow
 * and footer. Everything is measured here, so the PDF and the preview print the same sheet.
 * No DOM or network access.
 */
import type { ContourResult } from '@/lib/mapSheet/contours'
import {
  boundsOf,
  boxesMeet,
  labelsAlongLine,
  labelSpacer,
  rectRing,
  type DrawOp,
  type Point,
  type RasterImage,
  type StrokeStyle,
} from '@/lib/mapSheet/drawOps'
import { fontSize, resolveSheet, type PaperId, type Rect, type ResolvedSheet } from '@/lib/mapSheet/layout'
import {
  fitScale,
  formatDms,
  formatScale,
  frameProjection,
  graticuleTicks,
  MAX_SHEET_SCALE,
  scaleBar,
  type FrameProjection,
} from '@/lib/mapSheet/scale'
import { areaSymbolOps, lineSymbolOps, pointSymbolOps, scaleStroke, swatchOps } from '@/lib/mapSheet/symbols'
import { fitText, textWidth, wrapText } from '@/lib/mapSheet/textMetrics'
import { blockBounds, type BlockFacts, type BlockGeometry } from './blockFacts'
import {
  infoFieldLabel,
  INFO_FIELD_ORIGIN,
  SHEET_PRESETS,
  type InfoFieldId,
  type SheetFields,
  type SheetKind,
  type SheetPreset,
} from './sheets'
import {
  BLOCK_LABEL,
  BLOCK_OF_INTEREST,
  CONSTRAINT_AREA,
  CONTOUR_STYLES,
  EXISTING_ROAD,
  FOREST_SERVICE_ROAD,
  LABEL_HALO,
  NCD_STREAM,
  OTHER_BLOCK,
  proposedRoad,
  reviewArea,
  reviewLine,
  reviewPin,
  RIPARIAN_SCREEN,
  ROAD_DEACTIVATION,
  ROAD_LABEL,
  scaleBand,
  SHEET_CHROME,
  STREAM,
  type AreaSymbol,
  type ClassSymbol,
  type LineSymbol,
  type PointSymbol,
  type SheetSymbol,
} from './styles'

type LngLat = [number, number]

export interface SheetRoad {
  name: string
  color: string
  line: LngLat[]
  lengthM: number
}
export interface SheetNote {
  kind: 'pin' | 'line' | 'area'
  points: LngLat[]
  color: string
  text: string
  /** Arrowhead barbs for a line that ends in one. */
  head?: LngLat[]
}
/** Any other feature, drawn with a catalogue symbol of its own and listed under that symbol's label. */
export interface SheetExtra {
  geometry: GeoJSON.Point | GeoJSON.LineString | GeoJSON.MultiLineString | GeoJSON.Polygon | GeoJSON.MultiPolygon
  symbol: SheetSymbol
}
export interface SheetLayers {
  block?: { geometry: BlockGeometry; name: string }
  otherBlocks?: { geometry: BlockGeometry; name?: string }[]
  constraints?: { geometry: GeoJSON.Polygon }[]
  /** The road tool's preliminary riparian screen: reserve and management zones. */
  riparian?: { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; band: 'reserve' | 'management' }[]
  streams?: { line: LngLat[]; ncd?: boolean }[]
  /** `deactivated` adds the deactivation crosses over the road's own symbol. */
  existingRoads?: { line: LngLat[]; forestService: boolean; name?: string; deactivated?: boolean }[]
  roads?: SheetRoad[]
  notes?: SheetNote[]
  extras?: SheetExtra[]
}

export interface SheetIssue {
  date: string
  preparedBy: string
  organisation: string
  revision: string
}

/** The frame a sheet prints: its resolved layout and the projection of its map. */
export interface SheetFrame {
  preset: SheetPreset
  sheet: ResolvedSheet
  projection: FrameProjection
}

/**
 * Resolves the layout and frames the map: `scale` 'fit' picks the smallest standard scale that
 * shows `focus.bounds`; the frame centres on the box's middle.
 */
export function sheetFrame(
  kind: SheetKind,
  paper: PaperId,
  scale: number | 'fit',
  focus: { bounds: [number, number, number, number] },
): SheetFrame {
  const preset = SHEET_PRESETS[kind]
  const sheet = resolveSheet(preset.template, paper)
  const [west, south, east, north] = focus.bounds
  if (![west, south, east, north].every(Number.isFinite)) throw Error('The sheet has nothing to centre on.')
  const resolved = scale === 'fit' ? fitScale(focus.bounds, sheet.frame) : scale
  if (!(resolved > 0) || resolved > MAX_SHEET_SCALE)
    throw Error(`Choose a scale of 1:${MAX_SHEET_SCALE.toLocaleString('en-US')} or finer.`)
  return {
    preset,
    sheet,
    projection: frameProjection(sheet.frame, [(west + east) / 2, (south + north) / 2], resolved),
  }
}

/** Box the sheet should frame: the block, else every road, else every note. */
export function sheetFocus(layers: SheetLayers): [number, number, number, number] | null {
  if (layers.block) return blockBounds(layers.block.geometry)
  const points = [
    ...(layers.roads ?? []).flatMap((road) => road.line),
    ...(layers.notes ?? []).flatMap((n) => n.points),
  ]
  if (!points.length) return null
  const lngs = points.map((p) => p[0]),
    lats = points.map((p) => p[1])
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
}

export interface ComposeInput {
  frame: SheetFrame
  layers: SheetLayers
  /** The frame's base raster, already aligned to `frame.projection`. */
  base?: { image: RasterImage; attribution?: string; legend?: ClassSymbol[] }
  /** Contours sampled on a grid spanning the frame, `gridWidth` × `gridHeight` sample centres. */
  contours?: { result: ContourResult; gridWidth: number; gridHeight: number }
  facts: BlockFacts | null
  /** Where elevations came from, for the block information note, e.g. "Demo terrain, 1 m". */
  terrainName?: string
  fields: SheetFields
  issue: SheetIssue
  logo?: RasterImage
  comments?: string
  /** One line under the block information: the terrain source and what was derived from it. */
  sourceLine?: string
  /** A notice printed in red over the map, e.g. results that leave out an invalid input. */
  stamp?: string
  caveat?: string
}

export interface LegendItem {
  key: string
  symbol: SheetSymbol
}

export interface ComposedSheet {
  width: number
  height: number
  ops: DrawOp[]
  /** What the legend lists, in order: only layers that drew something in the frame. */
  legend: LegendItem[]
  classLegend: ClassSymbol[]
  scale: number
}

const NOT_RECORDED = 'not recorded'

function formatNumber(value: number, digits: number) {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** "0+000 - 1+234" for a road from its start. */
export function chainageRange(lengthM: number) {
  const station = (m: number) => {
    const rounded = Math.round(m)
    return `${Math.floor(rounded / 1000)}+${String(rounded % 1000).padStart(3, '0')}`
  }
  return `${station(0)} - ${station(lengthM)}`
}

/** The value printed for a block information field, or null when it is missing. */
export function infoValue(
  id: InfoFieldId,
  facts: BlockFacts | null,
  fields: SheetFields,
): { text: string | null; origin: string } {
  const origin = INFO_FIELD_ORIGIN[id]
  switch (id) {
    case 'mapsheet':
      return { text: facts?.mapsheet ?? null, origin }
    case 'grossArea':
      return { text: facts ? formatNumber(facts.areaHa, 1) : null, origin }
    case 'minElev':
      return { text: facts?.elevation ? formatNumber(facts.elevation.min, 0) : null, origin }
    case 'maxElev':
      return { text: facts?.elevation ? formatNumber(facts.elevation.max, 0) : null, origin }
    default:
      return { text: fields[id]?.trim() || null, origin }
  }
}

/** The legend's fixed order. */
const LEGEND_ORDER = [
  'block',
  'otherBlocks',
  'constraints',
  'riparian',
  'roads',
  'forestService',
  'existingRoads',
  'deactivated',
  'streams',
  'ncd',
  'extras',
  'contourIndex',
  'contourIntermediate',
  'reviewLine',
  'reviewArea',
  'reviewPin',
]

export function composeSheet(input: ComposeInput): ComposedSheet {
  const { preset, sheet, projection } = input.frame
  const { k } = sheet
  const F = (pt: number) => fontSize(sheet, pt)
  const frame = sheet.frame
  const band = scaleBand(projection.scale)
  const ops: DrawOp[] = []
  const drawn = new Map<string, SheetSymbol[]>()
  const mark = (key: string, symbol: SheetSymbol) => {
    const list = drawn.get(key) ?? []
    if (!list.some((s) => s.label === symbol.label && JSON.stringify(s) === JSON.stringify(symbol))) list.push(symbol)
    drawn.set(key, list)
  }
  const project = (points: LngLat[]): Point[] => points.map(([lng, lat]) => projection.project(lng, lat))
  const visible = (parts: Point[][]) => {
    const box = boundsOf(parts)
    return !!box && boxesMeet(box, frame)
  }
  const strokeLine = (parts: Point[][], symbol: LineSymbol) => ops.push(...lineSymbolOps(parts, symbol, k))
  const fillArea = (parts: Point[][], symbol: AreaSymbol) => ops.push(...areaSymbolOps(parts, symbol, k))
  const placePoint = (at: Point, symbol: PointSymbol) => ops.push(...pointSymbolOps(symbol, at[0], at[1], k))
  const halo = { color: LABEL_HALO.color, width: LABEL_HALO.width * k }
  const polygonParts = (geometry: BlockGeometry | GeoJSON.Polygon): Point[][] =>
    (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).flatMap((polygon) =>
      polygon.map((ring) => project(ring as LngLat[])),
    )
  const extras = input.layers.extras ?? []
  const extraParts = (extra: SheetExtra): Point[][] =>
    extra.geometry.type === 'Point'
      ? [project([extra.geometry.coordinates as LngLat])]
      : extra.geometry.type === 'LineString'
        ? [project(extra.geometry.coordinates as LngLat[])]
        : extra.geometry.type === 'MultiLineString'
          ? extra.geometry.coordinates.map((part) => project(part as LngLat[]))
          : polygonParts(extra.geometry)
  /** Extras of one symbol kind, in input order; each drawn one marks its symbol for the legend. */
  const drawExtras = (kind: SheetSymbol['kind']) => {
    for (const extra of extras) {
      if (extra.symbol.kind !== kind) continue
      const parts = extraParts(extra)
      if (!visible(parts)) continue
      if (extra.symbol.kind === 'area') fillArea(parts, extra.symbol)
      else if (extra.symbol.kind === 'line') strokeLine(parts, extra.symbol)
      else if (extra.symbol.kind === 'point') placePoint(parts[0][0], extra.symbol)
      else continue
      mark('extras', extra.symbol)
    }
  }

  // ---- Map frame ----
  ops.push({ op: 'clip', parts: [rectRing(frame.x, frame.y, frame.w, frame.h)] })
  ops.push({ op: 'rect', x: frame.x, y: frame.y, w: frame.w, h: frame.h, fill: '#ffffff' })
  if (input.base) ops.push({ op: 'image', x: frame.x, y: frame.y, w: frame.w, h: frame.h, image: input.base.image })

  // Contours under every vector, labelled along the line.
  if (input.contours && preset.contours) {
    const style = CONTOUR_STYLES[preset.contours]
    const { result, gridWidth, gridHeight } = input.contours
    const sx = frame.w / gridWidth,
      sy = frame.h / gridHeight
    const toPaper = (line: [number, number][]): Point[] =>
      line.map(([c, r]) => [frame.x + (c + 0.5) * sx, frame.y + (r + 0.5) * sy])
    const labels: DrawOp[] = []
    const spacing = 220 * k
    const free = labelSpacer(34 * k)
    for (const level of result.levels) {
      const parts = level.lines.map(toPaper)
      const stroke = level.index ? style.index : style.intermediate
      ops.push({ op: 'path', parts, closed: false, stroke: scaleStroke(stroke, k) })
      const text = String(Math.round(level.level))
      const size = F(style.labelSize)
      const width = textWidth(text, size)
      // Neighbouring lines start their labels at different distances, so labels do not stack in columns.
      const stagger = (((Math.round(level.level / result.interval) % 5) + 5) % 5) / 5
      for (const part of parts)
        for (const at of labelsAlongLine(
          part,
          spacing,
          width + 4 * k,
          frame,
          6 * k,
          spacing * (0.15 + stagger * 0.7),
        )) {
          if (!free(at.x, at.y)) continue
          labels.push({
            op: 'text',
            x: at.x,
            y: at.y,
            text,
            size,
            color: level.index ? style.indexLabel : style.intermediateLabel,
            align: 'center',
            baseline: 'middle',
            angle: at.angle,
            ...(style.halo ? { halo: { color: style.halo.color, width: style.halo.width * k } } : {}),
          })
        }
      mark(level.index ? 'contourIndex' : 'contourIntermediate', {
        kind: 'line',
        label: level.index ? `Index contour (${result.interval * 2} m)` : `Intermediate contour (${result.interval} m)`,
        layers: [stroke],
      })
    }
    ops.push(...labels)
  }

  for (const constraint of input.layers.constraints ?? []) {
    const parts = polygonParts(constraint.geometry)
    if (!visible(parts)) continue
    fillArea(parts, CONSTRAINT_AREA)
    mark('constraints', CONSTRAINT_AREA)
  }
  for (const zone of input.layers.riparian ?? []) {
    const parts = polygonParts(zone.geometry)
    if (!visible(parts)) continue
    fillArea(parts, RIPARIAN_SCREEN[zone.band])
    mark('riparian', RIPARIAN_SCREEN[zone.band])
  }
  drawExtras('area')
  for (const block of input.layers.otherBlocks ?? []) {
    const parts = polygonParts(block.geometry)
    if (!visible(parts)) continue
    fillArea(parts, OTHER_BLOCK)
    mark('otherBlocks', OTHER_BLOCK)
  }
  for (const stream of input.layers.streams ?? []) {
    const parts = [project(stream.line)]
    if (!visible(parts)) continue
    const symbol = (stream.ncd ? NCD_STREAM : STREAM)[band]
    strokeLine(parts, symbol)
    mark(stream.ncd ? 'ncd' : 'streams', symbol)
  }
  const roadLabels: DrawOp[] = []
  const labelLine = (part: Point[], name: string) => {
    const size = F(ROAD_LABEL.size)
    const text = fitText(name, size, 160 * k, 'bold')
    const width = textWidth(text, size, 'bold')
    const total = part.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - part[i][0], p[1] - part[i][1]), 0)
    const at = labelsAlongLine(part, Math.max(total, 1), width + 6 * k, frame, 6 * k)[0]
    if (at)
      roadLabels.push({
        op: 'text',
        x: at.x,
        y: at.y,
        text,
        size,
        style: 'bold',
        color: ROAD_LABEL.color,
        align: 'center',
        baseline: 'middle',
        angle: at.angle,
        halo,
      })
  }
  for (const road of input.layers.existingRoads ?? []) {
    const parts = [project(road.line)]
    if (!visible(parts)) continue
    const symbol = (road.forestService ? FOREST_SERVICE_ROAD : EXISTING_ROAD)[band]
    strokeLine(parts, symbol)
    mark(road.forestService ? 'forestService' : 'existingRoads', symbol)
    if (road.deactivated) {
      strokeLine(parts, ROAD_DEACTIVATION)
      mark('deactivated', ROAD_DEACTIVATION)
    }
    if (road.name && road.forestService) labelLine(parts[0], road.name)
  }
  drawExtras('line')
  const roads = input.layers.roads ?? []
  for (const road of roads) {
    const parts = [project(road.line)]
    if (!visible(parts)) continue
    const symbol = proposedRoad(road.color, band, roads.length <= 4 ? `Proposed: ${road.name}` : 'Proposed road')
    strokeLine(parts, symbol)
    mark('roads', roads.length <= 4 ? symbol : proposedRoad(road.color, band, 'Proposed roads (see Road Information)'))
    labelLine(parts[0], road.name)
  }
  ops.push(...roadLabels)

  if (input.layers.block) {
    const symbol = BLOCK_OF_INTEREST[preset.blockStyle]
    const parts = polygonParts(input.layers.block.geometry)
    if (visible(parts)) {
      fillArea(parts, symbol)
      mark('block', symbol)
      const centre = input.facts ? projection.project(...input.facts.centroid) : null
      const lines = [input.fields.cuttingPermit, input.fields.blockId || input.layers.block.name].filter(
        (line): line is string => !!line?.trim(),
      )
      if (centre)
        lines.forEach((line, i) =>
          ops.push({
            op: 'text',
            x: centre[0],
            y: centre[1] + (i - (lines.length - 1) / 2) * F(BLOCK_LABEL.size) * 1.15,
            text: fitText(line, F(BLOCK_LABEL.size), 200 * k, 'bold'),
            size: F(BLOCK_LABEL.size),
            style: 'bold',
            color: BLOCK_LABEL.color,
            align: 'center',
            baseline: 'middle',
            halo,
          }),
        )
    }
  }

  drawExtras('point')

  // Review markup from the plan's notes, on top of everything it comments on.
  for (const note of input.layers.notes ?? []) {
    const parts = [project(note.points)]
    if (!visible(parts)) continue
    let anchor: Point
    if (note.kind === 'pin') {
      anchor = parts[0][0]
      placePoint(anchor, reviewPin(note.color))
      mark('reviewPin', reviewPin('#e11d48'))
    } else if (note.kind === 'area') {
      fillArea(parts, reviewArea(note.color))
      mark('reviewArea', reviewArea('#d97706'))
      const box = boundsOf(parts)!
      anchor = [box.x + box.w / 2, box.y + box.h / 2]
    } else {
      const symbol = reviewLine(note.color)
      strokeLine(parts, symbol)
      if (note.head) strokeLine([project(note.head)], symbol)
      mark('reviewLine', reviewLine('#e11d48'))
      anchor = parts[0].at(-1)!
    }
    if (note.text.trim()) {
      const size = F(6)
      const lines = wrapText(note.text.trim(), size, 130 * k).slice(0, 3)
      lines.forEach((line, i) =>
        ops.push({
          op: 'text',
          x: anchor[0] + 4 * k,
          y: anchor[1] - 4 * k + i * size * 1.2,
          text: line,
          size,
          color: '#000000',
          halo,
        }),
      )
    }
  }

  // Graticule: ticks into the frame from each edge and DMS labels just inside it.
  {
    const [west, south, east, north] = projection.bounds
    const centreLat = (south + north) / 2,
      centreLng = (west + east) / 2
    const size = F(6)
    const tick: StrokeStyle = { color: '#000000', width: 1.5 * k }
    const along: Point[][] = []
    for (const lng of graticuleTicks(west, east, 6).values) {
      const x = projection.project(lng, centreLat)[0]
      if (x < frame.x + 20 * k || x > frame.x + frame.w - 20 * k) continue
      along.push(
        [
          [x, frame.y],
          [x, frame.y + 3 * k],
        ],
        [
          [x, frame.y + frame.h],
          [x, frame.y + frame.h - 3 * k],
        ],
      )
      const text = formatDms(lng, 'lng')
      ops.push({
        op: 'text',
        x,
        y: frame.y + 3 * k + size,
        text,
        size,
        family: 'times',
        style: 'italic',
        color: '#000000',
        align: 'center',
        halo,
      })
      ops.push({
        op: 'text',
        x,
        y: frame.y + frame.h - 4 * k,
        text,
        size,
        family: 'times',
        style: 'italic',
        color: '#000000',
        align: 'center',
        halo,
      })
    }
    for (const lat of graticuleTicks(south, north, 6).values) {
      const y = projection.project(centreLng, lat)[1]
      if (y < frame.y + 30 * k || y > frame.y + frame.h - 30 * k) continue
      along.push(
        [
          [frame.x, y],
          [frame.x + 3 * k, y],
        ],
        [
          [frame.x + frame.w, y],
          [frame.x + frame.w - 3 * k, y],
        ],
      )
      const text = formatDms(lat, 'lat')
      ops.push({
        op: 'text',
        x: frame.x + 3 * k + size,
        y,
        text,
        size,
        family: 'times',
        style: 'italic',
        color: '#000000',
        align: 'center',
        angle: 90,
        halo,
      })
      ops.push({
        op: 'text',
        x: frame.x + frame.w - 3 * k - size * 0.3,
        y,
        text,
        size,
        family: 'times',
        style: 'italic',
        color: '#000000',
        align: 'center',
        angle: 90,
        halo,
      })
    }
    ops.push({ op: 'path', parts: along, closed: false, stroke: tick })
  }

  // North arrow, bottom left inside the frame. The frame is north-up Web Mercator, so it points up.
  {
    const height = Math.min(preset.northArrowPt * k, frame.h * 0.14)
    const width = height * 0.32
    const cx = frame.x + Math.max(24 * k, frame.w * 0.035),
      bottom = frame.y + frame.h - 14 * k
    const top = bottom - height
    const notch = bottom - height * 0.18
    const outline: StrokeStyle = { color: '#ffffff', width: 3 * k, join: 'round' }
    const red = SHEET_CHROME.northArrow
    const needle: Point[] = [
      [cx, top + height * 0.2],
      [cx + width / 2, bottom],
      [cx, notch],
      [cx - width / 2, bottom],
    ]
    ops.push({ op: 'path', parts: [needle], closed: true, stroke: outline })
    ops.push({
      op: 'path',
      parts: [
        [
          [cx, top + height * 0.2],
          [cx, notch],
          [cx - width / 2, bottom],
        ],
      ],
      closed: true,
      fill: red,
    })
    ops.push({
      op: 'path',
      parts: [needle],
      closed: true,
      fill: undefined,
      stroke: { color: red, width: 0.8 * k, join: 'round' },
    })
    ops.push({
      op: 'text',
      x: cx,
      y: top + height * 0.15,
      text: 'N',
      size: Math.max(8, height * 0.2),
      style: 'bold',
      color: red,
      align: 'center',
      halo: { color: '#ffffff', width: 2 * k },
    })
  }

  if (input.base?.attribution)
    ops.push({
      op: 'text',
      x: frame.x + frame.w - 5 * k,
      y: frame.y + frame.h - 5 * k,
      text: input.base.attribution,
      size: F(6.5),
      color: SHEET_CHROME.attribution,
      align: 'right',
      halo,
    })
  if (input.stamp) {
    const size = F(9)
    const lines = wrapText(input.stamp, size, frame.w * 0.5, 'bold').slice(0, 4)
    const w = Math.max(...lines.map((line) => textWidth(line, size, 'bold'))) + 12 * k
    const h = lines.length * size * 1.25 + 8 * k
    const x = frame.x + 40 * k,
      y = frame.y + 18 * k
    ops.push({ op: 'rect', x, y, w, h, fill: '#ffffff', stroke: { color: '#b91c1c', width: 2 * k } })
    lines.forEach((line, i) =>
      ops.push({
        op: 'text',
        x: x + 6 * k,
        y: y + 4 * k + size * (i + 1) * 1.1,
        text: line,
        size,
        style: 'bold',
        color: '#b91c1c',
      }),
    )
  }
  ops.push({ op: 'restore' })
  ops.push({ op: 'rect', x: frame.x, y: frame.y, w: frame.w, h: frame.h, stroke: { color: '#000000', width: 1.5 * k } })

  // ---- Neatline and title bar ----
  const n = sheet.neatline
  ops.push({ op: 'rect', x: n.x, y: n.y, w: n.w, h: n.h, stroke: { color: '#000000', width: 1 * k } })
  titleBar(ops, sheet, preset, input)

  // ---- Panels ----
  const legend = LEGEND_ORDER.flatMap((key) => (drawn.get(key) ?? []).map((symbol) => ({ key, symbol })))
  const classLegend = input.base?.legend ?? []
  for (const panel of sheet.panels) {
    const body = panel.bare ? panel.rect : sectionBox(ops, sheet, panel.rect, panel.title ?? '', preset)
    switch (panel.id) {
      case 'blockInfo':
        blockInfo(ops, sheet, preset, body, input, projection)
        break
      case 'source':
        sourceBar(ops, sheet, body, input)
        break
      case 'legend':
        legendPanel(ops, sheet, preset, body, legend, classLegend)
        break
      case 'roadTable':
        roadTable(ops, sheet, body, roads, input.issue)
        break
      case 'footer':
        footer(ops, sheet, body, input, projection)
        break
      case 'comments':
        commentsPanel(ops, sheet, body, input.comments ?? '')
        break
      case 'notes':
        notesPanel(ops, sheet, body)
        break
    }
  }
  return { width: sheet.width, height: sheet.height, ops, legend, classLegend, scale: projection.scale }
}

/** A white panel with a #ffd37f header bar; returns the space under the bar. */
function sectionBox(ops: DrawOp[], sheet: ResolvedSheet, rect: Rect, title: string, preset: SheetPreset): Rect {
  const k = sheet.k
  const bar = (preset.template.id === 'lidar-side-panel' ? 10.6 : 14.4) * k
  ops.push({ op: 'rect', ...rect, fill: '#ffffff', stroke: { color: SHEET_CHROME.line, width: 1 * k } })
  ops.push({
    op: 'rect',
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: bar,
    fill: SHEET_CHROME.barFill,
    stroke: { color: SHEET_CHROME.line, width: 1 * k },
  })
  ops.push({
    op: 'text',
    x: rect.x + rect.w / 2,
    y: rect.y + bar / 2,
    text: title,
    size: fontSize(sheet, preset.template.id === 'lidar-side-panel' ? 8 : preset.type.section),
    style: 'bold',
    color: SHEET_CHROME.barText,
    align: 'center',
    baseline: 'middle',
  })
  return { x: rect.x, y: rect.y + bar, w: rect.w, h: rect.h - bar }
}

/** Title on the left, then the header fields spread across the rest of the bar, measured so none overlap. */
function titleBar(ops: DrawOp[], sheet: ResolvedSheet, preset: SheetPreset, input: ComposeInput) {
  const k = sheet.k
  const bar = sheet.title
  ops.push({ op: 'rect', ...bar, fill: SHEET_CHROME.barFill, stroke: { color: SHEET_CHROME.line, width: 1 * k } })
  const titleSize = fontSize(sheet, preset.type.title)
  const baseline = bar.y + bar.h / 2
  ops.push({
    op: 'text',
    x: bar.x + 6 * k,
    y: baseline,
    text: preset.title,
    size: titleSize,
    style: 'bold',
    color: SHEET_CHROME.barText,
    baseline: 'middle',
  })
  const centroid = input.facts?.centroid
  const d = preset.latLngDecimals
  const fields = [
    `Lat: ${centroid ? centroid[1].toFixed(d) : NOT_RECORDED}`,
    `Long: ${centroid ? centroid[0].toFixed(d) : NOT_RECORDED}`,
    `F.L.: ${input.fields.forestLicence?.trim() || ''}`,
    `CP: ${input.fields.cuttingPermit?.trim() || ''}`,
    `${preset.blockLabel}: ${input.fields.blockId?.trim() || input.layers.block?.name || ''}`,
  ]
  const start = bar.x + 6 * k + textWidth(preset.title, titleSize, 'bold') + 24 * k
  const end = bar.x + bar.w - 6 * k
  const available = end - start
  const gap = 14 * k
  let size = fontSize(sheet, preset.type.header)
  const widths = (s: number) => fields.map((field) => textWidth(field, s, 'bold'))
  while (size > fontSize(sheet, 7) && widths(size).reduce((a, b) => a + b, 0) + gap * (fields.length - 1) > available)
    size -= 0.5
  // Still too long: cut each field to an equal share.
  const share = (available - gap * (fields.length - 1)) / fields.length
  const fitted = fields.map((field) =>
    widths(size).reduce((a, b) => a + b, 0) + gap * (fields.length - 1) > available
      ? fitText(field, size, share, 'bold')
      : field,
  )
  const measured = fitted.map((field) => textWidth(field, size, 'bold'))
  const spare = Math.max(gap * (fields.length - 1), available - measured.reduce((a, b) => a + b, 0))
  let x = start
  fitted.forEach((field, i) => {
    ops.push({
      op: 'text',
      x,
      y: baseline,
      text: field,
      size,
      style: 'bold',
      color: SHEET_CHROME.barText,
      baseline: 'middle',
    })
    x += measured[i] + spare / (fields.length - 1)
  })
}

/** Label: value rows in two columns; missing values print "not recorded" in grey. */
function blockInfo(
  ops: DrawOp[],
  sheet: ResolvedSheet,
  preset: SheetPreset,
  body: Rect,
  input: ComposeInput,
  projection: FrameProjection,
) {
  const k = sheet.k
  const size = fontSize(sheet, preset.info.size)
  const pitch = size * 1.6
  const bottomPanel = preset.template.id === 'access-bottom-panel' || preset.template.id === 'imagery-portrait'
  const pad = 5 * k
  const inner = body.w - pad * 2
  // The left column takes the room its longest row needs, between 40 % and 60 % of the panel.
  const needed = Math.max(
    ...preset.info.columns[0].map(
      (id) =>
        textWidth(`${infoFieldLabel(id, preset.kind)}: `, size, 'bold') +
        textWidth(
          infoValue(id, input.facts, input.fields).text ?? NOT_RECORDED,
          size,
          preset.info.boldValues ? 'bold' : 'normal',
        ) +
        8 * k,
    ),
  )
  const firstWidth = Math.min(inner * 0.6, Math.max(inner * 0.4, needed))
  let lowest = body.y
  preset.info.columns.forEach((column, c) => {
    const columnWidth = c === 0 ? firstWidth : inner - firstWidth
    column.forEach((id, row) => {
      const x = body.x + pad + (c === 0 ? 0 : firstWidth)
      const y = body.y + pad + size + row * pitch
      const label = `${infoFieldLabel(id, preset.kind)}:`
      const { text } = infoValue(id, input.facts, input.fields)
      const labelWidth = textWidth(label, size, 'bold') + 3 * k
      ops.push({ op: 'text', x, y, text: label, size, style: 'bold', color: '#000000' })
      ops.push({
        op: 'text',
        x: x + labelWidth,
        y,
        text: fitText(
          text ?? NOT_RECORDED,
          size,
          columnWidth - labelWidth - 3 * k,
          preset.info.boldValues ? 'bold' : 'normal',
        ),
        size,
        style: preset.info.boldValues && text ? 'bold' : 'normal',
        color: text ? '#000000' : SHEET_CHROME.missingValue,
      })
      lowest = Math.max(lowest, y)
    })
  })
  const noteSize = fontSize(sheet, 5)
  const notes = [
    input.facts
      ? `Area planar in BC Albers (EPSG:3005). Centre from the block polygon.${
          input.facts.elevation
            ? ` Elevations: ${input.terrainName ?? 'terrain'}, ${formatNumber(input.facts.elevation.spacingM, 1)} m grid${
                input.facts.elevation.missing ? `, ${input.facts.elevation.missing} samples without ground` : ''
              }.`
            : ' No terrain under the block: elevations not recorded.'
        }`
      : 'No block chosen: block facts not recorded.',
  ]
  if (!bottomPanel) {
    const lines = wrapText(notes[0], noteSize, body.w - pad * 2)
    const room = Math.floor((body.y + body.h - lowest - pad) / (noteSize * 1.25))
    lines.slice(0, Math.max(0, room)).forEach((line, i) =>
      ops.push({
        op: 'text',
        x: body.x + pad,
        y: lowest + noteSize * 1.6 + i * noteSize * 1.25,
        text: line,
        size: noteSize,
        color: SHEET_CHROME.missingValue,
      }),
    )
    return
  }
  // Bottom-panel sheets keep their scale and logo rows inside Block Information.
  const footerHeight = 52 * k
  const footerTop = body.y + body.h - footerHeight
  const lines = wrapText(notes[0], noteSize, body.w - pad * 2)
  const room = Math.floor((footerTop - lowest - pad) / (noteSize * 1.25))
  lines.slice(0, Math.max(0, room)).forEach((line, i) =>
    ops.push({
      op: 'text',
      x: body.x + pad,
      y: lowest + noteSize * 1.6 + i * noteSize * 1.25,
      text: line,
      size: noteSize,
      color: SHEET_CHROME.missingValue,
    }),
  )
  ops.push({
    op: 'path',
    parts: [
      [
        [body.x, footerTop],
        [body.x + body.w, footerTop],
      ],
    ],
    closed: false,
    stroke: { color: SHEET_CHROME.line, width: 1 * k },
  })
  footer(ops, sheet, { x: body.x, y: footerTop, w: body.w, h: footerHeight }, input, projection)
}

/** The LiDAR sheets' spare bar: what the base raster was made from. */
function sourceBar(ops: DrawOp[], sheet: ResolvedSheet, body: Rect, input: ComposeInput) {
  const k = sheet.k
  ops.push({ op: 'rect', ...body, fill: SHEET_CHROME.barFill, stroke: { color: SHEET_CHROME.line, width: 1 * k } })
  const size = fontSize(sheet, 6)
  ops.push({
    op: 'text',
    x: body.x + body.w / 2,
    y: body.y + body.h / 2,
    text: fitText(input.sourceLine ?? '', size, body.w - 8 * k),
    size,
    color: SHEET_CHROME.barText,
    align: 'center',
    baseline: 'middle',
  })
}

/** Draws a legend swatch for `symbol` in `box`, with the same functions that draw the map. */
export function drawSwatch(ops: DrawOp[], symbol: SheetSymbol, box: Rect, k: number) {
  ops.push(...swatchOps(symbol, box, k))
}

function legendPanel(
  ops: DrawOp[],
  sheet: ResolvedSheet,
  preset: SheetPreset,
  body: Rect,
  legend: LegendItem[],
  classes: ClassSymbol[],
) {
  const k = sheet.k
  const pad = 6 * k
  const size = fontSize(sheet, preset.type.legend)
  const swatch = { w: 17.4 * k, h: 8.7 * k }
  const pitch = Math.max(swatch.h, size) + 4 * k
  let y = body.y + pad
  const headingSize = fontSize(sheet, 8.2)
  const heading = (text: string) => {
    y += headingSize
    ops.push({
      op: 'text',
      x: body.x + body.w / 2,
      y,
      text,
      size: headingSize,
      style: 'bold',
      color: '#000000',
      align: 'center',
    })
    y += 5 * k
  }
  const grid = (items: { symbol: SheetSymbol; label: string }[], columns: number, swatchBox = swatch) => {
    const columnWidth = (body.w - pad * 2) / columns
    const rows = Math.ceil(items.length / columns)
    const fitRows = Math.max(1, Math.floor((body.y + body.h - pad - y) / pitch))
    const shown = items.slice(0, Math.min(items.length, fitRows * columns))
    // Fill down each column, as the reference legends do.
    const perColumn = Math.min(rows, fitRows)
    shown.forEach((item, i) => {
      const column = Math.floor(i / perColumn),
        row = i % perColumn
      const x = body.x + pad + column * columnWidth
      const top = y + row * pitch
      drawSwatch(ops, item.symbol, { x, y: top, w: swatchBox.w, h: swatchBox.h }, k)
      ops.push({
        op: 'text',
        x: x + swatchBox.w + 4 * k,
        y: top + swatchBox.h / 2,
        text: fitText(item.label, size, columnWidth - swatchBox.w - 8 * k),
        size,
        color: '#000000',
        baseline: 'middle',
      })
    })
    if (shown.length < items.length) {
      ops.push({
        op: 'text',
        x: body.x + body.w - pad,
        y: body.y + body.h - pad / 2,
        text: `+${items.length - shown.length} more not shown`,
        size,
        color: SHEET_CHROME.missingValue,
        align: 'right',
      })
    }
    y += perColumn * pitch + 4 * k
  }
  const side = preset.template.id === 'lidar-side-panel' || preset.template.id === 'field-side-panel'
  if (classes.length) {
    if (side) heading(preset.classTitle ?? 'Classes')
    grid(
      classes.map((symbol) => ({ symbol, label: symbol.label })),
      side ? 4 : preset.legendColumns,
      { w: 18.2 * k, h: 9.1 * k },
    )
    if (side && legend.length) {
      ops.push({
        op: 'path',
        parts: [
          [
            [body.x + pad, y],
            [body.x + body.w - pad, y],
          ],
        ],
        closed: false,
        stroke: { color: '#000000', width: 0.5 * k },
      })
      y += 4 * k
    }
  }
  if (legend.length) {
    if (side) heading('Map Features')
    grid(
      legend.map((item) => ({ symbol: item.symbol, label: item.symbol.label })),
      preset.legendColumns,
    )
  }
  if (!classes.length && !legend.length)
    ops.push({
      op: 'text',
      x: body.x + body.w / 2,
      y: body.y + body.h / 2,
      text: 'Nothing drawn in the frame.',
      size,
      color: SHEET_CHROME.missingValue,
      align: 'center',
    })
}

/** Roads in two side-by-side halves of five rows: colour key, name, chainage. */
export const ROAD_TABLE_ROWS = 5
function roadTable(ops: DrawOp[], sheet: ResolvedSheet, body: Rect, roads: SheetRoad[], issue: SheetIssue) {
  const k = sheet.k
  const summarySize = fontSize(sheet, 7)
  const summaryHeight = 18 * k
  ops.push({
    op: 'text',
    x: body.x + 4 * k,
    y: body.y + summaryHeight / 2,
    text: `Summary Date: ${issue.date}`,
    size: summarySize,
    style: 'bold',
    color: '#ff0000',
    baseline: 'middle',
  })
  ops.push({
    op: 'text',
    x: body.x + body.w / 2 + 4 * k,
    y: body.y + summaryHeight / 2,
    text: fitText(`Summary By: ${issue.preparedBy || NOT_RECORDED}`, summarySize, body.w / 2 - 8 * k, 'bold'),
    size: summarySize,
    style: 'bold',
    color: '#ff0000',
    baseline: 'middle',
  })
  const top = body.y + summaryHeight
  const headerHeight = 11.1 * k
  const rowHeight = (body.y + body.h - top - headerHeight) / ROAD_TABLE_ROWS
  // Column fractions of the table width, from the reference sheet.
  const fractions = [0.1, 0.175, 0.225]
  const half = body.w / 2
  const columns = [0, 1].flatMap((h) => {
    let x = body.x + h * half
    return fractions.map((f) => {
      const column = { x, w: f * body.w }
      x += column.w
      return column
    })
  })
  const headerSize = fontSize(sheet, 6.2)
  ops.push({
    op: 'rect',
    x: body.x,
    y: top,
    w: body.w,
    h: headerHeight,
    fill: SHEET_CHROME.tableHeaderFill,
    stroke: { color: SHEET_CHROME.line, width: 1 * k },
  })
  ;['Colour', 'Road Name', 'Chainage', 'Colour', 'Road Name', 'Chainage'].forEach((label, i) =>
    ops.push({
      op: 'text',
      x: columns[i].x + 2 * k,
      y: top + headerHeight / 2,
      text: label,
      size: headerSize,
      color: '#000000',
      baseline: 'middle',
    }),
  )
  const grid: Point[][] = []
  for (let r = 1; r <= ROAD_TABLE_ROWS; r++) {
    const y = top + headerHeight + r * rowHeight
    grid.push([
      [body.x, y],
      [body.x + body.w, y],
    ])
  }
  for (const column of columns.slice(1))
    grid.push([
      [column.x, top],
      [column.x, body.y + body.h],
    ])
  ops.push({ op: 'path', parts: grid, closed: false, stroke: { color: SHEET_CHROME.line, width: 0.5 * k } })
  ops.push({
    op: 'rect',
    x: body.x,
    y: top,
    w: body.w,
    h: body.y + body.h - top,
    stroke: { color: SHEET_CHROME.line, width: 1 * k },
  })
  const capacity = ROAD_TABLE_ROWS * 2
  const shown = roads.length > capacity ? roads.slice(0, capacity - 1) : roads
  const size = fontSize(sheet, 6)
  const band = 'detail' as const
  shown.forEach((road, i) => {
    const h = Math.floor(i / ROAD_TABLE_ROWS),
      r = i % ROAD_TABLE_ROWS
    const y = top + headerHeight + r * rowHeight
    const [colour, name, chainage] = columns.slice(h * 3, h * 3 + 3)
    const box = { x: colour.x + 3 * k, y: y + rowHeight * 0.2, w: colour.w - 6 * k, h: rowHeight * 0.6 }
    ops.push({ op: 'rect', ...box, stroke: { color: SHEET_CHROME.line, width: 0.5 * k } })
    drawSwatch(ops, proposedRoad(road.color, band), box, k)
    ops.push({
      op: 'text',
      x: name.x + 2 * k,
      y: y + rowHeight / 2,
      text: fitText(road.name, size, name.w - 4 * k),
      size,
      color: '#000000',
      baseline: 'middle',
    })
    ops.push({
      op: 'text',
      x: chainage.x + 2 * k,
      y: y + rowHeight / 2,
      text: fitText(chainageRange(road.lengthM), size, chainage.w - 4 * k),
      size,
      color: '#000000',
      baseline: 'middle',
    })
  })
  if (roads.length > capacity) {
    const [, name] = columns.slice(3, 6)
    ops.push({
      op: 'text',
      x: name.x + 2 * k,
      y: top + headerHeight + (ROAD_TABLE_ROWS - 0.5) * rowHeight,
      text: `+${roads.length - shown.length} more roads`,
      size,
      color: SHEET_CHROME.missingValue,
      baseline: 'middle',
    })
  }
}

/** Scale and date, the scale bar, then the logo and organisation. */
function footer(ops: DrawOp[], sheet: ResolvedSheet, body: Rect, input: ComposeInput, projection: FrameProjection) {
  const k = sheet.k
  const pad = 5 * k
  const size = fontSize(sheet, input.frame.preset.type.footer)
  ops.push({ op: 'rect', ...body, stroke: { color: SHEET_CHROME.line, width: 1 * k } })
  const row = body.y + pad + size
  const centreLat = projection.center[1]
  const parts = [
    `Scale = ${formatScale(projection.scale)}`,
    `Date: ${input.issue.date}`,
    `Prepared by: ${input.issue.preparedBy || NOT_RECORDED}`,
  ]
  const third = (body.w - pad * 2) / 3
  parts.forEach((text, i) =>
    ops.push({
      op: 'text',
      x: body.x + pad + i * third,
      y: row,
      text: fitText(text, size, third - 3 * k),
      size,
      color: '#000000',
    }),
  )
  // Alternating bar: black and white segments, the left one halved.
  const bar = scaleBar(projection.scale, body.w * 0.62)
  const barX = body.x + pad + 4 * k,
    labelSize = fontSize(sheet, 5)
  const barY = row + labelSize + 5 * k,
    barH = 2.2 * k
  const segments: { x: number; w: number }[] = [
    { x: barX, w: bar.segmentPt / 2 },
    { x: barX + bar.segmentPt / 2, w: bar.segmentPt / 2 },
    ...Array.from({ length: bar.rightSegments }, (_, i) => ({ x: barX + bar.segmentPt * (i + 1), w: bar.segmentPt })),
  ]
  segments.forEach((segment, i) =>
    ops.push({
      op: 'rect',
      x: segment.x,
      y: barY,
      w: segment.w,
      h: barH,
      fill: i % 2 === 0 ? '#000000' : '#ffffff',
      stroke: { color: '#000000', width: 0.6 * k },
    }),
  )
  for (const label of bar.labels)
    ops.push({
      op: 'text',
      x: barX + label.offsetPt,
      y: barY - 2 * k,
      text: label.value.toLocaleString('en-US'),
      size: labelSize,
      color: '#000000',
      align: 'center',
    })
  ops.push({
    op: 'text',
    x: barX + bar.widthPt + 6 * k,
    y: barY + barH,
    text: 'Metres',
    size: labelSize,
    color: '#000000',
  })
  const divider = barY + barH + 5 * k
  ops.push({
    op: 'path',
    parts: [
      [
        [body.x, divider],
        [body.x + body.w, divider],
      ],
    ],
    closed: false,
    stroke: { color: SHEET_CHROME.line, width: 1 * k },
  })
  // Logo row: an optional user logo, then the organisation and the planning caveat.
  const rowTop = divider + 2 * k,
    rowHeight = body.y + body.h - rowTop - 2 * k
  let textX = body.x + pad
  if (input.logo && rowHeight > 4) {
    const maxW = body.w * 0.3,
      maxH = rowHeight
    const ratio = Math.min(maxW / input.logo.width, maxH / input.logo.height)
    const w = input.logo.width * ratio,
      h = input.logo.height * ratio
    ops.push({ op: 'image', x: body.x + pad, y: rowTop + (rowHeight - h) / 2, w, h, image: input.logo })
    textX = body.x + pad + w + 6 * k
  }
  const lines = [
    { text: input.issue.organisation, bold: true },
    {
      text: `North up, Web Mercator. Scale true at ${Math.abs(centreLat).toFixed(2)}°${centreLat < 0 ? 'S' : 'N'}.`,
      bold: false,
    },
    {
      text: [input.issue.revision ? `Rev ${input.issue.revision}` : '', input.caveat ?? ''].filter(Boolean).join(' - '),
      bold: false,
    },
  ].filter((line) => line.text)
  const small = fontSize(sheet, 5.5)
  const room = body.x + body.w - pad - textX
  const wrapped = lines.flatMap((line) =>
    wrapText(line.text, small, room, line.bold ? 'bold' : 'normal').map((text) => ({ text, bold: line.bold })),
  )
  const fits = Math.max(0, Math.floor(rowHeight / (small * 1.2)))
  const shown = wrapped.slice(0, fits)
  const startY = rowTop + (rowHeight - shown.length * small * 1.2) / 2 + small
  shown.forEach((line, i) =>
    ops.push({
      op: 'text',
      x: textX,
      y: startY + i * small * 1.2,
      text: line.text,
      size: small,
      style: line.bold ? 'bold' : 'normal',
      color: '#000000',
    }),
  )
}

function commentsPanel(ops: DrawOp[], sheet: ResolvedSheet, body: Rect, comments: string) {
  const k = sheet.k
  const pad = 5 * k
  const size = fontSize(sheet, 6)
  const lines = wrapText(comments.trim() || 'No access comments entered.', size, body.w - pad * 2)
  const fits = Math.floor((body.h - pad * 2) / (size * 1.25))
  const shown =
    lines.length > fits
      ? [...lines.slice(0, Math.max(0, fits - 1)), '... (continues: shorten the comments to fit)']
      : lines
  shown.forEach((line, i) =>
    ops.push({
      op: 'text',
      x: body.x + pad,
      y: body.y + pad + size + i * size * 1.25,
      text: line,
      size,
      color: comments.trim() ? '#000000' : SHEET_CHROME.missingValue,
    }),
  )
}

/** Blank ruled writing space, 11.9 pt apart. */
function notesPanel(ops: DrawOp[], sheet: ResolvedSheet, body: Rect) {
  const k = sheet.k
  const rules: Point[][] = []
  for (let y = body.y + 11.9 * k; y < body.y + body.h - 2 * k; y += 11.9 * k)
    rules.push([
      [body.x + 6 * k, y],
      [body.x + body.w - 6 * k, y],
    ])
  ops.push({ op: 'path', parts: rules, closed: false, stroke: { color: SHEET_CHROME.noteRule, width: 0.1 * k + 0.15 } })
}
