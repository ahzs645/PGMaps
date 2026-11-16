import {
  drawingSpecies,
  isBroadleaf,
  type ConiferSpeciesId,
  type ForestMesh,
  type TreeDrawingId,
  type TreeSpeciesId,
} from './forest'
import { sprayCellUv, sprayKind } from './treeSprays'

/** Small generated branch clusters, shared by all nearby stems of a species.
 * No model downloads. Unit height; crown width is scaled per instance. */
export function roadsideTreeMesh(species: TreeSpeciesId): ForestMesh {
  const p: number[] = [],
    n: number[] = [],
    bark: number[] = [],
    indices: number[] = []
  const triangle = (a: number[], b: number[], c: number[], woody: number) => {
    const u = b.map((v, i) => v - a[i]),
      v = c.map((v, i) => v - a[i])
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const length = Math.hypot(...normal) || 1
    for (const vertex of [a, b, c]) {
      indices.push(p.length / 3)
      p.push(...vertex)
      n.push(...normal.map((x) => x / length))
      bark.push(woody)
    }
  }
  const stem = (a: number[], b: number[], radius: number) => {
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5,
        next = ((i + 1) * Math.PI * 2) / 5
      const pa = [a[0] + Math.cos(angle) * radius, a[1] + Math.sin(angle) * radius, a[2]]
      const pb = [a[0] + Math.cos(next) * radius, a[1] + Math.sin(next) * radius, a[2]]
      const pc = [b[0] + Math.cos(angle) * radius * 0.45, b[1] + Math.sin(angle) * radius * 0.45, b[2]]
      const pd = [b[0] + Math.cos(next) * radius * 0.45, b[1] + Math.sin(next) * radius * 0.45, b[2]]
      triangle(pa, pb, pc, 1)
      triangle(pc, pb, pd, 1)
    }
  }
  const tuft = (x: number, y: number, z: number, r: number, h: number, phase: number) => {
    const sides = 5
    for (let i = 0; i < sides; i++) {
      const a = phase + (i * Math.PI * 2) / sides,
        b = phase + ((i + 1) * Math.PI * 2) / sides
      const pa = [x + Math.cos(a) * r, y + Math.sin(a) * r, z]
      const pb = [x + Math.cos(b) * r, y + Math.sin(b) * r, z]
      triangle(pa, pb, [x * 0.9, y * 0.9, z + h], 0)
      triangle(pb, pa, [x, y, z - h * 0.3], 0)
    }
  }
  const broadleaf = isBroadleaf(species)
  stem([0, 0, 0], [0, 0, 1], broadleaf ? 0.035 : 0.045)
  // Live crown starts where `impostor.ts` starts it, so near and far agree.
  const bottom =
    species === 'pine' ? 0.5 : broadleaf ? 0.48 : species === 'fir' ? 0.25 : species === 'douglasFir' ? 0.36 : 0.3
  for (let whorl = 0; whorl < 7; whorl++) {
    const t = whorl / 7,
      z = bottom + (1 - bottom) * t
    const spread = broadleaf ? 0.44 * Math.sin((0.15 + t * 0.8) * Math.PI) : 0.5 * (1 - t) ** 0.85
    for (let j = 0; j < 5; j++) {
      const angle = (j * Math.PI * 2) / 5 + whorl * 2.399
      const x = Math.cos(angle) * spread * 0.65,
        y = Math.sin(angle) * spread * 0.65
      stem([0, 0, z + 0.04], [x, y, z], 0.009)
      tuft(x, y, z, spread * 0.45, (1 - bottom) * 0.2, angle)
    }
  }
  tuft(0, 0, 0.93, 0.065, 0.07, 0)
  return {
    attributes: {
      positions: { size: 3, value: new Float32Array(p) },
      normals: { size: 3, value: new Float32Array(n) },
      bark: { size: 1, value: new Float32Array(bark) },
    },
    indices: { size: 1, value: new Uint16Array(indices) },
  }
}

/**
 * How a species is built when it is drawn in detail. Generator parameters
 * chosen to read correctly from a road, not mensuration — the same spirit as
 * `TREE_DRAWINGS` in `impostor.ts`, which the far cards are drawn from,
 * and with the same crown base so near and far agree.
 *
 * The approach follows the published procedural-tree literature the trial
 * (`docs/forestry-visual-tools-trial-2026-11-12.md`) surveyed: whorls of
 * branches round a single leader for conifers, with uneven annual extension
 * and some branches missing (BakedVoxelLighting's pine whorls), lower limbs
 * drooping more than upper ones (VistaWASM's spruce), and broadleaves as a
 * rounded crown of leaf masses on a few main limbs. Our own geometry: no
 * downloaded models or textures.
 */
type DetailedSpecies = {
  crownBase: number
  /** Whorls up the live crown. */
  whorls: number
  /** Branches per whorl, low and high. */
  branches: [number, number]
  /** Downward sag of a branch tip, as a share of its length, at the bottom of the crown and at the top. */
  droop: [number, number]
  /** Crown radius profile: 0 a straight cone, 1 rounded toward the top (pine, Douglas-fir). */
  roundTop: number
  /** Share of branches that died back or never grew, so a crown has gaps. */
  gaps: number
  /** Foliage sprays along each branch. */
  sprays: number
  /** Extra radius just under the top, as a share of the crown's: a black spruce's club. */
  club?: number
  /** How far the leader leans over at the top, in mesh units: a hemlock's nods. */
  nod?: number
}

const DETAILED_SPECIES: Record<ConiferSpeciesId, DetailedSpecies> = {
  pine: { crownBase: 0.5, whorls: 11, branches: [3, 5], droop: [0.05, -0.15], roundTop: 0.85, gaps: 0.22, sprays: 3 },
  spruce: { crownBase: 0.3, whorls: 26, branches: [4, 6], droop: [0.3, 0.08], roundTop: 0.1, gaps: 0.05, sprays: 3 },
  fir: { crownBase: 0.25, whorls: 28, branches: [4, 6], droop: [0.25, 0.05], roundTop: 0, gaps: 0.05, sprays: 3 },
  douglasFir: {
    crownBase: 0.36,
    whorls: 15,
    branches: [3, 5],
    droop: [0.18, -0.05],
    roundTop: 0.3,
    gaps: 0.28,
    sprays: 3,
  },
  // Fine sprays that hang at the tips, under a leader that nods over.
  hemlock: {
    crownBase: 0.28,
    whorls: 24,
    branches: [4, 6],
    droop: [0.42, 0.18],
    roundTop: 0.15,
    gaps: 0.08,
    sprays: 3,
    nod: 0.05,
  },
  // A thin column of short limbs, sparse below and dense in a club at the top.
  blackSpruce: {
    crownBase: 0.3,
    whorls: 30,
    branches: [3, 5],
    droop: [0.3, 0.1],
    roundTop: 0,
    gaps: 0.16,
    sprays: 3,
    club: 0.55,
  },
}

/** A young conifer: the same tree before its canopy closed, branched to the ground on fewer whorls. */
function youngConifer(spec: DetailedSpecies): DetailedSpecies {
  return {
    ...spec,
    crownBase: 0.05,
    whorls: Math.max(8, Math.round(spec.whorls * 0.55)),
    droop: [spec.droop[0] * 0.5, spec.droop[1] * 0.5],
    gaps: spec.gaps * 0.5,
    roundTop: spec.roundTop * 0.5,
    club: undefined,
  }
}

/** How a broadleaf or the shrub is built: a stem, a few limbs and leaf masses inside an ellipsoid. */
type DetailedBroadleaf = {
  crownBase: number
  masses: number
  /** Stem radius at the ground and at the top. */
  stem: [number, number]
  /** Main limbs: the fewest, and their radius where they leave the stem. */
  limbs: number
  limbRadius: number
  /** Thin stems fanning from the ground in place of one stem: the shrub. */
  stems?: number
}

const DETAILED_BROADLEAF: Record<'aspen' | 'birch' | 'cottonwood' | 'shrub', DetailedBroadleaf> = {
  aspen: { crownBase: 0.44, masses: 170, stem: [0.03, 0.008], limbs: 4, limbRadius: 0.012 },
  birch: { crownBase: 0.48, masses: 150, stem: [0.03, 0.008], limbs: 4, limbRadius: 0.012 },
  // A heavy furrowed bole and big rising limbs under an open crown.
  cottonwood: { crownBase: 0.42, masses: 180, stem: [0.05, 0.012], limbs: 5, limbRadius: 0.022 },
  // Alder and willow: several stems from one root, leaves from near the ground.
  shrub: { crownBase: 0.1, masses: 150, stem: [0.012, 0.005], limbs: 0, limbRadius: 0, stems: 5 },
}

/** Widest crown radius in mesh units: matches `roadsideTreeMesh`, so a per-stem crown width means the same. */
const DETAILED_CROWN_RADIUS = 0.56

/**
 * A drawing's spray size against the first six species', which were tuned by their generator
 * parameters and stay at 1. The later drawings are sized here so each one's solid mesh covers,
 * side-on, what its far card does (`screenCoverage.test.ts` holds them within 15%).
 */
export const SOLID_SPRAY_SIZE: Record<TreeDrawingId, number> = {
  pine: 1,
  spruce: 1,
  fir: 1,
  douglasFir: 1,
  aspen: 1,
  birch: 1,
  hemlock: 1.357,
  blackSpruce: 1.458,
  cottonwood: 1.342,
  pineYoung: 1.666,
  spruceYoung: 1.588,
  firYoung: 1.326,
  douglasFirYoung: 1.383,
  hemlockYoung: 1.611,
  blackSpruceYoung: 1.54,
  shrub: 1.322,
}

/**
 * How much larger a bough card is than the solid spray it replaces, by drawing. A card is cut out
 * by its picture, so it covers less than a solid of the same size; these put the side-on cover of
 * a tree built of cards, averaged over the views its baked card is taken from, at its far card's
 * (`screenCoverage.test.ts` holds them within 3%). Solved by bisection on 15 November 2026; solve
 * them again after changing a mesh, a silhouette or a spray picture.
 */
export const BOUGH_CARD_SCALE: Record<TreeDrawingId, number> = {
  pine: 1.279,
  spruce: 1.431,
  fir: 1.223,
  douglasFir: 1.35,
  aspen: 1.257,
  birch: 1.171,
  hemlock: 1.118,
  blackSpruce: 1.006,
  cottonwood: 0.895,
  pineYoung: 1.463,
  spruceYoung: 1.144,
  firYoung: 1.177,
  douglasFirYoung: 1.418,
  hemlockYoung: 1.195,
  blackSpruceYoung: 1.181,
  shrub: 1.165,
}

/**
 * How much of a limb inside the crown is drawn as bark in the cards build, the rest as its
 * foliage's colour: wood in the crown's own shade, where full bark colour drew every whorl as a
 * bright herringbone through the boughs. The solid build keeps 1, which is what the scene package
 * has always sent.
 */
export const LIMB_BARK = 0.6

/** Foliage as the solids the mesh was first built of, or as cut-out bough cards (`treeSprays.ts`). */
export type FoliageBuild = 'solid' | 'cards'

/**
 * A tree in detail, for the few hundred stems nearest the eye while the view
 * is still. Unit height, crown about `CONE_BASE_DIAMETER` across, the same
 * frame as `roadsideTreeMesh` so the layer scales it the same way. A conifer
 * runs to about 2,500–4,500 triangles, a broadleaf about 1,400.
 *
 * `foliage: 'cards'` builds the same tree, branch for branch, with each spray
 * as two crossed cards carrying texture coordinates into the spray sheet
 * instead of an eight-faced solid: what the road view draws and the baked
 * cards are taken from. `'solid'` is what the scene package hands the other
 * renderers, which have no spray sheet.
 */
export function detailedTreeMesh(drawing: TreeDrawingId, seed = 1, foliage: FoliageBuild = 'solid'): ForestMesh {
  const species = drawingSpecies(drawing)
  const positions: number[] = []
  const normals: number[] = []
  const bark: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let state = (seed * 2654435761) >>> 0 || 1
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** A vertex with its own normal; returns its index. Texture coordinates below 0 mean none. */
  const vertex = (p: number[], normal: number[], woody: number, u = -1, v = -1) => {
    positions.push(p[0], p[1], p[2])
    const length = Math.hypot(normal[0], normal[1], normal[2]) || 1
    normals.push(normal[0] / length, normal[1] / length, normal[2] / length)
    bark.push(woody)
    uvs.push(u, v)
    return positions.length / 3 - 1
  }

  /** A tapered tube from a to b, `sides` round: stems and limbs (`woody` 1 a stem, less a limb in the crown). */
  const tube = (a: number[], b: number[], radiusA: number, radiusB: number, sides: number, woody = 1) => {
    const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const length = Math.hypot(axis[0], axis[1], axis[2]) || 1
    const w = axis.map((value) => value / length)
    // Any vector not parallel to the axis gives the ring's frame.
    const helper = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    const u = [
      w[1] * helper[2] - w[2] * helper[1],
      w[2] * helper[0] - w[0] * helper[2],
      w[0] * helper[1] - w[1] * helper[0],
    ]
    const uLength = Math.hypot(u[0], u[1], u[2]) || 1
    u.forEach((_, i) => (u[i] /= uLength))
    const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]]
    const start = positions.length / 3
    for (let i = 0; i < sides; i += 1) {
      const angle = (i / sides) * Math.PI * 2
      const radial = [0, 1, 2].map((k) => Math.cos(angle) * u[k] + Math.sin(angle) * v[k])
      vertex(
        [0, 1, 2].map((k) => a[k] + radial[k] * radiusA),
        radial,
        woody,
      )
      vertex(
        [0, 1, 2].map((k) => b[k] + radial[k] * radiusB),
        radial,
        woody,
      )
    }
    for (let i = 0; i < sides; i += 1) {
      const a0 = start + i * 2
      const b0 = start + ((i + 1) % sides) * 2
      indices.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1)
    }
  }

  const [cellU0, cellV0, cellU1, cellV1] = sprayCellUv(sprayKind(drawing))
  const cardScale = BOUGH_CARD_SCALE[drawing]

  /**
   * A spray of foliage round `centre`, long along `direction`. Its normals
   * lean outward from the crown's axis as well as from the spray, which is
   * what makes a crown of sprays shade as one volume rather than as a heap of
   * facets. Solid: a squashed, pointed ellipsoid of eight faces. Cards: two
   * crossed quads through the same axis, one lying in the bough's own plane
   * and one standing on it, so the bough shows from the side and from above.
   */
  const spray = (centre: number[], direction: number[], length: number, width: number, crownCentre: number[]) => {
    const dl = Math.hypot(direction[0], direction[1], direction[2]) || 1
    const d = direction.map((value) => value / dl)
    const side = Math.abs(d[2]) < 0.95 ? [-d[1], d[0], 0] : [1, 0, 0]
    const sl = Math.hypot(side[0], side[1], side[2]) || 1
    const s = side.map((value) => value / sl)
    const up = [d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0]]
    const outward = (p: number[]) => {
      const radial = [p[0] - crownCentre[0], p[1] - crownCentre[1], (p[2] - crownCentre[2]) * 0.6]
      const rl = Math.hypot(radial[0], radial[1], radial[2]) || 1
      const local = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]
      const ll = Math.hypot(local[0], local[1], local[2]) || 1
      return [0, 1, 2].map((k) => (radial[k] / rl) * 1.4 + local[k] / ll)
    }
    if (foliage === 'cards') {
      const reach = length * cardScale
      const half = width * cardScale
      const back = centre.map((c, k) => c - d[k] * reach * 0.6)
      const tip = centre.map((c, k) => c + d[k] * reach)
      // The standing card sits a little low, as the solid did: a bough hangs under its twig.
      for (const [across, lift] of [
        [s, 0],
        [up, 0.05],
      ] as Array<[number[], number]>) {
        const span = across === s ? half : half * 0.62
        const corners = [
          back.map((c, k) => c - across[k] * span * (1 + lift)),
          back.map((c, k) => c + across[k] * span * (1 - lift)),
          tip.map((c, k) => c + across[k] * span * (1 - lift)),
          tip.map((c, k) => c - across[k] * span * (1 + lift)),
        ]
        const texture: Array<[number, number]> = [
          [cellU0, cellV0],
          [cellU0, cellV1],
          [cellU1, cellV1],
          [cellU1, cellV0],
        ]
        const first = corners.map((corner, i) => vertex(corner, outward(corner), 0, texture[i][0], texture[i][1]))
        indices.push(first[0], first[1], first[2], first[0], first[2], first[3])
      }
      return
    }
    const points = [
      centre.map((c, k) => c + d[k] * length),
      centre.map((c, k) => c - d[k] * length * 0.6),
      centre.map((c, k) => c + s[k] * width),
      centre.map((c, k) => c - s[k] * width),
      centre.map((c, k) => c + up[k] * width * 0.55),
      centre.map((c, k) => c - up[k] * width * 0.45),
    ]
    const faces = [
      [0, 2, 4],
      [0, 4, 3],
      [0, 3, 5],
      [0, 5, 2],
      [1, 4, 2],
      [1, 3, 4],
      [1, 5, 3],
      [1, 2, 5],
    ]
    for (const face of faces) {
      for (const corner of face) indices.push(vertex(points[corner], outward(points[corner]), 0))
    }
  }

  if (isBroadleaf(species)) {
    // A pale stem to the crown, then a few main limbs, then the crown as
    // overlapping leaf masses inside an ellipsoid.
    const spec = DETAILED_BROADLEAF[drawing === 'shrub' ? 'shrub' : (species as 'aspen' | 'birch' | 'cottonwood')]
    const crownBase = spec.crownBase
    const size = SOLID_SPRAY_SIZE[drawing]
    if (spec.stems) {
      for (let i = 0; i < spec.stems; i += 1) {
        const angle = (i / spec.stems) * Math.PI * 2 + random() * 0.8
        const reach = 0.16 + random() * 0.14
        tube(
          [0, 0, 0],
          [Math.cos(angle) * reach, Math.sin(angle) * reach, 0.5 + random() * 0.2],
          spec.stem[0],
          spec.stem[1],
          4,
        )
      }
    } else {
      tube([0, 0, 0], [0, 0, 0.9], spec.stem[0], spec.stem[1], 7)
      const limbs = spec.limbs + Math.floor(random() * 2)
      for (let i = 0; i < limbs; i += 1) {
        const angle = (i / limbs) * Math.PI * 2 + random() * 0.6
        const from = crownBase + random() * 0.15
        const reach = 0.25 + random() * 0.15
        tube(
          [0, 0, from],
          [Math.cos(angle) * reach, Math.sin(angle) * reach, from + 0.18 + random() * 0.12],
          spec.limbRadius,
          spec.limbRadius / 3,
          4,
        )
      }
    }
    const centre = [0, 0, crownBase + (1 - crownBase) * 0.55]
    const radiusZ = (1 - crownBase) * 0.5
    for (let i = 0; i < spec.masses; i += 1) {
      // Uniform in the ellipsoid's volume, then pushed toward its surface,
      // where the leaves of a real crown are.
      const theta = random() * Math.PI * 2
      const cosPhi = random() * 2 - 1
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi)
      const r = 0.55 + 0.45 * Math.cbrt(random())
      const p = [
        centre[0] + Math.cos(theta) * sinPhi * r * DETAILED_CROWN_RADIUS * 0.82,
        centre[1] + Math.sin(theta) * sinPhi * r * DETAILED_CROWN_RADIUS * 0.82,
        centre[2] + cosPhi * r * radiusZ,
      ]
      const direction = [Math.cos(theta + 1.3), Math.sin(theta + 1.3), 0.4 * (random() - 0.5)]
      spray(p, direction, (0.08 + random() * 0.05) * size, (0.06 + random() * 0.04) * size, centre)
    }
  } else {
    const mature = DETAILED_SPECIES[species as ConiferSpeciesId]
    const spec = drawing === species ? mature : youngConifer(mature)
    const limbBark = foliage === 'cards' ? LIMB_BARK : 1
    const size = SOLID_SPRAY_SIZE[drawing]
    // The leader, bark all the way up; a conifer keeps one stem to the top.
    tube([0, 0, 0], [0, 0, 1], 0.042, 0.006, 8)
    const crownCentre = [0, 0, spec.crownBase + (1 - spec.crownBase) * 0.35]
    let height = spec.crownBase
    const step = (0.97 - spec.crownBase) / spec.whorls
    for (let whorl = 0; whorl < spec.whorls; whorl += 1) {
      // Uneven annual extension: some years grew more than others.
      height += step * (0.7 + random() * 0.6)
      if (height > 0.97) break
      const t = (height - spec.crownBase) / (1 - spec.crownBase)
      // A cone, or a cone with its top rounded off (pine, Douglas-fir).
      const cone = Math.pow(1 - t, 0.95)
      const rounded = Math.sin(Math.min(1, (1 - t) * 1.6) * Math.PI * 0.5) * (0.65 + 0.35 * (1 - t))
      const club = spec.club ? spec.club * Math.exp(-(((t - 0.86) / 0.08) ** 2)) : 0
      const profile = cone * (1 - spec.roundTop) + rounded * spec.roundTop + club
      const radius = DETAILED_CROWN_RADIUS * Math.max(0.05, profile)
      const count = spec.branches[0] + Math.floor(random() * (spec.branches[1] - spec.branches[0] + 1))
      const phase = random() * Math.PI * 2
      const droop = spec.droop[0] + (spec.droop[1] - spec.droop[0]) * t
      for (let b = 0; b < count; b += 1) {
        if (random() < spec.gaps * (1 - t * 0.6)) continue
        const angle = phase + (b / count) * Math.PI * 2 + (random() - 0.5) * 0.5
        const length = radius * (0.72 + random() * 0.3)
        // A drooping lower limb still hangs within reach of the crown base.
        const tipHeight = Math.max(Math.max(0.01, spec.crownBase - 0.06), height - droop * length + length * 0.08)
        const tip = [Math.cos(angle) * length, Math.sin(angle) * length, tipHeight]
        const base = [0, 0, height]
        tube(base, tip, 0.01 * (0.4 + profile), 0.003, 3, limbBark)
        // Sprays from about a third of the way out: the inner crown of a
        // conifer is bare, shaded-out wood.
        for (let k = 0; k < spec.sprays; k += 1) {
          const along = 0.38 + (k + random() * 0.6) * (0.62 / spec.sprays)
          const at = [0, 1, 2].map((i) => base[i] + (tip[i] - base[i]) * along)
          const direction = [tip[0] - base[0], tip[1] - base[1], tip[2] - base[2] - 0.02]
          spray(at, direction, length * 0.24 * size, Math.max(0.025, length * 0.16) * size, crownCentre)
        }
      }
    }
    // A leader tuft, so the top is a point and not the last whorl; a hemlock's leans over.
    const nod = spec.nod ?? 0
    spray([nod * 0.5, 0, 0.975], [nod * 20, 0, 1], 0.03, 0.022, crownCentre)
  }

  // Exactly unit height: the layer scales a stem by its recorded height, so a
  // leader tuft or a top spray poking past 1 drew the tree that much taller
  // (up to 6% for some seeds) than the inventory says it is.
  let top = 0
  for (let i = 2; i < positions.length; i += 3) top = Math.max(top, positions[i])
  if (top > 0) for (let i = 2; i < positions.length; i += 3) positions[i] /= top

  return {
    attributes: {
      positions: { size: 3, value: new Float32Array(positions) },
      normals: { size: 3, value: new Float32Array(normals) },
      bark: { size: 1, value: new Float32Array(bark) },
      ...(foliage === 'cards' ? { uvs: { size: 2 as const, value: new Float32Array(uvs) } } : {}),
    },
    indices: { size: 1, value: new Uint16Array(indices) },
  }
}
