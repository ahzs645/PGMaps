import { describe, expect, it } from 'vitest'
import {
  alignmentLength,
  analyzeCable,
  analyzeRoad,
  beyondReachFlag,
  curveDesignAt,
  isBeyondReachFlag,
  distance,
  effectiveWidths,
  nearestStation,
  offsetCoordinate,
  positionAt,
} from './engine'
import type { Alignment, CableLine, ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const north = (metres: number) => offsetCoordinate(origin, 0, metres)
const xy = (east: number, n: number) =>
  offsetCoordinate(origin, (Math.atan2(east, n) * 180) / Math.PI, Math.hypot(east, n))
const local = (p: Coordinate) => ({
  east: (((p[0] - origin[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180),
  north: (((p[1] - origin[1]) * Math.PI) / 180) * 6371008.8,
})
const flat: TerrainSource = { elevationAt: () => 800 }

it('resolves D-line offsets and reversed yarder roles before sampling terrain and sag', () => {
  const line: CableLine = {
    id: 'offset-cable',
    name: 'Offset cable',
    start: origin,
    end: north(100),
    startHeight: 25,
    endHeight: 7,
    deflectionPercent: 5,
    startOffsetM: 20,
    endOffsetM: 30,
    yarderAt: 'end',
  }
  const samples: Coordinate[] = []
  const result = analyzeCable(line, {
    elevationAt: (lng, lat) => {
      samples.push([lng, lat])
      return 800
    },
  })
  expect(result.length).toBeCloseTo(50, 5)
  expect(distance(samples[0], north(20))).toBeLessThan(1e-5)
  expect(distance(samples[1], north(70))).toBeLessThan(1e-5)
  expect(result.samples[0].cable).toBe(807)
  expect(result.samples.at(-1)!.cable).toBe(825)
  const middle = result.samples.find((p) => Math.abs(p.distance - 25) < 1e-4)!
  expect(middle.cable).toBeCloseTo(813.5, 5)
  expect(() => analyzeCable({ ...line, endOffsetM: 90 }, flat)).toThrow(/collapse|reverse/)
})
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 0.8,
}
function alignment(length = 100, height = 800): Alignment {
  return {
    id: 'main',
    name: 'Main',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: north(length), radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation: height, curveLength: 0 },
      { id: 'v1', chainage: length, elevation: height, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0,
    },
    overrides: [],
  }
}

describe('horizontal stationing and curves', () => {
  it('uses horizontal metres independent of elevation and preserves true bearing', () => {
    const road = alignment()
    expect(distance(origin, north(100))).toBeCloseTo(100, 7)
    expect(alignmentLength(road)).toBeCloseTo(100, 7)
    const halfway = positionAt(road, 50)
    expect(distance(origin, halfway.coordinate)).toBeCloseTo(50, 6)
    expect(Math.min(halfway.bearing, 360 - halfway.bearing)).toBeLessThan(1e-5)
    expect(distance(positionAt(road, 1000).coordinate, north(100))).toBeLessThan(1e-6)
  })

  it('fits an actual circular 90-degree fillet with the requested radius', () => {
    const road = alignment(200)
    road.points = [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'pi', coordinate: xy(0, 100), radiusM: 20 },
      { id: 'b', coordinate: xy(100, 100), radiusM: 0 },
    ]
    const expectedLength = 200 - 40 + (Math.PI * 20) / 2
    expect(alignmentLength(road)).toBeCloseTo(expectedLength, 4)
    const result = analyzeRoad(road, flat, settings)
    const curved = result.stations.find((s) => Math.abs(s.chainage - 90) < 0.001)!
    expect(curved.curveRadiusM).toBe(20)
    expect(curved.flags).toContain('Radius below 25 m')
    const mid = positionAt(road, 80 + (20 * Math.PI) / 4)
    expect(distance(mid.coordinate, xy(20 - Math.SQRT1_2 * 20, 80 + Math.SQRT1_2 * 20))).toBeLessThan(0.001)
    expect(result.centerline.length).toBeGreaterThan(20)
  })

  it('retains and flags a sharp PI when a requested curve cannot fit', () => {
    const road = alignment(40)
    road.points = [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'pi', coordinate: xy(0, 20), radiusM: 30 },
      { id: 'b', coordinate: xy(20, 20), radiusM: 0 },
    ]
    const result = analyzeRoad(road, flat, settings)
    expect(result.length).toBeCloseTo(40, 4)
    expect(result.warnings.some((w) => w.includes('does not fit'))).toBe(true)
    expect(result.stations.some((s) => s.curveRadiusM === 0 && s.flags.some((f) => f.includes('Sharp')))).toBe(true)
  })

  it('rejects adjacent overlapping fillets without silently changing their radii', () => {
    const road = alignment(300)
    road.points = [xy(0, 0), xy(0, 100), xy(100, 100), xy(100, 200)].map((coordinate, i) => ({
      id: `${i}`,
      coordinate,
      radiusM: 60,
    }))
    const result = analyzeRoad(road, flat, settings)
    expect(result.length).toBeCloseTo(300, 4)
    expect(result.warnings.filter((w) => w.includes('overlaps an adjacent')).length).toBe(2)
  })
})

describe('formation geometry and quantities', () => {
  it('gives zero earthwork for a flat formation exactly on flat ground', () => {
    const result = analyzeRoad(alignment(), flat, settings)
    expect(result.cutVolumeM3).toBeCloseTo(0, 8)
    expect(result.fillVolumeM3).toBeCloseTo(0, 8)
    expect(result.coveragePercent).toBeCloseTo(100, 6)
    expect(result.clearingAreaM2).toBeCloseTo(600, 5)
    expect(result.stations.every((s) => s.leftDaylightM === 3 && s.rightDaylightM === 3)).toBe(true)
  })

  it('integrates a 1 m cut as a six-metre rectangle plus two daylight triangles', () => {
    const result = analyzeRoad(alignment(100, 799), flat, settings)
    expect(result.stations[5].cutAreaM2).toBeCloseTo(6 + 2 * 0.5, 6)
    expect(result.cutVolumeM3).toBeCloseTo(700, 4)
    expect(result.fillVolumeM3).toBeCloseTo(0, 6)
    expect(result.balanceM3).toBeCloseTo(560, 4)
    expect(result.stations.at(-1)!.massM3).toBeCloseTo(560, 4)
  })

  it('uses the independently specified fill batter and cost units', () => {
    const road = alignment(100, 801)
    road.template.fillSlope = 2
    road.template.surfaceDepth = 0.2
    const result = analyzeRoad(road, flat, settings)
    expect(result.fillVolumeM3).toBeCloseTo(800, 4)
    expect(result.surfaceVolumeM3).toBeCloseTo(120, 5)
    expect(result.clearingAreaM2).toBeCloseTo(1000, 4)
    expect(result.estimatedCost).toBeCloseTo(800 * 3 + 120 * 4 + 1000 * 0.5, 4)
    expect(result.balanceM3).toBeCloseTo(-800, 4)
  })

  it('says a batter ran past the section reach, rather than blaming the terrain, when the road is too high', () => {
    // 30 m of fill on a 1:1 batter catches 33 m out; the reach stops at 30 m.
    const high = analyzeRoad(alignment(100, 830), flat, settings)
    expect(high.coveragePercent).toBe(0)
    for (const station of high.stations) {
      expect(station.complete).toBe(false)
      expect(station.flags).toEqual(expect.arrayContaining([beyondReachFlag('Left', 30), beyondReachFlag('Right', 30)]))
    }
    expect(beyondReachFlag('Right', 30)).toBe('Right daylight unresolved: batter runs past the 30 m section reach')
    // The same reach closes it once it is long enough.
    expect(
      analyzeRoad(alignment(100, 830), flat, { ...settings, crossSectionHalfWidth: 40 }).coveragePercent,
    ).toBeCloseTo(100, 6)
    // Terrain that ends before the catch point is a terrain gap, not a reach problem.
    const edge: TerrainSource = {
      elevationAt: (lng) => (local([lng, origin[1]]).east > 10 ? Number.NaN : 800),
    }
    const gap = analyzeRoad(alignment(100, 810), edge, settings)
    expect(gap.stations[3].flags.some(isBeyondReachFlag)).toBe(false)
    expect(gap.stations[3].flags).toContain('Right daylight unresolved: extend section or check terrain')
  })

  it('includes crossfall in both running surface and daylight cut', () => {
    const road = alignment()
    road.template.crossfallPercent = 3
    const result = analyzeRoad(road, flat, settings)
    const expectedArea = 2 * ((3 * 0.09) / 2 + 0.09 ** 2 / 2)
    expect(result.stations[5].cutAreaM2).toBeCloseTo(expectedArea, 7)
    expect(result.cutVolumeM3).toBeCloseTo(expectedArea * 100, 5)
  })

  it('adds explicit V-ditch excavation on cut sides only', () => {
    const road = alignment(100, 799)
    road.template.ditchWidth = 2
    road.template.ditchDepth = 0.5
    const result = analyzeRoad(road, flat, settings)
    expect(result.stations[5].cutAreaM2).toBeCloseTo(6 + 2 * (2 + 0.5) + 1, 5)
    expect(result.cutVolumeM3).toBeCloseTo(1200, 3)
    const fill = analyzeRoad(
      { ...road, vertical: road.vertical.map((p) => ({ ...p, elevation: 801 })) },
      flat,
      settings,
    )
    expect(fill.fillVolumeM3).toBeCloseTo(700, 4)
  })

  it('splits cut and fill where a sloped terrain crosses the formation', () => {
    const slope: TerrainSource = { elevationAt: (lng, lat) => 800 + local([lng, lat]).east * 0.2 }
    const road = alignment()
    road.template.fillSlope = 1.5
    const result = analyzeRoad(road, slope, settings)
    const section = result.stations[5]
    expect(section.cutAreaM2).toBeCloseTo(1.125, 3)
    expect(section.fillAreaM2).toBeCloseTo(1.2857142857, 3)
    expect(section.leftDaylightM).toBeCloseTo(4.2857142857, 3)
    expect(section.rightDaylightM).toBeCloseTo(3.75, 3)
  })

  it('uses a shortened final interval rather than multiplying by nominal spacing', () => {
    const result = analyzeRoad(alignment(95, 799), flat, settings)
    expect(result.stations.at(-1)!.chainage).toBeCloseTo(95, 5)
    expect(result.stations.at(-1)!.cutVolumeM3).toBeCloseTo(35, 5)
    expect(result.cutVolumeM3).toBeCloseTo(95 * 7, 4)
  })
})

describe('vertical design and station-specific widths', () => {
  it('calculates 10 percent from 10 m rise over 100 horizontal metres', () => {
    const road = alignment()
    road.vertical[1].elevation = 810
    const result = analyzeRoad(road, flat, { ...settings, maxGradePercent: 8 })
    expect(result.maxGradePercent).toBeCloseTo(10, 8)
    expect(result.stations[5].designElevation).toBeCloseTo(805, 6)
    expect(result.stations[5].groundElevation).toBe(800)
    expect(result.stations[5].gradePercent).toBe(10)
    expect(result.stations[5].flags).toContain('Grade exceeds 8%')
  })

  it('has an independent vertical design with tangent-continuous parabolic curves', () => {
    const road = alignment(200)
    road.vertical = [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'pvi', chainage: 100, elevation: 805, curveLength: 40 },
      { id: 'e', chainage: 200, elevation: 800, curveLength: 0 },
    ]
    const result = analyzeRoad(road, flat, settings)
    expect(nearestStation(result.stations, 80)!.designElevation).toBeCloseTo(804, 7)
    expect(nearestStation(result.stations, 90)!.designElevation).toBeCloseTo(804.375, 7)
    expect(nearestStation(result.stations, 100)!.designElevation).toBeCloseTo(804.5, 7)
    expect(nearestStation(result.stations, 110)!.gradePercent).toBeCloseTo(-2.5, 7)
    expect(nearestStation(result.stations, 120)!.gradePercent).toBeCloseTo(-5, 7)
    expect(result.stations.every((s) => s.groundElevation === 800)).toBe(true)
  })

  it('warns and uses tangents when vertical curves overlap', () => {
    const road = alignment(200)
    road.vertical = [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'p1', chainage: 50, elevation: 802, curveLength: 80 },
      { id: 'p2', chainage: 100, elevation: 805, curveLength: 80 },
      { id: 'e', chainage: 200, elevation: 800, curveLength: 0 },
    ]
    const result = analyzeRoad(road, flat, settings)
    expect(result.warnings.filter((w) => w.includes('overlaps its neighbour'))).toHaveLength(2)
    expect(nearestStation(result.stations, 50)!.designElevation).toBe(802)
  })

  it('preserves independent left/right widths and the requested turnout tapers', () => {
    const road = alignment(100, 799)
    road.overrides = [
      { id: 't', name: 'Turnout', kind: 'turnout', start: 20, end: 80, taper: 10, side: 'left', extraWidth: 6 },
    ]
    expect(effectiveWidths(road, 20)).toEqual({ leftWidth: 3, rightWidth: 3 })
    expect(effectiveWidths(road, 25)).toEqual({ leftWidth: 6, rightWidth: 3 })
    expect(effectiveWidths(road, 30)).toEqual({ leftWidth: 9, rightWidth: 3 })
    expect(effectiveWidths(road, 75)).toEqual({ leftWidth: 6, rightWidth: 3 })
    expect(effectiveWidths(road, 80)).toEqual({ leftWidth: 3, rightWidth: 3 })
    road.template.surfaceDepth = 0.2
    const turnout = analyzeRoad(road, flat, settings)
    expect(turnout.cutVolumeM3).toBeCloseTo(700 + 300, 4)
    expect(turnout.surfaceVolumeM3).toBeCloseTo((600 + 300) * 0.2, 5)
    road.overrides[0].kind = 'landing'
    const landing = analyzeRoad(road, flat, settings)
    expect(landing.cutVolumeM3).toBeCloseTo(turnout.cutVolumeM3, 5)
    expect(landing.surfaceVolumeM3).toBeCloseTo(600 * 0.2, 5)
  })

  it('does not add overlapping width overrides twice', () => {
    const road = alignment()
    road.overrides = [
      { id: 'a', name: 'A', kind: 'landing', start: 20, end: 80, taper: 0, side: 'left', extraWidth: 6 },
      { id: 'b', name: 'B', kind: 'turnout', start: 40, end: 60, taper: 0, side: 'both', extraWidth: 8 },
    ]
    expect(effectiveWidths(road, 50)).toEqual({ leftWidth: 11, rightWidth: 11 })
  })

  it('uses terrain-following grades only when there is no vertical alignment', () => {
    const road = alignment()
    road.vertical = []
    const source = { elevationAt: (lng: number, lat: number) => 800 + local([lng, lat]).north * 0.05 }
    const result = analyzeRoad(road, source, settings)
    expect(result.maxGradePercent).toBeCloseTo(5, 5)
    expect(result.stations.every((s) => s.groundElevation === s.designElevation)).toBe(true)
    expect(result.warnings.some((w) => w.startsWith('No vertical alignment'))).toBe(true)
  })
})

describe('missing terrain and computation boundaries', () => {
  it('keeps gaps null, excludes missing intervals, and stops cumulative mass at the first gap', () => {
    const source = {
      elevationAt: (lng: number, lat: number) => {
        const p = local([lng, lat])
        return p.north > 45 && p.north < 55 ? NaN : 800
      },
    }
    const result = analyzeRoad(alignment(100, 799), source, settings)
    const hole = nearestStation(result.stations, 50)!
    expect(hole.groundElevation).toBeNull()
    expect(hole.cutAreaM2).toBeNull()
    expect(hole.cutVolumeM3).toBeNull()
    expect(hole.massM3).toBeNull()
    expect(result.coveragePercent).toBeCloseTo(80, 5)
    expect(result.cutVolumeM3).toBeCloseTo(80 * 7, 4)
    expect(result.stations.at(-1)!.cutVolumeM3).not.toBeNull()
    expect(result.stations.at(-1)!.massM3).toBeNull()
    expect(result.warnings.some((w) => w.includes('covered subtotals'))).toBe(true)
  })

  it('rejects a hole inside the running surface even when the centre and daylight are valid', () => {
    const source = {
      elevationAt: (lng: number, lat: number) => {
        const x = local([lng, lat]).east
        return x > 0.8 && x < 1.3 ? NaN : 800
      },
    }
    const result = analyzeRoad(alignment(), source, settings)
    expect(result.stations[5].groundElevation).toBe(800)
    expect(result.stations[5].cutAreaM2).toBeNull()
    expect(result.coveragePercent).toBe(0)
  })

  it('does not require terrain beyond an already-resolved daylight boundary', () => {
    const source = { elevationAt: (lng: number, lat: number) => (Math.abs(local([lng, lat]).east) > 4 ? NaN : 800) }
    const result = analyzeRoad(alignment(), source, settings)
    expect(result.coveragePercent).toBeCloseTo(100, 6)
    expect(result.stations[5].section.some((s) => s.ground === null)).toBe(true)
  })

  it('withholds quantities when batters run beyond the section width', () => {
    const road = alignment(100, 790)
    road.template.cutSlope = 2
    const narrow = analyzeRoad(road, flat, { ...settings, crossSectionHalfWidth: 10 })
    expect(narrow.coveragePercent).toBe(0)
    expect(narrow.stations[5].leftDaylightM).toBeNull()
    expect(narrow.stations[5].cutAreaM2).toBeNull()
    expect(analyzeRoad(road, flat, settings).coveragePercent).toBeCloseTo(100, 6)
  })

  it('handles an empty drawing and rejects malformed settings before sampling', () => {
    expect(analyzeRoad({ ...alignment(), points: [] }, flat, settings).stations).toEqual([])
    expect(nearestStation([], 50)).toBeUndefined()
    expect(() => analyzeRoad(alignment(), flat, { ...settings, stationInterval: 0 })).toThrow('station interval')
    expect(() => analyzeRoad(alignment(), flat, { ...settings, crossSectionHalfWidth: Infinity })).toThrow('finite')
    const duplicate = alignment()
    duplicate.vertical[1].chainage = 0
    expect(() => analyzeRoad(duplicate, flat, settings)).toThrow('distinct stations')
  })

  it('bounds station count and explicitly reports an increased sampling interval', () => {
    const result = analyzeRoad(alignment(6000), flat, { ...settings, stationInterval: 2, crossSectionHalfWidth: 5 })
    expect(result.stations.length).toBeLessThanOrEqual(3000)
    expect(result.warnings.some((w) => w.startsWith('Station spacing increased'))).toBe(true)
    expect(result.stations.at(-1)!.chainage).toBeCloseTo(6000, 5)
  })
})

describe('context intersections and geometric cable clearance', () => {
  it('puts stream crossings at their measured chainages, regardless of station interval', () => {
    const stream: ContextFeature = {
      id: 'stream',
      name: 'Creek',
      kind: 'stream',
      geometry: { type: 'LineString', coordinates: [xy(-20, 43), xy(0, 43), xy(20, 43)] },
    }
    const result = analyzeRoad(alignment(), flat, settings, [stream])
    expect(result.crossings).toHaveLength(1)
    expect(result.crossings[0].chainage).toBeCloseTo(43, 4)
    expect(nearestStation(result.stations, 43)!.chainage).toBeCloseTo(43, 4)
    expect(distance(result.crossings[0].coordinate, north(43))).toBeLessThan(0.001)
  })

  it('flags an avoidance polygon while respecting its interior hole', () => {
    const ring = (a: number, b: number) => [xy(-10, a), xy(10, a), xy(10, b), xy(-10, b), xy(-10, a)]
    const avoidance: ContextFeature = {
      id: 'avoid',
      name: 'Wet ground',
      kind: 'avoid',
      geometry: { type: 'Polygon', coordinates: [ring(25, 75), ring(45, 55)] },
    }
    const result = analyzeRoad(alignment(), flat, settings, [avoidance])
    expect(nearestStation(result.stations, 40)!.flags).toContain('Avoidance area: Wet ground')
    expect(nearestStation(result.stations, 50)!.flags).not.toContain('Avoidance area: Wet ground')
    expect(result.crossings).toHaveLength(4)
  })

  it('computes the assumed sag geometry without representing a tension solution', () => {
    const cable: CableLine = {
      id: 'd1',
      name: 'D-line',
      start: origin,
      end: north(100),
      startHeight: 20,
      endHeight: 20,
      deflectionPercent: 10,
    }
    const result = analyzeCable(cable, flat)
    expect(result.complete).toBe(true)
    expect(result.length).toBeCloseTo(100, 6)
    expect(result.minClearance).toBeCloseTo(10, 6)
    expect(result.samples[0].clearance).toBe(20)
    const ridge = {
      elevationAt: (lng: number, lat: number) =>
        800 + 15 * Math.max(0, 1 - Math.abs(local([lng, lat]).north - 50) / 10),
    }
    expect(analyzeCable(cable, ridge).minClearance).toBeCloseTo(-5, 5)
  })

  it('withholds a cable clearance minimum if any sampled terrain or anchor is missing', () => {
    const cable: CableLine = {
      id: 'd1',
      name: 'D-line',
      start: origin,
      end: north(100),
      startHeight: 20,
      endHeight: 20,
      deflectionPercent: 10,
    }
    const source = {
      elevationAt: (lng: number, lat: number) => (Math.abs(local([lng, lat]).north - 50) < 5 ? NaN : 800),
    }
    const result = analyzeCable(cable, source)
    expect(result.complete).toBe(false)
    expect(result.minClearance).toBeNull()
    expect(result.samples.some((s) => s.clearance === null)).toBe(true)
    expect(analyzeCable({ ...cable, end: origin }, flat).samples).toEqual([])
  })
})

describe('cross-section orientation', () => {
  // Sections are viewed looking up-station: the road's left is at negative offsets, drawn on the left.
  it.each([
    ['eastbound', xy(100, 0)],
    ['westbound', xy(-100, 0)],
    ['northbound', xy(0, 100)],
  ])('puts ground to the left of travel at negative offsets (%s)', (_, end) => {
    const road = alignment()
    road.points[1].coordinate = end
    road.vertical = [
      { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'v1', chainage: 100, elevation: 800, curveLength: 0 },
    ]
    road.template = { ...road.template, leftWidth: 2, rightWidth: 5 }
    // Ground rises toward the left of travel, worked out here without the engine's bearing.
    const heading = local(end)
    const length = Math.hypot(heading.east, heading.north)
    const left = { east: -heading.north / length, north: heading.east / length }
    const source = {
      elevationAt: (lng: number, lat: number) => {
        const p = local([lng, lat])
        return 800 + 0.2 * (p.east * left.east + p.north * left.north)
      },
    }
    const station = nearestStation(analyzeRoad(road, source, settings).stations, 50)!
    const at = (offset: number) => station.section.find((p) => Math.abs(p.offset - offset) < 0.2)!.ground!
    expect(at(-20)).toBeCloseTo(804, 1)
    expect(at(20)).toBeCloseTo(796, 1)
    // Each side's template component stays on its own side: cut uphill on the left, fill on the right.
    expect(station.leftWidth).toBe(2)
    expect(station.rightWidth).toBe(5)
    const cutLeft = station.section.filter((p) => p.offset < 0 && p.design !== null && p.ground! > p.design + 0.01)
    const fillRight = station.section.filter((p) => p.offset > 0 && p.design !== null && p.ground! < p.design - 0.01)
    expect(cutLeft.length).toBeGreaterThan(0)
    expect(fillRight.length).toBeGreaterThan(0)
  })
})

describe('U ditches, superelevation and curve widening', () => {
  it('adds a flat ditch bottom: a trapezoid instead of a V', () => {
    const road = alignment(100, 799)
    road.template = { ...road.template, ditchWidth: 2, ditchDepth: 0.5 }
    const v = nearestStation(analyzeRoad(road, flat, settings).stations, 50)!
    road.template = { ...road.template, ditchBottomWidth: 1 }
    const u = nearestStation(analyzeRoad(road, flat, settings).stations, 50)!
    // Each ditch grows from W·D/2 = 0.5 m² to (W + b)/2 · D = 0.75 m².
    expect(u.cutAreaM2! - v.cutAreaM2!).toBeCloseTo(0.5, 6)
    const bottom = u.section.filter((p) => p.offset > 3 && p.offset < 5 && Math.abs(p.design! - 798.5) < 1e-9)
    expect(Math.min(...bottom.map((p) => p.offset))).toBeCloseTo(3.5, 6)
    expect(Math.max(...bottom.map((p) => p.offset))).toBeCloseTo(4.5, 6)
  })

  it('superelevates and widens a curve from the design speed, running in over the runoff', () => {
    // North 200 m, then a right turn to the east with a 60 m radius.
    const corner = north(200)
    const road = alignment(200, 800)
    road.points = [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: corner, radiusM: 60 },
      { id: 'c', coordinate: offsetCoordinate(corner, 90, 200), radiusM: 0 },
    ]
    road.vertical = []
    road.template = { ...road.template, crossfallPercent: 3 }
    road.curveDesign = {
      designSpeedKmh: 40,
      maxSuperelevationPercent: 8,
      sideFrictionFactor: 0.15,
      runoffLengthM: 30,
      wideningVehicleLengthM: 12,
    }
    // Curve from 200 − 60 = 140 m to 140 + 60·π/2 ≈ 234 m.
    const middle = curveDesignAt(road, 187)!
    expect(middle.inside).toBe('right')
    // e = 40² / (127 · 60) − 0.15 = 0.06 → 6%; widening = 12² / 120 = 1.2 m.
    expect(middle.superPercent).toBeCloseTo(100 * (1600 / 7620 - 0.15), 6)
    expect(middle.extraWidth).toBeCloseTo(1.2, 6)
    expect(effectiveWidths(road, 187)).toEqual({ leftWidth: 3, rightWidth: 4.2 })
    expect(curveDesignAt(road, 125)!.ratio).toBeCloseTo(0.5, 6)
    expect(curveDesignAt(road, 100)).toBeNull()
    const station = nearestStation(analyzeRoad(road, flat, settings).stations, 190)!
    const z = (offset: number) => station.section.find((p) => Math.abs(p.offset - offset) < 1e-6)!.design!
    // Inside (right) edge falls e over 4.2 m; the outside (left) edge rises e over 3 m.
    const e = 1600 / 7620 - 0.15
    expect(z(4.2) - z(0)).toBeCloseTo(-e * 4.2, 6)
    expect(z(-3) - z(0)).toBeCloseTo(e * 3, 6)
  })
})
