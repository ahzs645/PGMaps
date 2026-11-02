/**
 * Low-speed swept path of a design vehicle along the fitted centreline. Pure and derived: it never
 * edits the design. The steer-axle centre follows the centreline; every trailing axle group follows
 * its front pivot without slip (the tractrix model behind offtracking templates). Swept points are
 * located against the centreline and compared with the formation half-widths at each metre.
 */
import { centrelineSamples, effectiveWidths, horizontalCurveSummary } from './engine'
import type { Alignment, DesignVehicle, VehicleCheck, VehicleUnit } from './types'

export const SWEPT_PATH_BASIS =
  'Low-speed kinematic tracking: the steer-axle centre follows the fitted centreline and each axle group ' +
  'trails its hitch without slip, starting straight on the first tangent. Excludes tandem scrub, tyre and ' +
  'suspension compliance, driver line, speed, grade, traction and braking, mirrors and vertical clearance. ' +
  'Wheel extents use the out-to-out width at each axle-group centre. Compared with the formation half-width ' +
  'at each metre less the entered clearance; body and load overhang are reported, not required to fit.'

export const VEHICLE_LIMITS = {
  units: 3,
  widthM: [1.5, 4] as const,
  wheelbaseM: [1, 25] as const,
  overhangM: [0, 15] as const,
  hitchOffsetM: [-5, 10] as const,
  clearanceM: [0, 5] as const,
}

const unit = (name: string, wheelbaseM: number, frontOverhangM: number, rearOverhangM: number, hitchOffsetM = 0) => ({
  name,
  wheelbaseM,
  frontOverhangM,
  rearOverhangM,
  hitchOffsetM,
})

/**
 * Starting points only. Each is an illustrative configuration whose dimensions must be replaced
 * with the fleet's or the governing criteria's values before relying on the result.
 */
export const VEHICLE_PRESETS: { id: string; label: string; vehicle: DesignVehicle }[] = [
  {
    id: 'log-truck-pole-trailer',
    label: 'Loaded log truck + pole trailer (example)',
    vehicle: {
      name: 'Loaded log truck + pole trailer (example)',
      source:
        'Example dimensions for ~16 m logs: replace with the fleet truck, bunk spacing and log length. The load pivots on the truck bunk over the drive tandem and steers the trailer.',
      widthM: 2.6,
      units: [unit('Truck', 5.8, 1.3, 0, 0), unit('Logs on trailer', 9.5, 1.5, 5)],
    },
  },
  {
    id: 'log-truck-empty',
    label: 'Empty log truck, trailer carried (example)',
    vehicle: {
      name: 'Empty log truck, trailer carried (example)',
      source: 'Example dimensions: replace with the fleet truck and its carried trailer overhang.',
      widthM: 2.6,
      units: [unit('Truck with carried trailer', 5.8, 1.3, 3)],
    },
  },
  {
    id: 'tractor-semitrailer-wb19',
    label: 'Tractor–semitrailer, WB-19 class (example)',
    vehicle: {
      name: 'Tractor–semitrailer, WB-19 class (example)',
      source:
        'Approximate WB-19-class proportions. Replace with the design vehicle dimensions in your criteria source.',
      widthM: 2.6,
      units: [unit('Tractor', 6.6, 0.9, 0.6, -0.3), unit('Semitrailer', 12.5, 0.9, 0.9)],
    },
  },
]

export const DEFAULT_VEHICLE_CHECK: VehicleCheck = {
  vehicle: structuredClone(VEHICLE_PRESETS[0].vehicle),
  direction: 'both',
  clearanceM: 0.3,
}

export function validateVehicleCheck(check: VehicleCheck): void {
  const inRange = (value: number, [lo, hi]: readonly [number, number]) =>
    Number.isFinite(value) && value >= lo && value <= hi
  const { vehicle } = check
  if (!['up', 'down', 'both'].includes(check.direction)) throw Error('Choose a vehicle travel direction.')
  if (!inRange(check.clearanceM, VEHICLE_LIMITS.clearanceM)) throw Error('Wheel clearance must be 0–5 m.')
  if (typeof vehicle.name !== 'string' || vehicle.name.length > 200) throw Error('Vehicle name is too long.')
  if (vehicle.source !== undefined && (typeof vehicle.source !== 'string' || vehicle.source.length > 2000))
    throw Error('Vehicle source is too long.')
  if (!inRange(vehicle.widthM, VEHICLE_LIMITS.widthM)) throw Error('Vehicle width must be 1.5–4 m.')
  if (!Array.isArray(vehicle.units) || vehicle.units.length < 1 || vehicle.units.length > VEHICLE_LIMITS.units)
    throw Error('A design vehicle needs one to three units.')
  for (const u of vehicle.units)
    if (
      typeof u.name !== 'string' ||
      u.name.length > 100 ||
      !inRange(u.wheelbaseM, VEHICLE_LIMITS.wheelbaseM) ||
      !inRange(u.frontOverhangM, VEHICLE_LIMITS.overhangM) ||
      !inRange(u.rearOverhangM, VEHICLE_LIMITS.overhangM) ||
      !inRange(u.hitchOffsetM, VEHICLE_LIMITS.hitchOffsetM)
    )
      throw Error('Vehicle units need wheelbase 1–25 m, overhangs 0–15 m and hitch offset −5–10 m.')
}

export interface SweptManeuver {
  id: string
  /** Curve IDs as in the curve review (H1…). */
  curveIds: string[]
  direction: 'up' | 'down'
  start: number
  end: number
  /** Signed sum: positive turns left. A switchback is about ±180°. */
  deflectionDegrees: number
  /** Largest lateral distance between the steer path and the last axle group. */
  maxOfftrackingM: number
  maxArticulationDegrees: number
  wheelLeftM: number
  wheelRightM: number
  bodyLeftM: number
  bodyRightM: number
  /** Narrowest formation half-width where the wheels were measured. */
  formationLeftM: number
  formationRightM: number
  requiredLeftWideningM: number
  requiredRightWideningM: number
  bodyBeyondLeftM: number
  bodyBeyondRightM: number
  /** Station of the largest wheel deficit, or of the tightest wheel clearance when it fits. */
  worstChainage: number
  fits: boolean
}

export interface SweptBin {
  chainage: number
  wheelLeftM: number | null
  wheelRightM: number | null
  bodyLeftM: number | null
  bodyRightM: number | null
  formationLeftM: number
  formationRightM: number
}

export interface SweptPathResult {
  check: VehicleCheck
  bins: SweptBin[]
  maneuvers: SweptManeuver[]
  fits: boolean
  warnings: string[]
  /** GeoJSON lines for the plan: wheel and body envelopes and wheel deficits within curve zones. */
  overlay: GeoJSON.FeatureCollection
}

const STEP = 0.25
const BIN = 1
const RECORD_EVERY = 2 // Record positions every 0.5 m of steer travel.

type XY = [number, number]
type Sample = { s: number; x: number; y: number }
type Run = {
  direction: 'up' | 'down'
  wheelLeft: Float64Array
  wheelRight: Float64Array
  bodyLeft: Float64Array
  bodyRight: Float64Array
  offtracking: Float64Array
  articulation: Float64Array
}

const totalLength = (vehicle: DesignVehicle) =>
  vehicle.units.reduce((sum, u, i) => sum + u.wheelbaseM + (i < vehicle.units.length - 1 ? u.hitchOffsetM : 0), 0) +
  vehicle.units[0].frontOverhangM +
  vehicle.units.at(-1)!.rearOverhangM

/** Signed lateral offset (left positive) and station of a point, searched within an index window. */
function locate(samples: Sample[], px: number, py: number, lo: number, hi: number) {
  lo = Math.max(0, lo)
  hi = Math.min(samples.length - 1, hi)
  let best = lo,
    bestD = Infinity
  for (let i = lo; i <= hi; i += 4) {
    const d = (samples[i].x - px) ** 2 + (samples[i].y - py) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  for (let i = Math.max(lo, best - 4); i <= Math.min(hi, best + 4); i++) {
    const d = (samples[i].x - px) ** 2 + (samples[i].y - py) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  let result = { s: samples[best].s, offset: 0, distance: Infinity }
  for (const [a, b] of [
    [best - 1, best],
    [best, best + 1],
  ]) {
    if (a < 0 || b >= samples.length) continue
    const A = samples[a],
      B = samples[b]
    const dx = B.x - A.x,
      dy = B.y - A.y,
      len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    const t = Math.max(0, Math.min(1, ((px - A.x) * dx + (py - A.y) * dy) / len ** 2))
    const cx = A.x + dx * t,
      cy = A.y + dy * t
    const distance = Math.hypot(px - cx, py - cy)
    if (distance < result.distance)
      result = { s: A.s + (B.s - A.s) * t, offset: (dx * (py - A.y) - dy * (px - A.x)) / len, distance }
  }
  return result
}

function simulate(
  samples: Sample[],
  vehicle: DesignVehicle,
  direction: 'up' | 'down',
  bins: number,
  zone: Uint8Array,
): Run {
  const run: Run = {
    direction,
    wheelLeft: new Float64Array(bins).fill(-Infinity),
    wheelRight: new Float64Array(bins).fill(-Infinity),
    bodyLeft: new Float64Array(bins).fill(-Infinity),
    bodyRight: new Float64Array(bins).fill(-Infinity),
    offtracking: new Float64Array(bins).fill(-Infinity),
    articulation: new Float64Array(bins).fill(-Infinity),
  }
  const n = samples.length
  const order = (k: number) => (direction === 'up' ? k : n - 1 - k)
  const first = samples[order(0)],
    next = samples[order(1)]
  const len0 = Math.hypot(next.x - first.x, next.y - first.y) || 1
  const ux = (next.x - first.x) / len0,
    uy = (next.y - first.y) / len0
  // Start straight, every unit trailing along the first tangent.
  const fronts: XY[] = [],
    rears: XY[] = []
  let fx = first.x,
    fy = first.y
  for (const u of vehicle.units) {
    fronts.push([fx, fy])
    const rx = fx - ux * u.wheelbaseM,
      ry = fy - uy * u.wheelbaseM
    rears.push([rx, ry])
    fx = rx - ux * u.hitchOffsetM
    fy = ry - uy * u.hitchOffsetM
  }
  const half = vehicle.widthM / 2
  const length = totalLength(vehicle)
  const back = Math.ceil((length + vehicle.widthM + 10) / STEP),
    ahead = Math.ceil((vehicle.units[0].frontOverhangM + vehicle.widthM + 10) / STEP)
  const find = (k: number, x: number, y: number) => {
    const index = order(k)
    const hit =
      direction === 'up'
        ? locate(samples, x, y, index - back, index + ahead)
        : locate(samples, x, y, index - ahead, index + back)
    return { bin: Math.min(bins - 1, Math.floor(hit.s / BIN)), offset: hit.offset }
  }
  const record = (k: number, x: number, y: number, left: Float64Array, right: Float64Array) => {
    const { bin, offset } = find(k, x, y)
    if (offset > left[bin]) left[bin] = offset
    if (-offset > right[bin]) right[bin] = -offset
  }
  for (let k = 0; k < n; k++) {
    const steer = samples[order(k)]
    fronts[0] = [steer.x, steer.y]
    for (let i = 0; i < vehicle.units.length; i++) {
      const u = vehicle.units[i]
      const [Fx, Fy] = fronts[i],
        [Rx, Ry] = rears[i]
      const d = Math.hypot(Fx - Rx, Fy - Ry) || 1
      rears[i] = [Fx - ((Fx - Rx) / d) * u.wheelbaseM, Fy - ((Fy - Ry) / d) * u.wheelbaseM]
      if (i + 1 < vehicle.units.length) {
        const [nx, ny] = rears[i]
        fronts[i + 1] = [
          nx - ((Fx - nx) / u.wheelbaseM) * u.hitchOffsetM,
          ny - ((Fy - ny) / u.wheelbaseM) * u.hitchOffsetM,
        ]
      }
    }
    if ((k % RECORD_EVERY && k !== n - 1) || !zone[Math.min(bins - 1, Math.floor(steer.s / BIN))]) continue
    const axes = vehicle.units.map((u, i) => {
      const [Fx, Fy] = fronts[i],
        [Rx, Ry] = rears[i]
      return [(Fx - Rx) / u.wheelbaseM, (Fy - Ry) / u.wheelbaseM] as XY
    })
    vehicle.units.forEach((u, i) => {
      const [ax, ay] = axes[i],
        nx = -ay,
        ny = ax
      const [Fx, Fy] = fronts[i]
      const axles: XY[] = i === 0 ? [fronts[i], rears[i]] : [rears[i]]
      for (const [x, y] of axles) {
        record(k, x + nx * half, y + ny * half, run.wheelLeft, run.wheelRight)
        record(k, x - nx * half, y - ny * half, run.wheelLeft, run.wheelRight)
      }
      const bodyFrontX = Fx + ax * u.frontOverhangM,
        bodyFrontY = Fy + ay * u.frontOverhangM
      const bodyLength = u.frontOverhangM + u.wheelbaseM + u.rearOverhangM
      const pieces = Math.max(1, Math.ceil(bodyLength))
      for (let j = 0; j <= pieces; j++) {
        const along = (bodyLength * j) / pieces
        const x = bodyFrontX - ax * along,
          y = bodyFrontY - ay * along
        record(k, x + nx * half, y + ny * half, run.bodyLeft, run.bodyRight)
        record(k, x - nx * half, y - ny * half, run.bodyLeft, run.bodyRight)
      }
    })
    const last = rears.at(-1)!
    const tail = find(k, last[0], last[1])
    if (Math.abs(tail.offset) > run.offtracking[tail.bin]) run.offtracking[tail.bin] = Math.abs(tail.offset)
    const steerBin = Math.min(bins - 1, Math.floor(steer.s / BIN))
    for (let i = 1; i < axes.length; i++) {
      const cross = axes[i - 1][0] * axes[i][1] - axes[i - 1][1] * axes[i][0]
      const dot = axes[i - 1][0] * axes[i][0] + axes[i - 1][1] * axes[i][1]
      const angle = Math.abs(Math.atan2(cross, dot)) * (180 / Math.PI)
      if (angle > run.articulation[steerBin]) run.articulation[steerBin] = angle
    }
  }
  return run
}

const known = (value: number) => (Number.isFinite(value) ? value : null)

export function analyzeSweptPath(alignment: Alignment, check: VehicleCheck): SweptPathResult {
  validateVehicleCheck(check)
  const { vehicle } = check
  const centre = centrelineSamples(alignment, STEP)
  const { samples, length } = centre
  const warnings: string[] = []
  if (length < 1 || samples.length < 3)
    return {
      check,
      bins: [],
      maneuvers: [],
      fits: true,
      warnings: ['The road is too short to check.'],
      overlay: { type: 'FeatureCollection', features: [] },
    }
  const binCount = Math.max(1, Math.ceil(length / BIN))
  // A maneuver spans each fitted curve plus a vehicle length either side; overlapping spans merge,
  // so the two curves of a switchback are judged as one turn.
  const reach = totalLength(vehicle) + vehicle.widthM
  const curves = horizontalCurveSummary(alignment).map((c, i) => ({
    id: `H${i + 1}`,
    start: Math.max(0, c.fullStart - reach),
    end: Math.min(length, c.fullEnd + reach),
    signed: c.direction === 'left' ? c.deflectionDegrees : -c.deflectionDegrees,
  }))
  const groups: (typeof curves)[] = []
  for (const curve of curves) {
    const last = groups.at(-1)
    if (last && curve.start <= last.at(-1)!.end) last.push(curve)
    else groups.push([curve])
  }
  const zone = new Uint8Array(binCount)
  for (const group of groups)
    for (
      let b = Math.floor(group[0].start / BIN);
      b <= Math.min(binCount - 1, Math.ceil(Math.max(...group.map((c) => c.end)) / BIN));
      b++
    )
      zone[b] = 1
  // Positions are only recorded where a curve can affect them; straights need no record.
  const runs = (check.direction === 'both' ? (['up', 'down'] as const) : [check.direction]).map((direction) =>
    simulate(samples, vehicle, direction, binCount, zone),
  )
  const formation = Array.from({ length: binCount }, (_, b) =>
    effectiveWidths(alignment, Math.min(length, (b + 0.5) * BIN)),
  )
  const merged = (field: 'wheelLeft' | 'wheelRight' | 'bodyLeft' | 'bodyRight', b: number) =>
    known(Math.max(...runs.map((r) => r[field][b])))
  const bins: SweptBin[] = formation.map((f, b) => ({
    chainage: Math.min(length, (b + 0.5) * BIN),
    wheelLeftM: merged('wheelLeft', b),
    wheelRightM: merged('wheelRight', b),
    bodyLeftM: merged('bodyLeft', b),
    bodyRightM: merged('bodyRight', b),
    formationLeftM: f.leftWidth,
    formationRightM: f.rightWidth,
  }))

  const maneuvers: SweptManeuver[] = []
  for (const run of runs)
    for (const group of groups) {
      const start = group[0].start,
        end = Math.max(...group.map((c) => c.end))
      const lo = Math.floor(start / BIN),
        hi = Math.min(binCount - 1, Math.ceil(end / BIN))
      let wheelLeft = -Infinity,
        wheelRight = -Infinity,
        bodyLeft = -Infinity,
        bodyRight = -Infinity,
        formationLeft = Infinity,
        formationRight = Infinity,
        needLeft = 0,
        needRight = 0,
        beyondLeft = 0,
        beyondRight = 0,
        offtracking = 0,
        articulation = 0,
        worst = (start + end) / 2,
        worstScore = -Infinity
      for (let b = lo; b <= hi; b++) {
        const f = formation[b]
        const wl = run.wheelLeft[b],
          wr = run.wheelRight[b],
          bl = run.bodyLeft[b],
          br = run.bodyRight[b]
        if (Number.isFinite(wl)) {
          wheelLeft = Math.max(wheelLeft, wl)
          formationLeft = Math.min(formationLeft, f.leftWidth)
          needLeft = Math.max(needLeft, wl + check.clearanceM - f.leftWidth)
        }
        if (Number.isFinite(wr)) {
          wheelRight = Math.max(wheelRight, wr)
          formationRight = Math.min(formationRight, f.rightWidth)
          needRight = Math.max(needRight, wr + check.clearanceM - f.rightWidth)
        }
        if (Number.isFinite(bl)) {
          bodyLeft = Math.max(bodyLeft, bl)
          beyondLeft = Math.max(beyondLeft, bl - f.leftWidth)
        }
        if (Number.isFinite(br)) {
          bodyRight = Math.max(bodyRight, br)
          beyondRight = Math.max(beyondRight, br - f.rightWidth)
        }
        const score = Math.max(
          Number.isFinite(wl) ? wl + check.clearanceM - f.leftWidth : -Infinity,
          Number.isFinite(wr) ? wr + check.clearanceM - f.rightWidth : -Infinity,
        )
        if (score > worstScore) {
          worstScore = score
          worst = Math.min(length, (b + 0.5) * BIN)
        }
        if (Number.isFinite(run.offtracking[b])) offtracking = Math.max(offtracking, run.offtracking[b])
        if (Number.isFinite(run.articulation[b])) articulation = Math.max(articulation, run.articulation[b])
      }
      const round = (v: number) => Math.round(v * 1000) / 1000
      maneuvers.push({
        id: group.map((c) => c.id).join('+'),
        curveIds: group.map((c) => c.id),
        direction: run.direction,
        start,
        end,
        deflectionDegrees: group.reduce((sum, c) => sum + c.signed, 0),
        maxOfftrackingM: round(offtracking),
        maxArticulationDegrees: round(articulation),
        wheelLeftM: round(wheelLeft),
        wheelRightM: round(wheelRight),
        bodyLeftM: round(bodyLeft),
        bodyRightM: round(bodyRight),
        formationLeftM: round(formationLeft),
        formationRightM: round(formationRight),
        requiredLeftWideningM: round(Math.max(0, needLeft)),
        requiredRightWideningM: round(Math.max(0, needRight)),
        bodyBeyondLeftM: round(Math.max(0, beyondLeft)),
        bodyBeyondRightM: round(Math.max(0, beyondRight)),
        worstChainage: worst,
        fits: needLeft <= 1e-3 && needRight <= 1e-3,
      })
    }
  if (maneuvers.some((m) => m.maxArticulationDegrees > 80))
    warnings.push('Articulation exceeds 80° in a turn; check the vehicle can make it without jackknifing.')
  if (!groups.length) warnings.push('No fitted horizontal curves; the vehicle tracks the centreline.')

  // Plan lines: wheel and body envelopes inside curve zones, with wheel deficits drawn in red.
  const pointAt = (s: number, offset: number) => {
    const i = Math.min(samples.length - 2, Math.max(0, Math.floor(s / STEP)))
    const A = samples[i],
      B = samples[i + 1]
    const dx = B.x - A.x,
      dy = B.y - A.y,
      d = Math.hypot(dx, dy) || 1
    const t = Math.max(0, Math.min(1, (s - A.s) / (B.s - A.s || 1)))
    return centre.toCoordinate(A.x + dx * t - (dy / d) * offset, A.y + dy * t + (dx / d) * offset)
  }
  const features: GeoJSON.Feature[] = []
  const line = (coordinates: GeoJSON.Position[], properties: GeoJSON.GeoJsonProperties) => {
    if (coordinates.length > 1)
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties })
  }
  const traces: { field: keyof SweptBin; sign: 1 | -1; role: string; color: string; label: string }[] = [
    { field: 'wheelLeftM', sign: 1, role: 'swept-wheels', color: '#ea580c', label: 'Wheel path (left)' },
    { field: 'wheelRightM', sign: -1, role: 'swept-wheels', color: '#ea580c', label: 'Wheel path (right)' },
    { field: 'bodyLeftM', sign: 1, role: 'swept-body', color: '#7c3aed', label: 'Body and load (left)' },
    { field: 'bodyRightM', sign: -1, role: 'swept-body', color: '#7c3aed', label: 'Body and load (right)' },
  ]
  for (const trace of traces) {
    let current: GeoJSON.Position[] = []
    let deficit: GeoJSON.Position[] = []
    const flush = () => {
      line(current, { role: trace.role, color: trace.color, label: trace.label })
      current = []
    }
    const flushDeficit = () => {
      line(deficit, { role: 'swept-deficit', color: '#dc2626', selected: true, label: 'Wheels outside formation' })
      deficit = []
    }
    for (let b = 0; b < binCount; b++) {
      const value = bins[b][trace.field] as number | null
      if (!zone[b] || value === null) {
        flush()
        flushDeficit()
        continue
      }
      const coordinate = pointAt(bins[b].chainage, trace.sign * value)
      current.push(coordinate)
      const edge = trace.sign > 0 ? bins[b].formationLeftM : bins[b].formationRightM
      if (trace.role === 'swept-wheels' && value + check.clearanceM > edge + 1e-3) deficit.push(coordinate)
      else flushDeficit()
    }
    flush()
    flushDeficit()
  }
  return {
    check,
    bins,
    maneuvers,
    fits: maneuvers.every((m) => m.fits),
    warnings,
    overlay: { type: 'FeatureCollection', features },
  }
}

/** True for a swept-path plan feature, so other overlays can be told apart. */
export const isSweptFeature = (feature: GeoJSON.Feature) =>
  ['swept-wheels', 'swept-body', 'swept-deficit'].includes(String(feature.properties?.role))

export const unitLabel = (u: VehicleUnit, index: number) => u.name || `Unit ${index + 1}`
