import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN_STANDARDS } from './designStandards'
import {
  applyJobStandardsToNewProject,
  jobStandardsOf,
  settleJobStandards,
  standardVehicleCheck,
  startingJobStandards,
  withJobStandards,
} from './jobStandards'
import { parseProject } from './project'
import { createDemoProject, DEFAULT_ROAD_SETTINGS } from './terrain'

const start = startingJobStandards(DEFAULT_ROAD_SETTINGS, 6)

describe('job standards', () => {
  it('starts from the workspace limits and the starting template width', () => {
    expect(start).toMatchObject({ maxGradePercent: 12, minRadius: 25 })
    expect(start.standards.runningSurfaceWidthM).toBe(6)
    expect(start.standards.confirmedOn).toBeUndefined()
  })

  it('keeps a short-pitch allowance whole while it is typed', () => {
    const typed = settleJobStandards({ ...start, standards: { ...start.standards, shortPitchGradePercent: 18 } }, start)
    expect(typed.standards).toMatchObject({ shortPitchGradePercent: 18, shortPitchMaxLengthM: 100 })
    const cleared = settleJobStandards(
      { ...typed, standards: { ...typed.standards, shortPitchMaxLengthM: null } },
      typed,
    )
    expect(cleared.standards).toMatchObject({ shortPitchGradePercent: null, shortPitchMaxLengthM: null })
    const lengthFirst = settleJobStandards(
      { ...start, standards: { ...start.standards, shortPitchMaxLengthM: 150 } },
      start,
    )
    expect(lengthFirst.standards).toMatchObject({ shortPitchGradePercent: 18, shortPitchMaxLengthM: 150 })
  })

  it('holds an adverse limit at or below the sustained limit', () => {
    const next = settleJobStandards(
      { ...start, maxGradePercent: 10, standards: { ...start.standards, adverseGradePercent: 14 } },
      start,
    )
    expect(next.standards.adverseGradePercent).toBe(10)
  })

  it('writes the limits into settings and the rest into the project record, and survives a save', () => {
    const project = withJobStandards(createDemoProject(), {
      maxGradePercent: 14,
      minRadius: 40,
      standards: {
        ...DEFAULT_DESIGN_STANDARDS,
        shortPitchGradePercent: 18,
        shortPitchMaxLengthM: 80,
        source: 'Class 3',
      },
    })
    const saved = parseProject(JSON.parse(JSON.stringify(project)))
    expect(saved.settings).toMatchObject({ maxGradePercent: 14, minRadius: 40 })
    expect(saved.standards).toMatchObject({ shortPitchGradePercent: 18, shortPitchMaxLengthM: 80, source: 'Class 3' })
    expect(jobStandardsOf(saved)).toMatchObject({ maxGradePercent: 14, minRadius: 40 })
    // A project saved before the record existed opens with the starting values.
    expect(jobStandardsOf(parseProject(createDemoProject())).standards).toEqual(DEFAULT_DESIGN_STANDARDS)
  })

  it('gives a new project its width, design vehicle and a confirmation date', () => {
    const project = applyJobStandardsToNewProject(
      createDemoProject(),
      {
        maxGradePercent: 12,
        minRadius: 30,
        standards: { ...DEFAULT_DESIGN_STANDARDS, runningSurfaceWidthM: 5, designVehicle: 'log-truck-pole-trailer' },
      },
      new Date(2026, 10, 9),
    )
    expect(project.standards?.confirmedOn).toBe('2026-11-09')
    expect(project.settings.minRadius).toBe(30)
    expect(project.alignments[0].template).toMatchObject({ leftWidth: 2.5, rightWidth: 2.5 })
    expect(project.alignments[0].vehicleCheck?.vehicle.name).toMatch(/^Loaded log truck/)
    expect(() => parseProject(JSON.parse(JSON.stringify(project)))).not.toThrow()
    expect(standardVehicleCheck({ ...DEFAULT_DESIGN_STANDARDS, designVehicle: 'A truck typed by hand' })).toBeNull()
  })
})
