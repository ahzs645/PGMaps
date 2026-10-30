import { describe, it, expect } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import type { Alignment, Coordinate, RoadSettings } from './types'
const origin: Coordinate = [-122.8, 53.9]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 1,
}
function road(elevation: number): Alignment {
  return {
    id: 'r',
    name: 'Range endpoint review',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation, curveLength: 0 },
      { id: 'e', chainage: 100, elevation, curveLength: 0 },
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
    engineering: createEngineeringDesign(),
  }
}
const flat = { elevationAt: () => 800 }
describe('reviewed section consistency at a terminal assignment boundary', () => {
  it('keeps approach-side stripping at the road-end section', () => {
    const a = road(802)
    a.engineering!.materials = [
      {
        id: 'strip',
        name: 'Topsoil',
        color: '#806040',
        cutRate: 1,
        reusableFraction: 0,
        compactionFactor: 1,
        purpose: 'stripping',
      },
    ]
    a.engineering!.sitePreparation = [
      {
        id: 'p',
        start: 0,
        end: 100,
        depthM: 0.2,
        materialId: 'strip',
        leftInsideM: 0,
        rightInsideM: 0,
        leftOutsideM: 0.3,
        rightOutsideM: 0.3,
      },
    ]
    const r = analyzeRoad(a, flat, settings),
      last = r.stations.at(-1)!,
      middle = r.stations.find((s) => s.chainage === 50)!
    expect(last.section.find((p) => p.offset === 0)?.preparedGround).toBeCloseTo(799.8, 6)
    expect(last.leftDaylightM).toBeCloseTo(middle.leftDaylightM!, 6)
    expect(last.clearingWidthM).toBeCloseTo(middle.clearingWidthM!, 6)
  })
  it('keeps the assigned exact fill-material slope at the road-end section', () => {
    const a = road(802)
    a.engineering!.materials = [
      {
        id: 'rock',
        name: 'Rock fill',
        color: '#555555',
        cutRate: 1,
        reusableFraction: 1,
        compactionFactor: 1,
        fillSlope: 0.5,
      },
    ]
    a.engineering!.fillRequirements = [
      { id: 'f', start: 0, end: 100, layer: 'subgrade', materialId: 'rock', replaceable: false },
    ]
    const r = analyzeRoad(a, flat, settings)
    expect(r.stations.at(-1)!.rightDaylightM).toBeCloseTo(4, 6)
  })
  it('keeps cut material geometry aligned with approach-side material classification', () => {
    const a = road(798)
    a.engineering!.materials = [
      {
        id: 'rock',
        name: 'Rock',
        color: '#555555',
        cutRate: 10,
        reusableFraction: 1,
        compactionFactor: 1,
        cutSlope: 0.5,
      },
    ]
    a.engineering!.strata = [{ id: 'h', start: 0, end: 100, materialId: 'rock', topDepthM: 0, bottomDepthM: null }]
    const r = analyzeRoad(a, flat, settings)
    expect(r.stations.at(-1)!.rightDaylightM).toBeCloseTo(4, 6)
  })
})
