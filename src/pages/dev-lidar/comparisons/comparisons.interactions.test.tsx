import { readFileSync } from 'node:fs'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { ComparisonData } from './data'
import { ModelComparisonWorkspace } from './ModelComparisonWorkspace'
import { ComparisonPreference } from './ComparisonPreference'
const state = vi.hoisted(() => ({ data: null as ComparisonData | null }))
vi.mock('./useComparisonData', () => ({ useComparisonData: () => ({ data: state.data, error: '', retry: vi.fn() }) }))
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('./ComparisonMap', () => ({
  ComparisonMap: (p: { label: string; crop?: { id: string }; features?: { features: unknown[] } }) => (
    <div aria-label={p.label} data-crop={p.crop?.id} data-feature-count={p.features?.features.length} />
  ),
  sameCamera: () => true,
}))
vi.mock('./ComparisonProfile', () => ({ ComparisonProfile: () => <div>Original-point profile</div> }))
const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
state.data = {
  benchmark: read('../treeBenchmarks.generated.json'),
  rgb: read('./rgb.generated.json'),
  shapes: read('./shapes.generated.json'),
  provenance: read('./provenance.generated.json'),
}
describe('comparison workspace interactions', () => {
  it('loads the individual-tree view directly with full candidate points', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async (url: string) => ({
          ok: true,
          json: async () =>
            read(url.includes('neural-trees') ? './neural-trees.generated.json' : './neural.generated.json'),
        })),
    )
    let renderer: ReturnType<typeof create>
    try {
      await act(async () => {
        renderer = create(
          <MemoryRouter initialEntries={['/dev/lidar/compare/?family=neural&inspect=trees']}>
            <ModelComparisonWorkspace summary={null} error="" basemap="none" />
          </MemoryRouter>,
        )
      })
      expect(renderer!.root.findAllByProps({ 'aria-label': 'Individual segmented tree inspector' })).toHaveLength(1)
      expect(renderer!.root.findByProps({ 'aria-label': 'Isolated neural tree 3D map' }).props['data-crop']).toBe(
        'sat:1-19:164',
      )
      await act(async () => renderer!.unmount())
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('opens the preliminary model comparison directly from its shareable URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => read('./neural.generated.json') }))
    let renderer: ReturnType<typeof create>
    try {
      await act(async () => {
        renderer = create(
          <MemoryRouter initialEntries={['/dev/lidar/compare/?family=neural']}>
            <ModelComparisonWorkspace summary={null} error="" basemap="none" />
          </MemoryRouter>,
        )
      })
      expect(renderer!.root.findAllByProps({ 'aria-label': 'Preliminary neural comparison' })).toHaveLength(1)
      expect(
        renderer!.root.findByProps({ 'aria-label': 'SegmentAnyTree preliminary map' }).props['data-feature-count'],
      ).toBe(416)
      expect(renderer!.root.findAllByProps({ 'aria-label': 'Model run status' })).toHaveLength(0)
      await act(async () => renderer!.unmount())
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('switches real variants and datasets, and clears maps when an unrun model is chosen', async () => {
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
            <ModelComparisonWorkspace summary={null} error="" basemap="none" />
          </MemoryRouter>,
        )
      })
      expect(renderer!.root.findByProps({ 'aria-label': 'LiDAR comparison map A' }).props['data-crop']).toContain(
        'watershed',
      )
      await act(async () =>
        renderer!.root
          .findByProps({ 'aria-label': 'LiDAR model A' })
          .props.onChange({ target: { value: 'pointtree-treex' } }),
      )
      expect(renderer!.root.findByProps({ 'aria-label': 'LiDAR comparison map A' }).props['data-crop']).toContain(
        'pointtree-treex',
      )
      const catalogueButton = (name: string) =>
        renderer!.root
          .findAllByType('button')
          .find((b) => b.findAllByType('strong').some((node) => node.children.join('').includes(name)))!
      await act(async () => catalogueButton('ForestFormer3D').props.onClick())
      expect(renderer!.root.findAllByProps({ 'aria-label': 'LiDAR comparison map A' })).toHaveLength(0)
      expect(renderer!.root.findAllByProps({ 'aria-label': 'Model run status' })).toHaveLength(1)
      await act(async () => catalogueButton('DeepForest').props.onClick())
      expect(renderer!.root.findByProps({ 'aria-label': 'RGB comparison map A' }).props['data-feature-count']).toBe(55)
      await act(async () =>
        renderer!.root.findByProps({ 'aria-label': 'RGB score threshold' }).props.onChange({ target: { value: '.5' } }),
      )
      expect(renderer!.root.findByProps({ 'aria-label': 'RGB comparison map A' }).props['data-feature-count']).toBe(35)
      await act(async () =>
        renderer!.root
          .findByProps({ 'aria-label': 'RGB comparison sample' })
          .props.onChange({ target: { value: 'sjer' } }),
      )
      expect(renderer!.root.findByProps({ 'aria-label': 'RGB comparison map A' }).props['data-feature-count']).toBe(1)
      await act(async () => catalogueButton('Original-return').props.onClick())
      expect(renderer!.root.findByProps({ 'aria-label': 'Shape review map A' }).props['data-crop']).toBe('crown-85')
      await act(async () => renderer!.unmount())
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('saves a dataset-scoped preference and exports its review note', async () => {
    const storage = new Map<string, string>(),
      onExport = vi.fn()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    })
    let renderer: ReturnType<typeof create>
    try {
      await act(async () => {
        renderer = create(
          <ComparisonPreference
            scope="tile/plot"
            left={{ id: 'a', name: 'A model' }}
            right={{ id: 'b', name: 'B model' }}
            onExport={onExport}
          />,
        )
      })
      await act(async () =>
        renderer!.root
          .findByProps({ 'aria-label': 'Comparison review note' })
          .props.onChange({ target: { value: 'A keeps this crown intact' } }),
      )
      await act(async () =>
        renderer!.root
          .findAllByType('button')
          .find((b) => b.props.children === 'Prefer A')!
          .props.onClick(),
      )
      expect(JSON.parse(storage.get('pgmaps-model-choice-v1-tile/plot')!)).toMatchObject({
        preferred: 'a',
        note: 'A keeps this crown intact',
      })
      await act(async () =>
        renderer!.root
          .findAllByType('button')
          .find((b) => b.props.children === 'Download comparison')!
          .props.onClick(),
      )
      expect(onExport).toHaveBeenCalledWith(
        expect.objectContaining({ preferred: 'a', note: 'A keeps this crown intact' }),
      )
      await act(async () =>
        renderer!.update(
          <ComparisonPreference
            scope="tile/other-plot"
            left={{ id: 'a', name: 'A model' }}
            right={{ id: 'b', name: 'B model' }}
            onExport={onExport}
          />,
        ),
      )
      expect(renderer!.root.findByProps({ 'aria-label': 'Comparison review note' }).props.value).toBe('')
      await act(async () => renderer!.unmount())
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
