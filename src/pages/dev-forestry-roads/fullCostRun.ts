/** Bounded horizontal candidate generation, final gates and connected-network costing. */
import { alignmentLength, distance, horizontalGeometry, positionAt } from './engine'
import { fitHorizontalRadii } from './horizontalTools'
import { nearestExistingRoadPoint } from './fsrNetwork'
import { DEFAULT_ROUTE_OPTIONS, suggestRoutes } from './routing'
import { createEngineeringDesign } from './engineeringTypes'
import { checkConnector, CONNECTOR_ENDPOINT_TOLERANCE_M, type ConnectorCheckResult } from './connectorChecks'
import { parseTotalCostPlanning } from './fullCostPlanning'
import { buildRoadNetwork, evaluateNetworkRoad, roadNetworkInputs, shortestRoadNetworkPath } from './roadNetwork'
import {
  analyzeFullCostConnector,
  compareFullCostCandidates,
  fullCostNetworkAttachments,
  MAX_FULL_COST_CANDIDATES,
  MAX_FULL_COST_PATH_SEARCHES,
  type FullCostCandidateInput,
  type FullCostComparison,
} from './fullCostComparison'
import type { Alignment, Coordinate, RoadPoint, RoadProject, TerrainSource } from './types'
import type { RoadNetworkGraph } from './roadNetworkTypes'

export interface FullCostRun {
  comparison: FullCostComparison
  candidates: {
    alignment: Alignment
    checks: ConnectorCheckResult
    basis: string
    entryRoadId?: string
    expectedStart: Coordinate
    expectedEnd: Coordinate
  }[]
  network: RoadNetworkGraph
  generationWarnings: string[]
}
export const MAX_GENERATED_COST_TARGETS = 3
export const COST_PROFILE_INTERVAL_M = 20
const HORIZONTAL_IDENTITY_TOLERANCE_M = 0.01

/** Ignore redundant collinear PIs while retaining the actual fitted arc/spiral geometry. */
function normalizedHorizontal(alignment: Alignment): ReturnType<typeof horizontalGeometry> {
  const pieces: ReturnType<typeof horizontalGeometry> = []
  for (const piece of horizontalGeometry(alignment)) {
    const previous = pieces.at(-1)
    if (previous?.kind === 'line' && piece.kind === 'line') {
      const radians = Math.PI / 180
      const bearing = (a: Coordinate, b: Coordinate) =>
        Math.atan2(
          Math.sin((b[0] - a[0]) * radians) * Math.cos(b[1] * radians),
          Math.cos(a[1] * radians) * Math.sin(b[1] * radians) -
            Math.sin(a[1] * radians) * Math.cos(b[1] * radians) * Math.cos((b[0] - a[0]) * radians),
        )
      const crossTrack =
        Math.abs(
          Math.asin(
            Math.max(
              -1,
              Math.min(
                1,
                Math.sin(distance(previous.start, previous.end) / 6371008.8) *
                  Math.sin(bearing(previous.start, previous.end) - bearing(previous.start, piece.end)),
              ),
            ),
          ),
        ) * 6371008.8
      if (
        distance(previous.end, piece.start) <= HORIZONTAL_IDENTITY_TOLERANCE_M &&
        crossTrack <= HORIZONTAL_IDENTITY_TOLERANCE_M &&
        distance(previous.start, previous.end) +
          distance(previous.end, piece.end) -
          distance(previous.start, piece.end) <=
          HORIZONTAL_IDENTITY_TOLERANCE_M
      ) {
        pieces[pieces.length - 1] = { ...previous, end: piece.end, length: previous.length + piece.length }
        continue
      }
    }
    pieces.push(piece)
  }
  return pieces
}

function sameHorizontalGeometry(first: Alignment, second: Alignment): boolean {
  try {
    const a = normalizedHorizontal(first),
      b = normalizedHorizontal(second)
    const sameNumber = (x: number, y: number) => x === y || Math.abs(x - y) <= HORIZONTAL_IDENTITY_TOLERANCE_M
    return (
      a.length === b.length &&
      a.every((piece, index) => {
        const other = b[index]
        if (
          piece.kind !== other.kind ||
          !sameNumber(piece.length, other.length) ||
          distance(piece.start, other.start) > HORIZONTAL_IDENTITY_TOLERANCE_M ||
          distance(piece.end, other.end) > HORIZONTAL_IDENTITY_TOLERANCE_M
        )
          return false
        if (piece.kind === 'arc' && other.kind === 'arc')
          return (
            sameNumber(piece.radius, other.radius) &&
            piece.rotation === other.rotation &&
            distance(piece.center, other.center) <= HORIZONTAL_IDENTITY_TOLERANCE_M
          )
        if (piece.kind === 'spiral' && other.kind === 'spiral')
          return (
            sameNumber(piece.radiusStart, other.radiusStart) &&
            sameNumber(piece.radiusEnd, other.radiusEnd) &&
            piece.rotation === other.rotation
          )
        return piece.kind === 'line'
      })
    )
  } catch {
    // An invalid entered curve cannot be used to erase a valid generated geometry.
    return false
  }
}

/** A transparent, editable terrain-initialized profile, independently rechecked after curve fitting. */
function initializedProfile(alignment: Alignment, source: TerrainSource): Alignment {
  const length = alignmentLength(alignment)
  const intervals = Math.max(1, Math.ceil(length / COST_PROFILE_INTERVAL_M))
  if (intervals > 499) throw Error('Generated profiles are limited to 500 controls; shorten this connector.')
  const vertical = Array.from({ length: intervals + 1 }, (_, index) => {
    const chainage = (length * index) / intervals
    const elevation = source.elevationAt(...positionAt(alignment, chainage).coordinate)
    if (!Number.isFinite(elevation))
      throw Error('A generated profile has missing terrain; no substitute elevation was used.')
    return {
      id: `cost-profile-${index}`,
      chainage,
      elevation,
      curveLength: index && index < intervals ? Math.min(10, length / intervals / 2) : 0,
    }
  })
  return { ...alignment, vertical }
}

/** The exact returned alignment is checked, priced, previewed and adopted. */
export async function runFullCostComparison(
  project: RoadProject,
  source: TerrainSource,
  {
    signal,
    onProgress,
    yieldControl = () => Promise.resolve(),
  }: {
    signal?: AbortSignal
    onProgress?: (message: string) => void
    yieldControl?: () => Promise<void>
  } = {},
): Promise<FullCostRun> {
  if (!project.totalCostPlanning)
    throw Error('Set up vehicle, network, supply and connector criteria before comparing routes.')
  const planning = parseTotalCostPlanning(project.totalCostPlanning)
  if (!planning.outlet) throw Error('Set a reviewed network outlet/gateway before comparing access routes.')
  const active = project.alignments.find((road) => road.id === project.activeAlignmentId)!
  const origin = active.points[0].coordinate
  const candidates: FullCostRun['candidates'] = []
  const inputs: FullCostCandidateInput[] = []
  const generationWarnings: string[] = []
  const signatures = new Set<string>()
  const inferredEntries = new WeakMap<Alignment, string | undefined>()
  const entryRoadFor = (alignment: Alignment) => {
    const explicit = alignment.networkEntryRoadId ?? alignment.fsrConnection?.targetFeatureId
    if (explicit) return explicit
    if (inferredEntries.has(alignment)) return inferredEntries.get(alignment)
    const endpoint = alignment.points.at(-1)!.coordinate
    const matching = project.context.filter(
      (road) =>
        road.kind === 'existing-road' &&
        road.geometry.type === 'LineString' &&
        (nearestExistingRoadPoint(endpoint, road)?.distanceM ?? Infinity) <=
          planning.networkPolicy.attachmentToleranceM + 1e-7,
    )
    const inferred = matching.length === 1 ? matching[0].id : undefined
    inferredEntries.set(alignment, inferred)
    return inferred
  }
  const knownHorizontals = project.alignments
    .filter((alignment) => alignment.vertical.length >= 2)
    .map((alignment) => ({ alignment, entryRoadId: entryRoadFor(alignment) }))
  const usedAlignmentIds = new Set(project.alignments.map((alignment) => alignment.id))
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Route comparison cancelled', 'AbortError')
  }
  const add = async (
    raw: Alignment,
    basis: string,
    entryRoadId = raw.networkEntryRoadId ?? raw.fsrConnection?.targetFeatureId,
    expectedEnd: Coordinate = raw.fsrConnection?.targetCoordinate ?? raw.points.at(-1)!.coordinate,
    materialReviewRequired = false,
  ) => {
    checkAbort()
    if (candidates.length >= MAX_FULL_COST_CANDIDATES) return
    // Procurement is priced from network-connected sources; internal material handling retains its inputs.
    const engineering = raw.engineering ?? createEngineeringDesign()
    const alignment = {
      ...raw,
      fullCostRecord: undefined,
      engineering: {
        ...engineering,
        sites: [],
        surfacingSupply: undefined,
        haul: { ...engineering.haul, enabled: true },
      },
    }
    const signature = JSON.stringify({
      entryRoadId: entryRoadId ?? entryRoadFor(raw),
      expectedStart: origin,
      expectedEnd,
      recordedOrigin: raw.fsrConnection?.originCoordinate,
      points: alignment.points.map(({ coordinate, radiusM, spiralM }) => ({ coordinate, radiusM, spiralM })),
      vertical: alignment.vertical,
      template: alignment.template,
      engineering: alignment.engineering,
    })
    if (signatures.has(signature)) return
    signatures.add(signature)
    onProgress?.(`Checking fitted connector ${candidates.length + 1}: ${alignment.name}`)
    await yieldControl()
    checkAbort()
    const checks = checkConnector({
      alignment,
      terrain: source,
      settings: project.settings,
      context: project.context,
      options: planning.connectorChecks,
      terrainResolutionM: project.terrain.resolutionM,
      expectedStart: origin,
      expectedEnd,
    })
    if (raw.fsrConnection) {
      if (distance(raw.fsrConnection.originCoordinate, origin) > CONNECTOR_ENDPOINT_TOLERANCE_M)
        checks.failures.push({
          code: 'fsr-origin-registration',
          message: 'The recorded FSR connector origin no longer matches the active planning origin within 0.05 m.',
        })
      if (
        !project.context.some(
          (feature) =>
            feature.id === raw.fsrConnection!.targetFeatureId &&
            feature.kind === 'existing-road' &&
            feature.geometry.type === 'LineString',
        )
      )
        checks.failures.push({
          code: 'fsr-target-registration',
          message: 'The recorded FSR target road section is no longer present in the project.',
          featureId: raw.fsrConnection.targetFeatureId,
        })
      if (checks.failures.length) {
        checks.status = 'fail'
        checks.adoptable = false
      }
    }
    if (materialReviewRequired) {
      checks.unknowns.push({
        code: 'generated-material-review',
        message:
          'The entered road has station-based material horizons. Their allocation cannot be transferred to a different generated route; review and assign materials before pricing this candidate.',
      })
      checks.adoptable = false
      checks.status = checks.failures.length ? 'fail' : 'unknown'
    }
    const analysis = analyzeFullCostConnector(alignment, source, project.settings, project.context)
    candidates.push({
      alignment,
      checks,
      basis,
      entryRoadId,
      expectedStart: [...origin],
      expectedEnd: [...expectedEnd],
    })
    inputs.push({
      id: alignment.id,
      name: alignment.name,
      alignment,
      analysis,
      entryChainage: analysis.length,
      entryRoadId,
      checks,
    })
  }
  // Explicit alternatives are evaluated first so the user's entered profiles and structures stay reviewable.
  for (const road of [active, ...project.alignments.filter((road) => road.id !== active.id)]) {
    if (distance(road.points[0].coordinate, origin) > 1) continue
    try {
      await add(road, 'Entered horizontal alignment and profile; network procurement replaces legacy external sites.')
    } catch (error) {
      if (signal?.aborted) throw error
      generationWarnings.push(`${road.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  let generated = 0
  const eligibleRoadIds = new Set(
    roadNetworkInputs(project.context)
      .filter((road) => evaluateNetworkRoad(road, planning.networkPolicy).eligible)
      .map((road) => road.id),
  )
  const nearbyRoadTargets = project.context
    .filter((road) => eligibleRoadIds.has(road.id))
    .flatMap((road) => {
      const closest = nearestExistingRoadPoint(origin, road)
      if (!closest) return []
      const roadClass = road.roadEvidence?.roadClass
      const label =
        roadClass === 'fsr'
          ? 'FSR'
          : roadClass === 'permit'
            ? 'permit road'
            : roadClass === 'user' || road.roadEvidence?.source === 'user'
              ? 'user road'
              : 'existing road'
      return [{ ...closest, featureId: road.id, name: `${label} · ${road.name}` }]
    })
    .sort((a, b) => a.distanceM - b.distanceM || a.featureId.localeCompare(b.featureId))
    .slice(0, MAX_GENERATED_COST_TARGETS)
  const ends = [
    {
      coordinate: active.points.at(-1)!.coordinate,
      featureId: active.networkEntryRoadId ?? active.fsrConnection?.targetFeatureId,
    },
    ...nearbyRoadTargets,
  ]
  const uniqueEnds: typeof ends = []
  for (const target of ends) {
    const index = uniqueEnds.findIndex(
      (other) =>
        distance(target.coordinate, other.coordinate) < CONNECTOR_ENDPOINT_TOLERANCE_M &&
        (!target.featureId || !other.featureId || target.featureId === other.featureId),
    )
    if (index < 0) uniqueEnds.push(target)
    else if (!uniqueEnds[index].featureId && target.featureId) uniqueEnds[index] = target
  }
  for (const target of uniqueEnds.slice(0, MAX_GENERATED_COST_TARGETS)) {
    const end = target.coordinate
    if (candidates.length >= MAX_FULL_COST_CANDIDATES) break
    checkAbort()
    onProgress?.('Generating horizontal terrain alternatives to connected-road tie-ins…')
    await yieldControl()
    try {
      // A proximity discount is never counted as connected reuse in the complete cost model.
      const routes = suggestRoutes(origin, end, source, project.settings, project.context, {
        ...DEFAULT_ROUTE_OPTIONS,
        ...project.routeSearch,
        alternatives: 2,
        reuseExistingRoads: false,
      })
      for (const route of routes.routes) {
        if (candidates.length >= MAX_FULL_COST_CANDIDATES) break
        let id: string
        do {
          id = `complete-route-${++generated}`
        } while (usedAlignmentIds.has(id))
        usedAlignmentIds.add(id)
        const targetRoad = project.context.find((road) => road.id === target.featureId)
        const targetClass = targetRoad?.roadEvidence?.roadClass
        const targetLabel = targetRoad
          ? `${targetClass === 'fsr' ? 'FSR' : targetClass === 'permit' ? 'permit road' : targetClass === 'user' || targetRoad.roadEvidence?.source === 'user' ? 'user road' : 'existing road'} · ${targetRoad.name}`
          : 'entered tie-in'
        const draft: Alignment = {
          id,
          name: `Terrain connector ${generated} → ${targetLabel}`.slice(0, 200),
          color: '#db2777',
          points: route.coordinates.map((coordinate, index) => ({ id: `${id}-p${index}`, coordinate, radiusM: 0 })),
          vertical: [],
          template: structuredClone(active.template),
          overrides: [],
          networkEntryRoadId: target.featureId,
          engineering: {
            ...createEngineeringDesign(),
            materials: structuredClone(active.engineering?.materials ?? []),
            haul: structuredClone(active.engineering?.haul ?? createEngineeringDesign().haul),
          },
          ...(active.curveDesign ? { curveDesign: structuredClone(active.curveDesign) } : {}),
        }
        const simple: RoadPoint[] = []
        for (const point of draft.points) {
          while (simple.length >= 2) {
            const a = simple.at(-2)!.coordinate,
              b = simple.at(-1)!.coordinate,
              c = point.coordinate
            const ux = b[0] - a[0],
              uy = b[1] - a[1],
              vx = c[0] - b[0],
              vy = c[1] - b[1]
            if (
              ux * vx + uy * vy < 0 ||
              Math.abs(ux * vy - uy * vx) > 1e-8 * Math.max(1e-20, Math.hypot(ux, uy) * Math.hypot(vx, vy))
            )
              break
            simple.pop()
          }
          simple.push(point)
        }
        const fit = fitHorizontalRadii(
          simple,
          { kind: 'radius', radiusM: Math.max(5, project.settings.minRadius) + 0.1 },
          { minRadiusM: project.settings.minRadius },
        )
        const fitted = { ...draft, points: fit.points }
        if (
          target.featureId &&
          project.context.find((road) => road.id === target.featureId)?.roadEvidence?.roadClass === 'fsr'
        )
          fitted.fsrConnection = {
            targetFeatureId: target.featureId,
            targetName:
              project.context.find((feature) => feature.id === target.featureId)?.name ??
              `Mapped road ${target.featureId}`,
            targetCoordinate: [...target.coordinate],
            originCoordinate: [...origin],
            originAlignmentId: active.id,
            endpoint: 'start',
            preference: 'lowest-cost',
            networkScope:
              'FSR target in the loaded project network; bounded full-cost horizontal candidate generation.',
            straightLineDistanceM: distance(origin, target.coordinate),
            routeLengthM: alignmentLength(fitted),
            searchCost: route.cost,
          }
        // Horizontal generation must not replace an entered profile with another automatic profile on the same road.
        const generatedEntry = target.featureId ?? entryRoadFor(fitted)
        if (
          generatedEntry &&
          knownHorizontals.some(
            (existing) => existing.entryRoadId === generatedEntry && sameHorizontalGeometry(existing.alignment, fitted),
          )
        )
          continue
        await add(
          initializedProfile(fitted, source),
          'New fitted terrain-cost candidate; independent terrain-initialized profile. Materials use entered rates; station-based structures/horizons are not transplanted.',
          target.featureId,
          target.coordinate,
          !!active.engineering?.strata.length,
        )
        knownHorizontals.push({ alignment: fitted, entryRoadId: generatedEntry })
      }
    } catch (error) {
      if (signal?.aborted) throw error
      generationWarnings.push(
        `Horizontal search to ${end.map((value) => value.toFixed(5)).join(', ')}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (!candidates.length) throw Error('No candidate could be evaluated on the supplied terrain and geometry.')
  checkAbort()
  onProgress?.('Building the reviewed connected road network…')
  await yieldControl()
  const attachments = fullCostNetworkAttachments(inputs, planning)
  const network = buildRoadNetwork(roadNetworkInputs(project.context), planning.networkPolicy, attachments)
  checkAbort()
  const priced: FullCostComparison['candidates'] = []
  let pathSearches = 0,
    scope = ''
  for (const [index, input] of inputs.entries()) {
    onProgress?.(`Pricing connector ${index + 1} of ${inputs.length}: ${input.name}`)
    await yieldControl()
    checkAbort()
    const partial = compareFullCostCandidates([input], planning, (from, to, options) => {
      checkAbort()
      if (++pathSearches > MAX_FULL_COST_PATH_SEARCHES)
        throw Error(
          'Full-cost network path budget exceeded across the candidate comparison; reduce sources or horizontal alternatives.',
        )
      return shortestRoadNetworkPath(network, from, to, options)
    })
    priced.push(...partial.candidates)
    scope = partial.scope
  }
  await yieldControl()
  checkAbort()
  const winner = priced
    .filter((candidate) => candidate.status === 'feasible' && candidate.totalCost !== null)
    .sort((a, b) => a.totalCost! - b.totalCost! || a.id.localeCompare(b.id))[0]
  const comparison: FullCostComparison = { candidates: priced, winnerId: winner?.id ?? null, pathSearches, scope }
  return { comparison, candidates, network, generationWarnings }
}
