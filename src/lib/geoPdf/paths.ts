import polygonClipping from 'polygon-clipping'
import type { MapFrame } from './georeference'
import { PDF_LIMITS, type Box, type Matrix, type XY } from './types'
import type { PdfLayerRule } from './profiles'

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
  unsupportedClip: boolean
}

export function extractPaths(
  list: Operators,
  ops: Record<string, number>,
  content: OptionalContent,
  frame: MapFrame,
  rules: PdfLayerRule[],
  limits = { maxFeatures: 500, maxVertices: 50_000 },
) {
  if (list.fnArray.length > PDF_LIMITS.operators) throw Error('The PDF page exceeds the drawing operation budget.')
  let state: State = { matrix: IDENTITY, clip: frame.bbox, unsupportedClip: false }
  const saves: State[] = [],
    groups: State[] = [],
    marks: { name: string; visible: boolean }[] = []
  const result = new Map<
    string,
    { rule: PdfLayerRule; features: GeoJSON.Feature[]; vertices: number; overBudget: boolean }
  >()
  let pendingClip = false,
    omittedClips = 0,
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
    else if (fn === ops.clip || fn === ops.eoClip) pendingClip = true
    else if (fn === ops.constructPath) {
      const data = (a[1] as ArrayLike<ArrayLike<number>>)?.[0]
      if (!data) {
        pendingClip = false
        continue
      }
      const name = [...marks].reverse().find((m) => rules.some((r) => r.match.test(m.name)))?.name
      const rule = name && rules.find((r) => r.match.test(name))
      if (!pendingClip && (!rule || marks.some((m) => !m.visible))) continue
      if (!pendingClip && name && result.get(name)?.overBudget) continue
      const paths = drawingPaths(data, state.matrix)
      if (pendingClip) {
        pendingClip = false
        const ring = paths[0] ?? [],
          box = ring.length ? boxOf(ring) : ([0, 0, 0, 0] as Box)
        const rectangular =
          paths.length === 1 &&
          ring.length === 5 &&
          same(ring[0], ring[4]) &&
          ring.every((p) => (p[0] === box[0] || p[0] === box[2]) && (p[1] === box[1] || p[1] === box[3]))
        if (rectangular) state.clip = intersectBox(state.clip, box)
        else state.unsupportedClip = true
        continue
      }
      if (!rule || !name || Number(a[0]) === ops.endPath) continue
      if (state.unsupportedClip) {
        omittedClips++
        continue
      }
      if (rule.contour) {
        // Filled paths in a contour layer are label halos, not lines of equal height.
        if (contourOverBudget || ![ops.stroke, ops.closeStroke].includes(Number(a[0]))) continue
        for (const line of paths.flatMap((p) => clipLines(p, state.clip))) {
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
      const entry = result.get(name) ?? { rule, features: [], vertices: 0, overBudget: false }
      const lines =
        rule.shape === 'line'
          ? paths.flatMap((p) => clipLines(p, state.clip).map((line) => line.map(frame.toWorld)))
          : []
      const geometries: GeoJSON.Geometry[] =
        rule.shape === 'line'
          ? rule.compound && lines.length > 1
            ? [{ type: 'MultiLineString', coordinates: lines }]
            : lines.map((coordinates) => ({ type: 'LineString', coordinates }))
          : state.clip[2] <= state.clip[0] || state.clip[3] <= state.clip[1]
            ? []
            : polygons(paths).flatMap((p) =>
                polygonClipping.intersection(p, [boxRing(state.clip)]).map((poly) => ({
                  type: 'Polygon' as const,
                  coordinates: poly.map((r) => r.map((xy) => frame.toWorld(xy as XY))),
                })),
              )
      for (const geometry of geometries) {
        const n =
          geometry.type === 'LineString'
            ? geometry.coordinates.length
            : (geometry as GeoJSON.Polygon | GeoJSON.MultiLineString).coordinates.reduce((s, r) => s + r.length, 0)
        vertices += n
        if (vertices > PDF_LIMITS.vertices)
          throw Error('The PDF map exceeds the extracted vertex budget. Import a simpler sheet or original GIS layers.')
        entry.vertices += n
        if (entry.vertices > limits.maxVertices || (!rule.compound && entry.features.length >= limits.maxFeatures)) {
          entry.overBudget = true
          entry.features = []
          break
        }
        entry.features.push({
          type: 'Feature',
          properties: { name: `${rule.name} ${entry.features.length + 1}` },
          geometry,
        })
      }
      result.set(name, entry)
    }
  }
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
  return { layers: result, omittedClips, contours, contourOverBudget }
}
