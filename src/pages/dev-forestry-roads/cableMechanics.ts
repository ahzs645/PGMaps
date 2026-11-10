/**
 * Static mechanics of one skyline span carrying a carriage and payload.
 *
 * The rope is an elastic catenary with a point load (Irvine 1981, "Cable Structures", ch. 2–3):
 * a rope of unstrained length L0 hangs between two supports under its own weight and one point
 * load. For a given L0 and load position the horizontal tension H is the same everywhere, and the
 * vertical component steps up by the rope's weight per metre and by the load where it hangs.
 * Integrating the stretched rope's slope from the first support gives two closure equations — the
 * rope must reach the second support's horizontal distance and height — which fix H and the
 * vertical tension at the first support. They are solved here by Newton's method with an analytic
 * Jacobian.
 *
 * Which L0 the line has is the rigging choice:
 * - `allowable`: the skyline is tensioned so that, with the load at mid-span, the larger support
 *   tension equals the allowable working tension (minimum breaking force ÷ safety factor). This is
 *   how a planner sizes a span to the rope (the tension-limited case used in Dupire et al. 2016).
 * - `base`: the empty skyline is pre-tensioned to an entered tension at its lower support; the
 *   rope length is then fixed and the load raises the tension (the fixed-length case of Zweifel
 *   1960 / Pestal 1961). Rope run out beyond the span (to the anchor or drum) stretches with it.
 *
 * Moving the load along the span with L0 fixed traces the load path. Half the running lines'
 * weight per metre is added to the skyline's own weight, Pestal's usual allowance for mainline and
 * haulback hanging from the carriage.
 *
 * Every function is pure: no DOM, network or terrain access. Distances are metres, forces newtons
 * unless a name says kN.
 */
import type { CableMechanicsProfile } from './types'

/** Standard gravity, m/s². */
export const STANDARD_GRAVITY = 9.80665

/** Number of load positions the load path is solved at (cosine-spaced, so denser near the supports). */
export const LOAD_PATH_POSITIONS = 80
/** Longest span the mechanics will solve, m (the D-line engine's own limit is 10 km; ropes are not). */
export const MAX_MECHANICS_SPAN_M = 3000
/** Allowed overrun of the allowable tension before a load position is reported as over it. */
export const TENSION_TOLERANCE = 0.005

export type CableTensionMode = 'allowable' | 'base'

/**
 * Rope, load and tensioning for one skyline. Units are in the field names. Every default below is
 * an **example** for a 22 mm skyline, not a recommendation: replace each value with the rigging
 * actually in use.
 */
export interface CableRigging {
  tensionMode: CableTensionMode
  /** Skyline mass per metre, kg/m. */
  ropeMassKgPerM: number
  /** Nominal skyline diameter, mm. */
  ropeDiameterMm: number
  /** Metallic area ÷ nominal circle area (0.3–1). */
  metallicFillFactor: number
  /** Rope's elastic modulus on its metallic area, kN/mm². */
  elasticModulusKNPerMm2: number
  /** Catalogue minimum breaking force, kN. */
  breakingForceKN: number
  /** Allowable working tension = breaking force ÷ this. */
  safetyFactor: number
  /** `base` mode only: empty-skyline tension at the lower support, kN. */
  baseTensionKN: number
  /** `base` mode only: skyline paid out beyond the span (to the anchor or drum), m. */
  extraRopeM: number
  /** Payload (turn of logs), kg. */
  payloadKg: number
  /** Carriage, kg. */
  carriageKg: number
  /** Mainline + haulback mass per metre, kg/m; half is added to the skyline's weight. */
  runningLinesKgPerM: number
  /** Required clearance from the carriage's point on the skyline down to the ground, m. */
  minClearanceM: number
}

/** Example rigging only. The UI labels it "example, replace with your rigging". */
export const EXAMPLE_RIGGING: CableRigging = {
  tensionMode: 'allowable',
  ropeMassKgPerM: 2.4,
  ropeDiameterMm: 22,
  metallicFillFactor: 0.7,
  elasticModulusKNPerMm2: 100,
  breakingForceKN: 424,
  safetyFactor: 3,
  baseTensionKN: 60,
  extraRopeM: 0,
  payloadKg: 3000,
  carriageKg: 500,
  runningLinesKgPerM: 0.75,
  minClearanceM: 1,
}

/** Bounds every rigging field is validated against, [low, high] inclusive. */
export const RIGGING_LIMITS: Record<Exclude<keyof CableRigging, 'tensionMode'>, readonly [number, number]> = {
  ropeMassKgPerM: [0.05, 50],
  ropeDiameterMm: [3, 100],
  metallicFillFactor: [0.3, 1],
  elasticModulusKNPerMm2: [10, 250],
  breakingForceKN: [1, 10_000],
  safetyFactor: [1, 10],
  baseTensionKN: [0.1, 10_000],
  extraRopeM: [0, 3000],
  payloadKg: [0, 50_000],
  carriageKg: [0, 10_000],
  runningLinesKgPerM: [0, 50],
  minClearanceM: [0, 100],
}

export const RIGGING_LABELS: Record<keyof typeof RIGGING_LIMITS, string> = {
  ropeMassKgPerM: 'Skyline mass (kg/m)',
  ropeDiameterMm: 'Skyline diameter (mm)',
  metallicFillFactor: 'Metallic fill factor',
  elasticModulusKNPerMm2: 'Elastic modulus (kN/mm²)',
  breakingForceKN: 'Minimum breaking force (kN)',
  safetyFactor: 'Safety factor',
  baseTensionKN: 'Base tension (kN)',
  extraRopeM: 'Rope beyond the span (m)',
  payloadKg: 'Payload (kg)',
  carriageKg: 'Carriage (kg)',
  runningLinesKgPerM: 'Running lines (kg/m)',
  minClearanceM: 'Minimum load clearance (m)',
}

/** Each field's own range and the tension mode. A project file is refused on these. */
export function riggingFieldErrors(rigging: CableRigging): string[] {
  const errors: string[] = []
  if (rigging.tensionMode !== 'allowable' && rigging.tensionMode !== 'base')
    errors.push('Choose how the skyline is tensioned: allowable tension or base tension.')
  for (const key of Object.keys(RIGGING_LIMITS) as (keyof typeof RIGGING_LIMITS)[]) {
    const value = rigging[key]
    const [low, high] = RIGGING_LIMITS[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)
      errors.push(`${RIGGING_LABELS[key]} must be between ${low} and ${high}.`)
  }
  return errors
}

/**
 * Every reason the rigging is not physical, in the form's words. Empty when it can be solved.
 * The checks between fields are reported by the analysis rather than refused in a project file,
 * so an edit that passes through an impossible combination is never lost.
 */
export function riggingErrors(rigging: CableRigging): string[] {
  const errors = riggingFieldErrors(rigging)
  if (errors.length) return errors
  const forces = riggingForces(rigging)
  if (rigging.tensionMode === 'base' && forces.baseTensionN >= forces.allowableN)
    errors.push('Base tension must be below the allowable working tension (breaking force ÷ safety factor).')
  // A rope cannot hold a point load at a tension below half that load on any real span.
  if (forces.loadN / 2 >= forces.allowableN)
    errors.push('The allowable working tension is below half the load: no span can carry it.')
  return errors
}

/** The rigging in newtons and metres. */
export function riggingForces(r: CableRigging) {
  const metallicAreaMm2 = Math.PI * (r.ropeDiameterMm / 2) ** 2 * r.metallicFillFactor
  return {
    /** Skyline + half the running lines, N per unstrained metre. */
    weightNPerM: (r.ropeMassKgPerM + r.runningLinesKgPerM / 2) * STANDARD_GRAVITY,
    /** Axial stiffness E·A, N. */
    stiffnessN: r.elasticModulusKNPerMm2 * 1000 * metallicAreaMm2,
    metallicAreaMm2,
    /** Payload + carriage, N. */
    loadN: (r.payloadKg + r.carriageKg) * STANDARD_GRAVITY,
    allowableN: (r.breakingForceKN * 1000) / r.safetyFactor,
    baseTensionN: r.baseTensionKN * 1000,
  }
}

/** One span between two supports: the far support is `verticalM` above the near one (negative below). */
export interface SkylineSpan {
  horizontalM: number
  verticalM: number
}

interface RopeState {
  /** Horizontal tension, N. */
  h: number
  /** Vertical tension component at the near support, positive upward along the rope. */
  v0: number
}
interface RopeCase {
  span: SkylineSpan
  /** Unstrained length, m. */
  l0: number
  w: number
  ea: number
  /** Point load, N, and its unstrained distance from the near support, m. */
  load: number
  at: number
}

/**
 * Horizontal and vertical advance of the stretched rope from unstrained coordinate p0 to p1 where
 * the vertical tension runs linearly from va to vb, plus the partial derivatives of both with
 * respect to H and to the near-support vertical tension.
 */
function piece(h: number, va: number, vb: number, length: number, w: number, ea: number) {
  const ra = Math.hypot(h, va),
    rb = Math.hypot(h, vb)
  const asA = Math.asinh(va / h),
    asB = Math.asinh(vb / h)
  return {
    dx: (h * length) / ea + (h / w) * (asB - asA),
    dz: ((va + vb) / 2) * (length / ea) + (rb - ra) / w,
    dxdh: length / ea + (asB - vb / rb - asA + va / ra) / w,
    dxdv: (h / rb - h / ra) / w,
    dzdh: (h / rb - h / ra) / w,
    dzdv: length / ea + (vb / rb - va / ra) / w,
  }
}

/** Closure residuals of the rope at its far end and their Jacobian. */
function closure(c: RopeCase, s: RopeState) {
  const atLoad = s.v0 + c.w * c.at
  const a = piece(s.h, s.v0, atLoad, c.at, c.w, c.ea)
  const b = piece(s.h, atLoad + c.load, s.v0 + c.w * c.l0 + c.load, c.l0 - c.at, c.w, c.ea)
  return {
    fx: a.dx + b.dx - c.span.horizontalM,
    fz: a.dz + b.dz - c.span.verticalM,
    j: [a.dxdh + b.dxdh, a.dxdv + b.dxdv, a.dzdh + b.dzdh, a.dzdv + b.dzdv] as const,
    loadX: a.dx,
    loadZ: a.dz,
  }
}

/** A parabolic starting estimate: the cable's sag from its spare length, then H from the sag. */
function seed(c: RopeCase): RopeState {
  const { horizontalM: d, verticalM: hz } = c.span
  const chord = Math.hypot(d, hz)
  const spare = Math.max(c.l0 * (1 + 1e-4) - chord, chord * 1e-5)
  const sag = Math.max(Math.sqrt((3 * d * spare) / 8), d * 1e-3)
  const weight = c.w * c.l0
  const h = (c.load * d * (c.at / c.l0) * (1 - c.at / c.l0) + (weight * d) / 8) / sag
  return { h, v0: (h * hz) / d - c.load * (1 - c.at / c.l0) - weight / 2 }
}

/** Newton's method on the two closure equations, step-halving to keep H positive and the residual falling. */
function solveRope(c: RopeCase, guess?: RopeState): RopeState | null {
  const scale = Math.max(1, Math.hypot(c.span.horizontalM, c.span.verticalM))
  const attempt = (start: RopeState): RopeState | null => {
    let s = start
    let r = closure(c, s)
    let size = Math.hypot(r.fx, r.fz)
    for (let iteration = 0; iteration < 80; iteration++) {
      if (size < 1e-9 * scale) return s
      const [a, b, cc, d] = r.j
      const det = a * d - b * cc
      if (!Number.isFinite(det) || det === 0) return null
      const dh = (-d * r.fx + b * r.fz) / det,
        dv = (cc * r.fx - a * r.fz) / det
      let step = 1
      let next: RopeState | null = null
      for (let k = 0; k < 40; k++, step /= 2) {
        const candidate = { h: s.h + step * dh, v0: s.v0 + step * dv }
        if (!(candidate.h > 0) || !Number.isFinite(candidate.v0)) continue
        const trial = closure(c, candidate)
        const trialSize = Math.hypot(trial.fx, trial.fz)
        if (Number.isFinite(trialSize) && trialSize < size) {
          next = candidate
          r = trial
          size = trialSize
          break
        }
      }
      if (!next) return size < 1e-6 * scale ? s : null
      s = next
    }
    return size < 1e-6 * scale ? s : null
  }
  return (guess && attempt(guess)) || attempt(seed(c))
}

/** Support tensions and the load point's position for a solved rope. */
function describe(c: RopeCase, s: RopeState) {
  const r = closure(c, s)
  const vEnd = s.v0 + c.w * c.l0 + c.load
  const atLoad = s.v0 + c.w * c.at
  return {
    loadX: r.loadX,
    loadZ: r.loadZ,
    nearTensionN: Math.hypot(s.h, s.v0),
    farTensionN: Math.hypot(s.h, vEnd),
    /** Mean of the rope tension just either side of the carriage. */
    loadTensionN: (Math.hypot(s.h, atLoad) + Math.hypot(s.h, atLoad + c.load)) / 2,
    horizontalN: s.h,
  }
}

/** The rope's line for a solved state, sampled along its unstrained length. */
function ropeLine(c: RopeCase, s: RopeState, count: number): { x: number; z: number }[] {
  const points: { x: number; z: number }[] = []
  for (let i = 0; i <= count; i++) {
    const p = (c.l0 * i) / count
    const first = Math.min(p, c.at)
    const a = piece(s.h, s.v0, s.v0 + c.w * first, first, c.w, c.ea)
    if (p <= c.at) {
      points.push({ x: a.dx, z: a.dz })
      continue
    }
    const vb = s.v0 + c.w * c.at + c.load
    const b = piece(s.h, vb, vb + c.w * (p - c.at), p - c.at, c.w, c.ea)
    points.push({ x: a.dx + b.dx, z: a.dz + b.dz })
  }
  return points
}

/**
 * Unstrained length at which `tension(l0)` (falling as the rope lengthens) equals `target`, by
 * bisection with warm-started rope solves. Null when no length gets the tension down to `target`.
 */
function lengthForTension(
  span: SkylineSpan,
  ea: number,
  target: number,
  tension: (l0: number, guess?: RopeState) => { value: number; state: RopeState } | null,
): number | null {
  const chord = Math.hypot(span.horizontalM, span.verticalM)
  // At this length even a straight, weightless rope is stretched past the target.
  let lo = chord / (1 + (1.5 * target) / ea)
  const low = tension(lo)
  if (!low || low.value <= target) {
    // Shorten until the rope is taut enough to exceed the target.
    lo = chord / (1 + (4 * target) / ea)
    const tighter = tension(lo)
    if (!tighter || tighter.value <= target) return null
  }
  let hi = chord * 1.0005
  let upper = tension(hi)
  let guess = upper?.state
  // Lengthen until the tension falls below the target; past a sag of about half the span the
  // rope's own weight raises the tension again, so give up there.
  while (!upper || upper.value > target) {
    lo = hi
    hi = chord + 2 * (hi - chord)
    if (hi > chord * 1.6) return null
    upper = tension(hi, guess)
    guess = upper?.state ?? guess
  }
  for (let i = 0; i < 64 && hi - lo > 1e-12 * chord; i++) {
    const mid = (lo + hi) / 2
    const t = tension(mid, guess)
    if (!t) return null
    guess = t.state
    if (t.value > target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export interface LoadPathPoint {
  /** Horizontal distance of the carriage from the near support, m. */
  x: number
  /** Carriage height relative to the near support, m. */
  z: number
  /** Vertical distance of the carriage below the straight chord between supports, m. */
  sagBelowChordM: number
  nearTensionN: number
  farTensionN: number
  loadTensionN: number
}

export interface SkylineSpanResult {
  mode: CableTensionMode
  span: SkylineSpan
  chordM: number
  /** Unstrained skyline length between the supports, m. */
  unstrainedLengthM: number
  stiffnessN: number
  weightNPerM: number
  loadN: number
  allowableN: number
  /** The empty skyline at the same unstrained length, near support at (0, 0). */
  emptyRope: { x: number; z: number }[]
  emptyNearTensionN: number
  emptyFarTensionN: number
  /** The carriage's position for each load position, near support to far support. */
  loadPath: LoadPathPoint[]
  /** The load at mid-span (half the unstrained length). */
  midSpan: LoadPathPoint
  /** Largest support tension over every load position, and where it happens. */
  maxTension: { tensionN: number; atSupport: 'near' | 'far'; loadX: number }
  /** Max tension ≤ allowable (within `TENSION_TOLERANCE`). */
  tensionOk: boolean
}

export type SkylineSpanOutcome = { ok: true; result: SkylineSpanResult } | { ok: false; error: string }

/**
 * Loaded and empty skyline over one span. Refuses non-physical rigging and spans the rope cannot
 * carry rather than returning a partial answer.
 */
export function analyzeSkylineSpan(span: SkylineSpan, rigging: CableRigging): SkylineSpanOutcome {
  if (
    !Number.isFinite(span.horizontalM) ||
    !Number.isFinite(span.verticalM) ||
    span.horizontalM < 1 ||
    span.horizontalM > MAX_MECHANICS_SPAN_M ||
    Math.abs(span.verticalM) > 2 * span.horizontalM + 1000
  )
    return { ok: false, error: `Skyline mechanics need a span between 1 m and ${MAX_MECHANICS_SPAN_M} m.` }
  const errors = riggingErrors(rigging)
  if (errors.length) return { ok: false, error: errors[0] }
  const f = riggingForces(rigging)
  const w = f.weightNPerM,
    ea = f.stiffnessN,
    load = f.loadN
  const ropeCase = (l0: number, loadN: number, at: number): RopeCase => ({ span, l0, w, ea, load: loadN, at })
  const lower = span.verticalM >= 0 ? 'near' : 'far'
  const emptyLowerTension = (l0: number, guess?: RopeState) => {
    const c = ropeCase(l0, 0, l0 / 2)
    const state = solveRope(c, guess)
    if (!state) return null
    const d = describe(c, state)
    return { value: lower === 'near' ? d.nearTensionN : d.farTensionN, state }
  }

  let unstrained: number | null
  let unstrainedAt: (loadAt: number, guess?: RopeState) => number = () => unstrained!
  if (rigging.tensionMode === 'allowable') {
    unstrained = lengthForTension(span, ea, f.allowableN, (l0, guess) => {
      const c = ropeCase(l0, load, l0 / 2)
      const state = solveRope(c, guess)
      if (!state) return null
      const d = describe(c, state)
      return { value: Math.max(d.nearTensionN, d.farTensionN), state }
    })
    if (unstrained === null)
      return {
        ok: false,
        error: 'No skyline length keeps this load within the allowable tension on this span.',
      }
  } else {
    unstrained = lengthForTension(span, ea, f.baseTensionN, emptyLowerTension)
    if (unstrained === null)
      return {
        ok: false,
        error: 'The base tension is too low to hold the empty skyline across this span.',
      }
    if (rigging.extraRopeM > 0) {
      // Rope beyond the span is straight and carries the mean support tension. Its unstrained
      // length is fixed by the empty rope, so a loaded span draws rope from it as it stretches.
      const empty = solveRope(ropeCase(unstrained, 0, unstrained / 2))!
      const ed = describe(ropeCase(unstrained, 0, unstrained / 2), empty)
      const total = unstrained + rigging.extraRopeM / (1 + (ed.nearTensionN + ed.farTensionN) / 2 / ea)
      const spanLength = unstrained
      unstrainedAt = (loadAt, guess) => {
        // Fixed point: span length + stretched-extra length = total unstrained rope.
        let l0 = spanLength
        let state = guess
        for (let i = 0; i < 60; i++) {
          const c = ropeCase(l0, load, loadAt * l0)
          const s = solveRope(c, state)
          if (!s) return NaN
          state = s
          const d = describe(c, s)
          const next = total - rigging.extraRopeM / (1 + (d.nearTensionN + d.farTensionN) / 2 / ea)
          if (Math.abs(next - l0) < 1e-7 * spanLength) return next
          l0 = next
        }
        return l0
      }
    }
  }
  const baseLength = unstrained

  const emptyCase = ropeCase(baseLength, 0, baseLength / 2)
  const emptyState = solveRope(emptyCase)
  if (!emptyState) return { ok: false, error: 'The empty skyline could not be solved for this span.' }
  const emptyDescription = describe(emptyCase, emptyState)
  const chord = Math.hypot(span.horizontalM, span.verticalM)
  const chordAt = (x: number) => (span.verticalM * x) / span.horizontalM

  // Load positions as fractions of the rope, cosine-spaced so the steep ends are well sampled.
  const n = LOAD_PATH_POSITIONS
  const fractions = Array.from({ length: n + 1 }, (_, i) => (1 - Math.cos((Math.PI * i) / n)) / 2)
  const middle = n / 2
  fractions[middle] = 0.5
  const points: (LoadPathPoint | null)[] = new Array(n + 1).fill(null)
  const solveAt = (i: number, guess?: RopeState): RopeState | null => {
    const u = fractions[i]
    if (i === 0 || i === n) {
      // A load on a support adds nothing to the rope (the support takes it): the empty skyline.
      points[i] = {
        x: i === 0 ? 0 : span.horizontalM,
        z: i === 0 ? 0 : span.verticalM,
        sagBelowChordM: 0,
        nearTensionN: emptyDescription.nearTensionN,
        farTensionN: emptyDescription.farTensionN,
        loadTensionN: i === 0 ? emptyDescription.nearTensionN : emptyDescription.farTensionN,
      }
      return emptyState
    }
    const l0 = unstrainedAt(u, guess)
    if (!Number.isFinite(l0)) return null
    const c = ropeCase(l0, load, u * l0)
    const s = solveRope(c, guess)
    if (!s) return null
    const d = describe(c, s)
    points[i] = {
      x: d.loadX,
      z: d.loadZ,
      sagBelowChordM: chordAt(d.loadX) - d.loadZ,
      nearTensionN: d.nearTensionN,
      farTensionN: d.farTensionN,
      loadTensionN: d.loadTensionN,
    }
    return s
  }
  const midState = solveAt(middle)
  if (!midState) return { ok: false, error: 'The loaded skyline could not be solved at mid-span.' }
  // Continuation: each load position starts from its neighbour's solution.
  for (const direction of [-1, 1]) {
    let guess: RopeState = midState
    for (let i = middle + direction; i >= 0 && i <= n; i += direction) {
      const s = solveAt(i, guess)
      if (!s && i !== 0 && i !== n)
        return { ok: false, error: 'The loaded skyline could not be solved along the whole span.' }
      if (s) guess = s
    }
  }
  const loadPath = points as LoadPathPoint[]
  let maxTension = { tensionN: 0, atSupport: 'near' as 'near' | 'far', loadX: 0 }
  for (const p of loadPath) {
    if (p.nearTensionN > maxTension.tensionN) maxTension = { tensionN: p.nearTensionN, atSupport: 'near', loadX: p.x }
    if (p.farTensionN > maxTension.tensionN) maxTension = { tensionN: p.farTensionN, atSupport: 'far', loadX: p.x }
  }
  return {
    ok: true,
    result: {
      mode: rigging.tensionMode,
      span: { ...span },
      chordM: chord,
      unstrainedLengthM: baseLength,
      stiffnessN: ea,
      weightNPerM: w,
      loadN: load,
      allowableN: f.allowableN,
      emptyRope: ropeLine(emptyCase, emptyState, 100),
      emptyNearTensionN: emptyDescription.nearTensionN,
      emptyFarTensionN: emptyDescription.farTensionN,
      loadPath,
      midSpan: loadPath[middle],
      maxTension,
      tensionOk: maxTension.tensionN <= f.allowableN * (1 + TENSION_TOLERANCE),
    },
  }
}

/** Linear interpolation of a polyline sorted by x; null outside it. */
export function heightAlong(points: readonly { x: number; z: number }[], x: number): number | null {
  if (!points.length || !Number.isFinite(x)) return null
  const tolerance = 1e-6 * Math.max(1, Math.abs(points.at(-1)!.x))
  if (x < points[0].x - tolerance || x > points.at(-1)!.x + tolerance) return null
  let lo = 0,
    hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].x <= x) lo = mid
    else hi = mid
  }
  const a = points[lo],
    b = points[hi]
  if (b.x - a.x <= 0) return a.z
  const t = Math.max(0, Math.min(1, (x - a.x) / (b.x - a.x)))
  return a.z + (b.z - a.z) * t
}

/**
 * Mid-span sag of a point load plus the rope's own weight at a given tension, by the parabolic
 * approximation (load F at mid-span: F·L/4T; distributed weight q: q·L²/8T). A quick estimate
 * only; the elastic catenary above is the model PGMaps reports.
 */
export function parabolicLoadSagM(chordM: number, loadN: number, weightNPerM: number, tensionN: number): number {
  if (![chordM, loadN, weightNPerM, tensionN].every(Number.isFinite) || chordM <= 0 || tensionN <= 0)
    throw new Error('Parabolic sag needs a positive span and tension.')
  return (loadN * chordM) / (4 * tensionN) + (weightNPerM * chordM * chordM) / (8 * tensionN)
}

/**
 * The skyline solved between a D-line's two support tops and drawn on its own profile samples.
 * `startSupport`/`endSupport` are support-top elevations (ground + height); null when that ground
 * is unknown, which leaves the whole skyline unknown. A sample with unknown ground keeps its load
 * clearance unknown, and then the minimum is unknown too, never the minimum of the known part.
 */
export function cableMechanicsProfile(
  rigging: CableRigging,
  startSupport: number | null,
  endSupport: number | null,
  lengthM: number,
  samples: readonly { distance: number; ground: number | null }[],
): CableMechanicsProfile {
  const unsolved = (error: string): CableMechanicsProfile => ({
    rigging,
    error,
    span: null,
    samples: samples.map(() => ({ loadPath: null, emptyRope: null, loadClearance: null })),
    minLoadClearance: null,
    minLoadClearanceAt: null,
    complete: false,
    clearanceOk: null,
    tensionOk: null,
  })
  if (startSupport === null || endSupport === null)
    return unsolved('Ground at a support is unknown, so the skyline cannot be solved.')
  const outcome = analyzeSkylineSpan({ horizontalM: lengthM, verticalM: endSupport - startSupport }, rigging)
  if (!outcome.ok) return unsolved(outcome.error)
  const span = outcome.result
  const loadLine = span.loadPath.map((p) => ({ x: p.x, z: p.z }))
  let min: number | null = null,
    minAt: number | null = null,
    complete = true
  const profile = samples.map((sample) => {
    const load = heightAlong(loadLine, sample.distance)
    const empty = heightAlong(span.emptyRope, sample.distance)
    const loadPath = load === null ? null : startSupport + load
    const loadClearance = loadPath === null || sample.ground === null ? null : loadPath - sample.ground
    if (loadClearance === null) complete = false
    else if (min === null || loadClearance < min) {
      min = loadClearance
      minAt = sample.distance
    }
    return { loadPath, emptyRope: empty === null ? null : startSupport + empty, loadClearance }
  })
  const known = complete && min !== null
  return {
    rigging,
    error: null,
    span,
    samples: profile,
    minLoadClearance: known ? min : null,
    minLoadClearanceAt: known ? minAt : null,
    complete,
    clearanceOk: known ? min! >= rigging.minClearanceM - 1e-7 : null,
    tensionOk: span.tensionOk,
  }
}

/** Reads a saved rigging block, refusing unknown modes and out-of-range values. */
export function parseRigging(raw: unknown): CableRigging {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('D-line rigging must be an object.')
  const r = raw as Record<string, unknown>
  const rigging = { tensionMode: r.tensionMode } as CableRigging
  for (const key of Object.keys(RIGGING_LIMITS) as (keyof typeof RIGGING_LIMITS)[]) rigging[key] = r[key] as number
  const errors = riggingFieldErrors(rigging)
  if (errors.length) throw Error(`D-line rigging: ${errors[0]}`)
  return rigging
}

/** Reads a saved sag model; `mechanics` needs a rigging block beside it. */
export function parseSagModel(raw: unknown, hasRigging: boolean): 'assumed' | 'mechanics' {
  if (raw !== 'assumed' && raw !== 'mechanics') throw Error('D-line sag model must be assumed or mechanics.')
  if (raw === 'mechanics' && !hasRigging) throw Error('A D-line using rope mechanics needs its rigging.')
  return raw
}
