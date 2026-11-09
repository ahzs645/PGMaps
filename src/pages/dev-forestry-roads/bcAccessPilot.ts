/** A small, reproducible open-data pilot. The live records stay in the user's project, never in an app snapshot. */
import type { ContextFeature, Coordinate } from './types'
import type { HistoricalSource, HistoricalSourceQuery } from './accessHistoryTypes'
import {
  ACCESS_HISTORY_SOURCES,
  MAX_ACCESS_SOURCE_TIMEOUT_MS,
  accessSourceSnapshotVersion,
  blockIdentitySources,
  buildBcRoadSegmentsQuery,
  loadBcOpeningFootprints,
  loadBcRoadSegments,
  roadSegmentSources,
  type BlockIdentityLookup,
} from './accessHistorySources'
import { existingRoadQueryBounds, type RoadQueryBounds } from './existingRoads'
import { nearbyRoadCandidates } from './harvestHistory'

export const BC_PILOT_MAX_ROADS = 250
export const BC_PILOT_MAX_VERTICES = 30_000
export const BC_PILOT_SOURCE_TIMEOUT_MS = MAX_ACCESS_SOURCE_TIMEOUT_MS
export const BC_PILOT_TIMEOUT_MS = 65_000
export const BC_ACCESS_PILOT_RECIPE = {
  id: 'bc-opening-60677-v1',
  openingId: '60677',
  title: 'Opening 60677 · real BC records',
  roadBufferM: 1000,
  description:
    'Fetch the FTEN cutblock polygon and RESULTS identity for one opening, then query open FTEN segments in its locally buffered envelope. Establish source facts and candidate connections before adding historical evidence.',
} as const

export interface BcAccessPilotFinding {
  id: string
  kind: 'confirmed' | 'candidate' | 'gap'
  text: string
  sourceIds: string[]
}
export interface BcPilotRoadCandidate {
  roadId: string
  distanceM: number
  sharedClient: boolean
  sharedTimberMark: boolean
  sourceIds: string[]
}
export interface BcAccessPilotResult {
  status: 'loaded' | 'no-block-found'
  openingId: string
  retrievedAt: string
  bounds: RoadQueryBounds | null
  blocks: ContextFeature[]
  roads: ContextFeature[]
  sources: HistoricalSource[]
  identity: BlockIdentityLookup
  queries: HistoricalSourceQuery[]
  findings: BcAccessPilotFinding[]
  roadCandidates: BcPilotRoadCandidate[]
}

const unique = (values: readonly string[]) => [...new Set(values)].sort()
const sourceDefinition = (id: HistoricalSourceQuery['source']) =>
  ACCESS_HISTORY_SOURCES.find((source) => source.id === id)!
const vertexCount = (context: readonly ContextFeature[]) =>
  context.reduce(
    (total, feature) =>
      total +
      (feature.geometry.type === 'LineString'
        ? feature.geometry.coordinates.length
        : feature.geometry.coordinates.reduce((count, ring) => count + ring.length, 0)),
    0,
  )

/** Persist successful zero-row requests and skipped steps as distinct outcomes, with reproducible request URLs. */
export function makeHistoricalSourceQuery(
  query: HistoricalSourceQuery,
  retrievedAt: string,
  snapshot?: unknown,
): HistoricalSource {
  const definition = sourceDefinition(query.source)
  const content =
    snapshot === undefined
      ? undefined
      : JSON.parse(JSON.stringify(snapshot, (key, value) => (key === 'retrievedAt' ? undefined : value)))
  const description =
    query.status === 'skipped'
      ? `The ${definition.name} request was not made. ${query.reason ?? 'No usable cutblock footprint was returned.'} This is not an empty inventory result.`
      : `A bounded ${definition.name} request returned ${query.recordCount} source record(s). ${query.bounds ? 'The spatial envelope is retained with the request; linework may extend beyond it. ' : ''}${query.recordCount === 0 ? 'No rows in this query is not evidence of absence. ' : ''}No historical road use, construction date or current access is inferred.`
  return {
    id: `bc-source-query:${query.openingId ?? 'extent'}:${query.source}:v${accessSourceSnapshotVersion({ query, content })}`,
    dataset: `${definition.name} · bounded query outcome`,
    recordId: query.openingId ? `opening:${query.openingId}` : `extent:${query.bounds?.join(',') ?? 'unspecified'}`,
    url: definition.catalogueUrl,
    retrievedAt,
    publishedOn: null,
    synthetic: false,
    description,
    query,
  }
}

function pilotFindings(
  identity: BlockIdentityLookup,
  blocks: readonly ContextFeature[],
  roads: readonly ContextFeature[],
  sources: readonly HistoricalSource[],
): { findings: BcAccessPilotFinding[]; roadCandidates: BcPilotRoadCandidate[] } {
  const blockSources = sources.filter((source) => source.blockIdentity?.openingId === identity.openingId)
  const blockRefs = blockSources.map((source) => source.id)
  const roadRefs = roadSegmentSources(roads).map((source) => source.id)
  const findings: BcAccessPilotFinding[] = []
  const add = (id: string, kind: BcAccessPilotFinding['kind'], text: string, sourceIds: string[] = []) =>
    findings.push({ id, kind, text, sourceIds: unique(sourceIds) })
  const disagreements = identity.matches.flatMap((match) => match.conflicts)
  if (identity.matches.length)
    add(
      'opening-identity',
      'confirmed',
      `${identity.matches.length} RESULTS/FTEN record pair(s) share exact opening ID ${identity.openingId}. ${disagreements.length ? 'Supporting business fields disagree and require review.' : 'No disagreement was found among their supplied licence, cutting-permit, block, timber-mark and client codes.'} This identifies the opening; it does not identify a road used by it.`,
      blockRefs,
    )
  if (identity.missingSources.length)
    add(
      'missing-identity-source',
      'gap',
      `No record was returned by ${identity.missingSources.join(', ')} for opening ${identity.openingId}. The unmatched source records are retained; missing rows are not evidence of absence.`,
      blockRefs,
    )
  if (disagreements.length)
    add(
      'identity-conflicts',
      'gap',
      `${disagreements.length} supporting-key disagreement(s): ${unique(disagreements.map((conflict) => conflict.field)).join(', ')}. The typed source snapshots retain both reported values; no version was silently preferred.`,
      blockRefs,
    )
  if (blocks.length)
    add(
      'mapped-cutblock',
      'confirmed',
      `${blocks.length} FTEN cutblock polygon part(s) were retained at their returned coordinates. The boundary is a tenure footprint, not a reconstructed road entrance.`,
      blockRefs,
    )
  else
    add(
      'missing-footprint',
      'gap',
      'No FTEN cutblock polygon was returned. Nearby roads were not queried because there is no authoritative footprint from which to define the local search.',
      blockRefs,
    )
  const ften = identity.records.filter((record) => record.source === 'ften-cutblock')
  const windows = unique(
    ften
      .filter((record) => record.disturbanceStartDate || record.disturbanceEndDate)
      .map(
        (record) =>
          `${record.disturbanceStartDate ?? 'unknown start'} to ${record.disturbanceEndDate ?? 'unknown completion'}`,
      ),
  )
  if (windows.length)
    add(
      'reported-harvest-dates',
      'confirmed',
      `FTEN reports harvesting dates: ${windows.join('; ')}. Its start field is harvesting start; the completion field can be actual or estimated. RESULTS disturbance dates summarize reported activities. These dates do not date a road or prove which route was used.`,
      blockRefs,
    )
  else if (blocks.length)
    add(
      'missing-harvest-dates',
      'gap',
      'The returned FTEN record supplies no harvest start or completion date. No harvest year was guessed from lifecycle status or retrieval time.',
      blockRefs,
    )
  const clients = new Set(identity.records.flatMap((record) => (record.clientNumber ? [record.clientNumber] : [])))
  const marks = new Set(identity.records.flatMap((record) => (record.timberMark ? [record.timberMark] : [])))
  const candidates = new Map<string, BcPilotRoadCandidate>()
  const footprints = new Map(blocks.map((block) => [block.harvestEvidence?.sourceId ?? block.id, block]))
  for (const block of footprints.values()) {
    for (const candidate of nearbyRoadCandidates(block, [...blocks, ...roads], {
      maxDistanceM: BC_ACCESS_PILOT_RECIPE.roadBufferM,
    })) {
      const previous = candidates.get(candidate.road.id)
      if (previous && previous.distanceM <= candidate.distanceM) continue
      const evidence = candidate.road.roadEvidence
      candidates.set(candidate.road.id, {
        roadId: candidate.road.id,
        distanceM: candidate.distanceM,
        sharedClient: !!evidence?.clientNumber && clients.has(evidence.clientNumber),
        sharedTimberMark: !!evidence?.timberMark && marks.has(evidence.timberMark),
        sourceIds: evidence?.sourceId ? [evidence.sourceId] : [],
      })
    }
  }
  const roadCandidates = [...candidates.values()].sort(
    (a, b) => a.distanceM - b.distanceM || a.roadId.localeCompare(b.roadId),
  )
  if (blocks.length) {
    const touching = roadCandidates.filter((candidate) => candidate.distanceM === 0)
    add(
      'nearby-roads',
      roads.length ? 'candidate' : 'gap',
      `${roads.length} tenure road part(s) intersect the buffered query envelope; ${roadCandidates.length} are within ${BC_ACCESS_PILOT_RECIPE.roadBufferM} m of the actual cutblock footprint, including ${touching.length} with zero geometric separation. Proximity or intersection is a candidate connection; it is not a reviewed entrance, continuous access route or historical-use record.`,
      roadRefs,
    )
    if (roads.length) {
      const sameClient = roads.filter(
        (road) => !!road.roadEvidence?.clientNumber && clients.has(road.roadEvidence.clientNumber),
      ).length
      const sameMark = roads.filter(
        (road) => !!road.roadEvidence?.timberMark && marks.has(road.roadEvidence.timberMark),
      ).length
      add(
        'shared-business-codes',
        'candidate',
        `${sameClient} road part(s) share a reported opening client code; ${sameMark} share an exact timber mark. A client can hold many roads and cutblocks, and road timber marks can identify a different authority. These code comparisons do not establish service to this block.`,
        [...blockRefs, ...roadRefs],
      )
    }
  }
  add(
    'road-chronology',
    'gap',
    'This import supplies no physical road construction, presence-observation, closure or deactivation events. ACTIVE/RETIRED tenure status and retirement or retrieval dates do not establish the network at the harvest date.',
    roadRefs,
  )
  add(
    'access-anchors',
    'gap',
    'This import supplies no reviewed block entrance or established-network outlet. Neither a centroid nor the nearest road point was substituted.',
    blockRefs,
  )
  add(
    'crossing-evidence',
    'gap',
    'Bridge and culvert inventories were not queried by this open-data recipe. Crossing presence, historical configuration and load capacity remain unassessed; no returned structures is not evidence that none exist.',
  )
  add(
    'use-and-purpose',
    'gap',
    'No route-use record or construction rationale was returned. A road plan, as-built record, applicable crossing report or route-specific operations document is still needed to assess the historical connection.',
    [...blockRefs, ...roadRefs],
  )
  return { findings, roadCandidates }
}

/** Atomic data assembly only. Callers stage or merge the result; this function never edits a project. */
export async function loadBcAccessPilot(
  openingId: string = BC_ACCESS_PILOT_RECIPE.openingId,
  signal?: AbortSignal,
): Promise<BcAccessPilotResult> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Pilot loading cancelled.', 'AbortError')
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException('The bounded BC pilot timed out; no partial records were imported.', 'TimeoutError'),
      ),
    BC_PILOT_TIMEOUT_MS,
  )
  try {
    const footprint = await loadBcOpeningFootprints(openingId, controller.signal, BC_PILOT_SOURCE_TIMEOUT_MS)
    const id = footprint.identity.openingId
    const coordinates: Coordinate[] = footprint.blocks.flatMap((block) =>
      block.geometry.type === 'Polygon'
        ? block.geometry.coordinates.flat().map((point) => [point[0], point[1]] as Coordinate)
        : [],
    )
    const bounds = coordinates.length
      ? existingRoadQueryBounds(coordinates, BC_ACCESS_PILOT_RECIPE.roadBufferM / 1000)
      : null
    const roads = bounds
      ? await loadBcRoadSegments(bounds, controller.signal, BC_PILOT_MAX_ROADS, BC_PILOT_SOURCE_TIMEOUT_MS)
      : []
    if (controller.signal.aborted)
      throw controller.signal.reason ?? new DOMException('Pilot loading cancelled.', 'AbortError')
    if (roads.length > BC_PILOT_MAX_ROADS)
      throw Error(`The pilot exceeds ${BC_PILOT_MAX_ROADS} road geometry parts; no partial network was accepted.`)
    if (vertexCount([...footprint.blocks, ...roads]) > BC_PILOT_MAX_VERTICES)
      throw Error(`The pilot exceeds ${BC_PILOT_MAX_VERTICES} context vertices; choose a smaller opening.`)
    const retrievedAt = new Date().toISOString()
    const queries: HistoricalSourceQuery[] = [
      {
        source: 'results-opening',
        status: 'success',
        recordCount: footprint.identity.records.filter((record) => record.source === 'results-opening').length,
        requestUrl: footprint.resultsQueryUrl,
        openingId: id,
      },
      {
        source: 'ften-cutblock',
        status: 'success',
        recordCount: footprint.identity.records.filter((record) => record.source === 'ften-cutblock').length,
        requestUrl: footprint.cutblockQueryUrl,
        openingId: id,
      },
      bounds
        ? {
            source: 'ften-road-segment',
            status: 'success',
            recordCount: new Set(roads.map((road) => road.roadEvidence!.sourceId)).size,
            requestUrl: buildBcRoadSegmentsQuery(bounds, BC_PILOT_MAX_ROADS),
            openingId: id,
            bounds,
          }
        : {
            source: 'ften-road-segment',
            status: 'skipped',
            recordCount: 0,
            requestUrl: '',
            openingId: id,
            reason: 'No FTEN cutblock footprint was returned, so no local road search was attempted.',
          },
    ]
    const sources = [
      ...blockIdentitySources(footprint.identity),
      ...roadSegmentSources(roads),
      ...queries.map((query) =>
        makeHistoricalSourceQuery(
          query,
          retrievedAt,
          query.source === 'ften-road-segment'
            ? roads
            : query.source === 'ften-cutblock'
              ? {
                  records: footprint.identity.records.filter((record) => record.source === 'ften-cutblock'),
                  blocks: footprint.blocks,
                }
              : footprint.identity.records.filter((record) => record.source === 'results-opening'),
        ),
      ),
    ]
    const { findings, roadCandidates } = pilotFindings(footprint.identity, footprint.blocks, roads, sources)
    const description = findings.map((finding) => `${finding.kind}: ${finding.text}`).join('\n')
    if (description.length > 4000)
      throw Error('The pilot evidence summary exceeds the saved-source limit; narrow the opening lookup.')
    sources.push({
      id: `bc-pilot-findings:${id}:v${accessSourceSnapshotVersion({ description, refs: findings.flatMap((finding) => finding.sourceIds) })}`,
      dataset: 'PGMaps bounded BC source review',
      recordId: `opening:${id}`,
      url: sourceDefinition('ften-cutblock').catalogueUrl,
      retrievedAt,
      publishedOn: null,
      synthetic: false,
      description,
    })
    return {
      status: footprint.blocks.length ? 'loaded' : 'no-block-found',
      openingId: id,
      retrievedAt,
      bounds,
      blocks: footprint.blocks,
      roads,
      sources,
      identity: footprint.identity,
      queries,
      findings,
      roadCandidates,
    }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
    controller.abort()
  }
}
