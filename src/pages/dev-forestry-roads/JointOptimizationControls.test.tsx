import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JointOptimizationControls } from './JointOptimizationControls'
import { refinePlanAndProfile, type JointOptimizationResult } from './jointOptimizer'
import { createDemoProject, demoTerrain } from './terrain'
import type { RoadProject, TerrainSource } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

vi.mock('./jointOptimizer', () => ({ refinePlanAndProfile: vi.fn() }))
vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
}))

const BUSY = 'Refining plan and profile…'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function result(project: RoadProject): JointOptimizationResult {
  return {
    alignment: structuredClone(project.alignments[0]),
    initialScore: 20_000,
    score: 10_000,
    evaluations: [{ points: structuredClone(project.alignments[0].points), score: 10_000, blockers: [] }],
    budgetLimited: false,
    objective: 'engineering',
  }
}

function harness() {
  let renderer: ReactTestRenderer | undefined
  let autoRender = true
  const state = {
    project: createDemoProject(),
    source: demoTerrain as TerrainSource,
    projectId: 'slot-a' as string | null,
    busy: '',
    error: '',
    notice: '',
  }
  const render = () => {
    if (autoRender) renderer?.update(view())
  }
  const methods = {
    setBusy: vi.fn((message: string) => {
      state.busy = message
      render()
    }),
    setError: vi.fn((message: string) => {
      state.error = message
      render()
    }),
    setNotice: vi.fn((message: string) => {
      state.notice = message
      render()
    }),
    // Like useRoadWorkspace.update, read the immediate project even before React renders it.
    update: vi.fn((change: (project: RoadProject) => RoadProject) => {
      state.project = change(state.project)
      render()
    }),
    commit: vi.fn(),
  }
  const view = () =>
    createElement(JointOptimizationControls, {
      workspace: {
        ...state,
        ...methods,
        alignment: state.project.alignments.find((road) => road.id === state.project.activeAlignmentId)!,
        referenceSurfaces: {},
      } as unknown as RoadWorkspace,
    })
  return {
    state,
    methods,
    mount: () => {
      renderer = create(view())
    },
    replace: (patch: Partial<typeof state>, redraw = true) => {
      Object.assign(state, patch)
      if (redraw) render()
    },
    pauseRendering: () => {
      autoRender = false
    },
    click: () =>
      renderer!.root
        .findAllByType('button')
        .find((button) => button.children.includes('Refine plan and profile'))!
        .props.onClick(),
    unmount: () => {
      const mounted = renderer
      renderer = undefined
      mounted?.unmount()
    },
  }
}

let view: ReturnType<typeof harness> | undefined

async function mounted() {
  view = harness()
  await act(async () => view!.mount())
  return view
}

beforeEach(() => vi.mocked(refinePlanAndProfile).mockReset())
afterEach(async () => {
  await act(async () => view?.unmount())
  view = undefined
})

describe('joint-refinement adoption ownership', () => {
  it('adopts a current result through the atomic update and preserves the original road', async () => {
    const h = await mounted()
    const original = h.state.project
    const job = deferred<JointOptimizationResult>()
    vi.mocked(refinePlanAndProfile).mockReturnValueOnce(job.promise)
    await act(async () => h.click())
    expect(h.state.busy).toBe(BUSY)
    await act(async () => job.resolve(result(original)))
    expect(h.methods.update).toHaveBeenCalledOnce()
    expect(h.methods.commit).not.toHaveBeenCalled()
    expect(h.state.project.alignments.slice(0, original.alignments.length)).toEqual(original.alignments)
    expect(h.state.project.alignments).toHaveLength(original.alignments.length + 1)
    expect(h.state.project.activeAlignmentId).not.toBe(original.activeAlignmentId)
    expect(h.state.notice).toContain('The original is retained')
    expect(h.state.error).toBe('')
    expect(h.state.busy).toBe('')
  })

  it('keeps edits made while the deferred calculation runs', async () => {
    const h = await mounted()
    const original = h.state.project
    const job = deferred<JointOptimizationResult>()
    vi.mocked(refinePlanAndProfile).mockReturnValueOnce(job.promise)
    await act(async () => h.click())
    const edited = { ...original, settings: { ...original.settings, cutRate: 123 }, name: 'Edited during refinement' }
    await act(async () => h.replace({ project: edited }))
    await act(async () => job.resolve(result(original)))
    expect(h.state.project).toBe(edited)
    expect(h.methods.update).not.toHaveBeenCalled()
    expect(h.state.error).toContain('Inputs changed during refinement')
    expect(h.state.notice).toBe('')
    expect(h.state.busy).toBe('')
  })

  it('checks the immediate project inside update when an edit has not rendered yet', async () => {
    const h = await mounted()
    const original = h.state.project
    const job = deferred<JointOptimizationResult>()
    vi.mocked(refinePlanAndProfile).mockReturnValueOnce(job.promise)
    await act(async () => h.click())
    const edited = { ...original, name: 'Immediate edit before the next render' }
    h.replace({ project: edited }, false)
    await act(async () => job.resolve(result(original)))
    expect(h.methods.update).toHaveBeenCalledOnce()
    expect(h.state.project).toBe(edited)
    expect(h.state.error).toContain('Inputs changed during refinement')
    expect(h.state.notice).toBe('')
    expect(h.state.busy).toBe('')
  })

  it('does not adopt into a different restored project slot even with identical inputs', async () => {
    const h = await mounted()
    const original = h.state.project
    const job = deferred<JointOptimizationResult>()
    vi.mocked(refinePlanAndProfile).mockReturnValueOnce(job.promise)
    await act(async () => h.click())
    await act(async () => h.replace({ projectId: 'restored-slot' }))
    await act(async () => job.resolve(result(original)))
    expect(h.state.projectId).toBe('restored-slot')
    expect(h.state.project).toBe(original)
    expect(h.methods.update).not.toHaveBeenCalled()
    expect(h.state.error).toContain('Inputs changed during refinement')
  })

  it('rejects a result calculated against a terrain source that has been replaced', async () => {
    const h = await mounted()
    const original = h.state.project
    const job = deferred<JointOptimizationResult>()
    vi.mocked(refinePlanAndProfile).mockReturnValueOnce(job.promise)
    await act(async () => h.click())
    const replacement = { elevationAt: () => 900 }
    await act(async () => h.replace({ source: replacement }))
    await act(async () => job.resolve(result(original)))
    expect(h.state.source).toBe(replacement)
    expect(h.state.project).toBe(original)
    expect(h.methods.update).not.toHaveBeenCalled()
    expect(h.state.error).toContain('Inputs changed during refinement')
  })

  it('leaves a newer operation’s busy text and error untouched', async () => {
    const h = await mounted()
    const original = h.state.project
    const job = deferred<JointOptimizationResult>()
    vi.mocked(refinePlanAndProfile).mockReturnValueOnce(job.promise)
    await act(async () => h.click())
    await act(async () => h.replace({ busy: 'Loading another project…', error: 'Current loader status' }))
    h.methods.setError.mockClear()
    h.methods.setBusy.mockClear()
    await act(async () => job.resolve(result(original)))
    expect(h.methods.update).not.toHaveBeenCalled()
    expect(h.methods.setError).not.toHaveBeenCalled()
    expect(h.methods.setBusy).not.toHaveBeenCalled()
    expect(h.state.error).toBe('Current loader status')
    expect(h.state.busy).toBe('Loading another project…')
    expect(h.state.notice).toBe('')
  })

  it('does not let an older controller clear a newer refinement with the same busy message', async () => {
    const h = await mounted()
    const original = h.state.project
    const oldJob = deferred<JointOptimizationResult>(),
      newJob = deferred<JointOptimizationResult>()
    vi.mocked(refinePlanAndProfile).mockReturnValueOnce(oldJob.promise).mockReturnValueOnce(newJob.promise)
    await act(async () => h.click())
    const oldSignal = vi.mocked(refinePlanAndProfile).mock.calls[0][4]!.signal!
    await act(async () => h.replace({ busy: '' }))
    await act(async () => h.click())
    expect(oldSignal.aborted).toBe(true)
    await act(async () => oldJob.resolve(result(original)))
    expect(h.state.busy).toBe(BUSY)
    expect(h.state.error).toBe('')
    expect(h.methods.update).not.toHaveBeenCalled()
    await act(async () => newJob.resolve(result(original)))
    expect(h.methods.update).toHaveBeenCalledOnce()
    expect(h.state.busy).toBe('')
    expect(h.state.error).toBe('')
  })

  it('aborts on unmount and ignores a calculation that resolves afterwards', async () => {
    const h = await mounted()
    const original = h.state.project
    const job = deferred<JointOptimizationResult>()
    vi.mocked(refinePlanAndProfile).mockReturnValueOnce(job.promise)
    await act(async () => h.click())
    const signal = vi.mocked(refinePlanAndProfile).mock.calls[0][4]!.signal!
    await act(async () => h.unmount())
    expect(signal.aborted).toBe(true)
    expect(h.state.busy).toBe('')
    expect(h.state.error).toBe('')
    expect(h.state.notice).toBe('')
    h.methods.setError.mockClear()
    h.methods.setBusy.mockClear()
    h.methods.setNotice.mockClear()
    await act(async () => job.resolve(result(original)))
    expect(h.methods.update).not.toHaveBeenCalled()
    expect(h.methods.setError).not.toHaveBeenCalled()
    expect(h.methods.setBusy).not.toHaveBeenCalled()
    expect(h.methods.setNotice).not.toHaveBeenCalled()
  })

  it('preserves a newer operation’s busy and error when unmounting the refinement controls', async () => {
    const h = await mounted()
    const original = h.state.project
    const job = deferred<JointOptimizationResult>()
    vi.mocked(refinePlanAndProfile).mockReturnValueOnce(job.promise)
    await act(async () => h.click())
    await act(async () => h.replace({ busy: 'Opening restored terrain…', error: 'Restoration status' }))
    h.methods.setBusy.mockClear()
    h.methods.setError.mockClear()
    await act(async () => h.unmount())
    expect(h.state.busy).toBe('Opening restored terrain…')
    expect(h.state.error).toBe('Restoration status')
    await act(async () => job.resolve(result(original)))
    expect(h.methods.update).not.toHaveBeenCalled()
    expect(h.methods.setBusy).not.toHaveBeenCalled()
    expect(h.methods.setError).not.toHaveBeenCalled()
    expect(h.methods.setNotice).not.toHaveBeenCalled()
  })

  it('does not change workspace state when idle controls mount and unmount', async () => {
    const h = await mounted()
    await act(async () => h.replace({ busy: BUSY }))
    await act(async () => h.unmount())
    expect(h.state.busy).toBe(BUSY)
    expect(h.methods.setBusy).not.toHaveBeenCalled()
    expect(h.methods.setError).not.toHaveBeenCalled()
    expect(h.methods.setNotice).not.toHaveBeenCalled()
    expect(h.methods.update).not.toHaveBeenCalled()
  })

  it('reports synchronous validation failures and releases busy before the first busy render', async () => {
    const h = await mounted()
    const project = h.state.project
    await act(async () =>
      h.replace({
        project: {
          ...project,
          alignments: Array.from({ length: 20 }, (_, i) => ({ ...project.alignments[0], id: `road-${i}` })),
          activeAlignmentId: 'road-0',
        },
      }),
    )
    h.pauseRendering()
    await act(async () => h.click())
    expect(refinePlanAndProfile).not.toHaveBeenCalled()
    expect(h.state.error).toContain('already has 20 road alternatives')
    expect(h.state.busy).toBe('')
  })
})
