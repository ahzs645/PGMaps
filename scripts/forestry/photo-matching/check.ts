/**
 * Stage 3: check the pose against the near ground. Writes the model's view (imagery on terrain) beside the photo,
 * and the photo with mapped features drawn by the same camera (solid where in sight, dotted where terrain hides them).
 * Lines given as `controls.lines` are measured: each photo point's distance to the nearest projected mapped line.
 *
 *   node --import tsx scripts/forestry/photo-matching/check.ts <case.json> [--pose name] [--no-render]
 */
import { join } from 'node:path'
import { createCanvas, drawLines, imageryFor, layer, poseFrom, project, render, rings, saveJpeg, terrainFor, wedge, type LngLat, type Pose, type Source } from './lib/geo'
import { fmt, readCase, workFrame, writeCase, type PoseRecord } from './lib/photo'

const args = process.argv.slice(2)
const c = readCase(args[0])
const poseName = args.includes('--pose') ? args[args.indexOf('--pose') + 1] : null
const rec: PoseRecord | undefined = poseName ? (c.results?.poses as Record<string, PoseRecord> | undefined)?.[poseName] : c.pose
if (!rec) throw Error('No pose: run orient.ts (or name a stored pose with --pose).')
const frame = await workFrame(c.photo, c.metadata)
const pose = poseFrom({ ...rec, width: frame.width, height: frame.height })
const src = await terrainFor(rec.lng, rec.lat, rec.bearing)
const tag = poseName ?? 'pose'

// Mapped features, out to 12 km along the view.
const box = wedge(rec.lng, rec.lat, rec.bearing, 12000, 32)
const year = new Date().getFullYear()
const feats = {
  streams: rings(await layer('streams', box, ' AND STREAM_ORDER>=2')),
  water: rings([...(await layer('lakes', box)), ...(await layer('rivers', box))]),
  wetlands: rings(await layer('wetlands', box)),
  ftenRoads: rings(await layer('ftenRoads', box)),
  draRoads: rings(await layer('draRoads', box)),
  blocks: (await layer('cutblocks', box)).filter((f) => (f.properties?.HARVEST_START_YEAR_CALENDAR ?? 0) >= year - 30),
}
const recent = rings(feats.blocks.filter((f) => (f.properties?.HARVEST_START_YEAR_CALENDAR ?? 0) >= year - 3))
const older = rings(feats.blocks.filter((f) => (f.properties?.HARVEST_START_YEAR_CALENDAR ?? 0) < year - 3))

const shown = await workFrame(c.photo, c.metadata)
const ctx = shown.canvas.getContext('2d')
const lift = ctx.getImageData(0, 0, shown.width, shown.height)
for (let i = 0; i < lift.data.length; i++) if (i % 4 !== 3) lift.data[i] = 255 * Math.pow(lift.data[i] / 255, 1 / 1.5)
ctx.putImageData(lift, 0, 0)
drawLines(ctx, pose, src, feats.wetlands, '#a0ff60', 1, 1)
drawLines(ctx, pose, src, older, '#c060ff', 1, 1.5)
drawLines(ctx, pose, src, recent, '#ff40ff', 1, 2.5)
drawLines(ctx, pose, src, feats.water, '#3080ff', 1, 2)
drawLines(ctx, pose, src, feats.streams, '#00e5ff', 1, 1.5)
drawLines(ctx, pose, src, feats.draRoads, '#ffffff', 1, 1.5)
drawLines(ctx, pose, src, feats.ftenRoads, '#ffe000', 1, 2)
ctx.font = '15px sans-serif'
const legend: Array<[string, string]> = [['#3080ff', 'lakes, rivers'], ['#00e5ff', 'streams'], ['#a0ff60', 'wetlands'], ['#ff40ff', `cutblocks ${year - 3}+`], ['#c060ff', 'older cutblocks'], ['#ffe000', 'FTEN roads'], ['#ffffff', 'road atlas']]
legend.forEach(([color, label], i) => {
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(6, 6 + i * 20, 150, 19)
  ctx.fillStyle = color
  ctx.fillText(label, 12, 21 + i * 20)
})
saveJpeg(shown.canvas, join(c.out!, `check-features-${tag}.jpg`))

// Measured lines.
const lineSets: Record<string, LngLat[][]> = { streams: feats.streams, ftenRoads: feats.ftenRoads, draRoads: feats.draRoads, lakes: feats.water, wetlands: feats.wetlands, cutblocks: rings(feats.blocks) }
function lineDistance(p: Pose, s: Source, lines: LngLat[][], u: number, v: number, radius = 150) {
  let best = Infinity
  for (const l of lines) {
    let prev: { x: number; y: number } | null = null
    for (let i = 0; i < l.length; i++) {
      const [x, y] = l[i]
      const q = project(p, x, y, s.elevationAt(x, y))
      if (q && prev && Math.abs(q.x - u) < radius && Math.abs(q.y - v) < radius) {
        const dx = q.x - prev.x, dy = q.y - prev.y, L = dx * dx + dy * dy
        const t = L ? Math.max(0, Math.min(1, ((u - prev.x) * dx + (v - prev.y) * dy) / L)) : 0
        best = Math.min(best, Math.hypot(prev.x + t * dx - u, prev.y + t * dy - v))
      }
      prev = q
    }
  }
  return best
}
const measured: Record<string, { rmsPx: number; points: number; missing: number }> = {}
for (const line of c.controls?.lines ?? []) {
  const d = line.pixels.map(([u, v]) => lineDistance(pose, src, lineSets[line.layer], u, v))
  const ok = d.filter(Number.isFinite)
  measured[line.name] = { rmsPx: Math.sqrt(ok.reduce((s, v) => s + v * v, 0) / Math.max(1, ok.length)), points: ok.length, missing: d.length - ok.length }
}
c.results = { ...c.results, [`check:${tag}`]: { lines: measured } }
writeCase(c)

if (!args.includes('--no-render')) {
  const images = await imageryFor(rec.lng, rec.lat, rec.bearing)
  const scale = 0.5
  const model = render(pose, src, images, scale)
  const side = createCanvas(frame.width * scale * 2 + 10, frame.height * scale), sctx = side.getContext('2d')
  sctx.fillStyle = '#fff'
  sctx.fillRect(0, 0, side.width, side.height)
  sctx.drawImage(frame.canvas, 0, 0, frame.width * scale, frame.height * scale)
  sctx.drawImage(model, frame.width * scale + 10, 0)
  sctx.font = '15px sans-serif'
  sctx.fillStyle = '#ff0'
  sctx.fillText('photo', 8, 20)
  sctx.fillText(`model: ${fmt(rec.bearing, 1)}° / ${fmt(rec.pitch, 1)}° / roll ${fmt(rec.roll, 1)}°, eye ${fmt(rec.alt, 0)} m`, frame.width * scale + 18, 20)
  saveJpeg(side, join(c.out!, `check-model-${tag}.jpg`))
}
for (const [name, m] of Object.entries(measured)) console.log(`${name.padEnd(20)} ${fmt(m.rmsPx)} px RMS over ${m.points} points${m.missing ? `, ${m.missing} with no mapped line within 150 px` : ''}`)
console.log(`wrote ${join(c.out!, `check-features-${tag}.jpg`)}${args.includes('--no-render') ? ' (model view skipped: --no-render)' : ` and check-model-${tag}.jpg`}`)
