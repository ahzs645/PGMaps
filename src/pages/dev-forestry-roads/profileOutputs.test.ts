import { describe, expect, it } from 'vitest'
import { analyzeCable, analyzeRoad, distance, offsetCoordinate } from './engine'
import { cableProfileCsv, cableProfileHtml, cableSummary, crossSectionCsv } from './profileOutputs'
import { templateAt } from './templates'
import type { Alignment, CableLine, Coordinate, RoadSettings, TerrainMetadata, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const north = (metres: number) => offsetCoordinate(origin, 0, metres)
const northing = (latitude: number) => (((latitude - origin[1]) * Math.PI) / 180) * 6371008.8
const easting = (longitude: number) =>
  (((longitude - origin[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180)
const flat: TerrainSource = { elevationAt: () => 800 }
const metadata: TerrainMetadata = {
  kind: 'geotiff',
  name: 'Recorded native DTM',
  resolutionM: 1,
  epsg: 26910,
  verticalReference: 'Recorded local datum',
  sourceUrl: 'https://example.org/dtm.tif',
  sha256: 'a'.repeat(64),
}
const cable: CableLine = {
  id: 'd-line',
  name: 'D-line',
  start: origin,
  end: north(100),
  startHeight: 10,
  endHeight: 20,
  deflectionPercent: 0,
}
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 0.8,
}
function road(): Alignment {
  return {
    id: 'road',
    name: 'Test road',
    color: '#008877',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: north(100), radiusM: 0 },
    ],
    vertical: [
      { id: 'a', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'b', chainage: 100, elevation: 800, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 4,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 2,
      ditchDepth: 0.5,
      rightDitchWidth: 3,
      rightDitchDepth: 0.8,
      surfaceDepth: 0,
    },
    overrides: [],
  }
}

// Decode actual quoted CSV cells, including commas and doubled quotes, so the
// tests verify columns rather than relying on a numeric substring elsewhere.
function records(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [],
    cell = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell.replace(/\r$/, ''))
      cell = ''
      if (c === '\n') {
        rows.push(row)
        row = []
      }
    } else cell += c
  }
  const headers = rows.shift()!
  return rows.map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i]])))
}

describe('D-line measurements and profile outputs', () => {
  it('distinguishes horizontal span, signed support rise and the inclined support chord', () => {
    const result = cableSummary(cable, analyzeCable(cable, flat))
    expect(result.horizontalSpanM).toBeCloseTo(100, 6)
    expect(result.startSupportElevationM).toBe(810)
    expect(result.endSupportElevationM).toBe(820)
    expect(result.supportElevationDifferenceM).toBe(10)
    expect(result.straightSupportChordM).toBeCloseTo(Math.hypot(100, 10), 6)
    expect(result.sampledGeometricCableLengthM).toBeCloseTo(Math.hypot(100, 10), 6)
    expect(result.assumedSagM).toBe(0)
    expect(result.minClearanceM).toBe(10)
    expect(result.complete).toBe(true)
  })

  it('measures resolved physical supports after insets and reversed yarder orientation', () => {
    const line = { ...cable, startHeight: 25, endHeight: 7, startOffsetM: 20, endOffsetM: 30, yarderAt: 'end' as const }
    const analysis = analyzeCable(line, flat)
    const summary = cableSummary(line, analysis)
    expect(summary.horizontalSpanM).toBeCloseTo(50, 6)
    expect(distance(summary.startCoordinate, north(20))).toBeLessThan(1e-5)
    expect(distance(summary.endCoordinate, north(70))).toBeLessThan(1e-5)
    expect(summary.startSupportElevationM).toBe(807)
    expect(summary.endSupportElevationM).toBe(825)
    expect(summary.supportElevationDifferenceM).toBe(18)
    expect(summary.sampledGeometricCableLengthM).toBeCloseTo(Math.hypot(50, 18), 5)
    const rows = records(cableProfileCsv(line, analysis, metadata))
    expect(Number(rows[0].longitude)).toBeCloseTo(summary.startCoordinate[0], 10)
    expect(Number(rows.at(-1)!.latitude)).toBeCloseTo(summary.endCoordinate[1], 10)
    expect(rows[0].yarder_at).toBe('end')
    expect(rows[0].yarder_height_m).toBe('25')
    expect(rows[0].start_offset_m).toBe('20')
  })

  it('reports sag in metres and a sampled curve length consistent with the analytic parabola', () => {
    const line = { ...cable, endHeight: 10, deflectionPercent: 5 }
    const summary = cableSummary(line, analyzeCable(line, flat))
    const a = (4 * 5) / 100
    const exactLength = 100 * (Math.sqrt(1 + a * a) / 2 + Math.asinh(a) / (2 * a))
    expect(summary.assumedSagM).toBeCloseTo(5, 7)
    expect(summary.straightSupportChordM).toBeCloseTo(100, 7)
    expect(summary.sampledGeometricCableLengthM).toBeGreaterThan(100)
    expect(summary.sampledGeometricCableLengthM!).toBeLessThanOrEqual(exactLength + 1e-6)
    expect(summary.sampledGeometricCableLengthM).toBeCloseTo(exactLength, 2)
    expect(summary.minClearanceM).toBeCloseTo(5, 6)
  })

  it('preserves unknown clearance through an interior hole without erasing known assumed geometry', () => {
    const source: TerrainSource = {
      elevationAt: (_, lat) => (northing(lat) > 40 && northing(lat) < 60 ? Number.NaN : 800),
    }
    const analysis = analyzeCable(cable, source)
    const summary = cableSummary(cable, analysis)
    expect(summary.complete).toBe(false)
    expect(summary.geometryComplete).toBe(true)
    expect(summary.minClearanceM).toBeNull()
    expect(summary.sampledGeometricCableLengthM).toBeCloseTo(Math.hypot(100, 10), 5)
    expect(summary.knownGroundPercent).toBeGreaterThan(70)
    expect(summary.knownGroundPercent).toBeLessThan(100)
    const middle = records(cableProfileCsv(cable, analysis, metadata)).find(
      (row) => Math.abs(Number(row.distance_m) - 50) < 1e-4,
    )!
    expect(middle.ground_elevation_m).toBe('')
    expect(middle.clearance_m).toBe('')
    expect(middle.minimum_clearance_m).toBe('')
    expect(Number(middle.assumed_cable_elevation_m)).toBeCloseTo(815, 5)
  })

  it('returns null geometry lengths and support rise when a required support ground value is unavailable', () => {
    const source: TerrainSource = { elevationAt: (_, lat) => (northing(lat) < 1 ? Number.NaN : 800) }
    const analysis = analyzeCable(cable, source)
    const summary = cableSummary(cable, analysis)
    expect(summary.horizontalSpanM).toBeCloseTo(100, 6)
    expect(summary.startSupportElevationM).toBeNull()
    expect(summary.endSupportElevationM).toBe(820)
    expect(summary.supportElevationDifferenceM).toBeNull()
    expect(summary.straightSupportChordM).toBeNull()
    expect(summary.sampledGeometricCableLengthM).toBeNull()
    expect(summary.minClearanceM).toBeNull()
    expect(summary.geometryComplete).toBe(false)
    const row = records(cableProfileCsv(cable, analysis, metadata))[0]
    expect(row.sampled_geometric_cable_length_m).toBe('')
    expect(row.straight_support_chord_m).toBe('')
    expect(cableProfileHtml(cable, analysis, metadata)).not.toContain('NaN')
  })

  it('rejects stale span, height and sag results and prevents empty-profile exports', () => {
    const analysis = analyzeCable(cable, flat)
    expect(() => cableSummary({ ...cable, startOffsetM: 5 }, analysis)).toThrow(/Recalculate/)
    expect(() => cableProfileCsv({ ...cable, startHeight: 15 }, analysis, metadata)).toThrow(/Recalculate/)
    expect(() => cableProfileHtml({ ...cable, deflectionPercent: 2 }, analysis, metadata)).toThrow(/Recalculate/)
    const empty = analyzeCable({ ...cable, end: origin }, flat)
    expect(cableSummary({ ...cable, end: origin }, empty).sampledGeometricCableLengthM).toBeNull()
    expect(() => cableProfileCsv({ ...cable, end: origin }, empty, metadata)).toThrow(/unavailable/)
  })

  it('retains provenance and geometric limitations while escaping CSV formulas and HTML input', () => {
    const line = { ...cable, name: '=HYPERLINK("x","y") <script>alert(1)</script>' }
    const analysis = analyzeCable(line, flat)
    const first = records(cableProfileCsv(line, analysis, metadata))[0]
    expect(first.line_name).toBe(`'${line.name}`)
    expect(first.source_url).toBe(metadata.sourceUrl)
    expect(first.terrain_sha256).toBe(metadata.sha256)
    expect(first.terrain_resolution_m).toBe('1')
    expect(first.source_epsg).toBe('26910')
    expect(first.assumptions).toContain('not a purchase length')
    const report = cableProfileHtml(line, analysis, metadata)
    expect(report).not.toContain('<script>')
    expect(report).toContain('&lt;script&gt;')
    expect(report).toContain("default-src 'none'")
    expect(report).toContain(metadata.sha256!)
    expect(report).toContain('horizontal and vertical plot scales differ'.replace('horizontal', 'Horizontal'))
    expect(report).toContain('Unknown values are not zero')
  })
})

describe('selected cross-section CSV', () => {
  const sidehill: TerrainSource = { elevationAt: (lng) => 800 - easting(lng) * 0.5 }

  it('uses signed left/right offsets, effective widths, actual cut-side ditch codes and ground-minus-design depths', () => {
    const alignment = road()
    alignment.overrides = [
      {
        id: 'turnout',
        name: 'Left widening',
        kind: 'turnout',
        start: 20,
        end: 80,
        taper: 0,
        side: 'left',
        extraWidth: 2,
      },
    ]
    const station = analyzeRoad(alignment, sidehill, settings).stations.find((s) => Math.abs(s.chainage - 50) < 1e-5)!
    const rows = records(crossSectionCsv(station, templateAt(alignment, station.chainage), metadata, alignment.name))
    const left = rows.find((row) => row.location_code === 'left-formation-edge')!
    const right = rows.find((row) => row.location_code === 'right-formation-edge')!
    const ditch = rows.find((row) => row.location_code === 'left-ditch-bottom')!
    expect(Number(left.signed_offset_m)).toBe(-5)
    expect(Number(right.signed_offset_m)).toBe(4)
    expect(Number(ditch.signed_offset_m)).toBe(-6)
    expect(Number(ditch.design_elevation_m)).toBeCloseTo(799.5, 7)
    expect(Number(left.cut_fill_depth_m)).toBeCloseTo(2.5, 3)
    expect(Number(right.cut_fill_depth_m)).toBeCloseTo(-2, 3)
    expect(Number(left.longitude)).toBeLessThan(station.coordinate[0])
    expect(Number(right.longitude)).toBeGreaterThan(station.coordinate[0])
    expect(rows.some((row) => row.location_code === 'right-ditch-bottom')).toBe(false)
    expect(rows.some((row) => row.location_code === 'left-daylight')).toBe(true)
    expect(rows.some((row) => row.location_code === 'right-daylight')).toBe(true)
    expect(rows.find((row) => row.location_code === 'centreline')!.signed_offset_m).toBe('0')
    expect(rows[0].terrain_sha256).toBe(metadata.sha256)
    expect(rows[0].conventions).toContain('positive cut, negative fill')
  })

  it('leaves no-data and exterior design blanks and carries incomplete-section flags', () => {
    const alignment = road()
    const terrain: TerrainSource = {
      elevationAt: (lng) => (Math.abs(easting(lng)) < 0.1 ? Number.NaN : 800 - easting(lng) * 0.5),
    }
    const station = analyzeRoad(alignment, terrain, settings).stations.find((s) => Math.abs(s.chainage - 50) < 1e-5)!
    const rows = records(crossSectionCsv(station, templateAt(alignment, station.chainage), metadata))
    const center = rows.find((row) => row.location_code === 'centreline')!
    expect(center.ground_elevation_m).toBe('')
    expect(center.design_elevation_m).toBe('800')
    expect(center.cut_fill_depth_m).toBe('')
    expect(center.section_complete).toBe('no')
    expect(center.section_flags).toContain('Missing terrain')
    const outside = rows.find((row) => row.location_code === 'outside-designed-section')!
    expect(outside.ground_elevation_m).not.toBe('')
    expect(outside.design_elevation_m).toBe('')
    expect(outside.cut_fill_depth_m).toBe('')
  })
})
