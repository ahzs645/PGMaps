import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { StreamCrossingsPanel } from './StreamCrossingsPanel'
import { OptionalNumberField } from './Controls'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createDemoProject, DEFAULT_TEMPLATE } from './terrain'
import { parseProject, serializeProject } from './project'
import type { Alignment, Coordinate, RoadProject } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
}))

it('records a crossing, edits an item and shared work, persists the evidence and requires review after a stream change', async () => {
  const origin: Coordinate = [-122.8, 53.9]
  const point = (x: number, y: number) => offsetCoordinate(offsetCoordinate(origin, 90, x), 0, y)
  const road: Alignment = {
    id: 'road',
    name: 'Test road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: point(0, 100), radiusM: 0 },
    ],
    vertical: [],
    template: { ...DEFAULT_TEMPLATE, surfaceDepth: 0 },
    overrides: [],
  }
  let project: RoadProject = {
    ...createDemoProject(),
    alignments: [road],
    activeAlignmentId: road.id,
    context: [
      {
        id: 'stream',
        name: 'Test stream',
        kind: 'stream',
        geometry: { type: 'LineString', coordinates: [point(-30, 50), point(30, 50)] },
      },
    ],
  }
  const source = { elevationAt: () => 800 }
  const analysis = () =>
    analyzeRoad(project.alignments[0], source, project.settings, project.context, {
      sharedCrossingCosts: project.sharedCrossingCosts,
    })
  let renderer: ReactTestRenderer
  const update = (change: (value: RoadProject) => RoadProject) => {
    project = change(project)
    renderer.update(view())
  }
  const view = () =>
    createElement(StreamCrossingsPanel, {
      workspace: {
        project,
        alignment: project.alignments[0],
        analysis: analysis(),
        update,
        updateAlignment: (change: (value: Alignment) => Alignment) =>
          update((p) => ({ ...p, alignments: [change(p.alignments[0])] })),
        setStation: vi.fn(),
        setError: vi.fn(),
      } as unknown as RoadWorkspace,
    })
  await act(async () => {
    renderer = create(view())
  })
  const button = (label: string) =>
    renderer.root.findAllByType('button').find((node) => node.children.join('') === label)!
  const changeText = async (label: string, value: string, last = false) => {
    await act(async () => {
      const fields = renderer.root.findAllByProps({ 'aria-label': label })
      ;(last ? fields.at(-1)! : fields[0]).props.onChange({ target: { value } })
    })
  }
  try {
    await act(async () => button('Record detected crossings').props.onClick())
    expect(project.alignments[0].crossingRecords).toHaveLength(1)
    await changeText('Planning structure option', 'bridge')
    await changeText('Crossing evidence / review notes', 'Field review retained')
    await act(async () =>
      renderer.root
        .findAllByType(OptionalNumberField)
        .find((field) => field.props.label === 'Unit rate ($)')!
        .props.onChange(350),
    )
    expect(analysis().crossingEstimate!.complete).toBe(false)
    await changeText('Item 1 price source', 'Bridge quote 123')
    await changeText('Item 1 price date', '2026-11-07')
    expect(analysis().crossingEstimate!.complete).toBe(true)
    await act(async () => button('Add shared estimate item').props.onClick())
    await act(async () =>
      renderer.root
        .findAllByType(OptionalNumberField)
        .filter((field) => field.props.label === 'Unit rate ($)')
        .at(-1)!
        .props.onChange(50),
    )
    await changeText('Item 1 price source', 'Survey quote 456', true)
    await changeText('Item 1 price date', '2026-11-07', true)
    expect(analysis().crossingEstimate).toMatchObject({
      crossingSubtotal: 350,
      sharedSubtotal: 50,
      knownSubtotal: 400,
      complete: true,
    })
    project = parseProject(serializeProject(project))
    expect(project.alignments[0].crossingRecords![0].evidence).toBe('Field review retained')
    await act(async () =>
      update((p) => ({
        ...p,
        context: [{ ...p.context[0], geometry: { type: 'LineString', coordinates: [point(-40, 50), point(40, 50)] } }],
      })),
    )
    expect(analysis().crossingEstimate!.rows[0].status).toBe('needs-review')
    await act(async () => button('Confirm geometry and evidence review').props.onClick())
    expect(analysis().crossingEstimate!.complete).toBe(true)
    expect(project.alignments[0].crossingRecords![0].items[0].source).toBe('Bridge quote 123')
  } finally {
    await act(async () => renderer.unmount())
  }
})
