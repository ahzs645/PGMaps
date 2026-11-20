import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { RouteFinder } from './RouteFinder'
import { NumberField } from './Controls'
import { analyzeRoad } from './engine'
import { DEFAULT_CROSS_DRAIN_COST } from './routeComparison'
import { createDemoProject, demoTerrain } from './terrain'
import type { RoadProject } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}))
vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children }: { children: ReactNode }) => createElement('section', null, children),
}))
vi.mock('@/components/ui/tool-section', () => ({
  ToolSubsection: ({ children }: { children: ReactNode }) => createElement('section', null, children),
}))
vi.mock('./SwitchbackSettings', () => ({ SwitchbackSettings: () => null }))
vi.mock('./RouteSearchPresets', () => ({ RouteSearchPresets: () => null }))

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

it('keeps entered cross-drain allowances in their own currency without converting the CAD default', () => {
  const project = createDemoProject()
  const alignment = project.alignments[0]
  const workspace = {
    project,
    alignment,
    analysis: analyzeRoad(alignment, demoTerrain, project.settings),
    source: demoTerrain,
    busy: '',
    setBusy: vi.fn(),
  } as unknown as RoadWorkspace
  const render = (next: RoadProject) => (
    <RouteFinder workspace={{ ...workspace, project: next }} full={false} onPegRoad={() => {}} />
  )
  act(() => {
    renderer = create(render(project))
  })
  const field = () =>
    renderer!.root.findAllByType(NumberField).find((node) => node.props.label.startsWith('Cross-drain'))!
  expect(field().props.value).toBe(DEFAULT_CROSS_DRAIN_COST)
  expect(field().props.hint).toContain('12 m × CAD 372.67/m')
  act(() => field().props.onChange(6000))

  const usProject: RoadProject = {
    ...project,
    costLocation: { place: { country: 'US' }, basis: 'chosen', setOn: '2026-11-19' },
  }
  act(() => renderer!.update(render(usProject)))
  expect(field().props.label).toBe('Cross-drain (USD)')
  expect(field().props.value).toBe(0)
  expect(field().props.hint).toContain('unpriced: zero USD')
  expect(JSON.stringify(renderer!.toJSON())).toContain('comparison adds no cost')
  act(() => field().props.onChange(4000))

  act(() => renderer!.update(render(project)))
  expect(field().props.value).toBe(6000)
  expect(field().props.hint).toContain('Entered CAD allowance')
  act(() => renderer!.update(render(usProject)))
  expect(field().props.value).toBe(4000)
  expect(field().props.hint).toContain('Entered USD allowance')
})
