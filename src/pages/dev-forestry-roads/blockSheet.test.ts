import { describe, expect, it } from 'vitest'
import { syntheticTerrain } from '@/lib/forestry/blockSheet/blockSheetFixtures'
import { INVALID_INPUT_RULES, STAMPED_EXPORTS } from './exportCatalog'
import {
  blockChoices,
  blockSheetLayers,
  blockSheetUnavailable,
  buildBlockSheet,
  canopySurfaceId,
  changeBlockSheetSettings,
  DEFAULT_BLOCK_SHEET,
  parseBlockSheetSettings,
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
})
