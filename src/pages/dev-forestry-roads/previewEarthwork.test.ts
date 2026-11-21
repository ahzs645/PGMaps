import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createDemoProject } from './terrain'
import { previewEarthwork } from './previewEarthwork'
import { sectionSampleAt } from './sectionGeometry'
import type { Coordinate, RoadStation, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const vertex = (station: RoadStation, offset: number, z: number) => ({ x: offset, y: station.chainage, z })
const east = (lng: number) => ((lng - origin[0]) * Math.PI * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180)) / 180

function analysis(height: number, terrain: TerrainSource = { elevationAt: () => 800 }, reach = 30, rise = 0) {
  const project = createDemoProject()
  const alignment = project.alignments[0]
  alignment.points = [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
  ]
  alignment.vertical = [
    { id: 'v0', chainage: 0, elevation: height, curveLength: 0 },
    { id: 'v1', chainage: 100, elevation: height + rise, curveLength: 0 },
  ]
  alignment.template = {
    leftWidth: 3,
    rightWidth: 3,
    crossfallPercent: 0,
    cutSlope: 1,
    fillSlope: 1,
    ditchWidth: 0,
    ditchDepth: 0,
    surfaceDepth: 0,
  }
  alignment.overrides = []
  alignment.engineering = undefined
  return analyzeRoad(alignment, terrain, { ...project.settings, crossSectionHalfWidth: reach })
}

describe('3D earthwork with incomplete sections', () => {
  it('retains supported high fill and deep cut to the reach without inventing daylight or quantities', () => {
    for (const height of [770, 830]) {
      const road = analysis(height)
      const before = structuredClone(road)
      const display = previewEarthwork(road.stations, vertex)
      expect(display.faces).toHaveLength(12)
      expect(new Set(display.faces.map((face) => face.fill))).toEqual(new Set([height > 800 ? '#79a9d9' : '#dca365']))
      expect(display.faces.flatMap((face) => face.vertices).every((p) => Math.abs(p.x) <= 30)).toBe(true)
      expect(display.edges.length).toBeGreaterThan(0)
      expect(display.edges.every((edge) => edge.reason === 'reach')).toBe(true)
      expect(road.stations.every((s) => !s.complete && s.leftDaylightM === null && s.cutAreaM2 === null)).toBe(true)
      expect(road).toEqual(before)
    }
  })

  it('keeps the closed side and the supported part of a side that loses terrain', () => {
    const road = analysis(810, { elevationAt: (lng) => (east(lng) > 8 ? NaN : 800) })
    expect(road.stations.every((s) => s.leftDaylightM !== null && s.rightDaylightM === null)).toBe(true)
    const display = previewEarthwork(road.stations, vertex)
    expect(display.faces).toHaveLength(12)
    expect(display.faces.flatMap((face) => face.vertices).every((p) => p.x <= 8)).toBe(true)
    expect(display.edges.every((edge) => edge.reason === 'terrain' && edge.a.x > 0)).toBe(true)
    expect(display.edges.length).toBeGreaterThan(0)
  })

  it('stops at the first cross-section gap even when terrain resumes farther out', () => {
    const road = analysis(820, { elevationAt: (lng) => (east(lng) > 8 && east(lng) < 10 ? NaN : 800) })
    expect(road.stations.some((s) => s.section.some((p) => p.offset > 11 && p.ground === 800))).toBe(true)
    const display = previewEarthwork(road.stations, vertex)
    expect(display.faces.flatMap((face) => face.vertices).every((p) => p.x <= 8)).toBe(true)
    expect(display.edges.some((edge) => edge.reason === 'terrain')).toBe(true)
  })

  it('does not bridge a missing intermediate station hidden by longitudinal decimation', () => {
    const road = analysis(810)
    const middle = road.stations[Math.floor(road.stations.length / 2)]
    middle.section = middle.section.map((p) => ({ ...p, ground: null }))
    const display = previewEarthwork([road.stations[0], middle, road.stations.at(-1)!], vertex)
    expect(display).toEqual({ faces: [], edges: [], seams: [] })
    expect(previewEarthwork(road.stations.slice(0, 2), vertex).faces).toHaveLength(12)
  })

  it('renders a 32.1 percent grade and removes unfinished edges once the section reach closes it', () => {
    const short = analysis(800, undefined, 30, 32.1)
    const long = analysis(800, undefined, 40, 32.1)
    expect(short.maxGradePercent).toBeCloseTo(32.1)
    expect(previewEarthwork(short.stations, vertex).edges.length).toBeGreaterThan(0)
    expect(long.coveragePercent).toBeCloseTo(100)
    const display = previewEarthwork(long.stations, vertex)
    expect(display.faces).toHaveLength(12)
    expect(display.edges).toHaveLength(0)
  })

  it('makes seams where both stations’ batters met the ground and carries the ground under each open edge', () => {
    const closed = analysis(800, undefined, 40, 32.1)
    const display = previewEarthwork(closed.stations, vertex)
    expect(display.edges).toHaveLength(0)
    expect(display.seams).toHaveLength(2 * (closed.stations.length - 1))
    for (const { a, b } of display.seams) {
      // Each end is a station's catch point: at its daylight offset, where the design is the ground.
      for (const p of [a, b]) {
        const station = closed.stations.find((s) => s.chainage === p.y)!
        expect(Math.abs(p.x)).toBeCloseTo(p.x < 0 ? station.leftDaylightM! : station.rightDaylightM!, 9)
        expect(p.z).toBeCloseTo(sectionSampleAt(station, p.x).ground!, 6)
      }
      expect(b.y).toBeGreaterThan(a.y)
    }

    const open = analysis(770)
    const stopped = previewEarthwork(open.stations, vertex)
    expect(stopped.seams).toHaveLength(0)
    expect(stopped.edges.length).toBeGreaterThan(0)
    for (const edge of stopped.edges) {
      const at = (p: { x: number; y: number }) =>
        sectionSampleAt(open.stations.find((s) => s.chainage === p.y)!, p.x).ground
      expect(edge.groundA).toBe(at(edge.a))
      expect(edge.groundB).toBe(at(edge.b))
      // A deep cut stopped at the reach: the ground stands above the batter's last point.
      expect(edge.groundA).toBeGreaterThan(edge.a.z)
    }

    // One side caught, the other stopped at missing terrain: seams on the caught side only.
    const half = previewEarthwork(analysis(810, { elevationAt: (lng) => (east(lng) > 8 ? NaN : 800) }).stations, vertex)
    expect(half.seams.length).toBeGreaterThan(0)
    expect(half.seams.every(({ a, b }) => a.x < 0 && b.x < 0)).toBe(true)
    expect(half.edges.every(({ a, b }) => a.x > 0 && b.x > 0)).toBe(true)
  })

  it('makes one straight seam a side where the road edge is itself the catch point', () => {
    const level = analysis(800)
    expect(level.stations.every((s) => s.complete && s.leftDaylightM === 3 && s.rightDaylightM === 3)).toBe(true)
    const display = previewEarthwork(level.stations, vertex)
    expect(display.faces).toHaveLength(0)
    expect(display.edges).toHaveLength(0)
    const first = level.stations[0].chainage,
      last = level.stations.at(-1)!.chainage
    expect(display.seams.map(({ a, b }) => [a.x, a.y, b.x, b.y])).toEqual([
      [-3, first, -3, last],
      [3, first, 3, last],
    ])
  })
})
