/**
 * Preliminary road geometry and quantities. No DOM, network or rendered-map
 * elevations: every sample comes from the supplied, fixed terrain source.
 *
 * Formation elevations and horizontal chainage are metres. Side slopes are H:V.
 * Quantities use average end areas; mass is compacted available cut minus fill.
 * They are covered subtotals, never estimates silently bridged across DEM holes.
 */
import { checkVerticalDesign } from './verticalStandards'
import type {
  Alignment,
  CableAnalysis,
  CableLine,
  ContextFeature,
  Coordinate,
  Crossing,
  RoadAnalysis,
  RoadSettings,
  RoadStation,
  SectionSample,
  TerrainSource,
  VerticalPoint,
} from './types'
import {
  engineeringKnots,
  sectionCrossfall,
  sideValue,
  templateAt,
  validateEngineering,
  validateTemplate,
} from './templates'
import { calculateEngineering } from './engineering'
import { resolvedCableLine } from './cableGeometry'

const R = 6371008.8
const RAD = Math.PI / 180
const EPS = 1e-7
const MAX_STATIONS = 3000
type XY = [number, number]
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x))
const finite = (x: number): number | null => (Number.isFinite(x) ? x : null)
const add = (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]]
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const mul = (a: XY, n: number): XY => [a[0] * n, a[1] * n]
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0]
const norm = (a: XY) => Math.hypot(...a)
const unit = (a: XY): XY => mul(a, 1 / norm(a))

/** Great-circle horizontal distance, independent of terrain/formation height. */
export function distance(a: Coordinate, b: Coordinate): number {
  const dLat = (b[1] - a[1]) * RAD,
    dLng = (b[0] - a[0]) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(clamp(h, 0, 1)))
}

function bearing(a: Coordinate, b: Coordinate): number {
  const d = (b[0] - a[0]) * RAD,
    p = a[1] * RAD,
    q = b[1] * RAD
  return (
    (Math.atan2(Math.sin(d) * Math.cos(q), Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(d)) / RAD +
      360) %
    360
  )
}

/** Positive distances follow the bearing clockwise from true north. */
export function offsetCoordinate(point: Coordinate, bearingDegrees: number, distanceMeters: number): Coordinate {
  const a = bearingDegrees * RAD,
    d = distanceMeters / R,
    lat = point[1] * RAD,
    lng = point[0] * RAD
  const q = Math.asin(clamp(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(a), -1, 1))
  const p = lng + Math.atan2(Math.sin(a) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(q))
  return [((p / RAD + 540) % 360) - 180, q / RAD]
}

/** Local azimuthal-equidistant metric frame, bounded to short planning routes. */
function frame(origin: Coordinate) {
  return {
    toXY: (p: Coordinate): XY => {
      const d = distance(origin, p),
        b = bearing(origin, p) * RAD
      return [d * Math.sin(b), d * Math.cos(b)]
    },
    fromXY: (p: XY): Coordinate => offsetCoordinate(origin, Math.atan2(p[0], p[1]) / RAD, norm(p)),
  }
}

type Piece = {
  start: XY
  end: XY
  station: number
  length: number
  radius: number | null
  center?: XY
  angle?: number
  sweep?: number
  /** A clothoid: heading ψ(t) = psi0 + kappa0·t + (kappa1 − kappa0)·t²/(2L), from `start`. */
  spiral?: { psi0: number; kappa0: number; kappa1: number; radius: number }
}
type Path = {
  pieces: Piece[]
  length: number
  frame: ReturnType<typeof frame>
  warnings: string[]
  sharp: number[]
  boundaries: number[]
  first: Coordinate
}

/** Clothoid heading and position at distance t, by Simpson's rule on the heading function. */
function spiralAt(start: XY, length: number, spiral: NonNullable<Piece['spiral']>, t: number) {
  const heading = (u: number) =>
    spiral.psi0 + spiral.kappa0 * u + ((spiral.kappa1 - spiral.kappa0) * u * u) / (2 * length)
  const steps = Math.max(2, Math.ceil(t / 2) * 2)
  const h = t / steps
  let x = 0,
    y = 0
  for (let i = 0; i <= steps; i++) {
    const w = i === 0 || i === steps ? 1 : i % 2 ? 4 : 2
    const psi = heading(i * h)
    x += w * Math.cos(psi)
    y += w * Math.sin(psi)
  }
  return { xy: [start[0] + (x * h) / 3, start[1] + (y * h) / 3] as XY, psi: heading(t) }
}
/**
 * Tangent length and spiral angle for a curve of radius R and deflection Δ with clothoid
 * transitions of length Ls on each side: Ts = (R + p)·tan(Δ/2) + k, with the shift p and the
 * spiral's abscissa k from the series expansion of the clothoid.
 */
export function spiralTangent(radius: number, deflection: number, spiralLength: number) {
  if (!(spiralLength > 0)) return { trim: radius * Math.tan(deflection / 2), thetaS: 0 }
  const thetaS = spiralLength / (2 * radius)
  const xs = spiralLength * (1 - thetaS ** 2 / 10 + thetaS ** 4 / 216)
  const ys = spiralLength * (thetaS / 3 - thetaS ** 3 / 42 + thetaS ** 5 / 1320)
  const p = ys - radius * (1 - Math.cos(thetaS)),
    k = xs - radius * Math.sin(thetaS)
  return { trim: (radius + p) * Math.tan(deflection / 2) + k, thetaS }
}

function compile(alignment: Alignment): Path {
  if (alignment.points.length > 2000) throw new Error('Use at most 2,000 horizontal control points per alignment.')
  const warnings: string[] = []
  const valid = alignment.points.filter(
    (p) =>
      p.coordinate.length === 2 &&
      p.coordinate.every(Number.isFinite) &&
      Math.abs(p.coordinate[0]) <= 180 &&
      Math.abs(p.coordinate[1]) < 85,
  )
  if (valid.length !== alignment.points.length)
    throw new Error('Alignment coordinates must be valid longitude/latitude pairs.')
  const first: Coordinate = valid[0]?.coordinate ?? [0, 0]
  const f = frame(first)
  const nodes = valid.flatMap((p, index) => {
    if (index && distance(p.coordinate, valid[index - 1].coordinate) < 0.001) {
      warnings.push('Coincident horizontal points were ignored.')
      return []
    }
    if (distance(first, p.coordinate) > 100_000)
      throw new Error('Keep each preliminary alignment within 100 km of its first point.')
    return [{ ...p, xy: f.toXY(p.coordinate) }]
  })
  type Fillet = {
    entry: XY
    exit: XY
    center: XY
    radius: number
    angle: number
    sweep: number
    trim: number
    /** Clothoid transitions: the heading at TS and the turn direction. */
    spiral?: { length: number; thetaS: number; psi0: number; sign: number }
  }
  const curves: Array<Fillet | null> = nodes.map(() => null)
  for (let i = 1; i < nodes.length - 1; i++) {
    const a = sub(nodes[i].xy, nodes[i - 1].xy),
      b = sub(nodes[i + 1].xy, nodes[i].xy)
    const u = unit(a),
      v = unit(b),
      theta = Math.acos(clamp(u[0] * v[0] + u[1] * v[1], -1, 1))
    const radius = nodes[i].radiusM
    if (!Number.isFinite(radius) || radius < 0 || radius > 10000)
      throw new Error('Horizontal curve radii must be between 0 and 10,000 m.')
    if (!radius || theta < 1e-5) continue
    let spiralLength = Math.max(0, nodes[i].spiralM ?? 0)
    if (spiralLength > 0 && spiralLength / radius >= theta - 1e-6) {
      // Two transitions would turn the whole deflection: keep the simple curve.
      warnings.push(`Spirals at point ${i + 1} are longer than its deflection allows; a simple curve is used.`)
      spiralLength = 0
    }
    const { trim, thetaS } = spiralTangent(radius, theta, spiralLength)
    if (theta > Math.PI - 1e-4 || trim >= norm(a) - EPS || trim >= norm(b) - EPS) {
      warnings.push(`Curve at point ${i + 1} does not fit its tangents; the sharp PI is retained.`)
      continue
    }
    const sign = Math.sign(cross(u, v)),
      entry = sub(nodes[i].xy, mul(u, trim)),
      exit = add(nodes[i].xy, mul(v, trim))
    const center = add(entry, mul([-u[1], u[0]], sign * radius))
    curves[i] = {
      entry,
      exit,
      center,
      radius,
      trim,
      angle: Math.atan2(entry[1] - center[1], entry[0] - center[0]),
      sweep: sign * theta,
      ...(spiralLength > 0 ? { spiral: { length: spiralLength, thetaS, psi0: Math.atan2(u[1], u[0]), sign } } : {}),
    }
  }
  const overlapping = new Set<number>()
  for (let i = 1; i < nodes.length - 2; i++) {
    if (
      curves[i] &&
      curves[i + 1] &&
      curves[i]!.trim + curves[i + 1]!.trim >= norm(sub(nodes[i + 1].xy, nodes[i].xy)) - EPS
    ) {
      overlapping.add(i)
      overlapping.add(i + 1)
    }
  }
  for (const i of overlapping) {
    curves[i] = null
    warnings.push(`Curve at point ${i + 1} overlaps an adjacent curve; the sharp PI is retained.`)
  }
  const pieces: Piece[] = [],
    sharp: number[] = [],
    boundaries: number[] = [0]
  let length = 0,
    last = nodes[0]?.xy ?? ([0, 0] as XY)
  const line = (end: XY) => {
    const size = norm(sub(end, last))
    if (size > EPS) {
      pieces.push({ start: last, end, station: length, length: size, radius: null })
      length += size
      boundaries.push(length)
    }
    last = end
  }
  for (let i = 1; i < nodes.length; i++) {
    const c = curves[i]
    if (c?.spiral) {
      // TS → spiral → SC → arc → CS → spiral → ST, each piece continuing from the last one's end.
      line(c.entry)
      const { length: ls, thetaS, psi0, sign } = c.spiral
      const kappa = sign / c.radius
      const inSpiral = { psi0, kappa0: 0, kappa1: kappa, radius: c.radius }
      const sc = spiralAt(c.entry, ls, inSpiral, ls)
      pieces.push({ start: c.entry, end: sc.xy, station: length, length: ls, radius: null, spiral: inSpiral })
      length += ls
      boundaries.push(length)
      const arcSweep = sign * (Math.abs(c.sweep) - 2 * thetaS)
      const center = add(sc.xy, mul([-Math.sin(sc.psi), Math.cos(sc.psi)], sign * c.radius))
      const angle = Math.atan2(sc.xy[1] - center[1], sc.xy[0] - center[0])
      const cs = add(center, [c.radius * Math.cos(angle + arcSweep), c.radius * Math.sin(angle + arcSweep)])
      const arcLength = Math.abs(arcSweep) * c.radius
      pieces.push({
        start: sc.xy,
        end: cs,
        station: length,
        length: arcLength,
        radius: c.radius,
        center,
        angle,
        sweep: arcSweep,
      })
      length += arcLength
      boundaries.push(length)
      const outSpiral = { psi0: sc.psi + arcSweep, kappa0: kappa, kappa1: 0, radius: c.radius }
      const st = spiralAt(cs, ls, outSpiral, ls)
      pieces.push({ start: cs, end: st.xy, station: length, length: ls, radius: null, spiral: outSpiral })
      length += ls
      boundaries.push(length)
      last = st.xy
    } else if (c) {
      line(c.entry)
      const size = Math.abs(c.sweep) * c.radius
      pieces.push({
        start: c.entry,
        end: c.exit,
        station: length,
        length: size,
        radius: c.radius,
        center: c.center,
        angle: c.angle,
        sweep: c.sweep,
      })
      length += size
      boundaries.push(length)
      last = c.exit
    } else {
      line(nodes[i].xy)
      if (i < nodes.length - 1) {
        const u = unit(sub(nodes[i].xy, nodes[i - 1].xy)),
          v = unit(sub(nodes[i + 1].xy, nodes[i].xy))
        if (u[0] * v[0] + u[1] * v[1] < 1 - 1e-8) sharp.push(length)
      }
    }
  }
  if (length > 100_000) throw new Error('Keep each preliminary alignment at or below 100 km.')
  if (sharp.length)
    warnings.push(
      `${sharp.length} horizontal PI${sharp.length === 1 ? ' has' : 's have'} no fitted curve; review the sharp corners.`,
    )
  return { pieces, length, frame: f, warnings, sharp, boundaries, first }
}

function location(
  path: Path,
  chainage: number,
): { xy: XY; coordinate: Coordinate; bearing: number; radius: number | null } {
  const s = clamp(Number.isFinite(chainage) ? chainage : 0, 0, path.length)
  if (!path.pieces.length) return { xy: [0, 0], coordinate: path.first, bearing: 0, radius: null }
  let lo = 0,
    hi = path.pieces.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (path.pieces[mid].station + path.pieces[mid].length < s - EPS) lo = mid + 1
    else hi = mid
  }
  const p = path.pieces[lo],
    t = clamp((s - p.station) / p.length, 0, 1)
  let xy: XY, tangent: XY
  if (p.spiral) {
    const at = spiralAt(p.start, p.length, p.spiral, t * p.length)
    xy = at.xy
    tangent = [Math.cos(at.psi), Math.sin(at.psi)]
  } else if (p.radius !== null) {
    const a = p.angle! + p.sweep! * t,
      sign = Math.sign(p.sweep!)
    xy = add(p.center!, [p.radius * Math.cos(a), p.radius * Math.sin(a)])
    tangent = [-Math.sin(a) * sign, Math.cos(a) * sign]
  } else {
    tangent = unit(sub(p.end, p.start))
    xy = add(p.start, mul(sub(p.end, p.start), t))
    if (t > 1 - EPS && path.sharp.some((v) => Math.abs(v - s) < 1e-5) && path.pieces[lo + 1]) {
      const next = unit(sub(path.pieces[lo + 1].end, path.pieces[lo + 1].start)),
        sum = add(tangent, next)
      if (norm(sum) > EPS) tangent = unit(sum)
    }
  }
  const coordinate = path.frame.fromXY(xy)
  return {
    xy,
    coordinate,
    bearing: bearing(coordinate, path.frame.fromXY(add(xy, tangent))),
    radius: path.sharp.some((v) => Math.abs(v - s) < 1e-5) ? 0 : p.radius,
  }
}

export const alignmentLength = (alignment: Alignment): number => compile(alignment).length

// Section and width lookups need the curve geometry at many stations; compile it once per point set.
const compiled = new WeakMap<Alignment, { key: string; path: Path }>()
function compiledPath(alignment: Alignment): Path {
  const key = alignment.points
    .map((p) => `${p.coordinate[0]},${p.coordinate[1]},${p.radiusM},${p.spiralM ?? 0}`)
    .join(';')
  const cached = compiled.get(alignment)
  if (cached?.key === key) return cached.path
  const path = compile(alignment)
  compiled.set(alignment, { key, path })
  return path
}

/**
 * Superelevation and widening at a station from the alignment's design-speed rules, or null
 * outside every curve's runoff. `inside` is the side toward the curve centre.
 */
export function curveDesignAt(
  alignment: Alignment,
  chainage: number,
): { inside: 'left' | 'right'; superPercent: number; extraWidth: number; ratio: number; radius: number } | null {
  const d = alignment.curveDesign
  if (!d || !(d.designSpeedKmh > 0)) return null
  let path: Path
  try {
    path = compiledPath(alignment)
  } catch {
    return null
  }
  const rates = (radius: number) => {
    const velocity = d.designSpeedKmh
    const required = 100 * ((velocity * velocity) / (127 * radius) - d.sideFrictionFactor)
    return {
      superPercent: clamp(required, 0, Math.max(0, d.maxSuperelevationPercent)),
      widening: d.wideningVehicleLengthM ? (d.wideningVehicleLengthM * d.wideningVehicleLengthM) / (2 * radius) : 0,
    }
  }
  // Each side of a curve runs in linearly toward the arc and is full from SC to CS. A spiralled
  // side runs over max(runoff, spiral) ending at the SC (CS): no longer than the spiral, it follows
  // the curvature exactly; any excess starts on the tangent before the TS (after the ST), so the
  // ratio never falls back to 0 at a spiral end.
  const runoff = Math.max(0, d.runoffLengthM)
  const pieces = path.pieces
  // A station on a spiral belongs to that spiral's curve, whatever a neighbour's runoff reaches.
  const onSpiral = pieces.findIndex(
    (piece) => piece.spiral && chainage >= piece.station - EPS && chainage <= piece.station + piece.length + EPS,
  )
  const arcIndices = pieces.flatMap((piece, i) => (piece.radius === null ? [] : [i]))
  let best: { piece: Piece; distance: number; ratio: number } | null = null
  for (let arc = 0; arc < arcIndices.length; arc++) {
    const i = arcIndices[arc]
    const piece = pieces[i]
    if (onSpiral >= 0 && onSpiral !== i - 1 && onSpiral !== i + 1) continue
    const before = piece.station - chainage,
      after = chainage - (piece.station + piece.length)
    const distance = Math.max(0, before, after)
    // The entry spiral starts at zero curvature and the exit spiral ends there.
    const entry = pieces[i - 1]?.spiral?.kappa0 === 0 ? pieces[i - 1] : null,
      exit = pieces[i + 1]?.spiral?.kappa1 === 0 ? pieces[i + 1] : null
    const spiral = before > 0 ? entry : after > 0 ? exit : null
    let transition = spiral ? Math.max(runoff, spiral.length) : runoff
    const neighbourIndex = before > 0 ? arcIndices[arc - 1] : after > 0 ? arcIndices[arc + 1] : undefined
    if (neighbourIndex !== undefined) {
      const neighbour = pieces[neighbourIndex]
      if ((piece.sweep ?? 0) * (neighbour.sweep ?? 0) < 0) {
        const neighbourSpiral =
          before > 0
            ? pieces[neighbourIndex + 1]?.spiral?.kappa1 === 0
              ? pieces[neighbourIndex + 1]
              : null
            : pieces[neighbourIndex - 1]?.spiral?.kappa0 === 0
              ? pieces[neighbourIndex - 1]
              : null
        const ownLength = spiral?.length ?? 0
        const gap =
          before > 0
            ? piece.station - ownLength - (neighbour.station + neighbour.length + (neighbourSpiral?.length ?? 0))
            : neighbour.station - (neighbourSpiral?.length ?? 0) - (piece.station + piece.length + ownLength)
        // Opposing runoff must meet at normal crown. Share the intervening tangent,
        // preserving each spiral's full length even when their lengths differ.
        transition = Math.min(transition, ownLength + Math.max(0, gap) / 2)
      }
    }
    const ratio =
      distance <= EPS ? 1 : transition > 0 && distance < transition - EPS ? clamp(1 - distance / transition, 0, 1) : 0
    if (!best || ratio > best.ratio || (ratio === best.ratio && distance < best.distance))
      best = { piece, distance, ratio }
  }
  if (!best || best.ratio <= 0) return null
  const { ratio } = best
  const radius = best.piece.radius!
  const { superPercent, widening } = rates(radius)
  return {
    // Counter-clockwise sweep in the east/north frame turns left.
    inside: (best.piece.sweep ?? 0) > 0 ? 'left' : 'right',
    superPercent,
    extraWidth: widening * ratio,
    ratio,
    radius,
  }
}
/** Only actual fitted circular arcs; rejected radii remain sharp PIs and are absent. */
export function horizontalCurveSummary(alignment: Alignment) {
  return compile(alignment).pieces.flatMap((p) =>
    p.radius === null
      ? []
      : [
          {
            start: p.station,
            end: p.station + p.length,
            length: p.length,
            radius: p.radius,
          },
        ],
  )
}
/** The fitted horizontal geometry as lines and arcs in longitude/latitude, for exports. */
export function horizontalGeometry(alignment: Alignment): Array<
  | { kind: 'line'; station: number; length: number; start: Coordinate; end: Coordinate }
  | {
      kind: 'spiral'
      station: number
      length: number
      start: Coordinate
      end: Coordinate
      radiusStart: number
      radiusEnd: number
      rotation: 'cw' | 'ccw'
    }
  | {
      kind: 'arc'
      station: number
      length: number
      start: Coordinate
      end: Coordinate
      center: Coordinate
      radius: number
      rotation: 'cw' | 'ccw'
    }
> {
  const path = compile(alignment)
  return path.pieces.map((p) =>
    p.radius === null && !p.spiral
      ? {
          kind: 'line' as const,
          station: p.station,
          length: p.length,
          start: path.frame.fromXY(p.start),
          end: path.frame.fromXY(p.end),
        }
      : p.spiral
        ? {
            kind: 'spiral' as const,
            station: p.station,
            length: p.length,
            start: path.frame.fromXY(p.start),
            end: path.frame.fromXY(p.end),
            radiusStart: p.spiral.kappa0 === 0 ? Infinity : p.spiral.radius,
            radiusEnd: p.spiral.kappa1 === 0 ? Infinity : p.spiral.radius,
            rotation: p.spiral.kappa0 + p.spiral.kappa1 > 0 ? ('ccw' as const) : ('cw' as const),
          }
        : {
            kind: 'arc' as const,
            station: p.station,
            length: p.length,
            start: path.frame.fromXY(p.start),
            end: path.frame.fromXY(p.end),
            center: path.frame.fromXY(p.center!),
            radius: p.radius!,
            // Counter-clockwise in the east/north frame.
            rotation: (p.sweep ?? 0) > 0 ? ('ccw' as const) : ('cw' as const),
          },
  )
}
export function positionAt(alignment: Alignment, chainage: number): { coordinate: Coordinate; bearing: number } {
  const p = location(compile(alignment), chainage)
  return { coordinate: p.coordinate, bearing: p.bearing }
}
/**
 * Cut and fill areas of one section at a trial formation elevation, for search tools that try
 * many levels at a station. Null areas mean the section is incomplete (missing ground or no
 * daylight within the half-width).
 */
export function sectionAreasAt(
  alignment: Alignment,
  place: { coordinate: Coordinate; bearing: number },
  chainage: number,
  elevation: number,
  halfWidth: number,
  terrain: TerrainSource,
): { cutAreaM2: number | null; fillAreaM2: number | null } {
  const section = sectionAt(place.coordinate, place.bearing, elevation, alignment, chainage, halfWidth, terrain)
  return { cutAreaM2: section.cutAreaM2, fillAreaM2: section.fillAreaM2 }
}
export function nearestStation(stations: RoadStation[], chainage: number): RoadStation | undefined {
  if (!stations.length) return undefined
  let lo = 0,
    hi = stations.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (stations[mid].chainage < chainage) lo = mid + 1
    else hi = mid
  }
  return lo && Math.abs(stations[lo - 1].chainage - chainage) <= Math.abs(stations[lo].chainage - chainage)
    ? stations[lo - 1]
    : stations[lo]
}

function widthExtras(alignment: Alignment, chainage: number, surfacedOnly = false): [number, number] {
  let left = 0,
    right = 0
  for (const r of alignment.overrides) {
    if (surfacedOnly && r.kind === 'landing') continue
    if (chainage < r.start || chainage > r.end || r.end <= r.start) continue
    const taper = Math.min(Math.max(0, r.taper), (r.end - r.start) / 2)
    const ratio = taper ? clamp(Math.min(chainage - r.start, r.end - chainage) / taper, 0, 1) : 1
    const extra = r.extraWidth * ratio
    if (r.side !== 'right') left = Math.max(left, extra)
    if (r.side !== 'left') right = Math.max(right, extra)
  }
  return [left, right]
}
/** Overlapping widenings use the greatest requested extra width on each side. */
export function effectiveWidths(alignment: Alignment, chainage: number): { leftWidth: number; rightWidth: number } {
  const [left, right] = widthExtras(alignment, chainage)
  const t = templateAt(alignment, chainage).template
  const curve = curveDesignAt(alignment, chainage)
  const inside = curve?.extraWidth ?? 0
  return {
    leftWidth: t.leftWidth + left + (curve?.inside === 'left' ? inside : 0),
    rightWidth: t.rightWidth + right + (curve?.inside === 'right' ? inside : 0),
  }
}

function verticalProfile(points: VerticalPoint[], warnings: string[]) {
  if (points.length > 500) throw new Error('Use at most 500 vertical control points per alignment.')
  const pv = [...points].sort((a, b) => a.chainage - b.chainage)
  if (
    pv.some(
      (p) => ![p.chainage, p.elevation, p.curveLength].every(Number.isFinite) || p.chainage < 0 || p.curveLength < 0,
    )
  )
    throw new Error('Vertical points require finite elevations, nonnegative stationing and curve lengths.')
  if (pv.some((p, i) => i > 0 && p.chainage - pv[i - 1].chainage < 0.001))
    throw new Error('Vertical control points must have distinct stations at least 1 mm apart.')
  const slope = (i: number) => (pv[i + 1].elevation - pv[i].elevation) / (pv[i + 1].chainage - pv[i].chainage)
  const curves = pv.map((p, i) => {
    if (!p.curveLength || !i || i === pv.length - 1) return null
    const half = p.curveLength / 2
    if (half > p.chainage - pv[i - 1].chainage || half > pv[i + 1].chainage - p.chainage) {
      warnings.push(
        `Vertical curve at ${p.chainage.toFixed(1)} m does not fit its tangents; tangent grades are retained.`,
      )
      return null
    }
    return {
      start: p.chainage - half,
      end: p.chainage + half,
      length: p.curveLength,
      g1: slope(i - 1),
      g2: slope(i),
      z: p.elevation - slope(i - 1) * half,
    }
  })
  const overlaps = new Set<number>()
  for (let i = 1; i < curves.length - 1; i++)
    if (curves[i] && curves[i + 1] && curves[i]!.end > curves[i + 1]!.start + EPS) {
      overlaps.add(i)
      overlaps.add(i + 1)
    }
  for (const i of overlaps) {
    curves[i] = null
    warnings.push(
      `Vertical curve at ${pv[i].chainage.toFixed(1)} m overlaps its neighbour; tangent grades are retained.`,
    )
  }
  return {
    curves: pv
      .map((p, i) => ({
        pviId: p.id,
        chainage: p.chainage,
        start: p.chainage - p.curveLength / 2,
        end: p.chainage + p.curveLength / 2,
        length: p.curveLength,
        g1: i > 0 ? slope(i - 1) * 100 : null,
        g2: i < pv.length - 1 ? slope(i) * 100 : null,
        k:
          i > 0 && i < pv.length - 1 && Math.abs(slope(i) - slope(i - 1)) > EPS
            ? p.curveLength / (100 * Math.abs(slope(i) - slope(i - 1)))
            : null,
        valid: curves[i] !== null,
      }))
      .filter((p) => p.length > 0),
    knots: pv.flatMap((p, i) => (curves[i] ? [curves[i]!.start, p.chainage, curves[i]!.end] : [p.chainage])),
    value(s: number): { elevation: number; grade: number } | null {
      if (!pv.length) return null
      if (pv.length === 1) return { elevation: pv[0].elevation, grade: 0 }
      const curve = curves.find((c) => c && s >= c.start && s <= c.end)
      if (curve) {
        const x = s - curve.start
        return {
          elevation: curve.z + curve.g1 * x + ((curve.g2 - curve.g1) * x * x) / (2 * curve.length),
          grade: 100 * (curve.g1 + ((curve.g2 - curve.g1) * x) / curve.length),
        }
      }
      let i = 0
      while (i < pv.length - 2 && pv[i + 1].chainage <= s) i++
      return { elevation: pv[i].elevation + slope(i) * (s - pv[i].chainage), grade: 100 * slope(i) }
    },
  }
}

/** Grades are percent; K is metres per percentage-point of grade change. */
export function verticalCurveSummary(alignment: Alignment) {
  return verticalProfile(alignment.vertical, []).curves
}

function validate(alignment: Alignment, settings: RoadSettings) {
  if (Object.values(settings).some((v) => !Number.isFinite(v)))
    throw new Error('Design settings must be finite numbers.')
  if (
    settings.stationInterval < 2 ||
    settings.stationInterval > 100 ||
    settings.crossSectionHalfWidth < 5 ||
    settings.crossSectionHalfWidth > 100
  )
    throw new Error('Use a 2–100 m station interval and a 5–100 m cross-section half-width.')
  if (
    settings.maxGradePercent <= 0 ||
    settings.maxGradePercent > 100 ||
    settings.minRadius < 0 ||
    settings.shrinkFactor <= 0 ||
    settings.shrinkFactor > 2 ||
    [settings.cutRate, settings.fillRate, settings.surfacingRate, settings.clearingRate].some((v) => v < 0)
  )
    throw new Error('Design limits, material factors and unit rates are outside their supported ranges.')
  validateTemplate(alignment.template)
  if (alignment.engineering) validateEngineering(alignment.engineering)
  if (
    alignment.overrides.length > 200 ||
    alignment.overrides.some(
      (r) =>
        ![r.start, r.end, r.taper, r.extraWidth].every(Number.isFinite) ||
        r.start < 0 ||
        r.end <= r.start ||
        r.taper < 0 ||
        r.extraWidth < 0 ||
        r.extraWidth > 50 ||
        !['left', 'right', 'both'].includes(r.side),
    )
  )
    throw new Error('Widenings need a valid station range, side, taper and extra width (0–50 m).')
}

type SectionResult = Pick<
  RoadStation,
  'section' | 'cutAreaM2' | 'fillAreaM2' | 'leftDaylightM' | 'rightDaylightM' | 'complete' | 'flags'
>
/** A dip never deepens a ditch past this, whatever the inlet invert. */
export const MAX_DITCH_DIP_DEPTH = 4

/**
 * Station flag for a batter that is still above (fill) or below (cut) the ground where the
 * section reach ends: the formation is too far from the ground there for the reach to close it.
 */
export const beyondReachFlag = (side: 'Left' | 'Right', reachM: number) =>
  `${side} daylight unresolved: batter runs past the ${Number(reachM.toFixed(1))} m section reach`
export const isBeyondReachFlag = (flag: string) => / daylight unresolved: batter runs past the /.test(flag)

function sectionAt(
  coordinate: Coordinate,
  heading: number,
  z: number | null,
  alignment: Alignment,
  s: number,
  halfWidth: number,
  terrain: TerrainSource,
): SectionResult {
  const { leftWidth, rightWidth } = effectiveWidths(alignment, s),
    t = templateAt(alignment, s).template
  const step = Math.max(0.25, (2 * halfWidth) / 220)
  const cache = new Map<number, number | null>()
  const ground = (x: number) => {
    if (cache.has(x)) return cache.get(x)!
    const p = offsetCoordinate(coordinate, heading + 90, x),
      v = finite(terrain.elevationAt(...p))
    cache.set(x, v)
    return v
  }
  const flags: string[] = []
  const curve = curveDesignAt(alignment, s)
  type Side = {
    width: number
    outer: number
    edgeZ: number
    ditch: boolean
    slope: number
    daylight: number | null
    /** Why `daylight` is null: the batter ran past the reach, or terrain ran out first. */
    unresolved: 'reach' | 'terrain' | null
    crossfall: number
    ditchWidth: number
    ditchDepth: number
    /** Horizontal run of each ditch side slope: half the width for a V, less for a flat bottom. */
    ditchSideRun: number
  }
  const side = (sign: number, width: number): Side => {
    const name = sign < 0 ? 'left' : 'right'
    let ditchDepth = sideValue(t, name, 'DitchDepth')
    // Superelevation rotates the section about the centreline (`sectionCrossfall`); culvert cover
    // reads the same function, so the two stay level with each other.
    const crossfall = sectionCrossfall(t, name, curve),
      ditchWidth = sideValue(t, name, 'DitchWidth'),
      ditchSideRun = Math.max(0, (ditchWidth - Math.min(ditchWidth, sideValue(t, name, 'DitchBottomWidth'))) / 2)
    const edgeZ = (z ?? NaN) - (width * crossfall) / 100
    // A culvert dip deepens the inlet-side ditch so its bottom falls to the inlet invert at the dip grade.
    if (name === 'left' && ditchDepth > 0)
      for (const culvert of alignment.engineering?.culverts ?? []) {
        if (!culvert.ditchDipPercent || culvert.inletInvertM === null) continue
        const required = culvert.inletInvertM + (Math.abs(s - culvert.chainage) * culvert.ditchDipPercent) / 100
        ditchDepth = Math.max(ditchDepth, Math.min(MAX_DITCH_DIP_DEPTH, edgeZ - required))
      }
    const atEdge = ground(sign * width)
    const ditch = atEdge !== null && atEdge > edgeZ + EPS && ditchWidth > 0 && ditchDepth > 0
    const outer = width + (ditch ? ditchWidth : 0),
      g = ground(sign * outer)
    let slope = 0,
      daylight: number | null = null,
      reached = outer > halfWidth
    if (z !== null && g !== null && outer <= halfWidth) {
      const difference = g - edgeZ
      if (Math.abs(difference) < EPS) daylight = outer
      else {
        slope = difference > 0 ? 1 / sideValue(t, name, 'CutSlope') : -1 / sideValue(t, name, 'FillSlope')
        let a = outer,
          da = difference
        while (a < halfWidth - EPS) {
          const b = Math.min(halfWidth, a + step),
            gb = ground(sign * b)
          if (gb === null) break
          const db = gb - (edgeZ + slope * (b - outer))
          if (da * db <= 0) {
            // Solve against the actual terrain sampler, not a rounded display line.
            let lo = a,
              hi = b,
              dlo = da,
              failed = false
            for (let i = 0; i < 22; i++) {
              const mid = (lo + hi) / 2,
                gm = ground(sign * mid)
              if (gm === null) {
                failed = true
                break
              }
              const dm = gm - (edgeZ + slope * (mid - outer))
              if (dlo * dm <= 0) hi = mid
              else {
                lo = mid
                dlo = dm
              }
            }
            if (!failed) daylight = (lo + hi) / 2
            break
          }
          a = b
          da = db
        }
        reached = daylight === null && a >= halfWidth - EPS
      }
    }
    const unresolved = daylight !== null || z === null ? null : reached ? 'reach' : 'terrain'
    return { width, outer, edgeZ, ditch, slope, daylight, unresolved, crossfall, ditchWidth, ditchDepth, ditchSideRun }
  }
  const left = side(-1, leftWidth),
    right = side(1, rightWidth)
  const offsets: number[] = []
  const count = Math.ceil((2 * halfWidth) / step)
  for (let i = 0; i <= count; i++) offsets.push(-halfWidth + (2 * halfWidth * i) / count)
  offsets.push(0, -leftWidth, rightWidth, -left.outer, right.outer)
  for (const [sign, s] of [
    [-1, left],
    [1, right],
  ] as const)
    if (s.ditch)
      offsets.push(
        sign * (s.width + s.ditchWidth / 2),
        sign * (s.width + s.ditchSideRun),
        sign * (s.outer - s.ditchSideRun),
      )
  if (left.daylight !== null) offsets.push(-left.daylight)
  if (right.daylight !== null) offsets.push(right.daylight)
  const ordered = [
    ...new Set(offsets.filter((v) => Math.abs(v) <= halfWidth).map((v) => Math.round(v * 1e9) / 1e9)),
  ].sort((a, b) => a - b)
  const design = (x: number): number | null => {
    if (z === null) return null
    const d = Math.abs(x),
      side = x < 0 ? left : right
    if (d <= side.width + EPS) return z - (d * side.crossfall) / 100
    if (side.ditch && d <= side.outer + EPS) {
      // V ditch when the side run is half the width; a flat bottom between the side slopes otherwise.
      const u = d - side.width
      const along =
        side.ditchSideRun > EPS ? Math.min(1, u / side.ditchSideRun, (side.ditchWidth - u) / side.ditchSideRun) : 1
      return side.edgeZ - side.ditchDepth * Math.max(0, along)
    }
    if (side.daylight !== null && d > side.daylight + EPS) return null
    return side.edgeZ + side.slope * (d - side.outer)
  }
  const section: SectionSample[] = ordered.map((offset) => ({ offset, ground: ground(offset), design: design(offset) }))
  if (z === null) flags.push('Formation elevation unavailable')
  for (const [name, s] of [
    ['Left', left],
    ['Right', right],
  ] as const)
    if (s.daylight === null)
      flags.push(
        s.unresolved === 'reach'
          ? beyondReachFlag(name, halfWidth)
          : `${name} daylight unresolved: extend section or check terrain`,
      )
  let complete = z !== null && left.daylight !== null && right.daylight !== null
  const inner = section.filter((p) => p.design !== null)
  if (inner.some((p) => p.ground === null)) {
    complete = false
    flags.push('Missing terrain inside the road footprint')
  }
  let cut = 0,
    fill = 0
  if (complete) {
    for (let i = 1; i < inner.length; i++) {
      const a = inner[i - 1],
        b = inner[i],
        w = b.offset - a.offset,
        da = a.ground! - a.design!,
        db = b.ground! - b.design!
      if (da >= 0 && db >= 0) cut += ((da + db) * w) / 2
      else if (da <= 0 && db <= 0) fill -= ((da + db) * w) / 2
      else {
        const ratio = Math.abs(da) / (Math.abs(da) + Math.abs(db))
        if (da > 0) {
          cut += (da * w * ratio) / 2
          fill -= (db * w * (1 - ratio)) / 2
        } else {
          fill -= (da * w * ratio) / 2
          cut += (db * w * (1 - ratio)) / 2
        }
      }
    }
  }
  return {
    section,
    cutAreaM2: complete ? Math.max(0, cut) : null,
    fillAreaM2: complete ? Math.max(0, fill) : null,
    leftDaylightM: left.daylight,
    rightDaylightM: right.daylight,
    complete,
    flags,
  }
}

function flattened(path: Path): { xy: XY; chainage: number }[] {
  const out: { xy: XY; chainage: number }[] = []
  for (const p of path.pieces) {
    const n = p.radius === null ? 1 : Math.max(1, Math.ceil(Math.abs(p.sweep!) / (2 * RAD)), Math.ceil(p.length / 5))
    if (out.length + n > 30_000)
      throw new Error('The alignment has too many curve segments; reduce control points or radius complexity.')
    if (!out.length) out.push({ xy: p.start, chainage: p.station })
    for (let i = 1; i <= n; i++) {
      const a = (p.angle ?? 0) + ((p.sweep ?? 0) * i) / n
      const xy = p.radius === null ? p.end : add(p.center!, [p.radius * Math.cos(a), p.radius * Math.sin(a)])
      out.push({ xy, chainage: p.station + (p.length * i) / n })
    }
  }
  return out
}

function ringContains(p: XY, ring: XY[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j],
      ab = sub(b, a),
      ap = sub(p, a)
    if (norm(ab) < EPS) continue
    if (
      Math.abs(cross(ab, ap)) <= 1e-5 * Math.max(1, norm(ab)) &&
      ap[0] * ab[0] + ap[1] * ab[1] >= -EPS &&
      ap[0] * ab[0] + ap[1] * ab[1] <= norm(ab) ** 2 + EPS
    )
      return true
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

type Box = [number, number, number, number]
const segmentBox = (a: XY, b: XY): Box => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
]
const intersects = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
type FlatPoint = ReturnType<typeof flattened>[number]
type IndexedSegment = { a: FlatPoint; b: FlatPoint; box: Box }
type SegmentNode = { box: Box; items?: IndexedSegment[]; left?: SegmentNode; right?: SegmentNode }

/** Compact bounding-volume tree avoids scanning every road chord per stream edge. */
function segmentIndex(items: IndexedSegment[]): SegmentNode {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const item of items) {
    box[0] = Math.min(box[0], item.box[0])
    box[1] = Math.min(box[1], item.box[1])
    box[2] = Math.max(box[2], item.box[2])
    box[3] = Math.max(box[3], item.box[3])
  }
  if (items.length <= 12) return { box, items }
  const axis = box[2] - box[0] > box[3] - box[1] ? 0 : 1
  items.sort((a, b) => a.box[axis] + a.box[axis + 2] - b.box[axis] - b.box[axis + 2])
  const mid = items.length >> 1
  return { box, left: segmentIndex(items.slice(0, mid)), right: segmentIndex(items.slice(mid)) }
}

function* segmentCandidates(root: SegmentNode, box: Box): Generator<IndexedSegment> {
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()!
    if (!intersects(node.box, box)) continue
    if (node.items) {
      for (const item of node.items) if (intersects(item.box, box)) yield item
    } else {
      pending.push(node.left!, node.right!)
    }
  }
}

function contextGeometry(context: ContextFeature[], path: Path, flat: ReturnType<typeof flattened>) {
  if (context.length > 500) throw new Error('Use at most 500 context features per project.')
  let vertices = 0
  const features = context.map((feature) => {
    const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates
    vertices += lines.reduce((n, a) => n + a.length, 0)
    if (vertices > 50_000) throw new Error('Crop context layers to at most 50,000 vertices before importing.')
    if (
      lines.some((line) =>
        line.some(
          (p) => p.length < 2 || !p.slice(0, 2).every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) >= 85,
        ),
      )
    )
      throw new Error('Context features require valid longitude/latitude coordinates.')
    const rings = lines.map((line) => line.map((p) => path.frame.toXY(p.slice(0, 2) as Coordinate)))
    const box: Box = [Infinity, Infinity, -Infinity, -Infinity]
    for (const ring of rings)
      for (const p of ring) {
        box[0] = Math.min(box[0], p[0])
        box[1] = Math.min(box[1], p[1])
        box[2] = Math.max(box[2], p[0])
        box[3] = Math.max(box[3], p[1])
      }
    return { feature, rings, box }
  })
  const crossings: Crossing[] = []
  const index = segmentIndex(flat.slice(1).map((b, i) => ({ a: flat[i], b, box: segmentBox(flat[i].xy, b.xy) })))
  let comparisons = 0
  for (const { feature, rings } of features)
    for (const ring of rings)
      for (let j = 1; j < ring.length; j++) {
        const c = ring[j - 1],
          d = ring[j],
          v = sub(d, c)
        for (const { a, b } of segmentCandidates(index, segmentBox(c, d))) {
          if (++comparisons > 5_000_000)
            throw new Error('Context intersection budget exceeded; crop the context or split this alignment.')
          const u = sub(b.xy, a.xy),
            den = cross(u, v)
          if (Math.abs(den) < 1e-10) continue
          const w = sub(c, a.xy),
            t = cross(w, v) / den,
            q = cross(w, u) / den
          if (t < -EPS || t > 1 + EPS || q < -EPS || q > 1 + EPS) continue
          const chainage = a.chainage + clamp(t, 0, 1) * (b.chainage - a.chainage)
          if (crossings.some((x) => x.featureId === feature.id && Math.abs(x.chainage - chainage) < 0.01)) continue
          crossings.push({
            id: `${feature.id}-${chainage.toFixed(3)}`,
            featureId: feature.id,
            name: feature.name,
            kind: feature.kind,
            chainage,
            coordinate: location(path, chainage).coordinate,
          })
          if (crossings.length > 2000)
            throw new Error('More than 2,000 context intersections: crop the context or split the alignment.')
        }
      }
  crossings.sort((a, b) => a.chainage - b.chainage)
  const avoid = features.filter((f) => f.feature.kind === 'avoid' && f.feature.geometry.type === 'Polygon')
  return {
    crossings,
    avoidAt: (xy: XY) =>
      avoid
        .filter(
          ({ rings, box }) =>
            intersects(box, [xy[0], xy[1], xy[0], xy[1]]) &&
            ringContains(xy, rings[0]) &&
            !rings.slice(1).some((ring) => ringContains(xy, ring)),
        )
        .map((f) => f.feature.name),
  }
}

/** Road quantities are formation cut/fill; added landing width is unsurfaced. */
export function analyzeRoad(
  alignment: Alignment,
  terrain: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[] = [],
): RoadAnalysis {
  validate(alignment, settings)
  const path = compile(alignment),
    warnings = [...path.warnings]
  const empty: RoadAnalysis = {
    stations: [],
    centerline: alignment.points.map((p) => p.coordinate),
    crossings: [],
    length: path.length,
    cutVolumeM3: 0,
    fillVolumeM3: 0,
    balanceM3: 0,
    surfaceVolumeM3: 0,
    clearingAreaM2: 0,
    estimatedCost: 0,
    maxGradePercent: 0,
    completeLength: 0,
    coveragePercent: 0,
    warnings,
  }
  if (!path.length) {
    warnings.push('Add at least two distinct horizontal points to create a road.')
    return empty
  }
  const profile = verticalProfile(alignment.vertical, warnings),
    flat = flattened(path),
    { crossings, avoidAt } = contextGeometry(context, path, flat)
  if (!alignment.vertical.length)
    warnings.push('No vertical alignment: formation follows the sampled ground at the centreline.')
  if (alignment.vertical.some((p) => p.chainage > path.length + EPS))
    warnings.push('A vertical point lies beyond the current road end; its tangent still defines the intervening grade.')
  const knots = [
    0,
    path.length,
    ...path.boundaries,
    ...profile.knots,
    ...crossings.map((c) => c.chainage),
    ...engineeringKnots(alignment),
  ]
  for (const r of alignment.overrides) {
    const taper = Math.min(r.taper, (r.end - r.start) / 2)
    knots.push(r.start, r.start + taper, r.end - taper, r.end)
    // Resolve a deliberate width step without smearing it over a whole interval.
    if (!taper) knots.push(r.start - 1e-5, r.end + 1e-5)
  }
  const mandatory = [...new Set(knots.filter((s) => s >= 0 && s <= path.length).map((s) => Math.round(s * 1e6) / 1e6))]
  if (mandatory.length > MAX_STATIONS - 2)
    throw new Error('Too many design breakpoints; split this alignment into shorter roads.')
  const budget = MAX_STATIONS - mandatory.length
  const interval = Math.max(settings.stationInterval, path.length / Math.max(1, budget))
  if (interval > settings.stationInterval + EPS)
    warnings.push(
      `Station spacing increased to ${interval.toFixed(2)} m to stay within the 3,000-station calculation limit.`,
    )
  const stationValues = [...mandatory]
  for (let s = interval; s < path.length - EPS && stationValues.length < MAX_STATIONS; s += interval)
    stationValues.push(s)
  const chainages = stationValues.sort((a, b) => a - b).filter((s, i, a) => !i || s - a[i - 1] > 1e-6)
  const stations: RoadStation[] = chainages.map((s, index) => {
    const p = location(path, s),
      groundElevation = finite(terrain.elevationAt(...p.coordinate)),
      vertical = profile.value(s)
    const designElevation = vertical?.elevation ?? groundElevation
    const section = sectionAt(
      p.coordinate,
      p.bearing,
      designElevation,
      alignment,
      s,
      settings.crossSectionHalfWidth,
      terrain,
    )
    const flags = [...section.flags]
    if (p.radius === 0) flags.push('Sharp horizontal PI: curve required')
    else if (p.radius !== null && p.radius < settings.minRadius) flags.push(`Radius below ${settings.minRadius} m`)
    for (const name of avoidAt(p.xy)) flags.push(`Avoidance area: ${name}`)
    return {
      index,
      chainage: s,
      coordinate: p.coordinate,
      bearing: p.bearing,
      groundElevation,
      designElevation,
      gradePercent: vertical?.grade ?? null,
      groundGradePercent: null,
      curveRadiusM: p.radius,
      ...effectiveWidths(alignment, s),
      ...section,
      flags,
      cutVolumeM3: null,
      fillVolumeM3: null,
      massM3: null,
    }
  })
  let cutVolumeM3 = 0,
    fillVolumeM3 = 0,
    surfaceVolumeM3 = 0,
    clearingAreaM2 = 0,
    completeLength = 0,
    mass = 0,
    massKnown = stations[0]?.complete ?? false
  const surfaceArea = (s: number) => {
    const e = widthExtras(alignment, s, true),
      t = templateAt(alignment, s).template,
      curve = curveDesignAt(alignment, s)
    // Curve widening is surfaced road; landing extra width is not.
    const widen = (side: 'left' | 'right') => (curve?.inside === side ? curve.extraWidth : 0)
    return (
      (t.leftWidth + e[0] + widen('left')) * sideValue(t, 'left', 'SurfaceDepth') +
      (t.rightWidth + e[1] + widen('right')) * sideValue(t, 'right', 'SurfaceDepth')
    )
  }
  for (let i = 0; i < stations.length; i++) {
    const p = stations[i],
      a = stations[i > 0 ? i - 1 : i],
      b = stations[i > 0 ? i : Math.min(i + 1, stations.length - 1)],
      ds = b.chainage - a.chainage
    p.groundGradePercent =
      ds > EPS && a.groundElevation !== null && b.groundElevation !== null
        ? ((b.groundElevation - a.groundElevation) / ds) * 100
        : null
    if (!alignment.vertical.length) p.gradePercent = p.groundGradePercent
    if (p.gradePercent !== null && Math.abs(p.gradePercent) > settings.maxGradePercent + EPS)
      p.flags.push(`Grade exceeds ${settings.maxGradePercent}%`)
    if (!i) {
      p.cutVolumeM3 = p.complete ? 0 : null
      p.fillVolumeM3 = p.complete ? 0 : null
      p.massM3 = p.complete ? 0 : null
      continue
    }
    if (a.complete && p.complete) {
      p.cutVolumeM3 = ((a.cutAreaM2! + p.cutAreaM2!) / 2) * ds
      p.fillVolumeM3 = ((a.fillAreaM2! + p.fillAreaM2!) / 2) * ds
      cutVolumeM3 += p.cutVolumeM3
      fillVolumeM3 += p.fillVolumeM3
      completeLength += ds
      // Width and surface depth may both transition linearly: their product is quadratic.
      surfaceVolumeM3 +=
        ((surfaceArea(a.chainage) + 4 * surfaceArea((a.chainage + p.chainage) / 2) + surfaceArea(p.chainage)) / 6) * ds
      clearingAreaM2 += ((a.leftDaylightM! + a.rightDaylightM! + p.leftDaylightM! + p.rightDaylightM!) / 2) * ds
      if (massKnown) {
        mass += p.cutVolumeM3 * settings.shrinkFactor - p.fillVolumeM3
        p.massM3 = mass
      }
    } else massKnown = false
  }
  const coveragePercent = clamp((completeLength / path.length) * 100, 0, 100)
  if (coveragePercent < 100 - 1e-5)
    warnings.push(
      'Terrain coverage or daylight is incomplete. Quantities and cost are covered subtotals; the mass curve stops at the first gap.',
    )
  const badGrades = stations.filter(
    (s) => s.gradePercent !== null && Math.abs(s.gradePercent) > settings.maxGradePercent + EPS,
  ).length
  if (badGrades) warnings.push(`${badGrades} stations exceed the ${settings.maxGradePercent}% grade limit.`)
  const verticalChecks =
    alignment.vertical.length > 1 && (alignment.verticalStandards || alignment.verticalControls?.length)
      ? checkVerticalDesign({
          standards: alignment.verticalStandards,
          controls: alignment.verticalControls,
          curves: profile.curves,
          pvis: [...alignment.vertical].sort((a, b) => a.chainage - b.chainage),
          stations,
          length: path.length,
          valueAt: (s) => profile.value(s),
        })
      : []
  for (const check of verticalChecks) nearestStation(stations, check.chainage)?.flags.push(check.message)
  if (verticalChecks.length)
    warnings.push(
      `${verticalChecks.length} vertical standard or control check${verticalChecks.length === 1 ? '' : 's'} failed; see the flagged stations.`,
    )
  if (stations.some((s) => s.flags.some((v) => v.startsWith('Avoidance area:'))))
    warnings.push('The alignment enters a supplied avoidance area.')
  const balanceM3 = cutVolumeM3 * settings.shrinkFactor - fillVolumeM3
  const result: RoadAnalysis = {
    stations,
    centerline: flat.map((p) => path.frame.fromXY(p.xy)),
    crossings,
    length: path.length,
    cutVolumeM3,
    fillVolumeM3,
    balanceM3,
    surfaceVolumeM3,
    clearingAreaM2,
    estimatedCost:
      cutVolumeM3 * settings.cutRate +
      fillVolumeM3 * settings.fillRate +
      surfaceVolumeM3 * settings.surfacingRate +
      clearingAreaM2 * settings.clearingRate,
    maxGradePercent: stations.reduce((m, s) => Math.max(m, Math.abs(s.gradePercent ?? 0)), 0),
    completeLength,
    coveragePercent,
    warnings: [...new Set(warnings)],
    ...(verticalChecks.length ? { verticalChecks } : {}),
  }
  if (alignment.engineering) {
    const engineering = calculateEngineering(alignment, result, settings, terrain, {
      positionAt: (s) => location(path, s),
      offsetCoordinate,
      designElevationAt: (s) =>
        profile.value(s)?.elevation ?? finite(terrain.elevationAt(...location(path, s).coordinate)),
      widthsAt: (s) => effectiveWidths(alignment, s),
    })
    result.engineering = engineering
    result.estimatedCost = engineering.costs.total
    result.balanceM3 = engineering.balanceM3
    result.stations.forEach((station, i) => {
      station.massM3 = engineering.stations[i].massM3
    })
    result.warnings = [...new Set([...result.warnings, ...engineering.warnings])]
  }
  return result
}

/** Assumed parabolic sag: geometric clearance only, not cable tension or payload. */
export function analyzeCable(input: CableLine, terrain: TerrainSource): CableAnalysis {
  const line = resolvedCableLine(input)
  if (
    ![...line.start, ...line.end, line.startHeight, line.endHeight, line.deflectionPercent].every(Number.isFinite) ||
    line.startHeight < 0 ||
    line.endHeight < 0 ||
    line.startHeight > 100 ||
    line.endHeight > 100 ||
    line.deflectionPercent < 0 ||
    line.deflectionPercent > 30
  )
    throw new Error('Cable geometry requires valid coordinates, 0–100 m supports and 0–30% assumed deflection.')
  const length = distance(line.start, line.end)
  if (length < 0.01 || length > 10_000) return { samples: [], length, minClearance: null, complete: false }
  const a = finite(terrain.elevationAt(...line.start)),
    b = finite(terrain.elevationAt(...line.end)),
    heading = bearing(line.start, line.end)
  // Even interval count retains the maximum-sag midpoint exactly.
  const n = Math.min(1000, Math.max(20, 2 * Math.ceil(length / 4)))
  const samples = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n,
      position = offsetCoordinate(line.start, heading, length * t),
      ground = finite(terrain.elevationAt(...position))
    const cable =
      a === null || b === null
        ? null
        : (a + line.startHeight) * (1 - t) +
          (b + line.endHeight) * t -
          ((4 * line.deflectionPercent) / 100) * length * t * (1 - t)
    return { distance: length * t, ground, cable, clearance: ground === null || cable === null ? null : cable - ground }
  })
  const complete = samples.every((p) => p.clearance !== null)
  return { samples, length, minClearance: complete ? Math.min(...samples.map((p) => p.clearance!)) : null, complete }
}
