import type { Access, Leg, Point, TransitData, TravelOptions, TravelResult } from './types'
import { markerAccessMeters, streetAccessIndex } from './street-access'

// Connection Scan keeps each scheduled vehicle intact: route branches and
// opposite directions cannot splice together into a journey that does not run.
class Heap {
  private items: [number, number][] = []
  get size() {
    return this.items.length
  }
  push(time: number, node: number) {
    const item: [number, number] = [time, node]
    let i = this.items.length
    this.items.push(item)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.items[parent][0] <= time) break
      this.items[i] = this.items[parent]
      i = parent
    }
    this.items[i] = item
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop()!
    if (this.items.length) {
      let i = 0
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1
        if (child + 1 < this.items.length && this.items[child + 1][0] < this.items[child][0]) child++
        if (this.items[child][0] >= last[0]) break
        this.items[i] = this.items[child]
        i = child
      }
      this.items[i] = last
    }
    return first
  }
}

export function meters(a: Point, b: Point) {
  const dy = (a[1] - b[1]) * 111320
  const dx = (a[0] - b[0]) * 111320 * Math.cos((53.92 * Math.PI) / 180)
  return Math.hypot(dx, dy)
}

export function snap(data: TransitData, point: Point): Access {
  return streetAccessIndex(data)(point, markerAccessMeters(data.meta))
}

function walkNetwork(data: TransitData, seeds: [node: number, time: number, source: number][], target?: number) {
  const dist = new Float64Array(data.walkNodes.length).fill(Infinity)
  const previous = new Int32Array(dist.length).fill(-1)
  const source = new Int32Array(dist.length).fill(-1)
  const heap = new Heap()
  for (const [node, time, root] of seeds) {
    if (time < dist[node]) {
      dist[node] = time
      source[node] = root
      heap.push(time, node)
    }
  }
  while (heap.size) {
    const [time, node] = heap.pop()
    if (time !== dist[node]) continue
    if (node === target) break
    for (const [next, length] of data.walkEdges[node]) {
      const candidate = time + length / data.meta.walkMetersPerSecond
      if (candidate < dist[next]) {
        dist[next] = candidate
        previous[next] = node
        source[next] = source[node]
        heap.push(candidate, next)
      }
    }
  }
  return { dist, previous, source }
}

function walkingPoints(data: TransitData, from: Point, to: Point): Point[] {
  const a = snap(data, from),
    b = snap(data, to)
  if (!a || !b) return [from, to]
  const { dist, previous } = walkNetwork(data, [[a[0], 0, -1]], b[0])
  if (!Number.isFinite(dist[b[0]])) return [from, to]
  const nodes: Point[] = []
  for (let i = b[0]; i >= 0; i = previous[i]) nodes.push(data.walkNodes[i])
  return [from, ...nodes.reverse(), to]
}

type Path = {
  leg: Omit<Leg, 'points'>
  fromPoint: Point
  toPoint: Point
  previous: Path | null
  ride?: { pattern: number; start: number; end: number }
}

function solve(data: TransitData, origin: Point, departure: number, bus: boolean) {
  const access = snap(data, origin)
  const initial = walkNetwork(
    data,
    access ? [[access[0], departure + access[1] / data.meta.walkMetersPerSecond, -1]] : [],
  )
  const arrival = new Float64Array(data.stops.length).fill(Infinity)
  const paths: (Path | null)[] = data.stops.map(() => null)
  data.stops.forEach((stop, i) => {
    if (!stop.access) return
    const time =
      meters(origin, stop.point) < 1
        ? departure
        : initial.dist[stop.access[0]] + stop.access[1] / data.meta.walkMetersPerSecond
    arrival[i] = time
    if (Number.isFinite(time))
      paths[i] = {
        leg: { kind: 'walk', from: 'Starting point', to: stop.name, departure, arrival: time },
        fromPoint: origin,
        toPoint: stop.point,
        previous: null,
      }
  })

  if (bus && access) {
    const boarded: ({
      path: Path | null
      sequence: number
      departure: number
      from: number
      arrival: number
    } | null)[] = data.trips.map(() => null)
    for (const [from, to, leaves, reaches, trip, sequence, pickup, dropoff] of data.connections) {
      if (leaves < departure) continue
      // Allow one minute to board/transfer. Staying on the same vehicle needs
      // no new boarding buffer and does not incur another wait.
      if (!boarded[trip] && pickup && arrival[from] + 60 <= leaves) {
        boarded[trip] = { path: paths[from], sequence, departure: leaves, from, arrival: arrival[from] }
      }
      const board = boarded[trip]
      if (!board || !dropoff || reaches >= arrival[to]) continue
      const patternIndex = data.trips[trip].pattern,
        pattern = data.patterns[patternIndex]
      const route = data.routes[pattern.route]
      const path: Path = {
        leg: {
          kind: 'bus',
          from: data.stops[board.from].name,
          to: data.stops[to].name,
          departure: board.departure,
          arrival: reaches,
          route: route.number,
          color: route.color,
          headsign: pattern.headsign,
          wait: (board.departure - board.arrival) / 60,
        },
        fromPoint: data.stops[board.from].point,
        toPoint: data.stops[to].point,
        previous: board.path,
        ride: { pattern: patternIndex, start: board.sequence, end: sequence + 1 },
      }
      arrival[to] = reaches
      paths[to] = path
      for (const [next, length] of data.transfers[to]) {
        const time = reaches + length / data.meta.walkMetersPerSecond
        if (time < arrival[next]) {
          arrival[next] = time
          paths[next] = {
            leg: {
              kind: 'walk',
              from: data.stops[to].name,
              to: data.stops[next].name,
              departure: reaches,
              arrival: time,
            },
            fromPoint: data.stops[to].point,
            toPoint: data.stops[next].point,
            previous: path,
          }
        }
      }
    }
  }
  const seeds: [number, number, number][] = access
    ? [[access[0], departure + access[1] / data.meta.walkMetersPerSecond, -1]]
    : []
  data.stops.forEach((stop, i) => {
    if (stop.access && Number.isFinite(arrival[i]))
      seeds.push([stop.access[0], arrival[i] + stop.access[1] / data.meta.walkMetersPerSecond, i])
  })
  return { access, arrival, paths, network: walkNetwork(data, seeds) }
}

export function calculateTravel(data: TransitData, options: TravelOptions, heatGrid = data.grid): TravelResult {
  const { from, to, departure, bus, heatFrom } = options
  const solution = solve(data, from, departure, bus)
  const heat = heatFrom === 'to' && to ? solve(data, to, departure, bus) : solution
  const grid = heatGrid.cells.map((cell) => {
    if (!cell) return -1
    const time = heat.network.dist[cell[0]] + cell[1] / data.meta.walkMetersPerSecond - departure
    return Number.isFinite(time) ? time / 60 : -1
  })
  const stopMinutes = data.stops.map((stop) => {
    if (!stop.access) return null
    const time = heat.network.dist[stop.access[0]] + stop.access[1] / data.meta.walkMetersPerSecond - departure
    return Number.isFinite(time) ? time / 60 : null
  })
  const destination = to ? snap(data, to) : null
  let journey: TravelResult['journey'] = null
  if (to && destination && solution.access) {
    let time = solution.network.dist[destination[0]] + destination[1] / data.meta.walkMetersPerSecond
    let source = solution.network.source[destination[0]]
    // At a selected stop, no walk out to a centreline and back is necessary.
    data.stops.forEach((stop, i) => {
      if (meters(stop.point, to) < 1 && solution.arrival[i] < time) {
        time = solution.arrival[i]
        source = i
      }
    })
    if (meters(from, to) < 1) {
      time = departure
      source = -1
    }
    if (Number.isFinite(time)) {
      const legs: Leg[] = []
      for (let path = source >= 0 ? solution.paths[source] : null; path; path = path.previous) {
        let points: Point[]
        if (path.ride) {
          const pattern = data.patterns[path.ride.pattern]
          points = [
            path.fromPoint,
            ...pattern.points.slice(pattern.shapeIndices[path.ride.start], pattern.shapeIndices[path.ride.end] + 1),
            path.toPoint,
          ]
        } else points = walkingPoints(data, path.fromPoint, path.toPoint)
        if (path.leg.arrival - path.leg.departure > 1) legs.unshift({ ...path.leg, points })
      }
      const start = source >= 0 ? data.stops[source].point : from
      const leaves = source >= 0 ? solution.arrival[source] : departure
      if (time - leaves > 1 || !legs.length)
        legs.push({
          kind: 'walk',
          from: source >= 0 ? data.stops[source].name : 'Starting point',
          to: 'Destination',
          departure: leaves,
          arrival: time,
          points: walkingPoints(data, start, to),
        })
      journey = { minutes: (time - departure) / 60, arrival: time, legs }
    }
  }
  return {
    grid,
    stopMinutes,
    journey,
    reachableStops: stopMinutes.filter((t) => t !== null && t <= 30).length,
    originOnNetwork: !!heat.access,
    originIsolated: !!heat.access && !!data.streetAccessNodes && !data.streetAccessNodes.includes(heat.access[0]),
    destinationOnNetwork: !to || !!destination,
  }
}
