import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VerticalDesignControls } from './VerticalDesignControls'
import { analyzeRoad, offsetCoordinate } from './engine'
import { RoadStationProvider } from './roadStation'
import { createDemoProject } from './terrain'
import type { Alignment, TerrainSource } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}))
vi.mock('@/components/ui/map-panels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/map-panels')>()),
  CollapsibleSection: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
}))
vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
}))
vi.mock('./JointOptimizationControls', () => ({ JointOptimizationControls: () => null }))

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

function mount(station: number, designed: boolean, groundElevation = 0) {
  const project = createDemoProject()
  let alignment = project.alignments[0]
  const origin = alignment.points[0].coordinate
  alignment.points = [
    { id: 'start', coordinate: origin, radiusM: 0 },
    { id: 'end', coordinate: offsetCoordinate(origin, 0, 500), radiusM: 0 },
  ]
  alignment.vertical = designed
    ? [
        { id: 'start', chainage: 0, elevation: 0, curveLength: 0 },
        { id: 'end', chainage: 500, elevation: 50, curveLength: 0 },
      ]
    : []
  alignment.verticalControls = []
  project.alignments = [alignment]
  project.context = []
  project.settings.stationInterval = 10
  const source: TerrainSource = { elevationAt: () => groundElevation }
  const analysis = analyzeRoad(alignment, source, project.settings)
  const workspace = {
    alignment,
    calculatedAlignment: alignment,
    analysis,
    project,
    source,
    referenceSurfaces: {},
    // The production sidebar reads its station from the provider, never this placeholder.
    station: Number.NaN,
    updateAlignment: (update: (road: Alignment) => Alignment) => {
      alignment = update(alignment)
    },
    setStation: vi.fn(),
  } as unknown as RoadWorkspace
  act(() => {
    renderer = create(
      createElement(RoadStationProvider, {
        station,
        read: () => station,
        children: createElement(VerticalDesignControls, { workspace }),
      }),
    )
  })
  return {
    analysis,
    control: () => alignment.verticalControls?.[0],
    button: renderer!.root
      .findAllByType('button')
      .find((button) => button.children.includes('Control at selected station'))!,
  }
}

describe('a vertical control at the selected station', () => {
  it('keeps the exact typed chainage and evaluates its profile elevation between calculation stations', () => {
    const view = mount(437.321, true)
    expect(view.analysis.stations.some((station) => station.chainage === 437.321)).toBe(false)
    expect(view.button.props.disabled).toBe(false)
    act(() => view.button.props.onClick())
    expect(view.control()?.chainage).toBe(437.321)
    expect(view.control()?.elevation).toBeCloseTo(43.7321, 6)
  })

  it('allows a ground elevation of zero without a designed profile', () => {
    const view = mount(85, false)
    expect(view.button.props.disabled).toBe(false)
    act(() => view.button.props.onClick())
    expect(view.control()).toMatchObject({ chainage: 85, elevation: 0 })
  })

  it('keeps the action unavailable when neither a profile nor terrain supplies an elevation', () => {
    const view = mount(85, false, Number.NaN)
    expect(view.button.props.disabled).toBe(true)
    act(() => view.button.props.onClick())
    expect(view.control()).toBeUndefined()
  })
})
