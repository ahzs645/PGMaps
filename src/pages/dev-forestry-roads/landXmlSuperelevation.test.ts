import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { landXml } from './designExports'
import { analyzeRoad, curveDesignAt, horizontalCurveSummary, offsetCoordinate } from './engine'
import { landXmlRoads, parseLandXml, readXml } from './landXmlImport'
import { evaluateCurveCriteria } from './roadCriteria'
import {
  applyLandXmlSuperelevation,
  LANDXML_DEFAULT_SPEED_KMH,
  landXmlSuperelevationXml,
  readLandXmlSuperelevation,
} from './landXmlSuperelevation'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import type { Alignment, Coordinate } from './types'

// A generated alignment in UTM 10N: 400 m north, a right-hand curve of R 300 m through 60°, then a
// tangent; stations from 5000. Points are "northing easting".
const E = 520_000,
  N = 5_970_000
const R = 300
const sweep = Math.PI / 3
const bc = [N + 400, E] as const
const centre = [N + 400, E + R] as const
const ec = [centre[0] + R * Math.sin(sweep), centre[1] - R * Math.cos(sweep)] as const
const arc = R * sweep
const end = [ec[0] + 300 * Math.cos(sweep), ec[1] + 300 * Math.sin(sweep)] as const
const pi = [N + 400 + R * Math.tan(sweep / 2), E] as const
const p = (pt: readonly number[]) => `${pt[0].toFixed(6)} ${pt[1].toFixed(6)}`
const xml = (superelevation: string, extra = '') => `<?xml version="1.0"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2">
  <Units><Metric linearUnit="meter"/></Units>
  <CoordinateSystem epsgCode="26910"/>
  <Alignments>
    <Alignment name="Generated" staStart="5000" length="${(700 + arc).toFixed(6)}">
      <CoordGeom>
        <Line staStart="5000" length="400"><Start>${p([N, E])}</Start><End>${p(bc)}</End></Line>
        <Curve rot="cw" crvType="arc" radius="${R}" staStart="5400" length="${arc.toFixed(6)}"><Start>${p(bc)}</Start><Center>${p(centre)}</Center><End>${p(ec)}</End><PI>${p(pi)}</PI></Curve>
        <Line staStart="${(5400 + arc).toFixed(6)}" length="300"><Start>${p(ec)}</Start><End>${p(end)}</End></Line>
      </CoordGeom>${extra}
      ${superelevation}
    </Alignment>
  </Alignments>
</LandXML>`
// 6 % with 60 m runoffs, two thirds of each before the BC (after the EC), and 30 m tangent runouts.
const bcSta = 5400,
  ecSta = 5400 + arc
const sixPercent = `<Superelevation>
        <BeginRunoutSta>${bcSta - 70}</BeginRunoutSta>
        <BeginRunoffSta>${bcSta - 40}</BeginRunoffSta>
        <FullSuperSta>${bcSta + 20}</FullSuperSta>
        <FullSuperelev>6</FullSuperelev>
        <RunoffSta>${(ecSta - 20).toFixed(6)}</RunoffSta>
        <StartofRunoutSta>${(ecSta + 40).toFixed(6)}</StartofRunoutSta>
        <EndofRunoutSta>${(ecSta + 70).toFixed(6)}</EndofRunoutSta>
        <AdverseSE>non-adverse</AdverseSE>
      </Superelevation>`
const opts = { newId: () => 'r', color: () => '#123456', template: { ...DEFAULT_TEMPLATE } }

describe('LandXML superelevation', () => {
  it('reads the elements and the design speed, in metres', () => {
    const doc = readXml(xml(sixPercent, '\n      <DesignSpeed staStart="5000">50</DesignSpeed>'))
    const alignment = doc.children[0].children
      .find((c) => c.name === 'Alignments')!
      .children.find((c) => c.name === 'Alignment')!
    const read = readLandXmlSuperelevation(alignment, 1, [])
    expect(read.designSpeedKmh).toBe(50)
    expect(read.items).toEqual([
      {
        beginRunout: 5330,
        beginRunoff: 5360,
        fullSuper: 5420,
        runoff: expect.closeTo(ecSta - 20, 6),
        startOfRunout: expect.closeTo(ecSta + 40, 6),
        endOfRunout: expect.closeTo(ecSta + 70, 6),
        ratePercent: 6,
        adverse: false,
      },
    ])
  })
  it('gives the curve its rate, runoffs and share outside the curve, and the road a tangent runout', () => {
    const [road] = landXmlRoads(xml(sixPercent), opts).roads
    const a = road.alignment
    const [curve] = horizontalCurveSummary(a)
    const own = a.points.find((q) => q.id === curve.pointId)!.curve!
    expect(own.superelevationPercent).toBe(6)
    // Station lengths become chainage at the road's scale (within a few mm per 60 m here).
    expect(own.runoffInM).toBeCloseTo(60 * road.stationScale, 3)
    expect(own.runoffOutM).toBeCloseTo(60 * road.stationScale, 3)
    expect(own.transitionFraction).toBeCloseTo(2 / 3, 3)
    expect(a.curveDesign).toMatchObject({
      designSpeedKmh: LANDXML_DEFAULT_SPEED_KMH,
      maxSuperelevationPercent: 6,
      tangentRunout: true,
    })
    expect(road.warnings.join(' ')).toMatch(/states no design speed/)
    // Full superelevation 20 m into the curve; half of it 10 m before the BC.
    const full = curveDesignAt(a, curve.start + 20 * road.stationScale + 0.01)!
    expect(full.superPercent).toBe(6)
    expect(full.ratio).toBeCloseTo(1, 6)
    expect(curveDesignAt(a, curve.start - 10 * road.stationScale)!.ratio).toBeCloseTo(0.5, 3)
  })
  it('writes the stations the engine uses, and reads them back the same', () => {
    const [road] = landXmlRoads(xml(sixPercent), opts).roads
    const a = road.alignment
    const [curve] = horizontalCurveSummary(a)
    const own = a.points.find((q) => q.id === curve.pointId)!.curve!
    const written = landXmlSuperelevationXml(a, 5000)
    expect(written).toHaveLength(1)
    const values = (tag: string) => Number(new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(written[0])![1])
    // On the road's own stations (its chainage from 5000), as the export writes its elements.
    const f = own.transitionFraction!,
      runoff = own.runoffInM!
    expect(values('BeginRunoffSta')).toBeCloseTo(5000 + curve.start - f * runoff, 5)
    expect(values('FullSuperSta')).toBeCloseTo(5000 + curve.start + (1 - f) * runoff, 5)
    expect(values('RunoffSta')).toBeCloseTo(5000 + curve.end - (1 - f) * own.runoffOutM!, 5)
    expect(values('StartofRunoutSta')).toBeCloseTo(5000 + curve.end + f * own.runoffOutM!, 5)
    expect(values('FullSuperelev')).toBe(6)
    expect(written[0]).toMatch(/<AdverseSE>non-adverse<\/AdverseSE>/)
    // The runout follows the road's crown at the runoff's rate: runoff × crown / 6 %.
    const crown = DEFAULT_TEMPLATE.crossfallPercent
    expect(values('BeginRunoutSta')).toBeCloseTo(values('BeginRunoffSta') - (runoff * crown) / 6, 5)
    // The engine is at full superelevation from FullSuperSta and at its start at BeginRunoffSta.
    expect(curveDesignAt(a, values('FullSuperSta') - 5000 + 1e-6)!.ratio).toBeCloseTo(1, 6)
    expect(curveDesignAt(a, values('BeginRunoffSta') - 5000 + 1e-3)!.ratio).toBeLessThan(1e-3)
    const [again] = landXmlRoads(xml(written[0]), opts).roads
    const one = (r: typeof road) => r.alignment.points.find((q) => q.curve)!.curve!
    expect(one(again).superelevationPercent).toBe(6)
    // The generated file keeps its grid stations, so the written runoff is scaled once more.
    expect(one(again).runoffInM).toBeCloseTo(one(road).runoffInM! * again.stationScale, 3)
    // Read against the generated file's own BC, 13 cm from the road's: the share within 1 %.
    expect(Math.abs(one(again).transitionFraction! - one(road).transitionFraction!)).toBeLessThan(0.01)
  })
  it('goes out with the road’s LandXML and comes back as the same curves', () => {
    const origin: Coordinate = [-122.75, 53.917]
    const at = (east: number, north: number) =>
      offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
    const road: Alignment = {
      id: 'r',
      name: 'Spur 7',
      color: '#000',
      points: [
        { id: 'a', coordinate: at(0, 0), radiusM: 0 },
        {
          id: 'b',
          coordinate: at(0, 250),
          radiusM: 120,
          curve: { superelevationPercent: 5, runoffInM: 40, runoffOutM: 30 },
        },
        { id: 'c', coordinate: at(200, 380), radiusM: 90, spiralM: 30 },
        { id: 'd', coordinate: at(200, 600), radiusM: 0 },
      ],
      vertical: [
        { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
        { id: 'v1', chainage: 500, elevation: 805, curveLength: 0 },
      ],
      template: { ...DEFAULT_TEMPLATE },
      overrides: [],
      curveDesign: {
        designSpeedKmh: 50,
        maxSuperelevationPercent: 8,
        sideFrictionFactor: 0.15,
        runoffLengthM: 30,
        wideningVehicleLengthM: null,
        transitionFraction: 0.667,
      },
    }
    const analysis = analyzeRoad(road, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    const text = landXml({
      name: 'Job',
      alignment: road,
      analysis,
      terrain: { kind: 'geotiff', name: 'DEM', resolutionM: 1, verticalReference: 'CGVD2013' },
      ...localMetricGrid(origin),
    })
    expect(text.match(/<Superelevation /g)).toHaveLength(2)
    const [back] = landXmlRoads(text, opts).roads
    const before = horizontalCurveSummary(road),
      after = horizontalCurveSummary(back.alignment)
    expect(after).toHaveLength(2)
    for (let k = 0; k < 2; k++) {
      const c0 = evaluateCurveCriteria(
        road.curveDesign!,
        before[k].radius,
        before[k].deflectionDegrees,
        road.points[k + 1].curve,
      )
      const own = back.alignment.points[k + 1].curve!
      expect(own.superelevationPercent).toBeCloseTo(c0.appliedSuperelevationPercent, 5)
      // Each station where the engine reaches full superelevation and leaves normal crown, within a centimetre.
      for (const s of [before[k].start - 10, before[k].start + 5, before[k].end - 5])
        expect(curveDesignAt(back.alignment, s)?.superPercent ?? 0).toBeCloseTo(
          curveDesignAt(road, s)?.superPercent ?? 0,
          5,
        )
    }
    expect(back.alignment.points[1].curve).toMatchObject({
      runoffInM: expect.closeTo(40, 1),
      runoffOutM: expect.closeTo(30, 1),
    })
    expect(back.alignment.points[1].curve!.transitionFraction).toBeCloseTo(0.667, 3)
  })
  it('leaves out what PGMaps cannot place, and says so', () => {
    const adverse = sixPercent.replace('non-adverse', 'adverse')
    const off = `<Superelevation><FullSuperSta>5100</FullSuperSta><FullSuperelev>3</FullSuperelev><RunoffSta>5200</RunoffSta></Superelevation>`
    const reversed = `<Superelevation><FullSuperSta>5500</FullSuperSta><FullSuperelev>3</FullSuperelev><RunoffSta>5450</RunoffSta></Superelevation>`
    for (const [text, said] of [
      [adverse, /adverse .* left out/],
      [off, /lies on no curve/],
      [reversed, /leaves full superelevation before reaching it/],
    ] as const) {
      const [road] = landXmlRoads(xml(text), opts).roads
      expect(road.warnings.join(' ')).toMatch(said)
      expect(road.alignment.curveDesign).toBeUndefined()
    }
  })
  it('keeps a road without superelevation as it was', () => {
    const [road] = landXmlRoads(xml(''), opts).roads
    expect(road.alignment.curveDesign).toBeUndefined()
    expect(road.alignment.points.every((q) => q.curve === undefined)).toBe(true)
    expect(
      applyLandXmlSuperelevation(
        road.alignment,
        { items: [], designSpeedKmh: null },
        { startStation: 0, stationScale: 1 },
      ).alignment,
    ).toBe(road.alignment)
    expect(landXmlSuperelevationXml(road.alignment)).toEqual([])
  })
})

// Hand-built LandXML test files (two third-party fixtures in the sample pack), never committed.
const pack = process.env.ROADENG_SAMPLE_PACK
const fixture = (name: string) => readFileSync(join(pack!, 'landxml-synthetic', name), 'utf8')
describe.skipIf(!pack || !existsSync(join(pack ?? '', 'landxml-synthetic')))('the hand-built LandXML fixtures', () => {
  it('parses corridor.xml: a 5 % curve with runouts, a 4 % one without runoffs, an adverse one left out', () => {
    const file = parseLandXml(fixture('corridor.xml'))
    expect(file.alignments.map((a) => a.superelevation.items.map((i) => [i.ratePercent, i.adverse]))).toEqual([
      [[5, false]],
      [[4, null]],
      [[4, true]],
    ])
    const { roads } = landXmlRoads(fixture('corridor.xml'), { ...opts, epsg: 26910 })
    const [mc10, right, adverse] = roads
    const curveOf = (r: (typeof roads)[number]) => r.alignment.points.find((q) => q.curve)?.curve
    expect(curveOf(mc10)).toMatchObject({ superelevationPercent: 5 })
    expect(curveOf(mc10)!.runoffInM).toBeCloseTo(40 * mc10.stationScale, 3)
    expect(curveOf(mc10)!.transitionFraction).toBeCloseTo(1, 3)
    expect(mc10.alignment.curveDesign?.tangentRunout).toBe(true)
    expect(curveOf(right)).toEqual({ superelevationPercent: 4 })
    expect(adverse.alignment.curveDesign).toBeUndefined()
    expect(adverse.warnings.join(' ')).toMatch(/adverse/)
  })
  it('parses corridor_feet.xml in metres and leaves out what lies on no curve or runs backwards', () => {
    const file = parseLandXml(fixture('corridor_feet.xml'))
    expect(file.unitM).toBe(0.3048)
    const [straight, faulty] = file.alignments
    expect(straight.superelevation.items).toEqual([
      expect.objectContaining({ fullSuper: 100 * 0.3048, runoff: 200 * 0.3048, ratePercent: 3 }),
    ])
    expect(faulty.superelevation.items.map((i) => i.ratePercent)).toEqual([2, -2])
    const warnings: string[] = []
    const placed = applyLandXmlSuperelevation(
      {
        id: 'r',
        name: 'Straight',
        color: '#000',
        points: [],
        vertical: [],
        template: { ...DEFAULT_TEMPLATE },
        overrides: [],
      },
      faulty.superelevation,
      { startStation: 0, stationScale: 1 },
    )
    warnings.push(...placed.warnings)
    expect(warnings.join(' ')).toMatch(/leaves full superelevation before reaching it/)
    expect(warnings.join(' ')).toMatch(/lies on no curve/)
  })
})
