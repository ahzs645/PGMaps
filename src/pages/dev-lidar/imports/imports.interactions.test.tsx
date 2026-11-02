import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportWorkspace } from './ImportWorkspace'
import { getImportSession, resetImportSession } from './session'
import { downloadText } from '@/lib/download'
vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }))
vi.mock('./ImportMap', () => ({ ImportMap: (p: unknown) => <div data-import-map={p} /> }))
vi.mock('@/components/ui/virtual-result-list', () => ({
  VirtualResultList: (p: { items: unknown[]; children: (i: unknown) => ReactNode }) => (
    <div>
      {p.items.map((item, i) => (
        <div key={i}>{p.children(item)}</div>
      ))}
    </div>
  ),
}))
let renderer: ReactTestRenderer
const features = {
  type: 'FeatureCollection',
  features: [0, 1].map((candidate_id) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-122.8 + candidate_id * 0.001, 53.9] },
    properties: { candidate_id, model: 'sat', assigned_returns: 2088 },
  })),
}
const file = (name: string, value: unknown) => new File([JSON.stringify(value)], name)
const root = () => renderer.root
const mapProps = () =>
  root()
    .findAllByType('div')
    .find((n) => n.props['data-import-map'])!.props['data-import-map']
const button = (label: string) =>
  root()
    .findAllByType('button')
    .find((n) => n.children.join('') === label)!
async function mount() {
  await act(async () => {
    renderer = create(<ImportWorkspace basemap="none" cloudBase="https://example.org/data/lidar/" />)
  })
}
async function importFiles(files: File[], label = 'Import LiDAR or processed layers') {
  await act(async () => {
    root()
      .findByProps({ 'aria-label': label })
      .props.onChange({ target: { files, value: 'selected' } })
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount())
  resetImportSession()
  vi.clearAllMocks()
})

describe('import workspace interface', () => {
  it('imports, picks, searches, hides, changes opacity and restores a saved project', async () => {
    await mount()
    expect(mapProps().session.layers).toHaveLength(0)
    await importFiles([file('sat.geojson', features)])
    expect(getImportSession().layers).toHaveLength(1)
    const id = getImportSession().layers[0].id
    await act(async () => mapProps().onPick(id, 0))
    expect(mapProps().feature).toBe(0)
    expect(JSON.stringify(renderer.toJSON())).toContain('assigned_returns')
    await act(async () =>
      root()
        .findByProps({ 'aria-label': 'Search imported feature IDs' })
        .props.onChange({ target: { value: '1' } }),
    )
    expect(JSON.stringify(renderer.toJSON())).toContain('Features · 1')
    await act(async () =>
      root()
        .findByProps({ 'aria-label': 'Show sat.geojson' })
        .props.onChange({ target: { checked: false } }),
    )
    await act(async () =>
      root()
        .findByProps({ 'aria-label': 'Opacity sat.geojson' })
        .props.onChange({ target: { value: '.35' } }),
    )
    expect(mapProps().session.layers[0]).toMatchObject({ visible: false, opacity: 0.35 })
    await act(async () => button('Save project').props.onClick())
    const saved = vi.mocked(downloadText).mock.calls.at(-1)![0]
    await act(async () => button('Clear session').props.onClick())
    expect(mapProps().session.layers).toHaveLength(0)
    await importFiles([new File([saved], 'lidar-project.pgmaps.json')], 'Restore LiDAR project')
    expect(mapProps().session.layers[0]).toMatchObject({ visible: false, opacity: 0.35 })
    expect(mapProps().feature).toBeNull()
    await act(async () => root().findByProps({ 'aria-label': 'Remove sat.geojson' }).props.onClick())
    expect(mapProps().session.layers).toHaveLength(0)
  })
  it('retains good layers after an invalid file and clears stale feature selection when removing a layer', async () => {
    await mount()
    await importFiles([file('sat.geojson', features), file('forainet.geojson', features)])
    expect(mapProps().session.layers).toHaveLength(2)
    const id = getImportSession().layers[1].id
    await act(async () => mapProps().onPick(id, 1))
    await importFiles([file('bad.geojson', { type: 'FeatureCollection', features: [] })])
    expect(mapProps().session.layers).toHaveLength(2)
    expect(JSON.stringify(renderer.toJSON())).toContain('1–200,000')
    await act(async () => root().findByProps({ 'aria-label': 'Remove forainet.geojson' }).props.onClick())
    expect(mapProps().feature).toBeNull()
    expect(mapProps().selected).toBe(getImportSession().layers[0].id)
    await act(async () => renderer.unmount())
    await mount()
    expect(mapProps().session.layers).toHaveLength(1)
  })
  it('uses streaming sources and drops their URLs from saved projects', async () => {
    await mount()
    await act(async () => button('BC sample EPT').props.onClick())
    expect(mapProps().session.point).toMatchObject({ kind: 'ept', url: 'https://example.org/data/lidar/ept.json' })
    expect(mapProps().view3d).toBe(true)
    await act(async () =>
      root()
        .findByProps({ 'aria-label': 'Streaming COPC or EPT URL' })
        .props.onChange({ target: { value: 'https://example.org/trees.copc.laz?token=test' } }),
    )
    await act(async () => button('Connect stream').props.onClick())
    expect(mapProps().session.point.kind).toBe('copc')
    await act(async () => button('Save project').props.onClick())
    const saved = vi.mocked(downloadText).mock.calls.at(-1)![0]
    expect(saved).not.toContain('token=test')
    await importFiles([new File([saved], 'project.pgmaps.json')], 'Restore LiDAR project')
    expect(mapProps().session.point).toBeNull()
    expect(mapProps().session.missingPoints).toEqual(['trees.copc.laz'])
    await act(async () =>
      root()
        .findByProps({ 'aria-label': 'Streaming COPC or EPT URL' })
        .props.onChange({ target: { value: 'https://example.org/unbounded.laz' } }),
    )
    await act(async () => button('Connect stream').props.onClick())
    expect(mapProps().session.point).toBeNull()
    expect(JSON.stringify(renderer.toJSON())).toContain('ordinary remote LAZ needs conversion')
  })
  it('does not resurrect a cleared session when an asynchronous import finishes', async () => {
    await mount()
    let finish: (value: ArrayBuffer) => void = () => {}
    const pending = new Promise<ArrayBuffer>((resolve) => {
      finish = resolve
    })
    const delayed = { name: 'delayed.geojson', size: 100, slice: () => new Blob(), arrayBuffer: () => pending }
    await act(async () =>
      root()
        .findByProps({ 'aria-label': 'Import LiDAR or processed layers' })
        .props.onChange({ target: { files: [delayed], value: '' } }),
    )
    await act(async () => button('Clear session').props.onClick())
    await act(async () => {
      finish(new TextEncoder().encode(JSON.stringify(features)).buffer)
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(mapProps().session.layers).toHaveLength(0)
  })
})
