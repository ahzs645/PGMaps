import { readFileSync } from 'node:fs'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AnalysisSummary } from '../types'
import type { ForestData } from '../forestry'
import { ForestVolumeWorkspace } from './ForestVolumeWorkspace'
import { volumeEligible } from './model'
const download = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/lib/download', () => ({ downloadText: download }))
vi.mock('../comparisons/ComparisonMap', () => ({
  ComparisonMap: (props: { label: string; features: { features: unknown[] }; onFeaturePick: (id: string) => void }) => (
    <div aria-label={props.label} data-features={props.features} onClick={() => props.onFeaturePick('unused')} />
  ),
}))
const data: ForestData = JSON.parse(readFileSync(new URL('../forestry.generated.json', import.meta.url), 'utf8'))
const summary = { source_sha256: data.source_sha256, bounds_wgs84: [-122.83, 53.88, -122.8, 53.9] } as AnalysisSummary
describe('volume calibration and selected-area workflow', () => {
  it('starts without volume predictions, fits supplied labels and exports only a declared scenario', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => data })),
    )
    let renderer: ReturnType<typeof create>
    try {
      await act(async () => {
        renderer = create(<ForestVolumeWorkspace summary={summary} basemap="none" error="" />)
      })
      const map = () => renderer!.root.findByProps({ 'aria-label': 'Forest volume planning map' })
      expect(
        map().props['data-features'].features.every(
          (f: { properties: { volume_m3_ha: number | null } }) => f.properties.volume_m3_ha === null,
        ),
      ).toBe(true)
      // Test-only synthetic labels check the browser's calibration plumbing.
      const refs = data.plots.features.filter((f) => volumeEligible(f.properties)).slice(0, 30)
      const csv =
        'plot_id,volume_m3_ha\n' +
        refs.map(({ properties: p }) => `${p.id},${8 + 9 * p.surface_p95_m + (60 * p.canopy_percent) / 100}`).join('\n')
      await act(async () =>
        renderer!.root
          .findByProps({ 'aria-label': 'Volume reference source' })
          .props.onChange({ target: { value: 'Numerical test fixture; not observed volumes' } }),
      )
      await act(async () =>
        renderer!.root.findByProps({ 'aria-label': 'Volume reference CSV' }).props.onChange({ target: { value: csv } }),
      )
      const button = (name: string) => renderer!.root.findAllByType('button').find((b) => b.children.join('') === name)!
      await act(async () => button('Fit volume model').props.onClick())
      expect(
        map().props['data-features'].features.some(
          (f: { properties: { volume_m3_ha: number | null } }) => f.properties.volume_m3_ha !== null,
        ),
      ).toBe(true)
      await act(async () => button('Select supported plots').props.onClick())
      await act(async () =>
        renderer!.root
          .findAllByType('input')
          .find((node) => node.props['aria-label'] === 'Volume volume retained')!
          .props.onChange({ target: { value: '25' } }),
      )
      await act(async () => button('Export selected volume scenario').props.onClick())
      const output = JSON.parse(download.mock.calls.at(-1)![0])
      expect(output.features.length).toBeGreaterThanOrEqual(30)
      expect(output.metadata.scenario.area_ha).toBe(output.features.length * 0.25)
      expect(output.metadata.scenario.scenario_delivered_m3).toBeCloseTo(
        output.metadata.scenario.gross_stem_m3 * 0.75,
        7,
      )
      expect(output.metadata.status).toContain('Experimental')
      await act(async () =>
        renderer!.root
          .findByProps({ 'aria-label': 'Volume reference CSV' })
          .props.onChange({ target: { value: 'plot_id,volume_m3_ha\n' } }),
      )
      expect(
        map().props['data-features'].features.every(
          (f: { properties: { volume_m3_ha: number | null } }) => f.properties.volume_m3_ha === null,
        ),
      ).toBe(true)
      await act(async () => renderer!.unmount())
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
