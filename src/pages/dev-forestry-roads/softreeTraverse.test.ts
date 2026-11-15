import { describe, expect, it } from 'vitest'
import { isSoftreeTerrainAscii } from './softreeAscii'
import {
  culvertInMetres,
  calculatedStations,
  checkStationEquations,
  fieldStation,
  formatDms,
  isLaserRawSurvey,
  isPolycorderTraverse,
  isSoftreeAscTraverse,
  isUnitSurvey,
  laserRawAsUnitSurvey,
  parseAngle,
  parseLaserRawSurvey,
  parsePolycorderTraverse,
  parseSoftreeAscTraverse,
  parseUnitSurvey,
  polycorderToTraverse,
  SoftreeTraverseStartQuestion,
  softreeAscToTraverse,
  stationEquationsFromColumn,
  traverseToPolycorder,
  traverseToSoftreeAsc,
  traverseToUnitSurvey,
  unitSurveyToTraverse,
  writeLaserRawSurvey,
  writePolycorderTraverse,
  writeSoftreeAscTraverse,
  writeUnitSurvey,
  type SoftreeTraverseDetails,
  type UnitSurveyVertical,
} from './softreeTraverse'
import { reduceTraverse, type TraverseInput } from './surveyInterchange'

const crlf = (lines: string[]) => lines.join('\r\n') + '\r\n'

// The help's "Road Survey With Side Shots" example, each record on one line as the format has it.
const roadSurvey = crlf([
  'V2.900 Main# T23',
  '0.000,259.000,,16.000,16.051,8.000,[G] Start,,670.169,183.391,240.500,7,,,,HP,,,,,0.000,0.000,-1.000,-5.000,,,-1.000,5.000,,,0,0',
  '16.000,224.000,,18.000,18.090,10.000,,,654.462,180.338,241.780,0,,20.000,100.000,HP,,,,,0.000,0.000,-1.000,-5.000,,,-1.000,5.000,,,0,0',
  '34.000,204.000,,50.000,50.202,9.000,,,641.959,167.390,243.580,0,,,,HP,,,,,0.000,0.000,-1.000,-10.000,,,-1.000,10.000,,,0,0',
  '84.000,238.000,,34.000,34.002,-1.000,,,621.622,121.713,248.080,0,,,,HP,,,,,0.000,0.000,-1.000,-10.000,,,-1.000,20.000,,,0,0',
  '118.000,,,,,,,,592.788,103.696,247.740,0,1000.000x x22.500x x7x10.000x,,,HP,,,,,0.000,0.000,-1.000,-20.000,,,-1.000,25.000,,,0,0',
])
// The help's "Simple Boundary Traverse" example, spaces and all. Its seventh station reads 669.1
// where the distances give 699.1.
const boundary = crlf([
  'V2.900 CB# T33',
  '0.0, 358.3, ,137.6, ,8.9, label A1',
  '137.6, 270.0, ,86.0, ,8.9',
  '223.6, 335.0, ,33.1, ,10.2',
  '256.7, 240.4, ,93.2, ,7.2',
  '349.8, 184.6, ,174.6, ,5.2',
  '524.5, 184.6, ,174.6, ,4.6',
  '669.1, 184.6, ,174.6, ,7.2',
  '873.7, 133.7, ,123.1, ,8.4',
  '996.8, 80.7, ,61.8, ,5.7',
  '1058.6, 30.5, ,106.2, ,10.7',
])

const book: TraverseInput = {
  start: [500_000, 5_970_000, 700],
  adjustment: 'none',
  legs: [
    { id: '0+020', bearingDegrees: 45, horizontalDistanceM: 20, gradePercent: 6 },
    { id: '0+045.5', bearingDegrees: 60.25, horizontalDistanceM: 25.5, gradePercent: -3.5 },
    { id: 'TP3', bearingDegrees: 350, horizontalDistanceM: 31.25, gradePercent: 12 },
  ],
  sideShots: [
    { id: 'L-a', station: 0, offsetM: -5, heightDifferenceM: -0.5 },
    { id: 'L-b', station: 0, offsetM: -12, heightDifferenceM: -2 },
    { id: 'R-a', station: 0, offsetM: 8, heightDifferenceM: 1.25 },
    { id: 'R-b', station: 2, offsetM: 6.5, heightDifferenceM: 0.75 },
    { id: 'L-c', station: 3, offsetM: -4, heightDifferenceM: 0.2 },
  ],
}

function expectSameBook(a: TraverseInput, b: TraverseInput, ids = true) {
  expect(b.start.map((v, k) => v - a.start[k]).every((d) => Math.abs(d) < 1e-3)).toBe(true)
  expect(b.legs).toHaveLength(a.legs.length)
  b.legs.forEach((l, i) => {
    if (ids) expect(l.id).toBe(a.legs[i].id)
    expect(l.bearingDegrees).toBeCloseTo(a.legs[i].bearingDegrees, 3)
    expect(l.horizontalDistanceM).toBeCloseTo(a.legs[i].horizontalDistanceM, 3)
    expect(l.gradePercent).toBeCloseTo(a.legs[i].gradePercent, 2)
  })
  const shots = (x: TraverseInput) =>
    [...(x.sideShots ?? [])].sort((p, q) => p.station - q.station || p.offsetM - q.offsetM)
  const sb = shots(b),
    sa = shots(a)
  expect(sb).toHaveLength(sa.length)
  sb.forEach((s, i) => {
    if (ids) expect(s.id).toBe(sa[i].id)
    expect(s.station).toBe(sa[i].station)
    expect(s.offsetM).toBeCloseTo(sa[i].offsetM, 3)
    expect(s.heightDifferenceM).toBeCloseTo(sa[i].heightDifferenceM, 3)
  })
  const ra = reduceTraverse(a).stations.at(-1)!.raw,
    rb = reduceTraverse(b).stations.at(-1)!.raw
  ra.forEach((v, k) => expect(rb[k]).toBeCloseTo(v, 2))
}

describe('station equations', () => {
  const eqs = [
    { back: 100, ahead: 120 },
    { back: 250, ahead: 230 },
  ]
  it('name calculated stations as the field does, and find them again', () => {
    expect(fieldStation(50, eqs)).toBe(50)
    expect(fieldStation(100, eqs)).toBe(120)
    expect(fieldStation(150, eqs)).toBe(170)
    expect(fieldStation(260, eqs)).toBe(240)
    expect(calculatedStations(170, eqs, 0)).toEqual([150])
    // 240 names two places: 220 on the second stretch's back side and 260 after the second equation.
    expect(calculatedStations(240, eqs, 0)).toEqual([220, 260])
    expect(calculatedStations(110, eqs, 0)).toEqual([])
  })
  it('are refused out of order, repeated or off the traverse', () => {
    expect(() => checkStationEquations(eqs, { start: 0, end: 300 })).not.toThrow()
    expect(() => checkStationEquations([...eqs].reverse())).toThrow(/increasing/)
    expect(() => checkStationEquations([{ back: 400, ahead: 1 }], { start: 0, end: 300 })).toThrow(/off the traverse/)
    expect(() => checkStationEquations([{ back: NaN, ahead: 1 }])).toThrow(/back and an ahead/)
  })
  it('are read from a station column that jumps, but not from rounding', () => {
    expect(stationEquationsFromColumn([0, 20, 40.1, 60], [20, 20, 20], 0.15).equations).toEqual([])
    expect(stationEquationsFromColumn([10, 30, 75, 95], [20, 20, 20], 0.15)).toEqual({
      start: 10,
      equations: [{ back: 50, ahead: 75 }],
    })
  })
})

describe('Softree ASCII traverse', () => {
  it('reads the help’s road survey and reduces it onto its own coordinates', () => {
    expect(isSoftreeAscTraverse(roadSurvey)).toBe(true)
    expect(isSoftreeTerrainAscii(roadSurvey)).toBe(false)
    const t = parseSoftreeAscTraverse(roadSurvey)
    expect(t).toMatchObject({ format: 'asc', version: 'V2.900', header: 'V2.900 Main# T23', sideShots: 1 })
    expect(t.records[0]).toMatchObject({ type: 7, label1: '[G] Start', ground1: 'HP', hi: 0, ht: 0 })
    expect(t.records[1]).toMatchObject({ refAzimuth: 20, refHd: 100 })
    expect(t.records[4].creek).toMatchObject({
      sizeY: 1000,
      sizeX: null,
      gradientPercent: 22.5,
      azimuth: null,
      flag: 7,
      sd: 10,
    })
    expect(t.records[0].left[0]).toEqual({ sd: -1, slope: -5, depth1: null, depth2: null })
    // Written back, byte for byte.
    expect(writeSoftreeAscTraverse(t)).toBe(roadSurvey)

    const read = softreeAscToTraverse(t, { unitM: 1 })
    expect(read.input.start).toEqual([670.169, 183.391, 240.5])
    expect(read.input.legs.map((l) => [l.id, l.bearingDegrees, l.horizontalDistanceM, l.gradePercent])).toEqual([
      ['16.000', 259, 16, 8],
      ['34.000', 224, 18, 10],
      ['84.000', 204, 50, 9],
      ['118.000', 238, 34, -1],
    ])
    expect(read.fileCheck!.compared).toBe(5)
    expect(read.fileCheck!.maxDifferenceM).toBeLessThan(0.002)
    // Each side ends in a slope with no distance: kept as the ground beyond, not as a shot.
    expect(read.input.sideShots).toEqual([])
    expect(read.extras[0]).toMatchObject({
      label: '[G] Start',
      ground: [{ type: 'HP', depth: null }],
      extensionSlope: { left: -5, right: 5 },
    })
    expect(read.extras.at(-1)!.culvert).toMatchObject({ sizeY: 1000, flag: 7 })
    expect(read.equations).toEqual([])
    expect(read.notes.join(' ')).toMatch(/1 reference shots are not used/)
  })

  it('reads the help’s boundary traverse, asking for its start, and its typo as equations', () => {
    const t = parseSoftreeAscTraverse(boundary)
    expect(t.sideShots).toBe(0)
    expect(t.records[0].label1).toBe('label A1')
    expect(() => softreeAscToTraverse(t, { unitM: 1 })).toThrow(SoftreeTraverseStartQuestion)
    const read = softreeAscToTraverse(t, { unitM: 0.3048, start: [1000, 2000, 300] })
    // The last record has a foreshot: it leads to an eleventh station the file does not list.
    expect(read.input.legs).toHaveLength(10)
    expect(read.input.legs[0].horizontalDistanceM).toBeCloseTo(137.6 * 0.3048, 9)
    expect(read.stationIds.at(-1)).toBe('1164.800')
    // 0.1 of drift is rounding; the 30-unit slip and its correction read as two equations.
    expect(read.equations.map((e) => [e.back / 0.3048, e.ahead / 0.3048].map((v) => Number(v.toFixed(1))))).toEqual([
      [699.1, 669.1],
      [873.7, 873.7],
    ])
  })

  it('round-trips a field book with side shots and station equations, ASCII and IPD', () => {
    const equations = [{ back: 30, ahead: 40 }]
    for (const format of ['asc', 'ipd'] as const) {
      const { traverse, notes } = traverseToSoftreeAsc(book, { unitM: 1, format, startStation: 10, equations })
      expect(notes).toEqual([])
      const text = writeSoftreeAscTraverse(traverse)
      expect(isSoftreeAscTraverse(text)).toBe(true)
      const t = parseSoftreeAscTraverse(text)
      expect(t.format).toBe(format)
      expect(t.sideShots).toBe(3)
      const read = softreeAscToTraverse(t, { unitM: 1, ids: 'label' })
      expectSameBook(book, read.input, format === 'ipd')
      expect(read.startStation).toBe(10)
      expect(read.equations).toEqual(equations)
      expect(read.fileCheck!.maxDifferenceM).toBeLessThan(0.002)
      expect(read.stationIds.slice(1)).toEqual(book.legs.map((l) => l.id))
    }
  })

  it('writes calculated stations on request, and feet', () => {
    const { traverse, notes } = traverseToSoftreeAsc(book, {
      unitM: 0.3048,
      equations: [{ back: 30, ahead: 40 }],
      stationColumn: 'calculated',
    })
    expect(notes.join(' ')).toMatch(/equations were not written/)
    const read = softreeAscToTraverse(parseSoftreeAscTraverse(writeSoftreeAscTraverse(traverse)), {
      unitM: 0.3048,
      ids: 'label',
    })
    expect(read.equations).toEqual([])
    expectSameBook(book, read.input, false)
  })

  it('measures slope distances, deflections, elevation differences and radial shots', () => {
    const text = crlf([
      'V3',
      // start, absolute; foreshot by slope distance (TYPE 7 + 16)
      `0,90,,,${(10 * Math.sqrt(1.01)).toFixed(6)},10,,,100,200,50,23`,
      // deflection 90° right of 90° → 180°, elevation difference −2 (64 + 128)
      '10,90,,20,,-2,,,,,,192',
      // a radial shot from the station above (512): not a leg
      '10,0,,5,,0,R1,,,,,512',
      '30,,,,,,end',
    ])
    const read = softreeAscToTraverse(parseSoftreeAscTraverse(text), { unitM: 1 })
    expect(
      read.input.legs.map((l) => [l.bearingDegrees, Number(l.horizontalDistanceM.toFixed(6)), l.gradePercent]),
    ).toEqual([
      [90, 10, 10],
      [180, 20, -10],
    ])
    expect(read.points).toHaveLength(1)
    const [x, y, z] = read.points[0].coordinate
    expect([x, y, z].map((v) => Number(v.toFixed(6)))).toEqual([110, 205, 51])
    expect(read.points[0].id).toBe('R1')
  })

  it('reads IPD side shots from the last turning point and refuses broken files', () => {
    // Two shots left: the first not a turning point (TP flag 1), so the second is from the station.
    const text = crlf(['V7', '0,0,,10,,0,,,0,0,0,7,,,,,,,,,,,5,0,,,a,8,10,,,b,0,,,,,0,,,,,1,0', '10'])
    const read = softreeAscToTraverse(parseSoftreeAscTraverse(text), { unitM: 1 })
    expect(read.input.sideShots!.map((s) => [s.id, s.offsetM, Number(s.heightDifferenceM.toFixed(6))])).toEqual([
      ['a', -5, 0],
      ['b', -8 / Math.sqrt(1.01), Number(((8 / Math.sqrt(1.01)) * 0.1).toFixed(6))],
    ])
    expect(() => parseSoftreeAscTraverse('0,1,2\r\n')).toThrow(/version/)
    expect(() => parseSoftreeAscTraverse(crlf(['V3', '0,1,,x']))).toThrow(/not a number/)
    expect(() => parseSoftreeAscTraverse(crlf(['V3', `0,1,,1,,,,,,,,,,,,,,,,,,,1,2,3`]))).toThrow(/whole groups/)
    expect(() =>
      softreeAscToTraverse(parseSoftreeAscTraverse(crlf(['V3', '0,0,,10,,0,,,0,0,0,7', '10,0,,10,,0,,,5,5,5,7'])), {
        unitM: 1,
      }),
    ).toThrow(/part-way/)
    expect(() => softreeAscToTraverse(parseSoftreeAscTraverse(roadSurvey), { unitM: 0 })).toThrow(/units/)
  })
})

// The help's Polycorder Roads example rows (the first, the 120 m row with two left shots, the culvert row).
const polycorder = crlf([
  '0.0,20.0,120.0,-5.0,"",450,"CS",1.0,"RK",-6.0,0.0,0.0,6.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0',
  '20.0,20.0,124.0,-8.0,"",0,"CS",2.0,"RK",4.0,0.0,0.0,-6.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0',
  '40.0,20.0,113.0,-3.0,"",0,"LO",1.0,"RK",-5.0,10.0,0.0,0.0,0.0,0.0,12.0,15.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0',
  '60.0,40.0,125.0,0.0,"2 PIPES",900,"OR",5.0,"RK",0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0',
  '100.0,40.0,125.0,0.0,"SUPPORT",0,"OR",5.0,"SD",0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0',
])

describe('Polycorder Roads traverse', () => {
  it('reads and writes the help’s rows byte for byte, and reduces them', () => {
    expect(isPolycorderTraverse(polycorder)).toBe(true)
    expect(isSoftreeAscTraverse(polycorder)).toBe(false)
    expect(isUnitSurvey(polycorder)).toBe(false)
    const { records } = parsePolycorderTraverse(polycorder)
    expect(records[3]).toMatchObject({ label: '2 PIPES', culvert: 900, soil1: 'OR', depth: 5, soil2: 'RK' })
    expect(writePolycorderTraverse(records)).toBe(polycorder)
    expect(() => polycorderToTraverse(records, { unitM: 1 })).toThrow(SoftreeTraverseStartQuestion)
    const read = polycorderToTraverse(records, { unitM: 1, start: [0, 0, 100] })
    // The last row's 40 m leads to an end station at 140.
    expect(read.input.legs.map((l) => [l.id, l.horizontalDistanceM, l.bearingDegrees, l.gradePercent])).toEqual([
      ['20.000', 20, 120, -5],
      ['40.000', 20, 124, -8],
      ['60.000', 20, 113, -3],
      ['100.000', 40, 125, 0],
      ['140.000', 40, 125, 0],
    ])
    const s = read.input.sideShots!.filter((x) => x.station === 2)
    const h1 = 10 / Math.sqrt(1.0025),
      h2 = 15 / Math.sqrt(1.0144)
    expect(s.map((x) => [Number(x.offsetM.toFixed(6)), Number(x.heightDifferenceM.toFixed(6))])).toEqual([
      [Number((-h1).toFixed(6)), Number((-0.05 * h1).toFixed(6))],
      [Number((-h1 - h2).toFixed(6)), Number((-0.05 * h1 + 0.12 * h2).toFixed(6))],
    ])
    expect(read.extras[0]).toMatchObject({
      ground: [{ type: 'CS', depth: 1 }, { type: 'RK' }],
      culvert: { sizeY: 450, sizeX: null },
      extensionSlope: { left: -6, right: 6 },
    })
  })

  it('round-trips a field book (three side shots a side) with an equation', () => {
    const equations = [{ back: 45.5, ahead: 50 }]
    const { records, notes } = traverseToPolycorder(book, { unitM: 1, equations })
    expect(notes.join(' ')).toMatch(/no coordinates/)
    const text = writePolycorderTraverse(records, { decimals: 4 })
    expect(isPolycorderTraverse(text)).toBe(true)
    const read = polycorderToTraverse(parsePolycorderTraverse(text).records, {
      unitM: 1,
      start: book.start,
      ids: 'label',
    })
    expect(read.equations).toEqual(equations)
    expectSameBook({ ...book, legs: book.legs }, read.input, false)
  })
})

// The unit survey example from the RoadEng 4 Terrain help, as the PEGGER manual quotes it.
const unitSurvey = crlf([
  'TRAV1,SR,1420,2230,1311,BM1',
  'TRAV1,BS,2,1,180:30:00,.356,120,0,0',
  'TRAV1,FS,1,2,75:30:00,.356,120,0,0,TP2',
  'TRAV1,SD,2,5,340:30:00,.12,67,0,0,SS2-5',
  'TRAV1,SD,2,6,5:30:00,.12,33,0,0,SS2-6',
  'TRAV1,FS,2,3,90:30:00,.256,60,0,0,TP3',
  'TRAV1,FS,3,4,45:30:00,.12,93,0,0,TP4',
  'TRAV1,SD,4,8,25:30:00,.12,85,0,0,SS4-8',
  'TRAV1,SD,4,9,45:30:00,.12,85,0,0,SS4-9',
  'TRAV1,SD,4,10,75:30:00,.12,85,0,0,SS4-10',
])

describe('Unit survey (.pol)', () => {
  it('reads the help’s example: D:M:S angles, averaged backshots, square side shots', () => {
    expect(isUnitSurvey(unitSurvey)).toBe(true)
    expect(isSoftreeTerrainAscii(unitSurvey)).toBe(false)
    const file = parseUnitSurvey(unitSurvey)
    expect(file.surveys).toEqual(['TRAV1'])
    expect(file.records[2]).toMatchObject({
      kind: 'FS',
      from: '1',
      to: '2',
      azimuth: 75.5,
      vertical: 0.356,
      distance: 120,
      code: 'TP2',
    })
    expect(writeUnitSurvey(file.records, { angles: 'as-read', decimals: 0 })).toContain('TRAV1,FS,1,2,75:30:00,')
    const read = unitSurveyToTraverse(file.records, {
      unitM: 1,
      vertical: 'slope-percent',
      distance: 'horizontal',
      ids: 'label',
    })
    expect(read.input.start).toEqual([1420, 2230, 1311])
    expect(read.input.legs.map((l) => l.id)).toEqual(['TP2', 'TP3', 'TP4'])
    expect(read.notes.join(' ')).toMatch(/1 backshots were averaged/)
    expect(read.notes.join(' ')).toMatch(/disagree by up to/)
    // SS2-6 at 5:30 is 5° off square to the 90:30 leg from point 2: a side shot, on the left.
    expect(read.input.sideShots!.map((s) => [s.id, s.station, Math.sign(s.offsetM)])).toEqual([['SS2-6', 1, -1]])
    expect(read.points.map((p) => p.id)).toEqual(['SS2-5', 'SS4-8', 'SS4-9', 'SS4-10'])
  })

  it('round-trips a field book in every vertical kind it writes', () => {
    for (const vertical of ['slope-percent', 'inclination', 'zenith', 'elevation-difference'] as Exclude<
      UnitSurveyVertical,
      'elevation'
    >[])
      for (const angles of ['decimal', 'dms'] as const) {
        const { records } = traverseToUnitSurvey(book, { unitM: 1, vertical, survey: 'Spur 12 north' })
        const text = writeUnitSurvey(records, { angles, decimals: 4 })
        expect(isUnitSurvey(text)).toBe(true)
        const file = parseUnitSurvey(text)
        expect(file.surveys).toEqual(['Spur12no'])
        const read = unitSurveyToTraverse(file.records, { unitM: 1, vertical, distance: 'horizontal', ids: 'label' })
        // D:M:S rounds to the second: 5 mm across 30 m.
        if (angles === 'decimal') expectSameBook(book, read.input)
        else expect(read.input.legs.map((l) => l.id)).toEqual(book.legs.map((l) => l.id))
      }
  })

  it('reads slope distances and elevations', () => {
    const text = crlf(['S,SR,0,0,100,', 'S,FS,1,2,0,30:00:00,20,1.5,1.5,P2', 'S,FS,2,3,90,95,10,0,0,P3'])
    const records = parseUnitSurvey(text).records
    const incl = unitSurveyToTraverse(records.slice(0, 2), { unitM: 1, vertical: 'inclination', distance: 'slope' })
    expect(incl.input.legs[0].horizontalDistanceM).toBeCloseTo(20 * Math.cos(Math.PI / 6), 9)
    expect(incl.input.legs[0].gradePercent).toBeCloseTo(Math.tan(Math.PI / 6) * 100, 9)
    // Elevations of the target: the rise is the difference, the horizontal from the slope distance.
    const elev = unitSurveyToTraverse(
      parseUnitSurvey(crlf(['S,SR,0,0,100,', 'S,FS,1,2,0,106,10,0,0,P2', 'S,FS,2,3,90,100,10,0,0,P3'])).records,
      { unitM: 1, vertical: 'elevation', distance: 'slope' },
    )
    expect(elev.input.legs.map((l) => [l.horizontalDistanceM, l.gradePercent])).toEqual([
      [8, 75],
      [8, -75],
    ])
  })

  it('reads angles in decimal degrees and D:M:S', () => {
    expect(parseAngle('75:30:00')).toBe(75.5)
    expect(parseAngle('-1:30')).toBe(-1.5)
    expect(parseAngle('12.25')).toBe(12.25)
    expect(parseAngle('')).toBeNull()
    expect(parseAngle('north')).toBeUndefined()
    expect(formatDms(75.5)).toBe('75:30:00')
    expect(formatDms(-0.0002778, 1)).toBe('-0:00:01.0')
  })
})

// The first sentences of the help's Laser Technology raw example (their checksums are the help's).
const raw = [
  '$PLTIT,UD,1,1,FS,1,2,,,,,,*52',
  '$PLTIT,UD,1,2,SD,1,3,217.4,D,-1.85,D,24.1,F*1C',
  '$PLTIT,UD,1,10,FS,2,11,320.4,D,-1.10,D,26.9,F*1E',
  '$PLTIT,UD,1,11,SD,2,12,216.1,D,-9.35,D,21.2,F*1C',
  '$PLTIT,UD,1,15,SD,2,16,31.3,D,4.62,D,28.0,F*00',
  '$PLTIT,UD,1,19,FS,11,20,297.4,D,-0.65,D,23.9,F*2C',
  '$PLTIT,UD,1,26,FS,20,27,276.5,D,-2.86,D,25.5,F*2E',
]

describe('Laser Technology raw unit survey', () => {
  it('checks and writes checksums, states feet, and reduces through the unit survey', () => {
    const text = crlf(raw)
    expect(isLaserRawSurvey(text)).toBe(true)
    expect(isUnitSurvey(text)).toBe(false)
    const file = parseLaserRawSurvey(text)
    expect(file.unitM).toBe(0.3048)
    expect(file.records[1]).toMatchObject({
      kind: 'SD',
      from: '1',
      to: '3',
      azimuth: 217.4,
      inclination: -1.85,
      slopeDistance: 24.1,
      unit: 'F',
    })
    expect(writeLaserRawSurvey(file.records)).toBe(text)
    // Run together on one line, as the help prints them.
    expect(parseLaserRawSurvey(raw.join(' ')).records).toHaveLength(raw.length)
    expect(() => parseLaserRawSurvey(raw[1].replace('*1C', '*1D'))).toThrow(/checksum/)
    const read = unitSurveyToTraverse(laserRawAsUnitSurvey(file.records), {
      unitM: file.unitM!,
      vertical: 'inclination',
      distance: 'slope',
      start: [0, 0, 0],
    })
    expect(read.input.legs.map((l) => l.id)).toEqual(['11', '20', '27'])
    expect(read.input.legs[0].horizontalDistanceM).toBeCloseTo(26.9 * 0.3048 * Math.cos(1.1 * (Math.PI / 180)), 9)
    expect(read.notes.join(' ')).toMatch(/left out/)
  })
})

// ─── a traverse file's details, carried through the field book ────────────────────────────────

// A generated Softree ASCII traverse with every detail: labels, a between-station label, three
// ground layers with depths, a culvert, HI/HT, a backshot, side shots with depths and slopes beyond
// them, a reference shot, an IFS shot (a located point) and a station equation (written 50 where the
// distances give 45.5).
const detailed = crlf([
  'V3 PGMaps test',
  '0.000,45.000,,20.000,,6.000,Start,,500000.000,5970000.000,700.000,7,,,,HP,0.300,RK,1.200,SD,1.500,1.400,4.000,-10.000,0.100,,0.000,-8.000,,,5.000,5.000,0.200,0.400,0.000,6.000,,,0,0',
  '20.000,60.250,225.100,25.500,,-3.500,Culvert,between,,,,0,600.000xx2.500x150.000x0x0.000x,10.000,30.000,OR,0.150,,,,,,0.000,,,,0.000,,,,0.000,,,,0.000,,,,0,0',
  '45.500,300.000,,12.000,,2.000,Spring,,,,,8,,,,,,,,,,,0.000,,,,0.000,,,,0.000,,,,0.000,,,,0,0',
  '50.000,350.000,,31.250,,12.000,TP3,,,,,0,,,,,,,,,1.600,1.600,6.500,4.000,,0.050,0.000,,,,0.000,,,,0.000,,,,0,0',
  '81.250,,,,,,End,,,,,0,,,,,,,,,,,0.000,,,,0.000,,,,0.000,,,,0.000,,,,0,0',
])
// The full Polycorder Roads example from the help, one row a line.
const polycorderHelp = crlf(
  [
    '0.0,20.0,120.0,-5.0,"",450,"CS",1.0,"RK",-6.0,0.0,0.0,6.0,0.0,0.0',
    '20.0,20.0,124.0,-8.0,"",0,"CS",2.0,"RK",4.0,0.0,0.0,-6.0,0.0,0.0',
    '40.0,20.0,112.0,-7.0,"",0,"SI",0.5,"RK",-6.0,0.0,0.0,6.0,0.0,0.0',
    '60.0,20.0,134.0,4.0,"",0,"LO",2.0,"RK",-6.0,0.0,0.0,6.0,0.0,0.0',
    '80.0,20.0,123.0,1.0,"",0,"CS",1.0,"RK",-5.0,0.0,0.0,5.0,0.0,0.0',
    '100.0,20.0,134.0,2.0,"",0,"FS",1.0,"RK",-6.0,0.0,0.0,6.0,0.0,0.0',
    '120.0,20.0,113.0,-3.0,"",0,"LO",1.0,"RK",-5.0,10.0,0.0,0.0,0.0,0.0,12.0,15.0,0.0',
    '140.0,20.0,117.0,-6.0,"",0,"LO",2.0,"RK",-2.0,0.0,0.0,2.0,0.0,0.0',
    '160.0,20.0,120.0,-5.0,"",0,"LO",2.0,"RK",0.0,0.0,0.0,0.0,0.0,0.0',
    '180.0,20.0,125.0,0.0,"",0,"OR",5.0,"SD",0.0,0.0,0.0,0.0,0.0,0.0',
    '200.0,40.0,125.0,0.0,"2 PIPES",900,"OR",5.0,"RK",0.0,0.0,0.0,0.0,0.0,0.0',
    '240.0,40.0,125.0,0.0,"SUPPORT",0,"OR",5.0,"SD",0.0,0.0,0.0,0.0,0.0,0.0',
    '280.0,20.0,123.0,1.0,"",0,"LO",3.0,"RK",-2.0,0.0,0.0,3.0,0.0,0.0',
    '300.0,20.0,123.0,1.0,"",0,"CS",1.0,"RK",-4.0,0.0,0.0,2.0,0.0,0.0',
    '320.0,20.0,123.0,1.0,"",0,"CS",1.0,"RK",-5.0,0.0,0.0,5.0,0.0,0.0',
  ].map((row) => {
    // The help prints every row to its 27 fields; the rows above stop where the zeros begin.
    const f = row.split(',')
    while (f.length < 27) f.push('0.0')
    return f.join(',')
  }),
)
// The IPD example of the side-shot test above: turning-point flags, codes and a short last record.
const ipdShots = crlf(['V7', '0,0,,10,,0,,,0,0,0,7,,,,,,,,,,,5,0,,,a,8,10,,,b,0,,,,,0,,,,,1,0', '10'])

const detailsOf = (
  read: ReturnType<typeof softreeAscToTraverse>,
  sourceFormat: SoftreeTraverseDetails['sourceFormat'],
  unitM: number,
): SoftreeTraverseDetails => ({
  sourceFormat,
  unitM,
  extras: read.extras,
  points: read.points,
  ...(read.source ? { source: read.source } : {}),
})

/** Every detail of a read traverse in metres, by station, for the fields `format` carries. */
function detailView(
  read: ReturnType<typeof softreeAscToTraverse>,
  details: SoftreeTraverseDetails,
  format: 'asc' | 'ipd' | 'polycorder' | 'unit-survey',
) {
  // Millimetres: a file in feet holds three decimals of a foot.
  const m = (v: number | null | undefined) =>
    v === null || v === undefined ? null : Number((v * details.unitM).toFixed(3))
  const stations = details.extras.map((e) => {
    const c = e.culvert ? culvertInMetres(e.culvert, details.sourceFormat, details.unitM) : null
    const view: Record<string, unknown> = { station: e.station, label: e.label ?? '' }
    if (format === 'polycorder') {
      view.ground = (e.ground ?? []).slice(0, 2).map((g, k) => ({ type: g.type, depth: k ? null : m(g.depth) }))
      view.culvert = c ? Number(((c.sizeXM ?? c.sizeYM)! * 1000).toFixed(0)) : null
      view.depths = (e.sideShots ?? []).filter((s) => s.depths[0] != null).map((s) => [s.side, s.n, m(s.depths[0])])
      view.extension = e.extensionSlope ?? null
    } else if (format === 'unit-survey') {
      view.heights = (e.hi ?? 0) || (e.ht ?? 0) ? [m(e.hi), m(e.ht)] : null
    } else {
      view.label2 = e.label2 ?? ''
      view.ground = (e.ground ?? []).map((g) => ({ type: g.type, depth: m(g.depth) }))
      view.culvert =
        c &&
        Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'number' ? Number(v.toFixed(3)) : v]))
      view.heights = [m(e.hi), m(e.ht)]
      view.backshot = e.backshot ?? null
      view.depths = (e.sideShots ?? []).map((s) => [
        s.side,
        s.n,
        s.depths.map(m),
        ...(format === 'ipd' ? [s.code ?? ''] : []),
      ])
      view.extension = e.extensionSlope ?? null
    }
    return view
  })
  return {
    stations: stations.filter((v) =>
      Object.entries(v).some(([k, x]) => k !== 'station' && x !== null && x !== '' && !(Array.isArray(x) && !x.length)),
    ),
    points:
      format === 'polycorder'
        ? []
        : // Centimetres: a point's position runs through the leg before it, rounded in each file.
          read.points.map((p) => ({ id: p.id, station: p.station, at: p.coordinate.map((v) => Number(v.toFixed(2))) })),
  }
}

describe('a traverse file’s details through the field book', () => {
  it('reads every detail of a generated ASCII traverse', () => {
    const read = softreeAscToTraverse(parseSoftreeAscTraverse(detailed), { unitM: 1 })
    expect(read.extras).toEqual([
      {
        station: 0,
        label: 'Start',
        ground: [
          { type: 'HP', depth: 0.3 },
          { type: 'RK', depth: 1.2 },
          { type: 'SD', depth: null },
        ],
        hi: 1.5,
        ht: 1.4,
        sideShots: [
          { side: 'left', n: 1, depths: [0.1, null] },
          { side: 'right', n: 1, depths: [0.2, 0.4] },
        ],
        extensionSlope: { left: -8, right: 6 },
      },
      {
        station: 1,
        label: 'Culvert',
        label2: 'between',
        ground: [{ type: 'OR', depth: 0.15 }],
        culvert: {
          raw: '600.000xx2.500x150.000x0x0.000x',
          sizeY: 600,
          sizeX: null,
          gradientPercent: 2.5,
          azimuth: 150,
          flag: 0,
          sd: 0,
        },
        backshot: 225.1,
      },
      {
        station: 2,
        label: 'TP3',
        hi: 1.6,
        ht: 1.6,
        sideShots: [{ side: 'left', n: 1, depths: [null, 0.05] }],
      },
      { station: 3, label: 'End' },
    ])
    // HI − HT is in the first leg's rise: 20 × 6% + 0.1.
    expect(read.input.legs[0].gradePercent).toBeCloseTo(6.5, 9)
    expect(read.points).toEqual([{ id: 'Spring', from: '20.000', station: 1, coordinate: expect.any(Array) }])
    expect(read.equations).toEqual([{ back: 45.5, ahead: 50 }])
  })

  it.each([
    ['the help’s road survey', roadSurvey, 'asc', 1, undefined],
    [
      'the help’s boundary traverse (feet, spaces, its typo read as equations)',
      boundary,
      'asc',
      0.3048,
      [1000, 2000, 300],
    ],
    ['the generated traverse', detailed, 'asc', 1, undefined],
    ['the generated traverse in feet', detailed, 'asc', 0.3048, undefined],
    ['an IPD traverse with turning-point flags', ipdShots, 'ipd', 1, undefined],
  ] as const)('writes %s back byte for byte when the field book is unchanged', (_name, text, format, unitM, start) => {
    const t = parseSoftreeAscTraverse(text)
    expect(writeSoftreeAscTraverse(t)).toBe(text)
    const read = softreeAscToTraverse(t, { unitM, ...(start ? { start: [...start] as [number, number, number] } : {}) })
    const { traverse, notes } = traverseToSoftreeAsc(read.input, {
      unitM,
      format,
      startStation: read.startStation,
      equations: read.equations,
      details: detailsOf(read, format, unitM),
    })
    expect(writeSoftreeAscTraverse(traverse)).toBe(text)
    expect(notes).toEqual([])
  })

  it('writes the help’s Polycorder rows and unit survey back byte for byte when the field book is unchanged', () => {
    const file = parsePolycorderTraverse(polycorderHelp)
    expect(writePolycorderTraverse(file.records)).toBe(polycorderHelp)
    const read = polycorderToTraverse(file.records, { unitM: 1, start: [0, 0, 100], layout: file.layout })
    const back = traverseToPolycorder(read.input, {
      unitM: 1,
      startStation: read.startStation,
      equations: read.equations,
      details: detailsOf(read, 'polycorder', 1),
    })
    expect(writePolycorderTraverse(back.records, { decimals: 3, layout: back.layout })).toBe(polycorderHelp)

    const survey = parseUnitSurvey(unitSurvey)
    expect(writeUnitSurvey(survey.records)).toBe(unitSurvey)
    const pol = unitSurveyToTraverse(survey.records, {
      unitM: 1,
      vertical: 'slope-percent',
      distance: 'horizontal',
      layout: survey.layout,
    })
    expect(pol.extras).toEqual([
      { station: 0, label: 'BM1' },
      { station: 1, label: 'TP2' },
      { station: 2, label: 'TP3' },
      { station: 3, label: 'TP4' },
    ])
    const polBack = traverseToUnitSurvey(pol.input, { unitM: 1, details: detailsOf(pol, 'unit-survey', 1) })
    expect(writeUnitSurvey(polBack.records, { layout: polBack.layout })).toBe(unitSurvey)
    expect(polBack.notes.join(' ')).toMatch(/slope percent and horizontal distances, as it was read/)
  })

  it('writes an edited detail into its own field and leaves every other byte as read', () => {
    const read = softreeAscToTraverse(parseSoftreeAscTraverse(detailed), { unitM: 1 })
    const details = detailsOf(read, 'asc', 1)
    const edit = (change: (e: SoftreeTraverseDetails['extras']) => void) => {
      const d = structuredClone(details)
      change(d.extras)
      return d
    }
    const write = (d: SoftreeTraverseDetails, input = read.input) =>
      writeSoftreeAscTraverse(
        traverseToSoftreeAsc(input, {
          unitM: 1,
          startStation: read.startStation,
          equations: read.equations,
          details: d,
        }).traverse,
      )
    const lines = detailed.split('\r\n')
    // A culvert's size: only that record's CREEK field changes.
    const culvert = write(
      edit((e) => {
        e[1].culvert = { ...e[1].culvert!, sizeY: 750 }
      }),
    )
    const changed = culvert.split('\r\n')
    expect(changed.filter((l, i) => l !== lines[i])).toEqual([
      lines[2].replace('600.000xx2.500x150.000x0x0.000x', '750.000xx2.500x150.000x0x0.000x'),
    ])
    // A label, a ground layer's depth and a side-shot depth.
    const notes = write(
      edit((e) => {
        e[3].label = 'End of survey'
        e[1].ground = [{ type: 'OR', depth: 0.25 }]
        e[0].sideShots![0].depths = [0.12, null]
      }),
    ).split('\r\n')
    expect(notes[5]).toBe(lines[5].replace(',End,', ',End of survey,'))
    expect(notes[2]).toBe(lines[2].replace('OR,0.150', 'OR,0.250'))
    expect(notes[1]).toBe(lines[1].replace('-10.000,0.100', '-10.000,0.120'))
    // HI corrected at the station, with the leg's rise following it: the slope reading stays as read.
    const hiInput = structuredClone(read.input)
    hiInput.legs[0].gradePercent += (0.2 / 20) * 100
    const hi = write(
      edit((e) => {
        e[0].hi = 1.7
      }),
      hiInput,
    ).split('\r\n')
    expect(hi[1]).toBe(lines[1].replace('SD,1.500,1.400', 'SD,1.700,1.400'))
    expect(hi.slice(2)).toEqual(lines.slice(2))
  })
})

describe('details written in every format, metres and feet', () => {
  const formats = ['asc', 'ipd', 'polycorder', 'unit-survey'] as const
  const units = [1, 0.3048]
  // Read in metres; the generated file's side shots carry codes when read as IPD.
  const ascRead = softreeAscToTraverse(parseSoftreeAscTraverse(detailed), { unitM: 1 })
  const ascDetails = detailsOf(ascRead, 'asc', 1)

  function writeAndRead(format: (typeof formats)[number], unitM: number) {
    const options = { unitM, startStation: ascRead.startStation, equations: ascRead.equations, details: ascDetails }
    if (format === 'asc' || format === 'ipd') {
      const { traverse, notes } = traverseToSoftreeAsc(ascRead.input, { ...options, format })
      const text = writeSoftreeAscTraverse(traverse)
      return { notes, text, read: softreeAscToTraverse(parseSoftreeAscTraverse(text), { unitM }) }
    }
    if (format === 'polycorder') {
      const { records, notes } = traverseToPolycorder(ascRead.input, options)
      const text = writePolycorderTraverse(records, { decimals: 4 })
      return {
        notes,
        text,
        read: polycorderToTraverse(parsePolycorderTraverse(text).records, { unitM, start: ascRead.input.start }),
      }
    }
    const { records, notes, vertical, distance } = traverseToUnitSurvey(ascRead.input, { unitM, details: ascDetails })
    const text = writeUnitSurvey(records, { decimals: 4 })
    return { notes, text, read: unitSurveyToTraverse(parseUnitSurvey(text).records, { unitM, vertical, distance }) }
  }

  it.each(formats.flatMap((f) => units.map((u) => [f, u] as const)))(
    'carries what %s holds (unit %s m) and names the rest',
    (format, unitM) => {
      const { notes, read } = writeAndRead(format, unitM)
      const back = detailsOf(read, format === 'ipd' ? 'ipd' : format, unitM)
      // The traverse itself.
      expectSameBook(ascRead.input, read.input, false)
      if (format !== 'unit-survey') {
        expect(read.startStation).toBeCloseTo(ascRead.startStation, 3)
        expect(read.equations.map((e) => [e.back, e.ahead].map((v) => Number(v.toFixed(3))))).toEqual([[45.5, 50]])
      }
      // The details the format carries, in metres.
      expect(detailView(read, back, format)).toEqual(detailView(ascRead, ascDetails, format))
      // And the ones it cannot hold, named.
      const said = notes.join(' ')
      if (format === 'asc') expect(said).not.toMatch(/Not written/)
      if (format === 'ipd') expect(said).not.toMatch(/Not written/)
      if (format === 'polycorder')
        for (const what of [
          'between-station labels at 1 station',
          'third ground layers at 1 station',
          'second-layer depths at 1 station',
          'culvert gradients, azimuths or orientations at 1 station',
          'HI/HT at 2 stations',
          'backshots at 1 station',
          'second side-shot depths at 2 stations',
          '1 located point',
        ])
          expect(said).toContain(what)
      if (format === 'unit-survey')
        for (const what of [
          'between-station labels at 1 station',
          'ground layers at 2 stations',
          'culverts at 1 station',
          'backshots at 1 station',
          'side-shot depths at 2 stations',
          'slopes beyond the last side shot at 1 station',
        ])
          expect(said).toContain(what)
    },
  )

  it('reads a file back in its own format and unit as the same records after a change of unit', () => {
    // Feet → metres → feet: written afresh in metres, then as read in feet again.
    const feet = softreeAscToTraverse(parseSoftreeAscTraverse(detailed), { unitM: 0.3048 })
    const inMetres = writeSoftreeAscTraverse(
      traverseToSoftreeAsc(feet.input, {
        unitM: 1,
        startStation: feet.startStation,
        equations: feet.equations,
        details: detailsOf(feet, 'asc', 0.3048),
      }).traverse,
    )
    const metres = softreeAscToTraverse(parseSoftreeAscTraverse(inMetres), { unitM: 1 })
    const view = (r: typeof feet, unitM: number) => detailView(r, detailsOf(r, 'asc', unitM), 'asc')
    expect(view(metres, 1)).toEqual(view(feet, 0.3048))
    // The culvert keeps its size: 600 thousandths of a foot are 182.88 mm.
    expect(metres.extras[1].culvert!.sizeY).toBeCloseTo(182.88, 6)
  })

  it('writes an IPD culvert in its own sizes: a pipe in millimetres, a box in units', () => {
    const pipe = { sizeY: 600, sizeX: null, gradientPercent: null, azimuth: null, flag: null, sd: null }
    expect(culvertInMetres(pipe, 'asc', 1).sizeYM).toBeCloseTo(0.6, 12)
    expect(culvertInMetres(pipe, 'ipd', 1).sizeYM).toBeCloseTo(0.6, 12)
    expect(culvertInMetres(pipe, 'ipd', 0.3048).sizeYM).toBeCloseTo(600 * 0.0254, 12)
    const box = { ...pipe, sizeY: 1.2, sizeX: 2 }
    expect(culvertInMetres(box, 'ipd', 1)).toMatchObject({ sizeYM: 1.2, sizeXM: 2 })
    expect(culvertInMetres({ ...box, sizeY: 1200, sizeX: 2000 }, 'asc', 1)).toMatchObject({ sizeYM: 1.2, sizeXM: 2 })
  })
})

describe('edits written back into a kept Polycorder traverse or unit survey', () => {
  it('Polycorder: a label, a soil, a culvert and a side shot change only their own fields', () => {
    const file = parsePolycorderTraverse(polycorderHelp)
    const read = polycorderToTraverse(file.records, { unitM: 1, start: [0, 0, 100], layout: file.layout })
    const details = structuredClone(detailsOf(read, 'polycorder', 1))
    const at = (st: number) => {
      let e = details.extras.find((x) => x.station === st)
      if (!e) details.extras.push((e = { station: st }))
      return e
    }
    at(1).label = 'Seep'
    at(2).ground = [
      { type: 'LO', depth: 0.5 },
      { type: 'RK', depth: null },
    ]
    at(10).culvert = { ...at(10).culvert!, sizeY: 1200 }
    const input = structuredClone(read.input)
    // Station 6's second left shot moves out by a metre.
    const shot = input.sideShots!.find((s) => s.station === 6 && s.id.endsWith('L2'))!
    shot.offsetM -= 1
    const { records, layout } = traverseToPolycorder(input, {
      unitM: 1,
      startStation: read.startStation,
      equations: read.equations,
      details,
    })
    const lines = polycorderHelp.split('\r\n'),
      out = writePolycorderTraverse(records, { decimals: 3, layout }).split('\r\n')
    expect(out[1]).toBe(lines[1].replace('"",0,"CS"', '"Seep",0,"CS"'))
    expect(out[2]).toBe(lines[2].replace('"SI",0.5', '"LO",0.5'))
    expect(out[10]).toBe(lines[10].replace(',900,', ',1200,'))
    expect(out[6].split(',').slice(0, 15)).toEqual(lines[6].split(',').slice(0, 15))
    expect(out[6]).not.toBe(lines[6])
    expect(out.filter((l, i) => l !== lines[i]).length).toBe(4)
    // Read again: the shot is where it was moved to.
    const again = polycorderToTraverse(parsePolycorderTraverse(out.join('\r\n')).records, {
      unitM: 1,
      start: [0, 0, 100],
    })
    expect(again.input.sideShots!.find((s) => s.station === 6 && s.id.endsWith('L2'))!.offsetM).toBeCloseTo(
      shot.offsetM,
      3,
    )
  })

  it('unit survey: a code, an HI and a side shot change only their own records', () => {
    const survey = parseUnitSurvey(unitSurvey)
    const read = unitSurveyToTraverse(survey.records, {
      unitM: 1,
      vertical: 'slope-percent',
      distance: 'horizontal',
      layout: survey.layout,
    })
    const details = structuredClone(detailsOf(read, 'unit-survey', 1))
    details.extras.find((e) => e.station === 3)!.label = 'TP4-END'
    // HI at point 2 measured 1.5 m: the leg to point 3 rises 1.5 m more, its reading stays as read.
    details.extras.find((e) => e.station === 1)!.hi = 1.5
    const input = structuredClone(read.input)
    input.legs[1].gradePercent += (1.5 / input.legs[1].horizontalDistanceM) * 100
    // The square side shot at point 2 (SS2-6, named 6) moves 1 m out.
    input.sideShots![0].offsetM -= 1
    const back = traverseToUnitSurvey(input, { unitM: 1, details })
    const lines = unitSurvey.split('\r\n'),
      out = writeUnitSurvey(back.records, { layout: back.layout }).split('\r\n')
    expect(out[6]).toBe('TRAV1,FS,3,4,45:30:00,.12,93,0,0,TP4-END')
    expect(out[5]).toBe('TRAV1,FS,2,3,90:30:00,.256,60,1.500,0,TP3')
    // The side shot is written afresh in its place, under its own name, square to the leg.
    expect(out[4]).toMatch(/^TRAV1,SD,2,6,0:30:00,/)
    expect(out.filter((l, i) => l !== lines[i])).toHaveLength(3)
    const again = unitSurveyToTraverse(parseUnitSurvey(out.join('\r\n')).records, {
      unitM: 1,
      vertical: 'slope-percent',
      distance: 'horizontal',
    })
    expect(again.extras.find((e) => e.station === 1)).toMatchObject({ hi: 1.5, label: 'TP2' })
    expect(again.input.legs[1].gradePercent).toBeCloseTo(input.legs[1].gradePercent, 9)
    expect(again.input.sideShots![0].offsetM).toBeCloseTo(input.sideShots![0].offsetM, 3)
  })
})
