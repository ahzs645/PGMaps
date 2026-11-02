import { projectRoads, extendRoads } from './projectRoads'
import { roadEdgeBetween } from './graph'
import { MAX_NETWORK_STAGES, MAX_NETWORK_TARGETS } from './planning'
import type {
  RoadsCallbacks,
  RoadsInput,
  RoadsLanding,
  RoadsResult,
  RoadsResultSummary,
  RoadsSimulation,
} from './types'

/** Drop the routing graph; only the worker that built it can continue the simulation. */
export function summarizeRoadsResult(result: RoadsResult): RoadsResultSummary {
  const simulation: Partial<RoadsSimulation> = { ...result.simulation }
  delete simulation.graph
  return { ...result, simulation: simulation as RoadsResultSummary['simulation'] }
}

/** Stage transitions share the original graph and preserve each phase's actual path and status. */
export function runNetworkStages(
  input: RoadsInput,
  stages: RoadsLanding[][] = [input.landings],
  callbacks: RoadsCallbacks = {},
): RoadsResult {
  if (!stages.length || stages.length > MAX_NETWORK_STAGES) throw Error(`Use 1–${MAX_NETWORK_STAGES} network stages.`)
  const targets = stages.flat()
  if (targets.length > MAX_NETWORK_TARGETS || new Set(targets.map((t) => t.id)).size !== targets.length)
    throw Error(`Stages support at most ${MAX_NETWORK_TARGETS} targets with unique IDs.`)
  if (
    targets.length !== input.landings.length ||
    targets.some((t) => !input.landings.some((a) => a.id === t.id && a.cell === t.cell))
  )
    throw Error('Stage targets must match the complete input target list.')
  let result: RoadsResult | undefined
  const paths: RoadsResult['paths'] = [],
    statuses: RoadsResult['targets'] = [],
    warnings = new Set<string>()
  const reusedSeedEdges = new Set<number>()
  for (let i = 0; i < stages.length; i++) {
    const next =
      i === 0
        ? projectRoads({ ...input, landings: stages[i] }, callbacks)
        : extendRoads(result!.simulation, stages[i], {}, callbacks)
    const prefix = `stage-${i + 1}:`
    paths.push(...next.paths.map((path) => ({ ...path, id: prefix + path.id })))
    statuses.push(...next.targets.map((target) => ({ ...target, pathIds: target.pathIds.map((id) => prefix + id) })))
    next.warnings.forEach((warning) => warnings.add(warning))
    const seeds = new Set(next.simulation.seedRoadCells)
    for (const path of next.paths)
      for (let j = 1; j < path.cells.length; j++) {
        if (seeds.has(path.cells[j - 1]) && seeds.has(path.cells[j])) {
          const edge = roadEdgeBetween(next.simulation.graph, path.cells[j - 1], path.cells[j])
          if (edge >= 0) reusedSeedEdges.add(edge)
        }
      }
    result = next
  }
  return {
    ...result!,
    paths,
    targets: statuses,
    newLengthM: result!.simulation.cumulativeNewLengthM,
    objective: result!.simulation.cumulativeObjective,
    reusedLengthM: [...reusedSeedEdges].reduce((sum, edge) => sum + result!.simulation.graph.lengths[edge], 0),
    warnings: [...warnings],
  }
}
