/**
 * The surface a road leaves behind: existing ground with the road prism (formation, ditches,
 * cut and fill batters out to the catch points) burned into a {@link SurfaceGrid}. Culverts are
 * carved through the prism so the hydrology run can pass water under the road.
 * Pure: projection is passed in, no DOM or network access.
 */
import { offsetCoordinate } from './engine'
import type { Culvert, RoadAnalysis, RoadStation } from './types'
import { cellIndexAt, cloneSurfaceGrid, type SurfaceGrid, type ToGrid } from './surfaceGrid'

const EPS = 1e-9
/** Template parameters of the longitudinal lines burned as minima: ditch bottom and catch line. */
const BREAK_LINES = [2, 3]

/** Stations in grid metres, for chainage/offset lookups of grid cells. Offsets are negative left. */
export interface RoadFrame {
  x: Float64Array
  y: Float64Array
  chainage: Float64Array
  /** Nearest point on the station polyline: chainage, signed offset (negative left) and distance. */
  locate(x: number, y: number): { chainage: number; offset: number; distance: number }
  /** Grid position and unit up-station direction at a chainage, clamped to the road. */
  at(chainage: number): { x: number; y: number; dx: number; dy: number }
}

export function roadFrame(analysis: RoadAnalysis, toGrid: ToGrid): RoadFrame {
  const n = analysis.stations.length
  const x = new Float64Array(n),
    y = new Float64Array(n),
    chainage = new Float64Array(n)
  analysis.stations.forEach((s, i) => {
    const p = toGrid(s.coordinate)
    x[i] = p[0]
    y[i] = p[1]
    chainage[i] = s.chainage
  })
  const direction = (i: number): [number, number] => {
    // A lone station has no segment; fall back to its bearing (grid convergence ignored).
    if (n < 2) {
      const b = ((analysis.stations[0]?.bearing ?? 0) * Math.PI) / 180
      return [Math.sin(b), Math.cos(b)]
    }
    const a = Math.min(i, n - 2)
    const dx = x[a + 1] - x[a],
      dy = y[a + 1] - y[a],
      length = Math.hypot(dx, dy) || 1
    return [dx / length, dy / length]
  }
  return {
    x,
    y,
    chainage,
    locate(px, py) {
      let best = Infinity,
        result = { chainage: chainage[0] ?? 0, offset: 0, distance: Infinity }
      if (n === 1) {
        const [dx, dy] = direction(0)
        const ox = px - x[0],
          oy = py - y[0]
        return { chainage: chainage[0] + ox * dx + oy * dy, offset: ox * dy - oy * dx, distance: Math.hypot(ox, oy) }
      }
      for (let i = 0; i + 1 < n; i++) {
        const sx = x[i + 1] - x[i],
          sy = y[i + 1] - y[i],
          length2 = sx * sx + sy * sy
        const t = length2 > EPS ? Math.max(0, Math.min(1, ((px - x[i]) * sx + (py - y[i]) * sy) / length2)) : 0
        const qx = x[i] + sx * t,
          qy = y[i] + sy * t,
          d2 = (px - qx) ** 2 + (py - qy) ** 2
        if (d2 < best) {
          best = d2
          const length = Math.sqrt(length2) || 1
          result = {
            chainage: chainage[i] + (chainage[i + 1] - chainage[i]) * t,
            offset: ((px - x[i]) * sy - (py - y[i]) * sx) / length,
            distance: Math.sqrt(d2),
          }
        }
      }
      return result
    },
    at(s) {
      if (n === 0) return { x: NaN, y: NaN, dx: 0, dy: 1 }
      let i = 0
      while (i + 2 < n && chainage[i + 1] < s) i++
      const [dx, dy] = direction(i)
      if (n === 1) return { x: x[0], y: y[0], dx, dy }
      const span = chainage[i + 1] - chainage[i]
      const t = span > EPS ? Math.max(0, Math.min(1, (s - chainage[i]) / span)) : 0
      return { x: x[i] + (x[i + 1] - x[i]) * t, y: y[i] + (y[i + 1] - y[i]) * t, dx, dy }
    },
  }
}

/**
 * One side of a station's designed section, from the centreline out to its catch point, keyed by a
 * template parameter `u`: 0 centreline, 1 formation edge, 2 lowest point outside the edge (the
 * ditch bottom in cut, the catch point in fill), 3 catch point. Joining two stations at equal `u`
 * keeps the formation edges, ditch bottoms and catch lines continuous between them even where the
 * daylight width changes, instead of joining equal offsets and smearing a ditch onto a batter.
 */
interface SideProfile {
  u: Float64Array
  d: Float64Array
  z: Float64Array
  /** A low line lies inside the catch point: a ditch bottom, or the formation edge against a cut slope. */
  ditch: boolean
  /** The catch line is a valley: fill falling outward onto ground that rises beyond it (an uphill toe). */
  toeValley: boolean
}
interface StationGeometry {
  x: number
  y: number
  /** Grid metres per metre of offset, towards the left (negative offsets) and right. */
  left: [number, number]
  right: [number, number]
  sides: [SideProfile | null, SideProfile | null]
}

function sideProfile(
  samples: { d: number; z: number }[],
  width: number,
  beyondGround: number | null,
): SideProfile | null {
  if (samples.length < 2) return null
  const extent = samples[samples.length - 1].d
  const zAt = (d: number) => {
    for (let i = 1; i < samples.length; i++)
      if (d <= samples[i].d + EPS) {
        const a = samples[i - 1],
          b = samples[i]
        return b.d - a.d > EPS ? a.z + ((b.z - a.z) * (d - a.d)) / (b.d - a.d) : b.z
      }
    return samples[samples.length - 1].z
  }
  const edge = Math.min(Math.max(0, width), extent),
    edgeZ = zAt(edge)
  let low = edge,
    lowZ = edgeZ - EPS
  for (const p of samples)
    if (p.d > edge + EPS && p.z < lowZ) {
      low = p.d
      lowZ = p.z
    }
  const knots = [0, edge, low, extent]
  const u: number[] = [],
    d: number[] = [],
    z: number[] = []
  for (let seg = 0; seg < 3; seg++) {
    const a = knots[seg],
      b = knots[seg + 1]
    if (b - a < EPS) {
      u.push(seg)
      d.push(a)
      z.push(zAt(a))
      continue
    }
    if (!samples.some((p) => Math.abs(p.d - a) < EPS)) {
      u.push(seg)
      d.push(a)
      z.push(zAt(a))
    }
    for (const p of samples)
      if (p.d > a - EPS && p.d < b - EPS) {
        u.push(seg + (p.d - a) / (b - a))
        d.push(p.d)
        z.push(p.z)
      }
  }
  u.push(3)
  d.push(extent)
  const catchZ = samples[samples.length - 1].z
  z.push(catchZ)
  return {
    u: Float64Array.from(u),
    d: Float64Array.from(d),
    z: Float64Array.from(z),
    ditch: low < extent - EPS,
    toeValley: catchZ < samples[samples.length - 2].z - 1e-3 && beyondGround !== null && beyondGround > catchZ + 1e-3,
  }
}

function stationGeometry(station: RoadStation, toGrid: ToGrid): StationGeometry | null {
  const section = station.section
  const centre = section.findIndex((p) => Math.abs(p.offset) < 1e-7)
  if (centre < 0 || station.designElevation === null || !Number.isFinite(section[centre].design ?? NaN)) return null
  const run = (step: -1 | 1) => {
    const out: { d: number; z: number }[] = []
    let i = centre
    for (; i >= 0 && i < section.length; i += step) {
      const sample = section[i]
      // Outside the constructed prism, stripping margins still lower the final terrain.
      const z = sample.design ?? (sample.preparedGround != null && sample.ground != null &&
        sample.preparedGround < sample.ground - EPS ? sample.preparedGround : null)
      if (z === null || !Number.isFinite(z)) break
      out.push({ d: Math.abs(section[i].offset), z })
    }
    const beyond = section[i]?.ground
    return { samples: out, beyond: beyond != null && Number.isFinite(beyond) ? beyond : null }
  }
  const left = run(-1),
    right = run(1),
    leftSamples = left.samples,
    rightSamples = right.samples
  const reach = Math.max(1, leftSamples[leftSamples.length - 1].d, rightSamples[rightSamples.length - 1].d)
  const [x, y] = toGrid(station.coordinate)
  // Each side's direction is projected separately: on a projected grid, ±offset is not exactly symmetric.
  const towards = (sign: number): [number, number] => {
    const p = toGrid(offsetCoordinate(station.coordinate, station.bearing + 90, sign * reach))
    return [(p[0] - x) / reach, (p[1] - y) / reach]
  }
  return {
    x,
    y,
    left: towards(-1),
    right: towards(1),
    sides: [
      sideProfile(leftSamples, station.leftWidth, left.beyond),
      sideProfile(rightSamples, station.rightWidth, right.beyond),
    ],
  }
}

/** Linear interpolation of a side profile at template parameter `u`, writing [d, z] into `out`. */
function profileAt(p: SideProfile, u: number, out: Float64Array) {
  let lo = 0,
    hi = p.u.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (p.u[mid] <= u) lo = mid
    else hi = mid
  }
  const span = p.u[hi] - p.u[lo],
    t = span > EPS ? Math.max(0, Math.min(1, (u - p.u[lo]) / span)) : 0
  out[0] = p.d[lo] + (p.d[hi] - p.d[lo]) * t
  out[1] = p.z[lo] + (p.z[hi] - p.z[lo]) * t
}

function mergedU(a: Float64Array, b: Float64Array): number[] {
  const out: number[] = []
  let i = 0,
    j = 0
  while (i < a.length || j < b.length) {
    const v = j >= b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++]
    if (!out.length || v - out[out.length - 1] > 1e-9) out.push(v)
  }
  return out
}

export interface CulvertChannel {
  id: string
  /** Carved cells, ordered inlet (left) to outlet (right), including the aprons beyond the barrel. */
  cells: Int32Array
  /** The subset of `cells` along the barrel itself, across the footprint. */
  barrel: Int32Array
  inletZ: number
  outletZ: number
  /** True when an invert was missing and the channel was set from the ground at its ends. */
  assumedInverts: boolean
}
export interface BurnedSurface {
  /** A copy of the input grid with the prism and culvert channels burned in. */
  surface: SurfaceGrid
  /** 1 where the road prism replaced the ground. */
  footprint: Uint8Array
  /** Cells whose elevation moved by more than a millimetre (prism and culvert channels). */
  changedCells: number
  channels: CulvertChannel[]
}

/**
 * Burn the designed sections into a copy of `grid`. Consecutive stations are joined into
 * triangles at matching template parameters (see {@link SideProfile}); every cell whose centre
 * falls in a triangle takes its barycentric design elevation. Only stations with a finite design
 * at the centreline contribute, and each side stops at its last finite design sample, so ground
 * beyond the catch points is never touched. Where strips overlap on the inside of a tight curve,
 * the part nearer the centreline in template terms wins.
 *
 * Then the lowest longitudinal break lines — each side's ditch bottom (u = 2) and catch line
 * (u = 3, the fill toe) — are burned as continuous 8-connected minima: sampled every half cell,
 * each touched cell is lowered to the line's elevation. The ditch line is burned where a ditch
 * (or a cut slope against the formation edge) lies inside the catch, the catch line only where it
 * is a valley — fill falling onto ground that rises beyond it — since elsewhere water leaves the
 * prism across it and lowering cells would only shave up to half a cell of batter. A cell the
 * catch line crosses straddles the prism edge, so where the line is below its centre's ground it
 * is lowered and joins the footprint; a cell wholly beyond the catch line is never touched. A V ditch is narrower than a
 * cell, so cell centres alone sample its side slopes at heights that vary along a line skewed to
 * the grid, which leaves a staircase of pits instead of a channel; the fill toe on an uphill side
 * aliases the same way against the ground. Both lines are triangle edges already, so this only
 * repairs sampling and never cuts below the triangulated design.
 *
 * Culverts are carved afterwards, see {@link carveCulvert}.
 */
export function burnRoad(
  grid: SurfaceGrid,
  analysis: RoadAnalysis,
  toGrid: ToGrid,
  { culverts = [], apronM = 10 }: { culverts?: Culvert[]; apronM?: number } = {},
): BurnedSurface {
  const surface = cloneSurfaceGrid(grid)
  const values = surface.values,
    n = values.length,
    w = grid.width,
    h = grid.height,
    cell = grid.cellM,
    [ox, oy] = grid.origin
  const footprint = new Uint8Array(n),
    rank = new Float64Array(n).fill(Infinity)

  const triangle = (
    ax: number,
    ay: number,
    az: number,
    au: number,
    bx: number,
    by: number,
    bz: number,
    bu: number,
    cx: number,
    cy: number,
    cz: number,
    cu: number,
  ) => {
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (Math.abs(area) < 1e-12) return
    const tolerance = -1e-9 * Math.abs(area)
    const c0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - ox) / cell - 1e-9)),
      c1 = Math.min(w - 1, Math.floor((Math.max(ax, bx, cx) - ox) / cell + 1e-9)),
      r0 = Math.max(0, Math.ceil((oy - Math.max(ay, by, cy)) / cell - 1e-9)),
      r1 = Math.min(h - 1, Math.floor((oy - Math.min(ay, by, cy)) / cell + 1e-9))
    for (let row = r0; row <= r1; row++) {
      const py = oy - row * cell
      for (let col = c0; col <= c1; col++) {
        const px = ox + col * cell
        // Edge functions, signed like `area`, so the weights are positive inside either winding.
        const wa = (bx - px) * (cy - py) - (by - py) * (cx - px),
          wb = (cx - px) * (ay - py) - (cy - py) * (ax - px),
          wc = (ax - px) * (by - py) - (ay - py) * (bx - px)
        if (
          area > 0
            ? wa < tolerance || wb < tolerance || wc < tolerance
            : wa > -tolerance || wb > -tolerance || wc > -tolerance
        )
          continue
        const i = row * w + col,
          u = (wa * au + wb * bu + wc * cu) / area
        if (u >= rank[i] - 1e-9) continue
        rank[i] = u
        values[i] = (wa * az + wb * bz + wc * cz) / area
        footprint[i] = 1
      }
    }
  }

  const burnLine = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 2)))
    for (let k = 0; k <= steps; k++) {
      const t = k / steps,
        i = cellIndexAt(grid, ax + (bx - ax) * t, ay + (by - ay) * t)
      if (i < 0) continue
      const z = az + (bz - az) * t
      if (z < values[i]) {
        values[i] = z
        footprint[i] = 1
      }
    }
  }

  const geometry = analysis.stations.map((s) => stationGeometry(s, toGrid))
  const pa = new Float64Array(2),
    pb = new Float64Array(2),
    qa = new Float64Array(2),
    qb = new Float64Array(2)
  for (let k = 1; k < geometry.length; k++) {
    const A = geometry[k - 1],
      B = geometry[k]
    if (!A || !B) continue
    for (let side = 0; side < 2; side++) {
      const sa = A.sides[side],
        sb = B.sides[side]
      if (!sa || !sb) continue
      const da = side ? A.right : A.left,
        db = side ? B.right : B.left
      const us = mergedU(sa.u, sb.u)
      profileAt(sa, us[0], pa)
      profileAt(sb, us[0], pb)
      for (let j = 1; j < us.length; j++) {
        profileAt(sa, us[j], qa)
        profileAt(sb, us[j], qb)
        const a0x = A.x + da[0] * pa[0],
          a0y = A.y + da[1] * pa[0],
          a1x = A.x + da[0] * qa[0],
          a1y = A.y + da[1] * qa[0],
          b0x = B.x + db[0] * pb[0],
          b0y = B.y + db[1] * pb[0],
          b1x = B.x + db[0] * qb[0],
          b1y = B.y + db[1] * qb[0]
        triangle(a0x, a0y, pa[1], us[j - 1], a1x, a1y, qa[1], us[j], b1x, b1y, qb[1], us[j])
        triangle(a0x, a0y, pa[1], us[j - 1], b1x, b1y, qb[1], us[j], b0x, b0y, pb[1], us[j - 1])
        pa.set(qa)
        pb.set(qb)
      }
      for (const u of BREAK_LINES) {
        // Only lines water runs along: elsewhere lowering cells would only erode the batter.
        if (u === 2 ? !(sa.ditch || sb.ditch) : !(sa.toeValley || sb.toeValley)) continue
        profileAt(sa, u, pa)
        profileAt(sb, u, pb)
        burnLine(A.x + da[0] * pa[0], A.y + da[1] * pa[0], pa[1], B.x + db[0] * pb[0], B.y + db[1] * pb[0], pb[1])
      }
    }
  }

  const frame = roadFrame(analysis, toGrid)
  const channels = culverts
    .filter((c) => c.chainage >= -EPS && c.chainage <= analysis.length + EPS)
    .map((c) => carveCulvert(surface, grid, footprint, frame, c, apronM))
    .filter((c): c is CulvertChannel => c !== null)

  let changedCells = 0
  for (let i = 0; i < n; i++) {
    const before = grid.values[i],
      after = values[i]
    if (Number.isNaN(before) ? !Number.isNaN(after) : Math.abs(after - before) > 1e-3) changedCells++
  }
  return { surface, footprint, changedCells, channels }
}

/**
 * A planning simplification of a culvert: a one-cell-wide channel along the barrel line (through
 * the chainage on the centreline, rotated by the skew from the right-facing perpendicular), long
 * enough to cross the whole footprint even when the entered barrel is shorter. Along it the
 * surface is lowered to the invert, interpolated inlet (left) → outlet (right) and held flat past
 * the barrel ends. With an invert missing, the channel is flat at the lower ground of its two ends
 * less 0.3 m. Beyond each end an apron of up to `apronM` is cut at the end invert until the
 * original ground falls below it, so the outlet does not read as a buried pit. Pipe capacity is
 * not modelled here: the channel passes any flow (see `hydrology.ts` for the size check).
 */
export function carveCulvert(
  surface: SurfaceGrid,
  original: SurfaceGrid,
  footprint: Uint8Array,
  frame: RoadFrame,
  culvert: Culvert,
  apronM = 10,
): CulvertChannel | null {
  const p = frame.at(culvert.chainage)
  if (!Number.isFinite(p.x)) return null
  const phi = (culvert.skewDegrees * Math.PI) / 180
  // Right-facing perpendicular (dy, −dx), turned clockwise by the skew.
  const rx = p.dy,
    ry = -p.dx
  const vx = rx * Math.cos(phi) + ry * Math.sin(phi),
    vy = -rx * Math.sin(phi) + ry * Math.cos(phi)
  const step = surface.cellM / 2,
    half = Math.max(0, culvert.lengthM / 2),
    limit = half + 200
  const indexAt = (a: number) => cellIndexAt(surface, p.x + vx * a, p.y + vy * a)
  // Extend each way to the barrel end, then on while still inside the footprint.
  const reach = (sign: number) => {
    let a = 0
    while (a + step <= limit) {
      const next = a + step,
        i = indexAt(sign * next)
      if (i < 0) break
      if (next > half && !footprint[i]) break
      a = next
    }
    return a
  }
  const back = reach(-1),
    ahead = reach(1)
  const groundAt = (a: number) => {
    const i = indexAt(a)
    if (i < 0) return NaN
    return Number.isFinite(original.values[i]) ? original.values[i] : surface.values[i]
  }
  const known =
    culvert.inletInvertM !== null &&
    culvert.outletInvertM !== null &&
    Number.isFinite(culvert.inletInvertM) &&
    Number.isFinite(culvert.outletInvertM) &&
    culvert.lengthM > 0
  let inletZ: number, outletZ: number
  if (known) {
    inletZ = culvert.inletInvertM!
    outletZ = culvert.outletInvertM!
  } else {
    const ends = [groundAt(-back), groundAt(ahead)].filter(Number.isFinite)
    if (!ends.length) return null
    inletZ = outletZ = Math.min(...ends) - 0.3
  }
  const zAt = (a: number) => {
    if (!known) return inletZ
    const t = Math.max(0, Math.min(1, (a + half) / culvert.lengthM))
    return inletZ + (outletZ - inletZ) * t
  }
  const apron = (sign: number, from: number, z: number) => {
    let a = from
    while (a + step <= from + apronM) {
      const i = indexAt(sign * (a + step))
      if (i < 0 || !(original.values[i] > z)) break
      a += step
    }
    return a
  }
  const startA = -apron(-1, back, zAt(-back)),
    endA = apron(1, ahead, zAt(ahead))
  const cells: number[] = [],
    barrel: number[] = []
  const values = surface.values
  for (let a = startA; a <= endA + EPS; a += step) {
    const i = indexAt(a)
    if (i < 0 || cells[cells.length - 1] === i) continue
    cells.push(i)
    const inBarrel = a >= -back - EPS && a <= ahead + EPS
    if (inBarrel) barrel.push(i)
    const z = inBarrel ? zAt(a) : a < 0 ? zAt(-back) : zAt(ahead)
    if (!(values[i] <= z)) values[i] = z
  }
  return {
    id: culvert.id,
    cells: Int32Array.from(cells),
    barrel: Int32Array.from(barrel),
    inletZ,
    outletZ,
    assumedInverts: !known,
  }
}
