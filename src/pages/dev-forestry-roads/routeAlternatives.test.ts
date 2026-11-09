import { describe, expect, it } from 'vitest'
import { corridorFrame } from './corridorOptimizer'
import { parseProject } from './project'
import { isUntouchedRouteAlternative, routePointsKey, terrainCostAlternatives } from './routeAlternatives'
import { checkCentreline } from './routeFit'
import type { RouteCandidate } from './routing'
import { createDemoProject, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, TerrainSource } from './types'

const ORIGIN: Coordinate = [-122.8, 53.9]
const frame = corridorFrame(ORIGIN)
const at = (x: number, y: number) => frame.fromXY([x, y])
const flat: TerrainSource = { elevationAt: () => 700 }
let made = 0
const make = (coordinates: Coordinate[], name: string): Alignment => ({
  id: `road-${++made}`,
  name,
  color: '#2563eb',
  points: coordinates.map((coordinate, i) => ({ id: `road-${made}-p${i}`, coordinate, radiusM: 0 })),
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
})
const source = make([at(0, 0), at(400, 200)], 'Road 2')
/** A grid route from the source's start to its end by way of one corner, `offset` metres up. */
const route = (offset: number, searchScore: number): RouteCandidate => ({
  coordinates: [at(0, 0), at(200, offset), at(400, offset), at(400, 200)],
  cost: searchScore,
  searchScore,
  avoidancePenalty: 0,
  lengthM: 600,
  crossings: offset ? 1 : 0,
})
const search = (roads: Alignment[], routes: RouteCandidate[], from = source) =>
  terrainCostAlternatives({ source: from, roads, routes, terrain: flat, context: [], minRadiusM: 25, make })

describe('terrain-cost alternatives', () => {
  it('names each road by an identifier and keeps the search score in its record', () => {
    const { created, roads, replaced, notes } = search([source], [route(0, 198_702), route(40, 201_365)])
    expect(created.map((road) => road.name)).toEqual(['Road 2 · terrain-cost route 1', 'Road 2 · terrain-cost route 2'])
    expect(created.map((road) => road.name).join(' ')).not.toMatch(/\$|\d{3}/)
    expect(created[0].routeSearch).toMatchObject({
      kind: 'terrain-cost',
      rank: 1,
      of: 2,
      searchScore: 198_702,
      crossings: 0,
    })
    expect(created[1].routeSearch).toMatchObject({ rank: 2, of: 2, searchScore: 201_365, lengthM: 600, crossings: 1 })
    expect(roads).toEqual([source, ...created])
    expect(replaced).toBe(0)
    expect(notes).toEqual([])
    // The record survives a save and reopen.
    const project = parseProject({ ...createDemoProject(), alignments: roads, activeAlignmentId: source.id })
    expect(project.alignments[1].routeSearch).toEqual(created[0].routeSearch)
  })

  it('fits curves of at least the minimum radius and keeps every road on the terrain', () => {
    const { created } = search([source], [route(0, 1), route(40, 2)])
    for (const road of created) {
      const radii = road.points.slice(1, -1).map((point) => point.radiusM)
      expect(radii.length).toBeGreaterThan(0)
      expect(radii.every((radius) => radius >= 25)).toBe(true)
      expect(checkCentreline(road.points, flat, []).offTerrainM).toBe(0)
    }
  })

  it('makes a curved road from a route when the project sets no minimum radius', () => {
    const found = terrainCostAlternatives({
      source,
      roads: [source],
      routes: [route(0, 1)],
      terrain: flat,
      context: [],
      minRadiusM: 0,
      make,
    })
    expect(found.created).toHaveLength(1)
    const radii = found.created[0].points.slice(1, -1).map((point) => point.radiusM)
    expect(radii.length).toBeGreaterThan(0)
    expect(radii.every((radius) => radius >= 5)).toBe(true)
    expect(found.notes).toEqual([])
  })

  it('leaves a corner sharp, and says so, where its curve would leave the terrain', () => {
    // No ground inside the right-angle corner at (400, 0).
    const holed: TerrainSource = {
      elevationAt: (lon, lat) => {
        const [x, y] = frame.toXY([lon, lat])
        return x > 380 && x < 399 && y > 1 && y < 20 ? NaN : 700
      },
    }
    const corner: RouteCandidate = { ...route(0, 1), coordinates: [at(0, 0), at(400, 0), at(400, 200)] }
    const { created, notes } = terrainCostAlternatives({
      source,
      roads: [source],
      routes: [corner],
      terrain: holed,
      context: [],
      minRadiusM: 25,
      make,
    })
    expect(created[0].points.map((point) => point.radiusM)).toEqual([0, 0, 0])
    expect(checkCentreline(created[0].points, holed, []).offTerrainM).toBe(0)
    expect(notes).toEqual([
      '1 corner stays sharp: no curve of 5 m or more fits there on the terrain and off blocked areas.',
    ])
  })

  it('replaces the last search’s untouched roads and keeps the ones that were taken up', () => {
    const first = search([source], [route(0, 1), route(40, 2), route(80, 3)])
    const [untouched, renamed, designed] = first.created
    const roads = [
      source,
      untouched,
      { ...renamed, name: 'North option' },
      { ...designed, vertical: [{ id: 'v0', chainage: 0, elevation: 700, curveLength: 0 }] },
    ]
    expect(roads.map(isUntouchedRouteAlternative)).toEqual([false, true, false, false])
    const second = search(roads, [route(20, 5), route(60, 6)])
    expect(second.replaced).toBe(1)
    expect(second.roads.map((road) => road.name)).toEqual([
      'Road 2',
      'North option',
      // Kept with its name, so the new roads take the numbers that are free.
      'Road 2 · terrain-cost route 3',
      'Road 2 · terrain-cost route 1',
      'Road 2 · terrain-cost route 2',
    ])
    expect(second.notes[0]).toBe(
      'Replaced 1 route from an earlier search that had not been changed; Undo brings it back.',
    )
    // Rank belongs to the search that made the road, whatever number its name carries.
    expect(second.created.map((road) => road.routeSearch!.rank)).toEqual([1, 2])
  })

  it('does not stack names or replace the road it is searching from', () => {
    const first = search([source], [route(0, 1), route(40, 2)])
    const from = first.created[0]
    const second = search(first.roads, [route(20, 5)], from)
    // The road searched from stays; its untouched sibling goes.
    expect(second.roads.map((road) => road.id)).toEqual([source.id, from.id, second.created[0].id])
    expect(second.created[0].name).toBe('Road 2 · terrain-cost route 2')
    // A name from before records were kept, with a rank and a dollar figure, is not stacked on either.
    const legacy = { ...source, id: 'legacy', name: 'Road 2 · terrain-cost #1 ($198,702)' }
    expect(search([legacy], [route(0, 1)], legacy).created[0].name).toBe('Road 2 · terrain-cost route 1')
  })

  it('tells an edited line from the one the search made', () => {
    const [road] = search([source], [route(0, 1)]).created
    expect(isUntouchedRouteAlternative(road)).toBe(true)
    const moved = { ...road, points: road.points.map((p, i) => (i === 1 ? { ...p, radiusM: p.radiusM + 5 } : p)) }
    expect(routePointsKey(moved.points)).not.toBe(routePointsKey(road.points))
    expect(isUntouchedRouteAlternative(moved)).toBe(false)
    expect(isUntouchedRouteAlternative(source)).toBe(false)
  })
})
