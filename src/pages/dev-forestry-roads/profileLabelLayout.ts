/**
 * What the road profile has room to show: where ground grades break, which crossings share a
 * tick, and which labels fit without covering each other. The chart gives this module pixel
 * positions and draws what comes back. Pure: no DOM, network or terrain access.
 */

/** About one ground-grade piece per this many pixels of plot. */
export const GROUND_GRADE_PIECE_PX = 110
/** No ground-grade piece narrower than this on screen, so its label has room. */
export const GROUND_GRADE_MIN_PIECE_PX = 50
/** Most ground-grade pieces on one road, however far it is zoomed. */
export const GROUND_GRADE_MAX_PIECES = 64
/** A ground bend smaller than this off the piece's chord does not break the grade (m). */
export const GROUND_GRADE_BEND_M = 0.5
/** Crossings closer than this on screen share one tick. */
export const CROSSING_CLUSTER_PX = 6
/** A junction's level difference prints only from this size up (m); the tooltip always has it. */
export const JUNCTION_LEVEL_SHOWN_M = 0.05

/** Stations closer than this are the same station; stored chainages are rounded to 1e-5 m. */
export const STATION_MATCH_M = 1e-4

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/**
 * Ground-grade pieces for the whole road at the current zoom: about one per `GROUND_GRADE_PIECE_PX`
 * of the visible plot, scaled to the whole road so the breaks hold still while panning.
 */
export function groundGradePieceCount(roadLengthM: number, visibleSpanM: number, plotWidthPx: number) {
  if (!(roadLengthM > 0) || !(visibleSpanM > 0) || !(plotWidthPx > 0)) return 1
  const onScreen = plotWidthPx / GROUND_GRADE_PIECE_PX
  return Math.max(1, Math.min(GROUND_GRADE_MAX_PIECES, Math.round((onScreen * roadLengthM) / visibleSpanM)))
}

interface GroundStation {
  chainage: number
  groundElevation: number | null
}

/**
 * Stations that split the road into at most `pieces` ground-grade pieces, from 0 to `length`.
 * Each split goes where the ground bends furthest from its piece's straight chord, the largest
 * bend first, until no bend reaches `GROUND_GRADE_BEND_M` or no piece is long enough to split:
 * straight ground keeps one long piece instead of being cut into equal lengths. A piece holding
 * a terrain gap splits at the gap's edge, so known ground keeps its own grade and the gap reads
 * unknown on its own. No piece is shorter than `minPieceM`.
 */
export function groundGradeBreaks(
  stations: readonly GroundStation[],
  length: number,
  pieces: number,
  minPieceM: number,
): number[] {
  if (!(length > 0)) return [0, Math.max(0, length)]
  const sorted = stations.filter((s) => finite(s.chainage)).sort((a, b) => a.chainage - b.chainage)
  const chainages = sorted.map((s) => s.chainage)
  const known = sorted.map((s) => finite(s.groundElevation))
  /** First index whose chainage is greater than `value` (+ a hair). */
  const after = (value: number) => {
    let low = 0,
      high = chainages.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (chainages[mid] <= value + 1e-7) low = mid + 1
      else high = mid
    }
    return low
  }
  const groundAt = (target: number): number | null => {
    const j = after(target)
    // Stations are stored to 1e-5 m, so a road end can sit a hair past its last station.
    const exact = [sorted[j - 1], sorted[j]].find((s) => s && Math.abs(s.chainage - target) < STATION_MATCH_M)
    if (exact) return finite(exact.groundElevation) ? exact.groundElevation : null
    const a = sorted[j - 1],
      b = sorted[j]
    if (!a || !b || !finite(a.groundElevation) || !finite(b.groundElevation)) return null
    return (
      a.groundElevation + ((b.groundElevation - a.groundElevation) * (target - a.chainage)) / (b.chainage - a.chainage)
    )
  }
  const minPiece = Math.max(0, minPieceM)
  /** Where `[start, end]` would split, and how strongly; null when it cannot. */
  const bestSplit = (start: number, end: number): { at: number; score: number } | null => {
    if (end - start < 2 * minPiece || end - start < 1e-6) return null
    const first = after(start),
      last = after(end - 1e-6) - 1 // stations strictly inside
    if (first > last) return null
    const a = groundAt(start),
      b = groundAt(end)
    let gap = a === null || b === null
    for (let i = first; !gap && i <= last; i++) gap = !known[i]
    let best: { at: number; score: number } | null = null
    const middle = (start + end) / 2
    for (let i = first; i <= last; i++) {
      const at = chainages[i]
      if (at < start + minPiece || at > end - minPiece) continue
      if (gap) {
        // Split where known ground meets the gap, nearest the piece's middle.
        const edge = (i > 0 && known[i - 1] !== known[i]) || (i + 1 < known.length && known[i + 1] !== known[i])
        if (edge && (!best || Math.abs(at - middle) < Math.abs(best.at - middle)))
          best = { at, score: GROUND_GRADE_BEND_M }
        continue
      }
      const chord = a! + ((b! - a!) * (at - start)) / (end - start)
      const bend = Math.abs(sorted[i].groundElevation! - chord)
      if (!best || bend > best.score) best = { at, score: bend }
    }
    return best
  }
  const spans = [{ start: 0, end: length, split: bestSplit(0, length) }]
  while (spans.length < pieces) {
    let pick = -1
    for (let i = 0; i < spans.length; i++) {
      const split = spans[i].split
      if (split && split.score >= GROUND_GRADE_BEND_M && (pick < 0 || split.score > spans[pick].split!.score)) pick = i
    }
    if (pick < 0) break
    const { start, end, split } = spans[pick]
    spans.splice(
      pick,
      1,
      { start, end: split!.at, split: bestSplit(start, split!.at) },
      { start: split!.at, end, split: bestSplit(split!.at, end) },
    )
  }
  return [0, ...spans.map((span) => span.end)]
}

/** Rough width of a label in the chart's sans-serif face, px. */
export const textWidthPx = (text: string, fontSize: number) => text.length * fontSize * 0.58

export interface LabelBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** The box of text anchored at (x, baseline y) for `anchor`. */
export function textBox(
  x: number,
  y: number,
  text: string,
  fontSize: number,
  anchor: 'start' | 'middle' | 'end' = 'start',
): LabelBox {
  const width = textWidthPx(text, fontSize)
  const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2
  return { left, top: y - fontSize * 0.85, right: left + width, bottom: y + fontSize * 0.3 }
}

/** The upright box around middle-anchored text at (x, baseline y), rotated about that point. */
export function rotatedTextBox(x: number, y: number, text: string, fontSize: number, angleDeg: number): LabelBox {
  const width = textWidthPx(text, fontSize),
    height = fontSize * 1.15
  const angle = (angleDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(angle)),
    sin = Math.abs(Math.sin(angle))
  // The text's centre sits a third of its height above the baseline, rotated with it.
  const lift = fontSize * 0.3
  const cx = x + lift * Math.sin(angle),
    cy = y - lift * Math.cos(angle)
  const halfW = (width * cos + height * sin) / 2,
    halfH = (width * sin + height * cos) / 2
  return { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH }
}

export interface LabelCandidate<T> {
  id: string
  /** Higher places first and wins a contested spot. */
  priority: number
  /** Positions in order of preference; the first that fits is used. */
  options: readonly { box: LabelBox; value: T }[]
}

const overlaps = (a: LabelBox, b: LabelBox, gap: number) =>
  a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap

/**
 * Greedy placement: candidates go in priority order (ties keep their given order), each at its
 * first option that stays inside `bounds` and clears every obstacle and label placed before it.
 * A candidate with no such option is left out; the chart keeps its tooltip, so hover still reads it.
 */
export function placeLabels<T>(
  candidates: readonly LabelCandidate<T>[],
  { bounds, obstacles = [], gapPx = 2 }: { bounds: LabelBox; obstacles?: readonly LabelBox[]; gapPx?: number },
): Map<string, T> {
  const order = candidates.map((candidate, index) => ({ candidate, index }))
  order.sort((a, b) => b.candidate.priority - a.candidate.priority || a.index - b.index)
  const taken: LabelBox[] = [...obstacles]
  const placed = new Map<string, T>()
  for (const { candidate } of order) {
    const option = candidate.options.find(
      ({ box }) =>
        box.left >= bounds.left &&
        box.right <= bounds.right &&
        box.top >= bounds.top &&
        box.bottom <= bounds.bottom &&
        !taken.some((other) => overlaps(box, other, gapPx)),
    )
    if (!option) continue
    taken.push(option.box)
    placed.set(candidate.id, option.value)
  }
  return placed
}

/**
 * Items in screen order, grouped where each lies within `px` of the group's first item, so a
 * cluster never grows wider than `px` however many it holds.
 */
export function clusterByPixels<T>(items: readonly T[], xOf: (item: T) => number, px: number): T[][] {
  const sorted = [...items].sort((a, b) => xOf(a) - xOf(b))
  const groups: T[][] = []
  for (const item of sorted) {
    const group = groups[groups.length - 1]
    if (group && xOf(item) - xOf(group[0]) < px) group.push(item)
    else groups.push([item])
  }
  return groups
}

/**
 * A junction's label names, longest first. "as mapped" says where the other road came from, not
 * which road it is, so labels drop it (the tooltip keeps the full name); the shortest form is the
 * road's last name part, such as "B4" of "R01860 · B4".
 */
export function junctionLabelNames(otherRoadName: string): string[] {
  const name = otherRoadName.replace(/\s*·\s*as mapped$/i, '').trim() || otherRoadName
  const parts = name.split(' · ')
  const names = [name]
  if (parts.length > 1) names.push(parts[parts.length - 1])
  return names.filter((value, index) => names.indexOf(value) === index)
}

/** Whether a junction's level difference is worth printing beside its name. */
export const junctionDifferenceShown = (difference: number | null) =>
  difference !== null && Math.abs(difference) >= JUNCTION_LEVEL_SHOWN_M
