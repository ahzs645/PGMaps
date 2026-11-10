import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UndoHistoryPanel } from './UndoHistoryMenu'
import type { HistoryRow } from './undoHistory'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('aside', { 'aria-label': label }, children),
}))

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')

const rows: HistoryRow[] = [
  { offset: -2, label: 'Earliest state kept', at: null },
  { offset: -1, label: 'Spur A: moved point 3', at: Date.UTC(2026, 10, 10, 18, 0) },
  { offset: 0, label: 'Spur A: PVI 2 moved to 0+412.0', at: Date.UTC(2026, 10, 10, 18, 1) },
  { offset: 1, label: 'Issue stamp', at: Date.UTC(2026, 10, 10, 18, 2) },
]

describe('the edit history panel', () => {
  it('lists steps newest first and jumps to the one chosen', () => {
    const onGo = vi.fn()
    const onSave = vi.fn(() => 'Before switchback')
    act(() => {
      renderer = create(
        <UndoHistoryPanel
          rows={() => rows}
          onGo={onGo}
          checkpoints={[{ id: 'c1', name: 'Ridge line', at: Date.UTC(2026, 10, 10, 17, 0) }]}
          onSaveCheckpoint={onSave}
          onRestoreCheckpoint={vi.fn()}
          onDeleteCheckpoint={vi.fn()}
        />,
      )
    })
    const root = renderer!.root
    const steps = root.findAll(
      (node) =>
        node.type === 'button' &&
        typeof node.props['aria-label'] === 'string' &&
        /^(Undo|Redo) to|current state$/.test(node.props['aria-label']),
    )
    expect(steps.map((node) => node.props['aria-label'])).toEqual([
      'Redo to: Issue stamp',
      'Spur A: PVI 2 moved to 0+412.0, current state',
      'Undo to: Spur A: moved point 3',
      'Undo to: Earliest state kept',
    ])
    expect(steps[1].props.disabled).toBe(true)
    act(() => steps[2].props.onClick())
    expect(onGo).toHaveBeenCalledWith(-1)
    act(() => steps[0].props.onClick())
    expect(onGo).toHaveBeenCalledWith(1)

    act(() =>
      root.findByProps({ 'aria-label': 'Checkpoint name' }).props.onChange({ target: { value: 'Before switchback' } }),
    )
    act(() => root.findByType('form').props.onSubmit({ preventDefault: () => {} }))
    expect(onSave).toHaveBeenCalledWith('Before switchback')
    expect(text(root)).toContain('Saved checkpoint Before switchback.')
    expect(root.findByProps({ 'aria-label': 'Return to checkpoint Ridge line' })).toBeDefined()
  })

  it('says when there is nothing to undo', () => {
    act(() => {
      renderer = create(
        <UndoHistoryPanel
          rows={() => [{ offset: 0, label: 'Earliest state kept', at: null }]}
          onGo={vi.fn()}
          checkpoints={[]}
          onSaveCheckpoint={() => ''}
          onRestoreCheckpoint={vi.fn()}
          onDeleteCheckpoint={vi.fn()}
        />,
      )
    })
    expect(text(renderer!.root)).toContain('No edits to undo yet.')
  })
})
