import { describe, expect, it } from 'vitest'
import { describeProjectChange } from './projectChangeLabel'
import { createDemoProject } from './terrain'
import { addVerticalAlternative, snapshotActiveVerticalAlternative } from './verticalAlternatives'
import type { Alignment, RoadProject } from './types'

const project = createDemoProject()
const road = project.alignments[0]
const editRoad = (change: (road: Alignment) => Alignment): RoadProject => ({
  ...project,
  alignments: project.alignments.map((a) => (a.id === road.id ? change(a) : a)),
})

describe('naming an edit for the undo history', () => {
  it('names a moved, added or removed point on the road', () => {
    const moved = editRoad((a) => ({
      ...a,
      points: a.points.map((p, i) => (i === 2 ? { ...p, coordinate: [p.coordinate[0] + 1e-4, p.coordinate[1]] } : p)),
    }))
    expect(describeProjectChange(project, moved)).toBe(`${road.name}: moved point 3`)
    const added = editRoad((a) => ({
      ...a,
      points: [
        ...a.points.slice(0, 1),
        { id: 'new', coordinate: a.points[0].coordinate, radiusM: 0 },
        ...a.points.slice(1),
      ],
    }))
    expect(describeProjectChange(project, added)).toBe(`${road.name}: added point 2`)
    expect(describeProjectChange(added, project)).toBe(`${road.name}: removed point 2`)
    const curved = editRoad((a) => ({ ...a, points: a.points.map((p, i) => (i === 1 ? { ...p, radiusM: 80 } : p)) }))
    expect(describeProjectChange(project, curved)).toBe(`${road.name}: curve at point 2`)
  })

  it('names a PVI by number and station', () => {
    const moved = editRoad((a) => ({
      ...a,
      vertical: a.vertical.map((v, i) => (i === 1 ? { ...v, chainage: 412, elevation: v.elevation + 1 } : v)),
    }))
    expect(describeProjectChange(project, moved)).toBe(`${road.name}: PVI 2 moved to 0+412.0`)
    const curve = editRoad((a) => ({
      ...a,
      vertical: a.vertical.map((v, i) => (i === 1 ? { ...v, curveLength: v.curveLength + 20 } : v)),
    }))
    expect(describeProjectChange(project, curve)).toBe(`${road.name}: PVI 2 curve length`)
  })

  it('names road and project changes, and sums up many', () => {
    const extra: Alignment = { ...road, id: 'spur-b', name: 'Spur B' }
    const withSpur = { ...project, alignments: [...project.alignments, extra] }
    expect(describeProjectChange(project, withSpur)).toBe('Added road Spur B')
    expect(describeProjectChange(withSpur, project)).toBe('Deleted road Spur B')
    expect(describeProjectChange(project, { ...project, issue: { ...project.issue!, revision: 'C' } })).toBe(
      'Issue stamp',
    )
    expect(
      describeProjectChange(
        project,
        editRoad((a) => ({ ...a, template: { ...a.template } })),
      ),
    ).toBe(`${road.name}: section template`)
    const many = {
      ...editRoad((a) => ({ ...a, template: { ...a.template }, overrides: [], color: '#000000' })),
      settings: { ...project.settings },
    }
    expect(describeProjectChange(project, many)).toBe(`${road.name}: colour and 2 other changes; Design settings`)
    expect(describeProjectChange(project, project)).toBe('No change')
  })

  it('does not count the re-copied active profile alternative as an edit', () => {
    const withAlternatives = editRoad((a) => addVerticalAlternative(a, 'steeper', 'Steeper'))
    const base = { ...withAlternatives, alignments: withAlternatives.alignments.map(snapshotActiveVerticalAlternative) }
    // What the workspace does on every commit: every road is re-snapshotted.
    const recommitted = { ...base, name: 'Renamed', alignments: base.alignments.map(snapshotActiveVerticalAlternative) }
    expect(describeProjectChange(base, recommitted)).toBe('Renamed project')
  })
})
