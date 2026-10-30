import { describe, expect, it } from 'vitest'
import { checkConnector } from './connectorChecks'
import {
  analyzeFullCostConnector,
  candidateNetworkAttachmentId,
  compareFullCostCandidates,
  sourceNetworkAttachmentId,
} from './fullCostComparison'
import { parseProject, serializeProject } from './project'
import { buildRoadNetwork, roadNetworkInputs, shortestRoadNetworkPath } from './roadNetwork'
import { checkScenarioTerrain } from './scenarioCoverage'
import { createFullCostTrainingProject, FULL_COST_TRAINING_IDS } from './trainingFullCostScenario'
import { demoTerrain, terrainFromMetadata } from './terrain'
import type { RoadProject } from './types'

function compare(project: RoadProject) {
  const planning = project.totalCostPlanning!
  const candidates = project.alignments.map((alignment) => ({
    id: alignment.id,
    name: alignment.name,
    alignment,
    analysis: analyzeFullCostConnector(alignment, demoTerrain, project.settings, project.context),
    entryChainage: analyzeFullCostConnector(alignment, demoTerrain, project.settings, project.context).length,
    checks: checkConnector({
      alignment,
      terrain: demoTerrain,
      settings: project.settings,
      context: project.context,
      options: planning.connectorChecks,
      terrainResolutionM: project.terrain.resolutionM,
      expectedStart: alignment.points[0].coordinate,
      expectedEnd: alignment.points.at(-1)!.coordinate,
    }),
  }))
  const graph = buildRoadNetwork(roadNetworkInputs(project.context), planning.networkPolicy, [
    { id: 'outlet', coordinate: planning.outlet! },
    ...candidates.map((candidate) => ({
      id: candidateNetworkAttachmentId(candidate.id),
      coordinate: candidate.alignment.points.at(-1)!.coordinate,
    })),
    ...planning.sources.map((source) => ({ id: sourceNetworkAttachmentId(source.id), coordinate: source.entrance! })),
  ])
  const comparison = compareFullCostCandidates(candidates, planning, (from, to, options) =>
    shortestRoadNetworkPath(graph, from, to, options),
  )
  return { candidates, comparison, graph }
}

describe('offline connected-access library scenario', () => {
  it('uses the recorded synthetic terrain on restore and checks its actual final connector geometry', () => {
    const project = parseProject(createFullCostTrainingProject())
    expect(terrainFromMetadata(project.terrain)).toBe(demoTerrain)
    expect(parseProject(serializeProject(project))).toEqual(project)
    expect(checkScenarioTerrain(project.alignments, demoTerrain, project.settings.crossSectionHalfWidth).missing).toBe(
      0,
    )
    const result = compare(project)
    expect(result.candidates.map((candidate) => candidate.checks.failures)).toEqual([[], []])
    expect(result.candidates.every((candidate) => candidate.checks.adoptable)).toBe(true)
    expect(result.graph.excludedRoads).toEqual([])
    expect(result.comparison.candidates.every((candidate) => candidate.status === 'feasible')).toBe(true)
  })

  it('changes the horizontal winner when connected gravel haul is priced', () => {
    const project = createFullCostTrainingProject()
    expect(compare(project).comparison.winnerId).toBe(FULL_COST_TRAINING_IDS.shortConnector)
    project.totalCostPlanning!.haulRatePerM3Km = 40
    const result = compare(project).comparison
    expect(result.winnerId).toBe(FULL_COST_TRAINING_IDS.longConnector)
    const short = result.candidates.find((candidate) => candidate.id === FULL_COST_TRAINING_IDS.shortConnector)!
    const long = result.candidates.find((candidate) => candidate.id === FULL_COST_TRAINING_IDS.longConnector)!
    expect(short.ledger!.supplyNetworkHaul).toBeGreaterThan(long.ledger!.supplyNetworkHaul)
    expect(short.allocations.every((allocation) => allocation.networkDistanceM > 2400)).toBe(true)
    expect(long.allocations.every((allocation) => allocation.networkDistanceM < 0.01)).toBe(true)
  })

  it('makes rehabilitation on the A arm change the winner without changing connector geometry', () => {
    const project = createFullCostTrainingProject()
    project.context.find(
      (road) => road.id === FULL_COST_TRAINING_IDS.armA,
    )!.roadEvidence!.network!.rehabilitationCostPerM = 10
    expect(compare(project).comparison.winnerId).toBe(FULL_COST_TRAINING_IDS.longConnector)
  })

  it('keeps B reachable when a simulated bridge closes the A arm', () => {
    const project = createFullCostTrainingProject()
    project.context.find((road) => road.id === FULL_COST_TRAINING_IDS.armA)!.roadEvidence!.network!.bridgeStatus =
      'closed'
    const result = compare(project).comparison
    expect(result.winnerId).toBe(FULL_COST_TRAINING_IDS.longConnector)
    expect(result.candidates.find((candidate) => candidate.id === FULL_COST_TRAINING_IDS.shortConnector)!.status).toBe(
      'infeasible',
    )
  })

  it('blocks both candidates when dated evidence expires without silently changing manual road condition', () => {
    const project = createFullCostTrainingProject()
    const before = structuredClone(project.context.map((road) => road.roadEvidence))
    project.totalCostPlanning!.asOf = '2028-01-01'
    project.totalCostPlanning!.networkPolicy.asOf = '2028-01-01'
    const result = compare(project)
    expect(result.comparison.winnerId).toBeNull()
    expect(result.graph.excludedRoads).toHaveLength(3)
    expect(project.context.map((road) => road.roadEvidence)).toEqual(before)
    expect(
      project.context
        .filter((road) => road.roadEvidence)
        .every(
          (road) => road.roadEvidence!.condition === 'serviceable' && road.roadEvidence!.conditionBasis === 'assumed',
        ),
    ).toBe(true)
  })
})
