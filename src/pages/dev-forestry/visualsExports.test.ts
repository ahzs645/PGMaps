import { describe, expect, it } from 'vitest'

import { createEmptyScene, createSampleScene, type ForestryScene } from './scene'
import { findSceneLandform } from './sceneInput'
import { createViewOfInterestId, viewCaptureKey, type ViewOfInterest } from './viewsOfInterest'
import { REPORT_RECIPES, recipeFormat } from './viaReport/recipes'
import { VIA_DOCUMENT_FORMATS } from './viaDocument/formats'
import { DEFAULT_VISUALS_SHEET, visualsSheetSummary } from './visualsBlockSheet'
import { DEFAULT_ROAD_VIDEO_SETTINGS, planRoadVideo, type RoadVideoScene } from './roadVideo'
import {
  beforeToCapture,
  buildExportContext,
  documentFigureLine,
  excludedForBlock,
  packageSummary,
  unprintedViews,
  viewsLeftOut,
  resolvePackage,
  savedIdentity,
  uncapturedNote,
  viewsToCapture,
  type ExportPlannedView,
  exportContents,
  exportEditorId,
  exportPreparation,
  OPEN_PACKAGE_ACTION,
  READS_INVENTORY,
  rendererMissing,
  exportUnavailable,
  exportFileType,
  findVisualsExport,
  RUNS_ON_EXPORT,
  suggestedExportName,
  VISUALS_EXPORTS,
  type ContextInput,
  type ContextView,
  type ExportSection,
} from './visualsExports'

const view = (id: string, overrides: Partial<ContextView> = {}): ContextView => ({
  view: {
    id,
    name: `View from the road going north ${id}`,
    positionMeters: 1250,
    harvestPhase: 'after',
    treeHeightMeters: 24,
    roadClearWidthMeters: 18,
    lookAtTargetId: null,
    lookBearing: 40,
  },
  here: true,
  screenshot: true,
  classPass: true,
  settings: [
    { label: 'Position', value: '1.25 km along Hwy 16' },
    { label: 'Lens', value: '27° vertical field of view' },
  ],
  ...overrides,
})

function input(scene: ForestryScene, overrides: Partial<ContextInput> = {}): ContextInput {
  return {
    scene,
    result: null,
    stale: false,
    assessment: null,
    views: [],
    fs1252: { selected: [], reviews: {} },
    blockNote: null,
    noteFigures: false,
    figure: { viewId: null, style: 'Analysis sheet', labelStyle: 'Box', cameraInfo: false, paintBlocks: true },
    document: null,
    report: null,
    logo: 'None',
    renderer: {
      id: 'pgmaps',
      label: 'PGMaps',
      missing: 0,
      views: 0,
      running: false,
      left: null,
      measured: false,
      failed: null,
      unavailable: null,
    },
    brief: { blockId: null, viewpoints: 0 },
    evidence: { loaded: true, gaps: [], counts: { views: 0, runs: 0, fields: 0 } },
    roadViewReady: false,
    officeFieldCount: 14,
    autoRun: { blocker: 'Draw or import the road in step 1 first.', status: 'idle', progress: null, error: null },
    landChecks: { include: true, pending: 0, rows: [] },
    inventory: { status: 'idle', error: null, blockName: null, candidates: [] },
    ...overrides,
  }
}

const rowValue = (sections: ExportSection[], title: string, label: string) =>
  sections.find((section) => section.title === title)?.rows?.find((row) => row.label === label)?.value

describe('visual-quality exports', () => {
  it('lists every output once, each with a format', () => {
    const kinds = VISUALS_EXPORTS.map((item) => item.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    for (const item of VISUALS_EXPORTS) expect(item.formats.length).toBeGreaterThan(0)
  })

  it('offers the VIA report as Word and as a PDF from the Word layout, its own PDF still first', () => {
    const report = VISUALS_EXPORTS.find((item) => item.kind === 'via-report')!
    expect(report.formats.map((format) => format.id)).toEqual(['pdf', 'docx', 'docx-pdf', 'html', 'md'])
    expect(report.formats.find((format) => format.id === 'docx')).toMatchObject({ label: 'Word', extension: '.docx' })
    expect(report.formats.find((format) => format.id === 'docx-pdf')!.extension).toBe('.pdf')
    // Every output's format ids are its own, once each.
    for (const item of VISUALS_EXPORTS)
      expect(new Set(item.formats.map((format) => format.id)).size, item.kind).toBe(item.formats.length)
  })

  it('lists the block map sheet from the sheet as chosen, and waits for nothing before writing it', () => {
    const empty = buildExportContext(input(createEmptyScene()))
    expect(exportUnavailable('block-sheet', empty)).toMatch(/Add a cutblock/)
    const scene = createSampleScene()
    const sheetScene = {
      targets: scene.targets,
      masks: scene.masks ?? [],
      viewpoint: scene.viewpoint,
      views: [],
    }
    const summary = visualsSheetSummary(sheetScene, { ...DEFAULT_VISUALS_SHEET, kind: 'lidar-hillshade' })!
    const ctx = buildExportContext(input(scene, { blockSheet: summary, logo: 'Your logo, mark.png' }))
    expect(exportUnavailable('block-sheet', ctx)).toBeNull()
    const sections = exportContents('block-sheet', ctx)
    expect(rowValue(sections, 'Sheet', 'Sheet')).toBe('Design Hillshade')
    expect(rowValue(sections, 'Sheet', 'Map style')).toBe('PGMaps sheet symbols')
    expect(rowValue(sections, 'Sheet', 'Logo')).toBe('Your logo, mark.png')
    expect(sections.find((section) => section.title === 'On the map')?.rows?.[0].label).toBe('Block of interest')
    // A map of the scene: it neither runs the assessment nor captures a view first.
    expect(exportPreparation('block-sheet', ctx)).toMatchObject({ run: false, capture: [], render: false, note: null })
    // The canopy height sheet needs a grid this page does not load.
    const canopy = visualsSheetSummary(sheetScene, { ...DEFAULT_VISUALS_SHEET, kind: 'lidar-canopy-height' })!
    expect(exportUnavailable('block-sheet', buildExportContext(input(scene, { blockSheet: canopy })))).toMatch(
      /canopy height grid/,
    )
  })

  it('writes the block map sheet as PDF first, SVG or PNG, and lists the file it writes', () => {
    const item = VISUALS_EXPORTS.find((entry) => entry.kind === 'block-sheet')!
    expect(item.formats.map((format) => [format.id, format.extension])).toEqual([
      ['pdf', '.pdf'],
      ['svg', '.svg'],
      ['png', '.png'],
    ])
    expect(exportFileType(item, item.formats[1])).toMatchObject({ mime: 'image/svg+xml', extension: '.svg' })
    // A made-up scene of two blocks, written as a series.
    const square = (lng: number): GeoJSON.Polygon => ({
      type: 'Polygon',
      coordinates: [
        [
          [lng, 54],
          [lng + 0.004, 54],
          [lng + 0.004, 54.004],
          [lng, 54],
        ],
      ],
    })
    const sheetScene = {
      targets: [
        { id: 'n', name: 'North', role: 'block' as const, geometry: square(-122.5) },
        { id: 's', name: 'South', role: 'block' as const, geometry: square(-122.49) },
      ],
      masks: [],
      viewpoint: { name: 'Road', mode: 'spot' as const, coordinates: [[-122.51, 54]] as [number, number][] },
      views: [],
    }
    const settings = {
      ...DEFAULT_VISUALS_SHEET,
      output: { ...DEFAULT_VISUALS_SHEET.output, series: true, format: 'svg' as const, mask: true },
    }
    const ctx = buildExportContext(
      input(createSampleScene(), { blockSheet: visualsSheetSummary(sheetScene, settings)! }),
    )
    const sections = exportContents('block-sheet', ctx)
    expect(rowValue(sections, 'Sheet', 'Block')).toBe('Each chosen block on its own sheet (2 of 2)')
    expect(rowValue(sections, 'File', 'Written as')).toBe('A ZIP of 2 SVG files, one a block')
    expect(rowValue(sections, 'File', 'Blocks, in order')).toBe('North, South')
    expect(rowValue(sections, 'File', 'Outside the block')).toMatch(/^Dimmed/)
    expect(sections.find((section) => section.title === 'File')?.note).toMatch(/Inkscape/)
    expect(exportUnavailable('block-sheet', ctx)).toBeNull()
    // Every chosen block gone from the scene: nothing to write, and the dialog says why.
    const gone = visualsSheetSummary(sheetScene, { ...settings, output: { ...settings.output, blocks: ['old'] } })!
    expect(
      exportUnavailable('block-sheet', buildExportContext(input(createSampleScene(), { blockSheet: gone }))),
    ).toMatch(/no longer in the scene/)
  })

  it('says why a document cannot be written before there is a block, a run or a saved view', () => {
    const ctx = buildExportContext(input(createEmptyScene()))
    expect(exportUnavailable('block-note', ctx)).toMatch(/cutblock/)
    expect(exportUnavailable('fs1252', ctx)).toMatch(/Run the visibility assessment/)
    for (const kind of ['analysis-sheet', 'via-document', 'via-report'] as const)
      expect(exportUnavailable(kind, ctx)).toMatch(/^Add a view of interest in step 2, or save one in the road view/)
    expect(exportUnavailable('worksheet', ctx)).toMatch(/Run the visibility assessment/)
    expect(exportUnavailable('scene-package', ctx)).toMatch(/road view/)
    // A scene can always be saved.
    expect(exportUnavailable('scene', ctx)).toBeNull()
    expect(exportUnavailable('views', ctx)).toBeNull()
  })

  it('shows what the VIA document is filled from, as the file is', () => {
    const document = {
      format: 'Perspective report, landform net of private land',
      sources: '22',
      formula: '(NonVEG + Prop. Blk) / (LF - PL) (landform net of private land, 2 dp)',
      scale: 'Size and scale terms (consultant reports)',
      images: ['Perspective viewpoint (unannotated render)', 'Perspective viewpoint analysis'],
      viewpoints: [{ name: 'Lakeshore', figure: '1.14% · Small' }],
      toComplete: 6,
      gaps: [],
    }
    const ctx = buildExportContext(input(createEmptyScene(), { document }))
    expect(exportUnavailable('via-document', ctx)).toBeNull()
    const sections = exportContents('via-document', ctx)
    expect(rowValue(sections, 'Format', 'Percent alteration')).toBe(document.formula)
    expect(sections.find((section) => section.title === 'Viewpoints')?.items?.[0]).toEqual({
      title: 'Lakeshore',
      subtitle: '1.14% · Small',
    })
    expect(rowValue(sections, 'Reviewer to complete', 'Sentences and cells')).toBe('6 items')
  })

  it('waits for another engine’s background renders before the figures, saying how long, and not for PGMaps', () => {
    const renderer = {
      id: 'worldgen' as const,
      label: 'threejs-worldgen',
      missing: 2,
      views: 3,
      running: false,
      left: 'about 4 min',
      measured: false,
      failed: null,
      unavailable: null,
    }
    const ctx = buildExportContext(input(createEmptyScene(), { renderer }))
    const waiting = exportPreparation('via-report', ctx)
    expect(waiting.render).toBe(true)
    expect(waiting.note).toBe(
      'threejs-worldgen draws 2 saved views at final quality first, in the background: about 4 min (first estimate). Then the file is written.',
    )
    const running = exportPreparation('analysis-sheet', {
      ...ctx,
      renderer: { ...renderer, running: true, measured: true },
    })
    expect(running.note).toMatch(/1 of 3 done, about 4 min left/)
    // Outputs not drawn from the figures never wait, and neither does PGMaps' own drawing.
    expect(exportPreparation('fs1252', ctx).render).toBe(false)
    expect(exportPreparation('via-report', { ...ctx, renderer: { ...renderer, id: 'pgmaps' } }).render).toBe(false)
    // An engine that cannot draw here says why instead of waiting.
    const blocked = buildExportContext(
      input(createEmptyScene(), {
        renderer: { ...renderer, unavailable: 'Needs WebGPU, which this browser does not offer.' },
      }),
    )
    expect(exportUnavailable('via-report', blocked)).toBe(
      'threejs-worldgen cannot draw the figures: Needs WebGPU, which this browser does not offer.',
    )
  })

  it('makes only the VIA report wait for the before pictures by the same engine', () => {
    const renderer = {
      id: 'nanite' as const,
      label: 'Nanite Forest',
      missing: 0,
      views: 2,
      running: false,
      left: null,
      measured: true,
      failed: null,
      unavailable: null,
      missingBefore: 2,
      leftWithBefore: 'about 2 min',
    }
    const ctx = buildExportContext(input(createEmptyScene(), { renderer }))
    expect(rendererMissing('via-report', ctx.renderer)).toBe(2)
    expect(rendererMissing('analysis-sheet', ctx.renderer)).toBe(0)
    expect(rendererMissing('via-report', { ...ctx.renderer, id: 'pgmaps' })).toBe(0)
    // The sheet and the document print no before picture: nothing to wait for.
    expect(exportPreparation('analysis-sheet', ctx).render).toBe(false)
    expect(exportPreparation('via-document', ctx).render).toBe(false)
    const report = exportPreparation('via-report', ctx)
    expect(report.render).toBe(true)
    expect(report.note).toBe(
      'Nanite Forest draws 2 before pictures at final quality first, in the background: about 2 min (from your renders). Then the file is written.',
    )
  })

  it('shows the VIA report’s structure, its logo and what is left to complete', () => {
    const report = {
      recipe: '2022 handbook report with Appendix 1',
      sources: '06, 07',
      parts: ['cover', 'appendix 1'],
      figures: 2,
      toComplete: 3,
    }
    const ctx = buildExportContext(input(createEmptyScene(), { report, logo: 'Your logo, mine.png' }))
    expect(exportUnavailable('via-report', ctx)).toBeNull()
    const sections = exportContents('via-report', ctx)
    expect(rowValue(sections, 'Report', 'Logo')).toBe('Your logo, mine.png')
    expect(rowValue(sections, 'Report', 'Figures')).toBe('2 saved views')
    expect(sections.find((section) => section.title === 'Parts, in order')?.items?.map((item) => item.title)).toEqual([
      'cover',
      'appendix 1',
    ])
    expect(rowValue(sections, 'To complete before signing', 'Items')).toBe('3 items')
  })

  it('says what the VIA report follows and where to add a view before there is anything to draw', () => {
    const reportRecipe = { name: 'Design rationale with district summary table', sources: '02' }
    const ctx = buildExportContext(input(createEmptyScene(), { reportRecipe }))
    const sections = exportContents('via-report', ctx)
    expect(rowValue(sections, 'Report', 'Structure of')).toBe(
      'Design rationale with district summary table (reference document 02), following the VIA document’s format',
    )
    expect(rowValue(sections, 'Report', 'Figures')).toBe('None yet')
    expect(sections.find((section) => section.title === 'Report')?.note).toMatch(/Add a view of interest in step 2/)
    // A view is placed on the plan map, so with none planned the part opens its step, not an editor.
    const views = sections.find((section) => section.title === 'Views of interest')
    expect(views?.step).toBe('visit')
    expect(views?.editor).toBeUndefined()
    expect(views?.empty).toMatch(/None planned/)
    // With the package's own recipe the row says so.
    const chosen = buildExportContext(input(createEmptyScene(), { reportRecipe, recipe: reportRecipe.name }))
    expect(rowValue(exportContents('via-report', chosen), 'Report', 'Structure of')).toMatch(/the package’s recipe$/)
  })

  it('names the editor of each part that a section of the sidebar sets', () => {
    const ctx = buildExportContext(input(createSampleScene()))
    const editorOf = (kind: Parameters<typeof exportContents>[0], title: string) =>
      exportContents(kind, ctx).find((section) => section.title === title)?.editor
    expect(editorOf('block-note', 'Block')).toBe('cutblocks')
    expect(editorOf('block-note', 'Landform')).toBe('landform')
    // Saved views that are not views of interest are chosen under Package; no sidebar section sets them.
    expect(editorOf('block-note', 'Viewpoints in the report')).toBeUndefined()
    expect(editorOf('scene', 'Viewpoint')).toBe('viewpoint')
    expect(editorOf('scene', 'Blocks')).toBe('cutblocks')
    expect(editorOf('worksheet', 'Run')).toBe('run')
    expect(editorOf('fs1252', 'Stations in the PDF')).toBe('assess')
    // Step 5 only opens Save & export: its parts are written in the dialog, so none points back at it.
    for (const entry of VISUALS_EXPORTS)
      for (const section of exportContents(entry.kind, ctx)) expect(section.step).not.toBe('rate')
    // The final rating is made in the package's entry.
    const review = exportContents('scene', ctx).find((section) => section.title === 'Review')
    expect(review?.action).toEqual({ id: OPEN_PACKAGE_ACTION, label: 'Rate in Package' })
    expect(exportEditorId('cutblocks')).not.toBe(exportEditorId('landform'))
  })

  it('withholds the FS1252 and the worksheet from a stale run', () => {
    const ctx = buildExportContext(input(createSampleScene(), { stale: true }))
    expect(ctx.run).toBe('stale')
    expect(exportUnavailable('fs1252', ctx)).toMatch(/out of date/)
    expect(exportUnavailable('worksheet', ctx)).toMatch(/out of date/)
  })

  it('names the chosen landform with its objective and area', () => {
    const scene = createSampleScene()
    const ctx = buildExportContext(input(scene))
    const landform = findSceneLandform(scene)
    expect(ctx.landform?.name).toBe(landform?.name)
    expect(ctx.landform?.objective).toMatch(/\((P|R|PR|M|MM)\)$/)
    expect(ctx.landform?.areaHa).toBeGreaterThan(0)
    const sections = exportContents('scene', ctx)
    expect(rowValue(sections, 'Landform', 'Name')).toBe(landform?.name)
    expect(sections.find((section) => section.title === 'Landform')?.step).toBe('identify')
  })

  it('lists the project attachments in the project file, with the way to manage them', () => {
    const attachments = [
      { name: 'case.json', bytes: 2048, linked: null },
      { name: 'IMG_1203.jpg', bytes: 3 * 1024 * 1024, linked: 'Field photo: Ridge' },
    ]
    const section = exportContents('project', buildExportContext(input(createSampleScene(), { attachments }))).find(
      (entry) => entry.title === 'Project attachments',
    )
    expect(section?.action).toEqual({ id: 'manage-attachments', label: 'Manage…' })
    expect(section?.items?.map((item) => item.title)).toEqual(['case.json', 'IMG_1203.jpg'])
    expect(section?.items?.[1].subtitle).toBe('3.0 MB · Field photo: Ridge')
    const none = exportContents('project', buildExportContext(input(createSampleScene()))).find(
      (entry) => entry.title === 'Project attachments',
    )
    expect(none?.items).toBeUndefined()
    expect(none?.empty).toMatch(/No files attached/)
  })

  it('lists each saved view with the settings it was saved with', () => {
    const ctx = buildExportContext(input(createSampleScene(), { views: [view('a'), view('b', { classPass: false })] }))
    const views = exportContents('block-note', ctx).find((section) => section.title === 'Viewpoints in the report')
    expect(views?.items).toHaveLength(2)
    expect(views?.items?.[0].subtitle).toContain('In the report as its screenshot')
    expect(views?.items?.[0].subtitle).toContain('1.25 km along')
    expect(views?.items?.[0].subtitle).toContain('after harvest')
    expect(views?.items?.[0].rows).toEqual(
      expect.arrayContaining([
        { label: 'Lens', value: '27° vertical field of view' },
        { label: 'Harvest phase', value: 'After harvest' },
      ]),
    )
  })

  it('puts the views left out of the block note after those that go in, and counts what goes in', () => {
    const ctx = buildExportContext(
      input(createSampleScene(), {
        views: [view('a', { inReport: false }), view('b'), view('c', { screenshot: false, classPass: false })],
      }),
    )
    const section = exportContents('block-note', ctx).find((entry) => entry.title === 'Viewpoints in the report')
    expect(section?.items?.map((item) => item.subtitle?.split(' · ')[0])).toEqual([
      'In the report as its screenshot',
      'Listed as missing: no screenshot',
      'Left out',
    ])
    expect(section?.note).toMatch(/^1 saved view in the report\. Choose which under Package/)
    expect(section?.note).toMatch(/never redrawn at export/)
  })

  it('offers to stand at each inventory viewpoint near the block, and to read them again after a failure', () => {
    const ready = buildExportContext(
      input(createSampleScene(), {
        inventory: {
          status: 'ready',
          error: null,
          blockName: 'Block A',
          candidates: [
            { key: 'vli:7', name: 'Tabor Lake pullout', kind: 'vli', distanceMeters: 2400, aims: true },
            { key: 'rec:2', name: 'Grizzly Den', kind: 'rec-site', distanceMeters: 5100, aims: false },
          ],
        },
      }),
    )
    const section = exportContents('block-note', ready).find(
      (entry) => entry.title === 'Inventory viewpoints near the block',
    )
    expect(section?.items?.[0]).toMatchObject({
      title: 'Tabor Lake pullout',
      action: { id: 'stand:vli:7', label: 'Stand here' },
    })
    expect(section?.items?.[0].subtitle).toBe('Inventory viewpoint · 2.4 km from the block · an arrow aims at it')
    expect(section?.items?.[1].subtitle).toBe('Recreation site · 5.1 km from the block')
    const failed = buildExportContext(
      input(createSampleScene(), {
        inventory: { status: 'error', error: 'DataBC viewpoints unavailable', blockName: 'Block A', candidates: [] },
      }),
    )
    const retry = exportContents('block-note', failed).find(
      (entry) => entry.title === 'Inventory viewpoints near the block',
    )
    expect(retry?.action).toEqual({ id: 'load-inventory', label: 'Try again' })
    expect(retry?.empty).toBe('DataBC viewpoints unavailable')
  })

  it('shows the land status checks the note prints, a reading layer as checking, and none when left out', () => {
    const rows = [
      {
        label: 'Private land',
        value: '2.1 ha in Block A',
        note: 'Block A: 2.1 ha over Lot 4.',
        review: true,
        reading: false,
      },
      { label: 'Park or protected area', value: 'Not read', note: 'Still reading.', review: true, reading: true },
    ]
    const ctx = buildExportContext(input(createSampleScene(), { landChecks: { include: true, pending: 1, rows } }))
    const sections = exportContents('block-note', ctx)
    expect(rowValue(sections, 'Land status checks', 'Private land')).toBe('2.1 ha in Block A')
    expect(rowValue(sections, 'Land status checks', 'Park or protected area')).toBe('Checking…')
    expect(sections.find((entry) => entry.title === 'Land status checks')?.note).toMatch(/not|never a legal/)
    const off = buildExportContext(input(createSampleScene(), { landChecks: { include: false, pending: 1, rows } }))
    const offSection = exportContents('block-note', off).find((entry) => entry.title === 'Land status checks')
    expect(offSection?.rows).toBeUndefined()
    expect(exportPreparation('block-note', off).landChecks).toBe(false)
    expect(exportPreparation('block-note', ctx)).toMatchObject({ run: false, landChecks: true })
  })

  it('runs the assessment on export for the outputs that read it, rather than withholding them', () => {
    const runnable = { blocker: null, status: 'idle' as const, progress: null, error: null }
    const none = buildExportContext(input(createSampleScene(), { autoRun: runnable }))
    expect(exportUnavailable('fs1252', none)).toBeNull()
    expect(exportUnavailable('worksheet', none)).toBeNull()
    for (const kind of ['block-note', 'fs1252', 'field-brief', 'worksheet'] as const)
      expect(exportPreparation(kind, none).run).toBe(true)
    expect(exportPreparation('scene', none).run).toBe(false)
    expect(exportPreparation('fs1252', none).note).toMatch(/^Not run yet: the export runs the assessment first/)
    const stale = buildExportContext(input(createSampleScene(), { stale: true, autoRun: runnable }))
    expect(exportPreparation('worksheet', stale).note).toMatch(/^The run is out of date: the export runs/)
    const running = buildExportContext(
      input(createSampleScene(), {
        autoRun: { ...runnable, status: 'running', progress: 'tracing sightlines, 40%' },
      }),
    )
    expect(exportPreparation('block-note', running).note).toBe(
      'Running the visibility assessment · tracing sightlines, 40%. The file is written when it finishes.',
    )
  })

  it('writes the Castor constraint from the run, starting it on export, and needs a landform', () => {
    expect(exportUnavailable('castor-constraint', buildExportContext(input(createEmptyScene())))).toMatch(/landform/)
    const runnable = { blocker: null, status: 'idle' as const, progress: null, error: null }
    const ctx = buildExportContext(input(createSampleScene(), { autoRun: runnable }))
    expect(exportUnavailable('castor-constraint', ctx)).toBeNull()
    expect(exportPreparation('castor-constraint', ctx).run).toBe(true)
    const sections = exportContents('castor-constraint', ctx)
    expect(rowValue(sections, 'Constraint', 'Zone column')).toBe('zone:vqo')
    expect(rowValue(sections, 'Constraint', 'Green-up height')).toBe('From the run')
    expect(sections.find((section) => section.title === 'Constraint')?.note).toMatch(/whole area/)
    expect(VISUALS_EXPORTS.find((item) => item.kind === 'castor-constraint')?.group).toBe('exchange')
  })

  it('offers to open the road view for the 3D scene', () => {
    const ctx = buildExportContext(input(createSampleScene()))
    const section = exportContents('scene-package', ctx).find((entry) => entry.title === 'Road view')
    expect(section?.action).toEqual({ id: 'open-road-view', label: 'Open the road view' })
  })

  it('offers the 3D scene as JSON first, then as a glTF, OBJ or STL model, a simplified drawing', () => {
    const item = findVisualsExport('scene-package')
    expect(item.formats.map((format) => [format.id, format.extension])).toEqual([
      ['json', '.json'],
      ['glb', '.glb'],
      ['obj', '.zip'],
      ['stl', '.stl'],
    ])
    expect(item.description).toMatch(/simplified drawing with generated low-polygon trees\. Display only\./)
    const ctx = buildExportContext(input(createSampleScene()))
    expect(exportUnavailable('scene-package', ctx)).toMatch(/Open the road view/)
    expect(exportContents('scene-package', ctx).find((entry) => entry.title === 'As a 3D model')?.note).toMatch(
      /notes shown with the file/,
    )
  })

  it('writes the scene for GIS from the scene alone: its layers counted, no run, nothing staled', () => {
    const item = findVisualsExport('scene-gis')
    expect(item.group).toBe('exchange')
    expect(item.formats.map((format) => format.id)).toEqual(['gpkg', 'kmz', 'shp', 'geojson'])
    expect(RUNS_ON_EXPORT.has('scene-gis')).toBe(false)

    const empty = buildExportContext(input(createEmptyScene()))
    expect(exportUnavailable('scene-gis', empty)).toMatch(/Draw or import a block, a landform or the road/)

    const scene = createSampleScene()
    const ctx = buildExportContext(input(scene))
    expect(exportUnavailable('scene-gis', ctx)).toBeNull()
    // It reads no run: nothing to run first, even with none.
    expect(exportPreparation('scene-gis', ctx)).toMatchObject({ run: false, capture: [], render: false, note: null })
    const sections = exportContents('scene-gis', ctx)
    const blocks = scene.targets.filter((target) => target.role === 'block').length
    expect(rowValue(sections, 'Layers', 'Proposed blocks')).toBe(`${blocks} area${blocks === 1 ? '' : 's'}`)
    expect(sections.find((section) => section.title === 'Not in the file')?.note).toMatch(
      /run’s figures .* live inventories/,
    )
  })

  it('gives Save as… each format’s file type and a name before the file is written', () => {
    const gis = findVisualsExport('scene-gis')
    expect(exportFileType(gis, gis.formats[0])).toEqual({
      mime: 'application/geopackage+sqlite3',
      extension: '.gpkg',
      description: 'Scene for GIS (GeoPackage)',
    })
    const project = findVisualsExport('project')
    expect(exportFileType(project, project.formats[0])).toMatchObject({
      mime: 'application/zip',
      extension: '.pgvq.zip',
    })
    expect(suggestedExportName(gis, gis.formats[2])).toBe('forestry-visual-quality-scene-gis.zip')
    // Every output's every format has a media type the save dialog can offer.
    for (const entry of VISUALS_EXPORTS)
      for (const format of entry.formats)
        expect(exportFileType(entry, format).mime).not.toBe('application/octet-stream')
  })

  it('offers the road view video for other tools, recorded on request and never run or captured for', () => {
    const item = findVisualsExport('road-video')
    expect(item.group).toBe('exchange')
    expect(item.description).toMatch(/not a photo simulation/)
    expect(exportFileType(item, { ...item.formats[0], extension: '.webm' }).mime).toBe('video/webm')
    expect(exportFileType(item, item.formats[0]).mime).toBe('video/mp4')
    const scene = createSampleScene()
    expect(exportUnavailable('road-video', buildExportContext(input(scene)))).toMatch(/not offered here/)
    const videoScene: RoadVideoScene = {
      road: { name: 'Made-up road', lengthMeters: 1500 },
      facingNow: null,
      views: [],
      harvestPhase: 'after',
      renderer: { id: 'pgmaps', label: 'PGMaps' },
      roadView: 'Open the road view and let its terrain load first: the video records it.',
      frame: null,
      format: 'mp4',
      look: [],
    }
    const plan = planRoadVideo(videoScene, DEFAULT_ROAD_VIDEO_SETTINGS)
    const closed = buildExportContext(
      input(scene, { roadVideo: { scene: videoScene, plan, take: null, recording: false } }),
    )
    expect(exportUnavailable('road-video', closed)).toMatch(/Open the road view/)
    // A take under way keeps its pane, whatever the road view reports meanwhile.
    const busy = buildExportContext(
      input(scene, { roadVideo: { scene: videoScene, plan, take: null, recording: true } }),
    )
    expect(exportUnavailable('road-video', busy)).toBeNull()
    expect(exportContents('road-video', closed).map((section) => section.title)).toEqual([
      'Video',
      'Route',
      'As the road view draws it',
      'Not in the file',
    ])
    // Display only: it waits for no run, capture, render or inventory read.
    expect(exportPreparation('road-video', closed)).toMatchObject({
      run: false,
      capture: [],
      render: false,
      inventory: false,
      note: null,
    })
  })

  it("words a view's settings from the view itself when no screenshot was kept", () => {
    const ctx = buildExportContext(
      input(createSampleScene(), { views: [view('a', { screenshot: false, classPass: false, settings: null })] }),
    )
    const rows = ctx.views[0].settings
    expect(rows.find((row) => row.label === 'Facing')?.value).toBe('40°')
    expect(rows.find((row) => row.label === 'Road clearing')?.value).toBe('18 m')
  })

  it('leaves views saved at other viewpoints out of the saved-views file, and says so', () => {
    const ctx = buildExportContext(
      input(createSampleScene(), { views: [view('a'), view('b', { here: false }), view('c', { here: false })] }),
    )
    const section = exportContents('views', ctx).find((entry) => entry.title === 'Saved views')
    expect(section?.items).toHaveLength(1)
    expect(section?.note).toMatch(/^2 views saved at other viewpoints are not in this file/)
  })

  it('shows the analysis sheet the view and look it will be drawn in', () => {
    const ctx = buildExportContext(
      input(createSampleScene(), {
        views: [view('a')],
        figure: {
          viewId: 'a',
          style: 'Perspective view',
          labelStyle: 'Underlined label',
          cameraInfo: true,
          paintBlocks: false,
        },
      }),
    )
    expect(exportUnavailable('analysis-sheet', ctx)).toBeNull()
    const sections = exportContents('analysis-sheet', ctx)
    expect(rowValue(sections, 'Figure', 'Saved view')).toBe(ctx.views[0].name)
    expect(rowValue(sections, 'Figure', 'Label style')).toBe('Underlined label')
    expect(rowValue(sections, 'Figure', 'Camera information')).toBe('On the image')
    expect(rowValue(sections, 'Figure', 'Block ground')).toBe('As captured')
    expect(sections.find((section) => section.title === 'View settings')?.rows).toHaveLength(3)
  })

  it('counts the office fields filled and reports the run settings in words', () => {
    const scene: ForestryScene = {
      ...createSampleScene(),
      reportMetadata: { district: 'Prince George', licensee: '  ', vsc: 'High' },
    }
    const ctx = buildExportContext(input(scene))
    expect(ctx.officeFields).toEqual({ filled: 2, total: 14 })
    expect(ctx.settings.find((row) => row.label === 'Eye height')?.value).toBe(
      `${scene.settings.observerHeightMeters} m`,
    )
    expect(ctx.settings.find((row) => row.label === 'Perspective denominator')?.value).toBe(
      'Landform net of rock, water and ice',
    )
  })

  it('marks a block note drafted until the reviewer signs the paragraph', () => {
    const scene = createSampleScene()
    const note = { header: [{ label: 'Block', value: 'A' }], landform: [], measures: 2 }
    const draft = buildExportContext(input(scene, { blockNote: note }))
    expect(exportUnavailable('block-note', draft)).toBeNull()
    expect(
      rowValue(exportContents('block-note', draft), 'Visuals paragraph and measures', 'Visuals paragraph'),
    ).toMatch(/draft/)
    const signed = buildExportContext(
      input({ ...scene, viaReview: { visualsNote: 'Signed paragraph.' } }, { blockNote: note }),
    )
    expect(rowValue(exportContents('block-note', signed), 'Visuals paragraph and measures', 'Visuals paragraph')).toBe(
      'Yours, as signed',
    )
  })
})

describe('outputs that print the visual inventory read it first', () => {
  const read = (status: 'idle' | 'loading' | 'ready' | 'error', error: string | null = null) =>
    buildExportContext(input(createEmptyScene(), { visualInventory: { status, error } }))

  it('reads it before the report, the document and the sheet, and before nothing else', () => {
    for (const kind of READS_INVENTORY) expect(exportPreparation(kind, read('idle')).inventory).toBe(true)
    expect(exportPreparation('via-report', read('idle')).note).toBe(
      'Reading the visual landscape inventory from DataBC first, for the units the file prints.',
    )
    expect(exportPreparation('fs1252', read('idle')).inventory).toBe(false)
    expect(exportPreparation('via-report', read('ready'))).toMatchObject({ inventory: false, note: null })
  })

  it('says a failed read is not read, and reads again only on a download', () => {
    const failed = read('error', 'DataBC answered 503')
    expect(exportPreparation('via-report', failed).inventory).toBe(false)
    expect(exportPreparation('via-report', failed, { retry: true }).inventory).toBe(true)
    expect(exportPreparation('via-report', failed).note).toBe(
      'The visual landscape inventory could not be read (DataBC answered 503): the file says it was not read. Downloading reads it again first.',
    )
  })
})

const planned = (id: string, overrides: Partial<ViewOfInterest> = {}): ViewOfInterest => ({
  id,
  name: `Viewpoint ${id}, toward Block 1`,
  source: { kind: 'map' },
  lng: -122.75,
  lat: 53.9,
  blockId: 'block-1',
  facing: { kind: 'block' },
  focalMm: 50,
  framing: 'landform',
  ...overrides,
})

const exportPlanned = (id: string, overrides: Partial<ExportPlannedView> = {}): ExportPlannedView => ({
  id,
  key: `key-${id}`,
  name: `Viewpoint ${id}`,
  block: 'Block 1',
  blockId: 'block-1',
  lens: '50 mm · 39.6° across',
  state: 'not-captured',
  include: true,
  savedViewId: null,
  failed: null,
  ...overrides,
})

describe('the package: one recipe, one renderer and one set of views for every output', () => {
  const base = {
    recipes: REPORT_RECIPES,
    formats: VIA_DOCUMENT_FORMATS,
    roadViewStyleId: null,
    planned: [] as ViewOfInterest[],
    blocks: [{ id: 'block-1', name: 'Block 1' }],
    savedViews: [] as Array<{ id: string; name: string; plannedViewId?: string; plannedKey?: string }>,
  }
  const choice = { recipeId: null, documentFormatId: null, excludedViews: new Set<string>() }

  it('lets a recipe set the VIA document’s format, so the document and the report agree', () => {
    for (const recipe of REPORT_RECIPES) {
      const pkg = resolvePackage({ ...base, choice: { ...choice, recipeId: recipe.id, documentFormatId: 'other' } })
      expect(pkg.recipeChosen).toBe(true)
      expect(pkg.recipeId).toBe(recipe.id)
      expect(pkg.documentFormatId).toBe(recipeFormat(recipe).id)
    }
  })

  it('without a recipe, follows the document’s own format, else the road view’s style, and the report reads it', () => {
    const format = VIA_DOCUMENT_FORMATS.find((entry) => REPORT_RECIPES.some((recipe) => recipe.format === entry.id))!
    const own = resolvePackage({ ...base, choice: { ...choice, documentFormatId: format.id } })
    expect(own.recipeChosen).toBe(false)
    expect(own.documentFormatId).toBe(format.id)
    expect(REPORT_RECIPES.find((recipe) => recipe.id === own.recipeId)?.format).toBe(format.id)
    const styled = VIA_DOCUMENT_FORMATS.find((entry) => entry.style)!
    expect(resolvePackage({ ...base, roadViewStyleId: styled.style, choice }).documentFormatId).toBe(styled.id)
    // An unknown recipe is no recipe.
    expect(resolvePackage({ ...base, choice: { ...choice, recipeId: 'gone' } }).recipeChosen).toBe(false)
  })

  it('takes each included view’s current capture and every saved view not left out, and leaves the rest out', () => {
    const a = planned('a')
    const b = planned('b', { include: false })
    const c = planned('c', { focalMm: 35 })
    const pkg = resolvePackage({
      ...base,
      choice: { ...choice, excludedViews: new Set(['own-2']) },
      planned: [a, b, c],
      savedViews: [
        { id: 'own-1', name: 'Pullout' },
        { id: 'own-2', name: 'Bridge' },
        { id: 'a-old', name: 'A', plannedViewId: 'a', plannedKey: viewCaptureKey(a) },
        { id: 'a-new', name: 'A', plannedViewId: 'a', plannedKey: viewCaptureKey(a) },
        { id: 'b-1', name: 'B', plannedViewId: 'b', plannedKey: viewCaptureKey(b) },
        // Captured with a 50 mm lens before the view was changed to 35 mm: out of date.
        { id: 'c-1', name: 'C', plannedViewId: 'c', plannedKey: viewCaptureKey({ ...c, focalMm: 50 }) },
        // Captured for a view no longer planned: an ordinary saved view.
        { id: 'gone-1', name: 'Gone', plannedViewId: createViewOfInterestId(), plannedKey: 'x' },
      ],
    })
    expect(pkg.planned.map((view) => [view.id, view.state, view.include, view.savedViewId])).toEqual([
      ['a', 'captured', true, 'a-new'],
      ['b', 'captured', false, 'b-1'],
      ['c', 'outdated', true, null],
    ])
    expect(pkg.planned[2].lens).toBe('35 mm · 54.4° across')
    expect(pkg.planned[0].block).toBe('Block 1')
    expect(pkg.saved.map((view) => [view.id, view.included])).toEqual([
      ['own-1', true],
      ['own-2', false],
      ['gone-1', true],
    ])
    expect([...pkg.viewIds].sort()).toEqual(['a-new', 'gone-1', 'own-1'])
    // The block note's builder leaves out the rest: by hand, a view left out, a superseded or outdated capture.
    expect([...pkg.excludedViews].sort()).toEqual(['a-old', 'b-1', 'c-1', 'own-2'])
  })

  it('keeps a failed capture only under the key it failed with', () => {
    const a = planned('a')
    const failures = { a: { key: viewCaptureKey(a), reason: 'The run failed.' } }
    expect(resolvePackage({ ...base, choice, planned: [a], failures }).planned[0].failed).toBe('The run failed.')
    // Moved since: tried again.
    const moved = { ...a, lng: -122.7 }
    expect(resolvePackage({ ...base, choice, planned: [moved], failures }).planned[0].failed).toBeNull()
  })
})

describe('views of interest in the exports', () => {
  const withPlanned = (views: ExportPlannedView[], overrides: Partial<ContextInput> = {}) =>
    buildExportContext(input(createSampleScene(), { planned: views, ...overrides }))

  it('makes the sheet, the document and the report available while included views of interest wait to be captured', () => {
    const ctx = withPlanned([exportPlanned('a')])
    for (const kind of ['analysis-sheet', 'via-document', 'via-report'] as const)
      expect(exportUnavailable(kind, ctx)).toBeNull()
    // All left out: nothing to draw, and it says where to include one.
    const out = withPlanned([exportPlanned('a', { include: false })])
    expect(exportUnavailable('via-report', out)).toBe(
      'Every view is left out of the package: include one under Package.',
    )
    const savedOut = buildExportContext(input(createSampleScene(), { views: [view('v', { inReport: false })] }))
    expect(exportUnavailable('analysis-sheet', savedOut)).toMatch(/left out of the package/)
  })

  it('captures the included views not yet captured first, for the outputs that draw views only', () => {
    const ctx = withPlanned([
      exportPlanned('a'),
      exportPlanned('b', { state: 'outdated' }),
      exportPlanned('c', { state: 'captured', savedViewId: 'c-1' }),
      exportPlanned('d', { include: false }),
      exportPlanned('e', { failed: 'The run failed.' }),
    ])
    expect(viewsToCapture('via-report', ctx)).toEqual(['a', 'b'])
    // A failed view is tried again on a download only, so a preview never loops on it.
    expect(viewsToCapture('via-report', ctx, { retry: true })).toEqual(['a', 'b', 'e'])
    expect(viewsToCapture('fs1252', ctx)).toEqual([])
    const prep = exportPreparation('block-note', ctx)
    expect(prep.capture).toEqual(['a', 'b'])
    expect(prep.note).toMatch(/^2 views of interest are captured first/)
    expect(exportPreparation('worksheet', ctx).capture).toEqual([])
    const running = exportPreparation('analysis-sheet', {
      ...ctx,
      capture: { status: 'running', message: 'Capturing 1 of 2: Viewpoint a…', done: 0, total: 2 },
    })
    expect(running.note).toBe('Capturing 1 of 2: Viewpoint a… The file is written when the views are saved.')
  })

  it('names the views a file goes without, and why', () => {
    const ctx = withPlanned([
      exportPlanned('a', { failed: 'The road view did not open.' }),
      exportPlanned('b', { state: 'captured', savedViewId: 'b-1' }),
    ])
    expect(uncapturedNote('via-report', ctx)).toBe(
      'A view of interest is not in the file because it was not captured: Viewpoint a (The road view did not open).',
    )
    expect(uncapturedNote('scene', ctx)).toBeNull()
    expect(exportPreparation('via-report', ctx).note).toMatch(/Download tries again\.$/)
  })

  it('lists each view of interest with its block, lens and capture state in what goes in', () => {
    const ctx = withPlanned([
      exportPlanned('a'),
      exportPlanned('b', { state: 'captured', savedViewId: 'b-1' }),
      exportPlanned('c', { include: false }),
    ])
    for (const kind of ['block-note', 'analysis-sheet', 'via-document', 'via-report'] as const) {
      const section = exportContents(kind, ctx).find((entry) => entry.title === 'Views of interest')
      expect(section?.action?.id).toBe('open-package')
      expect(section?.items?.map((item) => item.subtitle)).toEqual([
        'Block 1 · 50 mm · 39.6° across · To capture: captured before the file is written',
        'Block 1 · 50 mm · 39.6° across · Captured: in the file',
        'Block 1 · 50 mm · 39.6° across · Left out',
      ])
      expect(section?.note).toMatch(/^2 views of interest in the file, 1 to capture first/)
    }
    expect(exportContents('fs1252', ctx).some((entry) => entry.title === 'Views of interest')).toBe(false)
    // Before any capture the report says where its figures will come from.
    expect(exportContents('via-report', ctx)[0].note).toMatch(/once they are captured/)
  })

  it('names a view’s own landform with the view, and counts only unused landforms as not assessed', () => {
    const scene = createSampleScene()
    const site = findSceneLandform(scene)!
    const face = { ...site, id: 'face-a', name: 'Visible face round Block 1 from a' }
    const spare = { ...site, id: 'spare', name: 'An earlier outline' }
    const views = [planned('a', { landformId: 'face-a' }), planned('b'), planned('c', { landformId: site.id })]
    const withFaces: ForestryScene = {
      ...scene,
      targets: [...scene.targets, face, spare],
      activeLandformId: site.id,
      viewsOfInterest: views,
    }
    const pkg = resolvePackage({
      choice: { recipeId: null, documentFormatId: null, excludedViews: new Set<string>() },
      recipes: REPORT_RECIPES,
      formats: VIA_DOCUMENT_FORMATS,
      roadViewStyleId: null,
      planned: views,
      blocks: [{ id: 'block-1', name: 'Block 1' }],
      savedViews: [],
      landforms: withFaces.targets.filter((target) => target.role === 'landscape'),
      siteLandformId: site.id,
    })
    // A view that names the site's landform is assessed against the site's, like one that names none.
    expect(pkg.planned.map((view) => view.landform)).toEqual(['Visible face round Block 1 from a', null, null])
    const ctx = buildExportContext(input(withFaces, { planned: pkg.planned }))
    expect(ctx.landformUse).toEqual({ site: null, viewsWithOwn: 1, views: 3, unused: 1 })
    const subtitles = exportContents('analysis-sheet', ctx)
      .find((entry) => entry.title === 'Views of interest')
      ?.items?.map((item) => item.subtitle)
    expect(subtitles?.[0]).toContain('its own landform, Visible face round Block 1 from a')
    expect(subtitles?.[1]).not.toContain('landform')
    const sections = exportContents('scene', ctx)
    expect(rowValue(sections, 'Landform', 'Views with their own')).toMatch(/^1 of 3 views of interest/)
    expect(rowValue(sections, 'Landform', 'Other landforms')).toBe('1 in the scene that nothing uses, not assessed')

    // Standing at the view on its own landform, the run measures the face and the part names the site's beside it.
    const standing = buildExportContext(
      input({ ...withFaces, activeLandformId: 'face-a' }, { planned: pkg.planned, siteLandform: site }),
    )
    expect(standing.landform?.name).toBe('Visible face round Block 1 from a')
    expect(standing.landformUse).toEqual({ site: site.name, viewsWithOwn: 1, views: 3, unused: 1 })
    expect(rowValue(exportContents('scene', standing), 'Landform', 'Site landform')).toMatch(
      new RegExp(`^${site.name}; this run is at a view`),
    )
  })

  it('lists a capture with its view of interest, not again among the saved views', () => {
    const ctx = withPlanned([exportPlanned('a', { state: 'captured', savedViewId: 'v-a' })], {
      views: [view('v-a', { view: { ...view('v-a').view, plannedViewId: 'a' } }), view('own')],
    })
    const section = exportContents('block-note', ctx).find((entry) => entry.title === 'Viewpoints in the report')
    expect(section?.items?.map((item) => item.title)).toEqual(['View from the road going north own'])
    expect(packageSummary({ ...ctx, recipe: 'District summary' })).toBe('District summary · PGMaps · 2 views')
    expect(packageSummary(withPlanned([exportPlanned('a')]))).toBe('No recipe · PGMaps · 1 view, 1 to capture')
  })
})

describe('every view of the package prints or is named, with why', () => {
  const withPlanned = (views: ExportPlannedView[], overrides: Partial<ContextInput> = {}) =>
    buildExportContext(input(createSampleScene(), { planned: views, ...overrides }))

  it('names a view saved without its analysis sheet, with the reason its save gave', () => {
    const views = [
      { id: 'drawn', name: 'Viewpoint 3' },
      { id: 'sheetless', name: 'VLI 145' },
      { id: 'gone', name: 'Viewpoint 4' },
    ]
    const unprinted = unprintedViews(views, {
      drawn: { figure: {} },
      sheetless: { figureError: 'The class pass found no landform pixels.' },
    })
    expect(unprinted).toEqual([
      {
        id: 'sheetless',
        name: 'VLI 145',
        reason: 'its analysis sheet could not be drawn: the class pass found no landform pixels',
      },
      { id: 'gone', name: 'Viewpoint 4', reason: expect.stringMatching(/^it has no screenshot or analysis sheet/) },
    ])
    expect(unprintedViews([{ id: 'x', name: 'X' }], { x: {} })[0].reason).toBe(
      'its analysis sheet could not be drawn: its class pass was not taken when it was saved',
    )
  })

  it('lists the views it cannot draw in what goes in, in the preview’s notice and in the file', () => {
    const ctx = withPlanned(
      [
        exportPlanned('a', { state: 'captured', savedViewId: 'a-1' }),
        exportPlanned('b', { state: 'no-figure', savedViewId: 'b-1' }),
        exportPlanned('c', { failed: 'The run failed.' }),
      ],
      { unprinted: [{ id: 'b-1', name: 'Viewpoint b', reason: 'its analysis sheet could not be drawn: no frame' }] },
    )
    const sections = exportContents('via-report', ctx)
    expect(sections.find((entry) => entry.title === 'Views not drawn')?.items).toEqual([
      { title: 'Viewpoint b', subtitle: 'Not in the file: its analysis sheet could not be drawn: no frame' },
    ])
    const planned = sections.find((entry) => entry.title === 'Views of interest')?.items?.map((item) => item.subtitle)
    expect(planned?.[1]).toMatch(/Captured, but not drawn in the file: its analysis sheet could not be drawn: no frame/)
    expect(uncapturedNote('via-report', ctx)).toBe(
      'A view of interest is not in the file because it was not captured: Viewpoint c (The run failed). A view is not drawn in the file: Viewpoint b (its analysis sheet could not be drawn: no frame).',
    )
    expect(viewsLeftOut('via-document', ctx)).toEqual([
      { name: 'Viewpoint c', reason: 'not captured: the run failed.' },
      { name: 'Viewpoint b', reason: 'its analysis sheet could not be drawn: no frame' },
    ])
    // The block note takes a view without its sheet as its screenshot: it is not named as left out there.
    expect(viewsLeftOut('block-note', ctx).map((entry) => entry.name)).toEqual(['Viewpoint c'])
  })

  it('says why a document viewpoint prints no figure rather than calling its class pass missing', () => {
    expect(documentFigureLine({ percent: '0.3', term: 'Very small' }, { landform: 900 })).toBe('0.3% · Very small')
    expect(documentFigureLine(null, { landform: 0 })).toBe(
      'No figure: the landform is not in the picture (its class pass shows none of it)',
    )
    expect(documentFigureLine(null, { landform: 120 })).toMatch(/deductions/)
  })

  it('shows the not-captured notice once in a preview that prints it', () => {
    const ctx = withPlanned([exportPlanned('a', { failed: 'Cancelled.' })])
    const prep = exportPreparation('via-report', ctx)
    expect(prep.note).toMatch(/Download tries again\.$/)
    expect(prep.noteIsSkipped).toBe(true)
    expect(exportPreparation('via-report', withPlanned([exportPlanned('a')])).noteIsSkipped).toBe(false)
  })
})

describe('views of interest planned for another block', () => {
  const pkg = {
    planned: [
      exportPlanned('a', { state: 'captured', savedViewId: 'a-1' }),
      exportPlanned('b', { state: 'captured', savedViewId: 'b-1', blockId: 'block-2', block: 'Block 2' }),
      exportPlanned('c', { blockId: 'block-2', block: 'Block 2' }),
    ],
    excludedViews: new Set(['own-left-out']),
  }

  it('leaves them out of a block’s note and brief, but not saved views of its own', () => {
    expect([...excludedForBlock(pkg, 'block-1')].sort()).toEqual(['b-1', 'own-left-out'])
    expect([...excludedForBlock(pkg, null)]).toEqual(['own-left-out'])
  })

  it('neither captures them for that block’s note nor names them as missing, and lists them as for another block', () => {
    const ctx = buildExportContext(
      input(createSampleScene(), {
        planned: pkg.planned,
        blockNote: { blockId: 'block-1', header: [], landform: [], measures: 0 },
      }),
    )
    expect(viewsToCapture('block-note', ctx)).toEqual([])
    expect(viewsToCapture('via-report', ctx)).toEqual(['c'])
    expect(uncapturedNote('block-note', ctx)).toBeNull()
    const section = exportContents('block-note', ctx).find((entry) => entry.title === 'Views of interest')
    expect(section?.items?.map((item) => item.subtitle)).toEqual([
      'Block 1 · 50 mm · 39.6° across · Captured: in the file',
      'Block 2 · 50 mm · 39.6° across · For another block: left out of this file',
      'Block 2 · 50 mm · 39.6° across · For another block: left out of this file',
    ])
    expect(section?.note).toMatch(/2 views planned for another block are left out/)
  })
})

describe('before-harvest renders taken where each view stands', () => {
  it('captures again, with its before render, a captured view that has none, for the outputs that pair one', () => {
    const ctx = buildExportContext(
      input(createSampleScene(), {
        planned: [
          exportPlanned('a', { state: 'captured', savedViewId: 'a-1', beforeOwed: true }),
          exportPlanned('b', { state: 'captured', savedViewId: 'b-1' }),
          exportPlanned('c', { state: 'captured', savedViewId: 'c-1', beforeOwed: true, beforeFailed: 'No terrain.' }),
          exportPlanned('d'),
        ],
      }),
    )
    expect(beforeToCapture('via-report', ctx)).toEqual(['a'])
    expect(beforeToCapture('via-report', ctx, { retry: true })).toEqual(['a', 'c'])
    expect(beforeToCapture('block-note', ctx)).toEqual([])
    // The analysis sheet pairs its own view only.
    expect(beforeToCapture('analysis-sheet', { ...ctx, figure: { ...ctx.figure, viewId: 'b-1' } })).toEqual([])
    expect(beforeToCapture('analysis-sheet', { ...ctx, figure: { ...ctx.figure, viewId: 'a-1' } })).toEqual(['a'])
    const prep = exportPreparation('via-report', ctx)
    expect(prep).toMatchObject({ capture: ['d', 'a'], captureBefore: true })
    expect(prep.note).toMatch(/captured again for its before-harvest render/)
    expect(exportPreparation('block-note', ctx)).toMatchObject({ capture: ['d'], captureBefore: false })
  })

  it('takes the view’s own before failure only under the key it failed with', () => {
    const a = planned('a')
    const key = viewCaptureKey(a)
    const resolved = resolvePackage({
      choice: { recipeId: null, documentFormatId: null, excludedViews: new Set() },
      recipes: REPORT_RECIPES,
      formats: VIA_DOCUMENT_FORMATS,
      roadViewStyleId: null,
      planned: [a],
      blocks: [{ id: 'block-1', name: 'Block 1' }],
      savedViews: [{ id: 'a-1', name: 'A', plannedViewId: 'a', plannedKey: key }],
      beforeOwed: new Set(['a-1']),
      beforeFailures: { a: { key: 'old', reason: 'No terrain.' } },
      hasFigure: () => true,
    })
    expect(resolved.planned[0]).toMatchObject({ state: 'captured', beforeOwed: true, beforeFailed: null })
  })
})

describe('a view drawn again by an engine', () => {
  it('keeps the names and place the view was saved with, whatever the page stands at while it renders', () => {
    const own = {
      place: 'VLI potencial 145',
      viewpoint: 'VLI potencial 145, toward Block B',
      facts: [
        { label: 'Viewpoint', value: 'VLI potencial 145, 0.02 km' },
        { label: 'Location', value: '53.90500, -122.47000' },
      ],
    }
    type Named = { place?: string; viewpoint: string; facts: Array<{ label: string; value: string }> }
    const drawn: Named = {
      place: 'Viewpoint 3',
      viewpoint: 'VLI potencial 145, toward Block B',
      facts: [
        { label: 'Viewpoint', value: 'Viewpoint 3, 0.02 km' },
        { label: 'Location', value: '53.90500, -122.47000' },
      ],
    }
    expect(savedIdentity(drawn, own)).toEqual({ ...drawn, place: 'VLI potencial 145', facts: own.facts })
    const placeless = savedIdentity(drawn, { viewpoint: 'Road view', facts: [] })
    expect('place' in placeless).toBe(false)
    expect(savedIdentity(drawn, undefined)).toBe(drawn)
  })
})
