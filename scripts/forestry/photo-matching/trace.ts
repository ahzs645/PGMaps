/**
 * Stage 5: outlines drawn in the photo (`traces`), carried to the map by ray-casting each edge pixel to the ground.
 * Writes them as GeoJSON, compares each with a mapped layer when `compareTo` is set (the traced area's share inside
 * the mapped polygons, and intersection over union with those it touches), draws them back into the photo filled
 * where the camera sees their ground, and shows them from the case's `views`.
 *
 *   node --import tsx scripts/forestry/photo-matching/trace.ts <case.json>
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { areaHa, castRay, drawLines, fillGround, imageryFor, inRing, layer, metres, poseFrom, render, rings, saveJpeg, terrainFor, type LngLat, type Pose } from './lib/geo'
import { readCase, workFrame, writeCase } from './lib/photo'

type Trace = { name: string; pixels: [number, number][]; compareTo?: 'wetlands' | 'cutblocks' | 'lakes' }
const c = readCase(process.argv[2])
const rec = c.pose
if (!rec || !c.traces?.length) throw Error('Needs a pose and `traces`.')
const frame = await workFrame(c.photo, c.metadata)
const pose = poseFrom({ ...rec, width: frame.width, height: frame.height })
const src = await terrainFor(rec.lng, rec.lat, rec.bearing)
const m = metres(rec.lat)

const traced = (c.traces as Trace[]).map((t) => {
  const edge: [number, number][] = []
  for (let i = 0; i < t.pixels.length; i++) {
    const [a, b] = [t.pixels[i], t.pixels[(i + 1) % t.pixels.length]]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4))
    for (let k = 0; k < n; k++) edge.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  const hits = edge.map(([u, v]) => castRay(pose, src, u, v)).filter((h): h is NonNullable<typeof h> => !!h)
  const ring: LngLat[] = hits.map((h) => [h.lng, h.lat])
  ring.push(ring[0])
  const distances = hits.map((h) => h.distance).sort((a, b) => a - b)
  return { ...t, ring, missed: edge.length - hits.length, nearM: distances[0], farM: distances[distances.length - 1] }
})

// Comparison on a 2 m grid round each traced ring.
async function compare(ring: LngLat[], kind: NonNullable<Trace['compareTo']>) {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1])
  const pad = 150
  const b: [number, number, number, number] = [Math.min(...xs) - pad / m.x, Math.min(...ys) - pad / m.y, Math.max(...xs) + pad / m.x, Math.max(...ys) + pad / m.y]
  const year = new Date().getFullYear()
  let feats = await layer(kind === 'lakes' ? 'lakes' : kind, b)
  if (kind === 'cutblocks') feats = feats.filter((f) => (f.properties?.HARVEST_START_YEAR_CALENDAR ?? 0) >= year - 6)
  const ref = rings(feats)
  const cell = 2
  const W = Math.ceil(((b[2] - b[0]) * m.x) / cell), H = Math.ceil(((b[3] - b[1]) * m.y) / cell)
  let traced = 0, both = 0
  const touched = new Set<number>()
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lng = b[0] + ((x + 0.5) * cell) / m.x, lat = b[3] - ((y + 0.5) * cell) / m.y
    const t = inRing(ring, lng, lat)
    let inside = -1
    for (let i = 0; i < ref.length && inside < 0; i++) if (inRing(ref[i], lng, lat)) inside = i
    if (t) traced++
    if (t && inside >= 0) {
      both++
      touched.add(inside)
    }
  }
  // IoU against only the mapped polygons the trace overlaps.
  let mappedTouched = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lng = b[0] + ((x + 0.5) * cell) / m.x, lat = b[3] - ((y + 0.5) * cell) / m.y
    for (const i of touched) if (inRing(ref[i], lng, lat)) {
      mappedTouched++
      break
    }
  }
  return { insideShare: traced ? both / traced : 0, iou: traced + mappedTouched - both ? both / (traced + mappedTouched - both) : 0, mappedHa: (mappedTouched * cell * cell) / 1e4, polygons: touched.size, refRings: [...touched].map((i) => ref[i]) }
}

const results: Record<string, unknown>[] = []
const shown = await workFrame(c.photo, c.metadata)
const ctx = shown.canvas.getContext('2d')
const lift = ctx.getImageData(0, 0, shown.width, shown.height)
for (let i = 0; i < lift.data.length; i++) if (i % 4 !== 3) lift.data[i] = 255 * Math.pow(lift.data[i] / 255, 1 / 1.4)
ctx.putImageData(lift, 0, 0)
const features: GeoJSON.Feature[] = []
for (const t of traced) {
  const cmp = t.compareTo ? await compare(t.ring, t.compareTo) : null
  const filled = fillGround(ctx, pose, src, t.ring, [255, 140, 0])
  drawLines(ctx, pose, src, [t.ring], '#ffb000', 1, 2)
  if (cmp) drawLines(ctx, pose, src, cmp.refRings, '#40c0ff', 1, 2)
  ctx.strokeStyle = '#ffffff'
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  t.pixels.forEach(([u, v], i) => (i ? ctx.lineTo(u, v) : ctx.moveTo(u, v)))
  ctx.closePath()
  ctx.stroke()
  ctx.setLineDash([])
  const r = { name: t.name, areaHa: areaHa(t.ring), nearM: t.nearM, farM: t.farM, missedEdgePixels: t.missed, photoPixelsFilled: filled, ...(cmp ? { compareTo: t.compareTo, insideShare: cmp.insideShare, iou: cmp.iou, mappedHa: cmp.mappedHa, mappedPolygons: cmp.polygons } : {}) }
  results.push(r)
  features.push({ type: 'Feature', properties: { name: t.name, areaHa: +r.areaHa.toFixed(2) }, geometry: { type: 'Polygon', coordinates: [t.ring] } })
}
saveJpeg(shown.canvas, join(c.out!, 'trace-photo.jpg'))
writeFileSync(join(c.out!, 'traces.geojson'), JSON.stringify({ type: 'FeatureCollection', features }))

// Other viewpoints.
const views = c.views ?? []
if (views.length) {
  const first = traced[0].ring
  const centre: LngLat = [first.reduce((s, p) => s + p[0], 0) / first.length, first.reduce((s, p) => s + p[1], 0) / first.length]
  const images = await imageryFor(rec.lng, rec.lat, rec.bearing)
  for (const [i, v] of views.entries()) {
    const lng = v.lng ?? rec.lng, lat = v.lat ?? rec.lat
    const groundHere = src.elevationAt(lng, lat)
    const alt = v.agl !== undefined ? groundHere + v.agl : rec.alt + (v.dAlt ?? 0)
    const dE = (centre[0] - lng) * m.x, dN = (centre[1] - lat) * m.y
    const bearing = v.bearing === 'toward' || v.bearing === undefined ? (Math.atan2(dE, dN) * 180) / Math.PI : v.bearing
    const pitch = v.pitch === 'toward' || v.pitch === undefined ? (Math.atan2(src.elevationAt(...centre) - alt, Math.hypot(dE, dN)) * 180) / Math.PI : v.pitch
    const vp: Pose = poseFrom({ lng, lat, alt, bearing, pitch, roll: 0, hfov: v.hfov, width: 1200, height: 800 })
    const extra = v.lng !== undefined ? await imageryFor(lng, lat, bearing) : []
    const scale = 0.75
    const view = render(vp, src, [...extra, ...images], scale)
    const vctx = view.getContext('2d')
    let seen = 0
    for (const t of traced) {
      seen += fillGround(vctx, vp, src, t.ring, [255, 140, 0], scale)
      drawLines(vctx, vp, src, [t.ring], '#ffb000', scale, 2)
    }
    vctx.font = '18px sans-serif'
    vctx.fillStyle = 'rgba(0,0,0,0.6)'
    vctx.fillRect(0, 0, view.width, 28)
    vctx.fillStyle = '#fff'
    vctx.fillText(`${v.name} — ${seen ? 'in sight' : 'hidden by terrain (outline dotted)'}`, 10, 20)
    saveJpeg(view, join(c.out!, `trace-view-${i + 1}.jpg`))
    results.push({ view: v.name, bearing, pitch, eyeAboveGroundM: alt - groundHere, pixelsInSight: seen })
  }
}
c.results = { ...c.results, traces: results }
writeCase(c)
for (const r of results) console.log(JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toFixed(k === 'insideShare' || k === 'iou' ? 3 : 1) : v)))
