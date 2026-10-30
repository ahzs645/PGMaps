import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  parseKml,
  parseTraverseLegs,
  parseSurveyBooks,
  readSpatialFile,
  reduceTraverse,
  traverseCsv,
} from './surveyInterchange'

describe('open forestry survey and geographic interchange', () => {
  it('reduces horizontal distances and grades, then distributes closure by length', () => {
    const legs = parseTraverseLegs('station,bearing_deg,horizontal_m,grade_pct\nA,0,100,2\nB,90,50,-2')
    const input = {
      start: [500000, 6000000, 800] as [number, number, number],
      target: [500049, 6000098, 801] as [number, number, number],
      adjustment: 'bowditch' as const,
      legs,
    }
    const r = reduceTraverse(input)
    expect(r.stations[2].raw).toEqual([500050, 6000100, 801])
    expect(r.closure?.delta).toEqual([1, 2, 0])
    expect(r.closure?.horizontalM).toBeCloseTo(Math.sqrt(5))
    expect(r.stations[1].adjusted[0]).toBeCloseTo(500000 - 2 / 3)
    expect(r.stations[2].adjusted).toEqual(input.target)
  })
  it('uses negative-left signed offsets looking forward and preserves observed levels separately from design', () => {
    const r = reduceTraverse({
      start: [0, 0, 10],
      adjustment: 'none',
      legs: [{ id: 'A', bearingDegrees: 0, horizontalDistanceM: 100, gradePercent: 1 }],
      sideShots: [{ id: 'left', station: 0, offsetM: -5, heightDifferenceM: 2 }],
    })
    expect(r.sideShots[0].coordinate).toEqual([-5, 0, 12])
    expect(r.stations[1].raw).toEqual([0, 100, 11])
    expect(traverseCsv(r, 3157, 'CGVD2013')).toContain('3157,"CGVD2013","none"')
    expect(() =>
      reduceTraverse({
        start: [0, 0, 0],
        adjustment: 'bowditch',
        legs: [{ id: 'A', bearingDegrees: 0, horizontalDistanceM: 10, gradePercent: 0 }],
      }),
    ).toThrow(/known closing/)
  })
  it('rejects malformed field notes and duplicate station IDs', () => {
    expect(() => parseTraverseLegs('A,0,,2')).toThrow(/Survey row/)
    expect(() =>
      reduceTraverse({ start: [0, 0, 0], adjustment: 'none', legs: parseTraverseLegs('A,0,10,0\nA,90,20,0') }),
    ).toThrow(/unique station/)
  })
  it('round-trips saved observations and refuses duplicated or invalid field books', () => {
    const book = {
      id: 'survey',
      name: 'Measured traverse',
      epsg: 3157,
      verticalReference: 'CGVD2013',
      input: {
        start: [0, 0, 800],
        adjustment: 'none',
        legs: [{ id: 'A', bearingDegrees: 90, horizontalDistanceM: 100, gradePercent: 1 }],
      },
    }
    expect(parseSurveyBooks(JSON.parse(JSON.stringify([book])))).toEqual([book])
    expect(() => parseSurveyBooks([book, book])).toThrow(/Invalid survey/)
    expect(() => parseSurveyBooks([{ ...book, input: { ...book.input, legs: [] } }])).toThrow(/traverse legs/)
  })
  it('imports namespaced lines and polygon holes, decodes names and discards unverified KML altitude', () => {
    const kml =
      '<k:kml xmlns:k="http://www.opengis.net/kml/2.2"><k:Document><k:Placemark><k:name>Road &amp; stream</k:name><k:LineString><k:coordinates>-123,54,900 -122.99,54,901</k:coordinates></k:LineString></k:Placemark><k:Placemark><k:Polygon><k:outerBoundaryIs><k:LinearRing><k:coordinates>-123,54 -122,54 -122,55 -123,54</k:coordinates></k:LinearRing></k:outerBoundaryIs><k:innerBoundaryIs><k:LinearRing><k:coordinates>-122.9,54.1 -122.8,54.1 -122.8,54.2 -122.9,54.1</k:coordinates></k:LinearRing></k:innerBoundaryIs></k:Polygon></k:Placemark></k:Document></k:kml>'
    const fc = parseKml(kml)
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].properties?.name).toBe('Road & stream')
    expect((fc.features[0].geometry as GeoJSON.LineString).coordinates[0]).toEqual([-123, 54])
    expect((fc.features[1].geometry as GeoJSON.Polygon).coordinates).toHaveLength(2)
  })
  it('does not follow network links or XML entities and rejects unclosed or invalid shapes', () => {
    expect(() => parseKml('<!DOCTYPE kml><kml/>')).toThrow(/unsupported XML entities/)
    expect(() =>
      parseKml('<kml><NetworkLink><Link><href>https://example.com/private</href></Link></NetworkLink></kml>'),
    ).toThrow(/No line or polygon/)
    expect(() => parseKml('<kml><Placemark></kml>')).toThrow(/mismatched/)
    expect(() =>
      parseKml('<kml><Placemark><LineString><coordinates>0,90 1,90</coordinates></LineString></Placemark></kml>'),
    ).toThrow(/invalid geographic/)
  })
  it('reads a real zipped KMZ doc.kml without mistaking it for a shapefile', async () => {
    const zip = new JSZip()
    zip.file(
      'doc.kml',
      '<kml><Placemark><LineString><coordinates>-123,54 -122.99,54</coordinates></LineString></Placemark></kml>',
    )
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const result = (await readSpatialFile(
      new File([bytes.buffer as ArrayBuffer], 'survey.kmz'),
    )) as GeoJSON.FeatureCollection
    expect(result.features).toHaveLength(1)
  })
})
