/**
 * What a stand of individual trees adds up to: the stand table a prescription reports before,
 * removed and retained (WinSVS's "Stand info", RxGaming's pre/target/post table), diameter and
 * height classes, species shares, and tree clumps by the ICO method.
 *
 * Every figure is per hectare of the block and counts each drawn stem as the recorded stems it
 * stands for (`StandTree.expansion`), except crown cover, which reads the crowns as drawn: that is
 * the canopy the road view shows. DOM-free.
 */

import { TREE_SPECIES_IDS, type TreeSpeciesId } from '../forest'
import type { StandTree } from './standTrees'

/** Basal area of one stem, m², from its diameter in cm. */
export const basalAreaM2 = (dbhCm: number) => (Math.PI / 4) * (dbhCm / 100) ** 2

/**
 * Reineke's stand density index, metric: stems/ha × (QMD / 25.4 cm)^1.605. WinSVS used the
 * English form on metric stands, which its review found reads metric SDI wrong; this is the
 * metric form throughout.
 */
export const REINEKE_EXPONENT = 1.605
export function standDensityIndex(stemsPerHa: number, quadMeanDiameterCm: number): number {
  if (!(stemsPerHa > 0) || !(quadMeanDiameterCm > 0)) return 0
  return stemsPerHa * (quadMeanDiameterCm / 25.4) ** REINEKE_EXPONENT
}

export type Spread = { mean: number; sd: number; min: number; max: number }

export type StandSummary = {
  /** Drawn stems counted. */
  drawnStems: number
  stemsPerHa: number
  basalAreaM2PerHa: number
  quadMeanDiameterCm: number
  standDensityIndex: number
  dbhCm: Spread
  heightMeters: Spread
  /** 100·(1 − e^(−crown area / block area)), crowns as drawn (Crookston and Stage's overlap form). */
  crownCoverPercent: number
}

const EMPTY_SPREAD: Spread = { mean: 0, sd: 0, min: 0, max: 0 }

function spread(values: number[], weights: number[]): Spread {
  if (values.length === 0) return EMPTY_SPREAD
  let weight = 0
  let sum = 0
  let min = Infinity
  let max = -Infinity
  values.forEach((value, i) => {
    weight += weights[i]
    sum += value * weights[i]
    if (value < min) min = value
    if (value > max) max = value
  })
  const mean = sum / weight
  let squares = 0
  values.forEach((value, i) => {
    squares += weights[i] * (value - mean) ** 2
  })
  return { mean, sd: weight > 1 ? Math.sqrt(squares / (weight - 1)) : 0, min, max }
}

export function summarizeStand(trees: ReadonlyArray<StandTree>, areaHa: number): StandSummary {
  const area = Math.max(1e-9, areaHa)
  let stems = 0
  let squares = 0
  let crownArea = 0
  for (const tree of trees) {
    stems += tree.expansion
    squares += tree.expansion * tree.dbhCm * tree.dbhCm
    crownArea += Math.PI * (tree.crownWidthMeters / 2) ** 2
  }
  const weights = trees.map((tree) => tree.expansion)
  const qmd = stems > 0 ? Math.sqrt(squares / stems) : 0
  return {
    drawnStems: trees.length,
    stemsPerHa: stems / area,
    basalAreaM2PerHa: ((Math.PI / 4) * (squares / 10_000)) / area,
    quadMeanDiameterCm: qmd,
    standDensityIndex: standDensityIndex(stems / area, qmd),
    dbhCm: spread(
      trees.map((tree) => tree.dbhCm),
      weights,
    ),
    heightMeters: spread(
      trees.map((tree) => tree.heightMeters),
      weights,
    ),
    crownCoverPercent: 100 * (1 - Math.exp(-crownArea / (area * 10_000))),
  }
}

export type ClassCounts = { from: number; to: number; counts: number[] }

/**
 * Stems per hectare in classes of a measure, one count per group (for a stacked chart: retained,
 * removed, …). Classes are `width` wide from 0, widened so there are at most `maxClasses`.
 */
export function classCounts(
  groups: ReadonlyArray<ReadonlyArray<StandTree>>,
  measure: (tree: StandTree) => number,
  width: number,
  areaHa: number,
  maxClasses = 24,
): ClassCounts[] {
  let top = 0
  for (const group of groups) for (const tree of group) top = Math.max(top, measure(tree))
  let step = width
  while (Math.ceil((top + 1e-9) / step) > maxClasses) step *= 2
  const classes = Math.max(1, Math.ceil((top + 1e-9) / step))
  const rows: ClassCounts[] = Array.from({ length: classes }, (_, i) => ({
    from: i * step,
    to: (i + 1) * step,
    counts: groups.map(() => 0),
  }))
  const area = Math.max(1e-9, areaHa)
  groups.forEach((group, g) => {
    for (const tree of group) {
      const index = Math.min(classes - 1, Math.floor(measure(tree) / step))
      rows[index].counts[g] += tree.expansion / area
    }
  })
  return rows
}

/** Stems per hectare of each drawn species, in `TREE_SPECIES_IDS` order, one row per group. */
export function speciesShares(
  groups: ReadonlyArray<ReadonlyArray<StandTree>>,
  areaHa: number,
): Array<{ species: TreeSpeciesId; perHa: number[] }> {
  const area = Math.max(1e-9, areaHa)
  return TREE_SPECIES_IDS.map((species) => ({
    species,
    perHa: groups.map(
      (group) => group.reduce((sum, tree) => (tree.species === species ? sum + tree.expansion : sum), 0) / area,
    ),
  })).filter((row) => row.perHa.some((value) => value > 0))
}

/**
 * ICO clump-size classes (Churchill et al. 2013): individuals, small (2–4), medium (5–9),
 * large (10–15) and very large (16+) clumps.
 */
export const ICO_CLASSES = [
  { id: 'single', label: 'Individuals', from: 1, to: 1 },
  { id: 'small', label: '2–4 trees', from: 2, to: 4 },
  { id: 'medium', label: '5–9 trees', from: 5, to: 9 },
  { id: 'large', label: '10–15 trees', from: 10, to: 15 },
  { id: 'veryLarge', label: '16+ trees', from: 16, to: Infinity },
] as const
export type IcoClassId = (typeof ICO_CLASSES)[number]['id']

export function icoClassIndex(size: number): number {
  for (let i = ICO_CLASSES.length - 1; i >= 0; i -= 1) if (size >= ICO_CLASSES[i].from) return i
  return 0
}

/**
 * Two trees stand in one clump when their stems are nearer than `distanceMeters` (6 m in the ICO
 * method and RxGaming: 3 m crown radii that touch), and membership carries on through each
 * (A with B, B with C: A, B and C are one clump).
 */
export const ICO_CLUMP_DISTANCE_METERS = 6

/** Union–find over tree indices, growing as trees are added. */
export class ClumpSets {
  private parent: Int32Array
  private size: Int32Array
  constructor(count: number) {
    this.parent = new Int32Array(count).map((_, i) => i)
    this.size = new Int32Array(count).fill(1)
  }
  find(i: number): number {
    let root = i
    while (this.parent[root] !== root) root = this.parent[root]
    while (this.parent[i] !== root) {
      const next = this.parent[i]
      this.parent[i] = root
      i = next
    }
    return root
  }
  /** Joins two clumps; returns the joined root, or −1 when already one. */
  union(a: number, b: number): number {
    let ra = this.find(a)
    let rb = this.find(b)
    if (ra === rb) return -1
    if (this.size[ra] < this.size[rb]) [ra, rb] = [rb, ra]
    this.parent[rb] = ra
    this.size[ra] += this.size[rb]
    return ra
  }
  sizeOf(i: number): number {
    return this.size[this.find(i)]
  }
}

/** A grid of tree indices `cellMeters` square, for finding neighbours without testing every pair. */
export class TreeGrid {
  private cells = new Map<number, number[]>()
  constructor(
    private trees: ReadonlyArray<Pick<StandTree, 'x' | 'y'>>,
    private cellMeters: number,
  ) {}
  private keyOf(cx: number, cy: number) {
    return (cx + 1_048_576) * 2_097_152 + (cy + 1_048_576)
  }
  add(index: number) {
    const tree = this.trees[index]
    const key = this.keyOf(Math.floor(tree.x / this.cellMeters), Math.floor(tree.y / this.cellMeters))
    const list = this.cells.get(key)
    if (list) list.push(index)
    else this.cells.set(key, [index])
  }
  /** Calls `visit` for every added tree within `radius` of tree `index` (itself excluded). */
  near(index: number, radius: number, visit: (other: number) => void) {
    const tree = this.trees[index]
    const reach = Math.ceil(radius / this.cellMeters)
    const cx = Math.floor(tree.x / this.cellMeters)
    const cy = Math.floor(tree.y / this.cellMeters)
    const r2 = radius * radius
    for (let dy = -reach; dy <= reach; dy += 1)
      for (let dx = -reach; dx <= reach; dx += 1) {
        const list = this.cells.get(this.keyOf(cx + dx, cy + dy))
        if (!list) continue
        for (const other of list) {
          if (other === index) continue
          const o = this.trees[other]
          const ddx = o.x - tree.x
          const ddy = o.y - tree.y
          if (ddx * ddx + ddy * ddy < r2) visit(other)
        }
      }
  }
}

export type ClumpReading = {
  /** Clump size of each tree, in input order. */
  sizes: Int32Array
  /** Share of trees in each ICO class, 0–1, in `ICO_CLASSES` order. */
  shares: number[]
  /** Mean over trees of the size of the clump each stands in (RxGaming's mean clump size). */
  meanClumpSize: number
  clumpCount: number
}

/** Clumps among `trees` by the ICO rule. Counts drawn trees, not expanded stems: clumps are a pattern. */
export function readClumps(
  trees: ReadonlyArray<Pick<StandTree, 'x' | 'y'>>,
  distanceMeters = ICO_CLUMP_DISTANCE_METERS,
): ClumpReading {
  const sets = new ClumpSets(trees.length)
  const grid = new TreeGrid(trees, distanceMeters)
  for (let i = 0; i < trees.length; i += 1) {
    grid.near(i, distanceMeters, (other) => sets.union(i, other))
    grid.add(i)
  }
  const sizes = new Int32Array(trees.length)
  const roots = new Set<number>()
  const counts = ICO_CLASSES.map(() => 0)
  let total = 0
  for (let i = 0; i < trees.length; i += 1) {
    sizes[i] = sets.sizeOf(i)
    roots.add(sets.find(i))
    counts[icoClassIndex(sizes[i])] += 1
    total += sizes[i]
  }
  return {
    sizes,
    shares: counts.map((count) => (trees.length ? count / trees.length : 0)),
    meanClumpSize: trees.length ? total / trees.length : 0,
    clumpCount: roots.size,
  }
}
