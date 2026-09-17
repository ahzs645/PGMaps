/**
 * Trees drawn once into a texture, then stood up as cards.
 *
 * A forest is the one thing in a 3D scene you cannot brute-force: a stand you
 * can see a cutblock across is tens of thousands of stems, and modelled
 * geometry at that count buys detail nobody can resolve past about a hundred
 * metres. The standard answer — and what every forest visualiser worth looking
 * at does — is an impostor: draw the tree once, at good resolution, and render
 * each stem as two triangles carrying that picture, turned to face the camera.
 *
 * Two triangles against the thirty-odd a solid cone needs is most of the win.
 * The rest is that a drawn silhouette, with a bole and drooping whorls, reads as
 * a tree at any distance, and a cone never does.
 *
 * The silhouettes are generated here rather than shipped as assets, so there is
 * nothing to license, nothing to download, and the stand can be redrawn for a
 * different species mix without an art pipeline.
 */

import { SPECIES_CROWN_RATIO, VARIANTS_PER_SPECIES, TREE_SPECIES_IDS, type TreeSpeciesId } from './forest'

/**
 * Cell width over cell height in the atlas. Every card is drawn at this aspect
 * and each species uses as much of the width as its crown needs, so one texture
 * covers a narrow fir and a broad aspen without stretching either.
 */
export const BILLBOARD_ASPECT = 0.5

/** A filled shape in unit space: x across the card, y up from the ground. */
export type ImpostorShape = {
  points: Array<[number, number]>
  color: [number, number, number]
}

type SpeciesDrawing = {
  label: string
  /** Crown width over tree height. */
  crownRatio: number
  /** Height up the stem where the live crown starts, 0–1. */
  crownBase: number
  /** Branch tiers. A fir carries many short ones, a pine few long ones. */
  tiers: number
  /** How far a tier droops below where it leaves the stem, as a share of tier spacing. */
  droop: number
  foliage: [number, number, number]
  bark: [number, number, number]
  broadleaf?: boolean
}

/**
 * What each species looks like from the side.
 *
 * These are drawing parameters chosen to read correctly at a glance, not
 * mensuration: a lodgepole's long clean bole and short crown, a spruce's spire
 * to near the ground, a subalpine fir narrower still, an aspen's rounded crown
 * over a pale stem.
 */
export const TREE_SPECIES_DRAWING: Record<TreeSpeciesId, SpeciesDrawing> = {
  pine: {
    label: 'Lodgepole pine',
    crownRatio: SPECIES_CROWN_RATIO.pine,
    crownBase: 0.54,
    tiers: 8,
    droop: 0.85,
    foliage: [62, 96, 60],
    bark: [92, 74, 58],
  },
  spruce: {
    label: 'Interior spruce',
    crownRatio: SPECIES_CROWN_RATIO.spruce,
    crownBase: 0.14,
    tiers: 13,
    droop: 1.25,
    foliage: [44, 82, 64],
    bark: [82, 64, 52],
  },
  fir: {
    label: 'Subalpine fir',
    crownRatio: SPECIES_CROWN_RATIO.fir,
    crownBase: 0.1,
    tiers: 16,
    droop: 0.8,
    foliage: [38, 72, 60],
    bark: [86, 78, 70],
  },
  aspen: {
    label: 'Trembling aspen',
    crownRatio: SPECIES_CROWN_RATIO.aspen,
    crownBase: 0.44,
    tiers: 0,
    droop: 0,
    foliage: [112, 142, 68],
    bark: [198, 198, 184],
    broadleaf: true,
  },
}

/** Deterministic noise, so the same species and variant always draw the same. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shade(color: [number, number, number], factor: number): [number, number, number] {
  return [
    Math.max(0, Math.min(255, Math.round(color[0] * factor))),
    Math.max(0, Math.min(255, Math.round(color[1] * factor))),
    Math.max(0, Math.min(255, Math.round(color[2] * factor))),
  ]
}

/** An n-sided blob, for a broadleaf crown. */
function blob(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  random: () => number,
  sides = 11,
): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (let index = 0; index < sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2
    const wobble = 0.82 + random() * 0.36
    points.push([cx + Math.cos(angle) * rx * wobble, cy + Math.sin(angle) * ry * wobble])
  }
  return points
}

/**
 * One tree's silhouette, in unit space.
 *
 * `x` runs 0–1 across the card with the stem at 0.5, `y` runs 0 at the ground to
 * 1 at the leader. Shapes come back in draw order, back to front.
 */
export function impostorShapes(species: TreeSpeciesId, variant: number): ImpostorShape[] {
  const spec = TREE_SPECIES_DRAWING[species]
  const random = mulberry32((TREE_SPECIES_IDS.indexOf(species) + 1) * 7919 + variant * 104_729)
  const shapes: ImpostorShape[] = []

  // The crown's half-width as a share of the card, which is `crownRatio` of the
  // tree's height while the card is `BILLBOARD_ASPECT` of it.
  const crownHalf = spec.crownRatio / BILLBOARD_ASPECT / 2

  // Bole first, so foliage closes over it.
  const boleFoot = 0.03
  const boleHead = 0.008
  const lean = (random() - 0.5) * 0.04
  shapes.push({
    points: [
      [0.5 - boleFoot, 0],
      [0.5 + boleFoot, 0],
      [0.5 + boleHead + lean, 1],
      [0.5 - boleHead + lean, 1],
    ],
    color: spec.bark,
  })

  if (spec.broadleaf) {
    // A rounded crown built from overlapping masses, darker behind.
    const masses = 9
    const crowns: ImpostorShape[] = []
    for (let index = 0; index < masses; index += 1) {
      const depth = index / (masses - 1)
      crowns.push({
        points: blob(
          (random() - 0.5) * 0.9,
          (random() - 0.5) * 0.9,
          0.34 + random() * 0.3,
          0.34 + random() * 0.3,
          random,
        ),
        color: shade(spec.foliage, 0.68 + 0.42 * depth),
      })
    }

    // Masses land where the noise puts them, so the crown is fitted to the card
    // afterwards rather than hoped into it — which also means it always reaches
    // the top, whatever the draw.
    const points = crowns.flatMap((shape) => shape.points)
    const spreadX = Math.max(...points.map(([x]) => Math.abs(x))) || 1
    const minY = Math.min(...points.map(([, y]) => y))
    const spanY = Math.max(...points.map(([, y]) => y)) - minY || 1
    for (const shape of crowns) {
      shape.points = shape.points.map(([x, y]) => [
        0.5 + (x / spreadX) * crownHalf,
        spec.crownBase + ((y - minY) / spanY) * (1 - spec.crownBase),
      ])
      shapes.push(shape)
    }
    return shapes
  }

  // The highest tier stops short of the top, leaving the leader to reach it —
  // otherwise a tier's upward sweep runs past the edge of the card and clips.
  const crownTop = 0.93

  for (let tier = 0; tier < spec.tiers; tier += 1) {
    const t = spec.tiers > 1 ? tier / (spec.tiers - 1) : 1
    const attach = spec.crownBase + (crownTop - spec.crownBase) * Math.pow(t, 0.92)
    // Widest at the bottom of the live crown, tapering to the leader.
    const half = crownHalf * Math.pow(1 - t, 1.2) + 0.015
    const spacing = (1 - spec.crownBase) / Math.max(1, spec.tiers)
    const drop = spacing * spec.droop * (1.4 + random() * 0.8)
    const lift = drop * 0.25

    for (const side of [-1, 1]) {
      const width = half * (0.82 + random() * 0.36)
      shapes.push({
        points: (
          [
            [0.5, attach + lift],
            [0.5 + side * width * 0.35, attach + lift * 0.35],
            [0.5 + side * width, attach - drop * 0.3],
            [0.5 + side * width * 0.72, attach - drop * 0.75],
            [0.5 + side * width * 0.28, attach - drop],
            [0.5, attach - drop * 0.4],
          ] as Array<[number, number]>
        ).map(([x, y]) => [x, Math.max(0, Math.min(1, y))] as [number, number]),
        // Lower branches sit in the crown's own shade; the leader catches light.
        color: shade(spec.foliage, 0.66 + 0.42 * t + (random() - 0.5) * 0.1),
      })
    }
  }

  // A leader, so the top is a point rather than a flat tier.
  shapes.push({
    points: [
      [0.5 - 0.02, 0.92],
      [0.5 + 0.02, 0.92],
      [0.5, 1],
    ],
    color: shade(spec.foliage, 1.08),
  })

  return shapes
}

export type ImpostorAtlas = {
  canvas: HTMLCanvasElement
  /** Variants across. */
  columns: number
  /** Species down. */
  rows: number
  cellWidth: number
  cellHeight: number
  /** Row for each species, matching how the layer indexes the atlas. */
  speciesRow: Record<TreeSpeciesId, number>
}

/** Where one cell's top-left sits, in texture coordinates. */
export function atlasCell(
  atlas: Pick<ImpostorAtlas, 'columns' | 'rows' | 'speciesRow'>,
  species: TreeSpeciesId,
  variant: number,
): [number, number] {
  const column = ((variant % atlas.columns) + atlas.columns) % atlas.columns
  return [column / atlas.columns, atlas.speciesRow[species] / atlas.rows]
}

/**
 * Draws every species and variant into one texture.
 *
 * Browser only — it needs a canvas. Called once when the stand is switched on,
 * and the result is uploaded as a mipmapped texture, which is what keeps the
 * far shell from shimmering.
 */
export function buildImpostorAtlas(cellHeight = 256): ImpostorAtlas {
  const cellWidth = Math.round(cellHeight * BILLBOARD_ASPECT)
  const columns = VARIANTS_PER_SPECIES
  const rows = TREE_SPECIES_IDS.length

  const canvas = document.createElement('canvas')
  canvas.width = cellWidth * columns
  canvas.height = cellHeight * rows
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser gave the 3D stand no 2D canvas to draw its trees on.')

  const speciesRow = {} as Record<TreeSpeciesId, number>
  TREE_SPECIES_IDS.forEach((species, row) => {
    speciesRow[species] = row
    for (let variant = 0; variant < columns; variant += 1) {
      const originX = variant * cellWidth
      const originY = row * cellHeight

      for (const shape of impostorShapes(species, variant)) {
        context.beginPath()
        shape.points.forEach(([x, y], index) => {
          // Unit space is y-up from the ground; a canvas is y-down from the top.
          // A one-pixel inset keeps a crown from bleeding into the next cell.
          const px = originX + 0.5 + x * (cellWidth - 1)
          const py = originY + 0.5 + (1 - y) * (cellHeight - 1)
          if (index === 0) context.moveTo(px, py)
          else context.lineTo(px, py)
        })
        context.closePath()
        context.fillStyle = `rgb(${shape.color[0]}, ${shape.color[1]}, ${shape.color[2]})`
        context.fill()
      }
    }
  })

  return { canvas, columns, rows, cellWidth, cellHeight, speciesRow }
}
