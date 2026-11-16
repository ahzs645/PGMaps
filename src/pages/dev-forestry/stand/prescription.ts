/**
 * A stand prescription: which trees a retention or partial-cut block takes and which it leaves.
 *
 * Two patterns, both chosen among the block's own trees (`standTrees.ts`), never placed afresh:
 *
 * - **Dispersed.** Mark trees in an order (from below or above by diameter or height, or at random:
 *   "proportional") until the stand left meets a residual target: basal area, stems, either as a
 *   share of the stand, or Reineke's stand density index. The method is WinSVS's thinning dialog
 *   (USDA Forest Service, public domain), re-implemented from its manual and a written review, with
 *   its metric-SDI and target-counting defects left out.
 * - **Grouped.** Keep everything that must stay (protected trees, trees at or over the diameter
 *   limit, trees the prescription may not cut), then keep clumps of trees, larger diameters first,
 *   choosing each clump's size to bring the retained clump-size distribution toward a target, until
 *   the residual target is met. This is the treatment method RxGaming's authors publish
 *   (Bartl-Geller et al. 2025, *Journal of Forestry* 124:307–320, after Churchill et al. 2013's ICO
 *   approach), written from that description alone: RxGaming's source carries no licence and was
 *   not read.
 *
 * Both take a seed, so the same prescription always marks the same trees, and every reported figure
 * says whether the target was reached and, when not, what held the stand. Display only: nothing here
 * is an analysis input. The reviewer's Table 5/6 figures change only when they adopt a figure.
 *
 * DOM-free.
 */

import { TREE_SPECIES_IDS, mulberry32, type TreeSpeciesId } from '../forest'
import {
  ClumpSets,
  ICO_CLASSES,
  ICO_CLUMP_DISTANCE_METERS,
  TreeGrid,
  icoClassIndex,
  readClumps,
  standDensityIndex,
  summarizeStand,
  type ClumpReading,
  type StandSummary,
} from './standMetrics'
import type { Stand, StandTree } from './standTrees'
import type { ImportedTreeSource, PackedImportedTrees } from './treeListImport'

export type RetentionPattern = 'dispersed' | 'grouped'

export type PrescriptionTargetKind = 'block' | 'basalArea' | 'basalAreaShare' | 'stems' | 'stemShare' | 'sdi'

/**
 * What the stand left behind must come to. `block` follows the block's own recorded figure: a
 * retention block's share retained, a partial cut's volume not removed, both read as a share of
 * basal area (closer to volume than a count of stems is).
 */
export type PrescriptionTarget = { kind: PrescriptionTargetKind; value: number }

export type RemovalOrder = 'fromBelow' | 'fromAbove' | 'proportional'

/**
 * What happens to a tree taken: hauled away leaving a stump, felled and left with its crown, or
 * felled, limbed and left as a log (WinSVS's treatment outcomes).
 */
export type TreeOutcome = 'hauled' | 'felled' | 'limbed'

export type StandPrescription = {
  pattern: RetentionPattern
  target: PrescriptionTarget
  /** Dispersed only: the order trees are marked in. */
  order: RemovalOrder
  orderBy: 'dbh' | 'height'
  /** Only trees in this diameter window may be cut, cm (null: no bound). */
  removableDbhCm: { min: number | null; max: number | null }
  /** Every tree at or over this diameter is kept, cm (RxGaming's diameter limit). */
  diameterLimitCm: number | null
  /** Which drawn species may be cut: all, only these, or all but these. */
  species: { mode: 'all' | 'only' | 'except'; ids: TreeSpeciesId[] }
  /** Grouped only: target share of retained trees in each ICO clump class, `ICO_CLASSES` order. */
  clumpTargets: number[]
  /** Grouped only: trees nearer than this stand in one clump, metres. */
  clumpDistanceMeters: number
  outcome: TreeOutcome
  /** Which way felled trees lie, degrees from north; null for any way. */
  fellingBearingDegrees: number | null
  /** Spread about that bearing, degrees (one standard deviation). */
  fellingSpreadDegrees: number
  /**
   * Share of marked trees the crew actually cuts, 0.5–1 (WinSVS's marking "efficiency"): below 1,
   * some marked trees are left standing, as in the field.
   */
  markingEfficiency: number
  /** Trees no rule may cut, by `StandTree.key` (WinSVS's locked status). */
  protectedKeys: number[]
  /**
   * Wildlife trees left as snags: of the trees taken, the largest `perHa` per hectare are topped at
   * `heightMeters` and left standing dead rather than felled. 0 leaves none. `yearsAfterHarvest` is
   * when they are shown: each falls in the year its species' published curve gives it (`snagDecay.ts`).
   */
  snags: { perHa: number; heightMeters: number; yearsAfterHarvest: number }
  /**
   * The block's trees from an imported tree list (LiDAR-detected trees, a stem map) instead of the
   * road view's drawn stems: packed by `packImportedTrees` (`treeListImport.ts`), with what was read.
   */
  imported?: { source: ImportedTreeSource; packed: PackedImportedTrees } | null
  seed: number
}

/**
 * A starting distribution for grouped retention: most retained trees in small and medium clumps.
 * A starting point to adjust, not a reference condition: ICO reference distributions are measured
 * per forest type, and none is published for BC interior stands.
 */
export const DEFAULT_CLUMP_TARGETS = [0.2, 0.3, 0.25, 0.15, 0.1]

export const DEFAULT_PRESCRIPTION: StandPrescription = {
  pattern: 'dispersed',
  target: { kind: 'block', value: 50 },
  order: 'fromBelow',
  orderBy: 'dbh',
  removableDbhCm: { min: null, max: null },
  diameterLimitCm: null,
  species: { mode: 'all', ids: [] },
  clumpTargets: DEFAULT_CLUMP_TARGETS,
  clumpDistanceMeters: ICO_CLUMP_DISTANCE_METERS,
  outcome: 'hauled',
  fellingBearingDegrees: null,
  fellingSpreadDegrees: 30,
  markingEfficiency: 1,
  protectedKeys: [],
  snags: { perHa: 0, heightMeters: 6, yearsAfterHarvest: 0 },
  seed: 1,
}

/** Largest clump the grouped method builds for the open-ended 16+ class. */
const LARGEST_CLUMP = 25

export const TARGET_LABELS: Record<PrescriptionTargetKind, { label: string; unit: string }> = {
  block: { label: "The block's recorded share", unit: '% of basal area kept' },
  basalArea: { label: 'Basal area left', unit: 'm²/ha' },
  basalAreaShare: { label: 'Share of basal area kept', unit: '%' },
  stems: { label: 'Stems left', unit: 'stems/ha' },
  stemShare: { label: 'Share of stems kept', unit: '%' },
  sdi: { label: 'Stand density index left', unit: 'SDI' },
}

const isSpecies = (value: unknown): value is TreeSpeciesId =>
  typeof value === 'string' && (TREE_SPECIES_IDS as string[]).includes(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nullableNumber = (value: unknown, min: number, max: number): number | null =>
  finite(value) ? Math.max(min, Math.min(max, value)) : null

/** A prescription read from a saved scene, or null where it is not one. Bad fields fall back to the defaults. */
export function parsePrescription(raw: unknown): StandPrescription | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const base = DEFAULT_PRESCRIPTION
  const target = value.target as Record<string, unknown> | undefined
  const targetKind = target && typeof target.kind === 'string' && target.kind in TARGET_LABELS ? target.kind : null
  const removable = (value.removableDbhCm ?? {}) as Record<string, unknown>
  const species = (value.species ?? {}) as Record<string, unknown>
  const clumpTargets = Array.isArray(value.clumpTargets) ? value.clumpTargets : null
  const snags = (value.snags ?? {}) as Record<string, unknown>
  return {
    pattern: value.pattern === 'grouped' ? 'grouped' : 'dispersed',
    target:
      targetKind && finite(target!.value)
        ? { kind: targetKind as PrescriptionTargetKind, value: Math.max(0, target!.value) }
        : base.target,
    order: value.order === 'fromAbove' || value.order === 'proportional' ? value.order : 'fromBelow',
    orderBy: value.orderBy === 'height' ? 'height' : 'dbh',
    removableDbhCm: {
      min: nullableNumber(removable.min, 0, 500),
      max: nullableNumber(removable.max, 0, 500),
    },
    diameterLimitCm: nullableNumber(value.diameterLimitCm, 1, 500),
    species: {
      mode: species.mode === 'only' || species.mode === 'except' ? species.mode : 'all',
      ids: Array.isArray(species.ids) ? species.ids.filter(isSpecies) : [],
    },
    clumpTargets:
      clumpTargets && clumpTargets.length === ICO_CLASSES.length && clumpTargets.every(finite)
        ? (clumpTargets as number[]).map((share) => Math.max(0, share))
        : base.clumpTargets,
    clumpDistanceMeters: nullableNumber(value.clumpDistanceMeters, 1, 20) ?? base.clumpDistanceMeters,
    outcome: value.outcome === 'felled' || value.outcome === 'limbed' ? value.outcome : 'hauled',
    fellingBearingDegrees: nullableNumber(value.fellingBearingDegrees, 0, 360),
    fellingSpreadDegrees: nullableNumber(value.fellingSpreadDegrees, 0, 180) ?? base.fellingSpreadDegrees,
    markingEfficiency: nullableNumber(value.markingEfficiency, 0.5, 1) ?? 1,
    protectedKeys: Array.isArray(value.protectedKeys)
      ? value.protectedKeys.filter((key): key is number => finite(key) && Number.isInteger(key))
      : [],
    ...(parseImported(value.imported) ? { imported: parseImported(value.imported) } : {}),
    snags: {
      perHa: nullableNumber(snags.perHa, 0, 100) ?? 0,
      heightMeters: nullableNumber(snags.heightMeters, 1, 40) ?? base.snags.heightMeters,
      yearsAfterHarvest: Math.round(nullableNumber(snags.yearsAfterHarvest, 0, 60) ?? 0),
    },
    seed: finite(value.seed) && Number.isInteger(value.seed) ? value.seed : 1,
  }
}

/** A saved imported tree list, checked for shape; `unpackImportedTrees` checks its contents when it is read. */
function parseImported(raw: unknown): StandPrescription['imported'] {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as { source?: Record<string, unknown>; packed?: Record<string, unknown> }
  const source = value.source
  const packed = value.packed
  if (
    !source ||
    !packed ||
    !Array.isArray(packed.fields) ||
    !Array.isArray(packed.data) ||
    !Array.isArray(packed.species)
  )
    return null
  return {
    source: {
      fileName: typeof source.fileName === 'string' ? source.fileName : 'Imported trees',
      crs: typeof source.crs === 'string' ? source.crs : '',
      count: finite(source.count) ? source.count : 0,
      dropped: finite(source.dropped) ? source.dropped : 0,
      ...(finite(source.leftOut) ? { leftOut: source.leftOut } : {}),
    },
    packed: packed as unknown as PackedImportedTrees,
  }
}

/** Why a tree was left standing. */
export const KEPT = {
  chosen: 0,
  protected: 1,
  diameterLimit: 2,
  /** Outside the removable diameter window or a species the prescription may not cut. */
  notRemovable: 3,
  /** Marked, but the crew did not cut it (`markingEfficiency`). */
  missed: 4,
} as const

export type BlockFigures = {
  harvestSystem?: 'clearcut' | 'retention' | 'partial'
  retentionPercent?: number | null
  volumeRemovedPercent?: number | null
}

export type PrescriptionResult = {
  /** 1 where the tree is taken, per `stand.trees` index. */
  removed: Uint8Array
  /** 1 where a taken tree is left standing dead as a snag (`StandPrescription.snags`); always also `removed`. */
  snags: Uint8Array
  /** For a kept tree, why (`KEPT`). */
  keptBecause: Uint8Array
  /** Which way each taken tree lies, degrees from north (NaN for a tree left standing). */
  fellingBearings: Float32Array
  target: {
    kind: PrescriptionTargetKind
    label: string
    unit: string
    /** What was asked, in `unit`. */
    asked: number
    /** What the stand left comes to, in `unit`. */
    reached: number
    /** What the whole stand came to, in `unit`. */
    before: number
  }
  /** True when the stand left is within one tree of the target. */
  reached: boolean
  /** Why the target was not reached, or a caution about the stand; null otherwise. */
  message: string | null
  /** The block figure the target followed when it was `block` and none was recorded. */
  assumedBlockShare: boolean
  summaries: { before: StandSummary; removed: StandSummary; retained: StandSummary }
  clumps: { before: ClumpReading; retained: ClumpReading }
  /** Basal area and stems taken, percent of the stand. */
  removedBasalAreaPercent: number
  removedStemsPercent: number
  counts: { protected: number; diameterLimit: number; notRemovable: number; missed: number; snags: number }
}

/** Running totals of a set of trees: Σ expansion and Σ expansion · dbh². */
type Totals = { stems: number; squares: number }

function measureOf(kind: PrescriptionTargetKind, totals: Totals, whole: Totals, areaHa: number): number {
  const area = Math.max(1e-9, areaHa)
  switch (kind) {
    case 'basalArea':
      return ((Math.PI / 4) * (totals.squares / 10_000)) / area
    case 'stems':
      return totals.stems / area
    case 'stemShare':
      return whole.stems > 0 ? (100 * totals.stems) / whole.stems : 0
    case 'sdi':
      return standDensityIndex(totals.stems / area, totals.stems > 0 ? Math.sqrt(totals.squares / totals.stems) : 0)
    default:
      return whole.squares > 0 ? (100 * totals.squares) / whole.squares : 0
  }
}

/** The block's recorded share kept, percent of basal area, and whether it was assumed. */
export function blockShareKept(block: BlockFigures): { percent: number; assumed: boolean } {
  if (block.harvestSystem === 'retention' && block.retentionPercent != null)
    return { percent: Math.max(0, Math.min(100, block.retentionPercent)), assumed: false }
  if (block.harvestSystem === 'partial' && block.volumeRemovedPercent != null)
    return { percent: Math.max(0, Math.min(100, 100 - block.volumeRemovedPercent)), assumed: false }
  return { percent: 50, assumed: true }
}

function normalClumpTargets(targets: number[]): number[] {
  const sum = targets.reduce((total, share) => total + Math.max(0, share), 0)
  return sum > 0 ? targets.map((share) => Math.max(0, share) / sum) : DEFAULT_CLUMP_TARGETS
}

/** Applies a prescription to a stand. Same stand, prescription and block: same trees, every time. */
export function applyPrescription(
  stand: Stand,
  prescription: StandPrescription,
  block: BlockFigures = {},
): PrescriptionResult {
  const trees = stand.trees
  const n = trees.length
  const random = mulberry32((prescription.seed * 2_654_435_761) >>> 0 || 1)
  const protectedKeys = new Set(prescription.protectedKeys)
  const speciesIds = new Set(prescription.species.ids)
  const limit = prescription.diameterLimitCm
  const { min: minDbh, max: maxDbh } = prescription.removableDbhCm

  // Why each tree must stay, before any choosing.
  const keptBecause = new Uint8Array(n)
  const removable = new Uint8Array(n)
  const whole: Totals = { stems: 0, squares: 0 }
  trees.forEach((tree, i) => {
    whole.stems += tree.expansion
    whole.squares += tree.expansion * tree.dbhCm * tree.dbhCm
    if (protectedKeys.has(tree.key)) keptBecause[i] = KEPT.protected
    else if (limit != null && tree.dbhCm >= limit) keptBecause[i] = KEPT.diameterLimit
    else if (
      (minDbh != null && tree.dbhCm < minDbh) ||
      (maxDbh != null && tree.dbhCm >= maxDbh) ||
      (prescription.species.mode === 'only' && !speciesIds.has(tree.species)) ||
      (prescription.species.mode === 'except' && speciesIds.has(tree.species))
    )
      keptBecause[i] = KEPT.notRemovable
    else removable[i] = 1
  })

  const share = blockShareKept(block)
  const kind = prescription.target.kind
  const asked = kind === 'block' ? share.percent : prescription.target.value
  const before = measureOf(kind, whole, whole, stand.areaHa)

  const marked = new Uint8Array(n)
  let message: string | null = null

  if (prescription.pattern === 'dispersed') {
    message = markDispersed(trees, removable, marked, prescription, kind, asked, whole, stand.areaHa, random)
  } else {
    message = markGrouped(trees, removable, marked, prescription, kind, asked, whole, stand.areaHa, random)
  }

  // The crew cuts what it marked, short of a perfect mark when the efficiency says so.
  const removed = new Uint8Array(n)
  const fellingBearings = new Float32Array(n).fill(Number.NaN)
  const bearing = prescription.fellingBearingDegrees
  for (let i = 0; i < n; i += 1) {
    if (!marked[i]) continue
    if (prescription.markingEfficiency < 1 && random() >= prescription.markingEfficiency) {
      keptBecause[i] = KEPT.missed
      continue
    }
    removed[i] = 1
    const u = Math.max(1e-12, random())
    const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
    const centre = bearing ?? random() * 360
    fellingBearings[i] = (((centre + normal * prescription.fellingSpreadDegrees) % 360) + 360) % 360
  }

  // Wildlife trees: the largest taken trees left as snags, topped, not felled.
  const snags = new Uint8Array(n)
  const wantedSnags = Math.round(Math.max(0, prescription.snags.perHa) * stand.areaHa)
  if (wantedSnags > 0) {
    const taken: number[] = []
    removed.forEach((flag, i) => {
      if (flag) taken.push(i)
    })
    taken.sort((a, b) => trees[b].dbhCm - trees[a].dbhCm || trees[a].key - trees[b].key)
    for (const i of taken.slice(0, wantedSnags)) {
      snags[i] = 1
      fellingBearings[i] = Number.NaN
    }
  }

  const retainedTrees: StandTree[] = []
  const removedTrees: StandTree[] = []
  const left: Totals = { stems: 0, squares: 0 }
  const counts = {
    protected: 0,
    diameterLimit: 0,
    notRemovable: 0,
    missed: 0,
    snags: snags.reduce((sum, flag) => sum + flag, 0),
  }
  trees.forEach((tree, i) => {
    if (removed[i]) {
      removedTrees.push(tree)
      return
    }
    retainedTrees.push(tree)
    left.stems += tree.expansion
    left.squares += tree.expansion * tree.dbhCm * tree.dbhCm
    if (keptBecause[i] === KEPT.protected) counts.protected += 1
    else if (keptBecause[i] === KEPT.diameterLimit) counts.diameterLimit += 1
    else if (keptBecause[i] === KEPT.notRemovable) counts.notRemovable += 1
    else if (keptBecause[i] === KEPT.missed) counts.missed += 1
  })
  const reachedValue = measureOf(kind, left, whole, stand.areaHa)
  // Within one mean tree of the target counts as reached: the stand is trees, not a continuum.
  const oneTree = n > 0 ? Math.abs(before) / n : 0
  const reached = Math.abs(reachedValue - asked) <= Math.max(oneTree * 1.5, Math.abs(asked) * 0.01)
  if (!message && counts.missed > 0)
    message = `${counts.missed} marked tree${counts.missed === 1 ? ' was' : 's were'} left by the crew (marking efficiency ${Math.round(prescription.markingEfficiency * 100)}%).`

  const label = TARGET_LABELS[kind]
  return {
    removed,
    snags,
    keptBecause,
    fellingBearings,
    target: { kind, label: label.label, unit: label.unit, asked, reached: reachedValue, before },
    reached,
    message,
    assumedBlockShare: kind === 'block' && share.assumed,
    summaries: {
      before: summarizeStand(trees, stand.areaHa),
      removed: summarizeStand(removedTrees, stand.areaHa),
      retained: summarizeStand(retainedTrees, stand.areaHa),
    },
    clumps: {
      before: readClumps(trees, prescription.clumpDistanceMeters),
      retained: readClumps(retainedTrees, prescription.clumpDistanceMeters),
    },
    removedBasalAreaPercent: whole.squares > 0 ? (100 * (whole.squares - left.squares)) / whole.squares : 0,
    removedStemsPercent: whole.stems > 0 ? (100 * (whole.stems - left.stems)) / whole.stems : 0,
    counts,
  }
}

/** Marks trees in order until the stand left meets the target. Returns a message when it cannot. */
function markDispersed(
  trees: ReadonlyArray<StandTree>,
  removable: Uint8Array,
  marked: Uint8Array,
  prescription: StandPrescription,
  kind: PrescriptionTargetKind,
  asked: number,
  whole: Totals,
  areaHa: number,
  random: () => number,
): string | null {
  const left: Totals = { ...whole }
  const current = () => measureOf(kind, left, whole, areaHa)
  if (current() <= asked) return 'The stand is already at or below the target: nothing is cut.'
  const order: number[] = []
  removable.forEach((flag, i) => {
    if (flag) order.push(i)
  })
  const by = prescription.orderBy === 'height' ? (i: number) => trees[i].heightMeters : (i: number) => trees[i].dbhCm
  if (prescription.order === 'proportional') {
    // A seeded shuffle: removal at random keeps the diameter distribution's shape.
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
  } else {
    const sign = prescription.order === 'fromBelow' ? 1 : -1
    order.sort((a, b) => sign * (by(a) - by(b)) || trees[a].key - trees[b].key)
  }
  for (const i of order) {
    const valueBefore = current()
    const tree = trees[i]
    left.stems -= tree.expansion
    left.squares -= tree.expansion * tree.dbhCm * tree.dbhCm
    marked[i] = 1
    const valueAfter = current()
    if (valueAfter <= asked) {
      // Take the last tree only if that lands nearer the target than leaving it.
      if (asked - valueAfter > valueBefore - asked) {
        marked[i] = 0
        left.stems += tree.expansion
        left.squares += tree.expansion * tree.dbhCm * tree.dbhCm
      }
      return null
    }
  }
  return 'Every tree the prescription may cut is cut and the stand left is still above the target: protected trees, the diameter limit or the species and size limits hold the rest.'
}

/**
 * Keeps clumps until the stand left meets the target, sizing each clump to close the gap between the
 * retained clump-size distribution and the target one; larger diameters are favoured as clump seeds
 * and as clump members. Returns a message when the target cannot be met.
 */
function markGrouped(
  trees: ReadonlyArray<StandTree>,
  removable: Uint8Array,
  marked: Uint8Array,
  prescription: StandPrescription,
  kind: PrescriptionTargetKind,
  asked: number,
  whole: Totals,
  areaHa: number,
  random: () => number,
): string | null {
  const n = trees.length
  const distance = prescription.clumpDistanceMeters
  const targets = normalClumpTargets(prescription.clumpTargets)
  const grid = new TreeGrid(trees, distance)
  for (let i = 0; i < n; i += 1) grid.add(i)
  const sets = new ClumpSets(n)
  const retained = new Uint8Array(n)
  // How many retained trees each tree touches: a new clump seeds only where this is 0.
  const touching = new Uint16Array(n)
  const classTrees = ICO_CLASSES.map(() => 0)
  let retainedCount = 0
  const left: Totals = { stems: 0, squares: 0 }
  const current = () => measureOf(kind, left, whole, areaHa)

  const keep = (i: number) => {
    const roots = new Set<number>()
    grid.near(i, distance, (other) => {
      touching[other] += 1
      if (retained[other]) roots.add(sets.find(other))
    })
    for (const root of roots) classTrees[icoClassIndex(sets.sizeOf(root))] -= sets.sizeOf(root)
    retained[i] = 1
    for (const root of roots) sets.union(i, root)
    const size = sets.sizeOf(i)
    classTrees[icoClassIndex(size)] += size
    retainedCount += 1
    left.stems += trees[i].expansion
    left.squares += trees[i].expansion * trees[i].dbhCm * trees[i].dbhCm
  }

  for (let i = 0; i < n; i += 1) if (!removable[i]) keep(i)
  let message: string | null = null
  if (current() >= asked) {
    message = 'The trees the prescription must keep already meet or pass the target: every other tree is cut.'
  } else {
    // Seeds in a weighted random order favouring large diameters (Efraimidis–Spirakis keys).
    const seeds: Array<{ i: number; key: number }> = []
    removable.forEach((flag, i) => {
      if (flag) seeds.push({ i, key: Math.log(Math.max(1e-12, random())) / Math.max(1, trees[i].dbhCm ** 2) })
    })
    seeds.sort((a, b) => b.key - a.key)
    let strict = 0
    let relaxed = 0
    const inGroup = new Uint8Array(n)
    while (current() < asked) {
      // The class furthest below its target share decides the next clump's size.
      let best = 0
      let deficit = -Infinity
      targets.forEach((target, c) => {
        const gap = target - classTrees[c] / Math.max(1, retainedCount)
        if (gap > deficit) {
          deficit = gap
          best = c
        }
      })
      const span = ICO_CLASSES[best]
      const to = Math.min(span.to, LARGEST_CLUMP)
      const size = span.from + Math.floor(random() * (to - span.from + 1))

      // A seed standing clear of every retained tree, so the clump is its own; failing that, any.
      let seed = -1
      while (strict < seeds.length && (retained[seeds[strict].i] || touching[seeds[strict].i] > 0)) strict += 1
      if (strict < seeds.length) seed = seeds[strict].i
      const alone = seed >= 0
      if (!alone) {
        while (relaxed < seeds.length && retained[seeds[relaxed].i]) relaxed += 1
        if (relaxed < seeds.length) seed = seeds[relaxed].i
      }
      if (seed < 0) {
        message = 'Every tree is kept and the stand is still below the target.'
        break
      }

      // Grow from the seed through its neighbours, largest diameter first.
      const group = [seed]
      inGroup[seed] = 1
      const frontier: number[] = []
      const offer = (i: number) =>
        grid.near(i, distance, (other) => {
          if (inGroup[other] || retained[other] || !removable[other]) return
          // Standing clear of other clumps keeps this one its own size.
          if (alone && touching[other] > 0) return
          inGroup[other] = 1
          frontier.push(other)
        })
      offer(seed)
      while (group.length < size && frontier.length > 0) {
        let pick = 0
        for (let k = 1; k < frontier.length; k += 1)
          if (trees[frontier[k]].dbhCm > trees[frontier[pick]].dbhCm) pick = k
        const next = frontier.splice(pick, 1)[0]
        group.push(next)
        offer(next)
      }
      for (const i of frontier) inGroup[i] = 0
      for (const i of group) {
        inGroup[i] = 0
        if (current() >= asked) break
        keep(i)
      }
    }
  }
  for (let i = 0; i < n; i += 1) if (removable[i] && !retained[i]) marked[i] = 1
  return message
}
