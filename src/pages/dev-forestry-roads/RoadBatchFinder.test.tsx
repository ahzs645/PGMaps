import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { unreviewedRoadEvidence } from './existingRoadEvidence'
import { RoadBatchFinder } from './RoadBatchFinder'
import type { XY } from './roadGrid'
import { mappedRecord, NET_X0, NET_Y0, networkTerrain, straight } from './roadNetworkFixture'
import { sampleBilinear } from './surfaceGrid'
import { createDemoProject, localMetricGrid } from './terrain'
import type { ContextFeature, RoadProject } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

// Renderer tests run without a DOM: the tooltip and panels are plain wrappers here.
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children }: { children: ReactNode }) => createElement('div', { role: 'alert' }, children),
}))
vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children, summary }: { children: ReactNode; summary: ReactNode }) =>
    createElement('section', { 'data-summary': summary }, children),
}))

it('finds the mapped roads in an area, rebuilds their junction and adopts the chosen ones as copies', async () => {
  // The network fixture sits in UTM zone 10 metres, the demo terrain's analysis grid there.
  const grid = localMetricGrid([-121.5, 54.15])
  const junction: XY = [NET_X0 + 350, NET_Y0 - 400]
  const truths = {
    w: straight([NET_X0 + 60, junction[1]], junction),
    e: straight(junction, [NET_X0 + 640, junction[1]]),
    n: straight(junction, [junction[0], NET_Y0 - 60]),
  }
  const ground = networkTerrain(Object.values(truths))
  const names = { w: 'West 1', e: 'East 2', n: 'Spur 3' }
  const records: ContextFeature[] = (['w', 'e', 'n'] as const).map((id) => ({
    id,
    name: names[id],
    kind: 'existing-road',
    geometry: { type: 'LineString', coordinates: mappedRecord(truths[id], [6, 9]).map((p) => grid.toLonLat(p)) },
    roadEvidence: unreviewedRoadEvidence('bc-ften'),
  }))
  const westBlock: ContextFeature = {
    id: 'block',
    name: 'West block',
    kind: 'harvest',
    geometry: {
      type: 'Polygon',
      coordinates: [
        (
          [
            [NET_X0 + 20, NET_Y0 - 300],
            [NET_X0 + 340, NET_Y0 - 300],
            [NET_X0 + 340, NET_Y0 - 500],
            [NET_X0 + 20, NET_Y0 - 500],
            [NET_X0 + 20, NET_Y0 - 300],
          ] as XY[]
        ).map((p) => grid.toLonLat(p)),
      ],
    },
  }
  const demo = createDemoProject()
  let project: RoadProject = { ...demo, terrain: { ...demo.terrain, resolutionM: 1 }, context: [...records, westBlock] }
  const recordsBefore = JSON.parse(JSON.stringify(records))
  const source = { elevationAt: (lon: number, lat: number) => sampleBilinear(ground, ...grid.toGrid([lon, lat])) }
  const setNotice = vi.fn()
  const onPreview = vi.fn()
  const workspace = () =>
    ({
      project,
      source,
      update: (change: (p: RoadProject) => RoadProject) => {
        project = change(project)
      },
      setNotice,
      setError: vi.fn((message: string) => {
        if (message) throw Error(message)
      }),
    }) as unknown as RoadWorkspace
  const view = () => createElement(RoadBatchFinder, { workspace: workspace(), onPreview })
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(view())
  })
  const byTestId = (id: string) => renderer.root.findByProps({ 'data-testid': id })
  const text = (node: { children: unknown[] }): string =>
    node.children.map((c) => (typeof c === 'string' ? c : text(c as { children: unknown[] }))).join('')
  const button = (label: string) => renderer.root.findAll((n) => n.type === 'button' && text(n).includes(label))[0]
  expect(text(byTestId('road-batch-selection'))).toMatch(
    /^3 mapped roads with at least 50% of their length on the terrain\./,
  )

  // A drawn area narrows the run to the roads mostly inside it.
  const area = renderer.root.findAll((n) => n.props.ariaLabel === 'Area to search')[0]
  await act(async () => area.props.onValueChange('block'))
  expect(text(byTestId('road-batch-selection'))).toMatch(/^1 mapped road with at least 50% of its length in the area/)
  await act(async () => area.props.onValueChange('terrain'))

  const eventually = async <T,>(find: () => T): Promise<T> => {
    for (let i = 0; i < 400; i++) {
      try {
        return find()
      } catch {
        await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
      }
    }
    return find()
  }
  await act(async () => button('Find 3 roads on terrain').props.onClick())
  const table = await eventually(() => byTestId('road-batch-table'))
  const rows = table.findAll((n) => n.type === 'tr').slice(1)
  expect(rows.map((r) => text(r.findAll((n) => n.type === 'td')[0]))).toEqual(['Found', 'Found', 'Found'])
  expect(text(byTestId('road-batch-junctions'))).toMatch(/^Junctions: 1 rebuilt$/)
  const overlay = onPreview.mock.calls.at(-1)![0] as GeoJSON.FeatureCollection
  expect(overlay.features.filter((f) => f.geometry.type === 'LineString')).toHaveLength(3)

  // Leaving the spur out: it keeps its record, the through road still rejoins, and the junction is listed.
  const spurBox = renderer.root.findAll((n) => n.type === 'input' && n.props['aria-label'] === 'Adopt Spur 3')[0]
  await act(async () => spurBox.props.onChange({ target: { checked: false } }))
  expect(text(byTestId('road-batch-junctions'))).toMatch(/Spur 3, kept as mapped, ends \d+\.\d m from them/)
  await act(async () => button('Adopt 2').props.onClick())
  const added = project.context.filter((f) => f.roadEvidence?.lineOrigin?.method === 'terrain-relocation')
  expect(added.map((f) => f.name)).toEqual(['West 1 · on terrain', 'East 2 · on terrain'])
  expect(added.map((f) => f.roadEvidence!.lineOrigin!.reconnectedEnds)).toEqual([1, 1])
  expect(added.every((f) => f.roadEvidence!.condition === 'unknown' && !f.roadEvidence!.reuseAllowed)).toBe(true)
  // The two adopted halves meet.
  const westEnd = (added[0].geometry.coordinates as number[][]).at(-1)!
  const eastStart = (added[1].geometry.coordinates as number[][])[0]
  expect(westEnd[0]).toBeCloseTo(eastStart[0], 9)
  expect(westEnd[1]).toBeCloseTo(eastStart[1], 9)
  // The records are untouched.
  expect(project.context.filter((f) => ['w', 'e', 'n'].includes(f.id))).toEqual(recordsBefore)
  expect(setNotice).toHaveBeenCalledWith(expect.stringMatching(/^Added 2 roads .* The records are unchanged\.$/))
})
