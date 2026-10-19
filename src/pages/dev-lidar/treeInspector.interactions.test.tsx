import { useState } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TreeInspector } from './TreeInspector'
import { useTreeInspection, type TreeInspectionController } from './useTreeInspection'
import { isolateTreeReturns } from './useTreeIsolation'
import { downloadText } from '@/lib/download'
import { pointKey } from './treeInspection'
import type { TreeCrop, TreeIsolation, IsolatedPoint } from './treeIsolation'
vi.mock('./useTreeIsolation', () => ({ isolateTreeReturns: vi.fn() }))
vi.mock('@/lib/download', () => ({ downloadText: vi.fn(), downloadBlob: vi.fn() }))
vi.mock('./ProfileCanvas', () => ({
  ProfileCanvas: ({
    crop,
    onPick,
    onSelection,
    onSeed,
  }: {
    crop: TreeCrop
    onPick: (p: IsolatedPoint) => void
    onSelection: (ids: string[]) => void
    onSeed: (p: IsolatedPoint) => void
  }) => (
    <div>
      <button onClick={() => onPick(crop.points[0])}>Test pick observed return</button>
      <button onClick={() => onSelection(crop.points.map(pointKey))}>Test polygon selects actual returns</button>
      <button onClick={() => onSeed(crop.points[0])}>Test first seed</button>
      <button onClick={() => onSeed(crop.points[1])}>Test second seed</button>
    </div>
  ),
}))
vi.mock('@/components/ui/virtual-result-list', () => ({ VirtualResultList: () => null }))
const centre: [number, number] = [-122.81, 53.89]
const source: TreeIsolation = {
  schema_version: 1,
  source_sha256: 'source',
  label_grid_sha256: 'labels',
  input_sha256: {},
  grid: { width: 2, height: 2, bounds: [0, 0, 2, 2], resolution: 1, crs: 'EPSG:3157' },
  crowns: {
    type: 'FeatureCollection',
    features: [1, 2].map((n) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[centre, centre, centre, centre]] },
      properties: {
        id: `crown-${n}`,
        centre,
        centre_utm: [512000, 5971500],
        ground_m: 700,
        height_m: 20,
        crown_area_m2: 4,
        ground_support_m: 1,
        edge: false,
        runs: [[0, 0, 1]],
      },
    })),
  },
}
const crops: Record<string, TreeCrop> = Object.fromEntries(
  [1, 2].map((n) => [
    `crown-${n}`,
    {
      id: `crown-${n}`,
      source_sha256: 'source',
      centre,
      ground_m: 700,
      loaded_points: 100,
      loaded_nodes: 2,
      available_nodes: 2,
      budget_limited: false,
      withheld_filtered: true,
      points: [0, 1].map((i) => ({
        lon: centre[0] + i * 0.00001,
        lat: centre[1],
        height: 10 + i * 10,
        z: 710 + i * 10,
        node: '0-0-0-0',
        index: n * 10 + i,
        classification: 1,
      })),
    },
  ]),
)
let controller: TreeInspectionController, renderer: ReactTestRenderer
let stored: Map<string, string>
function Harness({ visible = true }: { visible?: boolean }) {
  const [id, setId] = useState('crown-1'),
    [picked, setPicked] = useState<IsolatedPoint | null>(null)
  controller = useTreeInspection(source, crops[id], 'https://example.test/analysis/', 'https://example.test/ept.json')
  return visible ? (
    <TreeInspector
      controller={controller}
      crop={crops[id]}
      crown={source.crowns.features.find((f) => f.properties.id === id)!}
      ids={['crown-1', 'crown-2']}
      error=""
      status=""
      onSelect={setId}
      onRetry={() => {}}
      onPick={setPicked}
      picked={picked}
      onTransect={() => {}}
      transect={<p>Native transect controls</p>}
      benchmark={<p>Actual methods</p>}
    />
  ) : null
}
function text(node: ReactTestInstance): string {
  return node.children.map((c) => (typeof c === 'string' ? c : text(c))).join('')
}
function button(label: string) {
  return renderer.root.findAllByType('button').find((b) => text(b) === label)!
}
async function click(label: string) {
  await act(async () => {
    const b = button(label)
    expect(b, `Missing button ${label}`).toBeTruthy()
    expect(b.props.disabled).not.toBe(true)
    b.props.onClick()
  })
}
async function tab(value: string) {
  await act(async () => renderer.root.findByProps({ 'data-tab-value': value }).props.onClick())
}
beforeEach(async () => {
  stored = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, v: string) => stored.set(key, v),
  })
  vi.mocked(isolateTreeReturns).mockImplementation(async (_data, crown) => crops[crown.properties.id])
  await act(async () => {
    renderer = create(<Harness />)
  })
})
afterEach(async () => {
  await act(async () => renderer.unmount())
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
describe('tree inspector interactions without a browser renderer', () => {
  it('picks actual returns, saves view parameters and restores comparison IDs across workflow switches and reload', async () => {
    await click('Test pick observed return')
    expect(renderer.root.findByProps({ 'aria-label': 'Picked original return' })).toBeTruthy()
    await act(async () =>
      renderer.root.findByProps({ 'aria-label': 'Tree profile rotation' }).props.onChange({ target: { value: '90' } }),
    )
    await click('Pin for comparison')
    await click('Next')
    await click('Pin for comparison')
    expect(controller.state.pins).toEqual(['crown-1', 'crown-2'])
    expect(controller.state.settings.angle).toBe(90)
    await act(async () => renderer.update(<Harness visible={false} />))
    await act(async () => renderer.update(<Harness />))
    expect(controller.state.pins).toHaveLength(2)
    const value = [...stored.values()][0]
    expect(value).not.toContain('"points"')
    expect(value).not.toContain('"lon"')
    await act(async () => renderer.unmount())
    await act(async () => {
      renderer = create(<Harness />)
    })
    expect(controller.state.settings.angle).toBe(90)
    expect(controller.state.pins).toEqual(['crown-1', 'crown-2'])
    expect(controller.pinned).toHaveLength(2)
  })
  it('reviews, creates and rejects point groups with undo/redo, then exports the edited labels', async () => {
    await click('Test polygon selects actual returns')
    await tab('review')
    await act(async () =>
      renderer.root
        .findByProps({ 'aria-label': 'Tree review decision' })
        .props.onChange({ target: { value: 'possible structure' } }),
    )
    await act(async () =>
      renderer.root
        .findByProps({ 'aria-label': 'Tree review notes' })
        .props.onChange({ target: { value: 'Check lattice shape' } }),
    )
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Tree review notes' }).props.onBlur())
    expect(controller.state.reviews['crown-1']).toEqual({ decision: 'possible structure', note: 'Check lattice shape' })
    await click('Create group')
    const created = { ...controller.state.assignments }
    expect(Object.keys(created)).toHaveLength(2)
    await click('Reject selected returns')
    expect(Object.values(controller.state.assignments)).toEqual(['0', '0'])
    await click('Undo')
    expect(controller.state.assignments).toEqual(created)
    await click('Redo')
    expect(Object.values(controller.state.assignments)).toEqual(['0', '0'])
    await click('Undo')
    await click('Export review & edits')
    const exported = String(vi.mocked(downloadText).mock.calls.at(-1)![0])
    expect(JSON.parse(exported).assignments).toEqual(created)
    await tab('profile')
    await click('Export visible CSV')
    const csv = String(vi.mocked(downloadText).mock.calls.at(-1)![0])
    expect(csv).toContain('review_group')
    expect(csv).toContain('0-0-0-0,10,edit-crown-1-')
  })
  it('splits loaded returns from picked seeds and rejects a mismatched review import through the interface', async () => {
    await click('Test first seed')
    await click('Test second seed')
    await tab('review')
    await click('Split by nearest 3D seed')
    expect(controller.state.assignments['0-0-0-0:10']).toBe('edit-crown-1-seed-1')
    expect(controller.state.assignments['0-0-0-0:11']).toBe('edit-crown-1-seed-2')
    await act(async () => {
      await renderer.root
        .findByProps({ 'aria-label': 'Import tree review manifest' })
        .props.onChange({
          target: {
            files: [{ size: 100, text: async () => JSON.stringify({ ...controller.state, source_sha256: 'other' }) }],
            value: 'file',
          },
        })
    })
    expect(renderer.root.findAllByProps({ role: 'status' }).some((n) => text(n).includes('mismatch'))).toBe(true)
    expect(controller.state.source_sha256).toBe('source')
    await click('Undo')
    expect(controller.state.assignments).toEqual({})
  })
})
