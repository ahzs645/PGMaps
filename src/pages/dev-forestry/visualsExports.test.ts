import { describe, expect, it } from 'vitest'

import { createEmptyScene, createSampleScene, type ForestryScene } from './scene'
import { findSceneLandform } from './sceneInput'
import {
  buildExportContext,
  exportContents,
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
    const views = exportContents('block-note', ctx).find((section) => section.title === 'Saved views')
    expect(views?.items).toHaveLength(2)
    expect(views?.items?.[0].subtitle).toContain('1.25 km along')
    expect(views?.items?.[0].subtitle).toContain('after harvest')
    expect(views?.items?.[1].subtitle).toContain('screenshot only')
    expect(views?.items?.[0].rows).toEqual(
      expect.arrayContaining([
        { label: 'Lens', value: '27° vertical field of view' },
        { label: 'Harvest phase', value: 'After harvest' },
      ]),
    )
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
