/**
 * The project budget as one read: the construction estimate from the analysis, the schedule items
 * with the cost pack's own items for the project's location, and the lifecycle costs. Shared by the
 * cost dialog and the report so both print the same figures. Free of DOM and network access.
 */
import { projectPack } from './costPlaces/projectLocation'
import {
  DEFAULT_LIFECYCLE,
  resolveSchedule,
  summarizeBudget,
  type BudgetSummary,
  type ScheduleContext,
  type ScheduleRow,
  type ScheduleTemplateItem,
} from './costSchedule'
import type { RoadAnalysis, RoadProject } from './types'

export interface ProjectBudget {
  rows: ScheduleRow[]
  context: ScheduleContext
  summary: BudgetSummary
  packItems: readonly ScheduleTemplateItem[]
}

export function scheduleContext(
  analysis: Pick<RoadAnalysis, 'estimatedCost' | 'length' | 'engineering'>,
): ScheduleContext {
  return {
    constructionTotal: analysis.estimatedCost,
    lengthKm: analysis.length / 1000,
    mobilizationInEstimate: analysis.engineering?.costs.mobilization ?? 0,
  }
}

export function projectBudget(
  project: Pick<RoadProject, 'costSchedule' | 'costLocation'>,
  analysis: Pick<RoadAnalysis, 'estimatedCost' | 'length' | 'engineering'>,
): ProjectBudget {
  const packItems = projectPack(project.costLocation)?.scheduleItems ?? []
  const context = scheduleContext(analysis)
  const rows = resolveSchedule(project.costSchedule, packItems, context)
  return {
    rows,
    context,
    summary: summarizeBudget(rows, context, project.costSchedule?.lifecycle ?? DEFAULT_LIFECYCLE),
    packItems,
  }
}
