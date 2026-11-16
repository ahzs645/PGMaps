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

import {
  SPECIES_CROWN_RATIO,
  TREE_DRAWING_IDS,
  VARIANTS_PER_SPECIES,
  drawingSpecies,
  type TreeDrawingId,
  type TreeSpeciesId,
} from './forest'

/**
 * Cell width over cell height in the atlas. Every card is drawn at this aspect
 * and each species uses as much of the width as its crown needs, so one texture
 * covers a narrow fir and a broad aspen without stretching either.
 */
export const BILLBOARD_ASPECT = 0.3

/**
 * Past about half a kilometre one card stands for many stems, and a single
 * tree stretched to that width reads as a pancake on the skyline. A clump card
 * draws this many whole trees side by side instead.
 */
export const CLUMP_TREES = 8

/** A clump cell's width over its height. */
export const CLUMP_ASPECT = 3

/**
 * A clump card's width over the closure crown width it stands in for. At the
 * regional stand this makes a card about 1.2 × the band's spacing, so the rows
 * overlap and a hillside seen side-on is closed, as a mature forest is from
 * across a valley; the top-down closure only set how wide one stem's share is.
 */
export const CLUMP_WIDTH_FACTOR = 1.6

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
  /** Half the butt's width as a share of the card (0.03 where absent): a cottonwood's bole is heavy. */
  boleFoot?: number
  /** How far the leader leans over at the top, as a share of the card: a hemlock's nods. */
  nod?: number
  /** Extra width near the top as a share of the crown's, for a black spruce's clubbed head. */
  club?: number
  /** Several thin stems from the ground in place of one bole: a tall shrub. */
  stems?: number
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
    // Inside a stand the lower branches die back; live crown is about the top
    // 60–70%, so a view in under the canopy reaches past the first row.
    crownBase: 0.3,
    tiers: 13,
    droop: 1.25,
    foliage: [44, 82, 64],
    bark: [82, 64, 52],
  },
  fir: {
    label: 'Subalpine fir',
    crownRatio: SPECIES_CROWN_RATIO.fir,
    crownBase: 0.25,
    tiers: 16,
    droop: 0.8,
    foliage: [38, 72, 60],
    bark: [86, 78, 70],
  },
  douglasFir: {
    label: 'Interior Douglas-fir',
    crownRatio: SPECIES_CROWN_RATIO.douglasFir,
    // An open-grown interior fir keeps live limbs low; in a stand about the
    // top 60%. Fewer, longer tiers than a spruce, held level rather than
    // drooping, which is what gives it a ragged, layered outline.
    crownBase: 0.36,
    tiers: 9,
    droop: 0.45,
    foliage: [48, 84, 58],
    bark: [104, 82, 66],
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
  birch: {
    label: 'Paper birch',
    crownRatio: SPECIES_CROWN_RATIO.birch,
    crownBase: 0.48,
    tiers: 0,
    droop: 0,
    foliage: [96, 132, 62],
    bark: [226, 222, 212],
    broadleaf: true,
  },
  hemlock: {
    label: 'Western hemlock',
    crownRatio: SPECIES_CROWN_RATIO.hemlock,
    // Shade-tolerant: live crown lower than a spruce's in the same stand. Many fine tiers that
    // hang at the tips, under a leader that nods over.
    crownBase: 0.28,
    tiers: 15,
    droop: 1.5,
    foliage: [50, 88, 60],
    bark: [98, 76, 62],
    nod: 0.05,
  },
  blackSpruce: {
    label: 'Black spruce',
    crownRatio: SPECIES_CROWN_RATIO.blackSpruce,
    // A thin column of short limbs with a dense club at the top, on wet ground.
    crownBase: 0.3,
    tiers: 18,
    droop: 1.0,
    foliage: [36, 66, 56],
    bark: [80, 68, 62],
    club: 0.55,
  },
  cottonwood: {
    label: 'Black cottonwood',
    crownRatio: SPECIES_CROWN_RATIO.cottonwood,
    crownBase: 0.42,
    tiers: 0,
    droop: 0,
    foliage: [82, 122, 58],
    bark: [122, 116, 104],
    broadleaf: true,
    boleFoot: 0.05,
  },
}

/**
 * A young conifer's crown width over its height, as drawn. Open-grown regeneration is broad for
 * its height; the stem's real width still comes from its stand's closure, and this only sets the
 * shape that width is stretched from, near what a 5 m stem carries at the closure drawn for it.
 */
export const YOUNG_CROWN_RATIO = 0.27

/**
 * Every drawing: the species above, each conifer's young form (the same tree with its crown to the
 * ground, since nothing has shaded its lower limbs out yet) and the tall shrub.
 */
export const TREE_DRAWINGS: Record<TreeDrawingId, SpeciesDrawing> = Object.fromEntries(
  TREE_DRAWING_IDS.map((drawing): [TreeDrawingId, SpeciesDrawing] => {
    if (drawing === 'shrub') {
      return [
        drawing,
        {
          label: 'Tall shrub (alder, willow)',
          crownRatio: YOUNG_CROWN_RATIO,
          crownBase: 0.1,
          tiers: 0,
          droop: 0,
          foliage: [96, 126, 64],
          bark: [112, 102, 86],
          broadleaf: true,
          stems: 4,
        },
      ]
    }
    const species = drawingSpecies(drawing)
    const spec = TREE_SPECIES_DRAWING[species]
    if (drawing === species) return [drawing, spec]
    return [
      drawing,
      {
        ...spec,
        label: `${spec.label}, young`,
        crownRatio: YOUNG_CROWN_RATIO,
        crownBase: 0.05,
        // About a whorl a year: a young stem has fewer, and they have not begun to sag.
        tiers: Math.max(7, Math.round(spec.tiers * 0.7)),
        droop: spec.droop * 0.75,
        club: undefined,
      },
    ]
  }),
) as Record<TreeDrawingId, SpeciesDrawing>

/** A drawing's crown width over its height: what the layer stretches a card or mesh from. */
export function drawingCrownRatio(drawing: TreeDrawingId): number {
  return TREE_DRAWINGS[drawing].crownRatio
}

/** A drawing's foliage and bark, 0–1: the detailed mesh is coloured as its card is. */
export function drawingPalette(drawing: TreeDrawingId): {
  foliage: [number, number, number]
  bark: [number, number, number]
} {
  const spec = TREE_DRAWINGS[drawing]
  const unit = (colour: [number, number, number]): [number, number, number] => [
    colour[0] / 255,
    colour[1] / 255,
    colour[2] / 255,
  ]
  return { foliage: unit(spec.foliage), bark: unit(spec.bark) }
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
export function impostorShapes(drawing: TreeDrawingId, variant: number): ImpostorShape[] {
  const spec = TREE_DRAWINGS[drawing]
  // Species come first in `TREE_DRAWING_IDS`, so each keeps the seed it always had.
  const random = mulberry32((TREE_DRAWING_IDS.indexOf(drawing) + 1) * 7919 + variant * 104_729)
  const shapes: ImpostorShape[] = []

  // The crown's half-width as a share of the card, which is `crownRatio` of the
  // tree's height while the card is `BILLBOARD_ASPECT` of it.
  const crownHalf = spec.crownRatio / BILLBOARD_ASPECT / 2

  // Bole first, so foliage closes over it.
  const boleFoot = spec.boleFoot ?? 0.03
  const boleHead = 0.008
  const lean = (random() - 0.5) * 0.04
  if (spec.stems) {
    // A shrub: thin stems fanning from one root, lost in the leaves by half height.
    for (let stem = 0; stem < spec.stems; stem += 1) {
      const reach = ((stem + 0.5) / spec.stems - 0.5) * 2 * crownHalf * 0.8
      shapes.push({
        points: [
          [0.5 - 0.012, 0],
          [0.5 + 0.012, 0],
          [0.5 + reach + 0.008, 0.5],
          [0.5 + reach - 0.008, 0.5],
        ],
        color: spec.bark,
      })
    }
  } else {
    shapes.push({
      points: [
        [0.5 - boleFoot, 0],
        [0.5 + boleFoot, 0],
        [0.5 + boleHead + lean, 1],
        [0.5 - boleHead + lean, 1],
      ],
      color: spec.bark,
    })
  }

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
    // Widest at the bottom of the live crown, tapering to the leader; a black spruce swells again
    // into a club just under its top.
    const club = spec.club ? crownHalf * spec.club * Math.exp(-(((t - 0.86) / 0.08) ** 2)) : 0
    const half = crownHalf * Math.pow(1 - t, 1.2) + 0.015 + club
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

  // A leader, so the top is a point rather than a flat tier. A hemlock's nods to one side.
  const nod = spec.nod ? spec.nod * (random() < 0.5 ? -1 : 1) : 0
  shapes.push({
    points: [
      [0.5 - 0.02, 0.92],
      [0.5 + 0.02, 0.92],
      [0.5 + nod, 1],
    ],
    color: shade(spec.foliage, 1.08),
  })

  return shapes
}

/**
 * A clump of the species: `CLUMP_TREES` trees across a unit card, of varied
 * heights, each drawn from `impostorShapes` and set in its own slot so
 * neighbouring crowns just touch. Same coordinates as one tree's card.
 */
export function impostorClumpShapes(drawing: TreeDrawingId, variant: number): ImpostorShape[] {
  const random = mulberry32((TREE_DRAWING_IDS.indexOf(drawing) + 1) * 3571 + variant * 65_537)
  const spec = TREE_DRAWINGS[drawing]
  const crownHalf = spec.crownRatio / BILLBOARD_ASPECT / 2
  const slot = 1 / CLUMP_TREES
  const trees = Array.from({ length: CLUMP_TREES }, (_, k) => ({
    centre: (k + 0.5) * slot + (random() - 0.5) * slot * 0.4,
    height: 0.62 + random() * 0.38,
    variant: (variant * CLUMP_TREES + k) % VARIANTS_PER_SPECIES,
  }))
  // One tree reaches the top, so a clump is as tall as the stand it stands in for.
  trees[Math.floor(random() * CLUMP_TREES)].height = 1
  // Short trees first: taller ones behind them would hide them.
  trees.sort((a, b) => b.height - a.height)
  return trees.flatMap((tree) =>
    impostorShapes(drawing, tree.variant).map((shape) => ({
      color: shape.color,
      points: shape.points.map(([x, y]): [number, number] => [
        Math.max(0, Math.min(1, tree.centre + ((x - 0.5) / crownHalf) * slot * 0.55)),
        y * tree.height,
      ]),
    })),
  )
}

/** A picture as bytes, four to a pixel, rows from the top. */
export type AtlasImage = { width: number; height: number; data: Uint8ClampedArray }

export type ImpostorAtlas = {
  /** The drawn atlas (`buildImpostorAtlas`); absent on a baked one, which carries `image`. */
  canvas?: HTMLCanvasElement
  /** A baked atlas's colour and coverage (`impostorBake.ts`), not premultiplied. */
  image?: AtlasImage
  /**
   * A baked atlas's second sheet, cell for cell with `image`: the surface normal in the view it was
   * taken from (red across, green up, the third worked out), blue 1 on foliage and 0 on bark, alpha
   * the depth toward the camera.
   */
  surface?: AtlasImage
  /**
   * Views round each tree, side by side in its row (1 where absent): a baked tree's variants each
   * take this many columns, and the layer shows the one nearest where the eye stands.
   */
  azimuths?: number
  /** Cells across: variants, times `azimuths` on a baked atlas. */
  columns: number
  /** Drawings down. */
  rows: number
  cellWidth: number
  cellHeight: number
  /** Row for each drawing, matching how the layer indexes the atlas. */
  speciesRow: Record<TreeDrawingId, number>
}

/** Where one cell's top-left sits, in texture coordinates: on a baked atlas, a variant's first view. */
export function atlasCell(
  atlas: Pick<ImpostorAtlas, 'columns' | 'rows' | 'speciesRow' | 'azimuths'>,
  drawing: TreeDrawingId,
  variant: number,
): [number, number] {
  const views = atlas.azimuths ?? 1
  const variants = Math.max(1, Math.round(atlas.columns / views))
  const column = (((variant % variants) + variants) % variants) * views
  return [column / atlas.columns, atlas.speciesRow[drawing] / atlas.rows]
}

/**
 * Draws every species and variant into one texture.
 *
 * Browser only — it needs a canvas. Called once when the stand is switched on,
 * and the result is uploaded as a mipmapped texture, which is what keeps the
 * far shell from shimmering.
 */
export function buildImpostorAtlas(cellHeight = 256, kind: 'tree' | 'clump' = 'tree'): ImpostorAtlas {
  const cellWidth = Math.round(cellHeight * (kind === 'clump' ? CLUMP_ASPECT : BILLBOARD_ASPECT))
  const shapesFor = kind === 'clump' ? impostorClumpShapes : impostorShapes
  const columns = VARIANTS_PER_SPECIES
  const rows = TREE_DRAWING_IDS.length

  const canvas = document.createElement('canvas')
  canvas.width = cellWidth * columns
  canvas.height = cellHeight * rows
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser gave the 3D stand no 2D canvas to draw its trees on.')

  const speciesRow = {} as Record<TreeDrawingId, number>
  TREE_DRAWING_IDS.forEach((species, row) => {
    speciesRow[species] = row
    for (let variant = 0; variant < columns; variant += 1) {
      const originX = variant * cellWidth
      const originY = row * cellHeight

      for (const shape of shapesFor(species, variant)) {
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
