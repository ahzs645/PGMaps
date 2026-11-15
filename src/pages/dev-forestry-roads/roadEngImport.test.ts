import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { alignmentLength, designProfileAt, horizontalCurveSummary } from './engine'
import { AlignmentCrsQuestion, landXmlRoads, parseLandXml } from './landXmlImport'
import {
  base64ToBytes,
  bytesToBase64,
  clothoidOffsets,
  isRoadEngDesign,
  MAX_ROADENG_SOURCE_CHARS,
  parseRoadEngDesign,
  parseRoadEngSource,
  ROADENG_FIT_DEVIATION_M,
  ROADENG_PLAN_TOLERANCE_M,
  ROADENG_PROFILE_TOLERANCE_M,
  roadEngCurvesByPoint,
  roadEngImportSummary,
  roadEngRoads,
  stationEvents,
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
    expect(a.pis).toEqual([
      {
        xy: [E0, N0 + 200],
        radiusM: 50,
        turn: 'right',
        type: 2,
        from: '108',
        // Fields 8–18, in metres and metres a second.
        curve: {
          designSpeedMs: 16.6666666667,
          flags: 5590,
          emax: 0.06,
          fLimit: 0.1,
          runoffIn: 60,
          runoffOut: 60,
          transitionFraction: 0.667,
          e: 0.06,
          sideFriction: 0.1,
          widening: { insideM: 0, outsideM: 0 },
        },
      },
    ])
    expect(a.planFrom).toBe('pis')
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

// A road with a spiral curve, built by stepping along its curvature rather than with the reader's
// closed-form tangents: 100 m straight north, a clothoid of `inM` to R 80 m turning left, 40 m of
// arc, a clothoid of `outM` back to straight, then 120 m. The PI is where the two straights meet.
function spiralRoad(inM: number, outM: number) {
  const R = 80,
    arcM = 40,
    lead = 100,
    tail = 120
  const marks = [lead, lead + inM, lead + inM + arcM, lead + inM + arcM + outM]
  const total = marks[3] + tail
  const kappa = (s: number) =>
    s <= marks[0]
      ? 0
      : s <= marks[1]
        ? (s - marks[0]) / (inM * R)
        : s <= marks[2]
          ? 1 / R
          : s <= marks[3]
            ? (marks[3] - s) / (outM * R)
            : 0
  // Heading by the trapezoid rule on curvature, position by Simpson's rule on heading, 1 cm steps.
  const h = 0.01
  const steps = Math.round(total / h)
  const heading = new Float64Array(steps + 1)
  for (let i = 1; i <= steps; i++) heading[i] = heading[i - 1] + ((kappa((i - 1) * h) + kappa(i * h)) * h) / 2
  const xy = (s: number): [number, number] => {
    const n = Math.round(s / h)
    let x = 0,
      y = 0
    for (let i = 0; i + 2 <= n; i += 2) {
      // Simpson over [i, i + 2]; directions start north (+y) and turn left (towards −x).
      const w = [1, 4, 1]
      for (let j = 0; j < 3; j++) {
        x += (w[j] * -Math.sin(heading[i + j]) * h) / 3
        y += (w[j] * Math.cos(heading[i + j]) * h) / 3
      }
    }
    if (n % 2) {
      x += (-Math.sin(heading[n - 1]) - Math.sin(heading[n])) * (h / 2)
      y += (Math.cos(heading[n - 1]) + Math.cos(heading[n])) * (h / 2)
    }
    return [E0 + x, N0 + y]
  }
  const delta = heading[steps]
  const end = xy(total)
  // The incoming straight is x = E0; the outgoing one leaves the end at heading delta.
  const t = (end[0] - E0) / -Math.sin(delta)
  const pi: [number, number] = [E0, end[1] - t * Math.cos(delta)]
  const list = [...Array.from({ length: Math.floor(total / 10) + 1 }, (_, k) => k * 10), ...marks, total]
    .filter((v, k, all) => v <= total && all.indexOf(v) === k)
    .sort((a, b) => a - b)
  const rows = list.map((st) => {
    const [x, y] = xy(st)
    const plan = marks.includes(st) || st === 0 || st === total
    return `110,${plan ? 2 : 4},${x.toFixed(6)},${y.toFixed(6)},900,${st.toFixed(6)},-1,0,0,${st === marks[3] ? 2 : ''},,${plan ? 0 : 256}`
  })
  return {
    total,
    marks,
    ds2: [
      '100,103,11,11.0.673.0, Softree Technical Systems Inc. - Location Line data file',
      ...rows,
      `108,1,3,-${R},${pi[0].toFixed(6)},${pi[1].toFixed(6)},0,-1,16.6666666667,5590,0.06,0.1,${inM},${outM},0.667,0.06,0.1,0,0,0`,
    ].join('\r\n'),
  }
}

describe('RoadEng design import: what the road model does not hold', () => {
  it('keeps the .dsn, .ds1, .ds3 and every other .ds2 record as read', () => {
    const latin = '[design]\r\nunits=10000\r\nNote=Pont à 30°\r\n[Mine]\r\nKey=1\r\n'
    const ds1 = new Uint8Array([12, 0, 1, 0, 0, 0, 255, 254])
    const ds3 = new Uint8Array(Array.from({ length: 1000 }, (_, k) => (k * 37) & 255))
    const lines = ds2().split('\r\n')
    const text = [...lines, '118,1', '777,an unknown record'].join('\r\n') + '\r\n'
    const file = zipSync({
      'Location1.dsn': strToU8(latin, true),
      'Location1.ds2': strToU8(text),
      'Location1.ds1': ds1,
      'Location1.ds3': ds3,
    })
    const [a] = parseRoadEngDesign(file).alignments
    const source = a.source!
    expect(source.dsn).toBe(latin)
    expect(base64ToBytes(source.ds1!)).toEqual(ds1)
    expect(base64ToBytes(source.ds3!)).toEqual(ds3)
    expect(source.ds2Kept).toEqual([
      lines[0],
      '104,OB,Overburden (Default),100,400,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,8,',
      '118,1',
      '777,an unknown record',
    ])
    expect(source.ds2KeptBefore).toBe(1)
    expect(source.ds2Eol).toBe('\r\n')
    expect(source.piRecords).toEqual(lines.filter((l) => l.startsWith('108,')))
    expect(source.vipRecords).toEqual(lines.filter((l) => l.startsWith('109,')))
    expect(source).toMatchObject({ unitCode: '10000', startStation: 0, version: 1 })
    // Plain JSON, checked on the way back in.
    expect(parseRoadEngSource(JSON.parse(JSON.stringify(source)))).toEqual(source)
    expect(parseRoadEngSource({ ...source, ds2KeptBefore: 9 })).toBeNull()
    expect(parseRoadEngSource({ ...source, ds2Kept: ['a\r\nb'] })).toBeNull()
    expect(parseRoadEngSource({ ...source, dsn: 'x'.repeat(MAX_ROADENG_SOURCE_CHARS) })).toBeNull()
  })

  it('encodes base64 as the standard alphabet does', () => {
    expect(bytesToBase64(strToU8('Man'))).toBe('TWFu')
    expect(bytesToBase64(strToU8('Ma'))).toBe('TWE=')
    expect(bytesToBase64(strToU8('M'))).toBe('TQ==')
    for (const n of [0, 1, 2, 3, 4, 255, 256]) {
      const bytes = new Uint8Array(Array.from({ length: n }, (_, k) => (k * 151) & 255))
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
    }
  })

  it('reads the curve-end marks and report bits of each station', () => {
    const [a] = parseRoadEngDesign(design({ 'Location1.dsn': dsn(), 'Location1.ds2': ds2() })).alignments
    const last = a.stations[a.stations.length - 1]
    expect(last).toMatchObject({ type: 5, planMark: 0, profileMark: 0, report: 256 })
  })
})

describe('RoadEng design import: plans without curves, and spirals', () => {
  // A road with two bends and no curve: RoadEng writes no 108 record, only plan stations.
  const corners: [number, number][] = [
    [E0, N0],
    [E0, N0 + 300],
    [E0 + 200, N0 + 450],
    [E0 + 200, N0 + 700],
  ]
  const legs = corners.slice(1).map((c, k) => Math.hypot(c[0] - corners[k][0], c[1] - corners[k][1]))
  const at = (s: number): [number, number] => {
    let k = 0
    while (k < legs.length - 1 && s > legs[k]) s -= legs[k++]
    const f = s / legs[k]
    return [
      corners[k][0] + (corners[k + 1][0] - corners[k][0]) * f,
      corners[k][1] + (corners[k + 1][1] - corners[k][1]) * f,
    ]
  }
  const length = legs.reduce((a, b) => a + b, 0)
  const bends = [legs[0], legs[0] + legs[1]]
  const stationsAt = [...Array.from({ length: Math.floor(length / 10) + 1 }, (_, k) => k * 10), ...bends, length]
    .filter((v, k, all) => all.indexOf(v) === k)
    .sort((a, b) => a - b)
  const angled = [
    '100,103,8.099,8.0.390.0, Softree Technical Systems Inc. - Location Line data file',
    ...stationsAt.map((st) => {
      const [x, y] = at(st)
      const type = st === 0 || st === length ? 6 : bends.includes(st) ? 2 : 4
      return `110,${type},${x.toFixed(6)},${y.toFixed(6)},${(900 + st / 100).toFixed(6)},${(902.5 + st).toFixed(6)},-1,0,0,,,${type === 2 ? 0 : 256}`
    }),
  ].join('\r\n')
  // The same stations read as station numbers from 902.5, as the cul-de-sac's main road starts.
  const angledFile = design({ 'Location1.dsn': dsn(), 'Location1.ds2': angled })

  it('rebuilds a road with no 108 records from the angle points at its plan stations', () => {
    const [a] = parseRoadEngDesign(angledFile).alignments
    expect(a.planFrom).toBe('pis-and-plan-stations')
    expect(a.followsStations.plan).toBe(false)
    expect(a.checks.planOffsetM).toBeLessThan(1e-6)
    expect(a.pis.map((p) => [p.xy, p.radiusM, p.from, p.turn])).toEqual([
      [corners[1], 0, 'plan-station', 'right'],
      [corners[2], 0, 'plan-station', 'left'],
    ])
    const [road] = roadEngRoads(angledFile, { ...options, epsg: 26910 }).roads
    expect(road.fitDeviationM).toBeNull()
    expect(road.alignment.points).toHaveLength(4)
    expect(roadEngImportSummary(road, parseRoadEngDesign(angledFile))).toMatch(
      /^Spur 7: 0 PIs and 2 angle points, no design profile .*plan rebuilt from its angle points at its plan stations within 0\.0 mm/,
    )
  })

  it('keeps the fit where the plan stations do not rebuild the road either', () => {
    // A bend's plan station moved 5 m: neither reading rebuilds it.
    const moved = angled.replace(/^110,2,([\d.]+),/m, (_, x) => `110,2,${(Number(x) + 5).toFixed(6)},`)
    const [a] = parseRoadEngDesign(design({ 'Location1.dsn': dsn(), 'Location1.ds2': moved })).alignments
    expect(a.planFrom).toBe('stations')
    expect(a.followsStations.plan).toBe(true)
  })

  it('reads a curve type other than 2 with transitions as a spiral when that rebuilds its stations', () => {
    for (const [inM, outM] of [
      [30, 30],
      [25, 45],
    ]) {
      const road = spiralRoad(inM, outM)
      const read = parseRoadEngDesign(design({ 'Location1.dsn': dsn(), 'Location1.ds2': road.ds2 }))
      const [a] = read.alignments
      expect(a.pis[0].spiral).toEqual({ inM, outM })
      expect(a.planFrom).toBe('pis')
      expect(a.checks.planOffsetM).toBeLessThan(0.001)
      expect(Math.abs(a.checks.lengthDifferenceM)).toBeLessThan(0.001)
      expect(a.warnings.join(' ')).toMatch(/1 curve of type 3 is read as spiral curves?, their transition lengths/)
      const events = stationEvents(a)
      expect(events.ec).toEqual([road.marks[3]])
      const [built] = roadEngRoads(design({ 'Location1.dsn': dsn(), 'Location1.ds2': road.ds2 }), {
        ...options,
        epsg: 26910,
      }).roads
      expect(built.alignment.points[1].spiralM).toBeCloseTo(((inM + outM) / 2) * built.stationScale, 0)
      if (inM !== outM) expect(built.warnings.join(' ')).toMatch(/spirals of 25\.0 and 45\.0 m; the road takes 35\.0 m/)
    }
  })

  it('reads such a curve as circular when its stations are a circle’s', () => {
    // The hand-built design's circular curve, its record given type 3 and 60 m transitions.
    const text = ds2().replace(/^108,1,2,/m, '108,1,3,')
    const [a] = parseRoadEngDesign(design({ 'Location1.dsn': dsn(), 'Location1.ds2': text })).alignments
    expect(a.pis[0].spiral).toBeUndefined()
    expect(a.checks.planOffsetM).toBeLessThan(0.001)
    expect(a.warnings.join(' ')).toMatch(/rebuild its stations as circular curves, not spirals/)
  })

  it('computes clothoid offsets that turn by L/2R at the end', () => {
    const [x, y] = clothoidOffsets(60, 60, 100)
    // Series by hand: x = L(1 − θ²/10 + θ⁴/216 − θ⁶/9360), y = L(θ/3 − θ³/42 + θ⁵/1320), θ = 0.3.
    expect(x).toBeCloseTo(60 * (1 - 0.09 / 10 + 0.0081 / 216 - 0.000729 / 9360), 6)
    expect(y).toBeCloseTo(60 * (0.1 - 0.027 / 42 + 0.00243 / 1320), 6)
  })
})

describe('RoadEng station events', () => {
  const st = (station: number, report: number, type = 4, planMark = 0, profileMark = 0) => ({
    station,
    xy: [0, 0] as [number, number],
    z: 0,
    type,
    planMark,
    profileMark,
    report,
  })
  it('lists range boundaries as the middle of their pairs, pits, superelevation and curve ends', () => {
    const events = stationEvents({
      stations: [
        st(0, 0, 2),
        st(0, 70912, 5),
        st(10, 65792),
        st(20, 0, 1),
        st(40, 0, 2),
        st(60, 0, 1, 0, 4),
        st(80, 0, 2, 2),
        st(1199.9, 18),
        st(1200.1, 18),
        st(1999.9, 16384),
        st(2000, 102656),
        st(2000.1, 16384),
        st(2100, 2048),
        st(3000, 69888, 5),
        st(3000, 0, 2),
      ],
    })
    expect(events.templateRanges.map((v) => Number(v.toFixed(6)))).toEqual([1200])
    expect(events.groundLayerRanges.map((v) => Number(v.toFixed(6)))).toEqual([1200])
    expect(events.pits).toEqual([2000])
    expect(events.superelevation).toEqual([2100])
    expect(events).toMatchObject({ bc: [40], ec: [80], bvc: [20], evc: [60] })
    // 1024 at the start is not identified.
    expect(events.points.filter((p) => p.kind === 'other').map((p) => [p.station, p.bit])).toEqual([[0, 1024]])
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
    expect(a.planFrom).toBe('pis')
    expect(a.checks.planOffsetM).toBeLessThan(0.001)
    expect(a.checks.profileDifferenceM!).toBeLessThan(0.001)
    // Per-curve design: PI 3 is R 340 at 80 km/h with e 0.054 (the design's table).
    expect(a.pis[2].curve).toMatchObject({
      emax: 0.06,
      runoffIn: 60,
      runoffOut: 60,
      transitionFraction: 0.667,
      e: 0.054,
    })
    expect(a.pis[2].curve!.designSpeedMs! * 3.6).toBeCloseTo(80, 6)
  })
  it('lists the events RoadEng flagged on LongRoad: curve ends, ranges and pits', () => {
    const [a] = parseRoadEngDesign(sample('LongRoad_1/LongRoad 1.dsnx')).alignments
    const events = stationEvents(a)
    expect([events.bc.length, events.ec.length, events.bvc.length, events.evc.length]).toEqual([73, 73, 234, 234])
    // Each BC is a rebuilt curve's start, each EC its end.
    const round = (list: number[]) => list.map((v) => Math.round(v * 10) / 10)
    // The [LocationParms] range ends (bridge 18838–18942.8 and 27656.7–27678.6 among them).
    expect(round(events.templateRanges)).toEqual([
      1200, 3600, 18600, 18838, 18942.8, 20100, 25250, 25900, 27656.7, 27678.6,
    ])
    expect(round(events.groundLayerRanges)).toEqual([1200, 3600, 18600, 20100, 25250, 25900])
    // OptParms_Pit-0…5.
    expect(events.pits).toEqual([2000, 4200, 18500, 19800, 23700, 25500])
    // Runout start, level, reverse crown and full super at both ends of every curve.
    expect(events.superelevation).toHaveLength(8 * 73)
  })
  it('rebuilds the cul-de-sac main road from its plan stations to 5 µm, and the ring from its PIs', () => {
    const { alignments } = parseRoadEngDesign(sample('Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx'))
    expect(alignments.map((a) => a.followsStations)).toEqual([
      { plan: false, profile: true },
      { plan: false, profile: false },
    ])
    expect(alignments.map((a) => a.planFrom)).toEqual(['pis-and-plan-stations', 'pis'])
    expect(alignments[0].checks.planOffsetM).toBeLessThan(1e-5) // 5.0 µm
    expect(alignments[0].pis.map((p) => p.radiusM)).toEqual([0, 0, 0])
    expect(alignments.map((a) => a.source?.ds2Kept.map((l) => l.split(',', 1)[0]))).toEqual([
      ['100', '104', '104', '104', '104', '104', '118'],
      ['100', '104', '104', '104', '104', '104'],
    ])
    const { roads } = roadEngRoads(sample('Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx'), {
      ...options,
      epsg: 26910,
    })
    expect(roads[0].fitDeviationM).toBeNull()
    expect(Object.keys(roadEngCurvesByPoint(roads[1]))).toHaveLength(5)
  })
})
