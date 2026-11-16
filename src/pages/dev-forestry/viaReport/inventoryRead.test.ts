import { describe, expect, it } from 'vitest'

import { FIGURE_CLASS } from '@/lib/forestry/viaFigure/composeFigure'

import { parseSensitivityUnits, type BcSensitivityUnit } from '../bcVisualInventory'
import type { SavedFigure } from '../FigureSheetPanel'
import { withReadInventory } from '../inventoryBadge'
import type { ForestryScene } from '../scene'
import type { TargetPolygon } from '../types'
import type { AssessmentMask } from '../types'
import { buildReportContext, inventoryUnitRows, netOfReservesHa, reportBlockFacts, type ReportView } from './context'
import { findReportPart } from './registry'
import { REPORT_RECIPES } from './recipes'

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

// Two units as DataBC's WFS returns them: 382 holds the west block, 381 the east one.
const units: BcSensitivityUnit[] = parseSensitivityUnits({
  features: [
    {
      geometry: square(-116.95, 50.1, 0.03),
      properties: {
        OBJECTID: 167194904,
        VLI_POLYGON_NO: 382,
        VSU_NUMBER: '382',
        REC_EVQO_CODE: 'PR',
        REC_VSC_FINAL_VALUE_CODE: '2',
        REC_VAC_FINAL_VALUE_CODE: 'M',
        REC_EVC_FINAL_VALUE_CODE: 'PR',
        UPDATE_DATE: '2010-08-01Z',
      },
    },
    {
      geometry: square(-116.92, 50.1, 0.03),
      properties: {
        OBJECTID: 167194920,
        VLI_POLYGON_NO: 381,
        VSU_NUMBER: '381',
        REC_EVQO_CODE: 'PR',
        REC_VSC_FINAL_VALUE_CODE: '3',
        REC_VAC_FINAL_VALUE_CODE: 'M',
        REC_EVC_FINAL_VALUE_CODE: 'P',
        UPDATE_DATE: '2010-08-01Z',
      },
    },
  ],
})

const blocks: TargetPolygon[] = [
  { id: 'b1', name: 'Block 1', role: 'block', geometry: square(-116.94, 50.11) } as TargetPolygon,
  { id: 'b2', name: 'Block 2', role: 'block', geometry: square(-116.91, 50.11) } as TargetPolygon,
]

/** A view saved before any inventory read: no unit, not read, but what would choose its unit kept. */
function savedBeforeRead(stationIndex: number, place: string, seen: Array<[number, number]>): SavedFigure {
  const codes = new Uint8Array(100)
  for (let i = 0; i < 80; i++) codes[i] = FIGURE_CLASS.landform
  for (let i = 0; i < 4; i++) codes[i] = FIGURE_CLASS.proposedIn
  return {
    classes: { width: 10, height: 10, codes },
    callouts: [{ blockId: 'b1', title: 'Block 1', anchor: [1, 1], status: 'visible', visiblePercent: 30 }],
    stationIndex,
    sightlinePercent: 4.8,
    sightlineClass: 'Partial retention',
    lens: '50 mm',
    distanceKm: 3.4,
    hfovDeg: 39.6,
    facts: [],
    rating: null,
    ratingNote: 'Visual inventory not read: look it up in step 1 to fill the circle.',
    inventoryRead: false,
    inventoryAt: { visibleBlockPoints: seen, landformUnitId: null, landform: null },
    area: 'VSU 382 + 381',
    viewpoint: `View of the block from ${place}`,
    place,
    hidden: [],
    splitFailed: false,
  } as unknown as SavedFigure
}

const scene = {
  viewpoint: { mode: 'spot', coordinates: [[-116.9, 50.14]] },
  targets: [
    ...blocks,
    {
      id: 'lf',
      name: 'VSU 382 + 381',
      role: 'landscape',
      objectiveId: 'partial-retention',
      geometry: square(-116.95, 50.1, 0.06),
    },
  ],
  settings: { observerHeightMeters: 1.6 },
  masks: [],
} as unknown as ForestryScene

const recipe = REPORT_RECIPES.find((entry) => entry.parts.includes('table-1-vsu'))!

const views = (read: readonly BcSensitivityUnit[] | null): ReportView[] =>
  [
    { name: 'Lost Ledge', figure: savedBeforeRead(2, 'Lost Ledge', [[-116.935, 50.115]]) },
    { name: 'Ferry', figure: savedBeforeRead(5, 'Ferry', [[-116.905, 50.115]]) },
  ].map((view) => ({ ...view, figure: withReadInventory(view.figure, read) }))

const contextWith = (read: readonly BcSensitivityUnit[] | null) =>
  buildReportContext({
    recipe,
    scene,
    views: views(read),
    assessmentStation: 2,
    assessment: null,
    breakdown: null,
    figures: [],
    ...(read ? { inventoryUnits: read } : {}),
    date: new Date('2026-11-15T12:00:00Z'),
  })

describe('the visual inventory read reaches the VIA report', () => {
  it('parses the record’s update date from the WFS', () => {
    expect(units.map((unit) => unit.updated)).toEqual(['2010-08-01', '2010-08-01'])
  })

  it('fills each view saved before the read with its own unit, by the sheet’s rules', () => {
    const ctx = contextWith(units)
    expect(ctx.inventoryRead).toBe(true)
    expect(ctx.facts.viewpoints.map((vp) => vp.inventory)).toEqual([
      { vsu: '382', vsc: '2', vac: 'M', evc: 'PR', vqo: 'PR', date: '2010-08-01' },
      { vsu: '381', vsc: '3', vac: 'M', evc: 'P', vqo: 'PR', date: '2010-08-01' },
    ])
    // The assessment station's view gives the report's own unit.
    expect(ctx.inventory?.vsu).toBe('382')
  })

  it('lists every unit under the blocks with each block’s hectares', () => {
    const ctx = contextWith(units)
    expect(ctx.inventoryUnits?.map((row) => [row.vsu, row.vsc, row.vac, row.evc, row.vqo, row.date])).toEqual([
      ['382', '2', 'M', 'PR', 'PR', '2010-08-01'],
      ['381', '3', 'M', 'P', 'PR', '2010-08-01'],
    ])
    expect(Object.keys(ctx.inventoryUnits![0].blocks!)).toEqual(['Block 1'])
    expect(ctx.inventoryUnits![0].blocks!['Block 1']).toBeGreaterThan(70)
  })

  it('prints the units in Table 1 and says the inventory was read', () => {
    const ctx = contextWith(units)
    const table = JSON.stringify(findReportPart('table-1-vsu')!.build({ ...ctx, recipeParts: recipe.parts }).blocks)
    expect(table).toContain('["VSU #382","1","2","M","PR","PR - Partial Retention"]')
    expect(table).toContain('["VSU #381","1","3","M","P","PR - Partial Retention"]')
    const method = JSON.stringify(findReportPart('assessment-method')!.build(ctx).blocks)
    expect(method).toContain('The inventory was read live for this report.')
  })

  it('says not read only when nothing was read', () => {
    const ctx = contextWith(null)
    expect(ctx.inventoryRead).toBe(false)
    expect(ctx.inventoryUnits).toBeUndefined()
    expect(ctx.facts.viewpoints.every((vp) => vp.inventory === null)).toBe(true)
    const method = JSON.stringify(findReportPart('assessment-method')!.build(ctx).blocks)
    expect(method).toContain('The inventory was not read for this report')
  })

  it('reads none here as a finding, not a gap', () => {
    const ctx = contextWith([])
    expect(ctx.inventoryRead).toBe(true)
    expect(ctx.inventoryUnits).toEqual([])
  })

  it('nets a block of the reserves mapped inside it, in area and in each unit, leaving other blocks as they are', () => {
    // A quarter of Block 1 is a wildlife tree patch; Block 2 holds none.
    const reserve: AssessmentMask = {
      id: 'r1',
      name: 'Block 1 Wildlife tree retention',
      kind: 'retained',
      geometry: square(-116.94, 50.11, 0.005),
    } as AssessmentMask
    const gross = reportBlockFacts(blocks[0]).areaHa
    const facts = reportBlockFacts(blocks[0], [reserve])
    expect(facts.islands).toBe(1)
    expect(facts.reservesHa! / gross).toBeCloseTo(0.25, 2)
    expect(netOfReservesHa(blocks[0], [reserve]) / gross).toBeCloseTo(0.75, 2)
    expect(reportBlockFacts(blocks[1], [reserve]).reservesHa).toBe(0)
    // A clearcut keeping mapped reserves prints as the VIAs print it; one without stays a clearcut.
    expect(facts.system).toBe('Clearcut with reserves')
    expect(reportBlockFacts(blocks[1], [reserve]).system).toBe('Clearcut')
    const rows = inventoryUnitRows(units, blocks, [], [reserve])
    const unit382 = rows.find((row) => row.vsu === '382')!
    expect((unit382.netBlocks?.['Block 1'] ?? 0) / unit382.blocks!['Block 1']).toBeCloseTo(0.75, 2)
    expect(rows.every((row) => row.netBlocks?.['Block 2'] === undefined)).toBe(true)
    expect(inventoryUnitRows(units, blocks).every((row) => !row.netBlocks)).toBe(true)
  })

  it('keeps a unit a viewpoint chose that holds no block', () => {
    const rows = inventoryUnitRows(units, blocks.slice(0, 1), ['382', '381'])
    expect(rows.map((row) => [row.vsu, row.blocks ? Object.keys(row.blocks) : null])).toEqual([
      ['382', ['Block 1']],
      ['381', null],
    ])
  })
})
