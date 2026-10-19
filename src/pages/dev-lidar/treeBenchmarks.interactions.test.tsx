import { readFileSync } from 'node:fs'
import { act, create } from 'react-test-renderer'
import { describe, it, expect, vi } from 'vitest'
import { TreeBenchmarks, type BenchmarkPreview, type BenchmarkData } from './TreeBenchmarks'
import type { TreeIsolation } from './treeIsolation'
vi.mock('./ProfileCanvas', () => ({ ProfileCanvas: () => <div>Observed method profile</div> }))
const data = JSON.parse(
  readFileSync(new URL('./treeBenchmarks.generated.json', import.meta.url), 'utf8'),
) as BenchmarkData
const source = JSON.parse(
  readFileSync(new URL('./treeIsolation.generated.json', import.meta.url), 'utf8'),
) as TreeIsolation
describe('actual method comparison interaction', () => {
  it('switches real plot/method outputs, exposes unassigned treeX results, and clears previews on exit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => data })),
    )
    const onPreview = vi.fn<(p: BenchmarkPreview | null) => void>(),
      onFocus = vi.fn()
    let renderer: ReturnType<typeof create>
    try {
      await act(async () => {
        renderer = create(<TreeBenchmarks source={source} onPreview={onPreview} onFocus={onFocus} onPick={() => {}} />)
      })
      expect(onPreview.mock.calls.at(-1)![0]?.crop.id).toBe('crown-3146-north / watershed')
      await act(async () =>
        renderer!.root
          .findByProps({ 'aria-label': 'Segmentation method A · map' })
          .props.onChange({ target: { value: 'pointtree-treex' } }),
      )
      const result = onPreview.mock.calls.at(-1)![0]!
      expect(result.crop.points).toHaveLength(2800)
      expect(Object.values(result.assignments).every((id) => id === '0')).toBe(true)
      await act(async () =>
        renderer!.root
          .findByProps({ 'aria-label': 'Segmentation benchmark plot' })
          .props.onChange({ target: { value: 'crown-85' } }),
      )
      expect(onPreview.mock.calls.at(-1)![0]?.crop.id).toBe('crown-85 / pointtree-treex')
      expect(onFocus).toHaveBeenLastCalledWith(data.plots[1].centre, expect.any(Number))
      await act(async () => renderer!.unmount())
      expect(onPreview).toHaveBeenLastCalledWith(null)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
