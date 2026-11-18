import { describe, expect, it } from 'vitest'
import proj4 from 'proj4'
import { syntheticTerrain } from '@/lib/forestry/blockSheet/blockSheetFixtures'
import { cellChecksum, encodeCells, ESTIMATE_DISPLAY_CELL_M, UNKNOWN } from '@/lib/geoPdf/classGrid'
import { CANFOR_RASTERS } from '@/lib/geoPdf/rasterProfiles'
import type { PdfClassGrid, PdfImageMosaic, PdfSource } from '@/lib/geoPdf/types'
import { blockSheetPublished, blockSheetUnavailable, buildBlockSheet, DEFAULT_BLOCK_SHEET } from './blockSheet'
import {
  ESTIMATE_SHEET_OPACITY,
  publishedByDefault,
  publishedChoice,
  publishedClassRaster,
  publishedHillshade,
  publishedOffers,
} from './pdfSheetRasters'
import type { ReferenceFeature } from './referenceFeatures'
import { createDemoProject } from './terrain'
import type { RoadProject } from './types'

const WKT =
  'PROJCS["NAD83 / BC Albers",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Albers_Conic_Equal_Area"],PARAMETER["standard_parallel_1",50],PARAMETER["standard_parallel_2",58.5],PARAMETER["latitude_of_center",45],PARAMETER["longitude_of_center",-126],PARAMETER["false_easting",1000000],PARAMETER["false_northing",0],UNIT["metre",1]]'
const albers = proj4('EPSG:4326', WKT)
const SLOPE_COLOURS: [number, number, number][] = [
  [255, 255, 115],
  [163, 255, 115],
  [115, 223, 255],
  [223, 115, 255],
  [255, 170, 0],
  [255, 127, 127],
  [232, 21, 21],
  [0, 0, 0],
]
const SIZE = 60
const CELL_M = 10
/** A 600 m slope grid of 10 m pixels whose top-left corner is 300 m north-west of `centre`. */
function slopeGrid(centre: [number, number], paint: (col: number, row: number) => number): PdfClassGrid {
  const [x, y] = albers.forward(centre)
  const data = new Uint8Array(SIZE * SIZE)
  for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) data[row * SIZE + col] = paint(col, row)
  const counts = Array(256).fill(0) as number[]
  for (const code of data) counts[code]++
  const profile = CANFOR_RASTERS.find((entry) => entry.kind === 'slope')!
  return {
    version: 1,
    kind: 'slope',
    unit: '%',
    legend: profile.classes.map((range, i) => ({ ...range, color: SLOPE_COLOURS[i] })),
    undrawn: profile.undrawn,
    width: SIZE,
    height: SIZE,
    transform: [CELL_M, 0, 0, -CELL_M, x - (SIZE * CELL_M) / 2, y + (SIZE * CELL_M) / 2],
    wkt: WKT,
    cells: encodeCells(data),
    checksum: cellChecksum(data),
    counts,
    sourceImages: [],
    notes: [],
  }
}
/** WGS84 centre of a pixel. */
const at = (grid: PdfClassGrid, col: number, row: number) =>
  albers.inverse([
    grid.transform[4] + (col + 0.5) * grid.transform[0],
    grid.transform[5] + (row + 0.5) * grid.transform[3],
  ]) as [number, number]
const source: PdfSource = {
  file: 'Maps/Slope_Map.pdf',
  sha256: 'a'.repeat(64),
  page: 1,
  layer: 'Slope Class - Smoothed',
  profile: 'Test',
  registrationErrorM: 0.1,
}
const frame = (grid: PdfClassGrid): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [at(grid, 0, 0), at(grid, SIZE - 1, 0), at(grid, SIZE - 1, SIZE - 1), at(grid, 0, SIZE - 1), at(grid, 0, 0)],
  ],
})
const classFeature = (grid: PdfClassGrid, id = 'slope'): ReferenceFeature => ({
  id,
  name: 'Slope classes',
  geometry: frame(grid),
  pdfSource: source,
  classGrid: grid,
})
const centre: [number, number] = [-121.52, 54.06]
// Columns 0–9 exact 20–30, 10–19 a JPEG estimate of 60–85, 20–29 not drawn, 30–39 exact 95+,
// 40–49 outside the sheet's frame, the rest exact 85+.
const columns = (col: number) =>
  col < 10 ? 1 : col < 20 ? 64 + 6 : col < 30 ? 0 : col < 40 ? 8 : col < 50 ? UNKNOWN.clipped : 7

describe('block sheet rasters from an imported map sheet', () => {
  it("prints a class grid in the sheet's own colours, estimates paler, and says where it came from", () => {
    const grid = slopeGrid(centre, columns)
    const made = publishedClassRaster(grid, 'Slope_Map.pdf')
    if (!('raster' in made)) throw Error(made.reason)
    const out = new Uint8ClampedArray(4)
    const read = (col: number) => {
      out.fill(9)
      const covered = made.raster.sample(...at(grid, col, 30), out, 0)
      return { covered, rgba: [...out] }
    }
    expect(read(5)).toEqual({ covered: true, rgba: [255, 255, 115, 216] })
    // The sheet's 60–85 colour, at the estimate's share of the class opacity.
    expect(read(15)).toEqual({ covered: true, rgba: [255, 127, 127, Math.round(216 * ESTIMATE_SHEET_OPACITY)] })
    // Not drawn on the source is the clear class under 20 %: covered, and nothing painted.
    expect(read(25)).toEqual({ covered: true, rgba: [9, 9, 9, 9] })
    // The separate 95+ mask prints as the sheet's black overlay; 85+ in the sheet's red.
    expect(read(35)).toEqual({ covered: true, rgba: [0, 0, 0, 255] })
    expect(read(55)).toEqual({ covered: true, rgba: [232, 21, 21, 216] })
    // Outside the source's frame, and outside the grid, the source holds nothing.
    expect(read(45).covered).toBe(false)
    expect(made.raster.sample(centre[0] + 0.1, centre[1], out, 0)).toBe(false)
    expect(made.raster.source).toBe('Slope classes as published on Slope_Map.pdf')
    expect(made.raster.legend?.map((entry) => entry.label)).toEqual([
      '20 - 30',
      '30 - 35',
      '35 - 40',
      '40 - 50',
      '50 - 60',
      '60 - 85',
      '85 +',
      '95 +',
      `Paler: estimated, per ${ESTIMATE_DISPLAY_CELL_M} m`,
    ])
    // A grid with no estimate has no paler key.
    const exactOnly = publishedClassRaster(
      slopeGrid(centre, () => 1),
      'Slope_Map.pdf',
    )
    expect('raster' in exactOnly && exactOnly.raster.legend).toHaveLength(8)
  })

  it("refuses a grid whose ranges are not the sheet's, instead of re-binning it", () => {
    const grid = slopeGrid(centre, columns)
    const other = { ...grid, legend: grid.legend.map((range, i) => (i === 1 ? { ...range, maximum: 36 } : range)) }
    expect(publishedClassRaster(other, 'x.pdf')).toEqual({
      reason: "its 30 - 35 % class is not one of the sheet's classes",
    })
    expect(publishedClassRaster({ ...grid, undrawn: undefined }, 'x.pdf')).toMatchObject({
      reason: expect.stringMatching(/import the PDF again/),
    })
    expect(publishedClassRaster({ ...grid, undrawn: { label: 'Under 25', maximum: 25 } }, 'x.pdf')).toMatchObject({
      reason: expect.stringMatching(/starts at 25 %/),
    })
    // The refused grid is offered with its reason, and the sheet says so.
    const offers = publishedOffers([classFeature(other)])
    expect(offers).toMatchObject([{ base: 'slope', file: 'Slope_Map.pdf', reason: expect.any(String) }])
    expect(blockSheetUnavailable('lidar-slope', {}, offers)).toMatch(
      /Needs terrain under the block\. The imported Slope_Map\.pdf cannot stand in: its 30 - 35 % class/,
    )
    // A usable grid of the same kind hides the refused one.
    expect(publishedOffers([classFeature(other, 'a'), classFeature(grid, 'b')])).toMatchObject([
      { base: 'slope', feature: { id: 'b' } },
    ])
  })

  it('draws the imported sheet by default only where the project has nothing finer of its own', () => {
    expect(publishedByDefault('slope', null, false)).toBe(true)
    expect(publishedByDefault('slope', { kind: 'regional' }, false)).toBe(true)
    expect(publishedByDefault('hillshade', { kind: 'geotiff', raster: { id: 'sheet-contours' } as never }, false)).toBe(
      true,
    )
    expect(
      publishedByDefault(
        'slope',
        { kind: 'geotiff', fill: { name: 'Regional DEM', resolutionM: 22, sharePercent: 60 } },
        false,
      ),
    ).toBe(true)
    expect(publishedByDefault('slope', { kind: 'geotiff', raster: { id: 'lidar' } as never }, false)).toBe(false)
    expect(publishedByDefault('canopy-height', { kind: 'geotiff' }, false)).toBe(true)
    expect(publishedByDefault('canopy-height', { kind: 'regional' }, true)).toBe(false)
    const offers = publishedOffers([classFeature(slopeGrid(centre, columns))])
    const lidar = { kind: 'geotiff' as const, raster: { id: 'lidar' } as never }
    expect(publishedChoice('slope', 'auto', offers, lidar, false)).toBeNull()
    expect(publishedChoice('slope', 'sheet', offers, lidar, false)).toBe(offers[0])
    expect(publishedChoice('slope', 'terrain', offers, null, false)).toBeNull()
    expect(publishedChoice('hillshade', 'sheet', offers, null, false)).toBeNull()
    expect(publishedChoice('white', 'sheet', offers, null, false)).toBeNull()
  })

  it('reads a hillshade picture from its decoded tiles', () => {
    const [x, y] = albers.forward(centre)
    const mosaic: PdfImageMosaic = {
      version: 1,
      kind: 'hillshade',
      width: 4,
      height: 2,
      transform: [10, 0, 0, -10, x, y],
      wkt: WKT,
      tiles: [
        { image: 'data:image/png;base64,AAAA', col: 0, row: 0, width: 2, height: 2, reference: '1R', lossy: false },
        { image: 'data:image/png;base64,AAAA', col: 2, row: 0, width: 2, height: 2, reference: '2R', lossy: false },
      ],
    }
    const raster = publishedHillshade(mosaic, [Uint8Array.of(10, 20, 30, 40), null], 'Hillshade_Map.pdf')
    const out = new Uint8ClampedArray(4)
    const point = (col: number, row: number) =>
      albers.inverse([x + (col + 0.5) * 10, y - (row + 0.5) * 10]) as [number, number]
    expect(raster.sample(...point(1, 1), out, 0)).toBe(true)
    expect([...out]).toEqual([40, 40, 40, 255])
    expect(raster.sample(...point(3, 0), out, 0)).toBe(false)
    expect(raster.source).toBe('Hillshade as published on Hillshade_Map.pdf')
    expect(raster.legend).toBeUndefined()
  })
})

describe('a block sheet printed from an imported slope sheet', () => {
  function withSlopeSheet(): RoadProject {
    const base = createDemoProject()
    const [lng, lat] = base.alignments[0].points[0].coordinate
    const grid = slopeGrid([lng, lat], columns)
    return {
      ...base,
      context: [
        {
          id: 'b1',
          name: 'Block 1',
          kind: 'harvest',
          geometry: {
            type: 'Polygon',
            coordinates: [[at(grid, 20, 20), at(grid, 40, 20), at(grid, 40, 40), at(grid, 20, 40), at(grid, 20, 20)]],
          },
        },
      ],
      reference: [classFeature(grid)],
    }
  }
  const run = (
    project: RoadProject,
    raster: 'auto' | 'terrain' | 'sheet',
    terrain: typeof syntheticTerrain | null,
  ) => ({
    settings: { ...DEFAULT_BLOCK_SHEET, kind: 'lidar-slope' as const, block: 'context:b1', raster },
    project,
    analyses: new Map(),
    terrain: terrain as never,
    terrainName: 'Regional DEM, 22 m',
    terrainResolutionM: 22,
    canopy: null,
    issue: { date: '2026-11-18', preparedBy: '', organisation: '', revision: '' },
    caveat: 'Preliminary',
    preview: true,
  })
  const texts = (built: Awaited<ReturnType<typeof buildBlockSheet>>) =>
    built.sheet.ops.flatMap((op) => (op.op === 'text' ? [op.text] : []))

  it('is available without terrain and prints the published classes with their legend and source', async () => {
    const project = withSlopeSheet()
    expect(blockSheetUnavailable('lidar-slope', {}, publishedOffers(project.reference))).toBeNull()
    expect(blockSheetUnavailable('lidar-hillshade', {}, publishedOffers(project.reference))).toMatch(/terrain/)
    const built = await buildBlockSheet(run(project, 'terrain', null))
    expect(built.sheet.classLegend.map((entry) => entry.label)).toContain('95 +')
    expect(texts(built).some((text) => text.startsWith('Slope classes as published on Slope_Map.pdf'))).toBe(true)
    // The frame is wider than the 600 m grid, and the sheet's notes say how much of it is covered.
    expect(built.missing.join(' ')).toMatch(/The imported sheet covers \d+% of the map frame/)
    const image = built.sheet.ops.find((op) => op.op === 'image' && op.image.kind === 'rgba')
    if (!image || image.op !== 'image' || image.image.kind !== 'rgba') throw Error('no base raster')
    const colours = new Set<string>()
    for (let i = 0; i < image.image.data.length; i += 4)
      if (image.image.data[i + 3]) colours.add([...image.image.data.subarray(i, i + 4)].join(','))
    expect([...colours].sort()).toEqual(['0,0,0,255', '232,21,21,216', '255,127,127,130', '255,255,115,216'].sort())
  })

  it('follows the choice when the project has terrain of its own', async () => {
    const project = withSlopeSheet()
    const sources = { terrain: syntheticTerrain }
    expect(blockSheetPublished('lidar-slope', 'terrain', project, sources)).toBeNull()
    expect(blockSheetPublished('lidar-slope', 'sheet', project, sources)?.file).toBe('Slope_Map.pdf')
    // The demo project's terrain is not a detailed one, so the sheet is PGMaps' choice.
    expect(blockSheetPublished('lidar-slope', 'auto', project, sources)?.file).toBe('Slope_Map.pdf')
    expect(blockSheetPublished('field-layout', 'sheet', project, sources)).toBeNull()
    const fromTerrain = await buildBlockSheet(run(project, 'terrain', syntheticTerrain))
    expect(texts(fromTerrain).some((text) => text.startsWith('Slope % from Regional DEM, 22 m'))).toBe(true)
    const fromSheet = await buildBlockSheet(run(project, 'sheet', syntheticTerrain))
    expect(texts(fromSheet).some((text) => text.startsWith('Slope classes as published on'))).toBe(true)
    // Elevations and contours still come from the terrain.
    expect(fromSheet.facts?.elevation).toEqual(fromTerrain.facts?.elevation)
  })
})
