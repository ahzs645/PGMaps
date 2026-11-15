/**
 * Stage 6: proposed changes drawn into the photo. Takes map GeoJSON (polygons are treated as blocks, lines as roads
 * of `roadWidthM`, default 12 m) and draws each with the case's camera:
 *   overlay-outline.jpg   — outline solid where the camera sees its ground and dotted where terrain hides it, with the
 *                           seen ground filled;
 *   overlay-after.jpg     — an illustration of the change: seen ground inside a block or road toned to cleared ground,
 *                           keeping the photo's own light and shade;
 *   overlay-compare.jpg   — the photo and the illustration side by side.
 * Reports, per proposal: its area, the share of it in the camera's sight (terrain only — no canopy screening), its
 * distance from the camera, and the share of the frame it covers. These are figures about this photo, not a VIA
 * percent alteration, which needs a landform. Proposals come from `proposals` in the case file or the command line.
 *
 *   node --import tsx scripts/forestry/photo-matching/overlay.ts <case.json> [proposal.geojson …]
 */
import { readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { areaHa, castRay, createCanvas, drawLines, fillGround, inRing, metres, poseFrom, project, saveJpeg, terrainFor, visible, type LngLat, type Pose, type Source } from './lib/geo'
import { fmt, readCase, workFrame, writeCase } from './lib/photo'

type Proposal = { name: string; kind: 'block' | 'road'; rings: LngLat[][]; line?: LngLat[]; widthM?: number }
const args = process.argv.slice(2)
const c = readCase(args[0])
const rec = c.pose
if (!rec) throw Error('No pose: run orient.ts (and check it) first.')
const files = [...((c as { proposals?: Array<{ file: string; roadWidthM?: number }> }).proposals ?? []).map((p) => ({ file: resolve(c.dir, p.file), roadWidthM: p.roadWidthM })), ...args.slice(1).map((file) => ({ file: resolve(file), roadWidthM: undefined }))]
if (!files.length) throw Error('Give proposal GeoJSON on the command line or as `proposals` in the case file.')

const frame = await workFrame(c.photo, c.metadata)
const pose: Pose = poseFrom({ ...rec, width: frame.width, height: frame.height })
const src: Source = await terrainFor(rec.lng, rec.lat, rec.bearing)
const m = metres(rec.lat)

// A road becomes a strip: one quadrilateral per segment, `width` metres across.
function strip(line: LngLat[], width: number): LngLat[][] {
  const quads: LngLat[][] = []
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]]
    const dx = (b[0] - a[0]) * m.x, dy = (b[1] - a[1]) * m.y, len = Math.hypot(dx, dy)
    if (!len) continue
    const ox = ((-dy / len) * width) / 2 / m.x, oy = ((dx / len) * width) / 2 / m.y
    quads.push([[a[0] + ox, a[1] + oy], [b[0] + ox, b[1] + oy], [b[0] - ox, b[1] - oy], [a[0] - ox, a[1] - oy], [a[0] + ox, a[1] + oy]])
  }
  return quads
}
const proposals: Proposal[] = []
for (const { file, roadWidthM } of files) {
  const fc = JSON.parse(readFileSync(file, 'utf8')) as GeoJSON.FeatureCollection
  fc.features.forEach((f, i) => {
    const name = String(f.properties?.name ?? `${basename(file)} #${i + 1}`)
    const g = f.geometry
    const width = Number(f.properties?.roadWidthM ?? roadWidthM ?? 12)
    if (g.type === 'Polygon') proposals.push({ name, kind: 'block', rings: [g.coordinates[0] as LngLat[]] })
    else if (g.type === 'MultiPolygon') proposals.push({ name, kind: 'block', rings: g.coordinates.map((p) => p[0] as LngLat[]) })
    else if (g.type === 'LineString') proposals.push({ name, kind: 'road', rings: strip(g.coordinates as LngLat[], width), line: g.coordinates as LngLat[], widthM: width })
    else if (g.type === 'MultiLineString') for (const l of g.coordinates) proposals.push({ name, kind: 'road', rings: strip(l as LngLat[], width), line: l as LngLat[], widthM: width })
  })
}

/** Where a map point's ground falls in the photo, or null behind the camera or off the terrain. */
function projectGround(lng: number, lat: number) {
  const z = src.elevationAt(lng, lat)
  return Number.isFinite(z) ? project(pose, lng, lat, z) : null
}

// Share of each proposal's ground in sight, on a grid of about 400 points (terrain only).
function inSight(p: Proposal) {
  const all = p.rings.flat()
  const xs = all.map((q) => q[0]), ys = all.map((q) => q[1])
  const area = p.rings.reduce((s, r) => s + areaHa(r), 0)
  const step = Math.max(2, Math.sqrt((area * 1e4) / 400))
  let n = 0, seen = 0, near = Infinity, far = 0
  for (let y = Math.min(...ys); y <= Math.max(...ys); y += step / m.y) for (let x = Math.min(...xs); x <= Math.max(...xs); x += step / m.x) {
    if (!p.rings.some((r) => inRing(r, x, y))) continue
    n++
    const d = Math.hypot((x - rec!.lng) * m.x, (y - rec!.lat) * m.y)
    near = Math.min(near, d)
    far = Math.max(far, d)
    if (visible(pose, src, x, y, src.elevationAt(x, y))) seen++
  }
  return { areaHa: area, inSightShare: n ? seen / n : 0, nearM: near, farM: far }
}

// Outline view.
const outline = await workFrame(c.photo, c.metadata)
const octx = outline.canvas.getContext('2d')
// "After" view: seen ground inside each proposal toned to cleared ground, keeping the photo's light and shade.
const after = await workFrame(c.photo, c.metadata)
const actx = after.canvas.getContext('2d')
const pixels = after.canvas.getContext('2d').getImageData(0, 0, frame.width, frame.height)
const results: Record<string, unknown>[] = []
for (const p of proposals) {
  let filled = 0
  for (const r of p.rings) filled += fillGround(octx, pose, src, r, p.kind === 'road' ? [255, 230, 0] : [255, 140, 0])
  drawLines(octx, pose, src, p.kind === 'road' && p.line ? [p.line] : p.rings, p.kind === 'road' ? '#ffe000' : '#ffb000', 1, 2)
  // Tone: slash and soil (blocks) or gravel (roads).
  const tone = p.kind === 'road' ? [196, 184, 160] : [150, 112, 78]
  const pts = p.rings.flat().map(([x, y]) => projectGround(x, y)).filter((q): q is NonNullable<typeof q> => !!q)
  if (pts.length) {
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q.x))) - 2), x1 = Math.min(frame.width, Math.ceil(Math.max(...pts.map((q) => q.x))) + 2)
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q.y))) - 2), y1 = Math.min(frame.height, Math.ceil(Math.max(...pts.map((q) => q.y))) + 2)
    // Pass 1: the seen pixels and their brightness. Pass 2: the tone at the block's own exposure, each pixel scaled by
    // its brightness against the block's mean, so the photo's light, shade and texture carry through.
    const seen: number[] = []
    const luma = (i: number) => 0.3 * pixels.data[i] + 0.59 * pixels.data[i + 1] + 0.11 * pixels.data[i + 2]
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const hit = castRay(pose, src, x + 0.5, y + 0.5, 30000)
      if (hit && p.rings.some((r) => inRing(r, hit.lng, hit.lat))) seen.push((y * frame.width + x) * 4)
    }
    if (seen.length) {
      const mean = seen.reduce((sum, i) => sum + luma(i), 0) / seen.length
      const toneLuma = 0.3 * tone[0] + 0.59 * tone[1] + 0.11 * tone[2]
      // Cleared ground reads brighter than the canopy it replaces.
      const target = Math.min(200, mean * (p.kind === 'road' ? 1.8 : 1.45) + 8)
      for (const i of seen) {
        // Crown-by-crown texture would read as brown trees, so it keeps a third of its contrast.
        const k = 1 + 0.35 * (Math.max(0.35, Math.min(2, luma(i) / Math.max(1, mean))) - 1)
        for (let ch = 0; ch < 3; ch++) pixels.data[i + ch] = Math.min(255, (tone[ch] / toneLuma) * target * k)
      }
    }
  }
  const s = inSight(p)
  const frameShare = filled / (frame.width * frame.height)
  results.push({ name: p.name, kind: p.kind, ...(p.widthM ? { widthM: p.widthM } : {}), areaHa: s.areaHa, inSightShare: s.inSightShare, nearM: s.nearM, farM: s.farM, framePixels: filled, frameShare })
}
actx.putImageData(pixels, 0, 0)
// Labels and the camera's provenance on the outline view.
octx.font = '15px sans-serif'
const solve = c.results?.solve as { groups?: Array<{ name: string; heldOut: number; mPerPx: number }> } | undefined
const accuracy = solve?.groups?.length ? `held-out ${solve.groups.map((g) => `${g.name} ${fmt(g.heldOut * g.mPerPx, 0)} m`).join(', ')}` : 'no controls measured: skyline and GPS only'
const caption = [`camera: ${rec.source}; ${accuracy}`, 'solid: in sight of the camera; dotted: hidden by terrain. Trees in front are not modelled.']
caption.forEach((t, i) => {
  octx.fillStyle = 'rgba(0,0,0,0.6)'
  octx.fillRect(0, frame.height - 44 + i * 22, frame.width, 22)
  octx.fillStyle = '#fff'
  octx.fillText(t, 8, frame.height - 28 + i * 22)
})
actx.font = '15px sans-serif'
actx.fillStyle = 'rgba(0,0,0,0.6)'
actx.fillRect(0, frame.height - 22, frame.width, 22)
actx.fillStyle = '#fff'
actx.fillText('Illustration: proposed clearing toned onto the photo where the camera sees its ground. Not a rendering of the result.', 8, frame.height - 6)
saveJpeg(outline.canvas, join(c.out!, 'overlay-outline.jpg'))
saveJpeg(after.canvas, join(c.out!, 'overlay-after.jpg'))
const side = createCanvas(frame.width * 2 + 10, frame.height), sctx = side.getContext('2d')
sctx.fillStyle = '#fff'
sctx.fillRect(0, 0, side.width, side.height)
sctx.drawImage(frame.canvas, 0, 0)
sctx.drawImage(after.canvas, frame.width + 10, 0)
saveJpeg(side, join(c.out!, 'overlay-compare.jpg'))

c.results = { ...c.results, overlay: results }
writeCase(c)
for (const r of results)
  console.log(`${String(r.name).padEnd(28)} ${r.kind} ${fmt(r.areaHa as number, 1)} ha; ${fmt((r.inSightShare as number) * 100, 0)}% in sight (terrain only); ${fmt(r.nearM as number, 0)}–${fmt(r.farM as number, 0)} m away; ${fmt((r.frameShare as number) * 100, 2)}% of the frame`)
console.log(`wrote overlay-outline.jpg, overlay-after.jpg and overlay-compare.jpg in ${c.out}`)
