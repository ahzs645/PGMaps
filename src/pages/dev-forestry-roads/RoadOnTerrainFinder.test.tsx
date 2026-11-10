import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { unreviewedRoadEvidence } from './existingRoadEvidence'
import { benchEvidence, benchMappedLine, benchTerrain } from './roadBenchFixture'
import { RoadOnTerrainFinder } from './RoadOnTerrainFinder'
import { sampleBilinear } from './surfaceGrid'
import { createDemoProject, localMetricGrid } from './terrain'
import type { Alignment, RoadProject } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'
import { keepVegetationEvidence } from './vegetationEvidenceStore'

// Renderer tests run without a DOM: the tooltip and panels are plain wrappers here.
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children }: { children: ReactNode }) => createElement('div', { role: 'alert' }, children),
  KeyValueRows: ({ rows }: { rows: Array<{ key: string; label: string; value: ReactNode } | null> }) =>
    createElement(
      'dl',
      {},
      rows.filter(Boolean).map((row) => createElement('div', { key: row!.key, 'data-row': row!.key }, row!.value)),
    ),
}))
vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children, summary }: { children: ReactNode; summary: ReactNode }) =>
    createElement('section', { 'data-summary': summary }, children),
}))

it('finds and grades the road with the point cloud, and records the state only as dated LiDAR evidence', async () => {
  // The bench fixture sits in UTM zone 10 metres, which is the demo terrain's analysis grid there.
  const bench = benchTerrain()
  const grid = localMetricGrid([-123, 54.1])
  const sha256 = 'a'.repeat(64)
  keepVegetationEvidence(sha256, { evidence: benchEvidence() })
  const demo = createDemoProject()
  let project: RoadProject = {
    ...demo,
    terrain: { ...demo.terrain, sha256, resolutionM: 1 },
    context: [
      {
        id: 'main',
        name: 'R01234',
        kind: 'existing-road',
        geometry: { type: 'LineString', coordinates: benchMappedLine(10).map((p) => grid.toLonLat(p)) },
        roadEvidence: unreviewedRoadEvidence('bc-ften'),
      },
    ],
  }
  const alignment: Alignment = {
    ...demo.alignments[0],
    points: benchMappedLine(10).map((p, i) => ({
      ...demo.alignments[0].points[0],
      id: `p${i}`,
      coordinate: grid.toLonLat(p),
    })),
    mappedRoad: {
      source: 'bc-ften',
      roadName: 'R01234',
      contextIds: ['main'],
      sourceIds: ['1'],
      sourceVertexCount: 31,
      thinningToleranceM: 0,
      joinGapsM: [],
      partsLeftOut: 0,
    },
  }
  const source = { elevationAt: (lon: number, lat: number) => sampleBilinear(bench, ...grid.toGrid([lon, lat])) }
  const setNotice = vi.fn()
  const workspace = () =>
    ({
      project,
      source,
      alignment,
      update: (change: (p: RoadProject) => RoadProject) => {
        project = change(project)
      },
      setNotice,
      setError: vi.fn((message: string) => {
        if (message) throw Error(message)
      }),
    }) as unknown as RoadWorkspace
  const view = () => createElement(RoadOnTerrainFinder, { workspace: workspace(), onStation: vi.fn() })
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(view())
  })
  const byTestId = (id: string) => renderer.root.findByProps({ 'data-testid': id })
  const text = (node: { children: unknown[] }): string =>
    node.children.map((c) => (typeof c === 'string' ? c : text(c as { children: unknown[] }))).join('')
  expect(text(byTestId('road-find-mode'))).toMatch(/^Point cloud: 1 m, 10\.0 returns per m²/)
  expect(renderer.root.findByProps({ 'data-summary': 'Corridor 40 m · pull 0.1 · edge 0.15 m' })).toBeTruthy()

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
  const findButton = renderer.root.findAll((n) => n.type === 'button' && text(n).includes('Find on terrain'))[0]
  await act(async () => findButton.props.onClick())
  const state = await eventually(() => byTestId('road-state'))
  expect(text(byTestId('road-find-used'))).toMatch(/^Used: terrain \+ vegetation\./)
  expect(text(state)).toMatch(/State \(LiDAR\): Class 1/)
  expect(renderer.root.findByProps({ 'data-row': 'drivable' })).toBeTruthy()

  // Recording needs the acquisition date; it then adds an unreviewed LiDAR observation and leaves
  // the condition alone.
  const record = renderer.root.findAll((n) => n.type === 'button' && text(n).includes('Record as LiDAR evidence'))[0]
  expect(record.props.disabled).toBe(true)
  const date = renderer.root.findAll((n) => n.type === 'input' && n.props.type === 'date')[0]
  await act(async () => date.props.onChange({ target: { value: '2025-08-14' } }))
  await act(async () => renderer.update(view()))
  await act(async () =>
    renderer.root
      .findAll((n) => n.type === 'button' && text(n).includes('Record as LiDAR evidence'))[0]
      .props.onClick(),
  )
  const evidence = project.context.find((f) => f.id === 'main')!.roadEvidence!
  expect(evidence.condition).toBe('unknown')
  expect(evidence.conditionBasis).toBe('unreviewed')
  expect(evidence.observations).toHaveLength(1)
  expect(evidence.observations![0]).toMatchObject({
    source: 'lidar',
    component: 'surface',
    observedAt: '2025-08-14',
    finding: 'serviceable',
    lidar: { stateClass: 1 },
  })
  expect(evidence.observations![0].review).toBeUndefined()
  expect(setNotice.mock.calls.at(-1)![0]).toMatch(/planning condition is unchanged/)
  await act(async () => renderer.unmount())
}, 30_000)
