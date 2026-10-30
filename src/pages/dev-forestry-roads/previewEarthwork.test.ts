import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createDemoProject } from './terrain'
import { previewEarthwork } from './previewEarthwork'
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
    expect(display).toEqual({ faces: [], edges: [] })
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
})
