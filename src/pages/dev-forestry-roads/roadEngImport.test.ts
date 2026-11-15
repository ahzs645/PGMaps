import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { alignmentLength, designProfileAt, horizontalCurveSummary } from './engine'
import { AlignmentCrsQuestion, landXmlRoads, parseLandXml } from './landXmlImport'
import {
  isRoadEngDesign,
  parseRoadEngDesign,
  ROADENG_FIT_DEVIATION_M,
  ROADENG_PLAN_TOLERANCE_M,
  ROADENG_PROFILE_TOLERANCE_M,
  roadEngImportSummary,
  roadEngRoads,
} from './roadEngImport'
import { DEFAULT_TEMPLATE } from './terrain'

// A synthetic design laid out as RoadEng's own files are, worked out by hand rather than with the
// reader's geometry: north 150 m, a 90° right-hand curve of R 50 m about (50 150), then east 100 m,
// in UTM zone 10 near Prince George. Profile: 900 m at the start, a VIP at station 200 (905 m) with
// a sag radius of 2,000 m, 902.5 m at the end.
const E0 = 515_000,
  N0 = 5_975_000,
  R = 50
const arc = (R * Math.PI) / 2
const total = 150 + arc + 100
const vip = { station: 200, elevation: 905, radius: -2000 }
const gIn = (vip.elevation - 900) / vip.station,
  gOut = (902.5 - vip.elevation) / (total - vip.station)
const curveLength = Math.abs(vip.radius * (gOut - gIn))
function planAt(s: number): [number, number] {
  if (s <= 150) return [E0, N0 + s]
  if (s <= 150 + arc) {
    const angle = Math.PI - (s - 150) / R
    return [E0 + 50 + R * Math.cos(angle), N0 + 150 + R * Math.sin(angle)]
  }
  return [E0 + 50 + (s - 150 - arc), N0 + 200]
}
function levelAt(s: number) {
  const start = vip.station - curveLength / 2
  if (Math.abs(s - vip.station) <= curveLength / 2) {
    const x = s - start
    return vip.elevation - (gIn * curveLength) / 2 + gIn * x + ((gOut - gIn) / (2 * curveLength)) * x * x
  }
  return s < vip.station ? 900 + gIn * s : vip.elevation + gOut * (s - vip.station)
}
const stationList = [...Array.from({ length: Math.floor(total / 10) + 1 }, (_, k) => k * 10), 150, 150 + arc, total]
  .filter((s, k, all) => s <= total && all.indexOf(s) === k)
  .sort((a, b) => a - b)
const record110 = (s: number, level = levelAt(s)) => {
  const [x, y] = planAt(s)
  const type = s === 0 || s === total ? 5 : s === 150 || s === 150 + arc ? 2 : 4
  return `110,${type},${x.toFixed(6)},${y.toFixed(6)},${level.toFixed(6)},${s.toFixed(6)},-1,0,0,,,256`
}
function ds2({
  pis = true,
  vips = true,
  level,
}: { pis?: boolean; vips?: boolean; level?: (s: number) => number } = {}) {
  return [
    '100,103,11,11.0.673.0, Softree Technical Systems Inc. - Location Line data file',
    ...(pis ? [`108,1,2,${R},${E0},${N0 + 200},0,-1,16.6666666667,5590,0.06,0.1,60,60,0.667,0.06,0.1,0,0,0`] : []),
    ...(vips ? [`109,1,4,${-vip.radius},${vip.station},${vip.elevation},0,-1,16.6666666667,0,0,-1`] : []),
    ...stationList.map((s) => record110(s, level?.(s))),
    '104,OB,Overburden (Default),100,400,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,8,',
  ].join('\r\n')
}
const dsn = (units = '10000') =>
  `[Software]\r\nVersion=11.000\r\nVersion2=11.0.673.0\r\n[design]\r\nsurface=Spur.terx\r\nunits=${units}\r\n`
function design(parts: Record<string, string>) {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(text)])))
}
const options = { fileName: 'Spur 7.dsnx', newId: () => 'r', color: () => '#123456', template: { ...DEFAULT_TEMPLATE } }

describe('RoadEng design import', () => {
  const file = design({ 'Location1.dsn': dsn(), 'Location1.ds2': ds2(), 'Location1.ds1': '\0'.repeat(72) })

  it('is recognised by its content, not its name', () => {
    expect(isRoadEngDesign(file.subarray(0, 4096))).toBe(true)
    expect(isRoadEngDesign(design({ 'Terrain1.ter': 'x' }))).toBe(false)
    expect(isRoadEngDesign(strToU8('<LandXML/>'))).toBe(false)
  })

  it('reads the units, version, terrain, PIs and profile', () => {
    const read = parseRoadEngDesign(file)
    expect(read).toMatchObject({ version: '11.0.673.0', unitM: 1, terrain: 'Spur.terx' })
    const [a] = read.alignments
    expect(a.pis).toEqual([{ xy: [E0, N0 + 200], radiusM: 50, turn: 'right', type: 2 }])
    expect(a.startStation).toBe(0)
    expect(a.endStation).toBeCloseTo(total, 5)
    // The profile runs from the start's level through the VIP to the end's, the curve as long as
    // its radius times its change of grade.
    expect(a.profile.map((p) => p.station)).toEqual([0, 200, a.endStation])
    expect(a.profile[1].curveLength).toBeCloseTo(curveLength, 6)
    expect(a.checks.planOffsetM).toBeLessThan(0.001)
    expect(Math.abs(a.checks.lengthDifferenceM)).toBeLessThan(0.001)
    expect(a.checks.profileDifferenceM!).toBeLessThan(0.001)
    expect(a.followsStations).toEqual({ plan: false, profile: false })
    expect(a.warnings).toEqual([])
  })

  it('reads a design without vertical PIs as having no profile: its levels are ground', () => {
    const [a] = parseRoadEngDesign(
      design({ 'Location1.dsn': dsn(), 'Location1.ds2': ds2({ vips: false, level: (s) => 880 + Math.sin(s) }) }),
    ).alignments
    expect(a.profile).toEqual([])
    expect(a.checks.profileDifferenceM).toBeNull()
  })

  it('keeps the ground levels of a road with no profile as its design-file ground', () => {
    const groundOnly = design({
      'Location1.dsn': dsn(),
      'Location1.ds2': ds2({ vips: false, level: (s) => 880 + 0.02 * s }),
    })
    const [road] = roadEngRoads(groundOnly, { ...options, epsg: 26910 }).roads
    expect(road.alignment.vertical).toEqual([])
    const ground = road.alignment.fileGround!
    expect(ground.source).toBe('Spur 7.dsnx station levels')
    // A straight grade thins to its two ends, in the road's chainage.
    expect(ground.points).toHaveLength(2)
    expect(ground.points[1][0]).toBeCloseTo(total * road.stationScale, 2)
    expect(ground.points[1][1]).toBeCloseTo(880 + 0.02 * total, 3)
    // A design with a profile records none: its levels are the design's.
    expect(roadEngRoads(file, { ...options, epsg: 26910 }).roads[0].alignment.fileGround).toBeUndefined()
  })

  it('asks for a CRS, never assumes one, and builds the road in the one given', () => {
    expect(() => roadEngRoads(file, options)).toThrow(AlignmentCrsQuestion)
    try {
      roadEngRoads(file, options)
    } catch (error) {
      const [minX, minY, maxX, maxY] = (error as AlignmentCrsQuestion).bounds
      expect([minX, minY]).toEqual([E0, N0])
      expect(maxX).toBeGreaterThanOrEqual(E0)
      expect(maxY).toBe(N0 + 200)
    }
    const { roads, design: read } = roadEngRoads(file, { ...options, epsg: 26910 })
    const [road] = roads
    expect(road.alignment.name).toBe('Spur 7')
    expect(road.alignment.points).toHaveLength(3)
    // The curve keeps the design's tangent points; its radius moves by the sphere's distortion of
    // the deflection, about 0.3 % here. The north–south leg measures 199.87 m on the sphere, and the
    // curve's 50 m tangent shrinks by the east–west leg's ratio, so it starts 150.03 m along.
    const [curve] = horizontalCurveSummary(road.alignment)
    expect(Math.abs(curve.start - 150)).toBeLessThan(0.2)
    expect(Math.abs(road.alignment.points[1].radiusM / 50 - 1)).toBeLessThan(0.005)
    // Spherical chainage against grid stations: the projection's scale factor, about 0.9996 here.
    expect(alignmentLength(road.alignment)).toBeCloseTo(total * road.stationScale, 6)
    // About 0.9984 here: UTM's scale factor and the sphere against the ellipsoid at 54° N, the
    // same ratio LandXML exports print (docs/forestry-road-design/exports-and-project-files.md).
    expect(road.stationScale).toBeGreaterThan(0.997)
    expect(road.stationScale).toBeLessThan(1.003)
    const middle = road.alignment.vertical[1]
    // Measured along the road like its station, so it scales with the chainage.
    expect(middle.curveLength).toBeCloseTo(curveLength * road.stationScale, 2)
    expect(designProfileAt(road.alignment, middle.chainage)!.elevation).toBeCloseTo(levelAt(200), 2)
    expect(roadEngImportSummary(road, read)).toMatch(
      /^Spur 7: 1 PIs, 3 PVIs; .*plan rebuilt from its PIs within 0\.0 mm of \d+ design stations.*RoadEng 11\.0\.673\.0\. Its terrain, Spur\.terx, is not read\.$/,
    )
  })

  it('follows the design’s own stations where its PIs do not rebuild them', () => {
    const missing = design({ 'Location1.dsn': dsn(), 'Location1.ds2': ds2({ pis: false }) })
    const [a] = parseRoadEngDesign(missing).alignments
    expect(a.checks.planOffsetM).toBeGreaterThan(ROADENG_PLAN_TOLERANCE_M)
    expect(a.followsStations.plan).toBe(true)
    expect(a.warnings.join(' ')).toMatch(/follows the design's own stations/)
    const [road] = roadEngRoads(missing, { ...options, epsg: 26910 }).roads
    // Measured on the fit, not assumed: these stations are 10 m chords of a 50 m curve, 0.25 m off it.
    expect(road.fitDeviationM!).toBeGreaterThan(0)
    expect(road.fitDeviationM!).toBeLessThan(ROADENG_FIT_DEVIATION_M + 0.25)
    expect(road.alignment.points.length).toBeGreaterThanOrEqual(3)
    expect(Math.abs(alignmentLength(road.alignment) / road.stationScale - total)).toBeLessThan(1)
  })

  it('thins levels its vertical PIs do not rebuild to within the tolerance', () => {
    const wavy = (s: number) => levelAt(s) + 0.5 * Math.sin(s / 20)
    const [a] = parseRoadEngDesign(design({ 'Location1.dsn': dsn(), 'Location1.ds2': ds2({ level: wavy }) })).alignments
    expect(a.followsStations.profile).toBe(true)
    expect(a.profile.every((p) => p.curveLength === 0)).toBe(true)
    expect(a.profile.length).toBeLessThan(a.stations.length)
    for (const s of a.stations) {
      const k = a.profile.findIndex((p) => p.station >= s.station)
      const [p, q] = k <= 0 ? [a.profile[0], a.profile[1]] : [a.profile[k - 1], a.profile[k]]
      const line = p.elevation + ((q.elevation - p.elevation) * (s.station - p.station)) / (q.station - p.station)
      expect(Math.abs(line - s.z)).toBeLessThanOrEqual(ROADENG_PROFILE_TOLERANCE_M)
    }
  })

  it('leaves a level that steps from its neighbours out of a profile that follows the stations', () => {
    // The cul-de-sac sample's first record sits 0.46 m below the next, 0.1 m on.
    const wavy = (s: number) => levelAt(s) + 0.5 * Math.sin(s / 20) - (s === 0 ? 30 : 0)
    const [a] = parseRoadEngDesign(design({ 'Location1.dsn': dsn(), 'Location1.ds2': ds2({ level: wavy }) })).alignments
    expect(a.profile[0].station).toBe(10)
    expect(a.warnings.join(' ')).toMatch(/station 0\.000 m steps more than 50 %/)
  })

  it('reads several alignments, project settings from the first', () => {
    const two = design({
      'Location1.dsn': dsn(),
      'Location1.ds2': ds2(),
      'Location2.dsn': '[design]\r\nInitialIndex=0\r\n',
      'Location2.ds2': ds2({ vips: false }),
    })
    const { roads } = roadEngRoads(two, { ...options, epsg: 26910 })
    expect(roads.map((road) => road.alignment.name)).toEqual(['Spur 7 · Location 1', 'Spur 7 · Location 2'])
  })

  it('refuses a design in feet without a CRS, unknown units and a damaged archive', () => {
    const feet = design({ 'Location1.dsn': dsn('3048'), 'Location1.ds2': ds2() })
    expect(parseRoadEngDesign(feet).unitM).toBe(0.3048)
    expect(() => roadEngRoads(feet, { ...options, epsg: 26910 })).toThrow(/in feet and names no coordinate system/)
    expect(() => parseRoadEngDesign(design({ 'Location1.dsn': dsn('12345'), 'Location1.ds2': ds2() }))).toThrow(
      /units code 12345/,
    )
    expect(() => parseRoadEngDesign(file.subarray(0, 200))).toThrow(/could not be unpacked/)
    expect(() => parseRoadEngDesign(design({ 'Location1.dsn': dsn() }))).toThrow(/holds no alignment/)
  })
})

// Softree's published sample projects (support.softree.com), read from a local copy and never
// committed: set ROADENG_SAMPLES to the folder holding the extracted archives.
const samples = process.env.ROADENG_SAMPLES
const sample = (path: string) => new Uint8Array(readFileSync(join(samples!, path)))
describe.skipIf(!samples || !existsSync(samples))('Softree sample designs', () => {
  it('rebuilds the LandXML sample and matches its own LandXML export', () => {
    const [a] = parseRoadEngDesign(sample('RoadEng-LandXML-Civil-3D/Align stage 1.dsnx')).alignments
    expect(a.checks.planOffsetM).toBeLessThan(0.001)
    const xml = parseLandXml(readFileSync(join(samples!, 'RoadEng-LandXML-Civil-3D/Road1.xml'), 'utf8'))
    const curves = xml.alignments[0].elements.filter((e) => e.kind === 'curve')
    expect(a.pis.map((p) => Math.round(p.radiusM * 1000) / 1000)).toEqual(
      curves.map((c) => Math.round(c.radius * 1000) / 1000),
    )
    expect(a.endStation - a.startStation).toBeCloseTo(xml.alignments[0].gridLengthM, 3)
    // Neither file states a CRS, and both are in feet, so neither can be placed.
    expect(() =>
      landXmlRoads(readFileSync(join(samples!, 'RoadEng-LandXML-Civil-3D/Road1.xml'), 'utf8'), options),
    ).toThrow(/in feet and names no coordinate system/)
  })
  it('rebuilds a 27.8 km RoadEng 11 design within a millimetre', () => {
    const [a] = parseRoadEngDesign(sample('LongRoad_1/LongRoad 1.dsnx')).alignments
    expect(a.pis).toHaveLength(73)
    expect(a.checks.planOffsetM).toBeLessThan(0.001)
    expect(a.checks.profileDifferenceM!).toBeLessThan(0.001)
  })
  it('follows the stations of an alignment whose PIs it cannot read', () => {
    const { alignments } = parseRoadEngDesign(sample('Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx'))
    expect(alignments.map((a) => a.followsStations)).toEqual([
      { plan: true, profile: true },
      { plan: false, profile: false },
    ])
  })
})
