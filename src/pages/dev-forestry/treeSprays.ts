/**
 * The foliage pictures a detailed tree's sprays carry: a conifer bough, a pine's needle tufts, a
 * hemlock's fine hanging spray and two leaf clusters, drawn here into one small sheet.
 *
 * A spray was an eight-faced solid, and a crown of them read as a heap of diamonds. A real bough is
 * a flat thing with a ragged outline, so each spray is now two crossed cards cut out by one of these
 * pictures: half the triangles, and an edge that looks like needles. Generated, like every other
 * tree drawing on the page: no image file, nothing to license.
 *
 * Brightness only. The sheet says where a bough is solid and how light or dark each needle is; its
 * colour comes from the tree. Free of DOM access, so the bake and the coverage test read the same
 * bytes the browser uploads.
 */

import { mulberry32, type TreeDrawingId } from './forest'
import type { AtlasImage } from './impostor'

/** The foliage pictures, in the order they sit in the sheet. */
export const SPRAY_KINDS = ['bough', 'pine', 'hemlock', 'leaf', 'cottonwood'] as const
export type SprayKind = (typeof SPRAY_KINDS)[number]

/** Cells across and down the sheet, and one cell's side in pixels. */
export const SPRAY_COLUMNS = 4
export const SPRAY_ROWS = 2
export const SPRAY_CELL_PIXELS = 96

/** The alpha below which a spray's pixel is cut away, the same cut the tree cards use. */
export const SPRAY_ALPHA_CUT = 0.45

/** Which picture a drawing's sprays carry. */
export function sprayKind(drawing: TreeDrawingId): SprayKind {
  if (drawing === 'shrub' || drawing === 'aspen' || drawing === 'birch') return 'leaf'
  if (drawing === 'cottonwood') return 'cottonwood'
  if (drawing.startsWith('pine')) return 'pine'
  if (drawing.startsWith('hemlock')) return 'hemlock'
  return 'bough'
}

/**
 * A picture's place in the sheet as texture coordinates `[u0, v0, u1, v1]`, inset half a pixel so
 * filtering never reads the next cell. `u` runs along the bough from its stem end to its tip.
 */
export function sprayCellUv(kind: SprayKind): [number, number, number, number] {
  const index = SPRAY_KINDS.indexOf(kind)
  const column = index % SPRAY_COLUMNS
  const row = Math.floor(index / SPRAY_COLUMNS)
  const insetU = 0.5 / (SPRAY_COLUMNS * SPRAY_CELL_PIXELS)
  const insetV = 0.5 / (SPRAY_ROWS * SPRAY_CELL_PIXELS)
  return [
    column / SPRAY_COLUMNS + insetU,
    row / SPRAY_ROWS + insetV,
    (column + 1) / SPRAY_COLUMNS - insetU,
    (row + 1) / SPRAY_ROWS - insetV,
  ]
}

/** One cell being drawn: coverage and brightness, each 0–1. */
type Cell = { size: number; alpha: Float32Array; light: Float32Array }

/** A stroke with round ends from a to b (cell units 0–1), `half` its half-width; later strokes lie on top. */
function stroke(cell: Cell, ax: number, ay: number, bx: number, by: number, half: number, light: number) {
  const n = cell.size
  const pad = half + 1.5 / n
  const minX = Math.max(0, Math.floor((Math.min(ax, bx) - pad) * n))
  const maxX = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + pad) * n))
  const minY = Math.max(0, Math.floor((Math.min(ay, by) - pad) * n))
  const maxY = Math.min(n - 1, Math.ceil((Math.max(ay, by) + pad) * n))
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy || 1e-9
  for (let row = minY; row <= maxY; row += 1) {
    for (let column = minX; column <= maxX; column += 1) {
      const x = (column + 0.5) / n
      const y = (row + 0.5) / n
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared))
      const distance = Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
      // One pixel of soft edge, so the cut-out threshold lands on the stroke's own outline.
      const coverage = Math.max(0, Math.min(1, (half - distance) * n + 0.5))
      if (coverage <= 0) continue
      const at = row * n + column
      cell.light[at] = cell.light[at] * (1 - coverage) + light * coverage
      cell.alpha[at] = Math.max(cell.alpha[at], coverage)
    }
  }
}

/** A leaf: an ellipse turned by `turn`, pointed a little at its tip. */
function leaf(cell: Cell, cx: number, cy: number, rx: number, ry: number, turn: number, light: number) {
  const n = cell.size
  const reach = Math.max(rx, ry) + 1.5 / n
  const minX = Math.max(0, Math.floor((cx - reach) * n))
  const maxX = Math.min(n - 1, Math.ceil((cx + reach) * n))
  const minY = Math.max(0, Math.floor((cy - reach) * n))
  const maxY = Math.min(n - 1, Math.ceil((cy + reach) * n))
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  for (let row = minY; row <= maxY; row += 1) {
    for (let column = minX; column <= maxX; column += 1) {
      const x = (column + 0.5) / n - cx
      const y = (row + 0.5) / n - cy
      const along = x * cos + y * sin
      const across = -x * sin + y * cos
      // Narrower toward the tip, so the outline is a leaf's and not a coin's.
      const taper = 1 - 0.35 * Math.max(0, along / rx)
      const d = Math.hypot(along / rx, across / (ry * taper))
      const coverage = Math.max(0, Math.min(1, (1 - d) * Math.min(rx, ry) * n + 0.5))
      if (coverage <= 0) continue
      const at = row * n + column
      // A midrib's worth of shading: lighter along the centre line.
      const shade = light * (0.9 + 0.14 * (1 - Math.min(1, Math.abs(across) / ry)))
      cell.light[at] = cell.light[at] * (1 - coverage) + shade * coverage
      cell.alpha[at] = Math.max(cell.alpha[at], coverage)
    }
  }
}

/** Needles both sides of a twig from a to b, `reach` long at the stem end and shorter toward the tip. */
function needles(
  cell: Cell,
  random: () => number,
  from: [number, number],
  to: [number, number],
  reach: number,
  options: { count: number; sweep: number; half: number; taper: number },
) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const length = Math.hypot(dx, dy) || 1e-9
  const ux = dx / length
  const uy = dy / length
  for (let index = 0; index < options.count; index += 1) {
    const t = (index + random() * 0.8) / options.count
    const x = from[0] + dx * t
    const y = from[1] + dy * t
    const side = index % 2 === 0 ? 1 : -1
    // Swept forward along the twig, as needles grow.
    const angle = options.sweep * (0.8 + random() * 0.4)
    const size = reach * (1 - options.taper * t) * (0.75 + random() * 0.5)
    const nx = ux * Math.cos(angle) - side * uy * Math.sin(angle)
    const ny = uy * Math.cos(angle) + side * ux * Math.sin(angle)
    stroke(cell, x, y, x + nx * size, y + ny * size, options.half, 0.55 + random() * 0.45)
  }
}

function drawSpray(kind: SprayKind, size: number): Cell {
  const cell: Cell = { size, alpha: new Float32Array(size * size), light: new Float32Array(size * size) }
  const random = mulberry32(0x5eed + SPRAY_KINDS.indexOf(kind) * 7919)
  // A needle a pixel and a bit wide at the cell's size, whatever that size is.
  const fine = 0.9 / size

  if (kind === 'leaf' || kind === 'cottonwood') {
    // Leaves on a few twigs, thickest in the middle of the cluster and ragged at its edge.
    const big = kind === 'cottonwood'
    const count = big ? 30 : 46
    stroke(cell, 0.02, 0.5, 0.7, 0.5, fine * 1.4, 0.4)
    for (let index = 0; index < count; index += 1) {
      const along = 0.08 + random() * 0.86
      // An ellipse of leaves about the twig, narrowing to its tip.
      const spread = 0.42 * Math.sqrt(Math.max(0, 1 - ((along - 0.5) / 0.52) ** 2))
      const across = (random() * 2 - 1) * spread
      const radius = (big ? 0.085 : 0.06) * (0.75 + random() * 0.5)
      leaf(
        cell,
        along,
        0.5 + across,
        radius,
        radius * (big ? 0.72 : 0.82),
        (random() - 0.5) * 2.4,
        0.5 + random() * 0.5,
      )
    }
    return cell
  }

  if (kind === 'pine') {
    // A bare twig carrying bottle-brush tufts of long needles, the largest at its tip.
    stroke(cell, 0.02, 0.5, 0.82, 0.5, fine * 1.6, 0.35)
    const tufts: Array<[number, number, number]> = [
      [0.8, 0.5, 0.2],
      [0.5, 0.36, 0.17],
      [0.46, 0.66, 0.17],
      [0.22, 0.42, 0.13],
    ]
    for (const [x, y, reach] of tufts) {
      stroke(cell, x - (x - 0.02) * 0.25, 0.5 + (y - 0.5) * 0.3, x, y, fine * 1.2, 0.35)
      for (let index = 0; index < 34; index += 1) {
        const angle = random() * Math.PI * 2
        const size = reach * (0.65 + random() * 0.4)
        stroke(cell, x, y, x + Math.cos(angle) * size, y + Math.sin(angle) * size, fine, 0.5 + random() * 0.5)
      }
    }
    return cell
  }

  // A flat bough: a twig with side twigs, needles on all of them. A hemlock's is finer and hangs.
  const hemlock = kind === 'hemlock'
  const sag = hemlock ? 0.16 : 0.04
  const twigAt = (t: number): [number, number] => [0.02 + 0.96 * t, 0.5 + sag * t * t - sag * 0.4]
  const segments = 8
  for (let index = 0; index < segments; index += 1) {
    const a = twigAt(index / segments)
    const b = twigAt((index + 1) / segments)
    stroke(cell, a[0], a[1], b[0], b[1], fine * 1.5, 0.38)
    needles(cell, random, a, b, hemlock ? 0.07 : 0.1, {
      count: hemlock ? 9 : 7,
      sweep: 1.05,
      half: fine,
      taper: 0.2,
    })
  }
  const sideTwigs = hemlock ? 7 : 5
  for (let index = 0; index < sideTwigs; index += 1) {
    const t = 0.1 + (index / sideTwigs) * 0.74
    const base = twigAt(t)
    for (const side of [-1, 1]) {
      // Longest a third of the way out, so the bough's outline is a leaf shape and not a comb.
      const reach = (hemlock ? 0.3 : 0.34) * (1 - 0.75 * Math.abs(t - 0.3)) * (0.8 + random() * 0.35)
      const angle = 0.75 + random() * 0.25
      const tip: [number, number] = [
        base[0] + Math.cos(angle) * reach,
        base[1] + side * Math.sin(angle) * reach + (hemlock ? 0.05 * reach : 0),
      ]
      stroke(cell, base[0], base[1], tip[0], tip[1], fine * 1.2, 0.4)
      needles(cell, random, base, tip, hemlock ? 0.05 : 0.075, {
        count: Math.max(6, Math.round(reach * (hemlock ? 80 : 56))),
        sweep: 1.0,
        half: fine,
        taper: 0.35,
      })
    }
  }
  return cell
}

let cached: AtlasImage | null = null

/**
 * The sheet: `SPRAY_COLUMNS` × `SPRAY_ROWS` cells of `SPRAY_CELL_PIXELS`, brightness in the colour
 * channels and coverage in alpha, not premultiplied. Built once.
 */
export function buildSpraySheet(): AtlasImage {
  if (cached) return cached
  const size = SPRAY_CELL_PIXELS
  const width = SPRAY_COLUMNS * size
  const height = SPRAY_ROWS * size
  const data = new Uint8ClampedArray(width * height * 4)
  SPRAY_KINDS.forEach((kind, index) => {
    const cell = drawSpray(kind, size)
    const originX = (index % SPRAY_COLUMNS) * size
    const originY = Math.floor(index / SPRAY_COLUMNS) * size
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const from = row * size + column
        const to = ((originY + row) * width + originX + column) * 4
        const light = Math.round(cell.light[from] * 255)
        data[to] = light
        data[to + 1] = light
        data[to + 2] = light
        data[to + 3] = Math.round(cell.alpha[from] * 255)
      }
    }
  })
  cached = { width, height, data }
  return cached
}

/** The sheet read at a texture coordinate, nearest pixel: `[brightness, coverage]`, each 0–1. */
export function sampleSpray(sheet: AtlasImage, u: number, v: number): [number, number] {
  const x = Math.max(0, Math.min(sheet.width - 1, Math.floor(u * sheet.width)))
  const y = Math.max(0, Math.min(sheet.height - 1, Math.floor(v * sheet.height)))
  const at = (y * sheet.width + x) * 4
  return [sheet.data[at] / 255, sheet.data[at + 3] / 255]
}
