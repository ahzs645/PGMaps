import polygonClipping from 'polygon-clipping'
import type { MapFrame } from './georeference'
import { PDF_LIMITS, type Box, type Matrix, type XY } from './types'
import type { PdfLayerRule } from './profiles'
import {
  boxAgainstRegion,
  clipLineToRegion,
  clipRegionFromPaths,
  intersectRegions,
  prepareRegion,
  regionContains,
  type ClipRegion,
} from './clipRegion'
import {
  DRAWN_PAGE_VERTICES,
  THINNABLE_LAYER_VERTICES,
  thinLayer,
  type PageGeometry,
  type Thinning,
} from './thinDrawing'

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
export const transform = (m: Matrix, [x, y]: XY): XY => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
export const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]
const same = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7
const boxOf = (points: XY[]): Box => {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of points) {
    box[0] = Math.min(box[0], x)
    box[1] = Math.min(box[1], y)
    box[2] = Math.max(box[2], x)
    box[3] = Math.max(box[3], y)
  }
  return box
}
const intersectBox = (a: Box, b: Box): Box => [
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
  Math.min(a[2], b[2]),
  Math.min(a[3], b[3]),
]
const boxRing = ([l, b, r, t]: Box): XY[] => [
  [l, b],
  [r, b],
  [r, t],
  [l, t],
  [l, b],
]

function cubic(a: XY, b: XY, c: XY, d: XY, out: XY[], depth = 0) {
  const chord = Math.hypot(d[0] - a[0], d[1] - a[1])
  const deviation = (p: XY) =>
    chord
      ? Math.abs((d[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (d[1] - a[1])) / chord
      : Math.hypot(p[0] - a[0], p[1] - a[1])
  if (depth >= 12 || Math.max(deviation(b), deviation(c)) <= 0.1) {
    if (out.length >= PDF_LIMITS.vertices) throw Error('The PDF drawing exceeds the vertex budget.')
    out.push(d)
    return
  }
  const mid = (x: XY, y: XY): XY => [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2]
  const ab = mid(a, b),
    bc = mid(b, c),
    cd = mid(c, d),
    abc = mid(ab, bc),
    bcd = mid(bc, cd),
    centre = mid(abc, bcd)
  cubic(a, ab, abc, centre, out, depth + 1)
  cubic(centre, bcd, cd, d, out, depth + 1)
}

/** PDF.js 6 DrawOPS, from its pinned public operator list. Curves flatten within 0.1 page point. */
export function drawingPaths(data: ArrayLike<number>, matrix: Matrix): XY[][] {
  const paths: XY[][] = []
  let path: XY[] = []
  let vertices = 0
  const point = (i: number) => {
    const p = transform(matrix, [data[i], data[i + 1]])
    if (!p.every(Number.isFinite)) throw Error('The PDF contains invalid drawing coordinates.')
    return p
  }
  for (let i = 0; i < data.length; ) {
    const op = data[i++]
    const previousLength = path.length
    if (op === 0) {
      path = [point(i)]
      paths.push(path)
      i += 2
    } else if (op === 1 && path.length) {
      path.push(point(i))
      i += 2
    } else if (op === 2 && path.length) {
      cubic(path.at(-1)!, point(i), point(i + 2), point(i + 4), path)
      i += 6
    } else if (op === 3 && path.length) {
      const a = path.at(-1)!,
        b = point(i),
        c = point(i + 2)
      cubic(
        a,
        [a[0] + ((b[0] - a[0]) * 2) / 3, a[1] + ((b[1] - a[1]) * 2) / 3],
        [c[0] + ((b[0] - c[0]) * 2) / 3, c[1] + ((b[1] - c[1]) * 2) / 3],
        c,
        path,
      )
      i += 4
    } else if (op === 4 && path.length) {
      if (!same(path[0], path.at(-1)!)) path.push(path[0])
    } else throw Error('Unsupported PDF drawing path; no geometry imported from this page.')
    vertices += op === 0 ? 1 : path.length - previousLength
    if (vertices > PDF_LIMITS.vertices) throw Error('The PDF drawing exceeds the vertex budget.')
  }
  return paths
}

/** Liang–Barsky: clip each segment, keeping gaps as separate paths instead of inventing joins. */
export function clipLines(path: XY[], box: Box): XY[][] {
  const out: XY[][] = []
  let current: XY[] = []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      dx = b[0] - a[0],
      dy = b[1] - a[1]
    let low = 0,
      high = 1,
      valid = box[2] > box[0] && box[3] > box[1]
    for (const [p, q] of [
      [-dx, a[0] - box[0]],
      [dx, box[2] - a[0]],
      [-dy, a[1] - box[1]],
      [dy, box[3] - a[1]],
    ]) {
      if (p === 0) {
        if (q < 0) valid = false
        continue
      }
      if (p < 0) low = Math.max(low, q / p)
      else high = Math.min(high, q / p)
    }
    if (!valid || low > high) {
      current = []
      continue
    }
    const from: XY = [a[0] + low * dx, a[1] + low * dy],
      to: XY = [a[0] + high * dx, a[1] + high * dy]
    if (same(from, to)) continue
    if (!current.length || !same(current.at(-1)!, from)) {
      current = [from]
      out.push(current)
    }
    current.push(to)
    if (high < 1) current = []
  }
  return out
}

function contains(ring: XY[], p: XY) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j]
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
/** Rings of a drawing retain holes; nested islands are independent polygons. */
function polygons(paths: XY[][]): XY[][][] {
  const rings = paths.filter((p) => p.length >= 4 && same(p[0], p.at(-1)!))
  const area = (p: XY[]) =>
    Math.abs(
      p.reduce((s, a, i) => {
        const b = p[(i + 1) % p.length]
        return s + a[0] * b[1] - b[0] * a[1]
      }, 0),
    )
  const sorted = rings.sort((a, b) => area(b) - area(a))
  const depths = sorted.map((p, i) => sorted.slice(0, i).filter((r) => contains(r, p[0])).length)
  return sorted.flatMap((r, i) =>
    depths[i] % 2 ? [] : [[r, ...sorted.filter((hole, j) => depths[j] === depths[i] + 1 && contains(r, hole[0]))]],
  )
}

type Operators = { fnArray: number[]; argsArray: unknown[][] }
type OptionalContent = { getGroup(id: string): { name: string } | null; isVisible(group: unknown): boolean }
interface State {
  matrix: Matrix
  clip: Box
  /** A clip that is not an axis-aligned rectangle, intersected with every such clip before it. */
  region?: ClipRegion
  unsupportedClip: boolean
  /** Inside the map frame's own clip: where a map draws its layers, and layout elements are not. */
  inMap: boolean
}

/** A rectangular clip that is the registered map frame, within 2% of its area. */
function isFrameClip(box: Box, frame: Box) {
  const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
  const whole = area(frame)
  return whole > 0 && area(intersectBox(box, frame)) >= 0.98 * whole && area(box) <= 1.02 * whole
}

/**
 * A hatch line is drawn across its area's whole box and left to the clip: both its ends lie outside
 * the region. A line of the map's own clipped to a region (a road at an operating area's edge)
 * rarely runs past it at both ends in one straight stroke, and `isHatch` asks for more than one.
 */
const isHatchStroke = ([a, b]: XY[], region: ClipRegion) => !regionContains(region, a) && !regionContains(region, b)
/** Directions a hatch may differ by and still be one family of parallel strokes, in degrees. */
const HATCH_PARALLEL_DEGREES = 0.5
/**
 * Strokes are a hatch when they are at least two and fall into one or two families of parallel
 * lines (a hatch or a cross-hatch), each of at least two. A lone straight stroke stays a line.
 */
function isHatch(segments: XY[][]) {
  const angles = segments
    .map(([a, b]) => ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 180) % 180)
    .sort((x, y) => x - y)
  const families: number[] = []
  for (const [i, angle] of angles.entries())
    if (i && angle - angles[i - 1] <= HATCH_PARALLEL_DEGREES) families[families.length - 1]++
    else families.push(1)
  // A family that straddles 0°/180° is one family.
  if (families.length > 1 && angles[0] + 180 - angles.at(-1)! <= HATCH_PARALLEL_DEGREES) families[0] += families.pop()!
  return angles.length >= 2 && families.length <= 2 && families.every((n) => n >= 2)
}

const PAGE_OVER = 'The PDF map exceeds the extracted vertex budget. Import a simpler sheet or original GIS layers.'

export function extractPaths(
  list: Operators,
  ops: Record<string, number>,
  content: OptionalContent,
  frame: MapFrame,
  rules: PdfLayerRule[],
  limits = { maxFeatures: 500, maxVertices: 50_000 },
) {
  if (list.fnArray.length > PDF_LIMITS.operators) throw Error('The PDF page exceeds the drawing operation budget.')
  let state: State = { matrix: IDENTITY, clip: frame.bbox, unsupportedClip: false, inMap: false }
  /** The parts of a path inside a rectangular clip and, when the drawing crosses one, a clip region. */
  const clipPath = (path: XY[], clip: Box, region: ClipRegion | undefined) => {
    const lines = clipLines(path, clip)
    return region ? lines.flatMap((line) => clipLineToRegion(line, region)) : lines
  }
  const drawnGeometries = (
    paths: XY[][],
    rule: PdfLayerRule,
    shape: 'line' | 'polygon',
    clip: Box,
    region: ClipRegion | undefined,
  ): PageGeometry[] => {
    if (shape === 'line') {
      const lines = paths.flatMap((p) => clipPath(p, clip, region))
      return rule.compound && lines.length > 1
        ? [{ type: 'MultiLineString', coordinates: lines }]
        : lines.map((coordinates) => ({ type: 'LineString', coordinates }))
    }
    if (clip[2] <= clip[0] || clip[3] <= clip[1]) return []
    return polygons(paths).flatMap((p) =>
      (region
        ? polygonClipping.intersection(p, [boxRing(clip)], region.polygons)
        : polygonClipping.intersection(p, [boxRing(clip)])
      ).map((poly) => ({ type: 'Polygon' as const, coordinates: poly as XY[][] })),
    )
  }
  const saves: State[] = [],
    groups: State[] = [],
    marks: { name: string; visible: boolean }[] = []
  // Keyed by the PDF layer's name; an `as-painted` layer's lines and areas are two entries.
  const result = new Map<
    string,
    {
      rule: PdfLayerRule
      layer: string
      shape: 'line' | 'polygon'
      /** Page-point geometry as drawn; the features are built from it once the page is read. */
      geometries: PageGeometry[]
      features: GeoJSON.Feature[]
      vertices: number
      overBudget: boolean
      /** Why it was left on the sheet: over the layer budget even thinned, or over the page's. */
      refused?: 'layer' | 'page'
      /** Share of the layer's length or area thinning would have had to leave out. */
      refusedShare?: number
      thinning?: Thinning
    }
  >()
  type Entry = typeof result extends Map<string, infer E> ? E : never
  const collect = (
    key: string,
    name: string,
    rule: PdfLayerRule,
    shape: 'line' | 'polygon',
    geometries: PageGeometry[],
  ) => {
    const entry: Entry = result.get(key) ?? {
      rule,
      layer: name,
      shape,
      geometries: [],
      features: [],
      vertices: 0,
      overBudget: false,
    }
    if (entry.overBudget) return
    for (const geometry of geometries) {
      const n =
        geometry.type === 'LineString'
          ? geometry.coordinates.length
          : geometry.coordinates.reduce((s, r) => s + r.length, 0)
      vertices += n
      entry.vertices += n
      // The generic profile reads every named layer, base maps included: one too large for the
      // page is left on the sheet like a layer over its own budget, not the whole import.
      const pageOver = vertices > DRAWN_PAGE_VERTICES
      if (pageOver && rule.shape !== 'as-painted') throw Error(PAGE_OVER)
      // Past the layer budget a layer is still collected, up to what thinning can bring back
      // within it (`thinLayer`, once the page is read).
      if (pageOver || entry.vertices > THINNABLE_LAYER_VERTICES) {
        entry.overBudget = true
        entry.refused = pageOver ? 'page' : 'layer'
        if (rule.shape === 'as-painted') vertices -= entry.vertices
        entry.geometries = []
        break
      }
      entry.geometries.push(geometry)
    }
    result.set(key, entry)
  }
  /** Straight strokes a layer drew under a clip region, by region and layer: a hatch fill, or lines. */
  const hatches = new Map<
    ClipRegion,
    Map<string, { rule: PdfLayerRule; segments: { segments: XY[][]; clip: Box }[]; strokes: number; fills: number }>
  >()
  const filled = new Set([
    ops.fill,
    ops.eoFill,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke,
  ])
  let pendingClip: number | false = false,
    omittedClips = 0,
    outsideMap = 0,
    vertices = 0,
    contourVertices = 0,
    contourOverBudget = false
  const contours: XY[][] = []
  const save = () => ({ ...state, matrix: [...state.matrix] as Matrix })
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i],
      a = list.argsArray[i] ?? []
    if (fn === ops.save || fn === ops.paintFormXObjectBegin) {
      saves.push(save())
      if (fn === ops.paintFormXObjectBegin && a[0]) state.matrix = multiply(state.matrix, a[0] as Matrix)
      if (fn === ops.paintFormXObjectBegin && a[1])
        state.clip = intersectBox(
          state.clip,
          boxOf(boxRing(Array.from(a[1] as ArrayLike<number>) as Box).map((p) => transform(state.matrix, p))),
        )
    } else if (fn === ops.restore || fn === ops.paintFormXObjectEnd) state = saves.pop() ?? state
    else if (fn === ops.beginGroup) {
      groups.push(save())
      const g = a[0] as { matrix?: Matrix }
      if (g.matrix) state.matrix = multiply(state.matrix, g.matrix)
    } else if (fn === ops.endGroup) state = groups.pop() ?? state
    else if (fn === ops.transform) state.matrix = multiply(state.matrix, a as Matrix)
    else if (fn === ops.beginMarkedContent || fn === ops.beginMarkedContentProps) {
      const group = a[1] as { type?: string; id?: string } | undefined
      marks.push({
        name: group?.id ? (content.getGroup(group.id)?.name ?? '') : '',
        visible: a[0] !== 'OC' || content.isVisible(group),
      })
    } else if (fn === ops.endMarkedContent) marks.pop()
    else if (fn === ops.clip || fn === ops.eoClip) pendingClip = fn
    else if (fn === ops.constructPath) {
      const data = (a[1] as ArrayLike<ArrayLike<number>>)?.[0]
      if (!data) {
        pendingClip = false
        continue
      }
      const name = [...marks].reverse().find((m) => rules.some((r) => r.match.test(m.name)))?.name
      const rule = name && rules.find((r) => r.match.test(name))
      if (pendingClip === false && (!rule || marks.some((m) => !m.visible))) continue
      const shape: 'line' | 'polygon' | undefined = !rule
        ? undefined
        : rule.shape === 'as-painted'
          ? filled.has(Number(a[0]))
            ? 'polygon'
            : 'line'
          : rule.shape
      const key = rule && rule.shape === 'as-painted' ? `${name}\u0000${shape}` : name
      if (pendingClip === false && key && result.get(key)?.overBudget) continue
      const paths = drawingPaths(data, state.matrix)
      if (pendingClip !== false) {
        const evenOdd = pendingClip === ops.eoClip
        pendingClip = false
        const ring = paths[0] ?? [],
          box = ring.length ? boxOf(ring) : ([0, 0, 0, 0] as Box)
        const rectangular =
          paths.length === 1 &&
          ring.length === 5 &&
          same(ring[0], ring[4]) &&
          ring.every((p) => (p[0] === box[0] || p[0] === box[2]) && (p[1] === box[1] || p[1] === box[3]))
        if (rectangular && isFrameClip(box, frame.bbox)) state.inMap = true
        if (rectangular) state.clip = intersectBox(state.clip, box)
        else if (!state.unsupportedClip) {
          // An outline clip (an operating area, the frame less its label masks): drawings under it
          // are clipped to it. Only a clip whose region cannot be stated exactly leaves them out.
          const region = clipRegionFromPaths(paths, evenOdd)
          if (region)
            state.region = prepareRegion(state.region ? intersectRegions(state.region.polygons, region) : region)
          else state.unsupportedClip = true
        }
        continue
      }
      if (!rule || !name || !key || !shape || Number(a[0]) === ops.endPath) continue
      // The generic profile knows no layer names, so it tells the map's drawings from a legend,
      // scale bar or title box laid over the map by the clip the exporter draws the map under.
      if (rule.shape === 'as-painted' && !state.inMap) {
        outsideMap++
        continue
      }
      if (state.unsupportedClip) {
        omittedClips++
        continue
      }
      if (rule.shape === 'as-painted' && state.region && !rule.contour) {
        const layers = hatches.get(state.region) ?? new Map()
        hatches.set(state.region, layers)
        const group = layers.get(name) ?? { rule, segments: [], strokes: 0, fills: 0 }
        layers.set(name, group)
        if (shape === 'line' && paths.every((p) => p.length === 2 && isHatchStroke(p, state.region!))) {
          group.segments.push({ segments: paths, clip: state.clip })
          continue
        }
        if (shape === 'line') group.strokes++
        else group.fills++
      }
      // A drawing wholly outside the clip region is clipped away; wholly inside, it needs no cut.
      const against = state.region ? boxAgainstRegion(state.region, boxOf(paths.flat())) : 'inside'
      if (against === 'outside') continue
      const region = against === 'across' ? state.region : undefined
      if (rule.contour) {
        // Filled paths in a contour layer are label halos, not lines of equal height.
        if (contourOverBudget || ![ops.stroke, ops.closeStroke].includes(Number(a[0]))) continue
        for (const line of paths.flatMap((p) => clipPath(p, state.clip, region))) {
          contourVertices += line.length
          if (contourVertices > PDF_LIMITS.contourVertices) {
            contourOverBudget = true
            contours.length = 0
            break
          }
          contours.push(line)
        }
        continue
      }
      // A fill closes every subpath, so a painted area is a ring even where the path leaves it open.
      if (rule.shape === 'as-painted' && shape === 'polygon')
        for (const p of paths) if (p.length >= 3 && !same(p[0], p.at(-1)!)) p.push(p[0])
      collect(key, name, rule, shape, drawnGeometries(paths, rule, shape, state.clip, region))
    }
  }
  // A clip region a layer drew only straight strokes across is a hatched area: the region is the
  // area the sheet shows, and the strokes are its fill pattern. Anything else under it stays lines.
  let hatchedAreas = 0
  for (const [region, layers] of hatches)
    for (const [name, group] of layers) {
      if (group.strokes || !isHatch(group.segments.flatMap((s) => s.segments))) {
        for (const { segments, clip } of group.segments)
          collect(
            `${name}\u0000line`,
            name,
            group.rule,
            'line',
            drawnGeometries(segments, group.rule, 'line', clip, region),
          )
        continue
      }
      // A layer that also filled the region has its area already; the strokes are only its pattern.
      if (group.fills) continue
      const clip = group.segments[0].clip
      if (clip[2] <= clip[0] || clip[3] <= clip[1]) continue
      const areas = polygonClipping.intersection(region.polygons, [boxRing(clip)])
      hatchedAreas += areas.length
      collect(
        `${name}\u0000polygon`,
        name,
        group.rule,
        'polygon',
        areas.map((poly) => ({ type: 'Polygon', coordinates: poly as XY[][] })),
      )
    }
  // Thin each layer over its budget to the sheet's own detail, refusing one that cannot fit.
  const pointsPerMm = 72 / 25.4
  for (const entry of result.values()) {
    if (entry.overBudget) continue
    const over =
      entry.vertices > limits.maxVertices || (!entry.rule.compound && entry.geometries.length > limits.maxFeatures)
    if (!over) continue
    const thin = thinLayer(entry.geometries, entry.shape, limits, { compound: entry.rule.compound, pointsPerMm })
    if (!('thinning' in thin)) {
      entry.overBudget = true
      entry.refused = 'layer'
      entry.refusedShare = thin.leftOutShare
      entry.geometries = []
      continue
    }
    entry.geometries = thin.geometries
    entry.thinning = thin.thinning
  }
  // The page's budget holds what is kept, after thinning.
  let kept = 0
  for (const entry of result.values()) {
    if (entry.overBudget) continue
    const n = entry.geometries.reduce(
      (s, g) => s + (g.type === 'LineString' ? g.coordinates.length : g.coordinates.reduce((t, r) => t + r.length, 0)),
      0,
    )
    kept += n
    if (kept <= PDF_LIMITS.vertices) continue
    if (entry.rule.shape !== 'as-painted') throw Error(PAGE_OVER)
    kept -= n
    entry.overBudget = true
    entry.refused = 'page'
    entry.geometries = []
    entry.thinning = undefined
  }
  for (const entry of result.values())
    entry.features = entry.geometries.map((geometry, i) => ({
      type: 'Feature',
      properties: { name: `${entry.rule.name} ${i + 1}` },
      geometry:
        geometry.type === 'Polygon' || geometry.type === 'MultiLineString'
          ? ({
              type: geometry.type,
              coordinates: geometry.coordinates.map((r) => r.map(frame.toWorld)),
            } as GeoJSON.Geometry)
          : { type: 'LineString', coordinates: geometry.coordinates.map(frame.toWorld) },
    }))
  for (const entry of result.values()) {
    if (!entry.rule.compound || entry.overBudget || !entry.features.length) continue
    // A PDF layer has drawing paths, not GIS record boundaries. Keep the layer together rather
    // than presenting every dash/branch as a separate stream or inventing joins between them.
    const coordinates = entry.features.flatMap((f) =>
      f.geometry.type === 'LineString' ? [f.geometry.coordinates] : (f.geometry as GeoJSON.MultiLineString).coordinates,
    )
    entry.features = [
      {
        type: 'Feature',
        properties: { name: `${entry.rule.name} · recovered drawing paths` },
        geometry: { type: 'MultiLineString', coordinates },
      },
    ]
  }
  return { layers: result, omittedClips, outsideMap, hatchedAreas, contours, contourOverBudget }
}
