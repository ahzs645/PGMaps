import { readFileSync } from 'node:fs'
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { TabBar } from '@/components/ui/tab-bar'
import { InventoryViews } from './InventoryWorkspace'
import { downloadText } from '@/lib/download'
import type { InventoryData } from './types'
vi.mock('@/components/layout/MapSectionLayout', () => import('@/pages/dev-lidar/testing/mapSectionLayoutStub'))
vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }))
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
// The InfoTip popover and the legend panel's media query need a browser window.
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))
// The Export menu opens in a portal; list its actions inline as buttons.
vi.mock('@/components/ui/action-menu', () => ({
  ActionMenu: ({ items }: { items: { id: string; type?: string; label?: string; onSelect?: () => void }[] }) =>
    createElement(
      'div',
      null,
      items
        .filter((item) => !item.type || item.type === 'action')
        .map((item) => createElement('button', { key: item.id, onClick: item.onSelect }, item.label)),
    ),
}))
vi.mock('./InventoryLegend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./InventoryLegend')>()),
  InventoryLegend: () => null,
}))
vi.mock('@/components/ui/virtual-result-list', () => ({
  VirtualResultList: (p: { items: unknown[]; children: (i: unknown) => ReactNode }) => (
    <div>{p.items.slice(0, 3).map(p.children)}</div>
  ),
}))
vi.mock('../comparisons/ComparisonMap', () => ({
  ComparisonMap: (p: {
    label: string
    features?: { features: { properties: { id: string } }[] }
    onFeaturePick?: (id: string) => void
    onMapClick?: (p: number[]) => void
    drawing?: boolean
  }) => (
    <div
      data-map={p.label}
      data-features={p.features}
      data-pick={p.onFeaturePick}
      data-click={p.onMapClick}
      data-drawing={p.drawing}
    />
  ),
}))
vi.mock('../comparisons/ComparisonProfile', () => ({ ComparisonProfile: () => <div>Selected core profile</div> }))
vi.mock('./useInventoryPoints', () => ({
  useInventoryPoints: () => ({ core: null, crop: null, error: '', retry: vi.fn() }),
  returnMetrics: () => null,
}))
const data: InventoryData = JSON.parse(readFileSync(new URL('./inventory.generated.json', import.meta.url), 'utf8'))
/** Text inside a node, through icons and nested components. */
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('')
describe('inventory workflow interactions', () => {
  it('switches executed methods, reviews candidates, imports a boundary and exports scoped stand/tree tables', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    })
    let renderer: ReturnType<typeof create>
    try {
      await act(async () => {
        renderer = create(
          <MemoryRouter>
            <InventoryViews data={data} basemap="none" />
          </MemoryRouter>,
        )
      })
      const root = () => renderer!.root
      const map = () => root().findByProps({ 'data-map': 'Tree inventory crown map' })
      const button = (text: string) =>
        root()
          .findAllByType('button')
          .find((b) => textOf(b) === text)!
      expect(map().props['data-features'].features.length).toBeGreaterThan(50)
      await act(async () =>
        root()
          .findByProps({ 'aria-label': 'Inventory method' })
          .props.onChange({ target: { value: 'sat' } }),
      )
      const before = map().props['data-features'].features.length
      const first = map().props['data-features'].features[0].properties.id
      await act(async () => map().props['data-pick'](first))
      await act(async () =>
        root()
          .findByProps({ 'aria-label': 'Inventory review status' })
          .props.onChange({ target: { value: 'excluded' } }),
      )
      const saved = JSON.parse(storage.get(`pgmaps-inventory-review-${data.run_id}`)!)
      expect(saved.reviews[first].status).toBe('excluded')
      await act(async () => button('Tree CSV').props.onClick())
      expect(vi.mocked(downloadText).mock.calls.at(-1)![0]).toContain('excluded')
      await act(async () => button('Stand CSV').props.onClick())
      expect(vi.mocked(downloadText).mock.calls.at(-1)![0]).toContain('supported_hectares')
      await act(async () =>
        root()
          .findAllByType(TabBar)
          .find((n) => n.props.label === 'Inventory panel tab')!
          .props.onChange('models'),
      )
      await act(async () =>
        root()
          .findByProps({ 'aria-label': 'Inventory species scenario' })
          .props.onChange({ target: { value: 'reviewed' } }),
      )
      await act(async () => button('GeoJSON').props.onClick())
      const exported = JSON.parse(vi.mocked(downloadText).mock.calls.at(-1)![0])
      expect(exported.metadata.rules.speciesMode).toBe('reviewed')
      expect(exported.metadata.processing.foresttools_version).toBe('1.0.4')
      expect(
        exported.features.every((f: { properties: { total_stem_m3: null } }) => f.properties.total_stem_m3 === null),
      ).toBe(true)
      await act(async () => button('Draw polygon').props.onClick())
      expect(map().props['data-drawing']).toBe(true)
      const ring = data.support.features.find((f) => f.properties?.id === '1-19')!.geometry.coordinates[0]
      for (const p of ring.slice(0, -1)) await act(async () => map().props['data-click'](p))
      await act(async () => button('Finish polygon').props.onClick())
      expect(map().props['data-drawing']).toBe(false)
      expect(root().findByProps({ 'aria-label': 'Inventory area preset' }).props.value).toBe('custom')
      expect(map().props['data-features'].features.length).toBe(before)
      await act(async () =>
        root()
          .findByProps({ 'aria-label': 'Import inventory polygon' })
          .props.onChange({ target: { files: [{ size: 20, text: async () => '{}' }], value: 'fake' } }),
      )
      expect(
        root()
          .findAllByProps({ role: 'status' })
          .some((n) => textOf(n).includes('Polygon')),
      ).toBe(true)
      await act(async () => button('Save reviews').props.onClick())
      expect(JSON.parse(vi.mocked(downloadText).mock.calls.at(-1)![0]).reviews[first].status).toBe('excluded')
      await act(async () => renderer!.unmount())
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
