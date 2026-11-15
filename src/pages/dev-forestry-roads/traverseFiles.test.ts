import { describe, expect, it } from 'vitest'
import { SoftreeTraverseStartQuestion } from './softreeTraverse'
import { parseSurveyBooks, parseTraverseLegs, reduceTraverse, type TraverseInput } from './surveyInterchange'
import {
  detectTraverseFile,
  readTraverseFile,
  traverseFileDetails,
  sideShotsText,
  traverseLegsText,
  writeTraverseFile,
  type WritableTraverseFormat,
} from './traverseFiles'

const book: TraverseInput = {
  start: [500_000, 5_970_000, 700],
  adjustment: 'none',
  legs: [
    { id: 'A', bearingDegrees: 45, horizontalDistanceM: 20, gradePercent: 6 },
    { id: 'B', bearingDegrees: 60.25, horizontalDistanceM: 25.5, gradePercent: -3.5 },
    { id: 'C', bearingDegrees: 350, horizontalDistanceM: 31.25, gradePercent: 12 },
  ],
  sideShots: [
    { id: 'L', station: 0, offsetM: -5, heightDifferenceM: -0.5 },
    { id: 'R', station: 2, offsetM: 6.5, heightDifferenceM: 0.75 },
  ],
}
const end = (input: TraverseInput) => reduceTraverse(input).stations.at(-1)!.raw

describe('traverse files of the survey field book', () => {
  it.each<[WritableTraverseFormat, string]>([
    ['asc', '.asc'],
    ['ipd', '.ipd'],
    ['polycorder', '.txt'],
    ['unit-survey', '.pol'],
  ])('writes the field book as %s, is recognised by its content and reads back the same traverse', (format, ext) => {
    const equations = format === 'unit-survey' ? [] : [{ back: 145.5, ahead: 150 }]
    const written = writeTraverseFile(book, format, { unitM: 1, startStation: 100, equations })
    expect(written.extension).toBe(ext)
    expect(detectTraverseFile(written.text)).toBe(format)
    // Polycorder has no coordinates: it asks for the start, and reads with it.
    const options =
      format === 'unit-survey'
        ? { unitM: 1, vertical: 'slope-percent' as const, distance: 'horizontal' as const }
        : { unitM: 1 }
    let read
    try {
      read = readTraverseFile(written.text, format, options)
    } catch (error) {
      expect(error).toBeInstanceOf(SoftreeTraverseStartQuestion)
      read = readTraverseFile(written.text, format, { ...options, start: book.start })
    }
    expect(read.format).toBe(format)
    expect(read.input.legs.map((l) => l.horizontalDistanceM)).toEqual(
      book.legs.map((l) => expect.closeTo(l.horizontalDistanceM, 3)),
    )
    end(read.input).forEach((v, k) => expect(v).toBeCloseTo(end(book)[k], 2))
    if (format !== 'unit-survey') {
      expect(read.startStation).toBeCloseTo(100, 6)
      expect(read.equations).toEqual([{ back: expect.closeTo(145.5, 6), ahead: expect.closeTo(150, 6) }])
    } else expect(written.notes.join(' ')).toMatch(/no stations/)
  })

  it('reads in the unit stated, never one guessed, and asks for a unit survey’s shot kinds', () => {
    const text = writeTraverseFile(book, 'asc', { unitM: 0.3048 }).text
    expect(() => readTraverseFile(text, 'asc', { unitM: 0 })).toThrow(/unit/)
    const feet = readTraverseFile(text, 'asc', { unitM: 0.3048 })
    expect(feet.input.legs[0].horizontalDistanceM).toBeCloseTo(20, 3)
    const pol = writeTraverseFile(book, 'unit-survey', { unitM: 1 }).text
    expect(() => readTraverseFile(pol, 'unit-survey', { unitM: 1 })).toThrow(/vertical readings/)
  })

  it('reads a Laser Technology raw survey in the unit chosen, and says when the file’s letter differs', () => {
    // Two foresights from point 1 (inclination 0, slope distance in metres), checksums as written.
    const body = (seq: number, from: string, to: string, az: string) =>
      `PLTIT,UD,1,${seq},FS,${from},${to},${az},D,0.00,D,50.0,M`
    const sentence = (b: string) => {
      let c = 0
      for (const ch of b) c ^= ch.charCodeAt(0)
      return `$${b}*${c.toString(16).toUpperCase().padStart(2, '0')}`
    }
    const text = [sentence(body(1, '1', '2', '90.0')), sentence(body(2, '2', '3', '0.0'))].join('\r\n')
    expect(detectTraverseFile(text)).toBe('laser-raw')
    expect(() => readTraverseFile(text, 'laser-raw', { unitM: 1 })).toThrow(SoftreeTraverseStartQuestion)
    const read = readTraverseFile(text, 'laser-raw', { unitM: 0.3048, start: [0, 0, 0] })
    expect(read.input.legs.map((l) => l.horizontalDistanceM)).toEqual([
      expect.closeTo(15.24, 6),
      expect.closeTo(15.24, 6),
    ])
    expect(read.notes.join(' ')).toMatch(/unit letter says metres/)
  })

  it('refuses a file that is no traverse', () => {
    expect(detectTraverseFile('station,bearing_deg,horizontal_m,grade_pct\nA,0,50,0')).toBeNull()
  })

  it('writes the panel’s texts as the panel reads them', () => {
    expect(parseTraverseLegs(traverseLegsText(book))).toEqual(book.legs)
    expect(sideShotsText(book)).toBe('L,0,-5,-0.5\nR,2,6.5,0.75')
  })

  it('keeps a read file’s start station, equations and Softree details in a saved field book', () => {
    const read = readTraverseFile(
      writeTraverseFile(book, 'asc', { unitM: 1, startStation: 100, equations: [{ back: 120, ahead: 125 }] }).text,
      'asc',
      { unitM: 1 },
    )
    const saved = {
      id: 'b',
      name: 'Traverse',
      epsg: 3157,
      verticalReference: 'CGVD2013',
      input: read.input,
      startStation: read.startStation,
      stationEquations: read.equations,
      softree: traverseFileDetails(read, 1).details,
    }
    expect(saved.softree.source?.records).toHaveLength(4)
    expect(parseSurveyBooks([saved])).toEqual([saved])
    // A saved book whose kept file is not one a writer can use is refused.
    for (const broken of [
      { ...saved.softree, source: { ...saved.softree.source!, format: 'dxf' } },
      { ...saved.softree, source: { ...saved.softree.source!, records: [{ line: 7 }] } },
      { ...saved.softree, extras: [{ station: 0, ground: [{ type: 'HP', depth: 'deep' }] }] },
      { ...saved.softree, extras: [{ station: 1, culvert: { sizeY: 'big' } }] },
    ])
      expect(() => parseSurveyBooks([{ ...saved, softree: broken }])).toThrow(/Softree traverse details/)
  })

  // A generated file with a detail in every field each format has: labels, ground layers with
  // depths, a culvert, HI/HT, a backshot, side-shot depths, slopes beyond the shots, an IFS shot and
  // a station equation (50 written where the distances give 45.5).
  const detailedAsc =
    [
      'V3 PGMaps test',
      '0.000,45.000,,20.000,,6.000,Start,,500000.000,5970000.000,700.000,7,,,,HP,0.300,RK,1.200,SD,1.500,1.400,4.000,-10.000,0.100,,0.000,-8.000,,,5.000,5.000,0.200,0.400,0.000,6.000,,,0,0',
      '20.000,60.250,225.100,25.500,,-3.500,Culvert,between,,,,0,600.000xx2.500x150.000x0x0.000x,10.000,30.000,OR,0.150,,,,,,0.000,,,,0.000,,,,0.000,,,,0.000,,,,0,0',
      '45.500,300.000,,12.000,,2.000,Spring,,,,,8,,,,,,,,,,,0.000,,,,0.000,,,,0.000,,,,0.000,,,,0,0',
      '50.000,350.000,,31.250,,12.000,TP3,,,,,0,,,,,,,,,1.600,1.600,6.500,4.000,,0.050,0.000,,,,0.000,,,,0.000,,,,0,0',
      '81.250,,,,,,End,,,,,0,,,,,,,,,,,0.000,,,,0.000,,,,0.000,,,,0.000,,,,0,0',
    ].join('\r\n') + '\r\n'

  it.each<[WritableTraverseFormat, number]>([
    ['asc', 1],
    ['asc', 0.3048],
    ['ipd', 1],
    ['ipd', 0.3048],
    ['polycorder', 1],
    ['polycorder', 0.3048],
    ['unit-survey', 1],
    ['unit-survey', 0.3048],
  ])(
    'reads a field book with details from a %s file (%s m a unit) and writes it back byte for byte',
    (format, unitM) => {
      // First the generated traverse in this format (a new file), then that file read and written back.
      const source = readTraverseFile(detailedAsc, 'asc', { unitM })
      const first = writeTraverseFile(source.input, format, {
        unitM,
        startStation: source.startStation,
        equations: source.equations,
        details: traverseFileDetails(source, unitM).details,
      })
      const options = {
        unitM,
        ...(format === 'polycorder' ? { start: source.input.start } : {}),
        ...(format === 'unit-survey' ? { vertical: 'slope-percent' as const, distance: 'horizontal' as const } : {}),
      }
      const read = readTraverseFile(first.text, format, options)
      const { details } = traverseFileDetails(read, unitM)
      expect(details.source).toBeDefined()
      const again = writeTraverseFile(read.input, format, {
        unitM,
        startStation: read.startStation,
        equations: read.equations,
        details,
      })
      expect(again.text).toBe(first.text)
      // The first write names what this format cannot hold; the file read back holds nothing more.
      expect(first.notes.some((n) => n.startsWith('Not written'))).toBe(
        format === 'polycorder' || format === 'unit-survey',
      )
      expect(again.notes.some((n) => n.startsWith('Not written'))).toBe(false)
    },
  )

  it('keeps the details but not the file as written when it is too large for a field book', () => {
    const rows = Array.from({ length: 1_900 }, (_, i) => `${i * 10}.000,90.000,,10.000,,0.000,${'x'.repeat(600)}`)
    const text = ['V3', ...rows].join('\r\n') + '\r\n'
    const read = readTraverseFile(text, 'asc', { unitM: 1, start: [0, 0, 0] })
    const kept = traverseFileDetails(read, 1)
    expect(kept.details.source).toBeUndefined()
    expect(kept.details.extras).toHaveLength(1_900)
    expect(kept.notes.join(' ')).toMatch(/too large to keep as written/)
  })
})
