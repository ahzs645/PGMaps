/**
 * RoadEng's US survey foot (`units=3048.00609601`) read wherever the international foot is, and
 * written back with its own code; and RoadEng's Site Prep (`[LocationParms]` fields 2–10) read as
 * stripping. Generated designs only (no Softree file).
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { alignmentLength, analyzeRoad, offsetCoordinate } from './engine'
import { roadEngDesign } from './roadEngExport'
import { parseRoadEngDesign } from './roadEngImport'
import { roadEngProject } from './roadEngProject'
import { roadEngExportGrid, roadEngProjectExport } from './roadEngProjectExport'
import {
  parseRoadEngSettings,
  readRoadEngSettings,
  roadEngEngineeringFor,
  roadEngMaterialsFor,
  roadEngStrippingMaterialId,
} from './roadEngDesignSettings'
import { roadEngHaulFor } from './roadEngHaul'
import { readRoadEngStoredResults } from './roadEngStoredResults'
import { ROADENG_US_SURVEY_FOOT_CODE, ROADENG_US_SURVEY_FOOT_M, roadEngUnitM } from './roadEngUnits'
import { softreeUnitsForRoadEng } from './softreeHaulCsv'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import type { Alignment, Coordinate } from './types'

const origin: Coordinate = [-93.95, 43.6]
const at = (east: number, north: number) =>
  offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
const plan: Alignment = {
  id: 'r',
  name: 'Driveway',
  color: '#000000',
  points: [
    { id: 'a', coordinate: at(0, 0), radiusM: 0 },
    { id: 'b', coordinate: at(0, 150), radiusM: 60 },
    { id: 'c', coordinate: at(120, 260), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
const road: Alignment = {
  ...plan,
  vertical: [
    { id: 'v0', chainage: 0, elevation: 300, curveLength: 0 },
    { id: 'v1', chainage: 150, elevation: 306, curveLength: 40 },
    { id: 'v2', chainage: alignmentLength(plan), elevation: 304, curveLength: 0 },
  ],
}
const grid = localMetricGrid(origin)
const options = {
  fileName: 'Driveway.dsnx',
  newId: () => 'back',
  color: () => '#123456',
  template: { ...DEFAULT_TEMPLATE },
}

/** A design whose numbers are this writer's, restated as US survey feet. */
function inSurveyFeet() {
  const written = roadEngDesign(
    [{ alignment: road, analysis: analyzeRoad(road, { elevationAt: () => 300 }, DEFAULT_ROAD_SETTINGS) }],
    grid.toGrid,
  )
  const parts = unzipSync(written.bytes)
  const dsn = strFromU8(parts['Location1.dsn'], true).replace(/^units=10000$/m, `units=${ROADENG_US_SURVEY_FOOT_CODE}`)
  expect(dsn).toContain(`units=${ROADENG_US_SURVEY_FOOT_CODE}`)
  return { bytes: zipSync({ ...parts, 'Location1.dsn': strToU8(dsn, true) }), dsn }
}

describe("RoadEng's US survey foot", () => {
  it('is 1200/3937 m per unit, beside the metre and the international foot', () => {
    expect(roadEngUnitM(ROADENG_US_SURVEY_FOOT_CODE)).toBe(1200 / 3937)
    expect(roadEngUnitM('3048')).toBe(0.3048)
    expect(roadEngUnitM('10000')).toBe(1)
    expect(roadEngUnitM('3048.006')).toBeNull()
    expect(softreeUnitsForRoadEng(ROADENG_US_SURVEY_FOOT_M)).toBe('imperial')
  })

  it('reads a design in US survey feet and writes it back with its own code', () => {
    const { bytes, dsn } = inSurveyFeet()
    const read = parseRoadEngDesign(bytes)
    expect(read.unitM).toBe(ROADENG_US_SURVEY_FOOT_M)
    // Its numbers read as US feet: the road is the metric reading's length in US feet.
    const [a] = read.alignments
    const metric = parseRoadEngDesign(
      zipSync({ ...unzipSync(bytes), 'Location1.dsn': strToU8(dsn.replace(/^units=.*$/m, 'units=10000'), true) }),
    ).alignments[0]
    expect(a.endStation - a.startStation).toBeCloseTo((metric.endStation - metric.startStation) * (1200 / 3937), 9)
    expect(a.checks.planOffsetM).toBeLessThan(0.001)
    expect(readRoadEngSettings(bytes).unitM).toBe(ROADENG_US_SURVEY_FOOT_M)
    expect(readRoadEngStoredResults(dsn, ROADENG_US_SURVEY_FOOT_M).solutions).toEqual([])
    // Opened on the flat plane in its own US feet, and written back unedited: the .dsn as read (its
    // units code with it), then [PGMaps].
    const opened = roadEngProject([{ name: 'Entrance.dsnx', bytes }], { ...options, verticalReference: '' })
    expect(opened.localPlane?.unitM).toBe(ROADENG_US_SURVEY_FOOT_M)
    const out = roadEngProjectExport({
      name: 'Driveway',
      roads: [{ alignment: opened.roads[0].alignment }],
      grid: roadEngExportGrid(opened.terrain, { epsg: grid.epsg, toGrid: grid.toGrid }),
      context: [],
      cables: [],
      reference: [],
    })
    const design = unzipSync(unzipSync(out.bytes)['Driveway.dsnx'])
    const again = strFromU8(design['Location1.dsn'], true)
    // Its units code as read, and every [design] key the design held kept as it was; the mass-haul
    // lengths this generated design lacks are added in US feet (241.4 m: 791.998416 US ft).
    expect(again).toMatch(/^units=3048\.00609601\r?$/m)
    for (const line of dsn.split('\r\n').filter((l) => /^(units|Version2?|nAlignments)=/.test(l)))
      expect(again.split('\r\n')).toContain(line)
    expect(parseRoadEngDesign(unzipSync(out.bytes)['Driveway.dsnx']).unitM).toBe(ROADENG_US_SURVEY_FOOT_M)
    // Reopened, it is the same road (to the export's rounding).
    const [reread] = parseRoadEngDesign(unzipSync(out.bytes)['Driveway.dsnx']).alignments
    expect(reread.endStation - reread.startStation).toBeCloseTo(a.endStation - a.startStation, 3)
  })

  it('takes haul costs per yd³ and per mile', () => {
    const ds2 = [
      '100,103,11,11.0.673.0, Softree Technical Systems Inc. - Location Line data file',
      '104,OB,Overburden (Default),100,400,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,8,',
    ].join('\r\n')
    const haulIn = (code: string, unitM: number) =>
      roadEngHaulFor(
        { dsnText: `[design]\r\nunits=${code}\r\n`, ds2Text: ds2 },
        { startStation: 0, endStation: 300, unitM, materials: [], costed: false },
      ).haul
    // Per yd³ and per mile, as in a design in international feet.
    expect(haulIn(ROADENG_US_SURVEY_FOOT_CODE, ROADENG_US_SURVEY_FOOT_M)).toEqual(haulIn('3048', 0.3048))
    expect(haulIn(ROADENG_US_SURVEY_FOOT_CODE, ROADENG_US_SURVEY_FOOT_M)).not.toEqual(haulIn('10000', 1))
  })
})

describe("RoadEng's Site Prep", () => {
  const ds2 = [
    '100,103,11,11.0.673.0, Softree Technical Systems Inc. - Location Line data file',
    '104,OB,Overburden (Default),100,400,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,',
    '104,CS,Clay Silt,33.333,100,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,',
    '104,FR,Fractured Rock,100,200.000001545,1,0.8,24,4,0,8,0.6,4,2.6,2,3,0,0,',
  ].join('\r\n')
  /** Ranges as `[LocationParms]` rows, in feet: the Road6 tutorial's layers and Site Prep. */
  const settings = (rows: string[]) =>
    parseRoadEngSettings(
      [
        '[design]',
        'units=3048',
        '[LocationParms]',
        ...rows.map((r, k) => `${k}=${r}`),
        `nparams=${rows.length}`,
        '',
      ].join('\r\n'),
      ds2,
      0.3048,
    )
  const tail = 'LOWV,LOWV,RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1'
  it('strips the top layer to the Site Prep depth or its bottom, whichever is less, past the slope stakes', () => {
    const s = settings([
      `500,2,3,3,1,1,0,0,0,0,-,*1,-1,CS,-5,FR,OB,${tail}`,
      `1000,0.5,3,3,1,1,0,0,0,0,-,*1,-1,CS,-5,FR,OB,${tail}`,
      `999999999,0,0,0,0,0,0,0,0,0,-,*1,-1,CS,-5,FR,OB,${tail}`,
    ])
    const m = roadEngMaterialsFor(s, { startStation: 0, endStation: 1500 * 0.3048 })
    expect(m.sitePreparation.map((p) => [p.start, p.end, p.depthM, p.leftOutsideM, p.rightOutsideM])).toEqual([
      // 2 ft asked, OB 1 ft thick: 1 ft.
      [0, 152.4, 0.3048, 0.9144, 0.9144],
      [152.4, 304.8, 0.1524, 0.9144, 0.9144],
    ])
    const stripped = m.materials.find((x) => x.id === roadEngStrippingMaterialId('OB'))!
    expect(stripped).toMatchObject({ purpose: 'stripping', reusableFraction: 0 })
    expect(stripped.cutRate).toBe(m.materials.find((x) => x.id === 'roadeng-OB')!.cutRate)
    expect(m.notes.join()).toMatch(/Site Prep becomes stripping of the top ground layer/)
    // Left beside the road with no haul.
    const e = roadEngEngineeringFor(s, {
      startStation: 0,
      endStation: 1500 * 0.3048,
      fallback: { ...DEFAULT_TEMPLATE },
    }).engineering
    expect(e.sitePreparation).toEqual(m.sitePreparation)
    expect(e.haul.sidecastRanges?.map((r) => [r.start, r.end, r.unitRate, r.materialIds])).toEqual([
      [0, 152.4, 0, [stripped.id]],
      [152.4, 304.8, 0, [stripped.id]],
    ])
  })
  it('strips nothing where the Site Prep depth is 0, and says what it cannot apply', () => {
    expect(
      roadEngMaterialsFor(settings([`999999999,0,0,0,0,0,0,0,0,0,-,*1,-1,CS,-5,FR,OB,${tail}`]), {
        startStation: 0,
        endStation: 300,
      }).sitePreparation,
    ).toEqual([])
    const odd = roadEngMaterialsFor(settings([`999999999,2,3,3,2,2,0,0,0,0,-,*1,999999,-,999999,-,OB,${tail}`]), {
      startStation: 0,
      endStation: 300,
    })
    // One layer: the full 2 ft; a control other than the slope stake is said.
    expect(odd.sitePreparation[0].depthM).toBeCloseTo(0.6096, 9)
    expect(odd.unmapped.join()).toMatch(/control other than the slope stake/)
  })
})
