import { distance, offsetCoordinate } from './engine'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Coordinate, RoadAnalysis, RoadProject } from './types'

export const INTERNAL_ACCESS_DRAFT_NAME = 'Internal design placeholder · not a mapped road'
const LEGACY_ACCESS_DRAFT_NAME = 'Design draft · no historical-use assertion'

/** All consumers use this mode, rather than inferring historical use from a scenario name. */
export const isAccessInvestigation = (project: Pick<RoadProject, 'workspaceMode'>) =>
  project.workspaceMode === 'access-investigation'

/** Multipart geometry can produce several map features for one retained source row. */
export function mappedRoadRecordCount(project: Pick<RoadProject, 'context'>): number {
  return new Set(
    project.context
      .filter((feature) => feature.kind === 'existing-road')
      .map((feature) =>
        feature.roadEvidence?.sourceId ? `${feature.roadEvidence.source}:${feature.roadEvidence.sourceId}` : feature.id,
      ),
  ).size
}

/** Only the untouched starter from the first BC pilot is automatically migrated. */
export function legacyAccessInvestigation(project: RoadProject): RoadProject['investigation'] | undefined {
  if (project.workspaceMode !== undefined || project.scenario?.id !== 'bc-opening-60677') return undefined
  const road = project.alignments[0]
  const bounds = project.terrain.bounds
  if (
    !bounds ||
    project.alignments.length !== 1 ||
    road.id !== project.activeAlignmentId ||
    road.name !== LEGACY_ACCESS_DRAFT_NAME ||
    road.color !== '#d97706' ||
    road.points.length !== 2 ||
    road.points.some((point) => point.radiusM !== 0 || (point.spiralM ?? 0) !== 0) ||
    road.vertical.length ||
    road.overrides.length ||
    project.cables.length ||
    project.profiles?.length ||
    Object.keys(road).some(
      (key) => !['id', 'name', 'color', 'points', 'vertical', 'template', 'overrides'].includes(key),
    ) ||
    Object.keys(DEFAULT_TEMPLATE).some(
      (key) =>
        road.template[key as keyof typeof DEFAULT_TEMPLATE] !== DEFAULT_TEMPLATE[key as keyof typeof DEFAULT_TEMPLATE],
    ) ||
    Object.keys(road.template).length !== Object.keys(DEFAULT_TEMPLATE).length
  )
    return undefined
  const centre: Coordinate = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
  if (
    [270, 90].some(
      (bearing, index) => distance(road.points[index].coordinate, offsetCoordinate(centre, bearing, 150)) > 0.01,
    )
  )
    return undefined
  return { openingId: '60677', draftAlignmentId: road.id }
}

/** Explicit transition: the internal draft becomes an editable proposal only after this action. */
export function startInvestigationDesign(project: RoadProject): RoadProject {
  if (!isAccessInvestigation(project)) return project
  const { investigation, ...design } = project
  return {
    ...design,
    workspaceMode: 'design',
    alignments: project.alignments.map((alignment) =>
      alignment.id === investigation?.draftAlignmentId
        ? { ...alignment, name: 'New design draft · proposed alignment' }
        : alignment,
    ),
  }
}

/** The non-null engine contract is retained, but no placeholder geometry is analysed or exposed. */
export function investigationAnalysis(): RoadAnalysis {
  return {
    stations: [],
    centerline: [],
    crossings: [],
    length: 0,
    cutVolumeM3: 0,
    fillVolumeM3: 0,
    balanceM3: 0,
    surfaceVolumeM3: 0,
    clearingAreaM2: 0,
    estimatedCost: 0,
    maxGradePercent: 0,
    completeLength: 0,
    coveragePercent: 0,
    warnings: [],
  }
}

/** Fit complete loaded source footprints, including road parts that extend beyond the request box. */
export function investigationCoordinates(project: RoadProject): Coordinate[] {
  const coordinates = project.context.flatMap((feature) => {
    if (feature.geometry.type === 'LineString')
      return feature.geometry.coordinates.map(([x, y]) => [x, y] as Coordinate)
    if (feature.geometry.type === 'Polygon')
      return feature.geometry.coordinates[0].map(([x, y]) => [x, y] as Coordinate)
    return []
  })
  coordinates.push(...(project.accessHistory?.anchors.map((anchor) => anchor.coordinate) ?? []))
  coordinates.push(...(project.accessHistory?.structures.map((structure) => structure.coordinate) ?? []))
  return coordinates
}
