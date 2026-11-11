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

  it('keeps the road on screen when another one is removed', () => {
    expect(removeRoad(project('spur'), 'starter')!.project.activeAlignmentId).toBe('spur')
    expect(removeRoad(project('spur'), 'missing')).toBeNull()
  })

  it('leaves an empty design when the last road goes, keeping none of its line', () => {
    const only = {
      ...road('only'),
      points: [
        { id: 'a', coordinate: [-122.8, 53.9], radiusM: 0 },
        { id: 'b', coordinate: [-122.79, 53.9], radiusM: 25 },
        { id: 'c', coordinate: [-122.78, 53.91], radiusM: 0 },
      ],
      vertical: [{ id: 'v', chainage: 10, elevation: 700 }],
      template: { leftWidth: 2.5 },
    } as unknown as Alignment
    const result = removeRoad({ alignments: [only], activeAlignmentId: 'only' }, 'only')!
    const [placeholder] = result.project.alignments
    expect(result.project).toMatchObject({ workspaceMode: 'design', designPlaceholderId: placeholder.id })
    expect(result.project.activeAlignmentId).toBe(placeholder.id)
    expect(placeholder.id).not.toBe('only')
    expect(placeholder.points.map((p) => p.coordinate)).toEqual([
      [-122.8, 53.9],
      [-122.78, 53.91],
    ])
    expect(placeholder.vertical).toEqual([])
    // The next road copies the active road's template, so the standards carry over.
    expect(placeholder.template).toBe(only.template)
    // An empty design has nothing left to delete, and an investigation's draft is not a road.
    expect(removeRoad(result.project, placeholder.id)).toBeNull()
    expect(
      removeRoad({ alignments: [only], activeAlignmentId: 'only', workspaceMode: 'access-investigation' }, 'only'),
    ).toBeNull()

    const restored = restoreRoad(result.project, result.removed)
    expect(restored.alignments).toEqual([only])
    expect(restored.activeAlignmentId).toBe('only')
    expect(restored).not.toHaveProperty('designPlaceholderId')
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
