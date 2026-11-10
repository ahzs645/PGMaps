import { describe, expect, it } from 'vitest'
import type { CorridorFailure } from './corridorOptimizer'
import { routePreviewFeature } from './routePreviewFeatures'
import {
  corridorStop,
  ROUTE_STOP_COLOR,
  routeStopParts,
  switchbackStop,
  SWITCHBACK_STOP_LABELS,
} from './routeSearchStop'
import { DEFAULT_SWITCHBACK_ROUTE_OPTIONS } from './switchbackOptions'
import type { SwitchbackFailure } from './switchbackSearch'
import type { Coordinate } from './types'

const start: Coordinate = [-122.8, 53.9],
  middle: Coordinate = [-122.799, 53.9005],
  end: Coordinate = [-122.797, 53.901]

const corridorFailure = (patch: Partial<CorridorFailure> = {}): CorridorFailure => ({
  reason: 'no-candidate',
  directM: 250,
  closestRemainingM: 140,
  closest: middle,
  reached: [start, [-122.7995, 53.9002], middle],
  stopped: { grade: 10, terrain: 0, exclusion: 0, corridor: 0 },
  ...patch,
})

describe('where a failed search stopped', () => {
  it('draws the line it reached, the gap to the end and the stop', () => {
    const stop = corridorStop(corridorFailure(), start, end)
    expect(stop).toMatchObject({ search: 'corridor', stoppedAt: middle, end, remainingM: 140, named: null })
    const parts = routeStopParts('failure:shortest', 'Shortest', '#2563eb', stop)
    expect(parts.map((part) => [part.role, part.label, part.color])).toEqual([
      ['reached', 'Shortest: line the search reached', '#2563eb'],
      ['gap', 'Shortest: 140 m short of the end', ROUTE_STOP_COLOR],
      ['stopped', 'Search stopped · Shortest', ROUTE_STOP_COLOR],
    ])
    expect(parts[1].coordinates).toEqual([middle, end])
    // Every part carries the row's id, so a click on the plan finds the row.
    expect(new Set(parts.map((part) => part.id))).toEqual(new Set(['failure:shortest']))
  })

  it('ends the reached line at the stop, and draws only the stop when no line left the start', () => {
    const withoutLine = corridorStop(
      corridorFailure({ reached: undefined, closest: start, closestRemainingM: 250 }),
      start,
      end,
    )
    expect(withoutLine.reached).toEqual([start])
    const parts = routeStopParts('k', 'Gentlest', '#9333ea', withoutLine)
    expect(parts.map((part) => part.role)).toEqual(['gap', 'stopped'])
    const short = corridorStop(corridorFailure({ reached: [start] }), start, end)
    expect(short.reached).toEqual([start, middle])
  })

  it('marks the place the switchback reason names', () => {
    const failure: SwitchbackFailure = {
      reason: 'no-candidate',
      directM: 250,
      riseM: 150,
      closestRemainingM: 200,
      closest: middle,
      reached: [start, middle],
      stopped: {
        ...Object.fromEntries(Object.keys(SWITCHBACK_STOP_LABELS).map((k) => [k, 0])),
        hairpinOff: 4,
      } as SwitchbackFailure['stopped'],
      frontier: Object.fromEntries(
        Object.keys(SWITCHBACK_STOP_LABELS).map((k) => [k, 0]),
      ) as SwitchbackFailure['frontier'],
      places: { hairpinOff: { at: [-122.7992, 53.9003], xy: [40, 30], remainingM: 210 } },
      hairpinsAccepted: 0,
      end: [0, 250],
    }
    const stop = switchbackStop(
      failure,
      {
        maxGradePercent: 12,
        minRadiusM: 25,
        halfWidthM: 180,
        rules: DEFAULT_SWITCHBACK_ROUTE_OPTIONS,
        radiusM: 25,
        sideHillSlopePercent: null,
      },
      start,
      end,
    )
    expect(stop.named).toEqual({ coordinate: [-122.7992, 53.9003], label: 'Would need a switchback' })
    const parts = routeStopParts('k', 'Shortest', '#2563eb', stop)
    expect(parts.at(-1)).toMatchObject({
      role: 'named',
      label: 'Would need a switchback',
      coordinates: [[-122.7992, 53.9003]],
    })
  })

  it('becomes plan features a click can trace back to the row', () => {
    const point = routePreviewFeature({
      id: 'failure:cost',
      label: 'Search stopped · Lowest cost',
      color: ROUTE_STOP_COLOR,
      selected: true,
      coordinates: [middle],
      stop: 'stopped',
    })
    expect(point).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: middle },
      properties: {
        kind: 'route-search-stop',
        color: ROUTE_STOP_COLOR,
        selected: true,
        label: 'Search stopped · Lowest cost',
        routeLineId: 'failure:cost',
        role: 'stopped',
      },
    })
    const road = routePreviewFeature({
      id: 'r1',
      label: 'Shortest',
      color: '#2563eb',
      selected: false,
      coordinates: [start, end],
    })
    expect(road.geometry).toEqual({ type: 'LineString', coordinates: [start, end] })
    expect(road.properties).toEqual({
      kind: 'route-comparison',
      color: '#2563eb',
      selected: false,
      label: 'Shortest',
      routeLineId: 'r1',
    })
  })
})
