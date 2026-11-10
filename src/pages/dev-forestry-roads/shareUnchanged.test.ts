import { describe, expect, it } from 'vitest'
import { parseProject } from './project'
import { describeProjectChange } from './projectChangeLabel'
import { shareUnchanged } from './shareUnchanged'
import { createDemoProject } from './terrain'
import type { RoadProject } from './types'
import { formatStation } from './verticalStandards'

describe('keeping unchanged parts after a rebuild', () => {
  it('returns the previous object when nothing changed, at every depth', () => {
    const previous = { a: [1, { b: 2 }], c: 'x' }
    expect(shareUnchanged(previous, { a: [1, { b: 2 }], c: 'x' })).toBe(previous)
  })

  it('keeps unchanged siblings and makes new only the changed path', () => {
    const previous = {
      a: [
        { id: 1, v: 1 },
        { id: 2, v: 2 },
      ],
      c: { d: 1 },
    }
    const next = shareUnchanged(previous, {
      a: [
        { id: 1, v: 1 },
        { id: 2, v: 3 },
      ],
      c: { d: 1 },
    })
    expect(next).not.toBe(previous)
    expect(next.c).toBe(previous.c)
    expect(next.a).not.toBe(previous.a)
    expect(next.a[0]).toBe(previous.a[0])
    expect(next.a[1]).toEqual({ id: 2, v: 3 })
  })

  it('treats an added or removed key or item as a change', () => {
    const previous: { a: number; b?: number } = { a: 1 }
    expect(shareUnchanged(previous, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(shareUnchanged([1, 2], [1, 2, 3])).toEqual([1, 2, 3])
    expect(shareUnchanged({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 })
  })
})

describe('a typed grade committed through the project parser', () => {
  // The Vertical schedule commits through `parseProject`, which rebuilds every part of the project.
  // Its history name read "horizontal points and 3 other changes; 5 other changes" for a PVI edit.
  it('is named by the PVI it moved, not by every part the parser rebuilt', () => {
    const before = parseProject(createDemoProject())
    const road = before.alignments.find((a) => a.id === before.activeAlignmentId)!
    const edited: RoadProject = {
      ...before,
      alignments: before.alignments.map((a) =>
        a.id === road.id
          ? { ...a, vertical: a.vertical.map((v, i) => (i === 1 ? { ...v, elevation: v.elevation + 1 } : v)) }
          : a,
      ),
    }
    const rebuilt = parseProject(edited)
    // The parser alone loses identity: this is what named the step wrongly.
    expect(describeProjectChange(before, rebuilt)).not.toMatch(/PVI 2 moved/)
    const after = shareUnchanged(before, rebuilt)
    expect(describeProjectChange(before, after)).toBe(
      `${road.name}: PVI 2 moved to ${formatStation(road.vertical[1].chainage)}`,
    )
    expect(after.settings).toBe(before.settings)
    expect(after.terrain).toBe(before.terrain)
  })
})
