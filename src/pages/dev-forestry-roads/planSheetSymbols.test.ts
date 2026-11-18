import { describe, expect, it } from 'vitest'
import { areaPatternId, lineMarkerId, symbolImages } from '@/lib/mapSheet/mapSymbols'
import { CONSTRAINT_AREA, RIPARIAN_SCREEN, ROAD_DEACTIVATION } from '@/lib/forestry/blockSheet/styles'
import { buildPlanLegend, type PlanLegendSources } from './planLegendModel'
import {
  contextSheetKey,
  PLAN_SHEET_LAYER_IDS,
  PLAN_SHEET_ROAD_HIT_LAYER_IDS,
  PLAN_SHEET_SYMBOLS,
  planSheetLayers,
  planSheetLayerSet,
  planSheetSymbolSet,
  riparianSheetKey,
  sheetProperties,
} from './planSheetSymbols'
import { createDemoProject } from './terrain'
import type { ContextFeature } from './types'

const road = (patch: Partial<ContextFeature> = {}): ContextFeature => ({
  id: 'r',
  name: 'Road',
  kind: 'existing-road',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.7, 53.9],
      [-122.71, 53.91],
    ],
  },
  ...patch,
})
const evidence = {
  source: 'user' as const,
  condition: 'unknown' as const,
  conditionBasis: 'unreviewed' as const,
  reuseAllowed: false,
}

describe('road tool context with block sheet symbols', () => {
  it('classes each context feature as the block sheet does', () => {
    expect(contextSheetKey(road())).toBe('existingRoad')
    expect(contextSheetKey(road({ roadEvidence: { ...evidence, roadClass: 'fsr' } }))).toBe('fsr')
    expect(contextSheetKey({ ...road(), kind: 'avoid' })).toBe('constraint')
    expect(contextSheetKey({ ...road(), kind: 'harvest' })).toBe('otherBlock')
    expect(contextSheetKey({ ...road(), kind: 'stream' })).toBe('stream')
    expect(
      contextSheetKey({
        ...road(),
        kind: 'stream',
        streamAssessment: {
          channelWidthM: null,
          fish: 'unresolved',
          communityWatershed: 'unresolved',
          importedClass: ' ncd ',
        },
      }),
    ).toBe('ncd')
    expect(riparianSheetKey('reserve')).toBe('riparianReserve')
    expect(riparianSheetKey('uncertain')).toBe('riparianManagement')
    const deactivated = road({
      roadEvidence: { ...evidence, deactivation: { status: 'deactivated' } as never },
    })
    expect(sheetProperties(deactivated)).toEqual({ sheetKey: 'existingRoad', sheetDeactivated: true })
  })

  it('draws hatched areas with a pattern and repeated markers with line-placed symbols', () => {
    const layers = planSheetLayers('road-context')
    const constraint = layers.find((layer) => layer.id === 'road-sheet-constraint-pattern')!
    expect(constraint).toMatchObject({ type: 'fill', paint: { 'fill-pattern': areaPatternId(CONSTRAINT_AREA) } })
    expect(symbolImages(CONSTRAINT_AREA, 2)[0].id).toBe(areaPatternId(CONSTRAINT_AREA))
    expect(layers.find((layer) => layer.id === 'road-sheet-riparianManagement-pattern')).toBeDefined()
    const crosses = layers.find((layer) => layer.id === 'road-sheet-deactivated-marker-0')!
    expect(crosses).toMatchObject({
      type: 'symbol',
      layout: { 'symbol-placement': 'line', 'icon-image': lineMarkerId(ROAD_DEACTIVATION.markers![0]) },
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'sheetDeactivated'], true]],
    })
    const fsr = layers.filter((layer) => layer.id.startsWith('road-sheet-fsr-'))
    expect(fsr.map((layer) => layer.type)).toEqual(['line', 'line'])
    expect(new Set(PLAN_SHEET_LAYER_IDS).size).toBe(PLAN_SHEET_LAYER_IDS.length)
    for (const id of PLAN_SHEET_ROAD_HIT_LAYER_IDS) expect(PLAN_SHEET_LAYER_IDS).toContain(id)
  })

  it('draws a saved style in place of the sheet symbol it was chosen for, and leaves the rest alone', () => {
    const creek = { kind: 'line' as const, label: 'Office creek', layers: [{ color: '#0044aa', width: 1.4 }] }
    // A point style cannot draw a road, and a culvert is not a plan sheet key: both are left out.
    const dot = { kind: 'point' as const, label: 'Dot', icon: 'dot' as const, size: 3, color: '#000000' }
    const set = planSheetLayerSet('road-context', { stream: creek, fsr: dot, culvert: creek } as never)
    expect(set.symbols.stream).toBe(creek)
    expect(set.symbols.fsr).toBe(PLAN_SHEET_SYMBOLS.fsr)
    expect(set.wholeDeactivated).toBe(false)
    expect(set.layers.find((layer) => layer.id === 'road-sheet-stream-0')).toMatchObject({
      type: 'line',
      paint: { 'line-color': '#0044aa' },
    })
    // Without a style the set is the sheet's own, layer for layer.
    const own = planSheetLayerSet('road-context')
    expect(own.layers).toEqual(planSheetLayers('road-context'))
    expect(own.ids).toEqual(PLAN_SHEET_LAYER_IDS)
    expect(own.roadHitIds).toEqual(PLAN_SHEET_ROAD_HIT_LAYER_IDS)
    expect(planSheetSymbolSet().symbols).toEqual(PLAN_SHEET_SYMBOLS)
  })

  it('draws a deactivated road with its saved style alone, on the map, in a click and in the legend', () => {
    const closed = { kind: 'line' as const, label: 'Closed road', layers: [{ color: '#654321', width: 2 }] }
    const set = planSheetLayerSet('road-context', { deactivated: closed })
    expect(set.wholeDeactivated).toBe(true)
    const not = ['!', ['==', ['get', 'sheetDeactivated'], true]]
    for (const key of ['fsr', 'existingRoad'])
      expect(set.layers.find((layer) => layer.id === `road-sheet-${key}-0`)).toMatchObject({
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['all', ['==', ['get', 'sheetKey'], key], not]],
      })
    expect(set.roadHitIds).toEqual([...PLAN_SHEET_ROAD_HIT_LAYER_IDS, 'road-sheet-deactivated-0'])
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    const entries = buildPlanLegend({
      sources: {
        roads: empty,
        corridor: empty,
        formation: empty,
        edges: empty,
        ditches: empty,
        cable: empty,
        structures: empty,
        draft: empty,
        section: empty,
        ticks: empty,
        context: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: road().geometry,
              properties: { kind: 'existing-road', sheetKey: 'existingRoad', sheetDeactivated: true },
            },
          ],
        },
      },
      alignments: createDemoProject().alignments,
      maxGradePercent: 12,
      terrainOnly: false,
      showEarthwork: true,
      sheetSymbols: true,
      sheetSymbolSet: set,
    }).find((section) => section.id === 'context')!.entries
    expect(entries.map((entry) => entry.sheetSymbol)).toEqual([closed])
  })

  it('lists the sheet symbols in the legend only for what is drawn, and only while they are on', () => {
    const feature = (geometry: GeoJSON.Geometry, properties: Record<string, unknown>): GeoJSON.Feature => ({
      type: 'Feature',
      geometry,
      properties,
    })
    const polygon: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-122.7, 53.9],
          [-122.71, 53.91],
          [-122.71, 53.9],
          [-122.7, 53.9],
        ],
      ],
    }
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    const sources: PlanLegendSources = {
      roads: empty,
      corridor: empty,
      formation: empty,
      edges: empty,
      ditches: empty,
      cable: empty,
      structures: empty,
      draft: empty,
      section: empty,
      ticks: empty,
      context: {
        type: 'FeatureCollection',
        features: [
          feature(polygon, { kind: 'stream', riparianBand: 'reserve', sheetKey: 'riparianReserve' }),
          feature(road().geometry, { kind: 'existing-road', sheetKey: 'existingRoad', sheetDeactivated: true }),
        ],
      },
    }
    const build = (sheetSymbols: boolean) =>
      buildPlanLegend({
        sources,
        alignments: createDemoProject().alignments,
        maxGradePercent: 12,
        terrainOnly: false,
        showEarthwork: true,
        sheetSymbols,
      }).find((section) => section.id === 'context')!.entries
    const on = build(true)
    expect(on.map((entry) => entry.sheetSymbol)).toEqual([
      RIPARIAN_SCREEN.reserve,
      PLAN_SHEET_SYMBOLS.existingRoad,
      ROAD_DEACTIVATION,
    ])
    expect(on[0].label).toBe('Riparian reserve zone (screen)')
    expect(build(false).every((entry) => !entry.sheetSymbol)).toBe(true)
  })
})
