import { describe, expect, it } from 'vitest'
import { assignContourElevations, contourSurface, nearestSeeds, readContourLabels, type ContourLabel } from './contours'
import { projectedEpsg } from './georeference'
import type { Box, Matrix, XY } from './types'

// A sheet whose page unit is 2 m: projected = 2 × page + origin. Ground is a plane rising 0.3 m
// per metre east, so the 10 m contours are north–south lines 33⅓ m (16⅔ page units) apart.
const frame: { bbox: Box; pageToProjected: Matrix } = {
  bbox: [0, 0, 500, 400],
  pageToProjected: [2, 0, 0, 2, 500_000, 6_000_000],
}
const heightAt = (projectedX: number) => 1000 + 0.3 * (projectedX - 500_000)
const pageXFor = (z: number) => (z - 1000) / 0.3 / 2
function sheet(skip: (z: number) => boolean = () => false) {
  const heights: number[] = [],
    lines: XY[][] = []
  for (let z = 1000; z <= 1290; z += 10) {
    if (skip(z)) continue
    heights.push(z)
    lines.push(Array.from({ length: 41 }, (_, i) => [pageXFor(z), i * 10] as XY))
  }
  return { heights, lines }
}

describe('contour labels', () => {
  it('reads the middle of a rotated number, where its line runs', () => {
    const labels = readContourLabels(
      [
        { str: '1100', transform: [0, 6, -6, 0, 100, 50], width: 12, height: 6 },
        { str: 'Road 1100', transform: [6, 0, 0, 6, 100, 50], width: 40, height: 6 },
        { str: '900', transform: [6, 0, 0, 6, 900, 50], width: 10, height: 6 },
      ],
      frame.bbox,
    )
    expect(labels).toHaveLength(1)
    expect(labels[0].value).toBe(1100)
    expect(labels[0].at[0]).toBeCloseTo(100 - 6 * 0.35)
    expect(labels[0].at[1]).toBeCloseTo(56)
  })
})

describe('contour elevations', () => {
  it('takes printed heights, rejects labels that disagree, and infers unlabelled lines between labelled ones', () => {
    const { heights, lines } = sheet()
    const labels: ContourLabel[] = heights.flatMap((z, i) =>
      i % 3 === 0 ? [{ at: [pageXFor(z), 200], value: z }] : [],
    )
    // A spot height off the interval, and a wrong value on the otherwise unlabelled 1220 m line.
    labels.push({ at: [pageXFor(1160), 120], value: 1163 }, { at: [pageXFor(1220), 120], value: 1500 })
    const result = assignContourElevations(lines, labels as ContourLabel[], frame.bbox, { metresPerUnit: 2 })
    expect(result.interval).toBe(10)
    expect(result.labelsRejected).toBeGreaterThanOrEqual(2)
    // Lines beyond the outermost labelled contour are never extrapolated.
    expect(result.elevations).toEqual(heights.map((z) => (z > 1270 ? null : z)))
    expect(result.inferredLines).toBe(18)
    expect(result.unassignedLines).toBe(2)
  })

  it('builds the plane exactly between contours and leaves ground no contour reaches empty', () => {
    // No contours from 1110 to 1190 m: a 300 m gap the sheet says nothing about.
    const { heights, lines } = sheet((z) => z > 1100 && z < 1200)
    const labels: ContourLabel[] = heights.map((z) => ({ at: [pageXFor(z), 200], value: z }))
    const assignment = assignContourElevations(lines, labels, frame.bbox, { metresPerUnit: 2 })
    const surface = contourSurface(lines, assignment, frame, 3005, { cellM: 5 })
    const at = (x: number, y: number) => {
      const col = Math.round((x - surface.origin[0]) / surface.cellM),
        row = Math.round((surface.origin[1] - y) / surface.cellM)
      return { value: surface.values[row * surface.width + col], x: surface.origin[0] + col * surface.cellM }
    }
    const inside = at(500_150, 6_000_400)
    expect(inside.value).toBeCloseTo(heightAt(inside.x), 3)
    expect(Number.isNaN(at(500_500, 6_000_400).value)).toBe(true)
    expect(surface.notes.join(' ')).toMatch(/left empty/)
  })
})

describe('sheet projections', () => {
  const albers =
    'PROJCS["PCS_Albers",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Albers"],PARAMETER["False_Easting",1000000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-126.0],PARAMETER["Standard_Parallel_1",50.0],PARAMETER["Standard_Parallel_2",58.5],PARAMETER["Latitude_Of_Origin",45.0],UNIT["Meter",1.0]]'
  const utm = (datum: string, meridian: number) =>
    `PROJCS["x",GEOGCS["g",DATUM["${datum}",SPHEROID["GRS_1980",6378137.0,298.257222101]]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",${meridian}],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`
  it('names BC Albers and UTM from their parameters, and nothing else', () => {
    expect(projectedEpsg(albers)).toBe(3005)
    expect(projectedEpsg(utm('D_North_American_1983', -123))).toBe(26910)
    expect(projectedEpsg(utm('D_North_American_1983_CSRS', -123))).toBe(3157)
    expect(projectedEpsg(utm('D_WGS_1984', -117))).toBe(32611)
    expect(projectedEpsg(utm('D_North_American_1983', -81))).toBeNull()
    expect(projectedEpsg(albers.replace('-126.0', '-120.0'))).toBeNull()
    // OGC spellings of the same projection, as GDAL and many exporters write it.
    expect(
      projectedEpsg(
        'PROJCS["NAD83 / BC Albers",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]]],PROJECTION["Albers_Conic_Equal_Area"],PARAMETER["standard_parallel_1",50],PARAMETER["standard_parallel_2",58.5],PARAMETER["latitude_of_center",45],PARAMETER["longitude_of_center",-126],PARAMETER["false_easting",1000000],PARAMETER["false_northing",0],UNIT["metre",1]]',
      ),
    ).toBe(3005)
  })
})

describe('nearest-contours interpolation (opt-in)', () => {
  it('finds the nearest seed exactly, as brute force does', () => {
    const width = 23,
      height = 17,
      seed = new Uint8Array(width * height)
    for (const i of [5, 60, 200, 333, 390]) seed[i] = 1
    const near = nearestSeeds(seed, width, height)
    const seeds = [...seed.keys()].filter((i) => seed[i])
    const d2 = (a: number, b: number) =>
      ((a % width) - (b % width)) ** 2 + (Math.floor(a / width) - Math.floor(b / width)) ** 2
    for (let i = 0; i < seed.length; i++) expect(d2(i, near[i])).toBe(Math.min(...seeds.map((s) => d2(i, s))))
    expect(nearestSeeds(new Uint8Array(4), 2, 2)).toEqual(Int32Array.from([-1, -1, -1, -1]))
  })
  it('reproduces a plane between parallel contours and leaves a skipped step empty', () => {
    const { heights, lines } = sheet((z) => z > 1100 && z < 1200)
    const labels: ContourLabel[] = heights.map((z) => ({ at: [pageXFor(z), 200], value: z }))
    const assignment = assignContourElevations(lines, labels, frame.bbox, { metresPerUnit: 2 })
    const surface = contourSurface(lines, assignment, frame, 3005, { cellM: 5, method: 'nearest-contours' })
    expect(surface.method).toBe('nearest-contours')
    const at = (x: number) => {
      const col = Math.round((x - surface.origin[0]) / surface.cellM),
        row = Math.round((surface.origin[1] - 6_000_400) / surface.cellM)
      return { value: surface.values[row * surface.width + col], x: surface.origin[0] + col * surface.cellM }
    }
    const inside = at(500_150)
    expect(inside.value).toBeCloseTo(heightAt(inside.x), 0)
    expect(Number.isNaN(at(500_500).value)).toBe(true)
  })
})
