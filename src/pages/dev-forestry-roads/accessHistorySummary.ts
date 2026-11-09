/** Explain retained evidence coverage without turning inventory, identity or proximity into historical use. */
import {
  assessHistoricalPath,
  assessHistoricalRoad,
  assessHistoricalStructures,
  historicalAnchorProblems,
} from './accessHistory'
import type {
  HistoricalAccessPath,
  HistoricalAccessState,
  HistoricalAnchor,
  HistoricalSource,
  HistoricalSourceQuery,
  HistoricalStructure,
  HistoricalStructureAssessment,
  HistoricalTemporalAssessment,
} from './accessHistoryTypes'
import { harvestAgeSummary, type HarvestEvidence } from './harvestHistory'
import type { ContextFeature } from './types'

type Status = HistoricalTemporalAssessment['status']
type StatusCounts = Record<Status, number>
type Bounds = [number, number, number, number]
export type HistoricalCoverageNextStep =
  | 'load-block'
  | 'load-roads'
  | 'place-entrance'
  | 'place-outlet'
  | 'resolve-evidence'
  | 'trace'
  | 'review'

export interface HistoricalCoverageSummary {
  block: ContextFeature | null
  asOf: string
  /** Loaded-area counts never assert that those roads or assets connect to the selected block. */
  scope: 'selected-path' | 'loaded-study-area'
  scopeLabel: string
  scopeBounds: Bounds | null
  selectedPath: HistoricalAccessPath | null
  identitySources: HistoricalSource[]
  identity: {
    snapshotCount: number
    entityCount: number
    matchedDatasets: string[]
    conflicts: { field: string; values: string[]; sourceIds: string[] }[]
  }
  /** Latest retained query for each source and this opening, not a claim about province-wide completeness. */
  queryCoverage: {
    source: HistoricalSourceQuery['source']
    status: HistoricalSourceQuery['status'] | 'not-retained'
    recordCount: number | null
    sourceRecord: HistoricalSource | null
  }[]
  harvest: { evidence: HarvestEvidence | undefined; label: string }
  roads: { feature: ContextFeature; assessment: HistoricalTemporalAssessment; physicalEventCount: number }[]
  structures: { structure: HistoricalStructure; assessment: HistoricalStructureAssessment }[]
  roadCoverage: StatusCounts & { total: number; withoutDatedPhysicalEvidence: number; withSourceKeys: number }
  structureCoverage: StatusCounts & {
    total: number
    matched: number
    unresolved: number
    withoutConstructionDate: number
  }
  anchors: { entrances: HistoricalAnchor[]; outlets: HistoricalAnchor[] }
  anchorIssues: { anchorId: string; reasons: string[] }[]
  pathCoverage: {
    total: number
    inferred: number
    planned: number
    documented: number
    rejected: number
    stale: number
  }
  findings: { id: string; tone: 'info' | 'warning' | 'positive'; message: string }[]
  nextStep: HistoricalCoverageNextStep
}

const statuses = (values: readonly { status: Status }[]): StatusCounts =>
  values.reduce(
    (counts, assessment) => {
      counts[assessment.status]++
      return counts
    },
    { compatible: 0, unknown: 0, contradicted: 0, conflict: 0 },
  )
const identityFields = ['forestFileId', 'cuttingPermitId', 'cutBlockId', 'timberMark', 'clientNumber'] as const

function pointWithin(point: readonly number[], bounds: Bounds): boolean {
  return point[0] >= bounds[0] && point[0] <= bounds[2] && point[1] >= bounds[1] && point[1] <= bounds[3]
}
function lineIntersects(line: readonly number[][], bounds: Bounds): boolean {
  for (let index = 1; index < line.length; index++) {
    const a = line[index - 1],
      b = line[index]
    let first = 0,
      last = 1
    for (let axis = 0; axis < 2; axis++) {
      const change = b[axis] - a[axis]
      if (Math.abs(change) < 1e-15) {
        if (a[axis] < bounds[axis] || a[axis] > bounds[axis + 2]) first = 2
        continue
      }
      const ends = [(bounds[axis] - a[axis]) / change, (bounds[axis + 2] - a[axis]) / change]
      first = Math.max(first, Math.min(...ends))
      last = Math.min(last, Math.max(...ends))
    }
    if (first <= last) return true
  }
  return false
}
function blockBounds(block: ContextFeature | null, entrances: readonly HistoricalAnchor[]): Bounds | null {
  if (block?.geometry.type !== 'Polygon') return null
  const points = [...block.geometry.coordinates.flat(), ...entrances.map((anchor) => anchor.coordinate)]
  const south = Math.min(...points.map((point) => point[1])),
    north = Math.max(...points.map((point) => point[1]))
  const latitudeBuffer = 1000 / 111195.0802335329
  const longitudeBuffer = latitudeBuffer / Math.cos((((south + north) / 2) * Math.PI) / 180)
  return [
    Math.max(-180, Math.min(...points.map((point) => point[0])) - longitudeBuffer),
    Math.max(-84.999, south - latitudeBuffer),
    Math.min(180, Math.max(...points.map((point) => point[0])) + longitudeBuffer),
    Math.min(84.999, north + latitudeBuffer),
  ]
}

export function assessHistoricalCoverage({
  context,
  state,
  blockId,
}: {
  context: readonly ContextFeature[]
  state: HistoricalAccessState
  blockId?: string
}): HistoricalCoverageSummary {
  const block = context.find((f) => f.id === blockId && f.kind === 'harvest' && f.geometry.type === 'Polygon') ?? null
  const paths = block ? state.paths.filter((path) => path.blockId === block.id) : []
  const selected = paths.find((path) => path.id === state.selectedPathId) ?? null
  const selectedAssessment = selected ? assessHistoricalPath(selected, state, context) : null
  const selectedPath =
    selected &&
    selected.relationship !== 'rejected' &&
    selectedAssessment &&
    !selectedAssessment.stale &&
    selectedAssessment.connectivity === 'stored-continuous' &&
    !['conflict', 'contradicted'].includes(selectedAssessment.temporalStatus)
      ? selected
      : null
  const asOf = selectedPath?.settings.asOf ?? state.settings.asOf
  const scope = selectedPath ? 'selected-path' : 'loaded-study-area'
  const openingId = block?.harvestEvidence?.openingId
  const identitySources = openingId
    ? state.sources.filter((source) => source.blockIdentity?.openingId === openingId)
    : []
  const identity = {
    snapshotCount: identitySources.length,
    entityCount: new Set(identitySources.map((source) => source.blockIdentity!.entityId)).size,
    matchedDatasets: [...new Set(identitySources.map((source) => source.blockIdentity!.source))].sort(),
    conflicts: identityFields.flatMap((field) => {
      const values = [...new Set(identitySources.flatMap((source) => source.blockIdentity![field] ?? []))].sort()
      return values.length > 1
        ? [
            {
              field,
              values,
              sourceIds: identitySources.filter((source) => source.blockIdentity![field]).map((source) => source.id),
            },
          ]
        : []
    }),
  }
  const queryCoverage: HistoricalCoverageSummary['queryCoverage'] = (
    ['results-opening', 'ften-cutblock', 'ften-road-segment'] as const
  ).map((source) => {
    const retained = openingId
      ? state.sources
          .filter((record) => record.query?.source === source && record.query.openingId === openingId)
          .sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt) || a.id.localeCompare(b.id))[0]
      : undefined
    return {
      source,
      status: retained?.query?.status ?? 'not-retained',
      recordCount: retained?.query?.recordCount ?? null,
      sourceRecord: retained ?? null,
    }
  })
  const savedEntrances = block
    ? state.anchors.filter((anchor) => anchor.role === 'entrance' && anchor.blockId === block.id)
    : []
  const locationSettings = selectedPath?.settings ?? state.settings
  const anchorIssues = savedEntrances
    .map((anchor) => ({ anchorId: anchor.id, reasons: historicalAnchorProblems(anchor, context, locationSettings) }))
    .filter((issue) => issue.reasons.length)
  const entrances = savedEntrances.filter((anchor) => !anchorIssues.some((issue) => issue.anchorId === anchor.id))
  const blockOutlets = block
    ? state.anchors.filter((anchor) => anchor.role === 'outlet' && anchor.blockId === block.id)
    : []
  let scopeBounds = selectedPath
    ? null
    : (queryCoverage.find((query) => query.source === 'ften-road-segment' && query.status === 'success')?.sourceRecord
        ?.query?.bounds ?? blockBounds(block, entrances))
  if (scopeBounds && blockOutlets.length) {
    const corridor = blockBounds(block, [...entrances, ...blockOutlets])!
    scopeBounds = [
      Math.min(scopeBounds[0], corridor[0]),
      Math.min(scopeBounds[1], corridor[1]),
      Math.max(scopeBounds[2], corridor[2]),
      Math.max(scopeBounds[3], corridor[3]),
    ]
  }
  const realBlock = !!block && block.harvestEvidence?.source !== 'scenario'
  const outlets = state.anchors.filter((anchor) => {
    if (anchor.role !== 'outlet') return false
    if (selectedPath) return anchor.id === selectedPath.outletId
    if (anchor.blockId && anchor.blockId !== block?.id) return false
    if (scopeBounds && !pointWithin(anchor.coordinate, scopeBounds)) return false
    if (
      realBlock &&
      anchor.blockId !== block?.id &&
      context.find((feature) => feature.id === anchor.roadId)?.roadEvidence?.source === 'scenario'
    )
      return false
    const reasons = historicalAnchorProblems(anchor, context, locationSettings)
    if (reasons.length) anchorIssues.push({ anchorId: anchor.id, reasons })
    return !reasons.length
  })
  const anchors = { entrances, outlets }
  const explicitRoads = new Set([
    ...anchors.entrances.flatMap((anchor) => (anchor.roadId ? [anchor.roadId] : [])),
    ...blockOutlets.flatMap((anchor) => (anchor.roadId ? [anchor.roadId] : [])),
    ...(selected?.roadIds ?? []),
  ])
  const syntheticSources = new Set(state.sources.filter((source) => source.synthetic).map((source) => source.id))
  const syntheticStructure = (structure: HistoricalStructure) =>
    structure.sourceIds.length > 0 && structure.sourceIds.every((id) => syntheticSources.has(id))
  const roads = context
    .filter(
      (feature) =>
        feature.kind === 'existing-road' &&
        feature.geometry.type === 'LineString' &&
        (selectedPath
          ? selectedPath.roadIds.includes(feature.id)
          : (!scopeBounds || lineIntersects(feature.geometry.coordinates, scopeBounds)) &&
            (!realBlock || feature.roadEvidence?.source !== 'scenario' || explicitRoads.has(feature.id))),
    )
    .map((feature) => ({
      feature,
      assessment: assessHistoricalRoad(feature, state.events, asOf),
      physicalEventCount: state.events.filter(
        (event) => event.roadId === feature.id && (event.when.earliest !== null || event.when.latest !== null),
      ).length,
    }))
  const assetAssessments = new Map(assessHistoricalStructures(state, context, asOf).map((a) => [a.structureId, a]))
  const structures = state.structures
    .filter((structure) =>
      selectedPath
        ? selectedPath.structureIds.includes(structure.id)
        : (!scopeBounds || pointWithin(structure.coordinate, scopeBounds)) &&
          (!realBlock || !syntheticStructure(structure) || (!!structure.roadId && explicitRoads.has(structure.roadId))),
    )
    .map((structure) => ({ structure, assessment: assetAssessments.get(structure.id)! }))
  const roadCoverage = {
    ...statuses(roads.map((road) => road.assessment)),
    total: roads.length,
    withoutDatedPhysicalEvidence: roads.filter((road) => road.physicalEventCount === 0).length,
    withSourceKeys: roads.filter(
      ({ feature }) => feature.roadEvidence?.forestFileId?.trim() && feature.roadEvidence.roadSectionId?.trim(),
    ).length,
  }
  const structureCoverage = {
    ...statuses(structures.map((structure) => structure.assessment)),
    total: structures.length,
    matched: structures.filter((structure) => structure.assessment.binding === 'matched').length,
    unresolved: structures.filter((structure) => structure.assessment.binding === 'unresolved').length,
    withoutConstructionDate: structures.filter(
      ({ structure }) => !structure.construction?.earliest && !structure.construction?.latest,
    ).length,
  }
  const pathCoverage = {
    total: paths.length,
    inferred: paths.filter((path) => path.relationship === 'inferred-access').length,
    planned: paths.filter((path) => path.relationship === 'planned-access').length,
    documented: paths.filter((path) => path.relationship === 'documented-use').length,
    rejected: paths.filter((path) => path.relationship === 'rejected').length,
    stale: paths.filter((path) => assessHistoricalPath(path, state, context).stale).length,
  }
  const findings: HistoricalCoverageSummary['findings'] = []
  findings.push({
    id: 'inventory-scope',
    tone: 'info',
    message: selectedPath
      ? `Counts describe the selected saved route at ${asOf}. The route's own date and assumptions are retained.`
      : block
        ? 'Counts describe loaded candidates within this opening’s retained road-query bounds, or a 1 km buffer around the block, its entrances and explicitly assigned outlets. No road or structure connection to the block is asserted.'
        : 'Counts describe the loaded study area. Choose a block to scope the evidence; no connection to any block is asserted.',
  })
  if (
    realBlock &&
    (roads.some(({ feature }) => feature.roadEvidence?.source === 'scenario') ||
      structures.some(({ structure }) => structure.sourceIds.some((id) => syntheticSources.has(id))))
  )
    findings.push({
      id: 'synthetic-mixing',
      tone: 'warning',
      message:
        'An explicit anchor or saved path includes synthetic example evidence for this real block. Keep the demonstration separate from conclusions about actual historical access.',
    })
  if (selected && !selectedPath)
    findings.push({
      id: 'selected-path-unavailable',
      tone: 'warning',
      message:
        'The selected assertion is rejected, stale or unresolved. Loaded-area evidence is shown until a usable saved route is selected or retraced.',
    })
  if (anchorIssues.length)
    findings.push({
      id: 'access-location-gaps',
      tone: 'warning',
      message: `${anchorIssues.length} saved access locations in this scope are outside the block/road tolerance or reference missing features. Review their placement before tracing.`,
    })
  if (identitySources.length)
    findings.push({
      id: 'opening-identity',
      tone: identity.conflicts.length ? 'warning' : 'positive',
      message: identity.conflicts.length
        ? `Retained opening records disagree on ${identity.conflicts.map((conflict) => conflict.field).join(', ')}. Check distinct cutblocks, source versions and record applicability before drawing a conclusion.`
        : `${identity.entityCount} source entities share opening ${openingId}. This corroborates opening identity, not road construction purpose or historical use.`,
    })
  for (const query of queryCoverage)
    if (query.status === 'success' && query.recordCount === 0)
      findings.push({
        id: `empty-${query.source}`,
        tone: 'info',
        message: `The retained ${query.source} query returned zero records for its stated request. This does not prove that no historical feature existed.`,
      })
    else if (query.status === 'skipped')
      findings.push({
        id: `skipped-${query.source}`,
        tone: 'warning',
        message: `${query.source} was not queried. ${query.sourceRecord?.query?.reason ?? 'Its prerequisite evidence was unavailable.'}`,
      })
  if (
    identitySources.some(
      (source) =>
        source.blockIdentity?.source === 'results-opening' &&
        (source.blockIdentity.disturbanceStartDate || source.blockIdentity.disturbanceEndDate),
    )
  )
    findings.push({
      id: 'disturbance-not-harvest',
      tone: 'info',
      message:
        'RESULTS opening disturbance dates summarize reported activities. They are not substituted for harvest completion or road construction dates.',
    })
  if (
    identitySources.some(
      (source) =>
        source.blockIdentity?.source === 'ften-cutblock' &&
        (source.blockIdentity.disturbanceStartDate || source.blockIdentity.disturbanceEndDate),
    )
  )
    findings.push({
      id: 'ften-harvest-dates',
      tone: 'info',
      message:
        'FTEN reports actual harvest start; its completion field can be actual or estimated. These source dates retain that uncertainty and do not date a road or establish a route used.',
    })
  if (roadCoverage.withoutDatedPhysicalEvidence)
    findings.push({
      id: 'road-chronology',
      tone: 'warning',
      message: `${roadCoverage.withoutDatedPhysicalEvidence} of ${roadCoverage.total} mapped roads have no dated physical event. Administrative status and source retrieval dates do not establish when these roads existed.`,
    })
  if (
    roadCoverage.contradicted ||
    roadCoverage.conflict ||
    structureCoverage.contradicted ||
    structureCoverage.conflict
  )
    findings.push({
      id: 'temporal-exclusions',
      tone: 'warning',
      message: `${roadCoverage.contradicted + roadCoverage.conflict} road records and ${structureCoverage.contradicted + structureCoverage.conflict} structure records have contradictory or conflicting evidence at ${asOf}. Those records are excluded from a trace; an independent route may still be possible.`,
    })
  if (!structures.length)
    findings.push({
      id: 'crossing-coverage',
      tone: 'info',
      message:
        'No structure records are retained in this scope. The open identity/road queries do not query the Ministry or PSCIS structure inventories; an empty register does not establish that the route has no crossings.',
    })
  else if (structureCoverage.unresolved || structureCoverage.withoutConstructionDate)
    findings.push({
      id: 'crossing-gaps',
      tone: 'warning',
      message: `${structureCoverage.unresolved} structure records have unresolved road attachments; ${structureCoverage.withoutConstructionDate} lack construction timing. A mapped point and current inventory rating do not establish a historical crossing.`,
    })
  findings.push({
    id: 'use-claim',
    tone: 'info',
    message: pathCoverage.documented
      ? `${pathCoverage.documented} saved assertions are marked documented use by a reviewer. Review references are retained; the software does not independently authenticate them.`
      : 'No saved assertion for this block is marked documented use. Source identity, nearby road geometry and a possible network path are different forms of evidence.',
  })
  const eligibleRoads = roadCoverage.compatible + (state.settings.allowUnknownTime ? roadCoverage.unknown : 0)
  const nextStep: HistoricalCoverageNextStep = !block
    ? 'load-block'
    : !roads.length
      ? 'load-roads'
      : !anchors.entrances.length
        ? 'place-entrance'
        : !anchors.outlets.length
          ? 'place-outlet'
          : block.harvestEvidence?.status === 'proposed' || identity.conflicts.length
            ? 'resolve-evidence'
            : selectedPath
              ? 'review'
              : !eligibleRoads
                ? 'resolve-evidence'
                : 'trace'
  return {
    block,
    asOf,
    scope,
    scopeLabel: selectedPath ? 'Selected saved route' : block ? 'Nearby loaded candidates' : 'Loaded study area',
    scopeBounds,
    selectedPath,
    identitySources,
    identity,
    queryCoverage,
    harvest: {
      evidence: block?.harvestEvidence,
      label: harvestAgeSummary(block?.harvestEvidence, Number(asOf.slice(0, 4))),
    },
    roads,
    structures,
    roadCoverage,
    structureCoverage,
    anchors,
    anchorIssues,
    pathCoverage,
    findings,
    nextStep,
  }
}
