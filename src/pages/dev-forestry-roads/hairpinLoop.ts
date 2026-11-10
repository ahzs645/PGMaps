/**
 * The drawn turn of a switchback found by the route search: where two straight legs meet at a sharp
 * vertex, the road leaves the first leg on a reverse curve, goes round the outside of the vertex on
 * PGMaps' two-curve return bend (two curves of radius R with a middle straight between), and joins
 * the second leg on another reverse curve. Every curve has the switchback radius, and short straights
 * separate them, so the road engine fits each one as entered.
 *
 * Going round the outside lengthens the road through the turn, which flattens it; turning inside the
 * vertex would shorten it and steepen the turn past the legs' own grade. SylvaRoaD redraws its
 * hairpins the same way, as a loop round the outside, from a 45° polygon (functional specification,
 * §4.6). Written from a functional specification; no code from SylvaRoaD (GPL-3.0) was used.
 *
 * Plane metres, x east and y north, headings in radians anticlockwise from east. Pure.
 */
export type XY = [number, number]

export interface LoopArc {
  kind: 'arc'
  centre: XY
  radius: number
  /** Radial angle at the start, radians. */
  startAngle: number
  /** Signed sweep: positive anticlockwise (a left turn). */
  sweep: number
  start: XY
  end: XY
  length: number
}
export interface LoopLine {
  kind: 'line'
  start: XY
  end: XY
  length: number
}
export interface HairpinLoop {
  /** Distance back along the entry leg, and on along the exit leg, from the vertex to where the loop meets it. */
  trimM: number
  lengthM: number
  parts: (LoopArc | LoopLine)[]
  /** Horizontal points that reproduce the loop in the road engine, each with the switchback radius. */
  points: { at: XY; radiusM: number }[]
  /** Signed turn at the vertex, radians: positive left. */
  turn: number
}

/** The straight between each reverse curve and the main bend, so the engine sees separate curves. */
export const LOOP_REVERSE_TANGENT_M = 2

const TAU = 2 * Math.PI
const add = (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]]
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const mul = (a: XY, k: number): XY => [a[0] * k, a[1] * k]
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]
const left = (a: XY): XY => [-a[1], a[0]]
const unit = (a: XY): XY => mul(a, 1 / Math.hypot(a[0], a[1]))
const along = (angle: number): XY => [Math.cos(angle), Math.sin(angle)]
const angleOf = (a: XY) => Math.atan2(a[1], a[0])
const rotate = (a: XY, angle: number): XY => [
  a[0] * Math.cos(angle) - a[1] * Math.sin(angle),
  a[0] * Math.sin(angle) + a[1] * Math.cos(angle),
]
/** Angle in (−π, π]. */
export const wrapAngle = (angle: number) => {
  const a = (((angle + Math.PI) % TAU) + TAU) % TAU
  return a === 0 ? Math.PI : a - Math.PI
}

function arc(centre: XY, radius: number, from: number, to: number, direction: number): LoopArc {
  const sweep = direction * ((((direction * (to - from)) % TAU) + TAU) % TAU)
  return {
    kind: 'arc',
    centre,
    radius,
    startAngle: from,
    sweep,
    start: add(centre, mul(along(from), radius)),
    end: add(centre, mul(along(to), radius)),
    length: Math.abs(sweep) * radius,
  }
}

/** The common tangent from a circle turning `direction` to an equal circle turning the other way. */
function crossTangent(from: XY, to: XY, radius: number, direction: number) {
  const span = sub(to, from),
    size = Math.hypot(span[0], span[1])
  const phi = Math.acos(Math.min(1, (2 * radius) / size))
  for (const angle of [phi, -phi]) {
    const q = rotate(unit(span), angle)
    const p = add(from, mul(q, radius)),
      r = sub(to, mul(q, radius))
    const travel = mul(left(q), direction)
    if (dot(sub(r, p), travel) >= -1e-9) return { p, r, q }
  }
  return null
}

/**
 * The loop for a vertex at `vertex` between legs heading `headingIn` and `headingOut`. Null when the
 * turn is too small to be a switchback or the construction does not close.
 */
export function hairpinLoop(
  vertex: XY,
  headingIn: number,
  headingOut: number,
  radiusM: number,
  middleStraightM: number,
  reverseTangentM = LOOP_REVERSE_TANGENT_M,
): HairpinLoop | null {
  const turn = wrapAngle(headingOut - headingIn)
  if (Math.abs(turn) < Math.PI / 6 || !(radiusM > 0) || !(middleStraightM >= 0)) return null
  const s = Math.sign(turn),
    R = radiusM,
    M = middleStraightM,
    g = reverseTangentM
  const u1 = along(headingIn),
    u2 = along(headingOut)
  // Outside of the turn, and the direction of travel at the far side of the bend.
  const w = unit(sub(u1, u2)),
    e = mul(left(w), s)
  const out1 = mul(left(u1), -s),
    out2 = mul(left(u2), -s)
  const c1 = sub(vertex, mul(e, M / 2)),
    c2 = add(vertex, mul(e, M / 2))
  const reach = 4 * R * R + g * g
  const a = add(mul(out1, R), mul(e, M / 2)),
    b = sub(mul(out2, R), mul(e, M / 2))
  const ua = dot(u1, a),
    ub = dot(u2, b)
  const discA = ua * ua - dot(a, a) + reach,
    discB = ub * ub - dot(b, b) + reach
  if (discA < 0 || discB < 0) return null
  const d1 = ua + Math.sqrt(discA),
    d2 = -ub + Math.sqrt(discB)
  const e1 = add(sub(vertex, mul(u1, d1)), mul(out1, R)),
    e2 = add(add(vertex, mul(u2, d2)), mul(out2, R))
  const f1 = sub(vertex, mul(u1, d1)),
    f2 = add(vertex, mul(u2, d2))
  const entry = crossTangent(e1, c1, R, -s),
    exit = crossTangent(c2, e2, R, s)
  if (!entry || !exit) return null
  const apex1 = add(c1, mul(w, R)),
    apex2 = add(c2, mul(w, R))
  const parts: (LoopArc | LoopLine)[] = [
    arc(e1, R, angleOf(sub(f1, e1)), angleOf(entry.q), -s),
    { kind: 'line', start: entry.p, end: entry.r, length: Math.hypot(...sub(entry.r, entry.p)) },
    arc(c1, R, angleOf(mul(entry.q, -1)), angleOf(w), s),
    { kind: 'line', start: apex1, end: apex2, length: M },
    arc(c2, R, angleOf(w), angleOf(exit.q), s),
    { kind: 'line', start: exit.p, end: exit.r, length: Math.hypot(...sub(exit.r, exit.p)) },
    arc(e2, R, angleOf(mul(exit.q, -1)), angleOf(sub(f2, e2)), -s),
  ]
  // The heading must come round by exactly the vertex's turn.
  const swept = parts.reduce((sum, part) => sum + (part.kind === 'arc' ? part.sweep : 0), 0)
  if (Math.abs(wrapAngle(swept - turn)) > 1e-6) return null
  const points: HairpinLoop['points'] = []
  for (const part of parts) {
    if (part.kind !== 'arc' || Math.abs(part.sweep) < 1e-9) continue
    if (Math.abs(part.sweep) >= Math.PI - 1e-3) return null
    const heading = mul(left(along(part.startAngle)), Math.sign(part.sweep))
    points.push({ at: add(part.start, mul(heading, R * Math.tan(Math.abs(part.sweep) / 2))), radiusM: R })
  }
  return {
    trimM: Math.max(d1, d2),
    lengthM: parts.reduce((sum, part) => sum + part.length, 0),
    parts,
    points,
    turn,
  }
}

/** Points along the loop no more than `stepM` apart, each with its distance from the loop's start. */
export function sampleLoop(loop: HairpinLoop, stepM: number): { at: XY; s: number }[] {
  const samples: { at: XY; s: number }[] = [{ at: loop.parts[0].start, s: 0 }]
  let s = 0
  for (const part of loop.parts) {
    const count = Math.max(1, Math.ceil(part.length / stepM))
    for (let i = 1; i <= count; i++) {
      const f = i / count
      const at: XY =
        part.kind === 'line'
          ? add(part.start, mul(sub(part.end, part.start), f))
          : add(part.centre, mul(along(part.startAngle + part.sweep * f), part.radius))
      samples.push({ at, s: s + part.length * f })
    }
    s += part.length
  }
  return samples
}
