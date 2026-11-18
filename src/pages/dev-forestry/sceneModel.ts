/**
 * The road view's scene package (`scenePackage.ts`) as a 3D model (`.glb`, `.obj`, `.stl`) to look
 * at in Blender, SketchUp or a viewer. Display only: a picture of the package, never an analysis
 * input or result, and its trees are simple stand-ins, not the road view's drawings.
 *
 * - **Ground**: the package's `terrain` grid (not `farTerrain` or `skylineTerrain`), smooth-shaded
 *   from the grid's own slopes. A cell with an unknown post is left open. Cells whose centre lies in
 *   one of the package's `openings` are their own part (cut ground); where the package has `cover`,
 *   cells with three or four water posts are another (water, at the ground's heights).
 * - **Trees**: one low-polygon solid per stem in `trees`, built here from the stem's own height,
 *   crown width and crown base (the appended `crownBase` field, else its drawing's, else its
 *   species'): a two-tier cone for a mature conifer, one cone for a young one (crown to the ground),
 *   a rounded crown for a broadleaf or a tall shrub, each on a thin trunk as wide as the stem's DBH
 *   where the package gives one. Species and form (`treeDrawing`) choose only the colour
 *   (`drawingPalette`) and the shape's kind. No tree model or texture is shipped or read: the
 *   package's own `models` are not used.
 * - **Treated stems** (`treated`, a stand prescription's): stumps and snags standing, felled trees
 *   and logs lying along their heading, each a cylinder of its own length and diameter.
 *
 * Trees are grouped into one part per drawing (crowns) and one per drawing's stems: a part per stem
 * would be tens of thousands of objects, which modelling tools handle badly.
 *
 * `SCENE_MODEL_TRIANGLE_BUDGET` bounds the model. The ground takes at most half of it (every second
 * post, then every third, …, when it would take more); the trees then step down through
 * `SCENE_MODEL_CROWN_SIDES`, and if the fewest sides still do not fit, the farthest stems from the
 * eye are left out first. The notes say which of these happened.
 *
 * Local metres: the package's own x east and y north from the ground under the eye, z above that
 * ground's elevation. No DOM or network access.
 */
import { hexColor, type MeshPart, type Model3d, type ModelFormat, type Rgb } from '@/lib/model3d/model'
import { writeModel, type ModelExport } from '@/lib/model3d/writeModel'
import { TREE_SPECIES_IDS, treeDrawing, type TreeDrawingId, type TreeSpeciesId } from './forest'
import { drawingPalette, TREE_DRAWINGS } from './impostor'
import { SCENE_TREATED_KINDS, type ScenePackage } from './scenePackage'
import { SCENE_COVER } from './sceneCover'

/** Triangles the whole model may hold: about 45 MB of `.glb`, which Blender and SketchUp still open readily. */
export const SCENE_MODEL_TRIANGLE_BUDGET = 1_000_000
/** Sides a crown is drawn with, most first: the budget steps down through them before leaving trees out. */
export const SCENE_MODEL_CROWN_SIDES = [8, 6, 4] as const
/** A stem's trunk radius where the package gives no DBH, as a share of its height (DBH ≈ 2.4 % of height). */
export const ASSUMED_TRUNK_RADIUS_SHARE = 0.012
/** The model's own colours, sRGB hex. Tree colours are the road view's drawings' (`drawingPalette`). */
export const SCENE_MODEL_COLOURS = {
  ground: '#7d8a5a',
  cut: '#a68a64',
  water: '#4f7a94',
  stump: '#b08a5a',
  felled: '#8a6f4e',
  log: '#8a6f4e',
  snag: '#8b8378',
  /** A tree whose species this build does not know. */
  foliage: '#3f6a40',
  bark: '#6b5843',
} as const

export interface SceneModelOptions {
  /** Default `SCENE_MODEL_TRIANGLE_BUDGET`. */
  triangleBudget?: number
  /** The model's name (default "Visual quality scene"). */
  name?: string
}

/** Trunk sides for a crown's: half as many, at least three. */
const trunkSides = (crownSides: number) => Math.max(3, Math.ceil(crownSides / 2))

/** A profile of a solid of revolution: (height above the base, radius), from the axis at the bottom round to the top. */
type Profile = [number, number][]

interface Builder {
  positions: number[]
  normals: number[]
  indices: number[]
}
const builder = (): Builder => ({ positions: [], normals: [], indices: [] })

/**
 * Appends a solid of revolution about `axis` from `base`. Each profile segment is its own band of
 * vertices with the segment's normal, smooth round the axis and flat along the profile, so a cone's
 * flank shades round while its base stays a sharp edge. Faces wind counter-clockwise from outside.
 * `e1`, `e2`, `axis` must be a right-handed orthonormal frame.
 */
function lathe(
  out: Builder,
  profile: Profile,
  sides: number,
  base: [number, number, number],
  axis: [number, number, number] = [0, 0, 1],
  e1: [number, number, number] = [1, 0, 0],
  e2: [number, number, number] = [0, 1, 0],
): void {
  const cos: number[] = [],
    sin: number[] = []
  for (let j = 0; j < sides; j++) {
    cos.push(Math.cos((2 * Math.PI * j) / sides))
    sin.push(Math.sin((2 * Math.PI * j) / sides))
  }
  const ring = (h: number, r: number, nr: number, nz: number) => {
    const start = out.positions.length / 3
    for (let j = 0; j < sides; j++) {
      for (let k = 0; k < 3; k++) {
        const radial = cos[j] * e1[k] + sin[j] * e2[k]
        out.positions.push(base[k] + axis[k] * h + radial * r)
        out.normals.push(radial * nr + axis[k] * nz)
      }
    }
    return start
  }
  for (let s = 0; s + 1 < profile.length; s++) {
    const [h0, r0] = profile[s],
      [h1, r1] = profile[s + 1]
    if (r0 <= 0 && r1 <= 0) continue
    // The outward normal in the profile's (radius, height) plane: the segment turned clockwise.
    const dr = r1 - r0,
      dh = h1 - h0
    const length = Math.hypot(dr, dh)
    if (!(length > 0)) continue
    const a = ring(h0, r0, dh / length, -dr / length),
      b = ring(h1, r1, dh / length, -dr / length)
    for (let j = 0; j < sides; j++) {
      const next = (j + 1) % sides
      // A ring of radius 0 is a point: one of the quad's triangles has no area there.
      if (r0 > 0) out.indices.push(a + j, a + next, b + next)
      if (r1 > 0) out.indices.push(a + j, b + next, b + j)
    }
  }
}

/** Triangles `lathe` makes of a profile. */
function latheTriangles(profile: Profile, sides: number): number {
  let count = 0
  for (let s = 0; s + 1 < profile.length; s++) {
    const r0 = profile[s][1],
      r1 = profile[s + 1][1]
    count += (r0 > 0 ? sides : 0) + (r1 > 0 ? sides : 0)
  }
  return count
}

type CrownShape = 'conifer' | 'young' | 'round'

/** A crown from `bottom` to `top` metres up the stem, `radius` across, as a profile. */
function crownProfile(shape: CrownShape, bottom: number, top: number, radius: number): Profile {
  const l = top - bottom
  if (shape === 'young')
    return [
      [bottom, 0],
      [bottom, radius],
      [top, 0],
    ]
  if (shape === 'conifer')
    // Two tiers: a broad lower cone, and above a ledge a narrower top.
    return [
      [bottom, 0],
      [bottom, radius],
      [bottom + 0.55 * l, 0.35 * radius],
      [bottom + 0.45 * l, 0.7 * radius],
      [top, 0],
    ]
  return [
    [bottom, 0],
    [bottom + 0.12 * l, 0.7 * radius],
    [bottom + 0.45 * l, radius],
    [bottom + 0.8 * l, 0.8 * radius],
    [top, 0],
  ]
}

const cylinder = (length: number, radius: number): Profile => [
  [0, 0],
  [0, radius],
  [length, radius],
  [length, 0],
]

interface Stem {
  /** Distance from the eye, metres: the farthest are left out first. */
  distance: number
  /** Part key: a drawing (crown and trunk parts) or a treated kind. */
  group: string
  build: (crowns: Builder, trunks: Builder, sides: number) => void
  triangles: (sides: number) => number
}

const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v)

/** The scene package as a model: ground, cut ground, water, trees and treated stems. */
export function sceneModel(scene: ScenePackage, options: SceneModelOptions = {}): Model3d {
  const budget = options.triangleBudget ?? SCENE_MODEL_TRIANGLE_BUDGET
  const z0 = scene.origin.elevationMeters
  const notes: string[] = [
    'Display only: a picture of the road view’s scene package, not an analysis input or result. Trees are simple solids sized from each stem’s height, crown width and crown base, not the road view’s drawings.',
  ]
  const parts: MeshPart[] = []

  // --- Ground ------------------------------------------------------------------------------------
  const t = scene.terrain
  const groundTriangles = (stride: number) =>
    2 * Math.floor((t.columns - 1) / stride) * Math.floor((t.rows - 1) / stride)
  let stride = 1
  while (groundTriangles(stride) > budget / 2 && stride < Math.max(t.columns, t.rows)) stride++
  const cols = Math.floor((t.columns - 1) / stride) + 1,
    rows = Math.floor((t.rows - 1) / stride) + 1
  const post = (c: number, r: number) => r * stride * t.columns + c * stride
  const height = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return NaN
    const h = t.heights[post(c, r)]
    return h == null ? NaN : h
  }
  const xAt = (c: number) => t.west + c * stride * t.spacing,
    yAt = (r: number) => t.south + r * stride * t.spacing
  const step = stride * t.spacing
  /** The grid's normal at a post, from its neighbours (one-sided at an edge or beside a gap). */
  const normalAt = (c: number, r: number): [number, number, number] => {
    const here = height(c, r)
    const slope = (lo: number, hi: number) =>
      finite(lo) && finite(hi)
        ? (hi - lo) / (2 * step)
        : finite(hi)
          ? (hi - here) / step
          : finite(lo)
            ? (here - lo) / step
            : 0
    const dx = slope(height(c - 1, r), height(c + 1, r)),
      dy = slope(height(c, r - 1), height(c, r + 1))
    const length = Math.hypot(dx, dy, 1)
    return [-dx / length, -dy / length, 1 / length]
  }
  // Openings: each ring set with its box, so most cells are ruled out without a ring walk.
  const openings = (scene.openings ?? []).map((o) => {
    let w = Infinity,
      s = Infinity,
      e = -Infinity,
      n = -Infinity
    for (const ring of o.rings)
      for (const [x, y] of ring) {
        w = Math.min(w, x)
        e = Math.max(e, x)
        s = Math.min(s, y)
        n = Math.max(n, y)
      }
    return { rings: o.rings, w, s, e, n }
  })
  const inOpening = (x: number, y: number) =>
    openings.some((o) => {
      if (x < o.w || x > o.e || y < o.s || y > o.n) return false
      // Even-odd over every ring, so holes (reserves left standing) are not cut ground.
      let inside = false
      for (const ring of o.rings)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i],
            [xj, yj] = ring[j]
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
        }
      return inside
    })
  const cover = t.cover
  const isWater = (c: number, r: number) => (cover?.[post(c, r)] === SCENE_COVER.water ? 1 : 0)
  const ground = { ground: builder(), cut: builder(), water: builder() }
  const vertexIds = {
    ground: new Map<number, number>(),
    cut: new Map<number, number>(),
    water: new Map<number, number>(),
  }
  let openCells = 0
  for (let r = 0; r + 1 < rows; r++)
    for (let c = 0; c + 1 < cols; c++) {
      const corners: [number, number][] = [
        [c, r],
        [c + 1, r],
        [c + 1, r + 1],
        [c, r + 1],
      ]
      if (!corners.every(([cc, rr]) => finite(height(cc, rr)))) {
        openCells++
        continue
      }
      const kind =
        cover && corners.reduce((sum, [cc, rr]) => sum + isWater(cc, rr), 0) >= 3
          ? 'water'
          : inOpening((xAt(c) + xAt(c + 1)) / 2, (yAt(r) + yAt(r + 1)) / 2)
            ? 'cut'
            : 'ground'
      const out = ground[kind],
        ids = vertexIds[kind]
      const [sw, se, ne, nw] = corners.map(([cc, rr]) => {
        const key = rr * cols + cc
        let id = ids.get(key)
        if (id === undefined) {
          id = out.positions.length / 3
          ids.set(key, id)
          out.positions.push(xAt(cc), yAt(rr), height(cc, rr) - z0)
          out.normals.push(...normalAt(cc, rr))
        }
        return id
      })
      // South-west, south-east, north-east: counter-clockwise from above, so the ground faces up.
      out.indices.push(sw, se, ne, sw, ne, nw)
    }
  const colour = (key: keyof typeof SCENE_MODEL_COLOURS): Rgb => hexColor(SCENE_MODEL_COLOURS[key])
  const groundLabels = { ground: 'Ground', cut: 'Cut ground (openings)', water: 'Water' } as const
  for (const kind of ['ground', 'cut', 'water'] as const) {
    const b = ground[kind]
    if (!b.indices.length) continue
    parts.push({
      name: groundLabels[kind],
      positions: Float32Array.from(b.positions),
      normals: Float32Array.from(b.normals),
      indices: Uint32Array.from(b.indices),
      color: colour(kind),
      doubleSided: true,
      attributes: { layer: kind, spacingM: step, triangles: b.indices.length / 3 },
    })
  }
  const groundCount = (ground.ground.indices.length + ground.cut.indices.length + ground.water.indices.length) / 3
  notes.push(
    `Ground: the package's terrain grid, ${t.columns} × ${t.rows} posts at ${t.spacing} m${
      stride > 1
        ? `, drawn at every ${stride === 2 ? 'second' : stride === 3 ? 'third' : `${stride}th`} post (${step} m) to keep within half the ${budget.toLocaleString('en-CA')}-triangle budget`
        : ''
    }; the far and skyline grids are not drawn.${openCells ? ` ${openCells} cells with an unknown post are left open.` : ''}`,
    'Cut ground is the cells whose centre lies in an opening.' +
      (cover
        ? ' Water is the cells with three or four water posts, at the ground’s heights.'
        : ' The package has no cover, so water is not told apart.'),
  )

  // --- Trees and treated stems ----------------------------------------------------------------------
  const fields = scene.trees.fields
  const field = (name: string) => fields.indexOf(name)
  const [fx, fy, fz, fSpecies, fHeight, fWidth] = ['x', 'y', 'z', 'species', 'height', 'crownWidth'].map(field)
  const fCrownBase = field('crownBase'),
    fDbh = field('dbhCm'),
    fForm = field('form'),
    fExpansion = field('expansion')
  const width = fields.length
  const data = scene.trees.data
  const known = new Set<string>(TREE_SPECIES_IDS)
  const stems: Stem[] = []
  const groupInfo = new Map<string, { label: string; foliage: Rgb; bark: Rgb }>()
  let unusable = 0,
    expanded = 0,
    assumedTrunk = 0
  for (let i = 0; i < scene.trees.count; i++) {
    const at = (f: number) => (f >= 0 ? data[i * width + f] : undefined)
    const x = at(fx),
      y = at(fy),
      z = at(fz),
      h = at(fHeight),
      w = at(fWidth)
    if (!finite(x) || !finite(y) || !finite(z) || !finite(h) || !finite(w) || h <= 0 || w <= 0) {
      unusable++
      continue
    }
    const speciesName = scene.trees.species[at(fSpecies) ?? -1] ?? 'unknown'
    const formCode = at(fForm)
    const drawing: TreeDrawingId | null = known.has(speciesName)
      ? treeDrawing(speciesName as TreeSpeciesId, formCode === 2 ? 'shrub' : formCode === 1 ? 'young' : null)
      : null
    const broadleaf = drawing
      ? Boolean(TREE_DRAWINGS[drawing].broadleaf)
      : Boolean(scene.species?.[speciesName]?.broadleaf)
    const shape: CrownShape = broadleaf ? 'round' : drawing?.endsWith('Young') ? 'young' : 'conifer'
    const ownBase = at(fCrownBase)
    const crownBase =
      finite(ownBase) && ownBase >= 0
        ? Math.min(0.95, ownBase)
        : drawing
          ? TREE_DRAWINGS[drawing].crownBase
          : (scene.species?.[speciesName]?.crownBase ?? 0.4)
    const dbh = at(fDbh)
    if ((at(fExpansion) ?? 1) > 1) expanded++
    const radius = w / 2
    // Never wider than half the crown: a DBH bigger than that is a record's error, not a shape to draw.
    const trunkRadius = Math.min(
      radius / 2,
      finite(dbh) && dbh > 0 ? dbh / 200 : Math.max(0.03, ASSUMED_TRUNK_RADIUS_SHARE * h),
    )
    if (!(finite(dbh) && dbh > 0)) assumedTrunk++
    const bottom = crownBase * h
    // The trunk runs a quarter of the way into the crown, so no gap shows between them.
    const trunkTop = bottom + 0.25 * (h - bottom)
    const group = drawing ?? `species:${speciesName}`
    if (!groupInfo.has(group)) {
      const palette = drawing ? drawingPalette(drawing) : null
      groupInfo.set(group, {
        label: drawing ? TREE_DRAWINGS[drawing].label : speciesName,
        foliage: palette?.foliage ?? colour('foliage'),
        bark: palette?.bark ?? colour('bark'),
      })
    }
    const base: [number, number, number] = [x, y, z - z0]
    const crown = crownProfile(shape, bottom, h, radius)
    const trunk = cylinder(trunkTop, trunkRadius)
    stems.push({
      distance: Math.hypot(x, y),
      group,
      build: (crowns, trunks, sides) => {
        lathe(crowns, crown, sides, base)
        lathe(trunks, trunk, trunkSides(sides), base)
      },
      triangles: (sides) => latheTriangles(crown, sides) + latheTriangles(trunk, trunkSides(sides)),
    })
  }
  const treated = scene.treated
  const treatedCounts = new Map<string, number>()
  if (treated) {
    const tf = treated.fields
    const [tx, ty, tz, tKind, tLength, tDiameter, tHeading] = [
      'x',
      'y',
      'z',
      'kind',
      'length',
      'diameter',
      'heading',
    ].map((name) => tf.indexOf(name as (typeof tf)[number]))
    for (let i = 0; i < treated.count; i++) {
      const at = (f: number) => (f >= 0 ? treated.data[i * tf.length + f] : undefined)
      const x = at(tx),
        y = at(ty),
        z = at(tz),
        length = at(tLength),
        diameter = at(tDiameter)
      const kind = treated.kinds[at(tKind) ?? -1] as (typeof SCENE_TREATED_KINDS)[number] | undefined
      if (!kind || !finite(x) || !finite(y) || !finite(z) || !finite(length) || !finite(diameter)) {
        unusable++
        continue
      }
      if (length <= 0 || diameter <= 0) {
        unusable++
        continue
      }
      treatedCounts.set(kind, (treatedCounts.get(kind) ?? 0) + 1)
      const lying = kind === 'felled' || kind === 'log'
      const heading = ((at(tHeading) ?? 0) * Math.PI) / 180
      const profile = cylinder(length, diameter / 2)
      // A lying stem points along its heading (clockwise from north) and rests on the ground.
      const axis: [number, number, number] = lying ? [Math.sin(heading), Math.cos(heading), 0] : [0, 0, 1]
      const e1: [number, number, number] = lying ? [0, 0, 1] : [1, 0, 0]
      const e2: [number, number, number] = lying ? [Math.cos(heading), -Math.sin(heading), 0] : [0, 1, 0]
      const base: [number, number, number] = [x, y, z - z0 + (lying ? diameter / 2 : 0)]
      stems.push({
        distance: Math.hypot(x, y),
        group: `treated:${kind}`,
        build: (_crowns, trunks, sides) => lathe(trunks, profile, trunkSides(sides), base, axis, e1, e2),
        triangles: (sides) => latheTriangles(profile, trunkSides(sides)),
      })
    }
  }

  // --- The budget ----------------------------------------------------------------------------------
  const room = Math.max(0, budget - groundCount)
  let sides: number = SCENE_MODEL_CROWN_SIDES[0]
  for (const option of SCENE_MODEL_CROWN_SIDES) {
    sides = option
    if (stems.reduce((sum, stem) => sum + stem.triangles(option), 0) <= room) break
  }
  const ordered = [...stems].sort((a, b) => a.distance - b.distance)
  const kept: Stem[] = []
  let used = 0
  for (const stem of ordered) {
    const cost = stem.triangles(sides)
    if (used + cost > room) break
    kept.push(stem)
    used += cost
  }
  const groups = new Map<string, { crowns: Builder; trunks: Builder; count: number }>()
  for (const stem of kept) {
    let g = groups.get(stem.group)
    if (!g) {
      g = { crowns: builder(), trunks: builder(), count: 0 }
      groups.set(stem.group, g)
    }
    stem.build(g.crowns, g.trunks, sides)
    g.count++
  }
  const treatedLabel: Record<string, string> = { stump: 'stumps', felled: 'felled trees', log: 'logs', snag: 'snags' }
  for (const [group, g] of groups) {
    const kind = group.startsWith('treated:') ? group.slice('treated:'.length) : null
    const info = groupInfo.get(group)
    const part = (name: string, b: Builder, color: Rgb, attributes: MeshPart['attributes']): MeshPart => ({
      name,
      positions: Float32Array.from(b.positions),
      normals: Float32Array.from(b.normals),
      indices: Uint32Array.from(b.indices),
      color,
      attributes,
    })
    if (kind)
      parts.push(
        part(`Treated: ${treatedLabel[kind] ?? kind}`, g.trunks, colour(kind as keyof typeof SCENE_MODEL_COLOURS), {
          layer: 'treated',
          kind,
          stems: g.count,
        }),
      )
    else if (info) {
      parts.push(
        part(`Trees: ${info.label}`, g.crowns, info.foliage, { layer: 'trees', drawing: group, stems: g.count }),
      )
      parts.push(
        part(`Trees: ${info.label}, stems`, g.trunks, info.bark, { layer: 'trunks', drawing: group, stems: g.count }),
      )
    }
  }

  const treeTotal = stems.filter((s) => !s.group.startsWith('treated:')).length
  const treedKept = kept.filter((s) => !s.group.startsWith('treated:')).length
  notes.push(
    `Trees: ${treedKept.toLocaleString('en-CA')} of the package's ${scene.trees.count.toLocaleString('en-CA')} stems, each crown drawn with ${sides} sides${
      sides < SCENE_MODEL_CROWN_SIDES[0]
        ? ` (fewer than ${SCENE_MODEL_CROWN_SIDES[0]} to keep within the ${budget.toLocaleString('en-CA')}-triangle budget)`
        : ''
    }; out to ${scene.treeRadiusMeters} m from the eye, as the package holds them.`,
  )
  if (kept.length < stems.length) {
    const farthestKept = kept.length ? kept[kept.length - 1].distance : 0
    notes.push(
      `${(stems.length - kept.length).toLocaleString('en-CA')} stems past ${Math.round(farthestKept)} m from the eye left out to stay within the ${budget.toLocaleString('en-CA')}-triangle budget, the farthest first (${(treeTotal - treedKept).toLocaleString('en-CA')} trees, ${(stems.length - kept.length - (treeTotal - treedKept)).toLocaleString('en-CA')} treated stems).`,
    )
  }
  if (assumedTrunk)
    notes.push(
      `Trunk widths are assumed (${ASSUMED_TRUNK_RADIUS_SHARE * 200} % of height across) where the package gives a stem no DBH (${assumedTrunk.toLocaleString('en-CA')} of its stems).`,
    )
  if (expanded)
    notes.push(
      `${expanded.toLocaleString('en-CA')} stems stand for more than one recorded stem (expansion); each is drawn once.`,
    )
  if (unusable) notes.push(`${unusable} records with no usable position or size left out.`)
  if (treatedCounts.size)
    notes.push(
      `Treated stems from the stand prescription: ${[...treatedCounts].map(([k, n]) => `${n} ${treatedLabel[k] ?? k}`).join(', ')}; felled trees are drawn as their stems, without crowns.`,
    )
  const leftOut = [
    scene.debris?.count ? `${scene.debris.count} slash piles` : null,
    scene.roadScars?.length ? `${scene.roadScars.length} road scars` : null,
    scene.water?.length ? 'water surfaces at their own levels' : null,
    'the canopy past the stems (`canopy`) and each stem’s tone',
  ].filter((v): v is string => v !== null)
  notes.push(`Not drawn: ${leftOut.join('; ')}.`)

  return {
    name: options.name ?? 'Visual quality scene',
    parts,
    origin: {
      kind: 'lonlat',
      longitude: scene.origin.lng,
      latitude: scene.origin.lat,
      elevation: z0,
    },
    notes,
    extras: {
      source: `${scene.format} v${scene.version}, ${scene.createdAt}`,
      camera: {
        ...scene.camera,
        position: [scene.camera.position[0], scene.camera.position[1], scene.camera.position[2] - z0],
        frame: 'source frame: x east, y north, z up, metres from the origin',
      },
    },
  }
}

/** One call from a scene package to the model's files in a format. */
export function sceneModelExport(
  scene: ScenePackage,
  format: ModelFormat,
  options: SceneModelOptions = {},
): ModelExport {
  const model = sceneModel(scene, options)
  return writeModel(model, format, 'forestry-visual-quality-scene')
}
