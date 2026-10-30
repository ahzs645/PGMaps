import { nearestFsrConnections } from './fsrNetwork'
import { parseRouteSearchOptions, suggestRoutes, type RouteCandidate, type RouteSearchOptions } from './routing'
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

export type FsrConnectionPreference = 'nearest' | 'lowest-cost'
export const MAX_FSR_CONNECTION_CANDIDATES = 3
export const MAX_FSR_CHOICES = 10
export type FsrConnectionTarget = ReturnType<typeof nearestFsrConnections>[number]
export interface FsrConnection extends RouteCandidate {
  target: FsrConnectionTarget
}
export interface FsrConnectionAttempt {
  target: FsrConnectionTarget
  error?: string
}
export interface FsrConnectionResult {
  selected: FsrConnection
  connections: FsrConnection[]
  attempts: FsrConnectionAttempt[]
  message: string
}

/**
 * Screens connectors from the supplied endpoint to up to three nearest mapped FSR footpoints.
 * The caller owns network loading and must disclose its search extent. A proposed junction is
 * neither a confirmed access right nor a verified road condition; no input geometry is mutated.
 */
export function suggestFsrConnections(
  origin: Coordinate,
  terrain: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[],
  input: Partial<RouteSearchOptions> = {},
  preference: FsrConnectionPreference = 'nearest',
  targetFeatureId?: string,
): FsrConnectionResult {
  const options = { ...parseRouteSearchOptions(input), alternatives: 1 }
  if (preference !== 'nearest' && preference !== 'lowest-cost')
    throw Error('Choose nearest or lowest-cost FSR connection.')
  const choices = nearestFsrConnections(origin, context, MAX_FSR_CHOICES)
  const chosen = targetFeatureId ? choices.find((target) => target.featureId === targetFeatureId) : undefined
  if (targetFeatureId && !chosen)
    throw Error(
      'The selected FSR is no longer among the nearby available sections. Refresh the choices and select an FSR again.',
    )
  const targets = chosen ? [chosen] : choices.slice(0, MAX_FSR_CONNECTION_CANDIDATES)
  if (!targets.length)
    throw Error(
      'No mapped FSR targets are loaded. Load BC FSRs near the selected endpoint, or import and identify an FSR network. Closed roads are excluded.',
    )
  if (targets[0].distanceM < 2)
    throw Error(
      'The selected endpoint is within 2 m of a mapped FSR. Inspect and confirm the junction instead of generating a near-zero-length connector.',
    )
  const attempts: FsrConnectionAttempt[] = []
  const connections: FsrConnection[] = []
  for (const target of targets) {
    try {
      const result = suggestRoutes(origin, target.coordinate, terrain, settings, context, options)
      connections.push({ ...result.routes[0], target })
      attempts.push({ target })
      if (preference === 'nearest') break
    } catch (error) {
      attempts.push({ target, error: error instanceof Error ? error.message : 'Route search failed.' })
    }
  }
  if (!connections.length) {
    const reasons = attempts.map((attempt) => `${attempt.target.name}: ${attempt.error}`).join(' ')
    throw Error(
      `${chosen ? 'The selected FSR connection did not pass' : `No connector to the ${targets.length} nearest loaded FSR target${targets.length === 1 ? '' : 's'} passed`} the terrain and route constraints. Ensure terrain covers the whole connection; a wider network search or field-designed junction may be needed. ${reasons}`,
    )
  }
  connections.sort((a, b) =>
    preference === 'lowest-cost'
      ? a.cost - b.cost ||
        a.target.distanceM - b.target.distanceM ||
        a.target.featureId.localeCompare(b.target.featureId)
      : a.target.distanceM - b.target.distanceM || a.cost - b.cost,
  )
  const selected = connections[0]
  return {
    selected,
    connections,
    attempts,
    message: `${chosen ? 'Chosen FSR' : preference === 'lowest-cost' ? 'Lowest screening-cost' : 'Nearest feasible'} connection to ${selected.target.name}: ${Math.round(selected.lengthM).toLocaleString('en-CA')} m of proposed road, $${Math.round(selected.cost).toLocaleString('en-CA')} under the route-search model. ${chosen ? 'Used only the selected FSR target.' : `Checked ${attempts.length} of up to ${MAX_FSR_CONNECTION_CANDIDATES} nearest targets in the loaded FSR network.`} The endpoint meets the mapped segment exactly; inspect road condition, access, junction geometry, curves and the designed profile.`,
  }
}
