/**
 * Reconnects roads found on the terrain one at a time (`roadRelocation.ts`) into the network their
 * records formed. Each road is searched on its own, between its own end caps, so two roads that
 * met in the record end a few metres apart once found; this module joins them again, and only
 * them.
 *
 * Only junctions the record has are rebuilt: record ends within ROAD_RECORD_NODE_M of each other
 * (a node), or a record end on another record's line (a mid-road junction). Ends the record did not
 * join are never joined, however close they come; ends within ROAD_NEAR_MISS_M of another road are
 * listed instead, for review.
 *
 * At a node the **through pair** is the two roads whose record headings are closest to straight;
 * pairs within ROAD_THROUGH_TIE_DEG of the straightest rank by lower state class sum (no class counts
 * as 5), then higher state score sum, then higher found share. Two roads meet at the midpoint of
 * their found ends. With more, the through pair is joined at that midpoint, each other road is
 * extended along its end heading to cross it, and the junction goes at the mean crossing distance
 * along it. A loop's two ends and one other road all meet at the through pair's midpoint. No end
 * moves further than the tolerance: past it the node is left as found and a warning names it.
 * A road without a candidate (not found, or not chosen) keeps its record line and never moves:
 * where it is half of the through pair the others join its record end; otherwise it is reported if
 * the junction moved away from it.
 *
 * Follows the endpoint reconnection described for ALSroads 0.2.0 and the topologically valid
 * networks of Roussel, Bourdon, Morley, Coops & Achim (2023), "Vectorial and topologically valid
 * segmentation of forestry road networks from ALS data", IJAEOG 118, 103267
 * (doi:10.1016/j.jag.2023.103267). Written from a functional specification of ALSroads 0.2.0;
 * no code from ALSroads (GPL-3) was used. Differences from that description, on purpose: every end
 * of the "other" roads is held to the tolerance too (the description checked only the distance along
 * the through road, so a road nearly parallel to it could be stretched far), a road without a
 * candidate never moves, a record end on another road's line is reconnected, and ends are never
 * clustered by distance alone. Pure: no DOM or network access.
 */
import { cumulativeLength, nearestOnLine, pointAlong, subLine, type XY } from './roadGrid'

/** Default largest distance an end may move to rebuild a junction, m. */
export const ROAD_RECONNECT_TOLERANCE_M = 30
export const ROAD_RECONNECT_TOLERANCE_LIMITS: readonly [number, number] = [1, 50]
/** Record ends this close are one junction of the record, m. */
export const ROAD_RECORD_NODE_M = 1
/** Pairs this close to the straightest pair are equally straight, degrees. */
export const ROAD_THROUGH_TIE_DEG = 7.5
/** An end's heading is read along this much of its line, m. */
export const ROAD_END_HEADING_M = 20
/** Free found ends this close to another road are listed as possible junctions the record lacks, m. */
export const ROAD_NEAR_MISS_M = 8
/** A road with no state class counts as this in the through-pair ranking. */
const NO_CLASS_RANK = 5
/** A junction this close to an end of the through road would leave a piece of no length, m. */
const MIN_PIECE_M = 0.5

export type RoadEnd = 'start' | 'end'

export interface ReconnectRoad {
  id: string
  name: string
  /** The record's own line, projected metres. */
  record: XY[]
  /** The found line to reconnect; null keeps the record's line, which never moves. */
  candidate: XY[] | null
  stateClass?: number | null
  score?: number | null
  foundShare?: number | null
}

export interface ReconnectOptions {
  toleranceM?: number
}

export interface ReconnectEnd {
  roadId: string
  end: RoadEnd
}

export interface ReconnectJunction {
  kind: 'node' | 'mid-road'
  /** Where the record joins the roads. */
  recordAt: XY
  /** Where the reconnected roads meet; null when nothing was moved. */
  at: XY | null
  ends: ReconnectEnd[]
  /** Mid-road junctions: the road whose line the end joins. It is not split. */
  onRoadId?: string
  throughPair?: [ReconnectEnd, ReconnectEnd]
  /** joined: every road meets again. partial: the found roads meet, a kept record does not. not-joined: left as found. */
  status: 'joined' | 'partial' | 'not-joined'
  /** The furthest any end moved, m. */
  movedM: number
  /** How far the junction is from the record's, m; null when not joined. */
  shiftM: number | null
  message: string
}

export interface ReconnectNearMiss {
  end: ReconnectEnd
  nearRoadId: string
  distanceM: number
  at: XY
}

export interface ReconnectResult {
  /** The reconnected line of every road that had a candidate, by id. */
  lines: Record<string, XY[]>
  /** Ends moved to rebuild a junction, by road id (0–2). */
  movedEnds: Record<string, number>
  junctions: ReconnectJunction[]
  nearMisses: ReconnectNearMiss[]
  toleranceM: number
}

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1])
const mid = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const mean = (ps: readonly XY[]): XY => [
  ps.reduce((s, p) => s + p[0], 0) / ps.length,
  ps.reduce((s, p) => s + p[1], 0) / ps.length,
]
const withoutRepeats = (line: readonly XY[]) => line.filter((p, i) => i === 0 || dist(p, line[i - 1]) > 1e-9)
const endPoint = (line: readonly XY[], end: RoadEnd): XY => (end === 'start' ? line[0] : line.at(-1)!)
/** The line run so that `end` is its last point. */
const toEnd = (line: readonly XY[], end: RoadEnd): XY[] => (end === 'end' ? line.slice() : line.slice().reverse())
const fromEnd = (oriented: XY[], end: RoadEnd): XY[] => (end === 'end' ? oriented : oriented.slice().reverse())

/** Unit vector from the end into the road, read over ROAD_END_HEADING_M (or half a short line). */
function inwardHeading(line: readonly XY[], end: RoadEnd): XY {
  const oriented = toEnd(line, end)
  const cum = cumulativeLength(oriented)
  const total = cum.at(-1) ?? 0
  const e = oriented.at(-1)!
  const back = pointAlong(oriented, cum, total - Math.min(ROAD_END_HEADING_M, total / 2)).at
  const len = dist(back, e) || 1
  return [(back[0] - e[0]) / len, (back[1] - e[1]) / len]
}

const angleDeg = (a: XY, b: XY) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180) / Math.PI

/**
 * The oriented line (ending at the end being moved) trimmed or extended so that it ends at
 * `target`: cut at the point of its last `reachM` nearest to the target, then the target added.
 */
function endAt(oriented: XY[], target: XY, reachM: number): XY[] {
  const cum = cumulativeLength(oriented)
  const total = cum.at(-1) ?? 0
  const from = Math.max(0, total - reachM)
  const tail = subLine(oriented, cum, from, total)
  const cut = from + nearestOnLine(tail, cumulativeLength(tail), target).chainage
  const kept = cut < total - 1e-6 ? subLine(oriented, cum, 0, cut) : oriented.slice()
  if (dist(kept.at(-1)!, target) > 1e-6) kept.push([target[0], target[1]])
  return kept.length >= 2 ? kept : [kept[0], [target[0], target[1]]]
}

/** Where segment p–q crosses the polyline: the point and its chainage along the polyline. */
function crossings(line: readonly XY[], cum: readonly number[], p: XY, q: XY): { at: XY; chainage: number }[] {
  const out: { at: XY; chainage: number }[] = []
  const rx = q[0] - p[0],
    ry = q[1] - p[1]
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i]
    const sx = b[0] - a[0],
      sy = b[1] - a[1]
    const den = rx * sy - ry * sx
    if (Math.abs(den) < 1e-12) continue
    const t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den
    const u = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue
    out.push({ at: [p[0] + t * rx, p[1] + t * ry], chainage: cum[i - 1] + u * Math.hypot(sx, sy) })
  }
  return out
}

/**
 * Where an oriented road (ending at its found end) meets `target`: along its last `reachM` or the
 * extension of its end heading by `extendM`. Every crossing, with its chainage along `target`.
 */
function meetings(oriented: XY[], target: readonly XY[], reachM: number, extendM: number) {
  const tcum = cumulativeLength(target)
  const cum = cumulativeLength(oriented)
  const total = cum.at(-1) ?? 0
  const tail = subLine(oriented, cum, Math.max(0, total - reachM), total)
  const e = oriented.at(-1)!
  const h = inwardHeading(oriented, 'end')
  const ray: XY = [e[0] - h[0] * extendM, e[1] - h[1] * extendM]
  const out: { at: XY; chainage: number }[] = []
  for (let i = 1; i < tail.length; i++) out.push(...crossings(target, tcum, tail[i - 1], tail[i]))
  out.push(...crossings(target, tcum, e, ray))
  return out
}

interface EndRef extends ReconnectEnd {
  road: number
}

/** Single-link clusters of points within `radius`. */
function clusters(points: readonly XY[], radius: number): number[][] {
  const parent = points.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) if (dist(points[i], points[j]) <= radius) parent[find(j)] = find(i)
  const groups = new Map<number, number[]>()
  points.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]))
  return [...groups.values()]
}

/** Rebuilds the record's junctions between found roads. See the module comment. */
export function reconnectRoads(roads: readonly ReconnectRoad[], options: ReconnectOptions = {}): ReconnectResult {
  const [tMin, tMax] = ROAD_RECONNECT_TOLERANCE_LIMITS
  const tol = Math.min(tMax, Math.max(tMin, options.toleranceM ?? ROAD_RECONNECT_TOLERANCE_M))
  const valid = roads.map((r) => r.record.length >= 2)
  const lines: XY[][] = roads.map((r) => (r.candidate && r.candidate.length >= 2 ? r.candidate : r.record).slice())
  const movable = roads.map((r, i) => valid[i] && !!r.candidate && r.candidate.length >= 2)
  const moved = roads.map(() => 0)
  const junctions: ReconnectJunction[] = []
  const nameOf = (i: number) => roads[i].name
  const ref = (road: number, end: RoadEnd): EndRef => ({ road, roadId: roads[road].id, end })
  const plain = (e: EndRef): ReconnectEnd => ({ roadId: e.roadId, end: e.end })
  const current = (e: EndRef) => endPoint(lines[e.road], e.end)
  const recordEnd = (e: EndRef) => endPoint(roads[e.road].record, e.end)
  const setEnd = (e: EndRef, target: XY, reachM = tol) => {
    lines[e.road] = fromEnd(endAt(toEnd(lines[e.road], e.end), target, reachM), e.end)
    moved[e.road]++
  }

  // The record's junctions: clusters of record ends, then ends on another record's line.
  const ends: EndRef[] = []
  roads.forEach((_, i) => {
    if (valid[i]) ends.push(ref(i, 'start'), ref(i, 'end'))
  })
  const nodes = clusters(ends.map(recordEnd), ROAD_RECORD_NODE_M)
    .filter((g) => g.length >= 2)
    .map((g) => g.map((k) => ends[k]))
  const atNode = new Set(nodes.flatMap((n) => n.map((e) => `${e.road}:${e.end}`)))
  const attachments: { end: EndRef; on: number }[] = []
  for (const e of ends) {
    if (atNode.has(`${e.road}:${e.end}`)) continue
    const p = recordEnd(e)
    for (let t = 0; t < roads.length; t++) {
      if (t === e.road || !valid[t]) continue
      const rec = roads[t].record
      const near = nearestOnLine(rec, cumulativeLength(rec), p)
      if (near.distance <= ROAD_RECORD_NODE_M) {
        attachments.push({ end: e, on: t })
        break
      }
    }
  }

  const rank = (pair: [EndRef, EndRef]) => {
    const cls = pair.reduce((s, e) => s + (roads[e.road].stateClass || NO_CLASS_RANK), 0)
    const score = pair.reduce((s, e) => s + (roads[e.road].score ?? 0), 0)
    const found = pair.reduce((s, e) => s + (roads[e.road].foundShare ?? 0), 0)
    return { cls, score, found }
  }
  /** The two ends whose record headings are closest to straight, ties broken by class, score and found share. */
  const throughPair = (node: EndRef[]): [EndRef, EndRef] => {
    const headings = node.map((e) => inwardHeading(roads[e.road].record, e.end))
    const pairs: { pair: [EndRef, EndRef]; bend: number; order: number }[] = []
    for (let i = 0; i < node.length; i++)
      for (let j = i + 1; j < node.length; j++)
        pairs.push({ pair: [node[i], node[j]], bend: 180 - angleDeg(headings[i], headings[j]), order: pairs.length })
    const straightest = Math.min(...pairs.map((p) => p.bend))
    const tied = pairs.filter((p) => p.bend <= straightest + ROAD_THROUGH_TIE_DEG)
    tied.sort((a, b) => {
      const ra = rank(a.pair),
        rb = rank(b.pair)
      return ra.cls - rb.cls || rb.score - ra.score || rb.found - ra.found || a.bend - b.bend || a.order - b.order
    })
    return tied[0].pair
  }
  const label = (es: readonly EndRef[]) => [...new Set(es.map((e) => nameOf(e.road)))].join(', ')
  const m = (v: number) => `${v.toFixed(1)} m`

  for (const node of nodes) {
    const free = node.filter((e) => movable[e.road])
    if (!free.length) continue
    const recordAt = mean(node.map(recordEnd))
    const before = node.map(current)
    const fixed = node.filter((e) => !movable[e.road])
    const roadCount = new Map<number, number>()
    for (const e of node) roadCount.set(e.road, (roadCount.get(e.road) ?? 0) + 1)
    const loops = [...roadCount.values()].filter((k) => k > 1).length
    const base = { kind: 'node' as const, recordAt, ends: node.map(plain) }
    const leave = (message: string, throughPair?: [EndRef, EndRef]) =>
      junctions.push({
        ...base,
        at: null,
        status: 'not-joined',
        movedM: 0,
        shiftM: null,
        message,
        ...(throughPair ? { throughPair: [plain(throughPair[0]), plain(throughPair[1])] } : {}),
      })
    if (loops > 1 || (loops === 1 && node.length > 3)) {
      leave(`A loop meets ${node.length - 2} other road ends here (${label(node)}); this junction is left as found.`)
      continue
    }
    const pair = throughPair(node)
    const finish = (at: XY, status: ReconnectJunction['status'], message: string) => {
      const movedM = Math.max(0, ...node.map((e, k) => dist(before[k], current(e))))
      junctions.push({
        ...base,
        at,
        status,
        movedM,
        shiftM: dist(at, recordAt),
        message,
        throughPair: [plain(pair[0]), plain(pair[1])],
      })
    }
    // A kept record in the through pair holds the junction where the record has it.
    if (fixed.length && pair.some((e) => !movable[e.road])) {
      const anchor = mean(fixed.map(recordEnd))
      const far = free.filter((e) => dist(current(e), anchor) > tol)
      if (far.length) {
        leave(
          `${label(far)} ended ${m(Math.max(...far.map((e) => dist(current(e), anchor))))} from where the record meets ${label(fixed)}, which is kept as mapped; past the ${tol} m tolerance, so this junction is left as found.`,
          pair,
        )
        continue
      }
      for (const e of free) setEnd(e, anchor)
      finish(anchor, 'joined', `Joined to ${label(fixed)}, kept as mapped, where the record meets it.`)
      continue
    }
    // The found roads meet among themselves; a kept record elsewhere at the node is reported.
    const a = pair[0],
      b = pair[1]
    const gap = dist(current(a), current(b))
    if (gap / 2 > tol) {
      leave(
        `The through roads (${label(pair)}) ended ${m(gap)} apart: half of that is past the ${tol} m tolerance, so this junction is left as found.`,
        pair,
      )
      continue
    }
    const midpoint = mid(current(a), current(b))
    const others = free.filter((e) => e !== a && e !== b)
    let at: XY
    if (loops === 1 && a.road === b.road && others.length === 1) {
      // A loop and the road into it: the loop is closed at its ends' midpoint, then opened again
      // where the other road crosses it, so the junction is where the roads meet on the ground.
      const [o] = others
      const own = current(o)
      const saved = { line: lines[a.road], moved: moved[a.road] }
      setEnd(a, midpoint)
      setEnd(b, midpoint)
      const ring = lines[a.road]
      const rcum = cumulativeLength(ring)
      const total = rcum.at(-1) ?? 0
      const around = (s: number) => Math.min(s, total - s)
      const hits = meetings(toEnd(lines[o.road], o.end), ring, tol, tol + dist(own, midpoint))
      const best = hits.length ? hits.reduce((p, q) => (around(q.chainage) < around(p.chainage) ? q : p)) : null
      const problem = !best
        ? `${nameOf(o.road)} does not reach the loop within ${tol} m`
        : around(best.chainage) > tol
          ? `${nameOf(o.road)} meets the loop ${m(around(best.chainage))} from where its ends meet, past the ${tol} m tolerance`
          : dist(best.at, own) > tol
            ? `${nameOf(o.road)} would have to move ${m(dist(best.at, own))} to meet the loop, past the ${tol} m tolerance`
            : ''
      if (problem) {
        lines[a.road] = saved.line
        moved[a.road] = saved.moved
        leave(`${problem}; this junction is left as found.`, pair)
        continue
      }
      at = best!.at
      lines[a.road] = withoutRepeats([
        ...subLine(ring, rcum, best!.chainage, total),
        ...subLine(ring, rcum, 0, best!.chainage),
      ])
      setEnd(o, at)
    } else if (loops === 1 || !others.length) {
      // Two roads, or a loop with no other found road: every found end meets at the through pair's midpoint.
      const far = others.filter((e) => dist(current(e), midpoint) > tol)
      if (far.length) {
        leave(`${label(far)} ended more than ${tol} m from the through roads' meeting point; left as found.`, pair)
        continue
      }
      for (const e of free) setEnd(e, midpoint)
      at = midpoint
    } else {
      // The through pair joined at its midpoint, then every other road brought to cross it.
      const aLine = endAt(toEnd(lines[a.road], a.end), midpoint, tol)
      const bLine = endAt(toEnd(lines[b.road], b.end), midpoint, tol)
      const through = [...aLine, ...bLine.slice(0, -1).reverse()]
      const tcum = cumulativeLength(through)
      const total = tcum.at(-1) ?? 0
      const sMid = cumulativeLength(aLine).at(-1) ?? 0
      const reached: { e: EndRef; at: XY; s: number }[] = []
      let problem = ''
      for (const e of others) {
        const oriented = toEnd(lines[e.road], e.end)
        const own = current(e)
        const hits = meetings(oriented, through, tol, tol + dist(own, midpoint))
        if (!hits.length) {
          problem = `${nameOf(e.road)} does not reach the through road (${label(pair)}) within ${tol} m`
          break
        }
        const best = hits.reduce((p, q) => (Math.abs(q.chainage - sMid) < Math.abs(p.chainage - sMid) ? q : p))
        if (Math.abs(best.chainage - sMid) > tol) {
          problem = `${nameOf(e.road)} meets the through road ${m(Math.abs(best.chainage - sMid))} from where its two halves meet, past the ${tol} m tolerance`
          break
        }
        if (dist(best.at, own) > tol) {
          problem = `${nameOf(e.road)} would have to move ${m(dist(best.at, own))} to meet the through road, past the ${tol} m tolerance`
          break
        }
        reached.push({ e, at: best.at, s: best.chainage })
      }
      const sJ = reached.length ? reached.reduce((s, r) => s + r.s, 0) / reached.length : sMid
      if (!problem && (sJ < MIN_PIECE_M || sJ > total - MIN_PIECE_M))
        problem = `The junction would fall at an end of the through road (${label(pair)})`
      if (problem) {
        leave(`${problem}; this junction is left as found.`, pair)
        continue
      }
      at = pointAlong(through, tcum, sJ).at
      const aNew = subLine(through, tcum, 0, sJ)
      const bNew = subLine(through, tcum, sJ, total).reverse()
      lines[a.road] = fromEnd(aNew, a.end)
      lines[b.road] = fromEnd(bNew, b.end)
      moved[a.road]++
      moved[b.road]++
      for (const r of reached) {
        // Cut where it crosses (if it already runs past), then on to the junction.
        const oriented = endAt(toEnd(lines[r.e.road], r.e.end), r.at, tol)
        lines[r.e.road] = fromEnd(endAt(oriented, at, tol), r.e.end)
        moved[r.e.road]++
      }
    }
    const away = fixed.filter((e) => dist(recordEnd(e), at) > ROAD_RECORD_NODE_M)
    if (away.length)
      finish(
        at,
        'partial',
        `The found roads meet again; ${label(away)}, kept as mapped, ends ${m(Math.max(...away.map((e) => dist(recordEnd(e), at))))} from them and is not joined.`,
      )
    else
      finish(
        at,
        'joined',
        a.road === b.road
          ? node.length > 2
            ? `${nameOf(a.road)} closed where ${label(node.filter((e) => e.road !== a.road))} meets it.`
            : `${nameOf(a.road)} closed at its ends' midpoint.`
          : node.length > 2
            ? `Rebuilt with ${label(pair)} as the through road.`
            : 'Ends joined at their midpoint.',
      )
  }

  for (const { end: e, on } of attachments) {
    if (!movable[e.road] && !movable[on]) continue
    const recordAt = recordEnd(e)
    const base = { kind: 'mid-road' as const, recordAt, ends: [plain(e)], onRoadId: roads[on].id }
    const target = lines[on]
    if (!movable[e.road]) {
      const gap = nearestOnLine(target, cumulativeLength(target), recordAt).distance
      junctions.push({
        ...base,
        at: null,
        status: gap > ROAD_RECORD_NODE_M ? 'partial' : 'joined',
        movedM: 0,
        shiftM: null,
        message:
          gap > ROAD_RECORD_NODE_M
            ? `${nameOf(e.road)}, kept as mapped, ends ${m(gap)} from the found ${nameOf(on)} and is not joined.`
            : `${nameOf(e.road)}, kept as mapped, still meets the found ${nameOf(on)}.`,
      })
      continue
    }
    const own = current(e)
    const hits = meetings(toEnd(lines[e.road], e.end), target, tol, tol)
    const tcum = cumulativeLength(target)
    const nearest = nearestOnLine(target, tcum, own)
    const best = hits.length
      ? hits.reduce((p, q) => (dist(q.at, own) < dist(p.at, own) ? q : p))
      : { at: nearest.at, chainage: nearest.chainage }
    const moveM = dist(best.at, own)
    if (moveM > tol) {
      junctions.push({
        ...base,
        at: null,
        status: 'not-joined',
        movedM: 0,
        shiftM: null,
        message: `${nameOf(e.road)} ended ${m(moveM)} from ${nameOf(on)}, past the ${tol} m tolerance; left as found.`,
      })
      continue
    }
    setEnd(e, best.at)
    junctions.push({
      ...base,
      at: best.at,
      status: 'joined',
      movedM: moveM,
      shiftM: dist(best.at, recordAt),
      message: `Joined to ${movable[on] ? 'the found' : 'the mapped'} ${nameOf(on)} mid-road; ${nameOf(on)} is not split there.`,
    })
  }

  // Found ends the record leaves free, close to another road: listed, never joined.
  const joinedEnds = new Set([...atNode, ...attachments.map((a) => `${a.end.road}:${a.end.end}`)])
  const nearMisses: ReconnectNearMiss[] = []
  for (const e of ends) {
    if (!movable[e.road] || joinedEnds.has(`${e.road}:${e.end}`)) continue
    const p = current(e)
    let best: ReconnectNearMiss | null = null
    for (let t = 0; t < roads.length; t++) {
      if (t === e.road || !valid[t]) continue
      const near = nearestOnLine(lines[t], cumulativeLength(lines[t]), p)
      if (near.distance <= ROAD_NEAR_MISS_M && (!best || near.distance < best.distanceM))
        best = { end: plain(e), nearRoadId: roads[t].id, distanceM: near.distance, at: near.at }
    }
    if (best) nearMisses.push(best)
  }

  const out: Record<string, XY[]> = {}
  const movedEnds: Record<string, number> = {}
  roads.forEach((r, i) => {
    if (!movable[i]) return
    out[r.id] = lines[i]
    movedEnds[r.id] = Math.min(2, moved[i])
  })
  return { lines: out, movedEnds, junctions, nearMisses, toleranceM: tol }
}
