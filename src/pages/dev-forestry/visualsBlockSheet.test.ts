import { strFromU8, unzipSync } from 'fflate'
import { GState, jsPDF } from 'jspdf'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SHEET_OUTPUT, SERIES_NOTES_FILE, seriesPages } from '@/lib/forestry/blockSheet/sheetSeries'
import { MASK_NOTE } from '@/lib/forestry/blockSheet/composeSheet'
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
  seriesProgressText,
  SHEET_DEM_TILE_BUDGET,
  SHEET_SYMBOLS_STYLE,
  sheetDemRange,
  visualsSeriesBlocks,
  visualsSeriesPageRun,
  visualsSheetFileName,
  visualsSheetFileRows,
  visualsSheetLabel,
  visualsSheetLayers,
  visualsSheetStyles,
  visualsSheetSummary,
  visualsSheetSymbols,
  visualsSheetTitle,
  visualsSheetOutputPlan,
  visualsSheetUnavailable,
  writeVisualsSheet,
  type VisualsSheetDeps,
  type VisualsSheetScene,
  type VisualsSheetSettings,
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
    expect(visualsSheetFileName(DEFAULT_VISUALS_SHEET, 'Block 1', 'svg')).toBe('block-1-general-access.svg')
  })

  it('keeps how the sheet is written with its other settings, and reads it back defensively', () => {
    expect(DEFAULT_VISUALS_SHEET.output).toEqual(DEFAULT_SHEET_OUTPUT)
    const stored = parseVisualsSheetSettings({ output: { format: 'svg', series: true, blocks: ['b2'], mask: true } })
    expect(stored.output).toMatchObject({ format: 'svg', series: true, blocks: ['b2'], mask: true })
    expect(parseVisualsSheetSettings({ output: { format: 'tiff' } }).output.format).toBe('pdf')
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

const output = (patch: Partial<VisualsSheetSettings['output']> = {}): VisualsSheetSettings => ({
  ...DEFAULT_VISUALS_SHEET,
  output: { ...DEFAULT_SHEET_OUTPUT, ...patch },
})

/** A made-up scene with three proposed blocks, one carrying its planning ids. */
const threeBlocks = () =>
  scene({
    targets: [
      ...scene().targets,
      {
        id: 'b10',
        name: 'Block 10',
        role: 'block',
        geometry: square(LNG + 0.012, LAT),
        planning: { blockId: 'B10', permitId: '412', licenceId: null },
      },
    ],
  })

describe('visual quality block sheet series', () => {
  it('lists the proposed blocks in scene order with the attributes their import gave', () => {
    expect(visualsSeriesBlocks(threeBlocks())).toEqual([
      { id: 'b1', name: 'Block 1' },
      { id: 'b2', name: 'Block 2' },
      { id: 'b10', name: 'Block 10', attributes: { BLOCK: 'B10', CP: '412' } },
    ])
  })

  it('writes one sheet when the scene has a single block, whatever the series setting', () => {
    const one = scene({ targets: scene().targets.filter((target) => target.id !== 'b2') })
    const plan = visualsSheetOutputPlan(one, { ...DEFAULT_SHEET_OUTPUT, series: true, format: 'png' })
    expect(plan).toMatchObject({ series: false, pages: [], container: 'png', problem: null })
  })

  it('orders the chosen blocks and names each file in a ZIP', () => {
    const plan = visualsSheetOutputPlan(threeBlocks(), {
      ...DEFAULT_SHEET_OUTPUT,
      series: true,
      format: 'svg',
      order: 'name',
      blocks: ['b10', 'b2'],
    })
    expect(plan.pages.map((page) => page.name)).toEqual(['Block 2', 'Block 10'])
    expect(plan).toMatchObject({ container: 'zip', stale: 0, problem: null })
    expect(plan.fileNames).toEqual(['1-Block-2.svg', '2-Block-10.svg'])
    // PDF pages go in one PDF unless a ZIP is asked for; then the ZIP's names are listed too.
    const pdf = visualsSheetOutputPlan(threeBlocks(), { ...DEFAULT_SHEET_OUTPUT, series: true })
    expect(pdf).toMatchObject({ container: 'pdf', fileNames: [] })
  })

  it('drops chosen blocks the scene no longer has, never swapping in another, and says so', () => {
    const plan = visualsSheetOutputPlan(threeBlocks(), {
      ...DEFAULT_SHEET_OUTPUT,
      series: true,
      blocks: ['gone', 'b2', 'also-gone'],
    })
    expect(plan.pages.map((page) => page.id)).toEqual(['b2'])
    expect(plan.selection).toEqual(['b2'])
    expect(plan.stale).toBe(2)
    expect(plan.problem).toBeNull()
    const none = visualsSheetOutputPlan(threeBlocks(), { ...DEFAULT_SHEET_OUTPUT, series: true, blocks: ['gone'] })
    expect(none.pages).toEqual([])
    expect(none.problem).toMatch(/no longer in the scene/)
    // *All* takes in every block, new ones included.
    expect(
      visualsSheetOutputPlan(threeBlocks(), { ...DEFAULT_SHEET_OUTPUT, series: true, blocks: 'all' }).pages,
    ).toHaveLength(3)
  })

  it('lists the file from the same plan: format, pages, blocks, names, mask and the terrain a series reads', () => {
    const value = (rows: { label: string; value: string }[], label: string) =>
      rows.find((row) => row.label === label)?.value
    const single = visualsSheetFileRows(threeBlocks(), output())
    expect(value(single.rows, 'Format')).toBe('PDF')
    expect(value(single.rows, 'Written as')).toBe('One sheet, PDF')
    expect(value(single.rows, 'Outside the block')).toBe('Drawn evenly')
    expect(value(single.rows, 'Terrain read')).toBe(`Up to ${SHEET_DEM_TILE_BUDGET} tiles`)
    const zip = visualsSheetFileRows(threeBlocks(), {
      ...output({ series: true, format: 'png', blocks: ['b1', 'gone', 'b10'], mask: true }),
      kind: 'lidar-slope',
    })
    expect(value(zip.rows, 'Written as')).toBe('A ZIP of 2 PNG files, one a block')
    expect(value(zip.rows, 'Blocks, in order')).toBe('Block 1, Block 10')
    expect(value(zip.rows, 'Chosen earlier')).toBe('1 block no longer in the scene: left out')
    expect(value(zip.rows, 'File names')).toBe('1-Block-1.png, 2-Block-10.png')
    expect(value(zip.rows, 'Outside the block')).toMatch(/^Dimmed/)
    expect(value(zip.rows, 'Terrain read')).toBe(
      `Up to ${SHEET_DEM_TILE_BUDGET} tiles a sheet, ${2 * SHEET_DEM_TILE_BUDGET} at most for the series`,
    )
    expect(zip.note).toMatch(/left out by name/)
    expect(zip.note).toMatch(/notes\.txt/)
    // The imagery sheet captures its imagery once for each sheet of a series.
    const imagery = visualsSheetFileRows(threeBlocks(), { ...output({ series: true }), kind: 'field-imagery' })
    expect(value(imagery.rows, 'Imagery')).toBe('Captured once for each of the 3 sheets')
    expect(value(imagery.rows, 'Written as')).toBe('One PDF of 3 pages, one a block')
  })

  it('carries the file rows, the problem and the extension into the dialog summary', () => {
    const summary = visualsSheetSummary(threeBlocks(), output({ series: true, format: 'svg' }))!
    expect(summary).toMatchObject({ extension: '.zip', problem: null })
    expect(summary.block).toBe('Each chosen block on its own sheet (3 of 3)')
    expect(visualsSheetSummary(threeBlocks(), output({ format: 'png' }))!.extension).toBe('.png')
    expect(visualsSheetSummary(threeBlocks(), output({ series: true, blocks: [] }))!.problem).toMatch(
      /at least one block/,
    )
  })

  it('frames each page on its block and fills its tokens there', () => {
    const run = {
      settings: {
        ...output(),
        fields: { blockId: '{attr:BLOCK}', cuttingPermit: 'CP {attr:CP}' },
        comments: '{name}, {page} of {total}',
      },
      scene: threeBlocks(),
      office: {},
      issue,
    }
    const [, , page] = seriesPages(visualsSeriesBlocks(run.scene))
    const paged = visualsSeriesPageRun(run, page)
    expect(paged.settings).toMatchObject({
      block: 'b10',
      fields: { blockId: 'B10', cuttingPermit: 'CP 412' },
      comments: 'Block 10, 3 of 3',
    })
    expect(run.settings.block).toBe('')
  })

  it('words a series’ progress for Download', () => {
    expect(seriesProgressText({ done: 1, total: 4, page: 'Block 2' })).toBe('Making sheet 2 of 4: Block 2…')
    expect(seriesProgressText({ done: 4, total: 4, page: null })).toBe('Writing the file: 4 sheets…')
  })
})

describe('visual quality block sheet files', () => {
  const run = (settings: VisualsSheetSettings) => ({ settings, scene: threeBlocks(), office: {}, issue })
  const files = { jspdf: { jsPDF, GState } }

  it('writes one sheet as an editable SVG, keeping the drawn sheet to copy', async () => {
    const written = await writeVisualsSheet(run({ ...output({ format: 'svg' }), block: 'b2' }), { ...deps(), files })
    expect(written.fileName).toBe('block-2-general-access.svg')
    expect(written.blob.type).toBe('image/svg+xml')
    expect((await written.blob.text()).slice(0, 5)).toBe('<?xml')
    expect(written.sheet).toBeDefined()
    expect(written.previewOf).toBeUndefined()
  })

  it('dims the map outside the block only when asked', async () => {
    const dimmed = await writeVisualsSheet(run(output({ format: 'svg', mask: true })), { ...deps(), files })
    const even = await writeVisualsSheet(run(output({ format: 'svg' })), { ...deps(), files })
    expect(await dimmed.blob.text()).toContain(MASK_NOTE)
    expect(await even.blob.text()).not.toContain(MASK_NOTE)
  })

  it('writes a series as one PDF a page a block, reporting each sheet', async () => {
    const progress: string[] = []
    const written = await writeVisualsSheet(
      run(output({ series: true, blocks: ['b1', 'b10'] })),
      { ...deps(), files },
      { onProgress: (text) => progress.push(text) },
    )
    expect(written.fileName).toBe('visual-quality-block-sheets-general-access.pdf')
    expect((await PDFDocument.load(await written.blob.arrayBuffer())).getPageCount()).toBe(2)
    expect(written.sheet).toBeUndefined()
    expect(progress).toEqual([
      'Making sheet 1 of 2: Block 1…',
      'Making sheet 2 of 2: Block 10…',
      'Writing the file: 2 sheets…',
    ])
  })

  it('leaves a block whose sheet cannot be made out by name and writes the rest into the ZIP', async () => {
    let calls = 0
    const failing = deps({
      loadTerrain: async () => {
        calls += 1
        if (calls === 2) throw Error('offline')
        return { source: syntheticTerrain, missingTileCount: 0 }
      },
    })
    const written = await writeVisualsSheet(
      run({ ...output({ series: true, format: 'svg' }), kind: 'lidar-slope', scale: 10000 }),
      {
        ...failing,
        files,
      },
    )
    expect(written.fileName).toBe('visual-quality-block-sheets-lidar-slope.zip')
    const entries = unzipSync(new Uint8Array(await written.blob.arrayBuffer()))
    expect(Object.keys(entries)).toEqual(['1-Block-1.svg', '3-Block-10.svg', SERIES_NOTES_FILE])
    expect(strFromU8(entries[SERIES_NOTES_FILE])).toMatch(/^Block 2 left out: The terrain for this sheet did not load/)
    expect(written.notes[0]).toMatch(/^Block 2 left out: .*\.$/)
  })

  it('previews a series by its first sheet, as the series writes it, and says so', async () => {
    const written = await writeVisualsSheet(
      run(output({ series: true, format: 'png', order: 'name', blocks: ['b10', 'b2'] })),
      {
        ...deps(),
        files: { rasterise: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) },
      },
      { preview: true },
    )
    expect(written.blob.type).toBe('image/png')
    expect(written.fileName).toBe('visual-quality-block-sheets-general-access.zip')
    expect(written.previewOf).toBe(
      'The first sheet of 2, Block 2, as the series writes it. Download makes every sheet and writes a ZIP of 2 PNG files.',
    )
  })

  it('refuses a series with no block left before reading anything', async () => {
    let reads = 0
    const counting = deps({
      loadTerrain: async () => {
        reads += 1
        return { source: syntheticTerrain, missingTileCount: 0 }
      },
    })
    await expect(
      writeVisualsSheet(run(output({ series: true, blocks: ['gone'] })), { ...counting, files }),
    ).rejects.toThrow(/no longer in the scene/)
    expect(reads).toBe(0)
  })
})
