/**
 * What is drawn over an own photo, as one list of drawing operations (`drawOps.ts`): the features each photo layer
 * holds (`photoLayers.ts`), split into what the camera sees and what nearer ground hides (`photoOverlay.ts`), the
 * terrain's skyline, the reading aids and the labels. The window and the docked pane draw the list as one SVG
 * (`sheetSvg`), so the photo is drawn with the same shared symbols, the same label placement (`labelOps`) and the same
 * renderer as the analysis sheet. See docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.3.
 *
 * The list is in sheet points across a frame `PHOTO_SYMBOL_REFERENCE_WIDTH_POINTS` wide, the width the figure styles'
 * symbol sizes were measured at, so a stroke is the same share of the picture on the photo as on the sheet. Photo
 * pixels come in and are scaled down to it.
 *
 * Also the features themselves: the scene's (blocks, openings, landform, private land, views of interest), the
 * features check's reads, and any the page adds; and the polygon layers a click on the photo names.
 *
 * Free of DOM and network access.
 */
import { textOps, labelOps, type FigureLabel } from '@/lib/mapSheet/callouts'
import type { DrawOp, Point } from '@/lib/mapSheet/drawOps'
import { pointSymbolOps, type LineSymbol } from '@/lib/mapSheet/symbols'

import type { PhotoFeature, PhotoFeaturePaths, BearingTick, DistanceContour } from './photoOverlay'
import { PHOTO_FEATURE_SOURCES, type Box, type PhotoFeatureReads } from './photoFeatures'
import {
  PHOTO_SYMBOL_REFERENCE_WIDTH_POINTS,
  photoLayer,
  photoLayerSymbol,
  photoStrokes,
  type PhotoLayerId,
} from './photoLayers'
import { preparePickLayer, type PhotoPickLayer } from './photoPick'
import type { ForestryScene } from './scene'
import type { PolygonGeometry } from './visibility'

/** A feature as drawn, with the properties its layer chooses a symbol by. */
export type DrawnFeature = { paths: PhotoFeaturePaths; properties?: Record<string, unknown> }

export type PhotoDrawInput = {
  photoWidth: number
  photoHeight: number
  visibility: Record<PhotoLayerId, boolean>
  /** The figure style the scene's roles take; the default style's when absent. */
  styleId?: string | null
  /** The terrain's skyline in photo pixels; a null breaks it. */
  skyline?: ReadonlyArray<{ x: number; y: number } | null> | null
  /** Features as `photoOverlay` drew them, each with its properties. */
  features?: readonly DrawnFeature[]
  aids?: { horizon?: string | null; ticks?: readonly BearingTick[]; contours?: readonly DistanceContour[] }
  /** Name the proposed blocks and the other named features. */
  labels?: boolean
  /** Strokes and type this many times their sheet size: a small pane draws them heavier to stay legible. */
  emphasis?: number
  /**
   * Sheet points one screen pixel covers where the drawing is shown; lines are simplified to about that and segments
   * shorter are dropped (`simplifyPart`). Default 1: the window shows the 900-point frame at roughly its size.
   */
  pixelPoints?: number
}

export type PhotoDraw = {
  ops: DrawOp[]
  /** The frame the operations are in, sheet points. */
  width: number
  height: number
  /** Labels that found no room. */
  droppedLabels: number
}

/** Sheet points per photo pixel. */
export const photoDrawScale = (photoWidth: number) => PHOTO_SYMBOL_REFERENCE_WIDTH_POINTS / photoWidth

/** The point lists in SVG path data ("M x yL x y…"), as `photoOverlay`'s aids return them. */
export function partsFromPathData(d: string): Point[][] {
  const parts: Point[][] = []
  for (const match of d.matchAll(/([ML])\s*(-?[\d.]+(?:e-?\d+)?)[ ,](-?[\d.]+(?:e-?\d+)?)/gi)) {
    const point: Point = [Number(match[2]), Number(match[3])]
    if (match[1].toUpperCase() === 'M' || !parts.length) parts.push([point])
    else parts[parts.length - 1].push(point)
  }
  return parts.filter((part) => part.length > 1)
}

/** The skyline as runs between its gaps. */
function skylineRuns(skyline: ReadonlyArray<{ x: number; y: number } | null>): Point[][] {
  const runs: Point[][] = []
  let run: Point[] = []
  for (const point of skyline) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      if (run.length > 1) runs.push(run)
      run = []
      continue
    }
    run.push([point.x, point.y])
  }
  if (run.length > 1) runs.push(run)
  return runs
}

const scaleParts = (parts: readonly Point[][], s: number): Point[][] =>
  parts.map((part) => part.map(([x, y]) => [x * s, y * s] as Point))

/**
 * A line kept to about `tolerance` of where it was: points nearer the last kept one than half of it go (a terrain-
 * following edge is traced every few photo pixels, far finer than the screen shows), then Douglas–Peucker at half of
 * it. Unsimplified, a lakeshore and cutblock overlay ran to megabytes of SVG for nothing the eye can see.
 */
export function simplifyPart(part: readonly Point[], tolerance: number): Point[] {
  if (part.length < 3 || !(tolerance > 0)) return [...part]
  const half = tolerance / 2
  const near: Point[] = [part[0]]
  for (let i = 1; i < part.length - 1; i++) {
    const [x, y] = part[i],
      [lx, ly] = near[near.length - 1]
    if (Math.hypot(x - lx, y - ly) >= half) near.push(part[i])
  }
  near.push(part[part.length - 1])
  if (near.length < 3) return near
  const keep = new Uint8Array(near.length)
  keep[0] = keep[near.length - 1] = 1
  const stack: Array<[number, number]> = [[0, near.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = near[a],
      [bx, by] = near[b]
    const dx = bx - ax,
      dy = by - ay,
      length = Math.hypot(dx, dy)
    let worst = -1,
      at = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = near[i]
      // Distance to the chord; to the end point when the chord has no length (a closed ring's two ends).
      const d = length ? Math.abs((px - ax) * dy - (py - ay) * dx) / length : Math.hypot(px - ax, py - ay)
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (worst > half) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return near.filter((_, i) => keep[i])
}

/** Every run simplified, and runs shorter than `tolerance` dropped: a sub-pixel run draws nothing anyone can see. */
const simplifyParts = (parts: Point[][], tolerance: number) =>
  parts
    .map((part) => simplifyPart(part, tolerance))
    .filter((part) => {
      let length = 0
      for (let i = 1; i < part.length && length < tolerance; i++)
        length += Math.hypot(part[i][0] - part[i - 1][0], part[i][1] - part[i - 1][1])
      return length >= tolerance
    })

/** Every stroke of a symbol along parts, dotted when hidden. */
function strokeOps(parts: Point[][], symbol: Parameters<typeof photoStrokes>[0], k: number, hidden: boolean) {
  if (!parts.length) return []
  return photoStrokes(symbol, k, hidden).map((stroke): DrawOp => ({ op: 'path', parts, closed: false, stroke }))
}

/** Layers whose features are named on the photo, and whether as the leading label. */
const LABELLED: Partial<Record<PhotoLayerId, 'primary' | 'secondary'>> = {
  proposedBlocks: 'primary',
  landform: 'secondary',
  viewsOfInterest: 'secondary',
  sensitivityUnits: 'secondary',
}

/** The operations for everything turned on, aids at the bottom, the skyline over the features, labels on top. */
export function photoDrawOps(input: PhotoDrawInput): PhotoDraw {
  const s = photoDrawScale(input.photoWidth)
  const width = PHOTO_SYMBOL_REFERENCE_WIDTH_POINTS
  const height = input.photoHeight * s
  const k = input.emphasis ?? 1
  const on = input.visibility
  const ops: DrawOp[] = []
  const tolerance = input.pixelPoints ?? 1
  /** A feature's or the skyline's runs in sheet points, simplified to about a screen pixel. */
  const fit = (parts: readonly Point[][]) => simplifyParts(scaleParts(parts, s), tolerance)

  // Reading aids: under everything, so a feature is never hidden by a guide.
  if (on.horizon && input.aids?.horizon) {
    const symbol = photoLayerSymbol('horizon')
    ops.push(...strokeOps(scaleParts(partsFromPathData(input.aids.horizon), s), symbol, k, false))
  }
  if (on.distanceContours && input.aids?.contours) {
    const symbol = photoLayerSymbol('distanceContours') as LineSymbol
    const [halo, ink] = symbol.layers
    for (const contour of input.aids.contours) {
      ops.push(...strokeOps(fit(contour.parts), symbol, k, false))
      if (contour.labelAnchor)
        ops.push(
          ...textOps(
            contour.labelAnchor.x * s,
            contour.labelAnchor.y * s - 3 * k,
            `${contour.meters / 1000} km`,
            { size: 7 * k, color: ink.color, halo: { color: halo.color, width: 1.6 * k } },
            'center',
          ),
        )
    }
  }
  if (on.bearingTicks && input.aids?.ticks) {
    const symbol = photoLayerSymbol('bearingTicks') as LineSymbol
    const [halo, ink] = symbol.layers
    for (const tick of input.aids.ticks) {
      const major = Math.round(tick.bearing) % 10 === 0
      const length = (major ? 10 : 5) * k
      const x = tick.x * s,
        y = tick.y * s
      const end: Point = [x + tick.up[0] * length, y + tick.up[1] * length]
      ops.push(...strokeOps([[[x, y], end]], symbol, k, false))
      if (major)
        ops.push(
          ...textOps(
            end[0] + tick.up[0] * 3 * k,
            end[1] + tick.up[1] * 3 * k,
            tick.label,
            { size: 7 * k, color: ink.color, halo: { color: halo.color, width: 1.6 * k } },
            'center',
            'middle',
          ),
        )
    }
  }

  // Features: areas and lines by their layer's symbol, hidden runs dotted; markers in sight. A layer's features drawn
  // with the same stroke go out as one path, casings under inks as a map draws them: one path a feature carried its
  // own attributes, and a forest-cover layer seen from the air ran to thousands of them.
  const labels: FigureLabel[] = []
  const lineGroups = new Map<string, Map<string, { stroke: Extract<DrawOp, { op: 'path' }>; level: number }>>()
  const markers: DrawOp[] = []
  const group = (key: string, made: DrawOp[]) => {
    const strokes = lineGroups.get(key) ?? new Map()
    lineGroups.set(key, strokes)
    made.forEach((op, level) => {
      if (op.op !== 'path') return
      const id = `${level}|${JSON.stringify(op.stroke)}`
      const held = strokes.get(id)
      if (held) held.stroke.parts.push(...op.parts)
      else strokes.set(id, { stroke: { ...op, parts: [...op.parts] }, level })
    })
  }
  for (const { paths, properties } of input.features ?? []) {
    const layer = paths.layer as PhotoLayerId
    if (!on[layer]) continue
    const symbol = photoLayerSymbol(layer, properties ?? {}, input.styleId)
    group(`${layer}|hidden`, strokeOps(fit(paths.hiddenParts), symbol, k, true))
    group(`${layer}|seen`, strokeOps(fit(paths.visibleParts), symbol, k, false))
    if (symbol.kind === 'point')
      for (const marker of paths.markers)
        if (marker.visible) markers.push(...pointSymbolOps(symbol, marker.x * s, marker.y * s, k))
    const role = LABELLED[layer]
    if (input.labels && role && paths.label && paths.labelAnchor)
      labels.push({
        title: paths.label,
        anchor: [paths.labelAnchor.x * s, paths.labelAnchor.y * s],
        ...(role === 'secondary' ? { secondary: true } : {}),
      })
  }

  for (const strokes of lineGroups.values())
    ops.push(...[...strokes.values()].sort((a, b) => a.level - b.level).map((entry) => entry.stroke))
  ops.push(...markers)

  // The skyline last of the lines: it is what a camera is judged by first.
  const runs = on.skyline && input.skyline ? fit(skylineRuns(input.skyline)) : []
  if (runs.length) ops.push(...strokeOps(runs, photoLayerSymbol('skyline'), k, false))

  let droppedLabels = 0
  if (labels.length) {
    // Labels sit above the skyline over their anchor, as the analysis sheet puts them.
    const ceilingAt = (x: number) => {
      let best = Infinity
      for (const run of runs)
        for (let i = 1; i < run.length; i++) {
          const [x0, y0] = run[i - 1],
            [x1, y1] = run[i]
          if ((x - x0) * (x - x1) > 0 || x0 === x1) continue
          best = Math.min(best, y0 + ((y1 - y0) * (x - x0)) / (x1 - x0))
        }
      return best
    }
    const margin = 6 * k
    const placed = labelOps(labels, {
      style: 'halo',
      area: { x: margin, y: margin, w: width - 2 * margin, h: height - 2 * margin },
      maxWidth: width * 0.28,
      gap: 16 * k,
      ...(runs.length ? { ceilingAt } : {}),
    })
    ops.push(...placed.ops)
    droppedLabels = placed.dropped
  }
  return { ops, width, height, droppedLabels }
}

// ---------------------------------------------------------------- the features

const polygonal = (geometry: GeoJSON.Geometry): geometry is PolygonGeometry =>
  geometry.type === 'Polygon' || geometry.type === 'MultiPolygon'

/** Features the page adds for layers the photo cannot read itself (inventory, candidates, viewpoints). */
export type PhotoExtraFeatures = Partial<Record<PhotoLayerId, readonly PhotoFeature[]>>

/** Which features each layer holds: from the scene, from the features check's reads, and from the page. */
export function photoOverlayFeatures(
  scene: Pick<ForestryScene, 'targets' | 'masks' | 'viewsOfInterest'> | null | undefined,
  reads: Partial<PhotoFeatureReads> | null | undefined,
  extras: PhotoExtraFeatures = {},
): PhotoFeature[] {
  const features: PhotoFeature[] = []
  for (const target of scene?.targets ?? []) {
    const layer: PhotoLayerId =
      target.role === 'block' ? 'proposedBlocks' : target.role === 'harvested' ? 'openings' : 'landform'
    features.push({ layer, id: target.id, label: target.name, geometry: target.geometry })
  }
  for (const mask of scene?.masks ?? [])
    if (mask.kind === 'private')
      features.push({ layer: 'privateLand', id: mask.id, label: mask.name, geometry: mask.geometry })
  for (const view of scene?.viewsOfInterest ?? [])
    features.push({
      layer: 'viewsOfInterest',
      id: view.id,
      label: view.name,
      geometry: { type: 'Point', coordinates: [view.lng, view.lat] },
    })
  for (const source of PHOTO_FEATURE_SOURCES) {
    const read = reads?.[source.id]
    if (read?.status !== 'ready') continue
    for (const feature of read.collection.features) {
      if (!feature.geometry) continue
      const properties: Record<string, unknown> = {
        ...(feature.properties ?? {}),
        ...(source.id === 'wetlands' ? { kind: 'wetland' } : source.id === 'lakes' ? { kind: 'lake' } : {}),
      }
      const name = properties.GNIS_NAME_1 ?? properties.GNIS_NAME ?? properties.ROAD_SECTION_NAME
      features.push({
        layer: source.photoLayer,
        ...(feature.id !== undefined ? { id: feature.id } : {}),
        ...(typeof name === 'string' && name ? { label: name } : {}),
        properties,
        geometry: feature.geometry,
      })
    }
  }
  for (const [layer, list] of Object.entries(extras) as Array<[PhotoLayerId, readonly PhotoFeature[]]>)
    for (const feature of list) features.push({ ...feature, layer })
  return features
}

/**
 * The polygon layers a click on the photo names, prepared once (`preparePolygons`, never a point test in a loop):
 * only layers that are pickable and drawn as areas, and only parts inside the ground the camera sees.
 */
export function photoPickLayers(features: readonly PhotoFeature[], within?: Box | null): PhotoPickLayer[] {
  const byLayer = new Map<string, Array<{ id?: string | number; label?: string; geometry: PolygonGeometry }>>()
  for (const feature of features) {
    const layer = photoLayer(feature.layer as PhotoLayerId)
    if (!layer.pickable || layer.geometry !== 'area' || !polygonal(feature.geometry)) continue
    const list = byLayer.get(layer.id) ?? []
    list.push({
      ...(feature.id !== undefined ? { id: feature.id } : {}),
      ...(feature.label !== undefined ? { label: feature.label } : {}),
      geometry: feature.geometry,
    })
    byLayer.set(layer.id, list)
  }
  return [...byLayer].map(([id, list]) => preparePickLayer(id, list, within ?? undefined))
}
