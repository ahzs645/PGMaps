import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { CutblockHistoryPanel } from './CutblockHistoryPanel'
import * as harvestHistory from './harvestHistory'
import { createTrainingScenario } from './scenarios'
import type { ContextFeature } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}))
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children }: { children: ReactNode }) => createElement('div', { role: 'alert' }, children),
}))

afterEach(() => vi.restoreAllMocks())

function workspace() {
  return {
    project: createTrainingScenario('training-harvest-history'),
    projectId: null,
    busy: '',
    update: vi.fn(),
    setNotice: vi.fn(),
  } as unknown as RoadWorkspace
}
function button(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find((node) => node.children.join('') === label)!
}

it('keeps the existing project when the harvest service fails and exposes its error', async () => {
  vi.spyOn(harvestHistory, 'loadBcHarvestHistory').mockRejectedValue(Error('The harvest source is unavailable.'))
  const w = workspace()
  const originalContext = w.project.context
  let renderer: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(CutblockHistoryPanel, { workspace: w }))
  })
  try {
    await act(async () => button(renderer, 'Load BC cutblocks').props.onClick())
    expect(w.update).not.toHaveBeenCalled()
    expect(w.project.context).toBe(originalContext)
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('harvest source is unavailable')
    expect(button(renderer!, 'Load BC cutblocks').props.disabled).toBe(false)
  } finally {
    await act(async () => renderer!.unmount())
  }
})

it('does not merge an in-flight response into another same-name training project', async () => {
  let resolve!: (features: ContextFeature[]) => void
  const pending = new Promise<ContextFeature[]>((done) => {
    resolve = done
  })
  vi.spyOn(harvestHistory, 'loadBcHarvestHistory').mockReturnValue(pending)
  let w = workspace()
  const first = w
  const returned = w.project.context.filter((feature) => feature.kind === 'harvest')
  let renderer: ReactTestRenderer
  const view = () => createElement(CutblockHistoryPanel, { workspace: w })
  await act(async () => {
    renderer = create(view())
  })
  try {
    await act(async () => button(renderer, 'Load BC cutblocks').props.onClick())
    w = workspace()
    expect(w.project.name).toBe(first.project.name)
    expect(w.project.terrain.name).toBe(first.project.terrain.name)
    await act(async () => renderer!.update(view()))
    await act(async () => resolve(returned))
    expect(first.update).not.toHaveBeenCalled()
    expect(w.update).not.toHaveBeenCalled()
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('project changed')
  } finally {
    await act(async () => renderer!.unmount())
  }
})

it('opens the chosen nearby road for review without enabling reuse', async () => {
  const w = workspace()
  const review = vi.fn()
  let renderer: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(CutblockHistoryPanel, { workspace: w, onReviewRoad: review }))
  })
  try {
    await act(async () =>
      renderer!.root.findByProps({ 'aria-label': 'Nearby road candidate' }).props.onChange({
        target: { value: 'history-road-deactivated' },
      }),
    )
    await act(async () => button(renderer, 'Review selected road').props.onClick())
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'history-road-deactivated',
        roadEvidence: expect.objectContaining({
          reuseAllowed: false,
          deactivation: expect.objectContaining({
            status: 'deactivated',
            deactivatedOn: '2016-09-15',
          }),
        }),
      }),
    )
    expect(w.update).not.toHaveBeenCalled()
  } finally {
    await act(async () => renderer!.unmount())
  }
})

it('replaces all parts of a refreshed BC record without removing other cutblocks', async () => {
  const w = workspace()
  const base = w.project.context.find((feature) => feature.kind === 'harvest')!
  const fresh: ContextFeature = {
    ...base,
    id: 'bc-harvest-987',
    harvestEvidence: { source: 'bc-consolidated', sourceId: '987', yearMethod: 'unknown' },
  }
  w.project.context.push({ ...fresh, id: 'bc-harvest-987-part-1' }, { ...fresh, id: 'bc-harvest-987-part-2' })
  vi.spyOn(harvestHistory, 'loadBcHarvestHistory').mockResolvedValue([fresh])
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(CutblockHistoryPanel, { workspace: w }))
  })
  try {
    await act(async () => button(renderer, 'Load BC cutblocks').props.onClick())
    expect(w.update).toHaveBeenCalledTimes(1)
    const apply = vi.mocked(w.update).mock.calls[0][0]
    const next = apply(w.project)
    expect(next.context.filter((feature) => feature.harvestEvidence?.sourceId === '987')).toEqual([fresh])
    expect(next.context).toContainEqual(base)
    expect(next.context.filter((feature) => feature.kind === 'existing-road')).toHaveLength(3)
  } finally {
    await act(async () => renderer.unmount())
  }
})
