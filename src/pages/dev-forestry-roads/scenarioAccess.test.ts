import { describe, expect, it } from 'vitest'
import { nearestBlockEdge } from './blockAccess'
import { roadPlanFitCoordinates } from './planFit'
import { regionalScenarioAlignments, scenarioAccessRoads } from './scenarios'
import { createDemoProject } from './terrain'
import type { Alignment, ContextFeature, Coordinate, TerrainSource } from './types'

const R = 6371008.8,
  RAD = Math.PI / 180,
  centre: Coordinate = [-122, 54]
const point = (x: number, y: number): Coordinate => [
  centre[0] + x / (R * RAD * Math.cos(centre[1] * RAD)),
  centre[1] + y / (R * RAD),
]
const flat: TerrainSource = { elevationAt: () => 800 }
const block = (x: number, y: number, size = 100): ContextFeature => ({
  id: `block-${x}-${y}`,
  name: `Cutblock ${x},${y} · mapped harvest opening`,
  kind: 'harvest',
  geometry: {
    type: 'Polygon',
    coordinates: [[point(x, y), point(x + size, y), point(x + size, y + size), point(x, y + size), point(x, y)]],
  },
})
const road = (id: string, from: Coordinate, to: Coordinate): ContextFeature => ({
  id,
  name: `Road ${id}`,
  kind: 'existing-road',
  geometry: { type: 'LineString', coordinates: [from, to] },
  roadEvidence: {
    source: 'bc-ften',
    roadClass: 'permit',
    condition: 'unknown',
    conditionBasis: 'unreviewed',
    reuseAllowed: false,
  },
})
const segmentsCross = (a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate) => {
  const side = (p: Coordinate, q: Coordinate, r: Coordinate) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}
const crossings = (alignment: Alignment, roads: ContextFeature[]) =>
  roads.reduce((total, mapped) => {
    const line = (mapped.geometry as GeoJSON.LineString).coordinates as Coordinate[]
    return (
      total +
      alignment.points
        .slice(1)
        .filter((p, i) => segmentsCross(alignment.points[i].coordinate, p.coordinate, line[0], line[1])).length
    )
  }, 0)

describe('scenario drafts and access roads', () => {
  it('keeps the drafts off mapped roads when an orientation allows it', () => {
    const roads = [road('ns', point(0, -700), point(0, 700))]
    const drafts = regionalScenarioAlignments('test', centre, flat, roads)
    for (const draft of drafts) expect(crossings(draft, roads)).toBe(0)
  })

  it('opens on an access road from the nearest mapped road to the block nearest the drafts', () => {
    const drafts = regionalScenarioAlignments('test', centre, flat)
    const mapped = road('west', point(-600, -300), point(-600, 300))
    const target = block(-400, -50)
    const [access] = scenarioAccessRoads('test', [mapped, target, block(500, 600)], flat, drafts)
    expect(access.name).toMatch(/^Access to Cutblock -400,-50 · from Road west$/)
    // Chainage starts on the mapped road and ends on the block edge.
    expect(access.points[0].coordinate[0]).toBeCloseTo(point(-600, 0)[0], 5)
    expect(nearestBlockEdge(target, access.points.at(-1)!.coordinate).distanceM).toBeLessThan(0.5)
  })

  it('gives a block already on a mapped road no new road, and starts from the drafts where there are no roads', () => {
    const drafts = regionalScenarioAlignments('test', centre, flat)
    const onRoad = block(-400, -50)
    expect(
      scenarioAccessRoads('test', [onRoad, road('edge', point(-410, -100), point(-410, 100))], flat, drafts),
    ).toEqual([])
    const [access] = scenarioAccessRoads('test', [onRoad], flat, drafts)
    expect(access.name).toContain('from the draft start')
    expect(access.points[0].coordinate).toEqual(drafts[0].points[0].coordinate)
  })

  it('fits the view to a block the active road reaches', () => {
    const project = createDemoProject()
    const active = project.alignments[0]
    const end = active.points.at(-1)!.coordinate
    const reached: ContextFeature = {
      id: 'reached',
      name: 'Reached block',
      kind: 'harvest',
      geometry: {
        type: 'Polygon',
        coordinates: [[end, [end[0] + 0.01, end[1]], [end[0] + 0.01, end[1] + 0.01], [end[0], end[1] + 0.01], end]],
      },
    }
    const fit = roadPlanFitCoordinates({ ...project, context: [reached] }, 'active', active)
    expect(fit).toContainEqual([end[0] + 0.01, end[1] + 0.01])
    expect(roadPlanFitCoordinates(project, 'active', active)).toHaveLength(active.points.length)
  })
})
