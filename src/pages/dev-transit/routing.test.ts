import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { calculateTravel, snap } from './routing'
import { clockTime, readTravelState, writeTravelState } from './state'
import type { TransitData, TravelOptions } from './types'

function fixture(): TransitData {
  const points: TransitData['walkNodes'] = [
    [-122.75, 53.91],
    [-122.76, 53.91],
    [-122.77, 53.91],
  ]
  return {
    schema: 'pg-travel-time-v1',
    meta: {
      referenceDate: '2026-10-07',
      feedStart: '20261005',
      feedEnd: '20270102',
      sourceUrl: '',
      walkMetersPerSecond: 1.25,
      bbox: [-122.94, 53.78, -122.59, 54.045],
    },
    routes: [
      { id: 'r1', number: '1', name: 'Route 1', color: '#004b8d' },
      { id: 'r2', number: '2', name: 'Route 2', color: '#ff0000' },
    ],
    stops: points.map((point, i) => ({ id: String(i), name: `Stop ${i}`, point, access: [i, 0] })),
    walkNodes: points,
    walkEdges: [
      [[1, 1000]],
      [
        [0, 1000],
        [2, 1000],
      ],
      [[1, 1000]],
    ],
    patterns: [{ route: 0, headsign: 'Terminus', points, stops: [0, 1, 2], shapeIndices: [0, 1, 2] }],
    trips: [{ id: 't1', pattern: 0 }],
    connections: [
      [0, 1, 28860, 28980, 0, 0, true, true],
      [1, 2, 28980, 29040, 0, 1, true, true],
    ],
    transfers: [[], [], []],
    grid: {
      cols: 3,
      rows: 1,
      cells: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    },
  }
}
function options(data: TransitData, patch: Partial<TravelOptions> = {}): TravelOptions {
  return { from: data.stops[0].point, to: data.stops[2].point, departure: 28800, bus: true, heatFrom: 'from', ...patch }
}

describe('scheduled routing', () => {
  it('stays on the same vehicle through a stop without charging another wait', () => {
    const data = fixture(),
      result = calculateTravel(data, options(data))
    expect(result.journey?.minutes).toBe(4)
    const rides = result.journey?.legs.filter((leg) => leg.kind === 'bus')
    expect(rides).toHaveLength(1)
    expect(rides?.[0]).toMatchObject({ from: 'Stop 0', to: 'Stop 2', wait: 1 })
    expect(result.grid[2]).toBe(4)
  })
  it('does not splice two trips together without enough time to board', () => {
    const data = fixture()
    data.trips.push({ id: 't2', pattern: 0 })
    data.connections[1][4] = 1
    expect(
      calculateTravel(data, options(data)).journey?.legs.some((leg) => leg.kind === 'bus' && leg.to === 'Stop 2'),
    ).toBe(false)
    data.connections[1][2] += 60
    data.connections[1][3] += 60
    expect(calculateTravel(data, options(data)).journey?.minutes).toBe(5)
  })
  it('honours pickup and drop-off restrictions', () => {
    const data = fixture()
    data.connections[0][6] = false
    expect(calculateTravel(data, options(data)).journey?.legs.every((leg) => leg.kind === 'walk')).toBe(true)
    data.connections[0][6] = true
    data.connections[1][7] = false
    expect(calculateTravel(data, options(data)).journey?.minutes).toBeGreaterThan(4)
  })
  it('missed buses cannot be boarded backwards in time', () => {
    const data = fixture()
    const result = calculateTravel(data, options(data, { departure: 29100 }))
    expect(result.journey?.legs.every((leg) => leg.kind === 'walk')).toBe(true)
  })
  it('walking does not jump gaps in network connectivity', () => {
    const data = fixture()
    data.walkEdges = [[[1, 1000]], [[0, 1000]], []]
    const result = calculateTravel(data, options(data, { bus: false }))
    expect(result.journey).toBeNull()
    expect(result.grid[2]).toBe(-1)
  })
  it('does not invent access for a point far from the street network', () => {
    const data = fixture()
    const result = calculateTravel(data, options(data, { from: [-122.9, 54] }))
    expect(result.originOnNetwork).toBe(false)
    expect(result.journey).toBeNull()
    expect(result.grid.every((n) => n === -1)).toBe(true)
  })
  it('counts extended block access as walking time and still rejects points beyond the configured limit', () => {
    const data = fixture()
    data.meta.markerAccessMeters = data.meta.gridAccessMeters = 350
    const from: [number, number] = [-122.75, 53.9118]
    const result = calculateTravel(data, options(data, { from, bus: false }))
    expect(result.originOnNetwork).toBe(true)
    expect(result.grid[0]).toBeCloseTo((0.0018 * 111320) / 1.25 / 60, 5)
    expect(result.journey).not.toBeNull()
    expect(calculateTravel(data, options(data, { from: [-122.75, 53.9132] })).originOnNetwork).toBe(false)
  })
  it('prefers a nearby road over an isolated property path without joining their components', () => {
    const data = fixture()
    const isolated: [number, number] = [-122.7501, 53.91]
    data.walkNodes.push(isolated)
    data.walkEdges.push([])
    data.streetAccessNodes = [0, 1, 2]
    expect(snap(data, isolated)?.[0]).toBe(0)
    expect(calculateTravel(data, options(data, { from: isolated, bus: false })).journey).not.toBeNull()
    expect(data.walkEdges[3]).toEqual([])

    // If no road is within the access limit, retain the separate path without
    // inventing a connection to a distant street.
    data.walkNodes[3] = [-122.74, 53.91]
    const remote = { ...data, walkNodes: [...data.walkNodes] }
    expect(snap(remote, remote.walkNodes[3])?.[0]).toBe(3)
    expect(calculateTravel(remote, options(remote, { from: remote.walkNodes[3], bus: false })).journey).toBeNull()
  })
  it('changing the heat origin preserves the original journey', () => {
    const data = fixture(),
      a = calculateTravel(data, options(data)),
      b = calculateTravel(data, options(data, { heatFrom: 'to' }))
    expect(b.journey).toEqual(a.journey)
    expect(b.grid[2]).toBe(0)
    expect(b.grid[0]).toBeGreaterThan(a.grid[0])
  })
  it('supports GTFS arrivals after midnight', () => {
    const data = fixture()
    data.connections.forEach((c) => {
      c[2] += 57600
      c[3] += 57600
    })
    const result = calculateTravel(data, options(data, { departure: 86400 }))
    expect(result.journey?.minutes).toBe(4)
    expect(clockTime(result.journey!.arrival)).toBe('00:04')
  })
})

describe('share state', () => {
  it('round trips all routing and contour settings', () => {
    const state = readTravelState('from=-122.75,53.91&to=-122.77,53.91&time=23:55&bus=0&heat=to&max=90&contours=15,60')
    expect(readTravelState(writeTravelState(state))).toEqual(state)
    expect(readTravelState('contours=').contours).toEqual([])
  })
  it('rejects malformed and out-of-area points and invalid times', () => {
    const state = readTravelState('from=NaN,53&to=-122,99&time=99:60&max=1&contours=7,NaN')
    expect(state.from).toEqual([-122.74733, 53.91313])
    expect(state.to).toBeNull()
    expect(state.departure).toBe(28800)
    expect(state.max).toBe(45)
    expect(state.contours).toEqual([])
    expect(readTravelState('to=,53.9').to).toBeNull()
  })
})

it('the deployed Prince George snapshot connects downtown to UNBC by scheduled route 15', () => {
  const data: TransitData = JSON.parse(
    gunzipSync(
      readFileSync('vendor/bcdatamapper/datascrapers/transit/output/prince_george_travel_time.json.gz'),
    ).toString(),
  )
  const query: TravelOptions = {
    from: [-122.74733, 53.91313],
    to: [-122.81364, 53.89128],
    departure: 28800,
    bus: true,
    heatFrom: 'from',
  }
  const transit = calculateTravel(data, query),
    walk = calculateTravel(data, { ...query, bus: false })
  expect(transit.journey?.minutes).toBe(30)
  expect(transit.journey?.legs.filter((l) => l.kind === 'bus').map((l) => l.route)).toEqual(['15'])
  expect(walk.journey?.minutes).toBeGreaterThan(90)
  expect(transit.reachableStops).toBeGreaterThan(walk.reachableStops)
  expect(data.connections.every((c, i) => c[3] >= c[2] && (!i || c[2] >= data.connections[i - 1][2]))).toBe(true)
})

it.each([
  [-122.776639, 53.901750],
  [-122.779805, 53.902121],
  [-122.776657, 53.902947],
] as [number, number][])('the Massey/Griffiths origin %s,%s reaches the city instead of trapping the heatmap', (longitude, latitude) => {
  const data: TransitData = JSON.parse(
    gunzipSync(readFileSync('vendor/bcdatamapper/datascrapers/transit/output/prince_george_travel_time.json.gz')).toString(),
  )
  const query: TravelOptions = {
    from: [longitude, latitude],
    to: [-122.74733, 53.91313],
    departure: 28800,
    bus: true,
    heatFrom: 'from',
  }
  const transit = calculateTravel(data, query)
  const walk = calculateTravel(data, { ...query, bus: false })
  expect(transit.originOnNetwork).toBe(true)
  expect(walk.journey).not.toBeNull()
  expect(transit.journey).not.toBeNull()
  expect(transit.reachableStops).toBeGreaterThan(50)
  expect(transit.grid.filter((minutes) => minutes >= 0 && minutes <= 45).length).toBeGreaterThan(1000)
})
