import { isSpeciesMode, type SpeciesData } from './species'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { isHeatmapMode, type CanopyHeatmaps } from './canopyHeatmaps'
import { isForestMode, type ForestData } from './forestry'
import { WorkflowPanel } from './WorkflowPanel'
import {
  ANALYSIS_MODES,
  INITIAL_ANALYSIS,
  sortedWorkflowFeatures,
  type ModelData,
  type WorkflowData,
} from './analysisWorkflows'

// SSR does not have a scroll viewport; render a bounded set of real result rows.
vi.mock('@/components/ui/virtual-result-list', () => ({
  VirtualResultList: ({ items, children }: { items: unknown[]; children: (item: unknown) => unknown }) =>
    createElement('div', null, ...(items.slice(0, 2).map(children) as never[])),
}))
const data = {
  species: JSON.parse(readFileSync(new URL('./species.generated.json', import.meta.url), 'utf8')) as SpeciesData,
  heatmaps: JSON.parse(readFileSync(new URL('./heatmaps.generated.json', import.meta.url), 'utf8')) as CanopyHeatmaps,
  forestry: JSON.parse(readFileSync(new URL('./forestry.generated.json', import.meta.url), 'utf8')) as ForestData,
  workflows: JSON.parse(readFileSync(new URL('./workflows.generated.json', import.meta.url), 'utf8')) as WorkflowData,
  models: JSON.parse(readFileSync(new URL('./models.generated.json', import.meta.url), 'utf8')) as ModelData,
}
const callbacks = {
  retry: vi.fn(),
  onMeshVisible: vi.fn(),
  onMode: vi.fn(),
  onOptions: vi.fn(),
  onSelect: vi.fn(),
  onPoints: vi.fn(),
  onForestPoints: vi.fn(),
}
describe('workflow interface rendering', () => {
  for (const mode of ANALYSIS_MODES)
    it(`renders real ${mode.id} results, parameters, focus and downloads`, () => {
      const options = { ...INITIAL_ANALYSIS, mode: mode.id }
      const features = sortedWorkflowFeatures(data.workflows, options, data.forestry, data.species)
      const html = renderToStaticMarkup(
        createElement(WorkflowPanel, {
          ...callbacks,
          data,
          error: '',
          options,
          features,
          selected: features[0] ?? null,
          model: data.models.records[0],
          meshVisible: true,
        }),
      )
      for (const label of ANALYSIS_MODES.map((item) => item.label)) expect(html).toContain(label.replace(/&/g, '&amp;'))
      expect(html).toContain('Reproduce &amp; download')
      expect(html).toContain('Roofer CityJSONSequence')
      if (isSpeciesMode(mode.id)) {
        expect(html).toContain('Species mix source')
        expect(html).toContain('Download predictions, folds &amp; provenance')
        expect(html).toContain('Focus selected stand')
        expect(html).toContain('21 stands')
        expect(html).not.toContain('undefined')
      } else if (isHeatmapMode(mode.id)) {
        expect(html).toContain('Canopy heatmap opacity')
        expect(html).toContain('Canopy heatmap colour legend')
        expect(html).toContain('Download coloured PNG')
        expect(html).toContain(mode.id === 'canopy-height' ? '40 m' : 'Canopy density threshold')
        expect(html.replace(/<[^>]*>/g, '')).not.toContain('NaN')
      } else if (isForestMode(mode.id)) {
        expect(html).toContain('Vertical return fingerprint')
        expect(html).toContain('Pin as comparison B')
        expect(html).toContain('Download field-check CSV')
        expect(html).toContain('Inspect 3D points')
        expect(html).toContain(features[0].properties.id)
        expect(html).not.toContain('undefined')
        expect(html.replace(/<[^>]*>/g, '')).not.toContain('NaN')
      } else if (mode.id === 'models') {
        expect(html).toContain('Review decision')
        expect(html).toContain('Review notes')
        expect(html).toContain('Compare original 3D points')
        expect(html).toContain('Export review')
        expect(html).toContain('unverified roof patches')
      } else {
        expect(html).toContain('Download shown GeoJSON')
        expect(html).toContain('Focus on map')
        expect(html).toContain(features[0].properties.id)
        expect(html).toContain(
          mode.id === 'gaps'
            ? 'Minimum opening area'
            : mode.id === 'plots'
              ? 'Minimum supported coverage'
              : 'Cell-edge range',
        )
      }
    })
  it('shows retry on unavailable data and disables empty result download', () => {
    const options = { ...INITIAL_ANALYSIS, mode: 'gaps' as const }
    const failed = renderToStaticMarkup(
      createElement(WorkflowPanel, {
        ...callbacks,
        data: null,
        error: 'Workflow source version mismatch',
        options,
        features: [],
        selected: null,
        model: null,
        meshVisible: true,
      }),
    )
    expect(failed).toContain('Workflow source version mismatch')
    expect(failed).toContain('Retry')
    const empty = renderToStaticMarkup(
      createElement(WorkflowPanel, {
        ...callbacks,
        data,
        error: '',
        options,
        features: [],
        selected: null,
        model: null,
        meshVisible: true,
      }),
    )
    expect(empty).toContain('0 matching features')
    expect(empty).toMatch(/disabled=""[^>]*>Download shown GeoJSON/)
  })
})
