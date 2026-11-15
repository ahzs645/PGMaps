/**
 * Stage 2b: orientation from what the photo shows, for photos with too little skyline. The person marks regions
 * of the photo as sky, water, open (harvested, fen, meadow) or forest (`masks` in the case file). With the camera
 * held at its position, every viewing direction is cast once against the terrain and classed from the map:
 *   water — FWA lakes and rivers; open — cutblocks of the last OPEN_YEARS, FWA wetlands, or brown in the imagery;
 *   forest — any other ground; sky — no ground within reach. A region marked `land` is any ground but water, and
 *   suits the unmarked rest of a frame (`masks.default`) where the photo shows no water.
 * Each candidate heading/pitch/roll is then scored by balanced class agreement over the marked regions. The best
 * poses are refined, kept apart by at least 10°, and written to `results.poses` as `classes-1`, `classes-2`, …
 *
 *   node --import tsx scripts/forestry/photo-matching/classes.ts <case.json>
 */
import { join } from 'node:path'
import { cameraAxes } from '../../../src/pages/dev-forestry/photoPose'
import { boundsAround, createCanvas, dem, imagery, inRing, layer, layered, metres, poseFrom, rings, saveJpeg, type LngLat, type Source } from './lib/geo'
import { fmt, readCase, workFrame, writeCase, type PoseRecord, type Px } from './lib/photo'

const RAD = Math.PI / 180
const OPEN_YEARS = 6
const CELL = 5
const CLASSES = ['sky', 'water', 'open', 'forest', 'unknown'] as const
type Cls = (typeof CLASSES)[number]
/** A photo label only: any ground but water. */
const LAND = CLASSES.length

const c = readCase(process.argv[2])
const o = c.observation
if (!o || !c.masks) throw Error('Needs read-photo.ts and `masks` in the case file.')
const frame = await workFrame(c.photo, c.metadata)
const ground = (c.results?.ground as { elevation: number } | undefined)?.elevation ?? NaN
const alt = c.platform === 'ground' ? ground + (c.eyeHeight ?? 1.7) : (o.gpsAltitude ?? ground + 1.7)
const radius = +(process.env.CLASS_RADIUS ?? 6000)

// Ground classes on a CELL-metre grid round the camera.
const box = boundsAround(o.lng, o.lat, radius)
const m = metres(o.lat)
const N = Math.ceil((2 * radius) / CELL)
const toCell = (lng: number, lat: number): [number, number] => [((lng - o.lng) * m.x + radius) / CELL, (radius - (lat - o.lat) * m.y) / CELL]
const canvas = createCanvas(N, N), g = canvas.getContext('2d')
g.fillStyle = '#000'
g.fillRect(0, 0, N, N)
const year = new Date().getFullYear()
const fillRings = (rs: LngLat[][], color: string) => {
  g.fillStyle = color
  for (const r of rs) {
    g.beginPath()
    r.forEach(([x, y], i) => (i ? g.lineTo(...toCell(x, y)) : g.moveTo(...toCell(x, y))))
    g.closePath()
    g.fill('evenodd')
  }
}
const img = await imagery(box, 15)
const raster = g.getImageData(0, 0, N, N)
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const s = img.sample(o.lng + (x * CELL - radius) / m.x, o.lat + (radius - y * CELL) / m.y)
  if (s && s[0] > s[1] + 4 && s[0] > 70) raster.data[(y * N + x) * 4] = 255
}
g.putImageData(raster, 0, 0)
fillRings(rings(await layer('wetlands', box)), '#ff0000')
fillRings(rings((await layer('cutblocks', box)).filter((f) => (f.properties?.HARVEST_START_YEAR_CALENDAR ?? 0) >= year - OPEN_YEARS)), '#ff0000')
fillRings(rings([...(await layer('lakes', box)), ...(await layer('rivers', box))]), '#0000ff')
const cls = g.getImageData(0, 0, N, N).data
const groundClass = (lng: number, lat: number): Cls => {
  const [x, y] = toCell(lng, lat).map(Math.floor)
  if (x < 0 || y < 0 || x >= N || y >= N) return 'unknown'
  const i = (y * N + x) * 4
  return cls[i + 2] > 128 ? 'water' : cls[i] > 128 ? 'open' : 'forest'
}

// Every direction from the camera, cast once.
const src: Source = layered(await dem(boundsAround(o.lng, o.lat, radius + 2000), 13, 200), await dem(boundsAround(o.lng, o.lat, 70000), 10))
const AZ = 0.25, EL = 0.25, EL0 = -88, EL1 = 30
const nAz = Math.round(360 / AZ), nEl = Math.round((EL1 - EL0) / EL)
const sphere = new Uint8Array(nAz * nEl)
const drop = (d: number) => ((d * d) / (2 * 6371000)) * 0.87
const t0 = Date.now()
for (let j = 0; j < nEl; j++) {
  const el = (EL0 + (j + 0.5) * EL) * RAD
  for (let i = 0; i < nAz; i++) {
    const az = (i + 0.5) * AZ * RAD
    const h = Math.cos(el), e = Math.sin(az) * h, n = Math.cos(az) * h, u = Math.sin(el)
    let out: Cls = 'sky'
    for (let t = 10; t < 60000; t = t * 1.006 + 3) {
      const he = e * t, hn = n * t
      const lng = o.lng + he / m.x, lat = o.lat + hn / m.y
      const gz = src.elevationAt(lng, lat)
      if (!Number.isFinite(gz)) {
        out = 'unknown'
        break
      }
      if (alt + u * t + drop(Math.hypot(he, hn)) <= gz) {
        out = groundClass(lng, lat)
        break
      }
    }
    sphere[j * nAz + i] = CLASSES.indexOf(out)
  }
}
const castSeconds = (Date.now() - t0) / 1000

// Marked samples.
const samples = (step: number) => {
  const out: Array<{ u: number; v: number; k: number }> = []
  for (let v = step / 2; v < frame.height; v += step) for (let u = step / 2; u < frame.width; u += step) {
    const poly = c.masks!.polygons.find((p) => inRing(p.points, u, v))
    const k = poly ? poly.class : v >= c.masks!.fromY && c.masks!.default ? c.masks!.default : null
    if (k === 'land') out.push({ u, v, k: LAND })
    else if (k && CLASSES.includes(k as Cls)) out.push({ u, v, k: CLASSES.indexOf(k as Cls) })
  }
  return out
}
const coarse = samples(40), fine = samples(14)
const base = poseFrom({ lng: o.lng, lat: o.lat, alt, bearing: 0, pitch: 0, roll: 0, hfov: o.hfov, width: frame.width, height: frame.height })
function score(bearing: number, pitch: number, roll: number, set: typeof coarse) {
  const { right, down, forward } = cameraAxes({ bearing, pitch, roll })
  const hit = [0, 0, 0, 0, 0, 0], total = [0, 0, 0, 0, 0, 0]
  for (const s of set) {
    const nx = (s.u - base.width / 2) / base.focalPx, ny = (s.v - base.height / 2) / base.focalPx
    const e = forward[0] + nx * right[0] + ny * down[0], n = forward[1] + nx * right[1] + ny * down[1], u = forward[2] + nx * right[2] + ny * down[2]
    const az = ((Math.atan2(e, n) / RAD) % 360 + 360) % 360, el = Math.atan2(u, Math.hypot(e, n)) / RAD
    const j = Math.floor((el - EL0) / EL)
    total[s.k]++
    if (j < 0 || j >= nEl) continue
    const got = sphere[j * nAz + (Math.floor(az / AZ) % nAz)]
    if (got === s.k || (got === 4 && s.k !== 0) || (s.k === LAND && got >= 2)) hit[s.k]++
  }
  const used = total.map((t, k) => (t ? hit[k] / t : null)).filter((v): v is number => v !== null)
  return used.reduce((a, b) => a + b, 0) / used.length
}
const pitchRange = c.orientation?.pitch ?? [-60, 10], rollRange = c.orientation?.roll ?? [-30, 30]
const found: Array<{ bearing: number; pitch: number; roll: number; s: number }> = []
for (let b = 0; b < 360; b += 1) for (let p = pitchRange[0]; p <= pitchRange[1]; p += 1) for (let r = rollRange[0]; r <= rollRange[1]; r += 2) found.push({ bearing: b, pitch: p, roll: r, s: score(b, p, r, coarse) })
found.sort((a, b) => b.s - a.s)
const peaks: typeof found = []
for (const f of found) {
  if (peaks.length >= 5) break
  if (peaks.some((p) => Math.abs((((f.bearing - p.bearing) % 360) + 540) % 360 - 180) < 10 && Math.abs(f.pitch - p.pitch) < 10)) continue
  // Refine at fine samples.
  let best = { ...f, s: score(f.bearing, f.pitch, f.roll, fine) }
  for (let db = -1.5; db <= 1.5; db += 0.25) for (let dp = -1; dp <= 1; dp += 0.25) for (let dr = -2; dr <= 2; dr += 0.5) {
    const s = score(f.bearing + db, f.pitch + dp, f.roll + dr, fine)
    if (s > best.s) best = { bearing: f.bearing + db, pitch: f.pitch + dp, roll: f.roll + dr, s }
  }
  peaks.push(best)
}
peaks.sort((a, b) => b.s - a.s)
const poses = (c.results?.poses as Record<string, PoseRecord> | undefined) ?? {}
peaks.forEach((p, i) => (poses[`classes-${i + 1}`] = { lng: o.lng, lat: o.lat, alt, bearing: ((p.bearing % 360) + 360) % 360, pitch: p.pitch, roll: p.roll, hfov: o.hfov, source: `classes (balanced agreement ${fmt(p.s * 100, 0)}%)` }))
c.results = { ...c.results, poses, classes: { castSeconds, coarseSamples: coarse.length, fineSamples: fine.length, peaks } }
writeCase(c)

// The marked regions, for the record.
const shown = await workFrame(c.photo, c.metadata)
const sctx = shown.canvas.getContext('2d')
const colors: Record<string, string> = { sky: '#66ccff', water: '#3060ff', open: '#ff9020', forest: '#30d050' }
for (const p of c.masks.polygons) {
  sctx.strokeStyle = colors[p.class] ?? '#fff'
  sctx.lineWidth = 3
  sctx.beginPath()
  p.points.forEach(([x, y]: Px, i: number) => (i ? sctx.lineTo(x, y) : sctx.moveTo(x, y)))
  sctx.closePath()
  sctx.stroke()
}
saveJpeg(shown.canvas, join(c.out!, 'classes-masks.jpg'))
console.log(`cast ${nAz * nEl} directions in ${fmt(castSeconds)} s; ${coarse.length} coarse and ${fine.length} fine samples`)
peaks.forEach((p, i) => console.log(`classes-${i + 1}: heading ${fmt(((p.bearing % 360) + 360) % 360, 2)}°, pitch ${fmt(p.pitch, 2)}°, roll ${fmt(p.roll, 2)}° — balanced agreement ${fmt(p.s * 100, 1)}%`))
