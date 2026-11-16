/**
 * From a prescription's result to what the road view draws.
 *
 * - `prescribedCells`: the stems a block keeps, for `placeTrees` (`Thinning.prescribed`). On the
 *   stand's own 4 m grid it names the stems taken; coarser bands, where one drawn stem stands for an
 *   area, keep a stem with the share of trees retained around it, read from a summed-area table, so
 *   grouped retention still reads as groups at a few hundred metres and dispersed as an even thinning.
 * - `treatedStems`: what is left of each tree taken: a stump, a felled tree with its crown, a log
 *   lying the way it was felled, or a snag left standing. Display only, like the slash piles
 *   (`harvestedGround.ts`).
 * - An imported stand (`Stand.source === 'imported'`) carries its standing trees in `replace`, which
 *   `placeTrees` draws in place of the near band's grid stems.
 * - `treatmentTints`: the colours *Tree colours: by treatment* draws kept and protected trees in.
 *
 * DOM-free.
 */

import {
  CONE_BASE_DIAMETER,
  VARIANTS_PER_SPECIES,
  mulberry32,
  stemCell,
  stemGridSteps,
  stemCellKey,
  type PrescribedCells,
  type TreeInstance,
} from '../forest'
import { KEPT, type PrescriptionResult, type TreeOutcome } from './prescription'
import type { SnagState } from './snagDecay'
import type { Stand } from './standTrees'

export function prescribedCells(
  stand: Stand,
  result: PrescriptionResult,
  options: { markOnly?: boolean; tints?: ReadonlyMap<number, readonly [number, number, number]> } = {},
): PrescribedCells {
  const steps = stemGridSteps(stand.spacingMeters, stand.anchorLatitude)
  const removed = new Set<number>()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const cells = stand.trees.map((tree, i) => {
    if (result.removed[i]) removed.add(tree.key)
    const [x, y] = stemCell(tree.lng, tree.lat, steps)
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    return [x, y] as const
  })
  const width = Number.isFinite(minX) ? maxX - minX + 1 : 0
  const height = Number.isFinite(minY) ? maxY - minY + 1 : 0
  // Summed-area tables of stems and of stems kept, one cell per grid cell, padded by a row and column of zeros.
  const stride = width + 1
  const all = new Float64Array(stride * (height + 1))
  const kept = new Float64Array(stride * (height + 1))
  cells.forEach(([x, y], i) => {
    const index = (y - minY + 1) * stride + (x - minX + 1)
    all[index] += 1
    if (!result.removed[i]) kept[index] += 1
  })
  for (let row = 1; row <= height; row += 1)
    for (let col = 1; col <= width; col += 1) {
      const index = row * stride + col
      all[index] += all[index - 1] + all[index - stride] - all[index - stride - 1]
      kept[index] += kept[index - 1] + kept[index - stride] - kept[index - stride - 1]
    }
  const sum = (table: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    table[y1 * stride + x1] - table[y0 * stride + x1] - table[y1 * stride + x0] + table[y0 * stride + x0]
  const total = cells.length
  const overall = total > 0 ? (total - removed.size) / total : 1
  // An imported stand is drawn as itself: its standing trees in place of the near band's grid stems.
  const replace =
    stand.source === 'imported'
      ? stand.trees.flatMap((tree, i): TreeInstance[] => {
          if (!options.markOnly && result.removed[i]) return []
          const random = mulberry32((Math.imul(-tree.key, 2_654_435_761) ^ 0x9e3779b9) >>> 0)
          const tint = options.tints?.get(tree.key)
          return [
            {
              lng: tree.lng,
              lat: tree.lat,
              elevationMeters: 0,
              heightMeters: tree.heightMeters,
              slenderness: tree.crownWidthMeters / Math.max(0.5, tree.heightMeters),
              tone: random(),
              species: tree.species,
              variant: Math.floor(random() * VARIANTS_PER_SPECIES) % VARIANTS_PER_SPECIES,
              ...(tint ? { tint } : {}),
              ...(tree.crownBaseMeters !== undefined ? { crownBase: tree.crownBaseMeters / tree.heightMeters } : {}),
            },
          ]
        })
      : null

  return {
    spacingMeters: stand.spacingMeters,
    seed: stand.seed,
    anchorLatitude: stand.anchorLatitude,
    removed,
    ...(options.markOnly ? { markOnly: true } : {}),
    ...(options.tints ? { tints: options.tints } : {}),
    ...(replace ? { replace } : {}),
    shareAt: (lng, lat, radiusMeters) => {
      if (total === 0) return 1
      const [cx, cy] = stemCell(lng, lat, steps)
      const reach = Math.max(1, Math.round(radiusMeters / stand.spacingMeters))
      const x0 = Math.max(0, cx - reach - minX)
      const y0 = Math.max(0, cy - reach - minY)
      const x1 = Math.min(width, cx + reach - minX + 1)
      const y1 = Math.min(height, cy + reach - minY + 1)
      if (x1 <= x0 || y1 <= y0) return overall
      const stems = sum(all, x0, y0, x1, y1)
      return stems > 0 ? sum(kept, x0, y0, x1, y1) / stems : overall
    },
  }
}

/** One cell key per stand tree, for callers that hold a key and want the tree (`stemCellKey`). */
export function treeIndexByKey(stand: Stand): Map<number, number> {
  return new Map(stand.trees.map((tree, i) => [tree.key, i]))
}

/** A cut stem's stump height, metres. */
export const STUMP_HEIGHT_METERS = 0.35

export type TreatedStemKind = 'stump' | 'felled' | 'log' | 'snag'

/**
 * What each tree taken leaves on the ground, as instances the solid tree layer draws with
 * `stumpMesh`, `felledTreeMesh` and `logMesh` (`harvestedGround.ts`). A felled tree's length is its
 * height; it lies along `headingDegrees`.
 */
export function treatedStems(
  stand: Stand,
  result: PrescriptionResult,
  outcome: TreeOutcome,
  snagHeightMeters = 6,
  /** Snags at this many years after harvest (`snagDecay.ts`); absent: as left, all standing. */
  snagStates?: ReadonlyArray<SnagState>,
): Record<TreatedStemKind, TreeInstance[]> {
  const out: Record<TreatedStemKind, TreeInstance[]> = { stump: [], felled: [], log: [], snag: [] }
  const snagState = new Map(snagStates?.map((state) => [state.index, state]))
  stand.trees.forEach((tree, i) => {
    if (!result.removed[i]) return
    const diameter = Math.max(0.08, tree.dbhCm / 100)
    if (result.snags[i]) {
      // A wildlife tree: topped and left standing dead, no taller than it was (`snagMesh`), shorter as
      // it breaks; once fallen, a log lying where it fell.
      const state = snagState.get(i)
      const height = Math.min(tree.heightMeters, snagHeightMeters) * (state?.heightShare ?? 1)
      if (state && !state.standing) {
        const random = mulberry32((Math.imul(Math.abs(tree.key) % 2_147_483_647, 0x9e3779b1) ^ 0x10c) >>> 0)
        out.log.push({
          lng: tree.lng,
          lat: tree.lat,
          elevationMeters: 0,
          tone: 0.5,
          species: tree.species,
          variant: 0,
          heightMeters: diameter,
          slenderness: (height * CONE_BASE_DIAMETER) / diameter,
          headingDegrees: random() * 360,
        })
        return
      }
      out.snag.push({
        lng: tree.lng,
        lat: tree.lat,
        elevationMeters: 0,
        tone: 0.5,
        species: tree.species,
        variant: 0,
        heightMeters: height,
        slenderness: (diameter * CONE_BASE_DIAMETER) / height,
      })
      return
    }
    const base = {
      lng: tree.lng,
      lat: tree.lat,
      elevationMeters: 0,
      tone: 0.5,
      species: tree.species,
      variant: 0,
    }
    // Every cut tree leaves a stump. The solid layer's width scale is height × slenderness / cone
    // base (`CONE_BASE_DIAMETER`); the stump mesh is a unit cylinder a unit across (`stumpMesh`).
    out.stump.push({
      ...base,
      heightMeters: STUMP_HEIGHT_METERS,
      slenderness: (diameter * CONE_BASE_DIAMETER) / STUMP_HEIGHT_METERS,
    })
    if (outcome === 'hauled') return
    const lying = {
      ...base,
      // Lying meshes are a metre tall per metre of stem diameter, a unit long (`felledTreeMesh`, `logMesh`).
      heightMeters: diameter,
      slenderness: (tree.heightMeters * CONE_BASE_DIAMETER) / diameter,
      headingDegrees: Number.isFinite(result.fellingBearings[i]) ? result.fellingBearings[i] : 0,
    }
    if (outcome === 'felled') out.felled.push(lying)
    // A limbed log is the merchantable stem: about four fifths of the tree.
    else out.log.push({ ...lying, slenderness: (tree.heightMeters * 0.8 * CONE_BASE_DIAMETER) / diameter })
  })
  return out
}

/**
 * Colours for *Tree colours: by treatment*. Before harvest the trees marked to cut are coloured
 * (WinSVS's marking view); after it, the trees kept. Protected trees are coloured in both.
 */
export const TREATMENT_TINTS = {
  marked: [1.0, 0.45, 0.3],
  kept: [0.35, 0.7, 1.0],
  protected: [1.0, 0.82, 0.25],
} as const

/** The tint each coloured tree takes, keyed by `stemCellKey`. */
export function treatmentTints(
  stand: Stand,
  result: PrescriptionResult,
  phase: 'before' | 'after',
): Map<number, readonly [number, number, number]> {
  const tints = new Map<number, readonly [number, number, number]>()
  stand.trees.forEach((tree, i) => {
    if (result.keptBecause[i] === KEPT.protected && !result.removed[i]) tints.set(tree.key, TREATMENT_TINTS.protected)
    else if (phase === 'before' && result.removed[i]) tints.set(tree.key, TREATMENT_TINTS.marked)
    else if (phase === 'after' && !result.removed[i]) tints.set(tree.key, TREATMENT_TINTS.kept)
  })
  return tints
}

export { stemCellKey }
