import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { SkidReachPanel } from './SkidReachPanel'
import { offsetCoordinate } from './engine'
import { createDemoProject } from './terrain'
import type { Coordinate, RoadProject } from './types'
import type { SidebarProps } from './DesignSidebarBody'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
// Renderer tests run without a DOM: the tooltip and alert are plain wrappers here.
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children }: { children: ReactNode }) => createElement('div', {}, children),
}))
vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
}))

it('runs skid reach, suggests spurs and adds one only when asked', async () => {
  const origin: Coordinate = [-122.6, 54.0]
  const at = (x: number, y: number) => offsetCoordinate(offsetCoordinate(origin, 90, x), 0, y)
  const demo = createDemoProject()
  let project: RoadProject = {
    ...demo,
    context: [
      {
        id: 'block',
        name: 'Block A',
        kind: 'harvest',
        geometry: {
          type: 'Polygon',
          coordinates: [[at(-200, 10), at(200, 10), at(200, 810), at(-200, 810), at(-200, 10)]],
        },
      },
      {
        id: 'main',
        name: 'Main road',
        kind: 'existing-road',
        geometry: { type: 'LineString', coordinates: [at(-900, 0), at(900, 0)] },
      },
    ],
  }
  const commit = vi.fn((next: RoadProject) => {
    project = next
  })
  const preview = vi.fn()
  const workspace = () => ({
    project,
    source: { elevationAt: () => 700 },
    analyses: new Map(),
    alignment: project.alignments[0],
    busy: '',
    commit,
    setBusy: vi.fn(),
    setBusyCancel: vi.fn(),
    setBusyProgress: vi.fn(),
    setNotice: vi.fn(),
    setError: vi.fn((message: string) => {
      if (message) throw Error(message)
    }),
  })
  const view = () =>
    createElement(SkidReachPanel, { workspace: workspace(), onPreviewSkidReach: preview } as unknown as SidebarProps)
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(view())
  })
  const byTestId = (id: string) => renderer.root.findByProps({ 'data-testid': id })
  // The buttons start a sliced run and return; wait for what it renders.
  const eventually = async <T,>(find: () => T): Promise<T> => {
    for (let i = 0; i < 200; i++) {
      try {
        return find()
      } catch {
        await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
      }
    }
    return find()
  }
  await act(async () => byTestId('skid-reach-run').props.onClick())
  const terms = (await eventually(() => byTestId('skid-reach-results')))
    .findAllByType('dt')
    .map((node) => node.children.join(''))
  expect(terms).toContain('Within reach')
  const shown = preview.mock.calls.at(-1)![0] as GeoJSON.Feature[]
  expect(shown.some((feature) => feature.properties?.role === 'beyond')).toBe(true)

  await act(async () => byTestId('skid-reach-suggest').props.onClick())
  const add = await eventually(() => renderer.root.findByProps({ 'aria-label': 'Add spur 1 as a road' }))
  // A suggestion is a candidate: nothing was added to the project yet.
  expect(commit).not.toHaveBeenCalled()
  const roads = project.alignments.length
  await act(async () => add.props.onClick())
  expect(commit).toHaveBeenCalledTimes(1)
  expect(project.alignments).toHaveLength(roads + 1)
  const spur = project.alignments.at(-1)!
  expect(spur.name).toBe('Block A spur 1')
  expect(project.activeAlignmentId).toBe(spur.id)
  await act(async () => renderer.unmount())
  expect(preview.mock.calls.at(-1)![0]).toBeNull()
})
