import { describe, expect, it } from 'vitest'
import { designProfileAt, distance, horizontalCurveSummary, offsetCoordinate, analyzeRoad } from './engine'
import { landXml } from './designExports'
import {
  checkElements,
  landXmlImportSummary,
  landXmlRoads,
  parseLandXml,
  readXml,
  type LandXmlElement,
} from './landXmlImport'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import type { Alignment, Coordinate, TerrainSource } from './types'

const origin: Coordinate = [-122.75, 53.917]
const at = (east: number, north: number) =>
  offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
const road: Alignment = {
  id: 'r',
  name: 'Spur 7 & <main>',
  color: '#000000',
  points: [
    { id: 'a', coordinate: at(0, 0), radiusM: 0 },
    { id: 'b', coordinate: at(0, 150), radiusM: 60 },
    { id: 'c', coordinate: at(120, 220), radiusM: 50, spiralM: 20 },
    { id: 'd', coordinate: at(120, 380), radiusM: 0 },
  ],
  vertical: [
    { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'v1', chainage: 180, elevation: 809, curveLength: 40 },
    { id: 'v2', chainage: 380, elevation: 805, curveLength: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
const flat: TerrainSource = { elevationAt: () => 800 }
const options = { newId: () => 'imported', color: () => '#123456', template: { ...DEFAULT_TEMPLATE } }

describe('XML reader', () => {
  it('reads minified, namespaced XML with entities and self-closing tags', () => {
    const doc = readXml(
      '<?xml version="1.0"?><x:LandXML xmlns:x="http://www.landxml.org/schema/LandXML-1.2"><Units><Metric linearUnit="meter"/></Units><Project name="A &amp; B"/><!-- note --><P>1 2</P></x:LandXML>',
    )
    const root = doc.children[0]
    expect(root.name).toBe('LandXML')
    expect(root.children.map((c) => c.name)).toEqual(['Units', 'Project', 'P'])
    expect(root.children[1].attributes.name).toBe('A & B')
    expect(root.children[2].text).toBe('1 2')
  })
  it('refuses unbalanced XML', () => {
    expect(() => readXml('<LandXML><Units></LandXML>')).toThrow(/closes/)
  })
})

describe('LandXML alignment import', () => {
  const analysis = analyzeRoad(road, flat, DEFAULT_ROAD_SETTINGS)
  const grid = localMetricGrid(origin)
  const exported = landXml({
    name: 'Job',
    alignment: road,
    analysis,
    terrain: { kind: 'geotiff', name: 'DEM', resolutionM: 1, verticalReference: 'CGVD2013' },
    ...grid,
  })
  it('reads back the road this workspace exports, curves, spiral and profile', () => {
    const { roads, epsg } = landXmlRoads(exported, options)
    expect(epsg).toBe(grid.epsg)
    expect(roads).toHaveLength(1)
    const [imported] = roads
    expect(imported.alignment.name).toBe('Spur 7 & <main>')
    expect(imported.alignment.points).toHaveLength(4)
    // Arcs are written at their grid chord with the model's deflection, so PIs come back within a few cm.
    imported.alignment.points.forEach((p, i) =>
      expect(distance(p.coordinate, road.points[i].coordinate)).toBeLessThan(0.1),
    )
    expect(imported.alignment.points[1].radiusM).toBeCloseTo(60, 1)
    expect(imported.alignment.points[2].radiusM).toBeCloseTo(50, 1)
    expect(imported.alignment.points[2].spiralM).toBeCloseTo(20, 1)
    const curves = horizontalCurveSummary(imported.alignment)
    expect(curves).toHaveLength(2)
    // The profile lands where it was: level at 180 m along the road within a centimetre.
    expect(imported.alignment.vertical).toHaveLength(3)
    expect(designProfileAt(imported.alignment, 180)!.elevation).toBeCloseTo(designProfileAt(road, 180)!.elevation, 1)
    // Every check of our own export passes.
    expect(imported.source.checks.filter((c) => !c.passed)).toEqual([])
    expect(landXmlImportSummary(imported)).toMatch(/joints \(1 mm\) all within, directions \(0.06°\) all within/)
  })
  it('writes 3D feature lines as plan features', () => {
    expect(exported).toMatch(/<PlanFeatures name="[^"]+ feature lines">/)
    expect(exported).toMatch(/combined scale factor is 0\.999\d{5}/)
    for (const name of ['CL_3D', 'EDGE_L', 'EDGE_R', 'CATCH_L', 'CATCH_R'])
      expect(exported).toContain(`<PlanFeature name="${name}"`)
    const list = /<PlanFeature name="EDGE_L"[^>]*>.*?<PntList3D>([^<]+)<\/PntList3D>/
      .exec(exported)![1]
      .trim()
      .split(' ')
    expect(list.length % 3).toBe(0)
    expect(list.length / 3).toBe(analysis.stations.length)
  })
  it('reads the same file minified', () => {
    const minified = exported.replace(/>\s+</g, '><')
    expect(landXmlRoads(minified, options).roads[0].alignment.points).toHaveLength(4)
  })
  it('refuses a file with no coordinate system, or one in degrees', () => {
    const noCrs = exported.replace(/<CoordinateSystem[^>]*\/>/, '')
    expect(() => landXmlRoads(noCrs, options)).toThrow(/names no coordinate system/)
    const degrees = exported.replace(/epsgCode="\d+"/, 'epsgCode="4326"')
    expect(() => landXmlRoads(degrees, options)).toThrow(/not a projected coordinate system/)
  })
  it('converts feet', () => {
    const feet = parseLandXml(
      '<LandXML><Units><Imperial linearUnit="USSurveyFoot"/></Units><Alignments><Alignment name="F" staStart="0"><CoordGeom><Line><Start>0 0</Start><End>1000 0</End></Line></CoordGeom></Alignment></Alignments></LandXML>',
    )
    expect(feet.alignments[0].gridLengthM).toBeCloseTo(304.8006, 4)
  })
})

describe('alignment checks (Lima specification T8)', () => {
  /** An R 100 arc turning left from heading east, of the given central angle, starting at (0, 0). */
  const arc = (angle: number, stated: number): LandXmlElement => ({
    kind: 'curve',
    start: [0, 0],
    centre: [0, 100],
    end: [100 * Math.sin(angle), 100 - 100 * Math.cos(angle)],
    radius: 100,
    rotation: 'ccw',
    station: 0,
    length: stated,
  })
  it('passes a 5 mm length difference and fails 8 mm', () => {
    const [pass] = checkElements([arc(50.005 / 100, 50)])
    expect(pass.kind).toBe('length')
    expect(pass.passed).toBe(true)
    const [fail] = checkElements([arc(50.008 / 100, 50)])
    expect(fail.passed).toBe(false)
  })
  it('fails a 1.5 mm joint, passes a 0.05° kink and fails 0.07°', () => {
    const line = (start: [number, number], degrees: number): LandXmlElement => ({
      kind: 'line',
      start,
      end: [start[0] + 100 * Math.cos((degrees * Math.PI) / 180), start[1] + 100 * Math.sin((degrees * Math.PI) / 180)],
      station: null,
      length: null,
    })
    const first = line([0, 0], 0)
    const joint = checkElements([first, line([100.0015, 0], 0)]).find((c) => c.kind === 'joint')!
    expect(joint.passed).toBe(false)
    const small = checkElements([first, line([100, 0], 0.05)]).find((c) => c.kind === 'kink')!
    expect(small.passed).toBe(true)
    const large = checkElements([first, line([100, 0], 0.07)]).find((c) => c.kind === 'kink')!
    expect(large.passed).toBe(false)
  })
})
