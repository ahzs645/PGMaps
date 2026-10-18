import { describe, expect, it, vi } from 'vitest'
import type { LayerSpecification } from 'maplibre-gl'
import { applyBasemap, SATELLITE_LAYER } from './basemaps'
import { applyAnalysisLayers, applyPointCloudVisibility } from './mapLayers'
import { REVIEW_WORKFLOWS } from './reviewWorkflows'

describe('complete workflow layer transitions', () => {
  it('keeps an asynchronously loaded cloud hidden/paused after leaving 3D and resumes without reloading it', () => {
    const control = { setOpacity: vi.fn(), pauseStreaming: vi.fn(), resumeStreaming: vi.fn() }
    applyPointCloudVisibility(control, null, false)
    expect(control.setOpacity).toHaveBeenLastCalledWith(0)
    applyPointCloudVisibility(control, 'existing-cloud', false)
    expect(control.pauseStreaming).toHaveBeenLastCalledWith('existing-cloud')
    applyPointCloudVisibility(control, 'existing-cloud', true)
    expect(control.setOpacity).toHaveBeenLastCalledWith(1)
    expect(control.resumeStreaming).toHaveBeenLastCalledWith('existing-cloud')
  })
  it('replaces a dirty prior view and hides unrelated context and analysis in each workflow', () => {
    const keys = ['height', 'terrain', 'slope', 'cover', 'crowns', 'support']
    const visibility: Record<string, unknown> = {}
    const map = {
      setLayoutProperty: (id: string, _key: string, value: unknown) => {
        visibility[id] = value
      },
      setPaintProperty: () => {},
      setFilter: () => {},
    }
    const context: LayerSpecification[] = [
      { id: 'vector-road', type: 'line', source: 'vector' },
      { id: 'vector-label', type: 'symbol', source: 'vector' },
    ]
    const expectations = [
      ['structure', ['roofs-fill', 'roofs-line']],
      ['canopy', [SATELLITE_LAYER, 'analysis-height', 'trees']],
      ['roofs', [SATELLITE_LAYER, 'roofs-fill', 'roofs-line']],
      ['support', ['vector-road', 'vector-label', 'analysis-support']],
      ['structure', ['roofs-fill', 'roofs-line']],
    ] as const
    for (const [id, expected] of expectations) {
      for (const layer of [
        ...keys.map((key) => `analysis-${key}`),
        'trees',
        'roofs-fill',
        'roofs-line',
        'reference-area',
        'reference-trees',
        'vector-road',
        'vector-label',
        SATELLITE_LAYER,
      ])
        visibility[layer] = 'visible'
      const workflow = REVIEW_WORKFLOWS.find((entry) => entry.id === id)!
      applyBasemap(map as unknown as Parameters<typeof applyBasemap>[0], context, workflow.basemap, workflow.labels)
      applyAnalysisLayers(map as unknown as Parameters<typeof applyAnalysisLayers>[0], keys, {
        ...workflow,
        reference: false,
        minTreeHeight: 5,
      })
      expect(
        Object.entries(visibility)
          .filter(([, value]) => value === 'visible')
          .map(([key]) => key)
          .sort(),
        id,
      ).toEqual([...expected].sort())
      expect(workflow.cloud, id).toBe(id === 'structure')
    }
  })
})
