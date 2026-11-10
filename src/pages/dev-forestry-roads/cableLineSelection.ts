/**
 * Suggested skyline lines for a block: a small set of the feasible lines that together yard as
 * much of the block as possible.
 *
 * Problem. Given the feasible lines L (each with the set of yardable block cells its band covers,
 * its number of intermediate supports s and its mean carriage distance), choose S ⊆ L with
 * |S| ≤ K maximising the block area covered by the union of the chosen bands, where a line costs
 * 1 + p·s (p = support penalty), every chosen line yards at least a share m of its own band that
 * no earlier choice yards, and the run stops once the union reaches the target share of the
 * coverable area. This is the maximal covering location problem (Church & ReVelle 1974) with a
 * cardinality limit; with costs it is budgeted maximum coverage (Khuller, Moss & Naor 1999).
 *
 * Method. Greedy: repeatedly take the line with the most new area per unit cost, ties to fewer
 * supports, then the shorter mean carriage distance, then the lower id. With p = 0 and no share
 * rule this is the classic greedy, within (1 − 1/e) of the best K lines (Nemhauser, Wolsey &
 * Fisher 1978). New area only falls as lines are chosen (coverage is submodular), so gains are
 * recomputed lazily (Minoux 1978): a line is re-scored only when it reaches the top of the queue.
 * A final pass drops any chosen line whose band is covered, all but `MIN_UNIQUE_SHARE` of it, by
 * the others, least unique first.
 *
 * This is PGMaps' own design, not Sylvaccess's selection: it has no criteria score or overlap
 * count, and it never keeps a line that adds less than the share rule.
 *
 * Volume (optional, off by default). Given cell weights in m³ (`cableVolume.ts`), a line's gain is
 * the volume of the ground no chosen line yards rather than its area, so a line through heavier
 * timber wins over one through light timber of the same area. The new-share rule, the target and
 * the final pass stay on area. Cells with no volume weigh the mean of the known ones, and the
 * volume reported for a line counts known volume only, with the unknown area beside it.
 *
 * Pure: no DOM or network access.
 */
import { forBandCells, cableYardable, type CableLineRecord } from './cableCoverage'
import type { ExtractionGrid } from './extractionReach'
import type { CableLanding } from './cableCoverage'
import type { VolumeWeights } from './cableVolume'

export interface CableSelectionRule {
  /** Most lines chosen. */
  maxLines: number
  /** Share of a line's own band that must be new when it is chosen. */
  minNewShare: number
  /** Extra cost per intermediate support, as a share of a line without supports. */
  supportPenalty: number
  /** Stop once this share of the coverable area is yarded. */
  targetShare: number
}

export const DEFAULT_CABLE_SELECTION: CableSelectionRule = {
  maxLines: 30,
  minNewShare: 0.3,
  supportPenalty: 0.25,
  targetShare: 0.95,
}
export const CABLE_SELECTION_LIMITS: Record<keyof CableSelectionRule, readonly [number, number]> = {
  maxLines: [1, 200],
  minNewShare: [0.05, 1],
  supportPenalty: [0, 5],
  targetShare: [0.1, 1],
}
/** A chosen line that yards less than this share of its band alone is dropped at the end. */
export const MIN_UNIQUE_SHARE = 0.1

export interface CableSelection {
  /** Chosen line ids, in the order chosen. */
  ids: number[]
  /** Block area the chosen lines yard, ha, and its share of what all feasible lines yard. */
  coveredHa: number
  shareOfFeasible: number
  /** Share of the block's coverable (known, fellable, open) area. */
  shareOfCoverable: number
  stopped: 'target' | 'max-lines' | 'no-gain'
  /** Lines dropped by the final pass. */
  dropped: number
  /** With volume weighting: the chosen lines' known volume, and per line. */
  volume: SelectionVolume | null
}

export interface SelectionVolume {
  source: string
  /** Known volume the chosen lines yard together, m³, and the chosen ground with no volume, ha. */
  knownM3: number
  unknownHa: number
  /** Per chosen line: known volume in its band, m³, and its band's ground with no volume, ha. */
  lines: Record<number, { knownM3: number; unknownHa: number }>
}

export function validateSelectionRule(rule: CableSelectionRule): CableSelectionRule {
  for (const key of Object.keys(CABLE_SELECTION_LIMITS) as (keyof CableSelectionRule)[]) {
    const [low, high] = CABLE_SELECTION_LIMITS[key]
    const v = rule[key]
    if (!Number.isFinite(v) || v < low || v > high)
      throw Error(`Line selection: ${key} must be from ${low} to ${high}.`)
  }
  return rule
}

class MaxHeap<T> {
  private items: { key: number[]; value: T }[] = []
  private static less(a: number[], b: number[]) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
    return false
  }
  get size() {
    return this.items.length
  }
  push(key: number[], value: T) {
    const h = this.items
    h.push({ key, value })
    let i = h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!MaxHeap.less(h[p].key, h[i].key)) break
      ;[h[p], h[i]] = [h[i], h[p]]
      i = p
    }
  }
  peekKey() {
    return this.items[0]?.key
  }
  pop() {
    const h = this.items
    const top = h[0]
    const last = h.pop()!
    if (h.length) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1
        let m = i
        if (l < h.length && MaxHeap.less(h[m].key, h[l].key)) m = l
        if (r < h.length && MaxHeap.less(h[m].key, h[r].key)) m = r
        if (m === i) break
        ;[h[m], h[i]] = [h[i], h[m]]
        i = m
      }
    }
    return top
  }
}

/** Chooses lines by the greedy maximum-coverage rule above. */
export function selectCableLines(
  eg: ExtractionGrid,
  landings: readonly CableLanding[],
  lines: readonly CableLineRecord[],
  lateralM: number,
  rule: CableSelectionRule,
  /** Weight new ground by volume (`cableVolume.ts`); area alone when absent. */
  volume?: VolumeWeights | null,
): CableSelection {
  validateSelectionRule(rule)
  if (volume && volume.m3.length !== eg.sg.grid.values.length) throw Error('The volume was read on another grid.')
  const n = eg.sg.grid.values.length
  const cellHa = (eg.sg.grid.cellM * eg.sg.grid.cellM) / 10_000
  const yardable = cableYardable(eg)
  let coverable = 0
  for (let i = 0; i < n; i++) coverable += yardable[i]
  const cellsOf = (line: CableLineRecord) => {
    const out: number[] = []
    forBandCells(eg, landings[line.landing].xy, line.bearingDeg, line.horizontalM, lateralM, (i) => {
      if (yardable[i]) out.push(i)
    })
    return out
  }
  const union = new Uint8Array(n)
  let feasible = 0
  for (const line of lines)
    for (const i of cellsOf(line))
      if (!union[i]) {
        union[i] = 1
        feasible++
      }
  const count = new Uint16Array(n)
  let covered = 0
  const cost = (line: CableLineRecord) => 1 + rule.supportPenalty * (line.points.length - 2)
  const key = (line: CableLineRecord, fresh: number) => [
    fresh / cost(line),
    -(line.points.length - 2),
    -line.meanCarriageM,
    -line.id,
  ]
  const gainOf = (cells: readonly number[]) => {
    let fresh = 0,
      gain = 0
    for (const i of cells)
      if (!count[i]) {
        fresh++
        gain += volume ? volume.m3[i] : 1
      }
    return { fresh, gain }
  }
  const heap = new MaxHeap<CableLineRecord>()
  for (const line of lines) if (line.cells) heap.push(key(line, volume ? gainOf(cellsOf(line)).gain : line.cells), line)
  const chosen: CableLineRecord[] = []
  const chosenCells = new Map<number, number[]>()
  let stopped: CableSelection['stopped'] = 'no-gain'
  while (heap.size) {
    if (chosen.length >= rule.maxLines) {
      stopped = 'max-lines'
      break
    }
    if (coverable && covered / coverable >= rule.targetShare - 1e-12) {
      stopped = 'target'
      break
    }
    const { key: stale, value: line } = heap.pop()
    const cells = cellsOf(line)
    const { fresh, gain } = gainOf(cells)
    if (!fresh || fresh < rule.minNewShare * cells.length - 1e-9) continue
    const now = key(line, gain)
    const next = heap.peekKey()
    // Re-queue unless the refreshed gain still leads (gains only fall).
    if (now[0] < stale[0] - 1e-12 && next && next[0] > now[0] + 1e-12) {
      heap.push(now, line)
      continue
    }
    chosen.push(line)
    chosenCells.set(line.id, cells)
    for (const i of cells) if (count[i]++ === 0) covered++
  }
  // Drop lines the others cover almost wholly, least unique first.
  let dropped = 0
  for (;;) {
    let worst: { line: CableLineRecord; share: number } | null = null
    for (const line of chosen) {
      const cells = chosenCells.get(line.id)!
      let unique = 0
      for (const i of cells) if (count[i] === 1) unique++
      const share = cells.length ? unique / cells.length : 0
      if (share < MIN_UNIQUE_SHARE && (!worst || share < worst.share)) worst = { line, share }
    }
    if (!worst) break
    chosen.splice(chosen.indexOf(worst.line), 1)
    for (const i of chosenCells.get(worst.line.id)!) if (--count[i] === 0) covered--
    dropped++
  }
  let selectionVolume: SelectionVolume | null = null
  if (volume) {
    const known = (i: number) => volume.known[i] === 1
    let knownM3 = 0,
      unknownCells = 0
    for (let i = 0; i < n; i++)
      if (count[i]) {
        if (known(i)) knownM3 += volume.m3[i]
        else unknownCells++
      }
    const perLine: SelectionVolume['lines'] = {}
    for (const line of chosen) {
      let m3 = 0,
        unknown = 0
      for (const i of chosenCells.get(line.id)!)
        if (known(i)) m3 += volume.m3[i]
        else unknown++
      perLine[line.id] = { knownM3: m3, unknownHa: unknown * cellHa }
    }
    selectionVolume = { source: volume.source, knownM3, unknownHa: unknownCells * cellHa, lines: perLine }
  }
  return {
    volume: selectionVolume,
    ids: chosen.map((l) => l.id),
    coveredHa: covered * cellHa,
    shareOfFeasible: feasible ? covered / feasible : 0,
    shareOfCoverable: coverable ? covered / coverable : 0,
    stopped,
    dropped,
  }
}
