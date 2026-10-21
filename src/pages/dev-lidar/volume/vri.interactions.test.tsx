import { readFileSync } from 'node:fs'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StatGroup } from '@/components/ui/stat-group'
import { VriVolumeWorkspace } from './VriVolumeWorkspace'
import type { VriVolumeData } from './vri'
import type { AnalysisSummary } from '../types'
const download = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/lib/download', () => ({ downloadText: download }))
vi.mock('../comparisons/ComparisonMap', () => ({
  ComparisonMap: (p: { label: string; features: unknown; onFeaturePick: (id: string) => void }) => (
    <div aria-label={p.label} data-features={p.features} data-pick={p.onFeaturePick} />
  ),
}))
const data: VriVolumeData = JSON.parse(readFileSync(new URL('./vri.generated.json', import.meta.url), 'utf8'))
const summary = { source_sha256: data.source_sha256 } as AnalysisSummary
describe('VRI estimates through the interface', () => {
  it('shows the baseline, switches rules, retains missing data and exports the selected scenario', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => data })),
    )
    let renderer: ReturnType<typeof create>
    try {
      await act(async () => {
        renderer = create(
          <MemoryRouter>
            <VriVolumeWorkspace summary={summary} basemap="none" />
          </MemoryRouter>,
        )
      })
      const root = () => renderer!.root,
        map = () => root().findByProps({ 'aria-label': 'BC VRI volume map' })
      const stats = () => root().findByProps({ 'aria-label': 'VRI volume summary' }).findByType(StatGroup).props.items
      const button = (name: string) =>
        root()
          .findAllByType('button')
          .find((b) => b.children.join('') === name)!
      const change = async (label: string, value: string) =>
        act(async () => root().findByProps({ 'aria-label': label }).props.onChange({ target: { value } }))
      expect(stats()[0].value).toBe('36,796 m³')
      expect(map().props['data-features'].features).toHaveLength(30)
      await change('VRI utilization', '225')
      expect(stats()[0].value).toBe('—')
      expect(
        map().props['data-features'].features.every(
          (f: { properties: { volume_m3_ha: number | null } }) => f.properties.volume_m3_ha === null,
        ),
      ).toBe(true)
      await change('VRI utilization', '175')
      await change('VRI dead volume', 'full')
      expect(stats()[0].label).toContain('partial dead data')
      await act(async () => button('PG planning rules').props.onClick())
      expect(root().findByProps({ 'aria-label': 'VRI utilization' }).props.value).toBe('species')
      expect(root().findByProps({ 'aria-label': 'VRI minimum stand age' }).props.value).toBe(60)
      expect(root().findByProps({ 'aria-label': 'VRI dead volume' }).props.value).toBe('shelf')
      await act(async () => button('Inventory baseline').props.onClick())
      await act(async () => button('Clear selection').props.onClick())
      expect(stats()[0].value).toBe('—')
      const feature = data.stands.features.find((f) => f.properties.inventory.BCLCS_LEVEL_2 === 'T')!
      await act(async () => map().props['data-pick'](feature.properties.id))
      const knownVolume = feature.properties.area_ha * Number(feature.properties.inventory.LIVE_STAND_VOLUME_175)
      expect(stats()[0].value).toBe(`${Math.round(knownVolume).toLocaleString('en-CA')} m³`)
      await change('VRI volume retained', '20')
      await change('VRI extraction recovery', '90')
      await act(async () => button('LiDAR p95 by stand').props.onClick())
      expect(stats()[0].value).toBe(`${Math.round(knownVolume).toLocaleString('en-CA')} m³`)
      await act(async () => button('Download VRI scenario').props.onClick())
      const output = JSON.parse(download.mock.calls.at(-1)![0])
      expect(output.features).toHaveLength(1)
      expect(output.features[0].properties.inventory.FEATURE_ID).toBe(feature.properties.inventory.FEATURE_ID)
      expect(output.metadata.totals.known_net_m3).toBeCloseTo(knownVolume, 8)
      expect(output.metadata.totals.scenario_recovered_m3).toBeCloseTo(knownVolume * 0.72, 8)
      expect(output.metadata.rules.utilization).toBe(175)
      expect(output.metadata.source.inventory_sha256).toBe(data.source.inventory_sha256)
      await act(async () => button('All treed stands').props.onClick())
      expect(stats()[0].value).toBe('36,796 m³')
      await act(async () => renderer!.unmount())
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('refuses a snapshot for a different source instead of displaying its map', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => data })),
    )
    let renderer: ReturnType<typeof create>
    try {
      await act(async () => {
        renderer = create(
          <MemoryRouter>
            <VriVolumeWorkspace summary={{ source_sha256: 'different' } as AnalysisSummary} basemap="none" />
          </MemoryRouter>,
        )
      })
      expect(renderer!.root.findAllByProps({ 'aria-label': 'BC VRI volume map' })).toHaveLength(0)
      expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toContain('source mismatch')
      await act(async () => renderer!.unmount())
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
