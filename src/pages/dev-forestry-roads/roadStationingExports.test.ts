import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { alignmentLength, analyzeRoad, offsetCoordinate } from './engine'
import { landXml } from './designExports'
import { landXmlImportSummary, landXmlRoads } from './landXmlImport'
import { roadEngDesign } from './roadEngExport'
import { parseRoadEngDesign, roadEngRoads } from './roadEngImport'
import { formatStationLabel, labelStation, withStationing, type RoadStationing } from './roadStationing'
import { stationReportCsv, reportingRows } from './stationReport'
import { projectReportHtml, stationsCsv, parseProject, serializeProject } from './project'
import { createDemoProject, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import type { Alignment, Coordinate, TerrainMetadata, TerrainSource } from './types'

const origin: Coordinate = [-122.75, 53.917]
const at = (east: number, north: number) =>
  offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
const plan: Alignment = {
  id: 'r',
  name: 'Spur 7',
  color: '#000000',
  points: [
    { id: 'a', coordinate: at(0, 0), radiusM: 0 },
    { id: 'b', coordinate: at(0, 150), radiusM: 60 },
    { id: 'c', coordinate: at(120, 220), radiusM: 50 },
    { id: 'd', coordinate: at(120, 380), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
const road: Alignment = {
  ...plan,
  vertical: [
    { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'v1', chainage: 180, elevation: 809, curveLength: 40 },
    { id: 'v2', chainage: alignmentLength(plan), elevation: 806, curveLength: 0 },
  ],
}
const stationing: RoadStationing = {
  startStation: 1000,
  equations: [
    { back: 1200, ahead: 1500, description: 'New survey' },
    { back: 1300, ahead: 1550 },
  ],
}
const stationed: Alignment = { ...road, stationing }
const flat: TerrainSource = { elevationAt: () => 800 }
const terrain: TerrainMetadata = { kind: 'geotiff', name: 'DEM', resolutionM: 1, verticalReference: 'CGVD2013' }
const grid = localMetricGrid(origin)
const plain = analyzeRoad(road, flat, DEFAULT_ROAD_SETTINGS)
const named = analyzeRoad(stationed, flat, DEFAULT_ROAD_SETTINGS)

describe('station labels', () => {
  it('print exactly as before for every chainage without stationing', () => {
    const old = (value: number) => {
      const rounded = Math.round(Math.max(0, value) * 10) / 10
      return `${Math.floor(rounded / 1000)}+${(rounded % 1000).toFixed(1).padStart(5, '0')}`
    }
    const oldWhole = (value: number) => {
      const m = Math.round(Math.max(0, value))
      return `${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, '0')}`
    }
    let seed = 7
    for (let k = 0; k < 20_000; k++) {
      seed = (seed * 16807) % 2147483647
      const value = (seed / 2147483647) * 120_000 - 5
      expect(formatStationLabel(value, undefined)).toBe(old(value))
      expect(formatStationLabel(value, undefined, 0)).toBe(oldWhole(value))
    }
  })

  it('follow the road being written, whatever the screen shows', () => {
    // A back equation (1+600 back = 1+550 ahead) names 1+550 to 1+600 twice: the label says which.
    expect(withStationing(stationing, () => labelStation(250))).toBe('1+550.0 (2)')
    expect(withStationing(stationing, () => labelStation(150))).toBe('1+150.0')
    expect(withStationing(undefined, () => labelStation(250))).toBe('0+250.0')
    expect(plain.stationing).toBeUndefined()
    expect(named.stationing).toEqual(stationing)
    // The analysis is the same apart from the stationing it carries.
    const { stationing: _s, ...rest } = named
    void _s
    expect(JSON.stringify(rest)).toBe(JSON.stringify(plain))
  })

  it('survive the project file', () => {
    const project = { ...createDemoProject(), alignments: [stationed], activeAlignmentId: stationed.id }
    const back = parseProject(JSON.parse(serializeProject(project)))
    expect(back.alignments[0].stationing).toEqual(stationing)
    expect(() =>
      parseProject(
        JSON.parse(
          serializeProject({
            ...project,
            alignments: [
              {
                ...stationed,
                stationing: {
                  startStation: 0,
                  equations: [
                    { back: 5, ahead: 9 },
                    { back: 4, ahead: 1 },
                  ],
                },
              },
            ],
          }),
        ),
      ),
    ).toThrow(/along the road/)
  })
})

describe('LandXML station equations', () => {
  const write = (a: Alignment, analysis = analyzeRoad(a, flat, DEFAULT_ROAD_SETTINGS)) =>
    landXml({ name: 'Job', alignment: a, analysis, terrain, ...grid, date: new Date(2026, 10, 15, 9, 0, 0) })

  it('writes a road without stationing exactly as before', () => {
    expect(write({ ...road, stationing: { startStation: 0, equations: [] } }, plain)).toBe(write(road, plain))
    expect(write(road, plain)).not.toMatch(/StaEquation/)
    expect(write(road, plain)).toMatch(/<Alignment name="Spur 7" length="[\d.]+" staStart="0">/)
    expect(write(road, plain)).toMatch(/<PVI>0.000 800.000<\/PVI>/)
  })

  it('writes the start station and each equation, and reads them back', () => {
    const text = write(stationed, named)
    expect(text).toMatch(/<Alignment name="Spur 7" length="[\d.]+" staStart="1000.000">/)
    expect(text).toContain(
      '<StaEquation staInternal="1200.000" staBack="1200.000" staAhead="1500.000" staIncrement="increasing" desc="New survey"/>',
    )
    expect(text).toContain(
      '<StaEquation staInternal="1300.000" staBack="1600.000" staAhead="1550.000" staIncrement="increasing"/>',
    )
    expect(text).toMatch(/<PVI>1000.000 800.000<\/PVI>/)
    const [back] = landXmlRoads(text, {
      newId: () => 'b',
      color: () => '#123456',
      template: { ...DEFAULT_TEMPLATE },
    }).roads
    expect(back.warnings.filter((w) => /station equation/i.test(w))).toEqual([])
    expect(back.alignment.stationing!.startStation).toBe(1000)
    back.alignment.stationing!.equations.forEach((e, k) => {
      expect(e.ahead).toBe(stationing.equations[k].ahead)
      // Within the file's grid-to-chainage scale, as the PVIs are.
      expect(Math.abs(e.back - stationing.equations[k].back)).toBeLessThan(0.1)
    })
    expect(back.alignment.stationing!.equations[0].description).toBe('New survey')
    // PVIs come back at the chainage they come back at without stationing.
    const [unnamed] = landXmlRoads(write(road, plain), {
      newId: () => 'b',
      color: () => '#123456',
      template: { ...DEFAULT_TEMPLATE },
    }).roads
    back.alignment.vertical.forEach((v, k) => expect(v.chainage).toBeCloseTo(unnamed.alignment.vertical[k].chainage, 3))
    expect(landXmlImportSummary(back)).toMatch(/2 station equations/)
  })

  it('reads a decreasing equation, and reports a back station the stations before it do not name', () => {
    const text = write(stationed, named).replace(
      '<StaEquation staInternal="1300.000" staBack="1600.000"',
      '<StaEquation staInternal="1300.000" staBack="1590.000"',
    )
    const decreasing = text.replace(
      'staAhead="1550.000" staIncrement="increasing"',
      'staAhead="9000" staIncrement="decreasing"',
    )
    const [back] = landXmlRoads(decreasing, {
      newId: () => 'b',
      color: () => '#123456',
      template: { ...DEFAULT_TEMPLATE },
    }).roads
    expect(back.warnings.join(' ')).toMatch(
      /gives back station 1\+590\.000; the stations before it name that place 1\+600\.000/,
    )
    expect(back.alignment.stationing!.equations[1]).toMatchObject({ ahead: 9000, decreasing: true })
  })

  it('keeps a file without equations stationed from 0, as before', () => {
    const [back] = landXmlRoads(write(road, plain), {
      newId: () => 'b',
      color: () => '#123456',
      template: { ...DEFAULT_TEMPLATE },
    }).roads
    expect(back.alignment.stationing).toBeUndefined()
  })
})

describe('station names in reports and exports', () => {
  it('adds a station column only to a road with stationing', () => {
    expect(stationsCsv(plain, terrain).split('\r\n')[0]).toMatch(/^station_m,longitude,/)
    const lines = stationsCsv(named, terrain).split('\r\n')
    expect(lines[0]).toMatch(/^station_m,station,longitude,/)
    expect(lines[1]).toMatch(/^0,"1\+000\.000",/)
    const rows = reportingRows(named, named.stations, 0)
    expect(stationReportCsv(named, rows, false, stationing).split('\r\n')[0]).toMatch(/^station_m,station,/)
    expect(stationReportCsv(plain, reportingRows(plain, plain.stations, 0)).split('\r\n')[0]).toMatch(
      /^station_m,ground_elevation_m,/,
    )
  })

  it('prints names, the equations and the distance in the report', () => {
    const project = { ...createDemoProject(), alignments: [stationed], activeAlignmentId: stationed.id }
    const html = projectReportHtml(project, named)
    expect(html).toContain('<th>Station</th><th>Chainage m</th>')
    expect(html).toContain('Station equations: 1+200.0 back = 1+500.0 ahead at 200.0 m (New survey)')
    expect(html).toContain('<td>1+500.0</td><td>200</td>')
    const before = projectReportHtml({ ...project, alignments: [road] }, plain)
    expect(before).not.toContain('Chainage m')
  })
})

describe('RoadEng designs', () => {
  it('write a road’s start station on its L-line and its equations in [PGMaps], and read them back', () => {
    const written = roadEngDesign([{ alignment: stationed, analysis: named }], grid.toGrid)
    const dsn = strFromU8(unzipSync(written.bytes)['Location1.dsn'], true)
    expect(dsn).toMatch(/^Stationing=\{"startStation":1000,/m)
    const read = parseRoadEngDesign(written.bytes)
    expect(read.alignments[0].startStation).toBeCloseTo(1000, 6)
    const back = roadEngRoads(written.bytes, {
      fileName: 'Spur 7.dsnx',
      newId: () => 'back',
      color: () => '#123456',
      template: { ...DEFAULT_TEMPLATE },
      epsg: grid.epsg,
    }).roads[0]
    expect(back.alignment.stationing).toEqual(stationing)
  })

  it('write a road without stationing from station 0 with no Stationing key', () => {
    const written = roadEngDesign([{ alignment: road, analysis: plain }], grid.toGrid)
    expect(strFromU8(unzipSync(written.bytes)['Location1.dsn'], true)).not.toMatch(/Stationing=/)
    expect(parseRoadEngDesign(written.bytes).alignments[0].startStation).toBe(0)
  })

  it('name a road by its design’s own start station, and write no Stationing key back for it', () => {
    const start: Alignment = { ...road, stationing: { startStation: 1400, equations: [] } }
    const written = roadEngDesign(
      [{ alignment: start, analysis: analyzeRoad(start, flat, DEFAULT_ROAD_SETTINGS) }],
      grid.toGrid,
    )
    // RoadEng saves over [PGMaps]: what is left is the L-line starting at 1+400, as GuardRail does.
    const files = unzipSync(written.bytes)
    const dsn = strFromU8(files['Location1.dsn'], true)
    const native = dsn.replace(/\[PGMaps\][\s\S]*?(?=\r?\n\[|$)/, '')
    expect(native).not.toMatch(/Stationing=/)
    const nativeBytes = zipSync({ ...files, 'Location1.dsn': strToU8(native, true) })
    const options = {
      fileName: 'Rail.dsnx',
      newId: () => 'back',
      color: () => '#123456',
      template: { ...DEFAULT_TEMPLATE },
      epsg: grid.epsg,
    }
    const back = roadEngRoads(nativeBytes, options).roads[0]
    expect(back.alignment.stationing!.startStation).toBeCloseTo(1400, 6)
    expect(back.alignment.stationing!.equations).toEqual([])
    expect(formatStationLabel(0, back.alignment.stationing)).toBe('1+400.0')
    // Written back unedited, the stations are the design's own: no Stationing key.
    const again = roadEngDesign([{ alignment: back.alignment, source: back.source.source }], grid.toGrid)
    expect(strFromU8(unzipSync(again.bytes)['Location1.dsn'], true)).not.toMatch(/Stationing=/)
    // Taken back to station 0 here, the design says so, since its L-line still starts at 1+400.
    const zeroed = roadEngDesign(
      [{ alignment: { ...back.alignment, stationing: undefined }, source: back.source.source }],
      grid.toGrid,
    )
    expect(strFromU8(unzipSync(zeroed.bytes)['Location1.dsn'], true)).toMatch(/^Stationing=\{"startStation":0,/m)
    expect(roadEngRoads(zeroed.bytes, options).roads[0].alignment.stationing).toBeUndefined()
  })
})
