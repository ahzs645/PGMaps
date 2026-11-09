import { describe, expect, it } from 'vitest'
import { distinctProjectName, removeRoad, restoreRoad } from './roadLifecycle'
import type { Alignment } from './types'

const road = (id: string) => ({ id, name: `Road ${id}` }) as Alignment
const project = (active: string) => ({
  alignments: [road('starter'), road('spur'), road('optimized')],
  activeAlignmentId: active,
})

describe('removeRoad', () => {
  it('shows the neighbouring road, not the first in the list', () => {
    const result = removeRoad(project('optimized'), 'optimized')!
    expect(result.project.alignments.map((r) => r.id)).toEqual(['starter', 'spur'])
    expect(result.project.activeAlignmentId).toBe('spur')
    expect(result.removed).toMatchObject({ index: 2, shownId: 'spur' })
    expect(removeRoad(project('starter'), 'starter')!.project.activeAlignmentId).toBe('spur')
  })

  it('keeps the road on screen when another one is removed, and never removes the last road', () => {
    expect(removeRoad(project('spur'), 'starter')!.project.activeAlignmentId).toBe('spur')
    expect(removeRoad({ alignments: [road('only')], activeAlignmentId: 'only' }, 'only')).toBeNull()
    expect(removeRoad(project('spur'), 'missing')).toBeNull()
  })
})

describe('restoreRoad', () => {
  it('puts the road back in its place and shows it, even after later edits', () => {
    const removed = removeRoad(project('spur'), 'spur')!
    const edited = { ...removed.project, alignments: [...removed.project.alignments, road('new')] }
    const restored = restoreRoad(edited, removed.removed)
    expect(restored.alignments.map((r) => r.id)).toEqual(['starter', 'spur', 'optimized', 'new'])
    expect(restored.activeAlignmentId).toBe('spur')
    // An ordinary Undo already brought it back: the notice's Undo only shows it.
    expect(restoreRoad(project('starter'), removed.removed).alignments).toHaveLength(3)
  })
})

describe('distinctProjectName', () => {
  it('numbers a name that is already saved', () => {
    expect(distinctProjectName('Block 12 spur', ['Demo'])).toBe('Block 12 spur')
    expect(distinctProjectName('Block 12 spur', ['Block 12 spur'])).toBe('Block 12 spur (2)')
    expect(distinctProjectName('Block 12 spur (2)', ['Block 12 spur', 'Block 12 spur (2)'])).toBe('Block 12 spur (3)')
    expect(distinctProjectName('x'.repeat(200), ['x'.repeat(200)])).toHaveLength(200)
  })
})
