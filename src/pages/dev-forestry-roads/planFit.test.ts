import { describe, expect, it } from 'vitest'
import { roadPlanFitCoordinates } from './planFit'
import { createFullCostTrainingProject, fullCostTrainingCoordinate } from './trainingFullCostScenario'
import { createDemoProject } from './terrain'

describe('full-cost plan fitting', () => {
  it('includes the U-network, source and outlet when fitting the complete plan, while active-road fit stays local', () => {
    const project = createFullCostTrainingProject()
    const active = project.alignments[0]
    const complete = roadPlanFitCoordinates(project, 'roads', active)
    expect(complete).toContainEqual(fullCostTrainingCoordinate(100, 1000))
    expect(complete).toContainEqual(project.totalCostPlanning!.outlet)
    expect(complete).toContainEqual(project.totalCostPlanning!.sources[0].entrance)
    const local = roadPlanFitCoordinates(project, 'active', active)
    expect(local).toEqual(active.points.map((point) => point.coordinate))
    expect(local).not.toContainEqual(fullCostTrainingCoordinate(100, 1000))
  })

  it('preserves the existing road-only extent for a project without full-cost planning', () => {
    const project = createDemoProject()
    expect(roadPlanFitCoordinates(project, 'roads', project.alignments[0])).toEqual(
      project.alignments.flatMap((alignment) => alignment.points.map((point) => point.coordinate)),
    )
  })
})
