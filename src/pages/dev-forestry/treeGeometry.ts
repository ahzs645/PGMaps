import { isBroadleaf, type ForestMesh, type TreeSpeciesId } from './forest'

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
 * `TREE_SPECIES_DRAWING` in `impostor.ts`, which the far cards are drawn from,
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
}

const DETAILED_SPECIES: Record<Exclude<TreeSpeciesId, 'aspen' | 'birch'>, DetailedSpecies> = {
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
}

/** Widest crown radius in mesh units: matches `roadsideTreeMesh`, so a per-stem crown width means the same. */
const DETAILED_CROWN_RADIUS = 0.56

/**
 * A tree in detail, for the few hundred stems nearest the eye while the view
 * is still. Unit height, crown about `CONE_BASE_DIAMETER` across, the same
 * frame as `roadsideTreeMesh` so the layer scales it the same way. A conifer
 * runs to about 2,500–4,500 triangles, a broadleaf about 1,400.
 */
export function detailedTreeMesh(species: TreeSpeciesId, seed = 1): ForestMesh {
  const positions: number[] = []
  const normals: number[] = []
  const bark: number[] = []
  const indices: number[] = []
  let state = (seed * 2654435761) >>> 0 || 1
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** A vertex with its own normal; returns its index. */
  const vertex = (p: number[], normal: number[], woody: number) => {
    positions.push(p[0], p[1], p[2])
    const length = Math.hypot(normal[0], normal[1], normal[2]) || 1
    normals.push(normal[0] / length, normal[1] / length, normal[2] / length)
    bark.push(woody)
    return positions.length / 3 - 1
  }

  /** A tapered tube from a to b, `sides` round: stems and limbs. */
  const tube = (a: number[], b: number[], radiusA: number, radiusB: number, sides: number) => {
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
        1,
      )
      vertex(
        [0, 1, 2].map((k) => b[k] + radial[k] * radiusB),
        radial,
        1,
      )
    }
    for (let i = 0; i < sides; i += 1) {
      const a0 = start + i * 2
      const b0 = start + ((i + 1) % sides) * 2
      indices.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1)
    }
  }

  /**
   * A spray of foliage: a squashed, pointed ellipsoid of eight faces round
   * `centre`, long along `direction`. Its normals lean outward from the
   * crown's axis as well as from the spray, which is what makes a crown of
   * sprays shade as one volume rather than as a heap of facets.
   */
  const spray = (centre: number[], direction: number[], length: number, width: number, crownCentre: number[]) => {
    const dl = Math.hypot(direction[0], direction[1], direction[2]) || 1
    const d = direction.map((value) => value / dl)
    const side = Math.abs(d[2]) < 0.95 ? [-d[1], d[0], 0] : [1, 0, 0]
    const sl = Math.hypot(side[0], side[1], side[2]) || 1
    const s = side.map((value) => value / sl)
    const up = [d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0]]
    const points = [
      centre.map((c, k) => c + d[k] * length),
      centre.map((c, k) => c - d[k] * length * 0.6),
      centre.map((c, k) => c + s[k] * width),
      centre.map((c, k) => c - s[k] * width),
      centre.map((c, k) => c + up[k] * width * 0.55),
      centre.map((c, k) => c - up[k] * width * 0.45),
    ]
    const outward = (p: number[]) => {
      const radial = [p[0] - crownCentre[0], p[1] - crownCentre[1], (p[2] - crownCentre[2]) * 0.6]
      const rl = Math.hypot(radial[0], radial[1], radial[2]) || 1
      const local = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]
      const ll = Math.hypot(local[0], local[1], local[2]) || 1
      return [0, 1, 2].map((k) => (radial[k] / rl) * 1.4 + local[k] / ll)
    }
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
    const crownBase = species === 'birch' ? 0.48 : 0.44
    tube([0, 0, 0], [0, 0, 0.9], 0.03, 0.008, 7)
    const limbs = 4 + Math.floor(random() * 2)
    for (let i = 0; i < limbs; i += 1) {
      const angle = (i / limbs) * Math.PI * 2 + random() * 0.6
      const from = crownBase + random() * 0.15
      const reach = 0.25 + random() * 0.15
      tube(
        [0, 0, from],
        [Math.cos(angle) * reach, Math.sin(angle) * reach, from + 0.18 + random() * 0.12],
        0.012,
        0.004,
        4,
      )
    }
    const centre = [0, 0, crownBase + (1 - crownBase) * 0.55]
    const radiusZ = (1 - crownBase) * 0.5
    const masses = species === 'birch' ? 150 : 170
    for (let i = 0; i < masses; i += 1) {
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
      spray(p, direction, 0.08 + random() * 0.05, 0.06 + random() * 0.04, centre)
    }
  } else {
    const spec = DETAILED_SPECIES[species as keyof typeof DETAILED_SPECIES]
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
      const profile = cone * (1 - spec.roundTop) + rounded * spec.roundTop
      const radius = DETAILED_CROWN_RADIUS * Math.max(0.05, profile)
      const count = spec.branches[0] + Math.floor(random() * (spec.branches[1] - spec.branches[0] + 1))
      const phase = random() * Math.PI * 2
      const droop = spec.droop[0] + (spec.droop[1] - spec.droop[0]) * t
      for (let b = 0; b < count; b += 1) {
        if (random() < spec.gaps * (1 - t * 0.6)) continue
        const angle = phase + (b / count) * Math.PI * 2 + (random() - 0.5) * 0.5
        const length = radius * (0.72 + random() * 0.3)
        // A drooping lower limb still hangs within reach of the crown base.
        const tipHeight = Math.max(spec.crownBase - 0.06, height - droop * length + length * 0.08)
        const tip = [Math.cos(angle) * length, Math.sin(angle) * length, tipHeight]
        const base = [0, 0, height]
        tube(base, tip, 0.01 * (0.4 + profile), 0.003, 3)
        // Sprays from about a third of the way out: the inner crown of a
        // conifer is bare, shaded-out wood.
        for (let k = 0; k < spec.sprays; k += 1) {
          const along = 0.38 + (k + random() * 0.6) * (0.62 / spec.sprays)
          const at = [0, 1, 2].map((i) => base[i] + (tip[i] - base[i]) * along)
          const direction = [tip[0] - base[0], tip[1] - base[1], tip[2] - base[2] - 0.02]
          spray(at, direction, length * 0.24, Math.max(0.025, length * 0.16), crownCentre)
        }
      }
    }
    // A leader tuft, so the top is a point and not the last whorl.
    spray([0, 0, 0.975], [0, 0, 1], 0.03, 0.022, crownCentre)
  }

  return {
    attributes: {
      positions: { size: 3, value: new Float32Array(positions) },
      normals: { size: 3, value: new Float32Array(normals) },
      bark: { size: 1, value: new Float32Array(bark) },
    },
    indices: { size: 1, value: new Uint16Array(indices) },
  }
}
