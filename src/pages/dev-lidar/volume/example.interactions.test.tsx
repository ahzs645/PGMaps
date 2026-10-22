import { readFileSync } from 'node:fs'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { VolumeWorkspace } from './VolumeWorkspace'
import type { VolumeExample } from './example'
const download = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/lib/download', () => ({ downloadText: download }))
vi.mock('./VriVolumeWorkspace', () => ({ VriVolumeWorkspace: () => <section aria-label="BC VRI volume workspace" /> }))
vi.mock('../comparisons/ComparisonMap', () => ({
  ComparisonMap: (p: {
    label: string
    features?: unknown
    references?: unknown
    onFeaturePick?: (id: string) => void
    onReferencePick?: (id: string) => void
  }) => (
    <div
      aria-label={p.label}
      data-features={p.features}
      data-references={p.references}
      data-pick={p.onFeaturePick}
      data-reference-pick={p.onReferencePick}
    />
  ),
}))
const data: VolumeExample = JSON.parse(readFileSync(new URL('./example.generated.json', import.meta.url), 'utf8'))
const hiddenAncestor = (node: ReactTestInstance): boolean | undefined => {
  for (let current: ReactTestInstance | null = node; current; current = current.parent)
    if (current.type === 'div' && typeof current.props.hidden === 'boolean') return current.props.hidden
}
describe('completed example first', () => {
  it('opens actual results without BC calibration; inspects cells/references, changes scenario and exports', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => data })),
    )
    let renderer: ReturnType<typeof create>
    try {
      await act(async () => {
        renderer = create(
          <MemoryRouter>
            <VolumeWorkspace summary={null} basemap="none" error="" />
          </MemoryRouter>,
        )
      })
      expect(hiddenAncestor(renderer!.root.findByProps({ 'aria-label': 'BC VRI volume workspace' }))).toBe(false)
      await act(async () =>
        renderer!.root
          .findAllByType('button')
          .find((b) => b.children.join('') === 'Completed example')!
          .props.onClick(),
      )
      const example = renderer!.root.findByProps({ 'aria-label': 'Completed forest volume example' })
      expect(hiddenAncestor(example)).toBe(false)
      const map = () => renderer!.root.findByProps({ 'aria-label': 'Completed merchantable volume map' })
      expect(map().props['data-features'].features).toHaveLength(9073)
      expect(map().props['data-references'].features).toHaveLength(169)
      const cell = data.map.cells.features.find((f) => f.properties.volume_m3_ha !== null)!
      await act(async () => map().props['data-pick'](cell.properties.id))
      expect(
        map().props['data-features'].features.find(
          (f: { properties: { id: string } }) => f.properties.id === cell.properties.id,
        ).properties.selected,
      ).toBe(true)
      await act(async () => map().props['data-reference-pick'](data.references.features[0].properties.id))
      expect(
        example.findAllByProps({ role: 'status' }).some((r) => r.children.join('').includes('field-derived')),
      ).toBe(true)
      await act(async () =>
        renderer!.root
          .findByProps({ 'aria-label': 'Example volume retained' })
          .props.onChange({ target: { value: '50' } }),
      )
      const button = (name: string) => renderer!.root.findAllByType('button').find((b) => b.children.join('') === name)!
      await act(async () => button('Download completed result').props.onClick())
      const output = JSON.parse(download.mock.calls.at(-1)![0])
      expect(output.metadata.target).toBe('merchantable stem volume')
      expect(output.metadata.scenario.recovered_m3).toBeCloseTo(35272.22000577723 * 0.5 * 0.9, 5)
      expect(
        output.features.some(
          (f: { properties: { volume_m3_ha: number | null } }) => f.properties.volume_m3_ha === null,
        ),
      ).toBe(true)
      await act(async () => button('LiDAR height').props.onClick())
      await act(async () => button('How volume is measured').props.onClick())
      expect(hiddenAncestor(renderer!.root.findByProps({ 'aria-label': 'Forest volume measurement practices' }))).toBe(
        false,
      )
      await act(async () => button('Calibrate BC tile').props.onClick())
      expect(hiddenAncestor(renderer!.root.findByProps({ 'aria-label': 'Forest volume workspace' }))).toBe(false)
      expect(button('Fit volume model').props.disabled).toBe(true)
      await act(async () => button('Completed example').props.onClick())
      expect(renderer!.root.findByProps({ 'aria-label': 'Example volume retained' }).props.value).toBe(50)
      await act(async () => renderer!.unmount())
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
