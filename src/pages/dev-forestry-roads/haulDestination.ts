/**
 * Haul to a destination: which way a loaded truck leaves a junction, how far it drives, and the cycle
 * time that distance gives at the entered speeds. The route runs over the roads loaded in the project
 * (mapped roads and this project's own roads), and past their edge as a straight line times a detour
 * factor, which is always reported as estimated. A leg whose speed is not entered has no time: it is
 * never counted as zero. No DOM or network access.
 */
import { distance } from './engine'
import type { ContextFeature, Coordinate } from './types'

export const HAUL_ROAD_CLASSES = ['proposed', 'fsr', 'permit', 'mapped', 'off-network'] as const
export type HaulRoadClass = (typeof HAUL_ROAD_CLASSES)[number]
export const HAUL_ROAD_CLASS_LABELS: Record<HaulRoadClass, string> = {
  proposed: 'New road (this project)',
  fsr: 'Forest Service Road',
  permit: 'Road permit road',
  mapped: 'Other mapped road',
  'off-network': 'Beyond the loaded roads (estimated)',
}

/** km/h. Null is "not entered": the legs on that class then have no time. */
export interface HaulSpeed {
  loadedKmh: number | null
  emptyKmh: number | null
}
export type HaulSpeeds = Record<HaulRoadClass, HaulSpeed>
/**
 * Placeholders to be replaced with the operation's own figures. They are not sourced: they only
 * keep the order a field person expects (a new spur slowest, a main FSR fastest, loaded slower than
 * empty), and they are near the speeds the TFL 30 layout study assumed.
 */
export const DEFAULT_HAUL_SPEEDS: HaulSpeeds = {
  proposed: { loadedKmh: 15, emptyKmh: 20 },
  fsr: { loadedKmh: 40, emptyKmh: 50 },
  permit: { loadedKmh: 35, emptyKmh: 45 },
  mapped: { loadedKmh: 30, emptyKmh: 40 },
  'off-network': { loadedKmh: 55, emptyKmh: 65 },
}
/** Minutes per trip spent standing: loading, unloading and any fixed delay. Placeholders. */
export interface HaulTerminalTimes {
  loadMin: number
  unloadMin: number
  delayMin: number
}
export const DEFAULT_HAUL_TERMINAL: HaulTerminalTimes = { loadMin: 30, unloadMin: 20, delayMin: 0 }

/** Road distance past the loaded roads is this multiple of the straight line (TFL 30 study: 1.3–1.6). */
export const DEFAULT_OFF_NETWORK_FACTOR = 1.4
/** A road end within this of another road's line joins it (mapped roads often stop short of a junction). */
export const HAUL_SNAP_TOLERANCE_M = 25
/** A junction further than this from every loaded road is not on the network: its haul is unknown. */
export const HAUL_ATTACH_TOLERANCE_M = 30
/** A dead end within this of the loaded roads' outer extent is where a road leaves the loaded data. */
export const HAUL_EXIT_EDGE_M = 500
/** Loaded road within this of the destination reaches it directly, plus the straight-line remainder. */
export const HAUL_DESTINATION_REACH_M = 2000
/** The departure bearing is read over this much of the route after the junction. */
export const HAUL_DEPARTURE_WINDOW_M = 30
/** Bounds on the network built for one haul run; a larger area is screened from a smaller load. */
export const MAX_HAUL_ROADS = 50_000
export const MAX_HAUL_VERTICES = 1_000_000
/** Limits a project file may hold. */
export const HAUL_LIMITS = {
  speedKmh: [1, 120],
  terminalMin: [0, 600],
  offNetworkFactor: [1, 3],
} as const

export interface HaulDestination {
  id: string
  name: string
  coordinate: Coordinate
}
/**
 * BC Interior towns that receive logs, as town centre points, not any company's mill. A haul is
 * judged to the town: the last kilometres inside it are part of the straight-line estimate.
 */
export const HAUL_DESTINATION_PRESETS: readonly HaulDestination[] = [
  { id: 'prince-george', name: 'Prince George', coordinate: [-122.7497, 53.9171] },
  { id: 'quesnel', name: 'Quesnel', coordinate: [-122.4927, 52.9784] },
  { id: 'vanderhoof', name: 'Vanderhoof', coordinate: [-124.0094, 54.0143] },
  { id: 'fort-st-james', name: 'Fort St. James', coordinate: [-124.2522, 54.4431] },
  { id: 'mackenzie', name: 'Mackenzie', coordinate: [-123.0939, 55.3381] },
  { id: 'burns-lake', name: 'Burns Lake', coordinate: [-125.7637, 54.2297] },
  { id: 'houston', name: 'Houston', coordinate: [-126.6481, 54.3982] },
  { id: 'smithers', name: 'Smithers', coordinate: [-127.1743, 54.7804] },
  { id: 'williams-lake', name: 'Williams Lake', coordinate: [-122.1417, 52.1417] },
  { id: '100-mile-house', name: '100 Mile House', coordinate: [-121.294, 51.6418] },
  { id: 'mcbride', name: 'McBride', coordinate: [-120.1667, 53.3017] },
  { id: 'chetwynd', name: 'Chetwynd', coordinate: [-121.6297, 55.6977] },
  { id: 'kamloops', name: 'Kamloops', coordinate: [-120.3273, 50.6745] },
]

export interface HaulNetworkRoad {
  id: string
  name: string
  coordinates: Coordinate[]
  roadClass: HaulRoadClass
}

/** A road that carries traffic now: mapped, not closed, and active where its source says so. */
function openRoad(feature: ContextFeature) {
  const evidence = feature.roadEvidence
  return (
    feature.kind === 'existing-road' &&
    feature.geometry.type === 'LineString' &&
    evidence?.condition !== 'closed' &&
    (!evidence?.lifecycleStatus || evidence.lifecycleStatus === 'ACTIVE')
  )
}

/**
 * The roads a haul can use: every open mapped road in the project, classed by its source record, and
 * this project's own roads as new road. `exclude` leaves out a road, e.g. the one whose junction is
 * being judged, so its haul is not routed back up itself.
 */
export function haulNetworkRoads(
  context: readonly ContextFeature[],
  alignments: readonly { id: string; name: string; points: readonly { coordinate: Coordinate }[] }[] = [],
  exclude: readonly string[] = [],
): HaulNetworkRoad[] {
  const roads: HaulNetworkRoad[] = []
  for (const feature of context) {
    if (!openRoad(feature) || exclude.includes(feature.id) || feature.geometry.type !== 'LineString') continue
    const roadClass = feature.roadEvidence?.roadClass
    roads.push({
      id: `context:${feature.id}`,
      name: feature.name,
      coordinates: feature.geometry.coordinates.map((p) => [p[0], p[1]] as Coordinate),
      roadClass: roadClass === 'fsr' ? 'fsr' : roadClass === 'permit' ? 'permit' : 'mapped',
    })
  }
  for (const alignment of alignments) {
    if (exclude.includes(alignment.id) || alignment.points.length < 2) continue
    roads.push({
      id: `alignment:${alignment.id}`,
      name: alignment.name,
      coordinates: alignment.points.map((point) => point.coordinate),
      roadClass: 'proposed',
    })
  }
  return roads
}

interface HaulEdge {
  a: number
  b: number
  lengthM: number
  roadClass: HaulRoadClass
  name: string
}
export interface HaulNetwork {
  /** Node positions as lon/lat and in the local metric plane (x east, y north, metres). */
  nodes: Coordinate[]
  xy: Float64Array
  edges: HaulEdge[]
  /** Edge indices per node. */
  adjacency: number[][]
  /** Outer extent of the loaded roads in the local plane. */
  extent: [number, number, number, number]
  origin: Coordinate
  /** Road ends joined to another road within the snap tolerance. */
  joins: number
}

const M_PER_DEGREE = 111195.0802335329
const RAD = Math.PI / 180

function plane(origin: Coordinate) {
  const kx = M_PER_DEGREE * Math.cos(origin[1] * RAD)
  return {
    to: (c: Coordinate): [number, number] => [(c[0] - origin[0]) * kx, (c[1] - origin[1]) * M_PER_DEGREE],
    from: (x: number, y: number): Coordinate => [origin[0] + x / kx, origin[1] + y / M_PER_DEGREE],
  }
}

/**
 * Builds the haul graph. Each road's vertices are nodes. A road end that lies within the snap
 * tolerance of another road's line is joined to it there; lines that merely cross are not joined,
 * as a crossing in mapped linework does not establish a junction.
 */
export function buildHaulNetwork(roads: readonly HaulNetworkRoad[], snapToleranceM = HAUL_SNAP_TOLERANCE_M) {
  if (roads.length > MAX_HAUL_ROADS)
    throw Error(`Haul routing reads at most ${MAX_HAUL_ROADS} roads; load a smaller area.`)
  const vertices = roads.reduce((sum, road) => sum + road.coordinates.length, 0)
  if (vertices > MAX_HAUL_VERTICES)
    throw Error(
      `Haul routing reads at most ${MAX_HAUL_VERTICES.toLocaleString('en-CA')} road vertices; load a smaller area.`,
    )
  const valid = roads.filter(
    (road) =>
      road.coordinates.length >= 2 && road.coordinates.every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])),
  )
  const all = valid.flatMap((road) => road.coordinates)
  const origin: Coordinate = all.length
    ? [all.reduce((s, c) => s + c[0], 0) / all.length, all.reduce((s, c) => s + c[1], 0) / all.length]
    : [0, 0]
  const { to } = plane(origin)
  const nodes: Coordinate[] = []
  const xs: number[] = [],
    ys: number[] = []
  const addNode = (c: Coordinate, x: number, y: number) => {
    nodes.push(c)
    xs.push(x)
    ys.push(y)
    return nodes.length - 1
  }
  // Vertex nodes per road, and every segment in a grid index for the end snaps.
  const roadNodes: number[][] = []
  type Seg = { road: number; index: number }
  const cell = Math.max(200, snapToleranceM * 2)
  const grid = new Map<string, Seg[]>()
  valid.forEach((road, r) => {
    const ids = road.coordinates.map((c) => {
      const [x, y] = to(c)
      return addNode([c[0], c[1]], x, y)
    })
    // A closed road (a loop) ends where it starts: one node, not two dead ends.
    const last = ids.length - 1
    if (last > 1 && Math.hypot(xs[ids[0]] - xs[ids[last]], ys[ids[0]] - ys[ids[last]]) < 0.5) ids[last] = ids[0]
    roadNodes.push(ids)
    for (let i = 1; i < ids.length; i++) {
      const ax = xs[ids[i - 1]],
        ay = ys[ids[i - 1]],
        bx = xs[ids[i]],
        by = ys[ids[i]]
      const c0 = Math.floor(Math.min(ax, bx) / cell),
        c1 = Math.floor(Math.max(ax, bx) / cell),
        r0 = Math.floor(Math.min(ay, by) / cell),
        r1 = Math.floor(Math.max(ay, by) / cell)
      for (let cx = c0; cx <= c1; cx++)
        for (let cy = r0; cy <= r1; cy++) {
          const k = `${cx}:${cy}`
          const list = grid.get(k) ?? []
          list.push({ road: r, index: i - 1 })
          grid.set(k, list)
        }
    }
  })
  // Splits on a segment: fraction → node.
  const splits = new Map<string, { fraction: number; node: number }[]>()
  const connectors: { a: number; b: number; roadClass: HaulRoadClass; name: string }[] = []
  let joins = 0
  valid.forEach((road, r) => {
    const ids = roadNodes[r]
    for (const end of [ids[0], ids[ids.length - 1]]) {
      const x = xs[end],
        y = ys[end]
      let best: { road: number; index: number; fraction: number; d: number } | null = null
      const cx = Math.floor(x / cell),
        cy = Math.floor(y / cell)
      for (let i = cx - 1; i <= cx + 1; i++)
        for (let j = cy - 1; j <= cy + 1; j++)
          for (const seg of grid.get(`${i}:${j}`) ?? []) {
            if (seg.road === r) continue
            const other = roadNodes[seg.road]
            const a = other[seg.index],
              b = other[seg.index + 1]
            const dx = xs[b] - xs[a],
              dy = ys[b] - ys[a]
            const l2 = dx * dx + dy * dy
            const t = l2 ? Math.max(0, Math.min(1, ((x - xs[a]) * dx + (y - ys[a]) * dy) / l2)) : 0
            const d = Math.hypot(xs[a] + t * dx - x, ys[a] + t * dy - y)
            if (d <= snapToleranceM && (!best || d < best.d - 1e-9))
              best = { road: seg.road, index: seg.index, fraction: t, d }
          }
      if (!best) continue
      const other = roadNodes[best.road]
      const a = other[best.index],
        b = other[best.index + 1]
      const segLength = Math.hypot(xs[b] - xs[a], ys[b] - ys[a])
      let target: number
      if (best.fraction * segLength < 0.5) target = a
      else if ((1 - best.fraction) * segLength < 0.5) target = b
      else {
        const k = `${best.road}:${best.index}`
        const list = splits.get(k) ?? []
        const existing = list.find((s) => Math.abs(s.fraction - best.fraction) * segLength < 0.5)
        if (existing) target = existing.node
        else {
          const px = xs[a] + best.fraction * (xs[b] - xs[a]),
            py = ys[a] + best.fraction * (ys[b] - ys[a])
          const ca = nodes[a],
            cb = nodes[b]
          target = addNode([ca[0] + best.fraction * (cb[0] - ca[0]), ca[1] + best.fraction * (cb[1] - ca[1])], px, py)
          list.push({ fraction: best.fraction, node: target })
          splits.set(k, list)
        }
      }
      if (target === end) continue
      joins++
      connectors.push({ a: end, b: target, roadClass: road.roadClass, name: road.name })
    }
  })
  const edges: HaulEdge[] = []
  const pushEdge = (a: number, b: number, roadClass: HaulRoadClass, name: string) => {
    if (a === b) return
    const lengthM = distance(nodes[a], nodes[b])
    if (lengthM < 1e-6) {
      // Zero-length joins still connect: keep them with no length.
      edges.push({ a, b, lengthM: 0, roadClass, name })
      return
    }
    edges.push({ a, b, lengthM, roadClass, name })
  }
  valid.forEach((road, r) => {
    const ids = roadNodes[r]
    for (let i = 1; i < ids.length; i++) {
      const pieces = [
        { fraction: 0, node: ids[i - 1] },
        ...(splits.get(`${r}:${i - 1}`) ?? []).sort((p, q) => p.fraction - q.fraction),
        { fraction: 1, node: ids[i] },
      ]
      for (let k = 1; k < pieces.length; k++) pushEdge(pieces[k - 1].node, pieces[k].node, road.roadClass, road.name)
    }
  })
  for (const c of connectors) pushEdge(c.a, c.b, c.roadClass, c.name)
  const adjacency: number[][] = nodes.map(() => [])
  edges.forEach((edge, i) => {
    adjacency[edge.a].push(i)
    adjacency[edge.b].push(i)
  })
  const xy = new Float64Array(nodes.length * 2)
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (let i = 0; i < nodes.length; i++) {
    xy[i * 2] = xs[i]
    xy[i * 2 + 1] = ys[i]
    minX = Math.min(minX, xs[i])
    minY = Math.min(minY, ys[i])
    maxX = Math.max(maxX, xs[i])
    maxY = Math.max(maxY, ys[i])
  }
  return {
    nodes,
    xy,
    edges,
    adjacency,
    extent: nodes.length ? [minX, minY, maxX, maxY] : [0, 0, 0, 0],
    origin,
    joins,
  } satisfies HaulNetwork
}

/** Round-trip minutes per metre on a class, or null when either speed is not entered. */
function roundTripMinPerM(speed: HaulSpeed): number | null {
  if (!speed.loadedKmh || !speed.emptyKmh) return null
  return 60 / (speed.loadedKmh * 1000) + 60 / (speed.emptyKmh * 1000)
}

/**
 * Round-trip minutes per metre each class is ranked by. A class with no entered speed still has to
 * rank against the others: it takes the slowest entered rate (or 15 km/h both ways), and its legs
 * still report no time.
 */
export function haulRankRates(speeds: HaulSpeeds): Record<HaulRoadClass, number> {
  const known = HAUL_ROAD_CLASSES.map((c) => roundTripMinPerM(speeds[c])).filter((v): v is number => v !== null)
  const standIn = known.length ? Math.max(...known) : 60 / 15000 + 60 / 15000
  return Object.fromEntries(HAUL_ROAD_CLASSES.map((c) => [c, roundTripMinPerM(speeds[c]) ?? standIn])) as Record<
    HaulRoadClass,
    number
  >
}

export interface HaulField {
  network: HaulNetwork
  destination: HaulDestination
  speeds: HaulSpeeds
  offNetworkFactor: number
  /** Round-trip minutes from each node to the destination by the fastest way out; Infinity if none. */
  time: Float64Array
  /** The edge each node leaves by toward the destination; -1 where the haul leaves the loaded roads. */
  via: Int32Array
  /** Straight-line metres from a node where the haul leaves the loaded roads. */
  exitStraightM: Float64Array
  /** 1 where a haul may leave by a dead end only because its group of roads has no other way out. */
  assumedExit: Uint8Array
  /** Nodes where a haul may leave the loaded roads. */
  exits: number
  /** Round-trip minutes per metre each class is ranked by; a class with no entered speed uses a stand-in. */
  rankPerM: Record<HaulRoadClass, number>
}

class Heap {
  private items: { node: number; score: number }[] = []
  get size() {
    return this.items.length
  }
  push(item: { node: number; score: number }) {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent].score <= item.score) break
      items[i] = items[parent]
      i = parent
    }
    items[i] = item
  }
  pop() {
    const items = this.items
    const top = items[0]
    const last = items.pop()!
    if (items.length) {
      let i = 0
      for (;;) {
        let child = i * 2 + 1
        if (child >= items.length) break
        if (child + 1 < items.length && items[child + 1].score < items[child].score) child++
        if (items[child].score >= last.score) break
        items[i] = items[child]
        i = child
      }
      items[i] = last
    }
    return top
  }
}

/**
 * The fastest round trip from every node of the network to the destination. A haul leaves the
 * loaded roads at a dead end on their outer edge (where a loaded road runs out of the data) or
 * within reach of the destination; from there it is the straight line times the detour factor at
 * the off-network speed. A dead end inside the loaded area is taken for a spur, not a way out —
 * except in a group of joined roads that has no other way out (patchy loaded data): there every
 * dead end of a mapped road is a possible exit, and a route that leaves by one says it was assumed.
 */
export function haulField(
  network: HaulNetwork,
  destination: HaulDestination,
  speeds: HaulSpeeds,
  offNetworkFactor = DEFAULT_OFF_NETWORK_FACTOR,
): HaulField {
  const n = network.nodes.length
  const time = new Float64Array(n).fill(Infinity)
  const via = new Int32Array(n).fill(-1)
  const exitStraightM = new Float64Array(n).fill(NaN)
  const assumedExit = new Uint8Array(n)
  const rankPerM = haulRankRates(speeds)
  const perM = (roadClass: HaulRoadClass) => rankPerM[roadClass]
  const heap = new Heap()
  const [minX, minY, maxX, maxY] = network.extent
  // Groups of joined roads.
  const group = new Int32Array(n).fill(-1)
  let groups = 0
  for (let i = 0; i < n; i++) {
    if (group[i] >= 0) continue
    const stack = [i]
    group[i] = groups
    while (stack.length) {
      const u = stack.pop()!
      for (const e of network.adjacency[u]) {
        const edge = network.edges[e]
        const v = edge.a === u ? edge.b : edge.a
        if (group[v] < 0) {
          group[v] = groups
          stack.push(v)
        }
      }
    }
    groups++
  }
  const hasExit = new Uint8Array(groups)
  let exits = 0
  const open = (i: number, straight: number) => {
    exits++
    exitStraightM[i] = straight
    time[i] = straight * offNetworkFactor * perM('off-network')
    heap.push({ node: i, score: time[i] })
    hasExit[group[i]] = 1
  }
  const deadEnd = (i: number) => network.adjacency[i].length === 1
  for (let i = 0; i < n; i++) {
    const x = network.xy[i * 2],
      y = network.xy[i * 2 + 1]
    const straight = distance(network.nodes[i], destination.coordinate)
    const onEdge =
      deadEnd(i) &&
      (x - minX <= HAUL_EXIT_EDGE_M ||
        maxX - x <= HAUL_EXIT_EDGE_M ||
        y - minY <= HAUL_EXIT_EDGE_M ||
        maxY - y <= HAUL_EXIT_EDGE_M)
    if (onEdge || straight <= HAUL_DESTINATION_REACH_M) open(i, straight)
  }
  for (let i = 0; i < n; i++)
    if (!hasExit[group[i]] && deadEnd(i) && network.edges[network.adjacency[i][0]].roadClass !== 'proposed') {
      assumedExit[i] = 1
      exits++
      exitStraightM[i] = distance(network.nodes[i], destination.coordinate)
      time[i] = exitStraightM[i] * offNetworkFactor * perM('off-network')
      heap.push({ node: i, score: time[i] })
    }
  const done = new Uint8Array(n)
  while (heap.size) {
    const { node, score } = heap.pop()
    if (done[node] || score !== time[node]) continue
    done[node] = 1
    for (const e of network.adjacency[node]) {
      const edge = network.edges[e]
      const next = edge.a === node ? edge.b : edge.a
      const candidate = score + edge.lengthM * perM(edge.roadClass)
      if (candidate < time[next] - 1e-12) {
        time[next] = candidate
        via[next] = e
        exitStraightM[next] = NaN
        heap.push({ node: next, score: candidate })
      }
    }
  }
  return { network, destination, speeds, offNetworkFactor, time, via, exitStraightM, assumedExit, exits, rankPerM }
}

export interface HaulLeg {
  roadClass: HaulRoadClass
  lengthM: number
  /** True for the straight-line × factor leg past the loaded roads. */
  estimated: boolean
  /** Null when the class has no entered speed. */
  loadedMin: number | null
  emptyMin: number | null
  names: string[]
}
export interface HaulRoute {
  /**
   * `network`: the haul uses loaded roads and, if the destination is beyond them, an estimated
   * remainder. `unknown`: no haul could be traced from this point, and `reason` says why.
   */
  status: 'network' | 'unknown'
  reason: string
  legs: HaulLeg[]
  /** One way, metres. Null when the route is unknown. */
  oneWayM: number | null
  /** Of which on loaded roads, and estimated past them. */
  networkM: number
  estimatedM: number
  /** True when the haul leaves by a dead end only because its roads had no other way out. */
  exitAssumed: boolean
  /** Minutes; null when the route is unknown or any leg has no entered speed. */
  loadedMin: number | null
  emptyMin: number | null
  terminalMin: number
  cycleMin: number | null
  /** Straight line from the point to the destination, for context only. */
  straightM: number
  /** Bearing (° clockwise from north) the loaded truck leaves the point on; null if not on a road. */
  departureBearing: number | null
  /** Distance from the point to the road it was joined to, and that road's name. */
  attachDistanceM: number | null
  joinedRoad: string | null
  /** Route on the loaded roads, from the point to where it leaves them (or reaches the destination). */
  coordinates: Coordinate[]
}

export function bearingDeg(a: Coordinate, b: Coordinate) {
  const kx = Math.cos(((a[1] + b[1]) / 2) * RAD)
  return (((Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) / RAD) % 360) + 360) % 360
}

/** The nearest point on the network to `point` within `toleranceM`, as an edge and a fraction. */
function attach(network: HaulNetwork, point: Coordinate, toleranceM: number) {
  const { to } = plane(network.origin)
  const [x, y] = to(point)
  let best: { edge: number; fraction: number; d: number } | null = null
  network.edges.forEach((edge, i) => {
    const ax = network.xy[edge.a * 2],
      ay = network.xy[edge.a * 2 + 1],
      bx = network.xy[edge.b * 2],
      by = network.xy[edge.b * 2 + 1]
    if (
      x < Math.min(ax, bx) - toleranceM ||
      x > Math.max(ax, bx) + toleranceM ||
      y < Math.min(ay, by) - toleranceM ||
      y > Math.max(ay, by) + toleranceM
    )
      return
    const dx = bx - ax,
      dy = by - ay,
      l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
    const d = Math.hypot(ax + t * dx - x, ay + t * dy - y)
    if (d <= toleranceM && (!best || d < best.d - 1e-9)) best = { edge: i, fraction: t, d }
  })
  return best as { edge: number; fraction: number; d: number } | null
}

/** The way out from a point on the network: the node it heads to first and the path's coordinates. */
function trace(field: HaulField, point: Coordinate, toleranceM: number) {
  const { network } = field
  const at = attach(network, point, toleranceM)
  if (!at) return null
  const edge = network.edges[at.edge]
  // Rank the two ways along the joined edge the way the field was ranked.
  const rate = field.rankPerM[edge.roadClass]
  const viaA = at.fraction * edge.lengthM * rate + field.time[edge.a]
  const viaB = (1 - at.fraction) * edge.lengthM * rate + field.time[edge.b]
  if (!Number.isFinite(viaA) && !Number.isFinite(viaB)) return { at, path: null }
  const first = viaA <= viaB ? edge.a : edge.b
  const startPoint: Coordinate = [
    network.nodes[edge.a][0] + at.fraction * (network.nodes[edge.b][0] - network.nodes[edge.a][0]),
    network.nodes[edge.a][1] + at.fraction * (network.nodes[edge.b][1] - network.nodes[edge.a][1]),
  ]
  const steps: { lengthM: number; roadClass: HaulRoadClass; name: string }[] = [
    {
      lengthM: (first === edge.a ? at.fraction : 1 - at.fraction) * edge.lengthM,
      roadClass: edge.roadClass,
      name: edge.name,
    },
  ]
  const coordinates: Coordinate[] = [startPoint, network.nodes[first]]
  let node = first
  const seen = new Set<number>()
  while (field.via[node] >= 0) {
    if (seen.has(node)) break
    seen.add(node)
    const e = network.edges[field.via[node]]
    node = e.a === node ? e.b : e.a
    steps.push({ lengthM: e.lengthM, roadClass: e.roadClass, name: e.name })
    coordinates.push(network.nodes[node])
  }
  return { at, path: { steps, coordinates, exit: node, startPoint, minutes: Math.min(viaA, viaB) } }
}

/** Bearing over the first `windowM` metres of a line. */
function leadingBearing(coordinates: Coordinate[], windowM: number): number | null {
  let travelled = 0
  for (let i = 1; i < coordinates.length; i++) {
    const step = distance(coordinates[i - 1], coordinates[i])
    if (travelled + step >= windowM && step > 0) {
      const f = (windowM - travelled) / step
      const end: Coordinate = [
        coordinates[i - 1][0] + f * (coordinates[i][0] - coordinates[i - 1][0]),
        coordinates[i - 1][1] + f * (coordinates[i][1] - coordinates[i - 1][1]),
      ]
      return bearingDeg(coordinates[0], end)
    }
    travelled += step
  }
  return travelled > 1 ? bearingDeg(coordinates[0], coordinates[coordinates.length - 1]) : null
}

/**
 * The bearing a loaded truck leaves a point on the network toward the destination, or null when the
 * point is not on a loaded road or no way out is known.
 */
export function departureBearingAt(
  field: HaulField,
  point: Coordinate,
  toleranceM = HAUL_ATTACH_TOLERANCE_M,
): number | null {
  const traced = trace(field, point, toleranceM)
  if (!traced?.path) return null
  return leadingBearing(traced.path.coordinates, HAUL_DEPARTURE_WINDOW_M)
}

/** Round-trip minutes from a point on the network to the destination, as ranked; Infinity when unknown. */
export function roundTripMinutesAt(field: HaulField, point: Coordinate, toleranceM = HAUL_ATTACH_TOLERANCE_M) {
  return trace(field, point, toleranceM)?.path?.minutes ?? Infinity
}

const minutes = (lengthM: number, kmh: number | null) => (kmh ? (lengthM / 1000 / kmh) * 60 : null)
const sum = (values: (number | null)[]) =>
  values.some((v) => v === null) ? null : values.reduce<number>((s, v) => s + v!, 0)

/**
 * The haul from a junction to the destination: loaded roads first, then the estimated remainder.
 * `accessLengthM` adds the new road from the landing to the junction as its own leg.
 */
export function haulRouteFrom(
  field: HaulField,
  point: Coordinate,
  options: { accessLengthM?: number | null; terminal: HaulTerminalTimes; toleranceM?: number },
): HaulRoute {
  const terminalMin = options.terminal.loadMin + options.terminal.unloadMin + options.terminal.delayMin
  const straightM = distance(point, field.destination.coordinate)
  const unknown = (reason: string, attachDistanceM: number | null = null): HaulRoute => ({
    status: 'unknown',
    reason,
    legs: [],
    oneWayM: null,
    networkM: 0,
    estimatedM: 0,
    exitAssumed: false,
    loadedMin: null,
    emptyMin: null,
    terminalMin,
    cycleMin: null,
    straightM,
    departureBearing: null,
    attachDistanceM,
    joinedRoad: null,
    coordinates: [],
  })
  const tolerance = options.toleranceM ?? HAUL_ATTACH_TOLERANCE_M
  if (!field.network.edges.length) return unknown('No roads are loaded, so the haul cannot be traced.')
  const traced = trace(field, point, tolerance)
  if (!traced)
    return unknown(
      `The junction is more than ${tolerance} m from every loaded road, so the haul from it is unknown. Load the road it joins.`,
    )
  if (!traced.path)
    return unknown(
      'No loaded road from this junction reaches the edge of the loaded roads or the destination. Load the roads the haul leaves by.',
      traced.at.d,
    )
  const { steps, coordinates, exit } = traced.path
  const legs: HaulLeg[] = []
  const addLeg = (roadClass: HaulRoadClass, lengthM: number, estimated: boolean, name?: string) => {
    if (lengthM <= 0 && !estimated) return
    const last = legs[legs.length - 1]
    const speed = field.speeds[roadClass]
    if (last && last.roadClass === roadClass && last.estimated === estimated) {
      last.lengthM += lengthM
      if (name && !last.names.includes(name)) last.names.push(name)
    } else legs.push({ roadClass, lengthM, estimated, loadedMin: null, emptyMin: null, names: name ? [name] : [] })
    const leg = legs[legs.length - 1]
    leg.loadedMin = minutes(leg.lengthM, speed.loadedKmh)
    leg.emptyMin = minutes(leg.lengthM, speed.emptyKmh)
  }
  if (options.accessLengthM !== undefined && options.accessLengthM !== null && options.accessLengthM > 0)
    addLeg('proposed', options.accessLengthM, false, 'Access road')
  for (const step of steps) addLeg(step.roadClass, step.lengthM, false, step.name)
  const offM = Number.isFinite(field.exitStraightM[exit]) ? field.exitStraightM[exit] * field.offNetworkFactor : 0
  if (offM > 0) addLeg('off-network', offM, true)
  const networkM = legs.filter((leg) => !leg.estimated).reduce((s, leg) => s + leg.lengthM, 0)
  const loadedMin = sum(legs.map((leg) => leg.loadedMin))
  const emptyMin = sum(legs.map((leg) => leg.emptyMin))
  const departureBearing = leadingBearing(coordinates, HAUL_DEPARTURE_WINDOW_M)
  const missing = legs.filter((leg) => leg.loadedMin === null || leg.emptyMin === null).map((leg) => leg.roadClass)
  return {
    status: 'network',
    reason: [
      offM > 0
        ? `${Math.round(offM / 100) / 10} km past the loaded roads is estimated as ${field.offNetworkFactor}× the straight line.`
        : 'The loaded roads reach the destination.',
      field.assumedExit[exit]
        ? `The loaded roads here have no way out of the loaded area, so the haul is assumed to leave by the dead end of ${steps[steps.length - 1]?.name ?? 'a mapped road'} nearest the destination, which may be a spur: load the roads beyond to confirm.`
        : '',
      missing.length
        ? `No time for ${[...new Set(missing)].map((c) => HAUL_ROAD_CLASS_LABELS[c].toLowerCase()).join(', ')}: enter its speeds.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    legs,
    oneWayM: networkM + offM,
    networkM,
    estimatedM: offM,
    exitAssumed: field.assumedExit[exit] === 1,
    loadedMin,
    emptyMin,
    terminalMin,
    cycleMin: loadedMin === null || emptyMin === null ? null : loadedMin + emptyMin + terminalMin,
    straightM,
    departureBearing,
    attachDistanceM: traced.at.d,
    joinedRoad: field.network.edges[traced.at.edge].name,
    coordinates,
  }
}
