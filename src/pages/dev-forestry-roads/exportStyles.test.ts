import { describe, expect, it } from 'vitest'
import { documentProblems, ruleFor } from '@/lib/styleExchange/model'
import { EXISTING_ROAD, ROAD_DEACTIVATION } from '@/lib/forestry/blockSheet/styles'
import { contextShapefileLayers, deactivatedRoadSymbol, roadExportStyleDocument } from './exportStyles'
import { PLAN_SHEET_SYMBOLS } from './planSheetSymbols'
import type { ShapeLayer } from './shapefile'
import type { ContextFeature } from './types'

const line = (id: string, kind: ContextFeature['kind'], extra: Partial<ContextFeature> = {}): ContextFeature => ({
  id,
  name: id,
  kind,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.8, 53.9],
      [-122.79, 53.91],
    ],
  },
  ...extra,
})
const area = (id: string, kind: ContextFeature['kind']): ContextFeature => ({
  id,
  name: id,
  kind,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.8, 53.9],
        [-122.79, 53.9],
        [-122.79, 53.91],
        [-122.8, 53.9],
      ],
    ],
  },
})

const context: ContextFeature[] = [
  line('creek', 'stream'),
  line('ncd', 'stream', { streamAssessment: { importedClass: 'NCD' } as ContextFeature['streamAssessment'] }),
  line('old road', 'existing-road', {
    roadEvidence: { deactivation: { status: 'deactivated' } } as unknown as ContextFeature['roadEvidence'],
  }),
  line('fsr', 'existing-road', { roadEvidence: { roadClass: 'fsr' } as unknown as ContextFeature['roadEvidence'] }),
  area('no-go', 'avoid'),
  area('cb 12', 'harvest'),
]
const roadLayer: ShapeLayer = {
  name: 'road_centrelines',
  type: 'polyline',
  fields: [{ name: 'NAME', type: 'C', length: 80 }],
  features: [
    {
      parts: [
        [
          [-122.8, 53.9],
          [-122.79, 53.9],
        ],
      ],
      attributes: { NAME: 'Main' },
    },
    {
      parts: [
        [
          [-122.8, 53.91],
          [-122.79, 53.91],
        ],
      ],
      attributes: { NAME: 'Spur' },
    },
  ],
}

describe('road export styles', () => {
  const layers = [...contextShapefileLayers(context), roadLayer]
  const document = roadExportStyleDocument('Test', layers, [
    { name: 'Main', color: '#d97706' },
    { name: 'Spur', color: '#2563eb' },
  ])

  it('writes context as line and polygon layers keyed by the plan’s sheet symbol', () => {
    const [lines, areas] = contextShapefileLayers(context)
    expect(lines.type).toBe('polyline')
    expect(lines.features.map((f) => f.attributes.SHEET_KEY)).toEqual(['stream', 'ncd', 'deactivated', 'fsr'])
    expect(areas.type).toBe('polygon')
    expect(areas.features.map((f) => f.attributes.SHEET_KEY)).toEqual(['constraint', 'otherBlock'])
  })

  it('styles every exported feature with the symbol the plan draws it with', () => {
    expect(documentProblems(document)).toEqual([])
    const byId = Object.fromEntries(document.layers.map((layer) => [layer.id, layer]))
    expect(ruleFor(byId.context_lines, { SHEET_KEY: 'stream' })?.symbol).toBe(PLAN_SHEET_SYMBOLS.stream)
    expect(ruleFor(byId.context_areas, { SHEET_KEY: 'constraint' })?.symbol).toBe(PLAN_SHEET_SYMBOLS.constraint)
    // Only keys the features use become rules, plus the fallback.
    expect(byId.context_lines.rules.map((rule) => rule.label)).toHaveLength(5)
    const main = ruleFor(byId.road_centrelines, { NAME: 'Main' })!.symbol
    expect(main.kind === 'line' && main.layers[0].color).toBe('#d97706')
    expect(byId.road_centrelines.label?.field).toBe('NAME')
  })

  it('draws a deactivated road as the existing road with crosses on it', () => {
    const symbol = deactivatedRoadSymbol()
    expect(symbol.layers).toEqual(EXISTING_ROAD.detail.layers)
    expect(symbol.markers).toEqual(ROAD_DEACTIVATION.markers)
  })

  it('draws areas under lines under points', () => {
    expect(document.layers.map((layer) => layer.geometry)).toEqual(['polygon', 'line', 'line'])
  })

  it('uses a library style for the feature it replaces and nothing else', () => {
    const imported = { kind: 'line' as const, label: 'Imported creek', layers: [{ color: '#123456', width: 2 }] }
    const replaced = roadExportStyleDocument('Test', layers, [], { stream: imported })
    const lines = replaced.layers.find((layer) => layer.id === 'context_lines')!
    expect(ruleFor(lines, { SHEET_KEY: 'stream' })?.symbol).toBe(imported)
    expect(ruleFor(lines, { SHEET_KEY: 'ncd' })?.symbol).toBe(PLAN_SHEET_SYMBOLS.ncd)
  })
})
