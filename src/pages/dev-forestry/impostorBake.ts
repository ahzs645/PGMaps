/**
 * Tree cards taken from the trees themselves.
 *
 * The drawn atlas (`impostor.ts`) is one side-on silhouette per tree, and the detailed mesh the
 * road view stops on is a different drawing of it: stopping changed every near tree's outline and
 * colour, and a card showed the same face whichever way it was passed. This takes each tree's card
 * from its own detailed mesh instead, from several sides, with the surface's normal beside its
 * colour: the card is then the mesh's picture, it turns as the eye goes round it, and it is lit as
 * the mesh is.
 *
 * The idea is the baked impostor of three.ez's octahedral-impostor (Andrea Gargaro, MIT; see
 * `NOTICE-OCTAHEDRAL-IMPOSTOR.md`): an orthographic picture of the model from each of a set of
 * directions, colour in one sheet and normal with depth in another, the nearest shown at draw time.
 * Ours differs where a tree does. The views ring the stem at eye level instead of covering a
 * hemisphere, because the road view looks near level; each is as narrow as the tree, not a square
 * round its bounding sphere, which leaves seven tenths of a tall tree's cell empty; and it is
 * rasterised here on the CPU, so it is the same bytes on every machine and in the unit tests.
 *
 * Free of DOM access.
 */

import { CONE_BASE_DIAMETER, TREE_DRAWING_IDS, mulberry32, type ForestMesh, type TreeDrawingId } from './forest'
import {
  BILLBOARD_ASPECT,
  CLUMP_ASPECT,
  CLUMP_TREES,
  drawingCrownRatio,
  drawingPalette,
  type AtlasImage,
  type ImpostorAtlas,
} from './impostor'
import { detailedTreeMesh } from './treeGeometry'
import { SPRAY_ALPHA_CUT, buildSpraySheet, sampleSpray } from './treeSprays'

/** Views round each tree. Eight is 45° apart: a stem passed on a road goes through two or three. */
export const BAKED_AZIMUTHS = 8
/** Trees baked per drawing. Each stem also stands at its own turn, so two go a long way. */
export const BAKED_VARIANTS = 2
/** A baked cell's height in pixels; its width is `BILLBOARD_ASPECT` of it. */
export const BAKED_CELL_HEIGHT = 192
/** Clump cards drawn per drawing, as in the drawn clump atlas. */
const BAKED_CLUMP_VARIANTS = 4

/** The detailed mesh a drawing's variant is baked from and drawn as when the view stops. */
export function bakedTreeMesh(drawing: TreeDrawingId, variant: number): ForestMesh {
  return detailedTreeMesh(drawing, TREE_DRAWING_IDS.indexOf(drawing) * BAKED_VARIANTS + variant + 1, 'cards')
}

export type BakedView = {
  width: number
  height: number
  /** Colour and coverage, four bytes a pixel, not premultiplied; rows from the top of the tree. */
  colour: Uint8ClampedArray
  /** Normal across and up, foliage (255) or bark (0), and depth toward the camera. */
  surface: Uint8ClampedArray
}

/**
 * One side-on picture of a mesh, as the layer's card shows it.
 *
 * `azimuth` is where the camera stands, radians counter-clockwise from the mesh's +x axis. Across
 * the picture runs the way the card's corner does (`treeLayer.ts`), which is to the camera's left,
 * so a card showing this view is the tree as seen from there and not its mirror image.
 */
export function bakeTreeView(
  mesh: ForestMesh,
  drawing: TreeDrawingId,
  azimuth: number,
  width: number,
  height: number,
  supersample = 2,
): BakedView {
  const sheet = buildSpraySheet()
  const palette = drawingPalette(drawing)
  const positions = mesh.attributes.positions.value
  const normals = mesh.attributes.normals.value
  const bark = mesh.attributes.bark?.value
  const uvs = mesh.attributes.uvs?.value
  const index = mesh.indices.value
  const w = width * supersample
  const h = height * supersample
  // A card is `BILLBOARD_ASPECT` of the tree's height wide with the drawing's crown filling its
  // crown ratio of that height; the mesh's crown is `CONE_BASE_DIAMETER` across in its own units.
  const widthScale = drawingCrownRatio(drawing) / CONE_BASE_DIAMETER
  const across = [Math.sin(azimuth), -Math.cos(azimuth)]
  const toward = [Math.cos(azimuth), Math.sin(azimuth)]

  const depth = new Float32Array(w * h).fill(-Infinity)
  const red = new Float32Array(w * h)
  const green = new Float32Array(w * h)
  const blue = new Float32Array(w * h)
  const normalX = new Float32Array(w * h)
  const normalY = new Float32Array(w * h)
  const leaf = new Uint8Array(w * h)
  const hit = new Uint8Array(w * h)

  const sx = new Float64Array(3)
  const sy = new Float64Array(3)
  const sd = new Float64Array(3)
  const nx = new Float64Array(3)
  const ny = new Float64Array(3)
  const tu = new Float64Array(3)
  const tv = new Float64Array(3)

  for (let t = 0; t < index.length; t += 3) {
    let woody = 0
    let textured = true
    for (let corner = 0; corner < 3; corner += 1) {
      const i = index[t + corner]
      const x = positions[i * 3]
      const y = positions[i * 3 + 1]
      const z = positions[i * 3 + 2]
      const along = (x * across[0] + y * across[1]) * widthScale
      sx[corner] = (0.5 + along / BILLBOARD_ASPECT) * w
      sy[corner] = (1 - z) * h
      sd[corner] = (x * toward[0] + y * toward[1]) * widthScale
      // The mesh is drawn narrower than it is built, which tips its normals toward the horizontal.
      const mx = normals[i * 3] / widthScale
      const my = normals[i * 3 + 1] / widthScale
      const mz = normals[i * 3 + 2]
      const length = Math.hypot(mx, my, mz) || 1
      nx[corner] = (mx * across[0] + my * across[1]) / length
      ny[corner] = mz / length
      woody = bark ? bark[i] : 0
      if (uvs) {
        tu[corner] = uvs[i * 2]
        tv[corner] = uvs[i * 2 + 1]
        if (tu[corner] < 0) textured = false
      } else textured = false
    }
    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0])
    if (Math.abs(area) < 1e-9) continue
    const minX = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])))
    const maxX = Math.min(w - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])))
    const minY = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2])))
    const maxY = Math.min(h - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])))
    for (let row = minY; row <= maxY; row += 1) {
      for (let column = minX; column <= maxX; column += 1) {
        const px = column + 0.5
        const py = row + 0.5
        const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / area
        const w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / area
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const at = row * w + column
        const d = sd[0] * w0 + sd[1] * w1 + sd[2] * w2
        if (d <= depth[at]) continue
        let light = 1
        if (textured) {
          const [brightness, coverage] = sampleSpray(
            sheet,
            tu[0] * w0 + tu[1] * w1 + tu[2] * w2,
            tv[0] * w0 + tv[1] * w1 + tv[2] * w2,
          )
          if (coverage < SPRAY_ALPHA_CUT) continue
          light = sprayLight(brightness)
        }
        depth[at] = d
        hit[at] = 1
        // A limb inside the crown carries a part share of bark (`LIMB_BARK`), as the layer mixes it.
        red[at] = (palette.foliage[0] * (1 - woody) + palette.bark[0] * woody) * light
        green[at] = (palette.foliage[1] * (1 - woody) + palette.bark[1] * woody) * light
        blue[at] = (palette.foliage[2] * (1 - woody) + palette.bark[2] * woody) * light
        leaf[at] = woody > 0.5 ? 0 : 1
        // Across and up as the mesh has them. The third part is worked out by the layer as facing
        // the camera, so a card of foliage seen from behind keeps its lean and its tilt, as the
        // mesh's own shading does, and only stops pointing away.
        const fx = nx[0] * w0 + nx[1] * w1 + nx[2] * w2
        const fy = ny[0] * w0 + ny[1] * w1 + ny[2] * w2
        normalX[at] = fx
        normalY[at] = fy
      }
    }
  }

  const colour = new Uint8ClampedArray(width * height * 4)
  const surface = new Uint8ClampedArray(width * height * 4)
  const samples = supersample * supersample
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      let hits = 0
      let r = 0
      let g = 0
      let b = 0
      let fx = 0
      let fy = 0
      let foliage = 0
      let nearest = -Infinity
      for (let dy = 0; dy < supersample; dy += 1) {
        for (let dx = 0; dx < supersample; dx += 1) {
          const at = (row * supersample + dy) * w + column * supersample + dx
          if (!hit[at]) continue
          hits += 1
          r += red[at]
          g += green[at]
          b += blue[at]
          fx += normalX[at]
          fy += normalY[at]
          foliage += leaf[at]
          nearest = Math.max(nearest, depth[at])
        }
      }
      const out = (row * width + column) * 4
      if (hits === 0) {
        // Facing the camera, so a filtered edge leans nowhere.
        surface[out] = 128
        surface[out + 1] = 128
        surface[out + 2] = 255
        surface[out + 3] = 0
        continue
      }
      colour[out] = (r / hits) * 255
      colour[out + 1] = (g / hits) * 255
      colour[out + 2] = (b / hits) * 255
      colour[out + 3] = (hits / samples) * 255
      surface[out] = ((fx / hits) * 0.5 + 0.5) * 255
      surface[out + 1] = ((fy / hits) * 0.5 + 0.5) * 255
      surface[out + 2] = (foliage / hits) * 255
      // Depth in tree heights: a crown is at most a few tenths of its height deep.
      surface[out + 3] = Math.max(0, Math.min(1, nearest * 2 + 0.5)) * 255
    }
  }
  spreadSurface(surface, colour, width, height)
  return { width, height, colour, surface }
}

/** How a spray picture's brightness shades its tree's foliage: the shader does the same. */
export function sprayLight(brightness: number): number {
  return 0.66 + 0.5 * brightness
}

/**
 * Carries each edge pixel's surface out into the empty pixels beside it, twice. The layer filters
 * the surface sheet, and an edge filtered against nothing leaned toward the camera and lit a
 * bright rim round every crown.
 */
function spreadSurface(surface: Uint8ClampedArray, colour: Uint8ClampedArray, width: number, height: number) {
  let filled = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i += 1) filled[i] = colour[i * 4 + 3] > 0 ? 1 : 0
  for (let pass = 0; pass < 2; pass += 1) {
    const next = filled.slice()
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const at = row * width + column
        if (filled[at]) continue
        let count = 0
        let x = 0
        let y = 0
        let foliage = 0
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const cx = column + dx
          const cy = row + dy
          if (cx < 0 || cy < 0 || cx >= width || cy >= height || !filled[cy * width + cx]) continue
          const from = (cy * width + cx) * 4
          x += surface[from]
          y += surface[from + 1]
          foliage += surface[from + 2]
          count += 1
        }
        if (count === 0) continue
        surface[at * 4] = x / count
        surface[at * 4 + 1] = y / count
        surface[at * 4 + 2] = foliage / count
        next[at] = 1
      }
    }
    filled = next
  }
}

let bakedAtlas: ImpostorAtlas | null = null

/** An empty atlas of every drawing's views, and the work of filling one drawing's row. */
function atlasInProgress() {
  const cellHeight = BAKED_CELL_HEIGHT
  const cellWidth = Math.round(cellHeight * BILLBOARD_ASPECT)
  const columns = BAKED_VARIANTS * BAKED_AZIMUTHS
  const rows = TREE_DRAWING_IDS.length
  const width = cellWidth * columns
  const height = cellHeight * rows
  const image: AtlasImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  const surface: AtlasImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  const speciesRow = Object.fromEntries(TREE_DRAWING_IDS.map((drawing, row) => [drawing, row])) as Record<
    TreeDrawingId,
    number
  >
  const bakeRow = (row: number) => {
    const drawing = TREE_DRAWING_IDS[row]
    for (let variant = 0; variant < BAKED_VARIANTS; variant += 1) {
      const mesh = bakedTreeMesh(drawing, variant)
      for (let view = 0; view < BAKED_AZIMUTHS; view += 1) {
        const baked = bakeTreeView(mesh, drawing, (view / BAKED_AZIMUTHS) * Math.PI * 2, cellWidth, cellHeight)
        const originX = (variant * BAKED_AZIMUTHS + view) * cellWidth
        const originY = row * cellHeight
        for (let y = 0; y < cellHeight; y += 1) {
          const from = y * cellWidth * 4
          const to = ((originY + y) * width + originX) * 4
          image.data.set(baked.colour.subarray(from, from + cellWidth * 4), to)
          surface.data.set(baked.surface.subarray(from, from + cellWidth * 4), to)
        }
      }
    }
  }
  const atlas: ImpostorAtlas = {
    image,
    surface,
    azimuths: BAKED_AZIMUTHS,
    columns,
    rows,
    cellWidth,
    cellHeight,
    speciesRow,
  }
  return { atlas, rows, bakeRow }
}

/**
 * Every drawing baked: a row each, `BAKED_VARIANTS` trees across, each tree's `BAKED_AZIMUTHS`
 * views side by side. Built once and kept. About two seconds of work, so a page takes it through
 * `bakeImpostorAtlasInSteps` and only a test or a script calls this.
 */
export function bakeImpostorAtlas(): ImpostorAtlas {
  if (bakedAtlas) return bakedAtlas
  const work = atlasInProgress()
  for (let row = 0; row < work.rows; row += 1) work.bakeRow(row)
  bakedAtlas = work.atlas
  return bakedAtlas
}

/** The baked atlas if it has been built already, without building it. */
export function bakedImpostorAtlas(): ImpostorAtlas | null {
  return bakedAtlas
}

let baking: Promise<ImpostorAtlas> | null = null

/**
 * The same atlas, a drawing at a time with `pause` awaited between them, so the page that asked
 * for it keeps drawing while it is made. Asked for twice, it is made once.
 */
export function bakeImpostorAtlasInSteps(
  pause: () => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<ImpostorAtlas> {
  if (bakedAtlas) return Promise.resolve(bakedAtlas)
  if (baking) return baking
  baking = (async () => {
    const work = atlasInProgress()
    for (let row = 0; row < work.rows; row += 1) {
      work.bakeRow(row)
      onProgress?.(row + 1, work.rows)
      await pause()
    }
    bakedAtlas = work.atlas
    return work.atlas
  })()
  return baking
}

let bakedClumps: ImpostorAtlas | null = null

/**
 * The far bands' clump cards, built of the baked trees: `CLUMP_TREES` of them side by side at
 * varied heights, as `impostorClumpShapes` lays the drawn ones out, so the far forest is the same
 * trees as the near one. One view each: past half a kilometre a card stands for many stems and
 * nobody passes it.
 */
export function bakeClumpAtlas(cellHeight = 128): ImpostorAtlas {
  if (bakedClumps && bakedClumps.cellHeight === cellHeight) return bakedClumps
  const trees = bakeImpostorAtlas()
  const cellWidth = Math.round(cellHeight * CLUMP_ASPECT)
  const columns = BAKED_CLUMP_VARIANTS
  const rows = TREE_DRAWING_IDS.length
  const width = cellWidth * columns
  const height = cellHeight * rows
  const image: AtlasImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  const surface: AtlasImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (let i = 0; i < width * height; i += 1) {
    surface.data[i * 4] = 128
    surface.data[i * 4 + 1] = 128
    surface.data[i * 4 + 2] = 255
  }
  const source = trees.image!
  const sourceSurface = trees.surface!
  const slot = 1 / CLUMP_TREES
  TREE_DRAWING_IDS.forEach((drawing, row) => {
    const crownHalf = drawingCrownRatio(drawing) / BILLBOARD_ASPECT / 2
    for (let variant = 0; variant < columns; variant += 1) {
      const random = mulberry32((row + 1) * 3571 + variant * 65_537)
      const stems = Array.from({ length: CLUMP_TREES }, (_, k) => ({
        centre: (k + 0.5) * slot + (random() - 0.5) * slot * 0.4,
        height: 0.62 + random() * 0.38,
        cell: Math.floor(random() * BAKED_VARIANTS * BAKED_AZIMUTHS),
      }))
      // One tree reaches the top, so a clump is as tall as the stand it stands in for.
      stems[Math.floor(random() * CLUMP_TREES)].height = 1
      // Tall trees first: the shorter ones stand in front of them.
      stems.sort((a, b) => b.height - a.height)
      const originX = variant * cellWidth
      const originY = row * cellHeight
      for (const stem of stems) {
        // A tree's cell spans this much of the clump card, as `impostorClumpShapes` sets it.
        const span = (slot * 0.55) / crownHalf
        const left = Math.max(0, Math.floor((stem.centre - span / 2) * cellWidth))
        const right = Math.min(cellWidth - 1, Math.ceil((stem.centre + span / 2) * cellWidth))
        const top = Math.max(0, Math.floor((1 - stem.height) * cellHeight))
        for (let y = top; y < cellHeight; y += 1) {
          const v = 1 - (1 - (y + 0.5) / cellHeight) / stem.height
          if (v < 0 || v >= 1) continue
          const sy = row * trees.cellHeight + Math.min(trees.cellHeight - 1, Math.floor(v * trees.cellHeight))
          for (let x = left; x <= right; x += 1) {
            const u = ((x + 0.5) / cellWidth - stem.centre) / span + 0.5
            if (u < 0 || u >= 1) continue
            const sx = stem.cell * trees.cellWidth + Math.min(trees.cellWidth - 1, Math.floor(u * trees.cellWidth))
            const from = (sy * source.width + sx) * 4
            const alpha = source.data[from + 3] / 255
            if (alpha <= 0) continue
            const to = ((originY + y) * width + originX + x) * 4
            const under = image.data[to + 3] / 255
            const total = alpha + under * (1 - alpha)
            for (let c = 0; c < 3; c += 1) {
              image.data[to + c] = (source.data[from + c] * alpha + image.data[to + c] * under * (1 - alpha)) / total
            }
            image.data[to + 3] = total * 255
            if (alpha >= 0.5) {
              surface.data[to] = sourceSurface.data[from]
              surface.data[to + 1] = sourceSurface.data[from + 1]
              surface.data[to + 2] = sourceSurface.data[from + 2]
              surface.data[to + 3] = sourceSurface.data[from + 3]
            }
          }
        }
      }
    }
  })
  const speciesRow = Object.fromEntries(TREE_DRAWING_IDS.map((drawing, row) => [drawing, row])) as Record<
    TreeDrawingId,
    number
  >
  bakedClumps = { image, surface, columns, rows, cellWidth, cellHeight, speciesRow }
  return bakedClumps
}

/** The share of a view's cell its tree covers, as the layer cuts it out (`cut` the alpha threshold, 0–1). */
export function viewCoverage(view: Pick<BakedView, 'colour'>, cut: number): number {
  let covered = 0
  const count = view.colour.length / 4
  for (let i = 0; i < count; i += 1) if (view.colour[i * 4 + 3] >= cut * 255) covered += 1
  return covered / count
}
