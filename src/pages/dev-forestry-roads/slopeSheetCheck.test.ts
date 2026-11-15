import { describe, expect, it } from 'vitest'
import proj4 from 'proj4'
import { cellChecksum, encodeCells } from '@/lib/geoPdf/classGrid'
import type { PdfClassGrid } from '@/lib/geoPdf/types'
import { bestSlopeSheetCheck, SLOPE_SHEET_CHECK, slopeSheetCheck, slopeSheets } from './slopeSheetCheck'
import { downhillSide, slopeSheetCase } from './slopeSheetCase'
import { analyzeRoad } from './engine'
import { createDemoProject, demoTerrain } from './terrain'
import type { RoadStation } from './types'

const wkt =
  'PROJCS["NAD83 / BC Albers",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Albers_Conic_Equal_Area"],PARAMETER["standard_parallel_1",50],PARAMETER["standard_parallel_2",58.5],PARAMETER["latitude_of_center",45],PARAMETER["longitude_of_center",-126],PARAMETER["false_easting",1000000],PARAMETER["false_northing",0],UNIT["metre",1]]'
const origin = [1_291_000, 1_016_000]

/**
 * A 200 × 100 m slope sheet of 2 m pixels: the western 100 m printed 60–85% (exactly, or as JPEG
 * estimates), the eastern 100 m 20–30%.
 */
function sheet(westCode = 2): PdfClassGrid {
  const width = 100,
    height = 50
  const data = new Uint8Array(width * height)
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) data[row * width + col] = col < 50 ? westCode : 1
  const counts = Array(256).fill(0)
  for (const c of data) counts[c]++
  return {
    version: 1,
    kind: 'slope',
    unit: '%',
    width,
    height,
    transform: [2, 0, 0, -2, origin[0], origin[1]],
    wkt,
    legend: [
      { label: '20–30', minimum: 20, maximum: 30, color: [255, 255, 0] },
      { label: '60–85', minimum: 60, maximum: 85, color: [255, 0, 0] },
    ],
    undrawn: { label: 'Under 20', maximum: 20 },
    cells: encodeCells(data),
    checksum: cellChecksum(data),
    counts,
    sourceImages: [],
    notes: [],
  }
}
const lonLat = (x: number, y: number) => proj4(wkt, 'EPSG:4326', [x, y]) as [number, number]

/** A road due east through the sheet's middle, every 10 m, on ground of the given cross fall (%). */
function road(crossFallPercent: number, fromX = 0, toX = 200): RoadStation[] {
  const out: RoadStation[] = []
  for (let x = fromX; x <= toX; x += 10)
    out.push({
      chainage: x - fromX,
      coordinate: lonLat(origin[0] + x, origin[1] - 50),
      groundGradePercent: 0,
      leftWidth: 3,
      rightWidth: 3,
      section: Array.from({ length: 71 }, (_, i) => {
        const offset = i - 35
        return { offset, ground: 1000 - (offset * crossFallPercent) / 100, design: null }
      }),
    } as unknown as RoadStation)
  return out
}

describe('the slope sheet beside a road’s estimate', () => {
  const options = { intervalM: 50, minSamples: 10 }
  it('names the stretch where the sheet shows steep ground the terrain reads flat', () => {
    const check = slopeSheetCheck(road(0), { name: 'Slope.pdf', grid: sheet() }, options)!
    expect(check.sheet).toBe('Slope.pdf')
    expect(check.coveredLengthM).toBe(200)
    expect(check.exactPercent).toBe(100)
    expect(check.sheetSteepPercent).toBeGreaterThan(40)
    expect(check.terrainSteepPercent).toBe(0)
    expect(check.stretches).toHaveLength(1)
    expect(check.stretches[0].from).toBe(0)
    expect(check.stretches[0].to).toBeLessThanOrEqual(100)
    expect(check.stretches[0].sheetSteepPercent - check.stretches[0].terrainSteepPercent).toBeGreaterThanOrEqual(
      SLOPE_SHEET_CHECK.flagPoints,
    )
  })
  it('names nothing where the terrain is as steep as the sheet', () => {
    const check = slopeSheetCheck(road(70, 0, 90), { name: 'Slope.pdf', grid: sheet() }, options)!
    expect(check.terrainSteepPercent).toBe(100)
    expect(check.stretches).toEqual([])
  })
  it('counts JPEG estimates as area, and says how much of the sheet was exact', () => {
    const check = slopeSheetCheck(road(0), { name: 'Slope.pdf', grid: sheet(66) }, options)!
    expect(check.stretches).toHaveLength(1)
    expect(check.exactPercent).toBeLessThan(60)
  })
  it('is null off the sheet, and the best sheet is the one covering most of the road', () => {
    const off = road(0, 1000, 1200)
    expect(slopeSheetCheck(off, { name: 'Slope.pdf', grid: sheet() })).toBeNull()
    expect(bestSlopeSheetCheck(road(0), [{ name: 'Slope.pdf', grid: sheet() }])?.sheet).toBe('Slope.pdf')
    expect(bestSlopeSheetCheck(off, [{ name: 'Slope.pdf', grid: sheet() }])).toBeNull()
  })
  it('reads slope sheets from the project’s reference layers only', () => {
    const grid = sheet()
    expect(
      slopeSheets([
        { name: 'Slope classes', classGrid: grid, pdfSource: { file: 'Maps/Slope.pdf' } as never },
        { name: 'Canopy', classGrid: { ...grid, kind: 'canopy' } },
        { name: 'Roads' },
      ]),
    ).toEqual([{ name: 'Slope.pdf', grid }])
  })
})

describe('the high case the slope sheet points to', () => {
  const project = createDemoProject()
  const alignment = project.alignments[0]
  const analysis = analyzeRoad(alignment, demoTerrain, project.settings)
  it('reads the downhill side from the ground beyond the formation', () => {
    expect(downhillSide(road(30) as never, 0, 200)).toBe('right')
    expect(downhillSide(road(-30) as never, 0, 200)).toBe('left')
    expect(downhillSide(road(30) as never, 500, 600)).toBeNull()
  })
  it('benches a copy of the road and leaves the road alone', () => {
    let n = 0
    const before = JSON.stringify(alignment)
    const made = slopeSheetCase(alignment, analysis.stations, [{ from: 0, to: analysis.length }], () => `p${n++}`)
    expect(JSON.stringify(alignment)).toBe(before)
    if ('error' in made) throw Error(made.error)
    expect(made.change).toMatch(
      /^Full bench on 1 stretch the slope sheet shows steeper \(\d+ m\), up to [\d.]+ m lower$/,
    )
    const benched = analyzeRoad(made.alignment, demoTerrain, project.settings)
    expect(benched.cutVolumeM3).toBeGreaterThan(analysis.cutVolumeM3)
  })
  it('says why when there is nothing to bench', () => {
    expect(slopeSheetCase(alignment, analysis.stations, [], () => 'x')).toEqual({
      error: 'The slope sheet shows no stretch steeper than the terrain.',
    })
  })
})
