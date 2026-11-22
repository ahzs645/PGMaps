import { describe, expect, it } from 'vitest'

import { FIGURE_CLASS } from '@/lib/forestry/viaFigure/composeFigure'

import type { SavedFigure } from '../FigureSheetPanel'
import type { ForestryScene } from '../scene'
import { sceneFingerprint } from '../sceneInput'
import type { TargetPolygon } from '../types'
import { parseViaReview, type ViaReview } from '../via'
import { buildReportContext } from './context'
import type { ReportBlock } from './model'
import { findReportPart } from './registry'
import { assembleReportParts, REPORT_RECIPES, withViewsLeftOut } from './recipes'

const square = (lng: number, lat: number, size = 0.01): TargetPolygon['geometry'] => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, lat],
      [lng + size, lat],
      [lng + size, lat + size],
      [lng, lat + size],
      [lng, lat],
    ],
  ],
})

function figure(stationIndex: number, place: string, area: string): SavedFigure {
  const codes = new Uint8Array(100)
  for (let i = 0; i < 80; i++) codes[i] = FIGURE_CLASS.landform
  for (let i = 0; i < 4; i++) codes[i] = FIGURE_CLASS.proposedIn
  return {
    classes: { width: 10, height: 10, codes },
    callouts: [{ blockId: 'b1', title: 'Block X1', anchor: [1, 1], status: 'visible', visiblePercent: 30 }],
    stationIndex,
    sightlinePercent: 4.8,
    sightlineClass: 'Partial retention',
    lens: '50 mm',
    distanceKm: 3.4,
    hfovDeg: 39.6,
    facts: [],
    rating: null,
    area,
    viewpoint: `View of the block from ${place}`,
    place,
    hidden: [],
    splitFailed: false,
  } as unknown as SavedFigure
}

const review: ViaReview = {
  viewpointRecords: { 'View 1': { significance: 'Moderate to High (4)', duration: 'Sustained' } },
  landformRecords: { 'Landform 1b': { parent: 'Landform 1', divider: 'the draw east of the block' } },
}

const scene = {
  viewpoint: { mode: 'spot', coordinates: [[-122.5, 53.9]] },
  targets: [
    { id: 'b1', name: 'X1', role: 'block', geometry: square(-122.4, 53.9), plannedHarvestYear: 2027 },
    { id: 'b2', name: 'X2', role: 'block', geometry: square(-122.38, 53.9), plannedHarvestYear: 2027 },
    {
      id: 'lf',
      name: 'Landform 1b',
      role: 'landscape',
      objectiveId: 'partial-retention',
      geometry: square(-122.41, 53.89, 0.05),
    },
  ],
  settings: { observerHeightMeters: 1.6 },
  reportMetadata: { inventoryDate: '2019-03-31', lakeManagementZone: 'Purden Lake LMZ' },
  viaReview: review,
  masks: [],
} as unknown as ForestryScene

const recipe = (id: string) => REPORT_RECIPES.find((entry) => entry.id === id)!
const contextFor = (id: string) =>
  buildReportContext({
    recipe: recipe(id),
    scene,
    views: [
      { name: 'View 1', figure: figure(2, 'Bay', 'Landform 1b') },
      { name: 'View 2', figure: figure(5, 'Ferry', 'Landform 1b') },
    ],
    assessmentStation: 5,
    assessment: null,
    breakdown: null,
    figures: [],
    date: new Date('2026-11-14T12:00:00Z'),
  })
const all = (blocks: ReportBlock[]) => JSON.stringify(blocks)

describe('reviewer records reach the VIA report', () => {
  it('prints the inventory date and the lake or management zone on the district summary', () => {
    const ctx = contextFor('design-rationale')
    const out = findReportPart('district-summary-form')!.build({
      ...ctx,
      recipeParts: recipe('design-rationale').parts,
    })
    expect(all(out.blocks)).toContain('"label":"Date of inventory","value":"2019-03-31"')
    expect(all(out.blocks)).toContain('["Purden Lake LMZ","","","","","",""]')
    expect(out.toComplete).not.toContain('1. Date of inventory')
    expect(out.toComplete).toContain('2. Purden Lake LMZ: lake number and class, and the LMZ area and alteration')
  })

  it('reads the proposed year of harvest from the blocks’ planned harvest years', () => {
    const ctx = contextFor('form-2001-sheets')
    expect(ctx.blocks.map((block) => block.plannedHarvestYear)).toEqual([2027, 2027])
    const out = findReportPart('form-header-2001')!.build({ ...ctx, recipeParts: recipe('form-2001-sheets').parts })
    expect(all(out.blocks)).toContain('"label":"Proposed year of harvest","value":"2027"')
    expect(out.toComplete).not.toContain('Proposed year of harvest')
  })

  it('gives every view its Table 3 entry and keeps step 4 to the assessment station', () => {
    const ctx = contextFor('consultant-gross')
    const [bay, ferry] = ctx.facts.viewpoints
    expect(bay.review).toEqual({ importance: 'Moderate to High (4)', duration: 'Sustained' })
    expect(bay.atAssessment).toBe(false)
    expect(ferry.atAssessment).toBe(true)
  })

  it('prints a sub-landform’s parent and divider from step 1’s record in Table 2', () => {
    const ctx = contextFor('consultant-gross')
    expect(ctx.landforms).toEqual([
      { name: 'Landform 1b', parent: 'Landform 1', divider: 'the draw east of the block' },
    ])
    const out = findReportPart('table-2-landforms')!.build(ctx)
    expect(all(out.blocks)).toContain('Sub-landform of Landform 1, divided at the draw east of the block.')
  })
})

describe('reviewer records are review records', () => {
  it('read back from a saved scene, dropping what is not recognised', () => {
    const parsed = parseViaReview({
      viewpointRecords: { a: { significance: 'High (5)', reason: 'Boats' }, b: { significance: 'Very high' }, '': {} },
      keyViewpoints: { blocks: { X1: { view: 'a', reason: '' }, X2: {} }, group: { view: 'b' } },
      landformRecords: { 'Landform 1b': { parent: 'Landform 1', divider: 7 } },
    })
    expect(parsed?.viewpointRecords).toEqual({ a: { significance: 'High (5)', reason: 'Boats' } })
    expect(parsed?.keyViewpoints).toEqual({ blocks: { X1: { view: 'a' } }, group: { view: 'b' } })
    expect(parsed?.landformRecords).toEqual({ 'Landform 1b': { parent: 'Landform 1' } })
    // A review saved before them reads back without them.
    expect(Object.keys(parseViaReview({}) ?? {})).not.toContain('viewpointRecords')
  })

  it('never stale the run', () => {
    const edited = {
      ...scene,
      viaReview: { ...review, keyViewpoints: { group: { view: 'View 2' } } },
      reportMetadata: { inventoryDate: '2020-01-01' },
    } as ForestryScene
    expect(sceneFingerprint(scene)).not.toBeNull()
    expect(sceneFingerprint(edited)).toBe(sceneFingerprint(scene))
  })
})

describe('a report whose views have no analysis sheet', () => {
  it('still prints, every recipe, with each missing figure on the to-complete list', () => {
    const leftOut = [
      { name: 'View 1', reason: 'its analysis sheet could not be drawn: The framed view did not finish drawing' },
    ]
    for (const entry of REPORT_RECIPES) {
      const ctx = buildReportContext({
        recipe: entry,
        scene,
        views: [],
        assessmentStation: 5,
        assessment: null,
        breakdown: null,
        figures: [],
        date: new Date('2026-11-14T12:00:00Z'),
      })
      const report = withViewsLeftOut(assembleReportParts(entry, ctx).report, leftOut)
      expect(report.blocks.length, entry.id).toBeGreaterThan(0)
      expect(
        report.toComplete.some((item) => item.what.startsWith('View 1 is not in the report')),
        entry.id,
      ).toBe(true)
    }
  })
})
