import { describe, expect, it } from 'vitest'
import proj4 from 'proj4'
import { cellChecksum, encodeCells, UNKNOWN } from '@/lib/geoPdf/classGrid'
import { CANFOR_RASTERS } from '@/lib/geoPdf/rasterProfiles'
import type { PdfClassGrid } from '@/lib/geoPdf/types'
import { profileValueBands } from './profileBands'
import {
  roadSheetClasses,
  roadSheetClassesKept,
  roadSheets,
  SHEET_BAND,
  sheetClassText,
  sheetSlopeTone,
  sheetSpans,
  type RoadSheet,
} from './sheetBands'
import type { Alignment, RoadAnalysis, RoadStation } from './types'

const WKT =
  'PROJCS["NAD83 / BC Albers",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Albers_Conic_Equal_Area"],PARAMETER["standard_parallel_1",50],PARAMETER["standard_parallel_2",58.5],PARAMETER["latitude_of_center",45],PARAMETER["longitude_of_center",-126],PARAMETER["false_easting",1000000],PARAMETER["false_northing",0],UNIT["metre",1]]'
const albers = proj4('EPSG:4326', WKT)
const ORIGIN: [number, number] = [1291000, 1016000]
const CELL_M = 1
const WIDTH = 400,
  HEIGHT = 100
/** A 400 × 100 m grid of 1 m pixels; `paint` gives the code at a pixel. */
function grid(kind: 'slope' | 'canopy', paint: (col: number, row: number) => number): PdfClassGrid {
  const data = new Uint8Array(WIDTH * HEIGHT)
  for (let row = 0; row < HEIGHT; row++) for (let col = 0; col < WIDTH; col++) data[row * WIDTH + col] = paint(col, row)
  const counts = Array(256).fill(0) as number[]
  for (const code of data) counts[code]++
  const profile = CANFOR_RASTERS.find((entry) => entry.kind === kind)!
  return {
    version: 1,
    kind,
    unit: profile.unit,
    legend: profile.classes.map((range, i) => ({ ...range, color: [10 * i, 20 * i, 30 * i] })),
    undrawn: profile.undrawn,
    width: WIDTH,
    height: HEIGHT,
    transform: [CELL_M, 0, 0, -CELL_M, ORIGIN[0], ORIGIN[1]],
    wkt: WKT,
    cells: encodeCells(data),
    checksum: cellChecksum(data),
    counts,
    sourceImages: [],
    notes: [],
  }
}
/** Stations every 20 m running east along the middle of the grid, from 30 m west of it to 30 m past it. */
const stations = Array.from({ length: 24 }, (_, i) => ({
  chainage: i * 20,
  coordinate: albers.inverse([ORIGIN[0] - 30 + i * 20, ORIGIN[1] - 50]) as [number, number],
}))
// East of the grid's left edge by: 0–100 m exact 20–30; 100–200 m a JPEG estimate of 60–85, with every
// fifth pixel estimated 40–50; 200–300 m not drawn; 300–350 m exact 95+; 350–400 m outside the sheet's frame.
const slopeColumns = (col: number) =>
  col < 100 ? 1 : col < 200 ? (col % 5 === 0 ? 64 + 4 : 64 + 6) : col < 300 ? 0 : col < 350 ? 8 : UNKNOWN.clipped
const slope: RoadSheet = { kind: 'slope', name: 'Slope_Map.pdf', grid: grid('slope', slopeColumns) }

describe('an imported map sheet read along a road', () => {
  it('gives each station the commonest class around it, marks estimates and leaves uncovered ground unknown', () => {
    const rows = roadSheetClasses(stations, slope)
    const at = (chainage: number) => rows.find((row) => row.chainage === chainage)!
    // 30 m before the sheet: nothing read. At its edge: half the patch is off the sheet.
    expect(at(0)).toMatchObject({ classIndex: null, samples: 0 })
    expect(at(20).classIndex).toBeNull()
    expect(at(80)).toMatchObject({ classIndex: 0, estimated: false })
    // The commonest estimate wins over the one pixel in five that reads another class.
    expect(at(180)).toMatchObject({ classIndex: 5, estimated: true })
    // Not drawn on the sheet is the class below the lowest printed range, known exactly.
    expect(at(280)).toMatchObject({ classIndex: -1, estimated: false })
    expect(at(360)).toMatchObject({ classIndex: 7, estimated: false })
    // Outside the sheet's own frame the cells are unknown, not a class.
    expect(at(400).classIndex).toBeNull()
    // The patch is the Sidehill reach across the road and half-way to each neighbour along it.
    expect(at(180).points).toBe((Math.floor((2 * SHEET_BAND.halfWidthM) / SHEET_BAND.stepM) + 1) * 11)
    expect(at(180).samples).toBe(at(180).points)
  })

  it("marks an estimate by the winning class's own points, so not drawn in a JPEG tile stays exact", () => {
    // Two-fifths estimated 40–50, three-fifths not drawn: the mask is lossless even in a JPEG tile.
    const open: RoadSheet = { kind: 'slope', name: 'x.pdf', grid: grid('slope', (col) => (col % 5 < 2 ? 64 + 4 : 0)) }
    expect(roadSheetClasses(stations, open)[8]).toMatchObject({ classIndex: -1, estimated: false })
    // The other way round, the estimate wins and is marked.
    const drawn: RoadSheet = { kind: 'slope', name: 'x.pdf', grid: grid('slope', (col) => (col % 5 < 3 ? 64 + 4 : 0)) }
    expect(roadSheetClasses(stations, drawn)[8]).toMatchObject({ classIndex: 3, estimated: true })
  })

  it('reads across the road, not along it', () => {
    // A road running north through a strip 20 m wide: the strip is under the road, the class beside it differs.
    const strip: RoadSheet = {
      kind: 'slope',
      name: 'x.pdf',
      grid: grid('slope', (col) => (col >= 195 && col < 205 ? 7 : 2)),
    }
    const north = Array.from({ length: 5 }, (_, i) => ({
      chainage: i * 10,
      coordinate: albers.inverse([ORIGIN[0] + 200, ORIGIN[1] - 80 + i * 10]) as [number, number],
    }))
    // 10 m of 85+ under the centreline against 20 m of 30–35 either side within the 15 m reach.
    expect(roadSheetClasses(north, strip).map((row) => row.classIndex)).toEqual([1, 1, 1, 1, 1])
  })

  it('remembers a reading while no station moves on the ground', () => {
    const first = roadSheetClassesKept(stations, slope)
    expect(
      roadSheetClassesKept(
        stations.map((s) => ({ ...s })),
        slope,
      ),
    ).toBe(first)
    expect(first).toEqual(roadSheetClasses(stations, slope))
    const moved = stations.map((s, i) => (i === 3 ? { ...s, chainage: s.chainage + 1 } : s))
    expect(roadSheetClassesKept(moved, slope)).not.toBe(first)
  })

  it("prints a class in a band's width and marks slope classes at the Sidehill row's screens", () => {
    const { grid: g } = slope
    expect([-1, 0, 5, 6, 7].map((index) => sheetClassText(g, index))).toEqual(['<20', '20–30', '60–85', '85+', '95+'])
    expect([-1, 3, 4, 5, 7].map((index) => sheetSlopeTone(slope, index))).toEqual([
      null,
      null,
      'appraisal',
      'bench',
      'bench',
    ])
    const canopy: RoadSheet = { kind: 'canopy', name: 'c.pdf', grid: grid('canopy', () => 8) }
    expect(sheetClassText(canopy.grid, -1)).toBe('<5')
    expect(sheetClassText(canopy.grid, 7)).toBe('40+')
    expect(sheetSlopeTone(canopy, 7)).toBeNull()
  })

  it('joins stations of one class into runs that stop at the window', () => {
    const spans = sheetSpans(roadSheetClasses(stations, slope), 70, 300)
    expect(spans.map((span) => [span.start, span.end, span.classIndex, span.estimated])).toEqual([
      [70, 130, 0, false],
      [130, 230, 5, true],
      [230, 300, -1, false],
    ])
  })

  it('takes the first slope and the first canopy raster of the project, slope first', () => {
    const feature = (g: PdfClassGrid, file: string) => ({
      name: 'Classes',
      classGrid: g,
      pdfSource: { file: `Maps/${file}`, sha256: '', page: 1, layer: '', profile: '', registrationErrorM: 0 },
    })
    const canopy = grid('canopy', () => 1)
    expect(
      roadSheets([
        { name: 'Roads' },
        feature(canopy, 'Canopy.pdf'),
        feature(slope.grid, 'Slope.pdf'),
        feature(slope.grid, 'Slope revised.pdf'),
      ]).map((sheet) => [sheet.kind, sheet.name]),
    ).toEqual([
      ['slope', 'Slope.pdf'],
      ['canopy', 'Canopy.pdf'],
    ])
    expect(roadSheets()).toEqual([])
  })
})

describe("the profile bands' map-sheet rows", () => {
  const analysis = {
    length: 460,
    stations: stations.map(
      (s, index) =>
        ({
          ...s,
          index,
          groundElevation: 700,
          designElevation: 700,
          gradePercent: 0,
          groundGradePercent: 0,
        }) as RoadStation,
    ),
  } as Pick<RoadAnalysis, 'stations' | 'length'>
  const alignment = { id: 'a', points: [], vertical: [] } as unknown as Alignment
  const window = { start: 0, end: 460, minSpacingM: 20, terrainOnly: true }

  it('adds a row a sheet under the ground rows, coloured at every station', () => {
    const bands = profileValueBands(analysis, alignment, {
      ...window,
      sheets: [{ sheet: slope, classes: roadSheetClasses(stations, slope) }],
    })
    expect(bands.rows.map((row) => row.key)).toEqual(['ground', 'grade', 'sheetSlope'])
    const row = bands.rows[2]
    expect(row.title).toBe('Map slope')
    expect(row.detail).toContain('Slope_Map.pdf')
    const text = (chainage: number) => row.values.find((value) => value.chainage === chainage)
    expect(text(0)).toMatchObject({ value: null, text: '—', tone: 'unknown' })
    expect(text(80)).toEqual({ chainage: 80, value: 20, text: '20–30' })
    expect(text(180)).toEqual({ chainage: 180, value: 60, text: '≈60–85', tone: 'bench' })
    expect(text(280)).toEqual({ chainage: 280, value: 0, text: '<20' })
    expect(text(360)).toEqual({ chainage: 360, value: 95, text: '95+', tone: 'bench' })
    expect(bands.sheetSpans).toHaveLength(1)
    expect(bands.sheetSpans[0]).toMatchObject({ key: 'sheetSlope', sheet: slope })
    expect(bands.sheetSpans[0].spans.some((span) => span.classIndex === 5 && span.estimated)).toBe(true)
  })

  it('leaves the bands as they were without a sheet', () => {
    const bands = profileValueBands(analysis, alignment, window)
    expect(bands.rows.map((row) => row.key)).toEqual(['ground', 'grade'])
    expect(bands.sheetSpans).toEqual([])
  })
})
