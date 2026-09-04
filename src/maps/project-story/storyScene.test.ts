import { describe, expect, it } from 'vitest'

import type { ProjectSceneDef, ProjectStoryLayerDef } from '@/lib/projectPackages'
import { buildLegend, paneZoomOffset, resolveLayer, sameLayerSet } from './storyScene'

const ACCENT = '#047857'

const plainLayer: ProjectStoryLayerDef = {
  id: 'regions',
  data: '/data/regions.geojson',
  idProperty: 'code',
  labelProperty: 'name',
  fillColor: '#059669',
  fillOpacity: 0.3,
  lineColor: '#065f46',
  lineOpacity: 0.9,
  lineWidth: 1.4,
}

const categoricalLayer: ProjectStoryLayerDef = {
  ...plainLayer,
  id: 'health',
  fillColor: '#047857',
  lineColor: '#0f172a',
  lineWidth: 2,
  category: {
    property: 'HLTH_AUTHORITY_NAME',
    colors: { Northern: '#047857', Interior: '#d97706' },
    fallback: '#64748b',
  },
}

function scene(overrides: Partial<ProjectSceneDef> = {}): ProjectSceneDef {
  return {
    label: 'Scene',
    title: 'Title',
    text: 'Body',
    focus: 'Focus',
    visibleLayerIds: ['health'],
    ...overrides,
  }
}

describe('resolveLayer', () => {
  it('passes a flat colour through and builds a match expression for categories', () => {
    expect(resolveLayer(plainLayer, 'Regions', undefined, ACCENT).fillColor).toBe('#059669')
    expect(resolveLayer(categoricalLayer, 'Health', undefined, ACCENT).fillColor).toEqual([
      'match',
      ['get', 'HLTH_AUTHORITY_NAME'],
      'Northern',
      '#047857',
      'Interior',
      '#d97706',
      '#64748b',
    ])
  })

  it('uses the layer defaults when the scene declares no overrides', () => {
    const resolved = resolveLayer(plainLayer, 'Regions', scene(), ACCENT)
    expect(resolved).toMatchObject({ fillOpacity: 0.3, lineOpacity: 0.9, lineWidth: 1.4, lineColor: '#065f46' })
  })

  it('applies scene layer overrides', () => {
    const resolved = resolveLayer(
      plainLayer,
      'Regions',
      scene({ layerOverrides: { regions: { fillOpacity: 0, lineWidth: 2.8, lineOpacity: 1 } } }),
      ACCENT,
    )
    expect(resolved).toMatchObject({ fillOpacity: 0, lineWidth: 2.8, lineOpacity: 1 })
  })

  it('recolours and rebuilds the legend from a scene category override', () => {
    const active = scene({
      layerOverrides: {
        health: {
          category: {
            property: 'status',
            colors: { Current: '#047857', Historical: '#d97706' },
            fallback: '#94a3b8',
          },
        },
      },
    })
    const resolved = resolveLayer(categoricalLayer, 'Health', active, ACCENT)
    expect(resolved.fillColor).toEqual([
      'match',
      ['get', 'status'],
      'Current',
      '#047857',
      'Historical',
      '#d97706',
      '#94a3b8',
    ])
    expect(buildLegend(active, [resolved], new Set(['health']), ACCENT).map((entry) => entry.label)).toEqual([
      'Current',
      'Historical',
    ])
  })

  it('dims unmatched features and thickens the matched outline for a highlight', () => {
    const resolved = resolveLayer(
      categoricalLayer,
      'Health',
      scene({
        highlights: [{ layerId: 'health', property: 'HLTH_AUTHORITY_NAME', values: ['Northern'], dimOpacity: 0.07 }],
      }),
      ACCENT,
    )
    const matched = ['in', ['get', 'HLTH_AUTHORITY_NAME'], ['literal', ['Northern']]]
    expect(resolved.fillOpacity).toEqual(['case', matched, 0.3, 0.07])
    expect(resolved.lineColor).toEqual(['case', matched, ACCENT, '#0f172a'])
    expect(resolved.lineWidth).toEqual(['case', matched, 4, 2])
  })

  it('highlights on top of an override, and honours the highlight colour', () => {
    const resolved = resolveLayer(
      categoricalLayer,
      'Health',
      scene({
        layerOverrides: { health: { fillOpacity: 0.5 } },
        highlights: [{ layerId: 'health', property: 'HLTH_AUTHORITY_NAME', values: ['Interior'], color: '#b45309' }],
      }),
      ACCENT,
    )
    const matched = ['in', ['get', 'HLTH_AUTHORITY_NAME'], ['literal', ['Interior']]]
    // No dimOpacity given, so it falls back to min(fillOpacity, 0.08).
    expect(resolved.fillOpacity).toEqual(['case', matched, 0.5, 0.08])
    expect(resolved.lineColor).toEqual(['case', matched, '#b45309', '#0f172a'])
  })

  it('ignores a highlight aimed at a different layer', () => {
    const resolved = resolveLayer(
      plainLayer,
      'Regions',
      scene({ highlights: [{ layerId: 'health', property: 'name', values: ['Northern'] }] }),
      ACCENT,
    )
    expect(resolved.fillOpacity).toBe(0.3)
  })
})

describe('buildLegend', () => {
  const resolved = [
    resolveLayer(categoricalLayer, 'Health Authorities', undefined, ACCENT),
    resolveLayer(plainLayer, 'Regions', undefined, ACCENT),
  ]

  it('derives category swatches for visible layers only', () => {
    const entries = buildLegend(scene(), resolved, new Set(['health']), ACCENT)
    expect(entries.map((entry) => entry.label)).toEqual(['Northern', 'Interior'])
  })

  it('falls back to one entry per uncategorised layer', () => {
    const entries = buildLegend(scene(), resolved, new Set(['regions']), ACCENT)
    expect(entries).toEqual([{ key: 'regions', label: 'Regions', color: '#059669', layerId: 'regions' }])
  })

  it('appends a caption for a labelled highlight on a visible layer', () => {
    const active = scene({
      highlights: [
        { layerId: 'health', property: 'HLTH_AUTHORITY_NAME', values: ['Northern'], label: 'Northern Health' },
        { layerId: 'regions', property: 'name', values: ['Omineca'], label: 'Hidden layer' },
      ],
    })
    const entries = buildLegend(active, resolved, new Set(['health']), ACCENT)
    expect(entries.at(-1)).toMatchObject({ label: 'Northern Health', color: ACCENT })
    expect(entries.some((entry) => entry.label === 'Hidden layer')).toBe(false)
  })

  it('lets an explicit scene legend replace the derived one', () => {
    const entries = buildLegend(
      scene({ legend: [{ label: 'Census North', color: '#2563eb' }] }),
      resolved,
      new Set(['health', 'regions']),
      ACCENT,
    )
    expect(entries).toEqual([{ key: 'scene-0-Census North', label: 'Census North', color: '#2563eb' }])
  })
})

describe('sameLayerSet', () => {
  it('detects when the reader has changed the scene layer set', () => {
    expect(sameLayerSet(new Set(['a', 'b']), ['b', 'a'])).toBe(true)
    expect(sameLayerSet(new Set(['a']), ['a', 'b'])).toBe(false)
    expect(sameLayerSet(new Set(['a', 'c']), ['a', 'b'])).toBe(false)
  })
})

describe('paneZoomOffset', () => {
  it('leaves the authored zoom alone on a pane at or above the reference size', () => {
    // A desktop story's map pane (1440x900 viewport, panel layout).
    expect(paneZoomOffset({ width: 1060, height: 836 })).toBe(0)
    expect(paneZoomOffset({ width: 4000, height: 3000 })).toBe(0)
  })

  it('costs one zoom level per halving of the tighter axis', () => {
    expect(paneZoomOffset({ width: 500, height: 700 })).toBeCloseTo(-1, 5)
    expect(paneZoomOffset({ width: 1000, height: 350 })).toBeCloseTo(-1, 5)
    // The tighter axis wins: width is halved, height is not.
    expect(paneZoomOffset({ width: 500, height: 3500 })).toBeCloseTo(-1, 5)
  })

  it('stops zooming out past the ceiling, however small the pane', () => {
    expect(paneZoomOffset({ width: 320, height: 260 })).toBe(-1.5)
    expect(paneZoomOffset({ width: 1, height: 1 })).toBe(-1.5)
  })

  it('treats a pane with no size yet as no correction', () => {
    expect(paneZoomOffset({ width: 0, height: 0 })).toBe(0)
    expect(paneZoomOffset({ width: 390, height: 0 })).toBe(0)
  })
})
