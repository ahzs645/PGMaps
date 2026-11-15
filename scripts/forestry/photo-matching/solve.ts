/**
 * Stage 4: solve the camera from the skyline plus control features the person placed (`controls`):
 *   points — a photo pixel and its map position (`lngLat`), or `peakNear`: the highest ground near where it lands;
 *   lines  — photo pixels that lie on a mapped line or outline (streams, FTEN or atlas roads, lake or wetland edges,
 *            cutblock edges), measured as distance to the nearest projected line.
 * Levenberg–Marquardt over east, north, height, heading, pitch, roll and field of view, with a weak prior on the
 * GPS position (σ 25 m across, 30 m up). Each control group is then left out in turn and its error measured with the
 * camera solved without it: the honest accuracy. Stores `results.poses.solved` and `results.solve`.
 *
 * `--hold hfov,roll` keeps the named values (east, north, up, heading, pitch, roll, hfov) at the starting camera's.
 * Hold the lens when the controls bunch at one edge or distance: a near shore at the frame's edge otherwise narrows
 * the lens to chase a few metres of mapping difference.
 *
 *   node --import tsx scripts/forestry/photo-matching/solve.ts <case.json> [--hold hfov] [--use]
 */
import { cameraAxes as cameraAxesOf } from '../../../src/pages/dev-forestry/photoPose'
import { castRay, layer, metres, poseFrom, project, rings, terrainFor, wedge, type LngLat, type Pose, type Source } from './lib/geo'
import { fmt, readCase, readSkyline, workFrame, writeCase, type PoseRecord } from './lib/photo'

const c = readCase(process.argv[2])
const start = c.pose
if (!start || !c.controls) throw Error('Needs a pose (orient.ts) and `controls` in the case file.')
const frame = await workFrame(c.photo, c.metadata)
const src: Source = await terrainFor(start.lng, start.lat, start.bearing)
const m = metres(start.lat)
const poseOf = (p: number[]): Pose => poseFrom({ lng: start.lng + p[0] / m.x, lat: start.lat + p[1] / m.y, alt: start.alt + p[2], bearing: p[3], pitch: p[4], roll: p[5], hfov: p[6], width: frame.width, height: frame.height })
const p0 = [0, 0, 0, start.bearing, start.pitch, start.roll, start.hfov]

// Mapped lines, densified with their ground heights.
const box = wedge(start.lng, start.lat, start.bearing, 8000, 32)
const year = new Date().getFullYear()
const lineSets: Record<string, LngLat[][]> = {
  streams: rings(await layer('streams', box, ' AND STREAM_ORDER>=2')),
  ftenRoads: rings(await layer('ftenRoads', box)),
  draRoads: rings(await layer('draRoads', box)),
  lakes: rings([...(await layer('lakes', box)), ...(await layer('rivers', box))]),
  wetlands: rings(await layer('wetlands', box)),
  cutblocks: rings((await layer('cutblocks', box)).filter((f) => (f.properties?.HARVEST_START_YEAR_CALENDAR ?? 0) >= year - 30)),
}
const dense: Record<string, number[][][]> = {}
for (const [k, ls] of Object.entries(lineSets)) {
  dense[k] = ls.map((l) => {
    const out: number[][] = []
    for (let i = 1; i < l.length; i++) {
      const [a, b] = [l[i - 1], l[i]]
      const n = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * m.x, (b[1] - a[1]) * m.y) / 15))
      for (let s = 0; s < n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n])
    }
    out.push(l[l.length - 1])
    return out.map(([x, y]) => [x, y, src.elevationAt(x, y)])
  })
}

// Point controls; `peakNear` resolves to the highest post within 400 m of where the pixel (4 px into the ground) lands.
const points = (c.controls.points ?? []).map((pt) => {
  if (pt.lngLat) return { ...pt, at: [pt.lngLat[0], pt.lngLat[1], src.elevationAt(pt.lngLat[0], pt.lngLat[1])] }
  const hit = castRay(poseOf(p0), src, pt.pixel[0], pt.pixel[1] + 4)
  if (!hit) throw Error(`${pt.name}: its pixel does not reach the ground`)
  let best = [hit.lng, hit.lat, -Infinity]
  for (let dx = -400; dx <= 400; dx += 10) for (let dy = -400; dy <= 400; dy += 10) {
    const x = hit.lng + dx / m.x, y = hit.lat + dy / m.y, z = src.elevationAt(x, y)
    if (z > best[2]) best = [x, y, z]
  }
  return { ...pt, at: best }
})

// Skyline columns, compared in angle against the terrain at each trial position.
const sky = readSkyline(c, frame, 40).filter((p): p is { x: number; y: number } => !!p)
function skylineResiduals(pose: Pose): number[] {
  const { right, down, forward } = cameraAxesOf(pose)
  return sky.map((p) => {
    const nx = (p.x - pose.width / 2) / pose.focalPx, ny = (p.y - pose.height / 2) / pose.focalPx
    const e = forward[0] + nx * right[0] + ny * down[0], n = forward[1] + nx * right[1] + ny * down[1], u = forward[2] + nx * right[2] + ny * down[2]
    const az = Math.atan2(e, n), el = Math.atan2(u, Math.hypot(e, n))
    let best = -Infinity
    for (let d = 300; d < 80000; d *= 1.02) {
      const z = src.elevationAt(pose.lng + (Math.sin(az) * d) / m.x, pose.lat + (Math.cos(az) * d) / m.y)
      if (!Number.isFinite(z)) break
      best = Math.max(best, Math.atan2(z - pose.altitudeMeters - ((d * d) / (2 * 6371000)) * 0.87, d))
    }
    const px = Number.isFinite(best) ? (el - best) * pose.focalPx : 0
    return Math.max(-15, Math.min(15, px))
  })
}

function lineDistance(pose: Pose, lines: number[][][], u: number, v: number, radius = 150) {
  let best = Infinity
  for (const l of lines) {
    let prev: { x: number; y: number } | null = null
    for (const [x, y, z] of l) {
      const q = project(pose, x, y, z)
      if (q && prev && Math.abs(q.x - u) < radius && Math.abs(q.y - v) < radius) {
        const dx = q.x - prev.x, dy = q.y - prev.y, L = dx * dx + dy * dy
        const t = L ? Math.max(0, Math.min(1, ((u - prev.x) * dx + (v - prev.y) * dy) / L)) : 0
        best = Math.min(best, Math.hypot(prev.x + t * dx - u, prev.y + t * dy - v))
      }
      prev = q
    }
  }
  return Number.isFinite(best) ? best : 60
}

type Group = { name: string; residuals(pose: Pose): number[]; error(pose: Pose): number }
const groups: Group[] = [
  ...points.map((pt) => ({
    name: pt.name,
    residuals: (pose: Pose) => {
      const q = project(pose, pt.at[0], pt.at[1], pt.at[2])
      return q ? [q.x - pt.pixel[0], q.y - pt.pixel[1]] : [200, 200]
    },
    error: (pose: Pose) => {
      const q = project(pose, pt.at[0], pt.at[1], pt.at[2])
      return q ? Math.hypot(q.x - pt.pixel[0], q.y - pt.pixel[1]) : Infinity
    },
  })),
  ...(c.controls.lines ?? []).map((line) => ({
    name: line.name,
    residuals: (pose: Pose) => line.pixels.map(([u, v]) => lineDistance(pose, dense[line.layer], u, v)),
    error: (pose: Pose) => {
      const d = line.pixels.map(([u, v]) => lineDistance(pose, dense[line.layer], u, v))
      return Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length)
    },
  })),
]
function residuals(p: number[], use: Group[]) {
  const pose = poseOf(p)
  const r = skylineResiduals(pose).map((v) => 0.5 * v)
  for (const g of use) r.push(...g.residuals(pose))
  r.push(p[0] / 25, p[1] / 25, p[2] / 30)
  return r
}
const steps = [2, 2, 2, 0.02, 0.02, 0.02, 0.02]
const NAMES = ['east', 'north', 'up', 'heading', 'pitch', 'roll', 'hfov']
const holdArg = process.argv.includes('--hold') ? process.argv[process.argv.indexOf('--hold') + 1] : ''
const held = new Set(holdArg.split(',').filter(Boolean).map((name) => {
  const i = NAMES.indexOf(name)
  if (i < 0) throw Error(`--hold: unknown value "${name}" (use ${NAMES.join(', ')})`)
  return i
}))
function gauss(A: number[][], b: number[]) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    ;[M[col], M[piv]] = [M[piv], M[col]]
    for (let r = 0; r < n; r++) if (r !== col) {
      const f = M[r][col] / M[col][col]
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}
function solve(use: Group[]) {
  let p = [...p0], lambda = 1e-2
  let r = residuals(p, use), cost = r.reduce((s, v) => s + v * v, 0)
  for (let it = 0; it < 30; it++) {
    const J = steps.map((h, j) => {
      if (held.has(j)) return r.map(() => 0)
      const q = [...p]
      q[j] += h
      const rq = residuals(q, use)
      return rq.map((v, i) => (v - r[i]) / h)
    })
    const n = p.length
    const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => J[i].reduce((s, v, k) => s + v * J[j][k], 0)))
    const b = Array.from({ length: n }, (_, i) => -J[i].reduce((s, v, k) => s + v * r[k], 0))
    for (const j of held) {
      A[j][j] = 1
      b[j] = 0
    }
    let improved = false
    for (let tries = 0; tries < 6 && !improved; tries++) {
      const dx = gauss(A.map((row, i) => row.map((v, j) => v + (i === j ? lambda * (A[i][i] + 1e-6) : 0))), b)
      const q = p.map((v, i) => v + dx[i])
      const rq = residuals(q, use), cq = rq.reduce((s, v) => s + v * v, 0)
      if (cq < cost) {
        p = q
        r = rq
        cost = cq
        lambda /= 3
        improved = true
      } else lambda *= 4
    }
    if (!improved) break
  }
  return p
}
const skyMedian = (pose: Pose) => {
  const s = skylineResiduals(pose).map(Math.abs).sort((a, b) => a - b)
  return s[s.length >> 1]
}
// Ground equivalent of a pixel error at a control: metres across the view per pixel at its distance.
const metresPerPx = (pose: Pose, g: Group) => {
  const pt = points.find((p) => p.name === g.name)
  const line = c.controls!.lines?.find((l) => l.name === g.name)
  const px = pt ? pt.pixel : line ? line.pixels[Math.floor(line.pixels.length / 2)] : null
  const hit = px ? castRay(pose, src, px[0], px[1] + (pt?.peakNear ? 4 : 0)) : null
  return hit ? hit.distance / pose.focalPx : NaN
}

const startPose = poseOf(p0)
const all = solve(groups)
const solved = poseOf(all)
const rows = groups.map((g) => {
  const without = poseOf(solve(groups.filter((x) => x !== g)))
  return { name: g.name, start: g.error(startPose), fitted: g.error(solved), heldOut: g.error(without), mPerPx: metresPerPx(solved, g) }
})
const poses = (c.results?.poses as Record<string, PoseRecord> | undefined) ?? {}
poses.solved = { lng: solved.lng, lat: solved.lat, alt: solved.altitudeMeters, bearing: solved.bearing, pitch: solved.pitch, roll: solved.roll, hfov: all[6], source: `solve (skyline + controls${held.size ? `; held ${[...held].map((i) => NAMES[i]).join(', ')}` : ''})` }
c.results = { ...c.results, poses, solve: { shift: { eastM: all[0], northM: all[1], upM: all[2] }, skylineMedianPx: { start: skyMedian(startPose), solved: skyMedian(solved) }, groups: rows } }
if (process.argv.includes('--use')) c.pose = poses.solved
writeCase(c)

console.log(`start: ${fmt(start.bearing, 2)}° / ${fmt(start.pitch, 2)}° / roll ${fmt(start.roll, 2)}° / hfov ${fmt(start.hfov, 2)}°`)
console.log(`solved: moved ${fmt(all[0], 0)} m east, ${fmt(all[1], 0)} m north, ${fmt(all[2], 0)} m up; ${fmt(all[3], 2)}° / ${fmt(all[4], 2)}° / roll ${fmt(all[5], 2)}° / hfov ${fmt(all[6], 2)}°`)
console.log(`skyline median ${fmt(skyMedian(startPose))} px at start, ${fmt(skyMedian(solved))} px solved (${sky.length} columns)`)
console.log('group'.padEnd(22), 'start px', ' fitted px', ' held out px', ' ≈ m across at held-out')
for (const r of rows) console.log(r.name.padEnd(22), fmt(r.start).padStart(8), fmt(r.fitted).padStart(10), fmt(r.heldOut).padStart(12), fmt(r.heldOut * r.mPerPx).padStart(10))
