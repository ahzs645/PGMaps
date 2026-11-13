import { describe, expect, it } from 'vitest'
import proj4 from 'proj4'
import {
  applyMatrix,
  classAreaBreakdown,
  codeLabel,
  cellChecksum,
  colorClassifier,
  decodeCells,
  encodeCells,
  gridCorners,
  gridProjection,
  parseClassGrid,
  sampleClass,
  summarizeClassSteps,
  UNKNOWN,
} from './classGrid'
import type { Matrix, PdfClassGrid, XY } from './types'

export const testWkt =
  'PROJCS["NAD83 / BC Albers",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Albers_Conic_Equal_Area"],PARAMETER["standard_parallel_1",50],PARAMETER["standard_parallel_2",58.5],PARAMETER["latitude_of_center",45],PARAMETER["longitude_of_center",-126],PARAMETER["false_easting",1000000],PARAMETER["false_northing",0],UNIT["metre",1]]'
function fixture(values = [1, 2, 0, 65], transform: Matrix = [10, 0, 0, -10, 1291000, 1016000]): PdfClassGrid {
  const data = Uint8Array.from(values),
    counts = Array(256).fill(0)
  for (const c of data) counts[c]++
  return {
    version: 1,
    kind: 'canopy',
    unit: 'm',
    width: 2,
    height: 2,
    transform,
    wkt: testWkt,
    legend: [
      { label: '5–10', minimum: 5, maximum: 10, color: [255, 0, 0] },
      { label: '10+', minimum: 10, maximum: null, color: [0, 255, 0] },
    ],
    cells: encodeCells(data),
    checksum: cellChecksum(data),
    counts,
    sourceImages: [],
    notes: [],
  }
}
function polygon(grid: PdfClassGrid, rings: XY[][]): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: rings.map((r) => r.map((p) => gridProjection(grid).inverse(applyMatrix(grid.transform, p)))),
  }
}
function summary(grid: PdfClassGrid, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  const steps = summarizeClassSteps(grid, geometry)
  let result = steps.next()
  while (!result.done) result = steps.next()
  return result.value
}
const box = (x0: number, y0: number, x1: number, y1: number): XY[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
]
describe('published PDF class grids', () => {
  it('keeps native codes and registration through serialization; queries use inverse affine pixel corners', () => {
    const grid = fixture(),
      restored = parseClassGrid(JSON.parse(JSON.stringify(grid)))!
    expect([...decodeCells(restored)]).toEqual([1, 2, 0, 65])
    const world = (p: XY) => proj4(grid.wkt, 'EPSG:4326', applyMatrix(grid.transform, p)) as XY
    expect(sampleClass(grid, world([0.5, 0.5]))).toMatchObject({
      code: 1,
      estimated: false,
      range: { minimum: 5, maximum: 10 },
    })
    expect(sampleClass(grid, world([1.5, 1.5]))).toMatchObject({ code: 65, estimated: true })
    expect(sampleClass(grid, world([-0.1, 0.5])).code).toBe(UNKNOWN.outside)
    expect(gridCorners(grid)[0]).toEqual(world([0, 0]))
  })
  it('rejects unexpected colours, ties, transparency and JPEG black; aliases are explicit', () => {
    const legend = fixture().legend
    expect(colorClassifier(legend, false, 255)(254, 0, 0, 255)).toBe(1)
    expect(colorClassifier(legend, false, 255)(250, 0, 0, 255)).toBe(UNKNOWN.color)
    expect(colorClassifier(legend, false, 255)(255, 0, 0, 0)).toBe(UNKNOWN.absent)
    expect(colorClassifier(legend, false, 255)(255, 0, 0, 100)).toBe(UNKNOWN.alpha)
    const close = [
      ...legend,
      { label: 'near red', minimum: 10, maximum: 20, color: [250, 0, 0] as [number, number, number] },
    ]
    expect(colorClassifier(close, true, 255)(253, 0, 0, 255)).toBe(UNKNOWN.ambiguous)
    expect(
      colorClassifier([{ label: '40+', minimum: 40, maximum: null, color: [0, 0, 0] }], true, 255)(0, 0, 0, 255),
    ).toBe(UNKNOWN.lossyNeutral)
    expect(colorClassifier([{ ...legend[0], aliases: [[232, 21, 21]] }], false, 255)(232, 21, 21, 255)).toBe(1)
  })
  it('uses fractional boundary areas, keeps JPEG estimates out of matched totals, and retains holes', () => {
    const grid = fixture(),
      result = summary(grid, polygon(grid, [box(0.25, 0.25, 1.75, 1.75)]))
    expect(result.areaM2).toBeCloseTo(225, 5)
    expect(result.classAreasM2[0]).toBeCloseTo(56.25, 5)
    expect(result.classAreasM2[1]).toBeCloseTo(56.25, 5)
    expect(result.estimatedClassAreasM2[0]).toBeCloseTo(56.25, 5)
    expect(result.unknownAreasM2[65]).toBeCloseTo(56.25, 5)
    expect(result.unknownAreasM2[0]).toBeCloseTo(56.25, 5)
    const hole = summary(grid, polygon(grid, [box(0, 0, 2, 2), box(0.5, 0.5, 1.5, 1.5)]))
    expect(hole.areaM2).toBeCloseTo(300, 5)
    expect(hole.classAreasM2[0]).toBeCloseTo(75, 5)
  })
  it('reconciles rotated grids, disconnected polygons and area outside coverage', () => {
    const grid = fixture([1, 2, 0, 65], [8, 6, 6, -8, 1291000, 1016000])
    const a = polygon(grid, [box(-1, 0, 0.5, 1)]),
      b = polygon(grid, [box(1, 1, 2, 2)])
    const result = summary(grid, { type: 'MultiPolygon', coordinates: [a.coordinates, b.coordinates] })
    expect(result.areaM2).toBeCloseTo(250, 5)
    expect(result.classAreasM2[0]).toBeCloseTo(50, 5)
    expect(result.estimatedClassAreasM2[0]).toBeCloseTo(100, 5)
    expect(result.unknownAreasM2[UNKNOWN.outside]).toBeCloseTo(100, 5)
    expect(() => summary(grid, polygon(grid, [box(0, 0, 0, 0)]))).toThrow(/positive area/)
  })
  it('rejects corrupt payloads, invalid aliases, illegal codes, forged counts and excessive dimensions', () => {
    const grid = fixture()
    expect(() => parseClassGrid({ ...grid, checksum: '00000000' })).toThrow(/corrupt/)
    expect(() => parseClassGrid({ ...grid, width: 20000, height: 20000 })).toThrow(/dimensions/)
    expect(() => parseClassGrid({ ...grid, wkt: grid.wkt.replace('UNIT["metre",1]', 'UNIT["foot",0.3048]') })).toThrow(
      /registration/,
    )
    expect(() => parseClassGrid({ ...grid, legend: [{ ...grid.legend[0], aliases: [[999, 0, 0]] }] })).toThrow(/legend/)
    expect(() => parseClassGrid(fixture([1, 2, 0, 100]))).toThrow(/corrupt/)
    expect(() =>
      parseClassGrid({ ...grid, counts: grid.counts.map((n, i) => (i === 1 ? n + 1 : i === 2 ? n - 1 : n)) }),
    ).toThrow(/counts/)
  })
})

describe('exact drawn / not drawn split', () => {
  const legend = [
    { label: '20 - 30', minimum: 20, maximum: 30, color: [255, 255, 115] as [number, number, number] },
    { label: '30 +', minimum: 30, maximum: null, color: [255, 0, 0] as [number, number, number] },
  ]
  // 15 exact + 35 estimated + 30 not drawn + 4 off-legend + 1 outside the frame.
  const summary = {
    areaM2: 85,
    classAreasM2: [10, 5],
    estimatedClassAreasM2: [20, 15],
    unknownAreasM2: { 0: 30, 240: 4, 245: 1, 66: 15, 65: 20 },
    pixelAreaM2: 1,
    method: 'fractional-native-pixels' as const,
  }
  it('reads transparency as the unpainted class and keeps estimates out of the exact classes', () => {
    const split = classAreaBreakdown(summary, { legend, undrawn: { label: 'Under 20', maximum: 20 } })
    expect(split.undrawnM2).toBe(30)
    // Drawn without an exact class: the 35 of estimates and the 4 off-legend pixels.
    expect(split.drawnNotExactM2).toBe(39)
    expect(split.exactClassM2).toEqual([10, 5])
    expect(split.otherUnknownM2).toBeCloseTo(1)
    expect(codeLabel(0, { legend, undrawn: { label: 'Under 20', maximum: 20 }, unit: '%' })).toMatch(
      /^Under 20 %: not drawn/,
    )
    expect(codeLabel(240, { legend, undrawn: { label: 'Under 20', maximum: 20 }, unit: '%' })).toMatch(/20 % or more/)
  })
  it('leaves code 0 unknown on grids saved before the unpainted class was recorded', () => {
    const split = classAreaBreakdown(summary, { legend })
    expect(split.undrawnM2).toBe(0)
    expect(split.drawnNotExactM2).toBe(35)
    expect(split.otherUnknownM2).toBeCloseTo(35)
  })
})
