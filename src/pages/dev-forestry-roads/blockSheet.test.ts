import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { syntheticTerrain } from '@/lib/forestry/blockSheet/blockSheetFixtures'
import { INVALID_INPUT_RULES, STAMPED_EXPORTS } from './exportCatalog'
import {
  blockChoices,
  blockSheetFile,
  blockSheetLayers,
  blockSheetSeries,
  blockSheetUnavailable,
  buildBlockSheet,
  canopySurfaceId,
  changeBlockSheetSettings,
  DEFAULT_BLOCK_SHEET,
  firstSeriesPage,
  parseBlockSheetSettings,
  seriesBlocks,
  seriesPageRun,
  offersContoursBeyond,
  sheetContourSource,
  type BlockSheetRun,
} from './blockSheet'
import { createDemoProject } from './terrain'
import type { ContextFeature, RoadProject } from './types'

const square = (lng: number, lat: number, d = 0.002): GeoJSON.Polygon => ({
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

function project(): RoadProject {
  const base = createDemoProject()
  const [lng, lat] = base.alignments[0].points[0].coordinate
  const context: ContextFeature[] = [
    { id: 'b1', name: 'Block 1', kind: 'harvest', geometry: square(lng, lat) },
    { id: 'b2', name: 'Block 2', kind: 'harvest', geometry: square(lng + 0.004, lat) },
    { id: 'a1', name: 'Wet area', kind: 'avoid', geometry: square(lng - 0.004, lat) },
    {
      id: 's1',
      name: 'Creek',
      kind: 'stream',
      geometry: {
        type: 'LineString',
        coordinates: [
          [lng, lat],
          [lng + 0.01, lat + 0.01],
        ],
      },
      streamAssessment: {
        channelWidthM: null,
        fish: 'unresolved',
        communityWatershed: 'unresolved',
        importedClass: 'ncd',
      },
    },
    {
      id: 'r1',
      name: 'Main FSR',
      kind: 'existing-road',
      geometry: {
        type: 'LineString',
        coordinates: [
          [lng, lat - 0.002],
          [lng + 0.01, lat - 0.002],
        ],
      },
      roadEvidence: {
        source: 'user',
        roadClass: 'fsr',
        condition: 'unknown',
        conditionBasis: 'unreviewed',
        reuseAllowed: false,
      },
    },
  ]
  return {
    ...base,
    context,
    notes: [
      {
        id: 'n1',
        kind: 'line',
        points: [
          [lng, lat],
          [lng + 0.001, lat + 0.001],
        ],
        text: 'Recce',
        color: '#e11d48',
        arrow: true,
        createdAt: '2026-11-10T00:00:00Z',
      },
    ],
  }
}

describe('road tool block sheet', () => {
  it('offers harvest areas as blocks and draws the others as other blocks', () => {
    const p = project()
    expect(blockChoices(p).map((choice) => choice.value)).toEqual(['context:b1', 'context:b2'])
    const layers = blockSheetLayers(p, new Map(), 'context:b1')
    expect(layers.block?.name).toBe('Block 1')
    expect(layers.otherBlocks).toHaveLength(1)
    expect(layers.constraints).toHaveLength(1)
    expect(layers.streams?.[0].ncd).toBe(true)
    expect(layers.existingRoads?.[0]).toMatchObject({ forestService: true, name: 'Main FSR' })
    expect(layers.roads).toHaveLength(p.alignments.length)
    expect(layers.notes?.[0].head).toHaveLength(3)
  })

  it('crosses a deactivated mapped road, as the plan does with sheet symbols on', () => {
    const p = project()
    const road = p.context.find((feature) => feature.id === 'r1')!
    road.roadEvidence = { ...road.roadEvidence!, deactivation: { status: 'deactivated' } as never }
    expect(blockSheetLayers(p, new Map(), '').existingRoads?.[0]).toMatchObject({ deactivated: true })
    expect(blockSheetLayers(project(), new Map(), '').existingRoads?.[0].deactivated).toBe(false)
  })

  it('needs a canopy surface for the canopy height sheet and finds one by name', () => {
    expect(blockSheetUnavailable('lidar-canopy-height', { terrain: syntheticTerrain })).toMatch(/canopy height grid/)
    expect(blockSheetUnavailable('lidar-slope', {})).toMatch(/terrain/)
    expect(blockSheetUnavailable('field-layout', {})).toBeNull()
    expect(
      canopySurfaceId([
        { id: 'dsm', name: 'First return DSM' },
        { id: 'c', name: 'CHM 2025' },
      ]),
    ).toBe('c')
  })

  it('reads stored settings defensively', () => {
    expect(parseBlockSheetSettings(null)).toEqual(DEFAULT_BLOCK_SHEET)
    expect(
      parseBlockSheetSettings({ kind: 'nope', paper: 'a3', scale: 'fit', fields: { blockId: 'B1', bad: 'x' } }),
    ).toEqual({
      ...DEFAULT_BLOCK_SHEET,
      paper: 'a3',
      scale: 'fit',
      fields: { blockId: 'B1' },
    })
    expect(parseBlockSheetSettings({ scale: 10_000_000 }).scale).toBe(10000)
  })

  it('starts a newly picked sheet at its own default scale and keeps a scale picked for the same sheet', () => {
    const field = { ...DEFAULT_BLOCK_SHEET, scale: 20000 }
    expect(changeBlockSheetSettings(field, { ...field, kind: 'general-access' }).scale).toBe(50000)
    expect(changeBlockSheetSettings({ ...field, kind: 'general-access', scale: 50000 }, field).scale).toBe(10000)
    expect(changeBlockSheetSettings(field, { ...field, scale: 'fit' }).scale).toBe('fit')
  })

  it('is a stamped document under the invalid-input rules', () => {
    expect(INVALID_INPUT_RULES['block-sheet-pdf']).toBe('stamp')
    expect(STAMPED_EXPORTS).toContain('block-sheet-pdf')
  })

  it('starts the operating plan on its native paper and keeps subsequent paper edits', () => {
    const selected = changeBlockSheetSettings(DEFAULT_BLOCK_SHEET, {
      ...DEFAULT_BLOCK_SHEET,
      kind: 'operating-plan',
    })
    expect(selected).toMatchObject({ kind: 'operating-plan', paper: '36x29', scale: 20000 })
    expect(parseBlockSheetSettings(JSON.parse(JSON.stringify(selected)))).toEqual(selected)
    const resized = changeBlockSheetSettings(selected, { ...selected, paper: 'a3', scale: 'fit' })
    expect(resized).toMatchObject({ paper: 'a3', scale: 'fit' })
    // Existing presets still keep the chosen paper when switched to.
    expect(changeBlockSheetSettings(resized, { ...resized, kind: 'field-layout' })).toMatchObject({
      kind: 'field-layout',
      paper: 'a3',
      scale: 10000,
    })
  })

  it('draws the style library’s symbols only when the sheet’s map style asks for them', async () => {
    const creek = { kind: 'line' as const, label: 'Office creek', layers: [{ color: '#0044aa', width: 1.4 }] }
    const run = {
      settings: { ...DEFAULT_BLOCK_SHEET, block: 'context:b1' },
      project: project(),
      analyses: new Map(),
      terrain: null,
      terrainName: 'none',
      terrainResolutionM: 1,
      canopy: null,
      issue: { date: '2026-11-10', preparedBy: '', organisation: '', revision: '' },
      caveat: 'Preliminary',
      preview: true,
      // The project's stream is an NCD reach, so the library's NCD style is the one that applies.
      librarySymbols: { ncd: creek, culvert: creek },
    }
    const labels = async (settings: typeof run.settings) =>
      (await buildBlockSheet({ ...run, settings })).sheet.legend.map((item) => item.symbol.label)
    expect(await labels(run.settings)).not.toContain('Office creek')
    expect(await labels({ ...run.settings, symbols: 'library' })).toContain('Office creek')
    expect(parseBlockSheetSettings({ symbols: 'library' }).symbols).toBe('library')
    expect(parseBlockSheetSettings({ symbols: 'other' }).symbols).toBe('pgmaps')
    expect(parseBlockSheetSettings({}).symbols).toBe('pgmaps')
  })

  it('builds a field layout sheet for the demo project', async () => {
    const p = project()
    const built = await buildBlockSheet({
      settings: { ...DEFAULT_BLOCK_SHEET, block: 'context:b1' },
      project: p,
      analyses: new Map(),
      terrain: null,
      terrainName: 'none',
      terrainResolutionM: 1,
      canopy: null,
      issue: { date: '2026-11-10', preparedBy: '', organisation: '', revision: '' },
      caveat: 'Preliminary',
      preview: true,
    })
    expect(built.facts?.areaHa).toBeGreaterThan(0)
    expect(built.missing.join(' ')).toMatch(/no contours/)
    expect(built.sheet.legend.map((item) => item.key)).toContain('block')
  })

  it('leaves a layer switched off out of the map and the legend, and keeps the frame', async () => {
    const run = {
      settings: { ...DEFAULT_BLOCK_SHEET, block: 'context:b1' },
      project: project(),
      analyses: new Map(),
      terrain: syntheticTerrain,
      terrainName: 'Synthetic',
      terrainResolutionM: 5,
      canopy: null,
      issue: { date: '2026-11-10', preparedBy: '', organisation: '', revision: '' },
      caveat: 'Preliminary',
      preview: true,
    }
    const all = await buildBlockSheet(run)
    const keys = (built: typeof all) => built.sheet.legend.map((item) => item.key)
    expect(keys(all)).toEqual(expect.arrayContaining(['otherBlocks', 'constraints', 'ncd', 'forestService']))
    const hidden = await buildBlockSheet({
      ...run,
      settings: { ...run.settings, hiddenLayers: ['otherBlocks', 'streams', 'existingRoads', 'contours'] },
    })
    for (const key of ['otherBlocks', 'streams', 'ncd', 'existingRoads', 'forestService', 'contourIndex'])
      expect(keys(hidden)).not.toContain(key)
    expect(keys(hidden)).toEqual(expect.arrayContaining(['block', 'constraints']))
    // The same frame: the graticule's labels fall in the same places.
    const ticks = (built: typeof all) =>
      built.sheet.ops.flatMap((op) => (op.op === 'text' && op.text.includes('°') ? [[op.text, op.x, op.y]] : []))
    expect(ticks(hidden)).toEqual(ticks(all))
    expect(ticks(all).length).toBeGreaterThan(0)
    expect(parseBlockSheetSettings({ hiddenLayers: ['streams', 'nope', 'streams', 'contours'] }).hiddenLayers).toEqual([
      'contours',
      'streams',
    ])
    expect(parseBlockSheetSettings({}).hiddenLayers).toEqual([])
  })
})

describe('block sheet formats and series', () => {
  const run = (output: Partial<typeof DEFAULT_BLOCK_SHEET.output> = {}): BlockSheetRun => ({
    settings: {
      ...DEFAULT_BLOCK_SHEET,
      block: 'context:b1',
      fields: { blockId: '{name} ({page} of {total})' },
      comments: 'Access to {name}',
      output: { ...DEFAULT_BLOCK_SHEET.output, ...output },
    },
    project: project(),
    analyses: new Map(),
    terrain: null,
    terrainName: 'none',
    terrainResolutionM: 1,
    canopy: null,
    issue: { date: '2026-11-10', preparedBy: '', organisation: '', revision: '' },
    caveat: 'Preliminary',
    preview: true,
  })

  it('reads output settings stored before there were any as one PDF sheet', () => {
    expect(parseBlockSheetSettings({ kind: 'field-layout' }).output).toEqual(DEFAULT_BLOCK_SHEET.output)
    expect(DEFAULT_BLOCK_SHEET.output).toMatchObject({ format: 'pdf', series: false, mask: false })
    expect(
      parseBlockSheetSettings({ output: { format: 'svg', series: true, blocks: ['context:b2'] } }).output,
    ).toMatchObject({ format: 'svg', series: true, blocks: ['context:b2'] })
  })

  it('lists the sheet’s own blocks for a series and fills each page’s tokens', () => {
    const p = project()
    expect(seriesBlocks(p).map((block) => [block.id, block.name])).toEqual([
      ['context:b1', 'Block 1'],
      ['context:b2', 'Block 2'],
    ])
    const { page, total } = firstSeriesPage(seriesBlocks(p), { ...DEFAULT_BLOCK_SHEET.output, order: 'name' })
    expect(total).toBe(2)
    const second = { ...page, block: seriesBlocks(p)[1], id: 'context:b2', name: 'Block 2', number: 2 }
    expect(seriesPageRun(run(), second).settings).toMatchObject({
      block: 'context:b2',
      fields: { blockId: 'Block 2 (2 of 2)' },
      comments: 'Access to Block 2',
    })
    expect(() => firstSeriesPage(seriesBlocks(p), { ...DEFAULT_BLOCK_SHEET.output, blocks: [] })).toThrow(
      /at least one block/,
    )
  })

  it('writes one sheet as an SVG with its text kept as text, and its fields as typed', async () => {
    const { blob } = await blockSheetFile(run(), 'svg', {})
    expect(blob.type).toBe('image/svg+xml')
    const svg = await blob.text()
    expect(svg).toMatch(/^<\?xml/)
    expect(svg).toContain('<title>Block 1</title>')
    // Tokens fill only in a series: one sheet prints what was typed, as it always did.
    expect(svg).toContain('{name} ({page} of {total})')
  })

  it('writes one sheet a block, each framed on its block, in a ZIP named by the pattern', async () => {
    const result = await blockSheetSeries(
      run({ series: true, format: 'svg', bundle: 'zip' }),
      seriesBlocks(project()),
      {
        deps: {},
      },
    )
    expect(result).toMatchObject({ container: 'zip', written: 2, leftOut: [] })
    const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()))
    const names = Object.keys(files).filter((name) => name !== 'notes.txt')
    expect(names).toEqual(['1-Block-1.svg', '2-Block-2.svg'])
    expect(strFromU8(files['2-Block-2.svg'])).toContain('Block 2 (2 of 2)')
    // Every page here is drawn without contours, and the notes say so page by page.
    expect(result.notes.some((note) => /^Block 2: .*no contours/.test(note))).toBe(true)
  })
})

describe('sheet contour source', () => {
  const frame: [number, number, number, number] = [-121.66, 54.0, -121.38, 54.15]
  it('uses the project terrain when it covers the frame', () => {
    expect(sheetContourSource({ kind: 'regional', bounds: [-122, 53.9, -121, 54.3] }, frame, 50000)).toBe('project')
  })
  it('loads regional terrain for the frame when the project terrain only covers the roads', () => {
    expect(
      sheetContourSource({ kind: 'regional', bounds: [-121.5575, 54.0504, -121.511, 54.0891] }, frame, 10000),
    ).toBe('regional-frame')
  })
  it('loads regional terrain for an overview sheet even over detailed terrain', () => {
    expect(sheetContourSource({ kind: 'geotiff', bounds: [-121.56, 54.05, -121.51, 54.09] }, frame, 50000)).toBe(
      'regional-frame',
    )
  })
  it('never swaps detailed terrain for regional contours on a design-scale sheet', () => {
    expect(sheetContourSource({ kind: 'geotiff', bounds: [-121.56, 54.05, -121.51, 54.09] }, frame, 10000)).toBe(
      'project',
    )
    expect(sheetContourSource({ kind: 'geotiff' }, frame, 10000)).toBe('project')
  })
  it('adds regional contours beyond detailed terrain only when the person chose it', () => {
    const lidar = { kind: 'geotiff', bounds: [-121.56, 54.05, -121.51, 54.09] }
    expect(sheetContourSource(lidar, frame, 10000, 'stop')).toBe('project')
    expect(sheetContourSource(lidar, frame, 10000, 'regional')).toBe('regional-beyond')
    // An overview, a regional project and a covering terrain keep what they did.
    expect(sheetContourSource(lidar, frame, 50000, 'regional')).toBe('regional-frame')
    expect(sheetContourSource({ ...lidar, kind: 'regional' }, frame, 10000, 'regional')).toBe('regional-frame')
    expect(sheetContourSource({ kind: 'geotiff', bounds: [-122, 53.9, -121, 54.3] }, frame, 10000, 'regional')).toBe(
      'project',
    )
  })
  it('offers the choice on contour sheets over terrain that is not regional', () => {
    expect(offersContoursBeyond('field-layout', { kind: 'geotiff' })).toBe(true)
    expect(offersContoursBeyond('field-layout', { kind: 'regional' })).toBe(false)
    expect(offersContoursBeyond('field-layout', null)).toBe(false)
  })
  it('reads the choice back from storage, stopping at the edge by default', () => {
    expect(parseBlockSheetSettings({}).contoursBeyond).toBe('stop')
    expect(parseBlockSheetSettings({ contoursBeyond: 'regional' }).contoursBeyond).toBe('regional')
    expect(parseBlockSheetSettings({ contoursBeyond: 'everywhere' }).contoursBeyond).toBe('stop')
  })
})
