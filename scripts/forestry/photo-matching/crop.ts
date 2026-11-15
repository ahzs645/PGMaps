/**
 * A gridded, zoomed crop of a photo (or any of the bench's output images), labelled in working-frame pixels, for
 * reading control points, skyline traces and region corners off the photo exactly.
 *
 *   node --import tsx scripts/forestry/photo-matching/crop.ts <case.json|image> <x> <y> <w> <h> [--zoom 2] [--grid 20] [--gamma 1.6] [--out file.jpg]
 *
 * Given a case file it crops the case's photo and writes into the case's `out` folder.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCanvas, loadImage, saveJpeg } from './lib/geo'
import { readCase, workFrame, WORK_WIDTH } from './lib/photo'

const args = process.argv.slice(2)
const flag = (name: string, fallback: number) => (args.includes(`--${name}`) ? Number(args[args.indexOf(`--${name}`) + 1]) : fallback)
const [target, ...rest] = args
const [x, y, w, h] = rest.slice(0, 4).map(Number)
if (![x, y, w, h].every(Number.isFinite)) throw Error('Usage: crop.ts <case.json|image> <x> <y> <w> <h> [--zoom 2] [--grid 20] [--gamma 1.6] [--out file]')
const isCase = target.endsWith('.json')
const c = isCase ? readCase(target) : null
const image = c ? (await workFrame(c.photo, c.metadata)).canvas : await loadImage(readFileSync(resolve(target)))
const zoom = flag('zoom', 2), grid = flag('grid', Math.max(10, Math.round(w / 10 / 10) * 10)), gamma = flag('gamma', 1)
const s = image.width / WORK_WIDTH
const canvas = createCanvas(Math.round(w * zoom), Math.round(h * zoom)), ctx = canvas.getContext('2d')
ctx.drawImage(image, x * s, y * s, w * s, h * s, 0, 0, canvas.width, canvas.height)
if (gamma !== 1) {
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < d.data.length; i++) if (i % 4 !== 3) d.data[i] = 255 * Math.pow(d.data[i] / 255, 1 / gamma)
  ctx.putImageData(d, 0, 0)
}
ctx.strokeStyle = 'rgba(255,255,255,0.5)'
ctx.fillStyle = '#fff'
ctx.font = '12px sans-serif'
ctx.lineWidth = 1
for (let gx = Math.ceil(x / grid) * grid; gx < x + w; gx += grid) {
  ctx.beginPath()
  ctx.moveTo((gx - x) * zoom, 0)
  ctx.lineTo((gx - x) * zoom, canvas.height)
  ctx.stroke()
  ctx.fillText(String(gx), (gx - x) * zoom + 2, 12)
}
for (let gy = Math.ceil(y / grid) * grid; gy < y + h; gy += grid) {
  ctx.beginPath()
  ctx.moveTo(0, (gy - y) * zoom)
  ctx.lineTo(canvas.width, (gy - y) * zoom)
  ctx.stroke()
  ctx.fillText(String(gy), 2, (gy - y) * zoom - 2)
}
const out = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : join(c ? c.out! : '.', `crop-${x}-${y}-${w}x${h}.jpg`)
saveJpeg(canvas, out)
console.log(`wrote ${out} (working-frame pixels ${x}–${x + w} × ${y}–${y + h}, grid every ${grid})`)
