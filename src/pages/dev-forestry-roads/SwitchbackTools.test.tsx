import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NumberField } from './Controls'
import { SwitchbackTools } from './SwitchbackTools'
import { alignmentLength, analyzeRoad, horizontalCurveSummary, offsetCoordinate } from './engine'
import { parseProject } from './project'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, RoadAnalysis, RoadProject } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

// Tooltip positioning uses browser media queries; the controls and numerical model remain real.
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))

function fixture(): { project: RoadProject; analysis: RoadAnalysis } {
  const origin: Coordinate = [-122.8, 53.9]
  const road: Alignment = {
    id: 'original',
    name: 'Existing design',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ],
    vertical: [],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
  road.vertical = [
    { id: 'v0', chainage: 0, elevation: 802, curveLength: 0 },
    { id: 'v1', chainage: alignmentLength(road), elevation: 802, curveLength: 0 },
  ]
  const project = parseProject({
    schema: 'pgmaps-road-project-v1',
    name: 'Analytic switchback test',
    activeAlignmentId: road.id,
    alignments: [road],
    settings: { ...DEFAULT_ROAD_SETTINGS },
    context: [],
    cables: [],
    terrain: { kind: 'demo', name: 'Analytic plane', resolutionM: 1, verticalReference: 'Test datum' },
  })
  return { project, analysis: analyzeRoad(project.alignments[0], { elevationAt: () => 800 }, project.settings) }
}

function harness() {
  let renderer: ReactTestRenderer | undefined
  const state = { ...fixture(), busy: '', error: '', notice: '', station: 0, readOnly: false }
  // Analysis has already been calculated by the workspace. Sketching must not read or replace terrain.
  const source = {
    elevationAt: vi.fn(() => {
      throw Error('Unexpected terrain access from switchback controls')
    }),
  }
  const render = () => renderer?.update(view())
  const methods = {
    setError: vi.fn((error: string) => {
      state.error = error
      render()
    }),
    setNotice: vi.fn((notice: string) => {
      state.notice = notice
      render()
    }),
    setStation: vi.fn((station: number) => {
      state.station = station
      render()
    }),
    setFeatureSelection: vi.fn(),
    update: vi.fn((change: (previous: RoadProject) => RoadProject) => {
      state.project = change(state.project)
      render()
    }),
    commit: vi.fn(),
    setSource: vi.fn(),
    onCreated: vi.fn(),
  }
  const view = () =>
    createElement(SwitchbackTools, {
      workspace: {
        ...state,
        ...methods,
        source,
        alignment: state.project.alignments.find((a) => a.id === state.project.activeAlignmentId)!,
      } as unknown as RoadWorkspace,
      readOnly: state.readOnly,
      onCreated: methods.onCreated,
    })
  const createButton = () =>
    renderer!.root.findAllByType('button').find((button) => button.children.includes('Create switchback alternative'))!
  return {
    state,
    source,
    methods,
    createButton,
    mount: () => {
      renderer = create(view())
    },
    replace: (patch: Partial<typeof state>, redraw = true) => {
      Object.assign(state, patch)
      if (redraw) render()
    },
    changeNumber: (label: string, value: number) => {
      const field = renderer!.root.findAllByType(NumberField).find((node) => node.props.label === label)!
      field.findByType('input').props.onChange({ target: { value: String(value) } })
    },
    changeDirection: (value: 'left' | 'right') =>
      renderer!.root
        .findAllByType('select')
        .find((node) => node.props['aria-label'] === 'Switchback turn')!
        .props.onChange({ target: { value } }),
    toggle: () => renderer!.root.findByProps({ 'data-testid': 'road-switchback-toggle' }).props.onClick(),
    text: () => JSON.stringify(renderer!.toJSON()),
    unmount: () => {
      const mounted = renderer
      renderer = undefined
      mounted?.unmount()
    },
  }
}

let ui: ReturnType<typeof harness> | undefined
const mounted = async () => {
  ui = harness()
  await act(async () => ui!.mount())
  return ui
}
afterEach(async () => {
  await act(async () => ui?.unmount())
  ui = undefined
})

describe('switchback sketch adoption', () => {
  it('stages local edits and creates exactly one new active alternative through workspace.update', async () => {
    const h = await mounted()
    const original = h.state.project
    const before = JSON.stringify(original)
    await act(async () => h.toggle())
    await act(async () => h.changeDirection('right'))
    await act(async () => h.changeNumber('Switchback radius (m)', 40))
    await act(async () => h.changeNumber('Initial grade (%)', -2))
    expect(h.state.project).toBe(original)
    expect(JSON.stringify(original)).toBe(before)
    expect(h.methods.update).not.toHaveBeenCalled()
    expect(h.methods.commit).not.toHaveBeenCalled()
    expect(h.source.elevationAt).not.toHaveBeenCalled()
    expect(h.createButton().props.disabled).toBe(false)
    await act(async () => h.createButton().props.onClick())
    expect(h.methods.update).toHaveBeenCalledOnce()
    expect(h.methods.commit).not.toHaveBeenCalled()
    expect(h.state.project.alignments).toHaveLength(2)
    expect(h.state.project.alignments[0]).toEqual(original.alignments[0])
    expect(JSON.stringify(original)).toBe(before)
    const added = h.state.project.alignments[1]
    expect(h.state.project.activeAlignmentId).toBe(added.id)
    expect(added.id).not.toBe(original.activeAlignmentId)
    const curves = horizontalCurveSummary(added)
    expect(curves).toHaveLength(2)
    expect(curves.every((c) => c.direction === 'right' && Math.abs(c.radius - 40) < 1e-6)).toBe(true)
    const extension = alignmentLength(added) - h.state.analysis.length
    expect(added.vertical.at(-1)!.elevation).toBeCloseTo(802 - 0.02 * extension, 7)
    expect(h.methods.setStation).toHaveBeenLastCalledWith((curves[0].start + curves[1].end) / 2)
    expect(h.methods.setFeatureSelection).toHaveBeenCalledWith(null)
    expect(h.methods.onCreated).toHaveBeenCalledOnce()
    expect(h.methods.setSource).not.toHaveBeenCalled()
    expect(h.source.elevationAt).not.toHaveBeenCalled()
    expect(h.state.notice).toContain('The original road is retained')
    expect(h.state.error).toBe('')
  })

  it('rejects a missing calculated end formation without changing project or cursor', async () => {
    const h = await mounted()
    const original = h.state.project
    const analysis = structuredClone(h.state.analysis)
    analysis.stations.at(-1)!.designElevation = null
    await act(async () => h.replace({ analysis }))
    expect(h.createButton().props.disabled).toBe(true)
    expect(h.text()).toContain('A calculated formation level is needed')
    await act(async () => h.createButton().props.onClick())
    expect(h.state.project).toBe(original)
    expect(h.methods.update).not.toHaveBeenCalled()
    expect(h.methods.setStation).not.toHaveBeenCalled()
    expect(h.methods.onCreated).not.toHaveBeenCalled()
  })

  it('stages and adopts an imported road whose valid id matches the usual preview id', async () => {
    const h = await mounted()
    const project = parseProject({
      ...h.state.project,
      activeAlignmentId: 'switchback-preview',
      alignments: [{ ...h.state.project.alignments[0], id: 'switchback-preview' }],
    })
    const original = structuredClone(project)
    await act(async () => h.replace({ project }))
    await act(async () => h.toggle())
    await act(async () => h.changeNumber('Switchback radius (m)', 35))
    expect(h.state.project).toEqual(original)
    expect(h.methods.update).not.toHaveBeenCalled()
    expect(h.createButton().props.disabled).toBe(false)
    await act(async () => h.createButton().props.onClick())
    expect(h.methods.update).toHaveBeenCalledOnce()
    expect(h.state.project.alignments).toHaveLength(2)
    expect(h.state.project.alignments[0]).toEqual(original.alignments[0])
    const added = h.state.project.alignments[1]
    expect(added.id).not.toBe('switchback-preview')
    expect(h.state.project.activeAlignmentId).toBe(added.id)
    expect(horizontalCurveSummary(added)).toHaveLength(2)
    expect(h.methods.onCreated).toHaveBeenCalledOnce()
    expect(h.source.elevationAt).not.toHaveBeenCalled()
    expect(h.state.error).toBe('')
  })

  it.each(['busy', 'readOnly'] as const)('rejects adoption while %s even if the callback is invoked', async (mode) => {
    const h = await mounted()
    const original = h.state.project
    await act(async () => h.replace(mode === 'busy' ? { busy: 'Calculating another operation' } : { readOnly: true }))
    expect(h.createButton().props.disabled).toBe(true)
    await act(async () => h.createButton().props.onClick())
    expect(h.state.project).toBe(original)
    expect(h.methods.update).not.toHaveBeenCalled()
    expect(h.methods.setStation).not.toHaveBeenCalled()
    expect(h.methods.onCreated).not.toHaveBeenCalled()
  })

  it('does not exceed the project alternative limit, including direct callback invocation', async () => {
    const h = await mounted()
    const project = parseProject({
      ...h.state.project,
      alignments: Array.from({ length: 20 }, (_, i) => ({
        ...h.state.project.alignments[0],
        id: i === 0 ? 'original' : `road-${i}`,
      })),
    })
    await act(async () => h.replace({ project }))
    expect(h.createButton().props.disabled).toBe(true)
    expect(h.text()).toContain('20 road alternatives')
    await act(async () => h.createButton().props.onClick())
    expect(h.state.project).toBe(project)
    expect(h.state.project.alignments).toHaveLength(20)
    expect(h.methods.setStation).not.toHaveBeenCalled()
    expect(h.methods.onCreated).not.toHaveBeenCalled()
  })

  it('checks the immediate project before committing a sketch from an older render', async () => {
    const h = await mounted()
    const edited = { ...h.state.project, name: 'Changed before the next render' }
    h.replace({ project: edited }, false)
    await act(async () => h.createButton().props.onClick())
    expect(h.state.project).toBe(edited)
    expect(h.state.project.alignments).toHaveLength(1)
    expect(h.state.error).toContain('The road changed')
    expect(h.methods.setStation).not.toHaveBeenCalled()
    expect(h.methods.onCreated).not.toHaveBeenCalled()
    expect(h.state.notice).toBe('')
  })
})
