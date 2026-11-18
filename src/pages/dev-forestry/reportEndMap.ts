/**
 * The VIA report's portrait end map, composed without a browser: the "VIA Overview Map" a consultant prints as the
 * last page of a 2001-form VIA (05's 1:40,000 sheet). An 11 × 17 portrait page in points: a title block (the user's
 * own logo slot, "VIA Overview Map", the project line and the stated scale), a key map placing the area in its
 * region, and the map inside a neat line with UTM grid ticks round it: contours traced from the terrain tiles on a
 * plain base, water and parks, creeks and roads read from the plan's vector basemap, the visual landscape inventory as
 * magenta linework labelled with its VQO, the existing openings, retention and the proposed blocks, and the
 * viewpoints as numbered triangles, with a legend of only the rows the map has (`reportMaps.ts` plans the page).
 *
 * Every symbol is `VIA_OVERVIEW_MAP` (`src/lib/forestry/blockSheet/styles.ts`), drawn through the sheet engine's
 * symbols. No DOM or network access: the basemap is read through a structural map type, the terrain through an
 * `elevationAt` source.
 */
import { VIA_OVERVIEW_MAP } from '@/lib/forestry/blockSheet/styles'
import { gridContours, type ContourResult } from '@/lib/mapSheet/contours'
import {
  boxesMeet,
  labelsAlongLine,
  labelSpacer,
  rectRing,
  type DrawOp,
  type Point,
  type RasterImage,
} from '@/lib/mapSheet/drawOps'
import { formatScale, type FrameProjection } from '@/lib/mapSheet/scale'
import {
  areaSymbolOps,
  lineSymbolOps,
  pointSymbolOps,
  scaleStroke,
  swatchOps,
  symbolKeyColor,
  type AreaSymbol,
  type LineSymbol,
  type PointSymbol,
} from '@/lib/mapSheet/symbols'
import { fitText, textWidth } from '@/lib/mapSheet/textMetrics'
import {
  END_MAP_CONTOUR_GRID_PT,
  endMapLegendKeys,
  type ComposedReportMap,
  type EndMapLegendKey,
  type LngLat,
  type LngLatBounds,
  type ReportMapFeatures,
  type ReportMapPlan,
} from './reportMaps'
import { pointInPolygon, polygonBounds, polygonInteriorPoint, type PolygonGeometry } from './visibility'
import type { EvqoCode } from './visualsNarrative'

const S = VIA_OVERVIEW_MAP

// ---------------------------------------------------------------- the basemap's features

/** What the end map reads from the plan's vector basemap at its camera. */
export interface EndMapBasemap {
  water: PolygonGeometry[]
  parks: PolygonGeometry[]
  creeks: LngLat[][]
  highways: LngLat[][]
  roads: LngLat[][]
  /** Named lakes and rivers, for a label in the water. */
  waterNames: Array<{ name: string; lng: number; lat: number }>
}

/** A map's style and its loaded vector tiles, as MapLibre gives them (structural, so the tests need no map). */
export type EndMapQueryMap = {
  getStyle: () => { layers?: Array<{ id: string; source?: string; 'source-layer'?: string }> } | undefined
  querySourceFeatures: (sourceId: string, options: { sourceLayer: string }) => Array<GeoJSON.Feature | null | undefined>
}

/** Road classes drawn as the highway (OpenMapTiles' `class`, or `kind_detail` in CARTO's and Protomaps' tiles). */
export const HIGHWAY_CLASSES = new Set(['motorway', 'trunk', 'primary'])
/** Road classes drawn as existing roads; forest roads are mostly `track`. Paths, ferries and rail are left out. */
export const ROAD_CLASSES = new Set([
  'secondary',
  'tertiary',
  'minor',
  'service',
  'track',
  'unclassified',
  'residential',
  'road',
  'living_street',
])
/** Park kinds drawn as parks: OpenMapTiles' whole `park` layer, and these kinds of a `landuse` layer. */
const PARK_KINDS = new Set(['national_park', 'nature_reserve', 'protected_area', 'park'])
/** The source layers read, in either schema. */
const BASEMAP_LAYERS = ['water', 'waterway', 'water_name', 'transportation', 'roads', 'park', 'landuse'] as const

const overlaps = (a: LngLatBounds, b: LngLatBounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
const linesOf = (geometry: GeoJSON.Geometry | null | undefined): LngLat[][] =>
  geometry?.type === 'LineString'
    ? [geometry.coordinates as LngLat[]]
    : geometry?.type === 'MultiLineString'
      ? (geometry.coordinates as LngLat[][])
      : []
const lineBounds = (line: readonly LngLat[]): LngLatBounds => {
  const box: LngLatBounds = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [lng, lat] of line) {
    box[0] = Math.min(box[0], lng)
    box[1] = Math.min(box[1], lat)
    box[2] = Math.max(box[2], lng)
    box[3] = Math.max(box[3], lat)
  }
  return box
}

/**
 * Water, parks, creeks and roads from the basemap's loaded vector tiles inside `within`, each piece once. Two tile
 * schemas are read: OpenMapTiles (`water`, `waterway`, `water_name`, `transportation` with `class`, `park`) and
 * CARTO's and Protomaps' (`water` holding lakes, waterways and their names by geometry, `roads` with `kind_detail`,
 * `landuse` with `kind`). Tiles repeat what lies in their buffers, so a piece seen twice is kept once; water and parks
 * are drawn without an outline, so the tile edges that cut a lake never show. Empty when the style carries none.
 */
export function endMapBasemapFromMap(map: EndMapQueryMap, within: LngLatBounds): EndMapBasemap {
  const out: EndMapBasemap = { water: [], parks: [], creeks: [], highways: [], roads: [], waterNames: [] }
  const layers = map.getStyle()?.layers ?? []
  const seen = new Set<string>()
  const once = (kind: string, coordinates: unknown) => {
    const key = `${kind}:${JSON.stringify(coordinates)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
  const inside = ([lng, lat]: LngLat) => lng >= within[0] && lng <= within[2] && lat >= within[1] && lat <= within[3]
  const addLines = (into: LngLat[][], tag: string, geometry: GeoJSON.Geometry | null | undefined) => {
    for (const line of linesOf(geometry))
      if (line.length > 1 && overlaps(lineBounds(line), within) && once(tag, line)) into.push(line)
  }
  for (const sourceLayer of BASEMAP_LAYERS) {
    const sources = [
      ...new Set(layers.filter((l) => l['source-layer'] === sourceLayer && l.source).map((l) => l.source!)),
    ]
    for (const feature of sources.flatMap((source) => map.querySourceFeatures(source, { sourceLayer }))) {
      const geometry = feature?.geometry
      if (!geometry) continue
      const props = feature.properties ?? {}
      const kind = String(props.kind ?? props.class ?? '')
      const detail = String(props.kind_detail ?? props.class ?? '').replace(/_link$/, '')
      const area = geometry.type === 'Polygon' || geometry.type === 'MultiPolygon'
      const name = props.name ?? props['name:en']
      if (geometry.type === 'Point' && (sourceLayer === 'water' || sourceLayer === 'water_name')) {
        const at = geometry.coordinates as LngLat
        if (typeof name === 'string' && name.trim() && inside(at) && !out.waterNames.some((w) => w.name === name))
          out.waterNames.push({ name, lng: at[0], lat: at[1] })
      } else if (sourceLayer === 'water' || sourceLayer === 'waterway') {
        if (area) {
          if (overlaps(polygonBounds(geometry), within) && once('water', geometry.coordinates)) out.water.push(geometry)
        } else addLines(out.creeks, 'waterway', geometry)
      } else if (sourceLayer === 'park' || (sourceLayer === 'landuse' && PARK_KINDS.has(kind))) {
        if (area && overlaps(polygonBounds(geometry), within) && once('park', geometry.coordinates))
          out.parks.push(geometry)
      } else if (sourceLayer === 'transportation' || sourceLayer === 'roads') {
        if (HIGHWAY_CLASSES.has(detail) || kind === 'highway') addLines(out.highways, 'road', geometry)
        else if (ROAD_CLASSES.has(detail) || kind === 'major_road' || kind === 'minor_road')
          addLines(out.roads, 'road', geometry)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- contours

export interface EndMapContours {
  result: ContourResult
  gridWidth: number
  gridHeight: number
}

/**
 * Contours over the end map's neat line, traced from `source` on a grid of one sample per
 * `END_MAP_CONTOUR_GRID_PT` points at the plan's interval (`gridContours`, which widens it past its segment budget
 * and says so). Null when the terrain has nothing inside the frame.
 */
export function endMapContours(
  projection: FrameProjection,
  source: { elevationAt(lng: number, lat: number): number },
  interval: { intervalM: number; indexEvery: number },
): EndMapContours | null {
  const { x, y, w, h } = projection.frame
  const width = Math.max(2, Math.round(w / END_MAP_CONTOUR_GRID_PT)),
    height = Math.max(2, Math.round(h / END_MAP_CONTOUR_GRID_PT))
  const values = new Float32Array(width * height)
  let any = false
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const [lng, lat] = projection.unproject(x + ((col + 0.5) * w) / width, y + ((row + 0.5) * h) / height)
      const value = source.elevationAt(lng, lat)
      values[row * width + col] = Number.isFinite(value) ? value : Number.NaN
      any ||= Number.isFinite(value)
    }
  if (!any) return null
  return {
    result: gridContours({ width, height, values }, interval.intervalM, interval.indexEvery),
    gridWidth: width,
    gridHeight: height,
  }
}

// ---------------------------------------------------------------- composing

type Box = { x: number; y: number; w: number; h: number }

export interface EndMapInput {
  plan: ReportMapPlan
  features: ReportMapFeatures
  /** The basemap's features at the sheet's camera; null draws `mapImage` as the base instead. */
  basemap: EndMapBasemap | null
  contours: EndMapContours | null
  /** The vector map captured at the sheet's camera: the base when the basemap's features could not be read. */
  mapImage: RasterImage | null
  /** The key map's capture; null leaves its box with a note. */
  keyMapImage: RasterImage | null
  /** The user's own logo (or their brand's), for the title block's logo slot; null leaves the slot empty. */
  logo: RasterImage | null
  /** The project line under the title ("CP 405"); null prints the blocks' names. */
  project: string | null
  attribution: string | null
}

/**
 * "VP 2 Lost Ledges": a viewpoint numbered in the report's order, unless its name already carries a VP number
 * anywhere ("VP3 Marine Beach", "Lost Ledge (VP2)"), which then leads the label once.
 */
export function endMapViewpointLabel(name: string, index: number): string {
  const found = /\(?\bvp\s*(\d+)\)?/i.exec(name)
  const rest = (found ? name.replace(found[0], ' ') : name).replace(/\s+/g, ' ').trim()
  return `VP ${found ? found[1] : index + 1}${rest ? ` ${rest}` : ''}`
}

/** Words into lines no wider than `maxWidth`, at most `maxLines` (the last one shortened to fit). */
function wrap(text: string, size: number, maxWidth: number, maxLines: number, style: 'normal' | 'bold' = 'normal') {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && textWidth(next, size, style) > maxWidth) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  return [...lines.slice(0, maxLines - 1), fitText(lines.slice(maxLines - 1).join(' '), size, maxWidth, style)]
}

/** A raster fitted in a box at its own proportions, centred (or left-aligned). */
function fittedImage(image: RasterImage, box: Box, align: 'left' | 'center' = 'center'): DrawOp {
  const scale = Math.min(box.w / image.width, box.h / image.height)
  const w = image.width * scale,
    h = image.height * scale
  return {
    op: 'image',
    x: align === 'left' ? box.x : box.x + (box.w - w) / 2,
    y: box.y + (box.h - h) / 2,
    w,
    h,
    image,
  }
}

const ringsOf = (geometry: PolygonGeometry): LngLat[][][] =>
  (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as LngLat[][][]

/**
 * The end map as sheet operations on its 11 × 17 page (792 × 1224 points), from `reportMaps.ts`'s plan. Throws when
 * the plan is not an end map.
 */
export function composeEndMap(input: EndMapInput): ComposedReportMap {
  const { plan, features } = input
  const end = plan.endMap
  if (!end || !plan.sheet) throw new Error('Not an end map plan.')
  const { layout, projection, ticks } = end
  const map = layout.map
  const k = 1
  const project = ([lng, lat]: LngLat): Point => projection.project(lng, lat)
  const partsOf = (geometry: PolygonGeometry): Point[][] =>
    ringsOf(geometry).flatMap((rings) => rings.map((ring) => ring.map(project)))
  const [west, south, east, north] = projection.bounds
  const visibleBox = ([w, s, e, n]: LngLatBounds) => !(e < west || w > east || n < south || s > north)
  const visible = (geometry: PolygonGeometry) => visibleBox(polygonBounds(geometry))
  const drawn = new Set<EndMapLegendKey>()
  const ops: DrawOp[] = [{ op: 'rect', ...layout.page, fill: '#ffffff' }]

  // ---- The map, clipped to its neat line ----
  ops.push({ op: 'clip', parts: [rectRing(map.x, map.y, map.w, map.h)] })
  ops.push({ op: 'rect', ...map, fill: S.base })
  const basemap = input.basemap
  if (!basemap && input.mapImage) {
    // At the neat line's width: the capture's whole pixels leave its shape a hair off the neat line's.
    const h = (map.w * input.mapImage.height) / input.mapImage.width
    ops.push({ op: 'image', x: map.x, y: map.y + (map.h - h) / 2, w: map.w, h, image: input.mapImage })
  }
  // A chosen map style's blocks and openings, on the map and in the legend; the end map's own otherwise.
  const styled: { block: AreaSymbol; harvested: AreaSymbol } = {
    block: features.symbols?.block ?? S.block,
    harvested: features.symbols?.opening ?? S.harvested,
  }
  const area = (geometries: readonly PolygonGeometry[], symbol: AreaSymbol, key: EndMapLegendKey | null) => {
    let any = false
    for (const geometry of geometries) {
      if (!visible(geometry)) continue
      ops.push(...areaSymbolOps(partsOf(geometry), symbol, k))
      any = true
    }
    if (any && key) drawn.add(key)
  }
  const lines = (list: readonly LngLat[][], symbol: LineSymbol, key: EndMapLegendKey) => {
    const parts = list.filter((line) => visibleBox(lineBounds(line))).map((line) => line.map(project))
    if (!parts.length) return
    ops.push(...lineSymbolOps(parts, symbol, k))
    drawn.add(key)
  }
  if (basemap) area(basemap.parks, S.parks, 'parks')
  area(
    features.openings.map((opening) => opening.geometry),
    styled.harvested,
    'harvested',
  )

  // Contours under the water and every line, labelled along the index lines.
  const contourLabels: DrawOp[] = []
  let contourNote: string | null = null
  if (input.contours) {
    const { result, gridWidth, gridHeight } = input.contours
    const sx = map.w / gridWidth,
      sy = map.h / gridHeight
    const toPaper = (line: [number, number][]): Point[] =>
      line.map(([c, r]) => [map.x + (c + 0.5) * sx, map.y + (r + 0.5) * sy])
    const free = labelSpacer(40)
    for (const level of result.levels) {
      const parts = level.lines.map(toPaper)
      ops.push({
        op: 'path',
        parts,
        closed: false,
        stroke: scaleStroke(level.index ? S.contours.index : S.contours.intermediate, k),
      })
      if (!level.index) continue
      const text = String(Math.round(level.level))
      const size = S.contours.labelSize
      for (const part of parts)
        for (const at of labelsAlongLine(part, 260, textWidth(text, size) + 4, map, 8)) {
          if (!free(at.x, at.y)) continue
          contourLabels.push({
            op: 'text',
            x: at.x,
            y: at.y,
            text,
            size,
            color: S.contours.indexLabel,
            align: 'center',
            baseline: 'middle',
            angle: at.angle,
            halo: S.contours.halo,
          })
        }
    }
    contourNote = `Contours ${result.interval} m, index ${result.interval * result.indexEvery} m${
      result.widened ? ` (widened from ${end.contours.intervalM} m to stay legible)` : ''
    }, from the terrain tiles`
  }
  ops.push(...contourLabels)

  if (basemap) {
    area(basemap.water, S.lake, 'lake')
    lines(basemap.creeks, S.creek, 'creek')
    lines(basemap.roads, S.existingRoad, 'existingRoad')
    lines(basemap.highways, S.highway, 'highway')
  }

  // The visual landscape inventory as linework, then retention and the blocks over it.
  const units = features.inventory.filter((unit) => unit.code && visible(unit.geometry))
  area(
    units.map((unit) => unit.geometry),
    S.vqo,
    'vqo',
  )
  area(
    (features.retention ?? []).map((patch) => patch.geometry),
    S.wtra,
    'wtra',
  )
  const blocks = features.blocks.filter((block) => visible(block.geometry))
  area(
    blocks.map((block) => block.geometry),
    styled.block,
    'block',
  )
  const placed = features.viewpoints
    .map((vp, index) => ({ vp, index, at: project([vp.lng, vp.lat]) }))
    .filter(({ at: [x, y] }) => x >= map.x && x <= map.x + map.w && y >= map.y && y <= map.y + map.h)
  for (const { at } of placed) ops.push(...pointSymbolOps(S.viewpoint, at[0], at[1], k))
  if (placed.length) drawn.add('viewpoint')

  // ---- Labels: viewpoints, blocks, VQO classes, water names; none over another or the legend ----
  const rows = endMapLegendKeys(drawn).map((key) => ({
    key,
    symbol: (key === 'block' || key === 'harvested' ? styled[key] : S[key]) as AreaSymbol | LineSymbol | PointSymbol,
  }))
  const legend = legendLayout(rows, map)
  const taken: Box[] = [legend.box, ...placed.map(({ at }) => ({ x: at[0] - 5, y: at[1] - 5, w: 10, h: 10 }))]
  const labels: string[] = []
  const halo = { color: '#ffffff', width: 2 }
  const tryLabel = (
    textLines: readonly string[],
    x: number,
    y: number,
    style: { size: number; color: string; bold?: boolean; italic?: boolean; align: 'left' | 'center' },
  ) => {
    const fontStyle = style.italic ? 'italic' : style.bold ? 'bold' : 'normal'
    const w = Math.max(...textLines.map((line) => textWidth(line, style.size, fontStyle)))
    const left = style.align === 'center' ? x - w / 2 : x
    const rect: Box = {
      x: left - 1.5,
      y: y - style.size * 0.9,
      w: w + 3,
      h: style.size * (0.3 + 1.15 * textLines.length),
    }
    if (rect.x < map.x + 2 || rect.y < map.y + 2 || rect.x + rect.w > map.x + map.w - 2) return false
    if (rect.y + rect.h > map.y + map.h - 2 || taken.some((other) => boxesMeet(other, rect))) return false
    taken.push(rect)
    labels.push(textLines.join(' '))
    textLines.forEach((line, i) =>
      ops.push({
        op: 'text',
        x,
        y: y + i * style.size * 1.15,
        text: line,
        size: style.size,
        style: fontStyle,
        color: style.color,
        align: style.align,
        halo,
      }),
    )
    return true
  }
  for (const { vp, index, at } of placed) {
    const textLines = wrap(endMapViewpointLabel(vp.name, index), 7, 60, 3)
    const size = 7
    const w = Math.max(...textLines.map((line) => textWidth(line, size)))
    for (const [x, y] of [
      [at[0] + 7, at[1] - 2],
      [at[0] - 7 - w, at[1] - 2],
      [at[0] - w / 2, at[1] - 8 - (textLines.length - 1) * size * 1.15],
      [at[0] - w / 2, at[1] + 13],
    ] as const)
      if (tryLabel(textLines, x, y, { size, color: '#000000', align: 'left' })) break
  }
  const inFrame = (geometry: PolygonGeometry): Point | null => {
    const centre = polygonInteriorPoint(geometry)
    if (centre) {
      const [x, y] = project([centre.lng, centre.lat])
      if (x > map.x && x < map.x + map.w && y > map.y && y < map.y + map.h) return [x, y]
    }
    for (let j = 1; j < 10; j++)
      for (let i = 1; i < 10; i++) {
        const x = map.x + (map.w * i) / 10,
          y = map.y + (map.h * j) / 10
        const [lng, lat] = projection.unproject(x, y)
        if (pointInPolygon(geometry, lng, lat)) return [x, y]
      }
    return null
  }
  for (const block of blocks) {
    const at = inFrame(block.geometry)
    if (!at) continue
    for (const dy of [0, -9, 9])
      if (tryLabel([block.name], at[0], at[1] + 2.5 + dy, { size: 7, color: '#000000', align: 'center' })) break
  }
  for (const unit of units) {
    const at = inFrame(unit.geometry)
    if (!at) continue
    for (const [dx, dy] of [
      [0, 0],
      [0, -14],
      [0, 14],
      [-20, 0],
      [20, 0],
    ] as const)
      if (
        tryLabel([unit.code as EvqoCode], at[0] + dx, at[1] + 3 + dy, {
          size: 8,
          color: S.vqoLabel,
          bold: true,
          align: 'center',
        })
      )
        break
  }
  for (const water of basemap?.waterNames ?? []) {
    const [x, y] = project([water.lng, water.lat])
    tryLabel([water.name], x, y, { size: 9, color: '#1f5f8b', italic: true, align: 'center' })
  }
  if (input.attribution)
    ops.push({
      op: 'text',
      x: map.x + map.w - 3,
      y: map.y + map.h - 3,
      text: fitText(input.attribution, 5, map.w * 0.6),
      size: 5,
      color: '#323232',
      align: 'right',
      halo: { color: '#ffffff', width: 1.2 },
    })
  ops.push({ op: 'restore' })

  // ---- Chrome: legend, neat line, grid ticks, title block, key map, footer ----
  ops.push(...legend.ops)
  ops.push({ op: 'rect', ...map, stroke: { color: '#000000', width: 1 } })
  const tick = 5,
    tickSize = 6.5
  for (const t of ticks.top) {
    ops.push(tickLine([t.at, map.y], [t.at, map.y - tick]))
    ops.push(tickText(t.label, t.at, map.y - tick - 2.5, tickSize, 0))
  }
  for (const t of ticks.bottom) {
    ops.push(tickLine([t.at, map.y + map.h], [t.at, map.y + map.h + tick]))
    ops.push(tickText(t.label, t.at, map.y + map.h + tick + tickSize + 1, tickSize, 0))
  }
  for (const t of ticks.left) {
    ops.push(tickLine([map.x, t.at], [map.x - tick, t.at]))
    ops.push(tickText(t.label, map.x - tick - 2.5, t.at, tickSize, 90))
  }
  for (const t of ticks.right) {
    ops.push(tickLine([map.x + map.w, t.at], [map.x + map.w + tick, t.at]))
    ops.push(tickText(t.label, map.x + map.w + tick + 2.5 + tickSize * 0.75, t.at, tickSize, 90))
  }

  // The title block: the logo slot (the user's own), the title, the project line and the stated scale.
  if (input.logo) ops.push(fittedImage(input.logo, layout.logo, 'left'))
  else {
    ops.push({
      op: 'rect',
      ...layout.logo,
      stroke: { color: '#bfbfbf', width: 0.5, dash: [3, 2] },
    })
    ops.push({
      op: 'text',
      x: layout.logo.x + layout.logo.w / 2,
      y: layout.logo.y + layout.logo.h / 2 + 2.5,
      text: 'Logo (your own)',
      size: 7,
      color: '#9c9c9c',
      align: 'center',
    })
  }
  const heading = layout.heading
  const cx = heading.x + heading.w / 2
  const projectLine = fitText(
    input.project?.trim() || blockList(features.blocks.map((block) => block.name)) || 'Proposed blocks',
    15,
    heading.w,
  )
  ops.push(
    { op: 'text', x: cx, y: heading.y + 30, text: 'VIA Overview Map', size: 19, color: '#000000', align: 'center' },
    { op: 'text', x: cx, y: heading.y + 52, text: projectLine, size: 15, color: '#000000', align: 'center' },
    {
      op: 'text',
      x: cx,
      y: heading.y + 70,
      text: formatScale(plan.sheet.scale),
      size: 11,
      color: '#000000',
      align: 'center',
    },
  )
  ops.push(...keyMapOps(input.keyMapImage, plan, layout.keyMap))

  // The footer: the grid, the contours and the base, so the sheet says what it stands on.
  const footer = [
    `UTM zone ${ticks.zone}, ${ticks.datum}: ticks every ${ticks.intervalM >= 1000 ? `${ticks.intervalM / 1000} km` : `${ticks.intervalM} m`}`,
    contourNote ?? 'No contours: the terrain tiles could not be read',
    basemap ? 'water, parks and roads from the plan’s vector map' : 'base: the plan’s vector map',
    `${formatScale(plan.sheet.scale)} at 11 × 17 in`,
  ].join(' · ')
  ops.push({
    op: 'text',
    x: layout.footer.x + layout.footer.w,
    y: layout.footer.y + layout.footer.h - 2,
    text: fitText(footer, 6.5, layout.footer.w),
    size: 6.5,
    color: '#323232',
    align: 'right',
  })

  return {
    ops,
    width: layout.page.w,
    height: layout.page.h,
    legend: rows.map((row) => row.symbol.label),
    legendRows: rows.map(({ symbol }) => ({ label: symbol.label, color: symbolKeyColor(symbol), kind: symbol.kind })),
    scale: formatScale(plan.sheet.scale),
    labels,
  }
}

const tickLine = (a: Point, b: Point): DrawOp => ({
  op: 'path',
  parts: [[a, b]],
  closed: false,
  stroke: { color: '#000000', width: 0.6 },
})
const tickText = (text: string, x: number, y: number, size: number, angle: number): DrawOp => ({
  op: 'text',
  x,
  y,
  text,
  size,
  color: '#000000',
  align: 'center',
  ...(angle ? { angle } : {}),
})

const blockList = (names: readonly string[]) =>
  names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')

/** The legend box at the map's top-left corner: a title, then one row per symbol drawn. */
function legendLayout(
  rows: ReadonlyArray<{ key: EndMapLegendKey; symbol: AreaSymbol | LineSymbol | PointSymbol }>,
  map: Box,
): { ops: DrawOp[]; box: Box } {
  if (!rows.length) return { ops: [], box: { x: map.x, y: map.y, w: 0, h: 0 } }
  const size = 7.5,
    pitch = 13,
    swatch = { w: 24, h: 9 },
    pad = 6,
    titleSize = 10
  const w =
    pad * 2 +
    swatch.w +
    6 +
    Math.max(textWidth('Legend', titleSize), ...rows.map((row) => textWidth(row.symbol.label, size)))
  const h = pad * 2 + titleSize * 1.4 + rows.length * pitch
  const box: Box = { x: map.x + 8, y: map.y + 8, w, h }
  const ops: DrawOp[] = [
    { op: 'rect', ...box, fill: '#ffffff', stroke: { color: '#000000', width: 0.8 } },
    { op: 'text', x: box.x + pad, y: box.y + pad + titleSize, text: 'Legend', size: titleSize, color: '#000000' },
  ]
  rows.forEach(({ symbol }, i) => {
    const y = box.y + pad + titleSize * 1.4 + i * pitch + (pitch - swatch.h) / 2
    ops.push(...swatchOps(symbol, { x: box.x + pad, y, w: swatch.w, h: swatch.h }, 1))
    ops.push({
      op: 'text',
      x: box.x + pad + swatch.w + 6,
      y: y + swatch.h / 2,
      text: symbol.label,
      size,
      color: '#000000',
      baseline: 'middle',
    })
  })
  return { ops, box }
}

/**
 * The key map: the regional capture in its box, the sheet's ground outlined on it, a north arrow and the scale it is
 * drawn at; without a capture, an outlined box saying so.
 */
function keyMapOps(image: RasterImage | null, plan: ReportMapPlan, box: Box): DrawOp[] {
  const end = plan.endMap!
  const ops: DrawOp[] = [{ op: 'rect', ...box, fill: '#ffffff' }]
  if (image) {
    ops.push({ op: 'clip', parts: [rectRing(box.x, box.y, box.w, box.h)] })
    ops.push({ op: 'image', ...box, image })
    // The sheet's ground on the key map: its neat line's corners projected at the key map's scale.
    const keyScale = end.keyMap.scale
    const ratio = plan.sheet!.scale / keyScale
    const cx = box.x + box.w / 2,
      cy = box.y + box.h / 2
    const { map } = end.layout
    const w = map.w * ratio,
      h = map.h * ratio
    ops.push(...areaSymbolOps([rectRing(cx - w / 2, cy - h / 2, w, h)], S.keyMapArea, 1))
    ops.push({ op: 'restore' })
  } else
    ops.push({
      op: 'text',
      x: box.x + box.w / 2,
      y: box.y + box.h / 2,
      text: 'Key map not captured',
      size: 6,
      color: '#6e6e6e',
      align: 'center',
      baseline: 'middle',
    })
  // A north arrow in the key map's top-left corner, and the key map's scale under it.
  const ax = box.x + 9,
    ay = box.y + 6
  ops.push(
    {
      op: 'path',
      parts: [
        [
          [ax, ay],
          [ax + 4, ay + 13],
          [ax, ay + 10],
          [ax - 4, ay + 13],
        ],
      ],
      closed: true,
      fill: '#000000',
      stroke: { color: '#ffffff', width: 0.8, join: 'round' },
    },
    {
      op: 'text',
      x: ax,
      y: ay + 21,
      text: 'N',
      size: 6.5,
      style: 'bold',
      color: '#000000',
      align: 'center',
      halo: { color: '#ffffff', width: 1.6 },
    },
    {
      op: 'text',
      x: box.x + box.w - 3,
      y: box.y + box.h - 3,
      text: `Key map ${formatScale(end.keyMap.scale)}`,
      size: 5.5,
      color: '#000000',
      align: 'right',
      halo: { color: '#ffffff', width: 1.4 },
    },
    { op: 'rect', ...box, stroke: { color: '#000000', width: 0.8 } },
  )
  return ops
}
