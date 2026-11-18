import { describe, expect, it } from 'vitest'
import { BLOCK_OF_INTEREST } from '@/lib/forestry/blockSheet/styles'
import { syntheticTerrain } from '@/lib/forestry/blockSheet/blockSheetFixtures'
import { SHEET_KINDS, SHEET_PRESETS } from '@/lib/forestry/blockSheet/sheets'
import { DEFAULT_FIGURE_STYLE, presetById } from '@/lib/forestry/viaFigure/presets'
import {
  buildVisualsSheet,
  changeVisualsSheetSettings,
  DEFAULT_VISUALS_SHEET,
  effectiveSheetFields,
  officeSheetFields,
  parseVisualsSheetSettings,
  SHEET_DEM_TILE_BUDGET,
  SHEET_SYMBOLS_STYLE,
  sheetDemRange,
  visualsSheetFileName,
  visualsSheetLabel,
  visualsSheetLayers,
  visualsSheetStyles,
  visualsSheetSummary,
  visualsSheetSymbols,
  visualsSheetTitle,
  visualsSheetUnavailable,
  type VisualsSheetDeps,
  type VisualsSheetScene,
} from './visualsBlockSheet'

const LNG = -122.5
const LAT = 54
const square = (lng: number, lat: number, d = 0.004): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, lat],
      [lng + d, lat],
      [lng + d, lat + d],
      [lng, lat + d],
      [lng, lat],
    ],
  ],
})

const scene = (patch: Partial<VisualsSheetScene> = {}): VisualsSheetScene => ({
  targets: [
    { id: 'b1', name: 'Block 1', role: 'block', geometry: square(LNG, LAT) },
    { id: 'b2', name: 'Block 2', role: 'block', geometry: square(LNG + 0.006, LAT) },
    { id: 'lf', name: 'Face', role: 'landscape', geometry: square(LNG - 0.01, LAT - 0.01, 0.03) },
    { id: 'op', name: 'Old cut', role: 'harvested', geometry: square(LNG - 0.006, LAT) },
  ],
  masks: [
    { kind: 'private', geometry: square(LNG, LAT + 0.006) },
    { kind: 'natural', geometry: square(LNG + 0.006, LAT + 0.006) },
    { kind: 'retained', geometry: square(LNG + 0.001, LAT + 0.001, 0.001) },
    { kind: 'permanent', geometry: square(LNG - 0.006, LAT + 0.006) },
  ],
  viewpoint: {
    name: 'Highway 16',
    mode: 'corridor',
    coordinates: [
      [LNG - 0.02, LAT - 0.005],
      [LNG + 0.02, LAT - 0.005],
    ],
  },
  views: [{ name: 'Rest area', lng: LNG - 0.012, lat: LAT - 0.004 }],
  ...patch,
})

const issue = { date: '2026-11-18', preparedBy: '', organisation: '', revision: '' }
const drain = async <T>(steps: Generator<number, T>) => {
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}
const deps = (patch: Partial<VisualsSheetDeps> = {}): VisualsSheetDeps => ({
  loadTerrain: async () => ({ source: syntheticTerrain, missingTileCount: 0 }),
  drive: drain,
  captureImagery: async () => ({
    image: { kind: 'rgba', data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1 },
    attribution: 'Test imagery',
  }),
  ...patch,
})
const labels = (built: Awaited<ReturnType<typeof buildVisualsSheet>>) =>
  built.sheet.legend.map((item) => item.symbol.label)

describe('visual quality block sheet settings', () => {
  it('reads stored settings defensively', () => {
    expect(parseVisualsSheetSettings(null)).toEqual(DEFAULT_VISUALS_SHEET)
    expect(parseVisualsSheetSettings({ kind: 'nope', paper: 'x', scale: -1, style: 'gone', fields: 3 })).toEqual(
      DEFAULT_VISUALS_SHEET,
    )
    expect(
      parseVisualsSheetSettings({ kind: 'lidar-slope', paper: 'a3', scale: 'fit', style: DEFAULT_FIGURE_STYLE }),
    ).toMatchObject({ kind: 'lidar-slope', paper: 'a3', scale: 'fit', style: DEFAULT_FIGURE_STYLE })
  })

  it('starts a newly picked sheet at its own default scale', () => {
    const next = changeVisualsSheetSettings(DEFAULT_VISUALS_SHEET, { ...DEFAULT_VISUALS_SHEET, kind: 'lidar-slope' })
    expect(next.scale).toBe(10000)
    expect(changeVisualsSheetSettings(next, { ...next, scale: 20000 }).scale).toBe(20000)
  })

  it('offers every sheet type the road designer prints, and says why canopy height cannot be made here', () => {
    const available = SHEET_KINDS.filter((kind) => !visualsSheetUnavailable(kind))
    expect(available).toEqual(SHEET_KINDS.filter((kind) => kind !== 'lidar-canopy-height'))
    expect(visualsSheetUnavailable('lidar-canopy-height')).toMatch(/canopy height grid/)
  })

  it('prints a typed field over the office field, and the office field where the typed one is blank', () => {
    const office = officeSheetFields({ licence: ' A12345 ', cuttingPermit: '', district: 'Prince George' })
    expect(office).toEqual({ forestLicence: 'A12345', forestDistrict: 'Prince George' })
    expect(effectiveSheetFields({ forestLicence: 'A99999', cuttingPermit: ' ', blockId: 'B7' }, office)).toEqual({
      forestLicence: 'A99999',
      forestDistrict: 'Prince George',
      blockId: 'B7',
    })
  })

  it('names the terrain sheets without claiming LiDAR, and leaves the others as the road designer names them', () => {
    expect(visualsSheetLabel('lidar-slope')).toBe('Design Slope')
    expect(visualsSheetTitle('lidar-hillshade')).toBe('Design Hillshade')
    expect(visualsSheetLabel('general-access')).toBe(SHEET_PRESETS['general-access'].label)
    expect(visualsSheetTitle('field-imagery')).toBe(SHEET_PRESETS['field-imagery'].title)
  })

  it('names the file after the block and the sheet', () => {
    expect(visualsSheetFileName(DEFAULT_VISUALS_SHEET, 'CP 12 / Blk 3')).toBe('cp-12-blk-3-general-access.pdf')
    expect(visualsSheetFileName(DEFAULT_VISUALS_SHEET, undefined)).toBe('visual-quality-general-access.pdf')
  })
})

describe('visual quality block sheet styles', () => {
  it('offers the sheet symbols first, then the figure styles that draw an area of the scene', () => {
    const styles = visualsSheetStyles()
    expect(styles[0]).toEqual({ value: SHEET_SYMBOLS_STYLE, label: 'PGMaps sheet symbols' })
    expect(styles.map((style) => style.value)).toContain(DEFAULT_FIGURE_STYLE)
    expect(new Set(styles.map((style) => style.value)).size).toBe(styles.length)
  })

  it('leaves the blocks to the sheet under the sheet symbols, and gives them the figure style under one', () => {
    expect(visualsSheetSymbols(SHEET_SYMBOLS_STYLE).block).toBeNull()
    const preset = presetById(DEFAULT_FIGURE_STYLE)
    const styled = visualsSheetSymbols(DEFAULT_FIGURE_STYLE)
    expect(styled.block).toMatchObject({ ...preset.symbols.proposedBlock!.symbol, label: 'Proposed Block' })
    expect(styled.landform).toMatchObject({ ...preset.symbols.landform!.symbol, label: 'Landform' })
    // A role the style does not draw keeps the sheet's symbol.
    expect(styled.privateLand).toEqual(visualsSheetSymbols(SHEET_SYMBOLS_STYLE).privateLand)
  })

  it('reads a style id that is no longer in the catalogue as the sheet symbols', () => {
    expect(visualsSheetSymbols('renamed-style')).toEqual(visualsSheetSymbols(SHEET_SYMBOLS_STYLE))
  })
})

describe('visual quality block sheet layers', () => {
  it('makes the chosen block the block of interest and the rest other blocks', () => {
    const { layers, symbols } = visualsSheetLayers(scene(), 'b2', SHEET_SYMBOLS_STYLE)
    expect(layers.block?.name).toBe('Block 2')
    expect(layers.otherBlocks).toHaveLength(1)
    expect(symbols).toEqual({})
    expect(visualsSheetLayers(scene(), 'gone', SHEET_SYMBOLS_STYLE).layers.block?.name).toBe('Block 1')
  })

  it('draws the landform, opening, masks, road and views, and leaves a permanent disturbance off', () => {
    const { layers } = visualsSheetLayers(scene(), 'b1', SHEET_SYMBOLS_STYLE)
    const drawn = layers.extras!.map((extra) => extra.symbol.label)
    expect(drawn).toEqual([
      'Existing opening',
      'Private land',
      'Rock / non-vegetated',
      'Wildlife tree patch / retention',
      'Landform',
      'Assessed road',
      'Viewpoints',
    ])
    // A spot viewpoint is a point with the views of interest, not a road.
    const spot = visualsSheetLayers(
      scene({ viewpoint: { name: 'Lookout', mode: 'spot', coordinates: [[LNG - 0.01, LAT]] } }),
      'b1',
      SHEET_SYMBOLS_STYLE,
    ).layers.extras!
    expect(spot.filter((extra) => extra.geometry.type === 'Point')).toHaveLength(2)
    expect(spot.some((extra) => extra.symbol.label === 'Assessed road')).toBe(false)
  })

  it('summarises what the dialog lists from the same scene and settings', () => {
    const summary = visualsSheetSummary(scene(), { ...DEFAULT_VISUALS_SHEET, block: 'b2' })!
    expect(summary).toMatchObject({
      block: 'Block 2',
      sheet: 'General Block Access 1:50,000',
      scale: '1:50,000',
      style: 'PGMaps sheet symbols',
      unavailable: null,
    })
    expect(summary.drawn.find((row) => row.label === 'Permanent non-forestry disturbance')?.value).toMatch(/not drawn/)
    expect(visualsSheetSummary(scene({ targets: [] }), DEFAULT_VISUALS_SHEET)).toBeNull()
  })
})

describe('visual quality block sheet build', () => {
  it('reads terrain within the tile budget, at a coarser zoom for a wider frame', () => {
    const near = sheetDemRange([LNG, LAT, LNG + 0.05, LAT + 0.03])
    const wide = sheetDemRange([LNG - 1, LAT - 0.6, LNG + 1, LAT + 0.6])
    const tiles = (range: typeof near) => (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1)
    expect(tiles(near)).toBeLessThanOrEqual(SHEET_DEM_TILE_BUDGET)
    expect(near.zoom).toBeGreaterThan(wide.zoom)
  })

  it('prints the slope sheet’s title without "LiDAR" and says where its terrain came from', async () => {
    const built = await buildVisualsSheet(
      { settings: { ...DEFAULT_VISUALS_SHEET, kind: 'lidar-slope', scale: 10000 }, scene: scene(), office: {}, issue },
      deps(),
    )
    const printed = built.sheet.ops.flatMap((op) => (op.op === 'text' ? [op.text] : []))
    expect(printed).toContain('Design Slope Map')
    expect(printed.join(' ')).not.toMatch(/LiDAR/)
    expect(printed.some((text) => /Slope % from terrain tiles \(SRTM\/CDEM, zoom \d+\)/.test(text))).toBe(true)
  })

  it('builds the access sheet with the sheet symbols and lists what fell in the frame', async () => {
    const built = await buildVisualsSheet(
      { settings: { ...DEFAULT_VISUALS_SHEET, block: 'b1' }, scene: scene(), office: {}, issue },
      deps(),
    )
    expect(built.facts?.areaHa).toBeGreaterThan(0)
    expect(labels(built)).toEqual(
      expect.arrayContaining([
        BLOCK_OF_INTEREST.default.label,
        'Other blocks',
        'Landform',
        'Existing opening',
        'Private land',
        'Assessed road',
        'Viewpoints',
      ]),
    )
    expect(built.missing).toEqual([])
  })

  it('draws both blocks with the figure style’s block symbol, listed once', async () => {
    const built = await buildVisualsSheet(
      { settings: { ...DEFAULT_VISUALS_SHEET, style: DEFAULT_FIGURE_STYLE }, scene: scene(), office: {}, issue },
      deps(),
    )
    expect(labels(built).filter((label) => label === 'Proposed Block')).toHaveLength(1)
    expect(labels(built)).not.toContain(BLOCK_OF_INTEREST.default.label)
  })

  it('writes a sheet without contours when the terrain does not load, and says so', async () => {
    const built = await buildVisualsSheet(
      { settings: DEFAULT_VISUALS_SHEET, scene: scene(), office: {}, issue },
      deps({
        loadTerrain: async () => {
          throw Error('offline')
        },
      }),
    )
    expect(built.missing).toHaveLength(1)
    expect(built.missing[0]).toMatch(/did not load \(offline\).*no contours/)
  })

  it('refuses a slope sheet with no terrain, a sheet with no block and the canopy sheet', async () => {
    const offline = deps({
      loadTerrain: async () => {
        throw Error('offline')
      },
    })
    const run = {
      settings: { ...DEFAULT_VISUALS_SHEET, kind: 'lidar-slope' as const },
      scene: scene(),
      office: {},
      issue,
    }
    await expect(buildVisualsSheet(run, offline)).rejects.toThrow(/terrain for this sheet did not load/)
    await expect(
      buildVisualsSheet({ ...run, settings: DEFAULT_VISUALS_SHEET, scene: scene({ targets: [] }) }, deps()),
    ).rejects.toThrow(/Add a cutblock/)
    await expect(
      buildVisualsSheet({ ...run, settings: { ...DEFAULT_VISUALS_SHEET, kind: 'lidar-canopy-height' } }, deps()),
    ).rejects.toThrow(/canopy height grid/)
  })

  it('takes imagery only for the imagery sheet', async () => {
    let captures = 0
    const counting = deps({
      captureImagery: async () => {
        captures += 1
        return {
          image: { kind: 'rgba', data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1 },
          attribution: 'Test imagery',
        }
      },
    })
    const run = { settings: DEFAULT_VISUALS_SHEET, scene: scene(), office: {}, issue }
    await buildVisualsSheet(run, counting)
    expect(captures).toBe(0)
    await buildVisualsSheet(
      { ...run, settings: { ...DEFAULT_VISUALS_SHEET, kind: 'field-imagery', scale: 10000 } },
      counting,
    )
    expect(captures).toBe(1)
  })
})
