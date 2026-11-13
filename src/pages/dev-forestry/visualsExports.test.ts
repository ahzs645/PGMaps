import { describe, expect, it } from 'vitest'

import { createEmptyScene, createSampleScene, type ForestryScene } from './scene'
import { findSceneLandform } from './sceneInput'
import {
  buildExportContext,
  exportContents,
  exportPreparation,
  exportUnavailable,
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
    figure: { viewId: null, style: 'Analysis sheet', labelStyle: 'Box', cameraInfo: false },
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

  it('says why a document cannot be written before there is a block, a run or a saved view', () => {
    const ctx = buildExportContext(input(createEmptyScene()))
    expect(exportUnavailable('block-note', ctx)).toMatch(/cutblock/)
    expect(exportUnavailable('fs1252', ctx)).toMatch(/Run the visibility assessment/)
    expect(exportUnavailable('analysis-sheet', ctx)).toMatch(/Save a viewpoint/)
    expect(exportUnavailable('worksheet', ctx)).toMatch(/Run the visibility assessment/)
    expect(exportUnavailable('scene-package', ctx)).toMatch(/road view/)
    // A scene can always be saved.
    expect(exportUnavailable('scene', ctx)).toBeNull()
    expect(exportUnavailable('views', ctx)).toBeNull()
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
    expect(section?.note).toMatch(/^1 view in the report/)
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

  it('offers to open the road view for the 3D scene', () => {
    const ctx = buildExportContext(input(createSampleScene()))
    const section = exportContents('scene-package', ctx).find((entry) => entry.title === 'Road view')
    expect(section?.action).toEqual({ id: 'open-road-view', label: 'Open the road view' })
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
        figure: { viewId: 'a', style: 'Perspective view', labelStyle: 'Underlined label', cameraInfo: true },
      }),
    )
    expect(exportUnavailable('analysis-sheet', ctx)).toBeNull()
    const sections = exportContents('analysis-sheet', ctx)
    expect(rowValue(sections, 'Figure', 'Saved view')).toBe(ctx.views[0].name)
    expect(rowValue(sections, 'Figure', 'Label style')).toBe('Underlined label')
    expect(rowValue(sections, 'Figure', 'Camera information')).toBe('On the image')
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
