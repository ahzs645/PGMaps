/**
 * Chart data for a stand prescription: diameter and height classes split into kept and removed,
 * species before and after, the clump-size distribution before, asked for and kept, and a side view
 * of the trees in a strip through the block. Every figure is read from the stand and the result
 * (`standMetrics.ts`), never recomputed another way, so the charts agree with the stand table.
 *
 * DOM-free.
 */

import type { TreeSpeciesId } from '../forest'
import { DEFAULT_CLUMP_TARGETS, KEPT, type PrescriptionResult } from './prescription'
import { ICO_CLASSES, classCounts, speciesShares, type IcoClassId } from './standMetrics'
import type { Stand, StandTree } from './standTrees'

/** Readable names for the drawn species, in `TREE_SPECIES_IDS` order. */
export const SPECIES_LABELS: Record<TreeSpeciesId, string> = {
  pine: 'Pine',
  spruce: 'Spruce',
  fir: 'Fir',
  douglasFir: 'Douglas-fir',
  aspen: 'Aspen',
  birch: 'Birch',
}

/** One class of a stacked kept/removed chart, stems per hectare. */
export type StackedClass = { from: number; to: number; kept: number; removed: number }

/** Width of a diameter class, cm, before `classCounts` widens it to fit. */
export const DIAMETER_CLASS_CM = 2
/** Width of a height class, m. */
export const HEIGHT_CLASS_M = 2
/** Most classes a stacked chart shows; wider classes past it. */
export const MAX_CLASSES = 24

function split(stand: Stand, result: PrescriptionResult): { kept: StandTree[]; removed: StandTree[] } {
  const kept: StandTree[] = []
  const removed: StandTree[] = []
  stand.trees.forEach((tree, i) => (result.removed[i] ? removed : kept).push(tree))
  return { kept, removed }
}

function stacked(
  stand: Stand,
  result: PrescriptionResult,
  measure: (tree: StandTree) => number,
  width: number,
): StackedClass[] {
  const { kept, removed } = split(stand, result)
  return classCounts([kept, removed], measure, width, stand.areaHa, MAX_CLASSES).map((row) => ({
    from: row.from,
    to: row.to,
    kept: row.counts[0],
    removed: row.counts[1],
  }))
}

/** Diameter classes, 2 cm wide (widened to fit `MAX_CLASSES`), stems/ha kept and removed. */
export function diameterClasses(stand: Stand, result: PrescriptionResult): StackedClass[] {
  return stacked(stand, result, (tree) => tree.dbhCm, DIAMETER_CLASS_CM)
}

/** Height classes, 2 m wide (widened to fit `MAX_CLASSES`), stems/ha kept and removed. */
export function heightClasses(stand: Stand, result: PrescriptionResult): StackedClass[] {
  return stacked(stand, result, (tree) => tree.heightMeters, HEIGHT_CLASS_M)
}

export type SpeciesRow = { species: TreeSpeciesId; label: string; before: number; after: number }

/** Stems/ha of each drawn species before and after, species the stand has only. */
export function speciesBeforeAfter(stand: Stand, result: PrescriptionResult): SpeciesRow[] {
  const { kept } = split(stand, result)
  return speciesShares([stand.trees, kept], stand.areaHa).map((row) => ({
    species: row.species,
    label: SPECIES_LABELS[row.species],
    before: row.perHa[0],
    after: row.perHa[1],
  }))
}

export type ClumpRow = { id: IcoClassId; label: string; before: number; target: number; kept: number }

/** The clump targets as shares summing to 1, as the grouped method reads them. */
export function normalizedClumpTargets(targets: ReadonlyArray<number>): number[] {
  const sum = targets.reduce((total, share) => total + Math.max(0, share), 0)
  return sum > 0 ? targets.map((share) => Math.max(0, share) / sum) : [...DEFAULT_CLUMP_TARGETS]
}

/** Share of trees, 0–1, in each ICO clump class: the stand before, the target, and the trees kept. */
export function clumpDistribution(result: PrescriptionResult, clumpTargets: ReadonlyArray<number>): ClumpRow[] {
  const target = normalizedClumpTargets(clumpTargets)
  return ICO_CLASSES.map((icoClass, i) => ({
    id: icoClass.id,
    label: icoClass.label,
    before: result.clumps.before.shares[i] ?? 0,
    target: target[i] ?? 0,
    kept: result.clumps.retained.shares[i] ?? 0,
  }))
}

export type ProfileStatus = 'kept' | 'removed' | 'protected'

export type ProfileTree = {
  /** Metres along the strip from its first tree. */
  along: number
  /** Metres to the right of the strip's centre line, looking along it. */
  across: number
  heightMeters: number
  crownWidthMeters: number
  status: ProfileStatus
  species: TreeSpeciesId
  id: string
}

export type StandProfile = {
  trees: ProfileTree[]
  /** Bearing the strip runs along, degrees from north, 0–180. */
  bearingDegrees: number
  /** The block's long axis, degrees from north, 0–180: the default bearing. */
  axisBearingDegrees: number
  widthMeters: number
  /** Length of the strip from its first tree to its last, metres. */
  lengthMeters: number
  /** Trees in the strip, before thinning the drawing to `maxTrees`. */
  inStrip: number
  /** Trees in the strip left out of the drawing. */
  leftOut: number
  /** Trees in the strip by status, before thinning the drawing. */
  counts: Record<ProfileStatus, number>
}

export const PROFILE_STRIP_WIDTH_M = 20
export const PROFILE_MAX_TREES = 400

const normalBearing = (degrees: number) => ((degrees % 180) + 180) % 180

/**
 * The long axis of a set of points, degrees from north, 0–180: the principal axis of their spread.
 * A round or single-point stand has none, and reads east–west (90°).
 */
export function principalAxisBearing(points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length < 2) return 90
  let mx = 0
  let my = 0
  for (const point of points) {
    mx += point.x
    my += point.y
  }
  mx /= points.length
  my /= points.length
  let cxx = 0
  let cyy = 0
  let cxy = 0
  for (const point of points) {
    const dx = point.x - mx
    const dy = point.y - my
    cxx += dx * dx
    cyy += dy * dy
    cxy += dx * dy
  }
  if (Math.abs(cxy) < 1e-9 && Math.abs(cxx - cyy) < 1e-9) return 90
  // Angle from east, anticlockwise; a bearing is from north, clockwise.
  const fromEast = 0.5 * Math.atan2(2 * cxy, cxx - cyy)
  return normalBearing(90 - (fromEast * 180) / Math.PI)
}

/**
 * The trees standing in a strip `widthMeters` wide through the stand's centre along `bearingDegrees`
 * (default: the block's long axis), for a side view. Past `maxTrees` the drawing keeps evenly spaced
 * trees along the strip and says how many it left out.
 */
export function standProfile(
  stand: Stand,
  result: PrescriptionResult,
  options: { bearingDegrees?: number | null; widthMeters?: number; maxTrees?: number } = {},
): StandProfile {
  const trees = stand.trees
  const axisBearingDegrees = principalAxisBearing(trees)
  const bearingDegrees =
    options.bearingDegrees != null && Number.isFinite(options.bearingDegrees)
      ? normalBearing(options.bearingDegrees)
      : axisBearingDegrees
  const widthMeters = Math.max(1, options.widthMeters ?? PROFILE_STRIP_WIDTH_M)
  const maxTrees = Math.max(2, Math.floor(options.maxTrees ?? PROFILE_MAX_TREES))
  const counts: Record<ProfileStatus, number> = { kept: 0, removed: 0, protected: 0 }
  if (trees.length === 0)
    return {
      trees: [],
      bearingDegrees,
      axisBearingDegrees,
      widthMeters,
      lengthMeters: 0,
      inStrip: 0,
      leftOut: 0,
      counts,
    }

  let cx = 0
  let cy = 0
  for (const tree of trees) {
    cx += tree.x
    cy += tree.y
  }
  cx /= trees.length
  cy /= trees.length
  const radians = (bearingDegrees * Math.PI) / 180
  // Along: x east, y north, toward the bearing. Across: to the right of it.
  const ax = Math.sin(radians)
  const ay = Math.cos(radians)

  const strip: ProfileTree[] = []
  trees.forEach((tree, i) => {
    const dx = tree.x - cx
    const dy = tree.y - cy
    const across = dx * ay - dy * ax
    if (Math.abs(across) > widthMeters / 2) return
    const status: ProfileStatus = result.removed[i]
      ? 'removed'
      : result.keptBecause[i] === KEPT.protected
        ? 'protected'
        : 'kept'
    counts[status] += 1
    strip.push({
      along: dx * ax + dy * ay,
      across,
      heightMeters: tree.heightMeters,
      crownWidthMeters: tree.crownWidthMeters,
      status,
      species: tree.species,
      id: tree.id,
    })
  })
  strip.sort((a, b) => a.along - b.along || a.across - b.across)
  const start = strip.length ? strip[0].along : 0
  for (const tree of strip) tree.along -= start
  const lengthMeters = strip.length ? strip[strip.length - 1].along : 0

  let drawn = strip
  if (strip.length > maxTrees) {
    drawn = []
    for (let k = 0; k < maxTrees; k += 1) drawn.push(strip[Math.round((k * (strip.length - 1)) / (maxTrees - 1))])
  }
  return {
    trees: drawn,
    bearingDegrees,
    axisBearingDegrees,
    widthMeters,
    lengthMeters,
    inStrip: strip.length,
    leftOut: strip.length - drawn.length,
    counts,
  }
}

/**
 * Round axis ticks from 0 to at least `max`: steps of 1, 2, 2.5 or 5 × a power of ten, about
 * `count` of them. A zero or missing maximum gives 0 and 1.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0, 1]
  const raw = max / Math.max(1, count)
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((candidate) => candidate >= raw) ?? 10 * power
  const ticks: number[] = []
  for (let value = 0; value < max + step * 1e-9; value += step) ticks.push(Number(value.toPrecision(12)))
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)))
  return ticks
}
