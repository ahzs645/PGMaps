import { describe, expect, it } from 'vitest'
import {
  azimuthFromSkew,
  culvertsFromTraverse,
  parseRoadEngCulvertRecord,
  roadEngNewCulvertDiameterM,
  skewFromAzimuth,
  traverseCulverts,
  traverseWithRoadCulverts,
  type RoadLocator,
} from './roadEngCulverts'
import { readTraverseFile, traverseFileDetails, writeTraverseFile } from './traverseFiles'
import type { SurveyBookRecord } from './surveyInterchange'
import type { Culvert } from './engineeringTypes'

const crlf = (lines: string[]) => lines.join('\r\n') + '\r\n'
// A generated Softree ASCII traverse running east, 20 m legs, with culverts (`CREEK`) at stations 1
// and 3: a 600 mm pipe flowing south (square, downstream right of an east-going road) and a 1.2 m by
// 2 m box flowing 200° (20° off square).
const TEXT = crlf([
  'V3 PGMaps culvert test',
  '0.000,90.000,,20.000,,0.000,Start,,500000.000,5970000.000,700.000,7,,,,,,,,,,,0.000,,,,0.000,,,,0,0',
  '20.000,90.000,,20.000,,0.000,Creek A,,,,,0,600.000xx2.500x180.000x0x0.000x,,,,,,,,,,0.000,,,,0.000,,,,0,0',
  '40.000,90.000,,20.000,,0.000,,,,,,0,,,,,,,,,,,0.000,,,,0.000,,,,0,0',
  '60.000,90.000,,20.000,,0.000,Creek B,,,,,0,1200.000x2000.000x4.000x200.000x0x0.000x,,,,,,,,,,0.000,,,,0.000,,,,0,0',
  '80.000,,,,,,End,,,,,0,,,,,,,,,,,0.000,,,,0.000,,,,0,0',
])

function book(): SurveyBookRecord {
  const read = readTraverseFile(TEXT, 'asc', { unitM: 1 })
  return {
    id: 'book-1',
    name: 'P-line',
    epsg: 26910,
    verticalReference: 'CGVD2013',
    input: read.input,
    startStation: read.startStation,
    stationEquations: read.equations,
    softree: traverseFileDetails(read, 1).details,
  }
}
// The road runs east along the traverse from its start: chainage is easting, left is north.
const locate: RoadLocator = ([x, y]) => ({
  chainage: x - 500000,
  offset: -(y - 5970000),
  bearing: 90,
  beyond: x < 500000 - 0.01 ? 'start' : x > 500100 ? 'end' : null,
})
const toLonLat = (xy: [number, number]) => xy
const make = () => ({ lengthM: 12, minCoverM: 0.6, unitCost: 0, fixedCost: 0, diameterM: 0.8 })
let n = 0
const newId = () => `c${++n}`
const existing = (chainage: number, name: string): Culvert => ({
  id: name,
  name,
  chainage,
  skewDegrees: 0,
  lengthM: 12,
  diameterM: 0.5,
  inletInvertM: null,
  outletInvertM: null,
  minCoverM: 0.6,
  unitCost: 0,
  fixedCost: 0,
})

describe('RoadEng culverts from a P-line traverse', () => {
  it('turns an azimuth into a skew and back', () => {
    expect(skewFromAzimuth(180, 90)).toEqual({ skew: 0, flowsLeft: false })
    expect(skewFromAzimuth(200, 90)).toEqual({ skew: 20, flowsLeft: false })
    expect(skewFromAzimuth(0, 90)).toEqual({ skew: 0, flowsLeft: true })
    expect(azimuthFromSkew(20, 90)).toBe(200)
    expect(azimuthFromSkew(0, 90, true)).toBe(0)
  })

  it('reads the book’s culverts onto the road as the Culverts Re-Import does', () => {
    const b = book()
    expect(traverseCulverts(b).map((t) => [t.station, t.pStationM])).toEqual([
      [1, 20],
      [3, 60],
    ])
    const read = culvertsFromTraverse(b, [existing(22, 'Near A'), existing(150, 'Far')], {
      locate,
      toLonLat,
      newId,
      make,
    })
    expect(read.added).toBe(2)
    expect(read.removed).toBe(1)
    expect(read.culverts.map((c) => [c.name, c.chainage, c.diameterM, c.skewDegrees, c.kind])).toEqual([
      ['Creek A', 20, 0.6, 0, 'stream'],
      ['Creek B', 60, 1.2, 20, 'stream'],
      ['Far', 150, 0.5, 0, undefined],
    ])
    expect(read.culverts[1].roadEng).toMatchObject({
      bookId: 'book-1',
      traverseStation: 3,
      pStationM: 60,
      boxWidthM: 2,
      gradientPercent: 4,
      azimuthDeg: 200,
      flag: 0,
      raw: '1200.000x2000.000x4.000x200.000x0x0.000x',
    })
    // A record survives the project file.
    expect(parseRoadEngCulvertRecord(JSON.parse(JSON.stringify(read.culverts[1].roadEng)))).toEqual(
      read.culverts[1].roadEng,
    )
  })

  it('reads a P-station range, and Remove All', () => {
    const only = culvertsFromTraverse(book(), [existing(150, 'Far')], {
      locate,
      toLonLat,
      newId,
      make,
      fromM: 40,
      toM: 100,
      removeAll: true,
    })
    expect(only.culverts.map((c) => c.name)).toEqual(['Creek B'])
    expect(only.removed).toBe(1)
  })

  it('writes the culverts back unchanged as the same file, and an edit changes only its own field', () => {
    const b = book()
    const { culverts } = culvertsFromTraverse(b, [], { locate, toLonLat, newId, make })
    const options = (bk: SurveyBookRecord) => ({
      unitM: 1,
      startStation: bk.startStation,
      equations: bk.stationEquations,
      details: bk.softree,
    })
    const back = traverseWithRoadCulverts(b, culverts, { locate, toLonLat, lengthM: 100 })
    expect(back.written).toBe(2)
    expect(writeTraverseFile(back.book.input, 'asc', options(back.book)).text).toBe(TEXT)

    const bigger = culverts.map((c) => (c.name === 'Creek A' ? { ...c, diameterM: 0.75 } : c))
    const edited = traverseWithRoadCulverts(b, bigger, { locate, toLonLat, lengthM: 100 })
    const lines = writeTraverseFile(edited.book.input, 'asc', options(edited.book)).text.split('\r\n')
    const original = TEXT.split('\r\n')
    expect(lines[2]).toContain('750')
    expect(lines.filter((line, k) => line !== original[k])).toHaveLength(1)
  })

  it('writes a new culvert at the traverse station nearest it, and removes one the road no longer has', () => {
    const b = book()
    const placed = traverseWithRoadCulverts(b, [{ ...existing(41, 'New pipe'), diameterM: 0.9, skewDegrees: 10 }], {
      locate,
      toLonLat,
      lengthM: 100,
    })
    expect(placed.written).toBe(1)
    expect(placed.removed).toBe(2)
    const cs = traverseCulverts(placed.book)
    expect(cs.map((c) => c.station)).toEqual([2])
    expect(cs[0].metres).toMatchObject({ sizeYM: 0.9, azimuth: 190, flag: 0 })
    const far = traverseWithRoadCulverts(b, [existing(500, 'Off the traverse')], { locate, toLonLat, lengthM: 100 })
    expect(far.notWritten[0]).toMatch(/Off the traverse/)
  })

  it('refuses a unit survey, which has no culvert field', () => {
    const b = book()
    expect(() =>
      traverseWithRoadCulverts({ ...b, softree: { ...b.softree!, sourceFormat: 'unit-survey' } }, [], {
        locate,
        toLonLat,
        lengthM: 100,
      }),
    ).toThrow(/no culvert field/)
  })

  it('takes a new culvert’s diameter from the design’s default culvert of its kind', () => {
    const defaults = [
      { kind: 'drain' as const, diameterM: 0.5 },
      { kind: 'stream' as const, diameterM: 1 },
    ]
    expect(roadEngNewCulvertDiameterM(defaults, 'cross-drain', 0.8)).toBe(0.5)
    expect(roadEngNewCulvertDiameterM(defaults, 'stream', 0.8)).toBe(1)
    expect(roadEngNewCulvertDiameterM([], 'stream', 0.8)).toBe(0.8)
  })
})
