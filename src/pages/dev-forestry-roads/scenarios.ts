import { fetchHarvestedAreas } from '../dev-forestry/bcVisualInventory'
import type { TileDecoder } from '../dev-forestry/demLoader'
import type { Bounds } from '../dev-forestry/terrain'
import { loadBcExistingRoads } from './existingRoads'
import { alignmentLength, analyzeRoad, positionAt } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { parseProject } from './project'
import { DEFAULT_ROUTE_OPTIONS } from './routing'
import { requireScenarioTerrain } from './scenarioCoverage'
import { createFullCostTrainingProject } from './trainingFullCostScenario'
import {
  createDemoProject,
  DEFAULT_ROAD_SETTINGS,
  DEFAULT_TEMPLATE,
  demoTerrain,
  loadLidarTerrain,
  loadRegionalTerrain,
  localMetricGrid,
  terrainBounds,
} from './terrain'
import type { Alignment, ContextFeature, Coordinate, RoadProject, TerrainMetadata, TerrainSource } from './types'

export const ROAD_SCENARIOS = [
  {
    id: 'bc-lidar',
    name: 'Prince George · native LiDAR',
    terrain: 'Verified 1 m ground DTM',
    detail: 'A draft road on the published BC tile, with nearby public road tenures and harvest openings.',
    focus: 'Sections, terrain coverage and preliminary earthworks',
    kind: 'lidar',
  },
  {
    id: 'tabor-access',
    name: 'Tabor Mountain · access alternatives',
    terrain: 'Regional DEM · screening only',
    detail: 'Two draft approaches across a forested hillside, with public roads and nearby cutblocks.',
    focus: 'Compare new access against existing-road evidence',
    kind: 'regional',
    centre: [-122.5537, 53.796] as Coordinate,
  },
  {
    id: 'kamloops-dry-interior',
    name: 'Kamloops · dry Interior',
    terrain: 'Regional DEM · screening only',
    detail:
      'A deliberately steep starting corridor, with public road and harvest context. Draft grades need a different route.',
    focus: 'Grade-limit challenge: test constraints and route feasibility',
    kind: 'regional',
    centre: [-120.47, 50.84] as Coordinate,
  },
  {
    id: 'vernon-upland',
    name: 'Vernon · upland access',
    terrain: 'Regional DEM · screening only',
    detail:
      'An upland starting corridor whose rough ground challenges the grade limit, with mapped road tenure context.',
    focus: 'Grade-limit challenge and existing-access review',
    kind: 'regional',
    centre: [-119.12, 50.35] as Coordinate,
  },
  {
    id: 'smithers-northwest',
    name: 'Smithers · Northwest hillside',
    terrain: 'Regional DEM · screening only',
    detail: 'A northern landscape with two editable corridors and public forestry context.',
    focus: 'Compare route behaviour on another map',
    kind: 'regional',
    centre: [-127.023, 54.8107] as Coordinate,
  },
  {
    id: 'training-full-cost-access',
    name: 'Training · connected access, gravel and condition',
    terrain: 'Synthetic ground · offline',
    detail:
      'Two connectors and three selectable synthetic FSR sections, with dated evidence, a gravel source and waste site.',
    focus: 'Choose an FSR from Road start, then compare haul, rehabilitation and condition',
    kind: 'training',
  },
  {
    id: 'training-hillside',
    name: 'Training · hillside and drainage',
    terrain: 'Synthetic ground · offline',
    detail: 'Two roads, a drainage line, a review area, a turnout and landing. All context is synthetic.',
    focus: 'Learn the connected plan, profile and section views',
    kind: 'training',
  },
  {
    id: 'training-road-reuse',
    name: 'Training · reuse an old road',
    terrain: 'Synthetic ground · offline',
    detail: 'An assumed serviceable access road and a rehabilitation section, with a synthetic harvest block.',
    focus: 'Toggle road reuse and review condition assumptions',
    kind: 'training',
  },
  {
    id: 'training-local-gravel',
    name: 'Training · nearby free gravel',
    terrain: 'Synthetic ground · offline',
    detail:
      'The same road with and without a zero-acquisition local stockpile. Processing, loading and haul still cost.',
    focus: 'Compare enabled supply, finite capacity and purchased surfacing',
    kind: 'training',
  },
] as const

export type RoadScenarioId = (typeof ROAD_SCENARIOS)[number]['id']
export const REGIONAL_SCENARIO_ORIENTATIONS = 24
export const SCENARIO_PROFILE_STEP_M = 60
export const REGIONAL_SCENARIO_SCALES = [1, 0.55] as const
export const SCENARIO_CONTEXT_TIMEOUT_MS = 12_000

export function roadScenario(id: string) {
  const scenario = ROAD_SCENARIOS.find((item) => item.id === id)
  if (!scenario) throw Error('That road scenario is not in the library.')
  return scenario
}

export function createTrainingScenario(id: RoadScenarioId): RoadProject {
  const scenario = roadScenario(id)
  if (scenario.kind !== 'training') throw Error('This scenario requires its real terrain to be loaded first.')
  const project = id === 'training-full-cost-access' ? createFullCostTrainingProject() : createDemoProject()
  project.name = scenario.name
  project.scenario = { id, contextWarnings: [], terrainCoveragePercent: 100 }
  if (id === 'training-road-reuse') {
    const points = project.alignments[0].points
    project.context = [
      ...project.context.filter((feature) => feature.kind !== 'existing-road'),
      {
        id: 'scenario-serviceable-road',
        name: 'Synthetic old access · assumed serviceable',
        kind: 'existing-road',
        geometry: { type: 'LineString', coordinates: points.slice(0, 4).map((point) => point.coordinate) },
        roadEvidence: { source: 'scenario', condition: 'serviceable', conditionBasis: 'assumed', reuseAllowed: true },
      },
      {
        id: 'scenario-rehabilitation-road',
        name: 'Synthetic spur · rehabilitation assumed',
        kind: 'existing-road',
        geometry: { type: 'LineString', coordinates: points.slice(3).map((point) => point.coordinate) },
        roadEvidence: {
          source: 'scenario',
          condition: 'rehabilitation',
          conditionBasis: 'assumed',
          reuseAllowed: true,
        },
      },
    ]
    project.routeSearch = { ...DEFAULT_ROUTE_OPTIONS, alternatives: 2, reuseExistingRoads: true }
  }
  if (id === 'training-local-gravel') {
    const local = project.alignments[0]
    local.name = 'Same road · local gravel enabled'
    local.engineering = {
      ...createEngineeringDesign(),
      surfacingSupply: {
        enabled: true,
        name: 'Synthetic roadside gravel stockpile',
        acquisitionRate: 0,
        processingRate: 2,
        loadingRate: 1.5,
        haulDistanceKm: 0.8,
        haulRate: 1.2,
        placementRate: 3,
        capacityM3: 1000,
        sourceNotes: 'Synthetic scenario only; not a mapped pit, available material or supply permission.',
      },
    }
    const purchased = structuredClone(local)
    purchased.id = 'demo-purchased-gravel'
    purchased.name = 'Same road · local gravel disabled'
    purchased.color = '#2563eb'
    purchased.points = purchased.points.map((point, index) => ({ ...point, id: `demo-purchased-p${index}` }))
    purchased.vertical = purchased.vertical.map((point, index) => ({ ...point, id: `demo-purchased-v${index}` }))
    purchased.engineering!.surfacingSupply!.enabled = false
    project.alignments = [local, purchased]
  }
  return parseProject(project)
}

/** Deliberately draft geometry. Terrain samples initialize a reviewable profile, never a recommended route. */
export function regionalScenarioAlignments(id: string, centre: Coordinate, source: TerrainSource): Alignment[] {
  const grid = localMetricGrid(centre)
  const origin = grid.toGrid(centre)
  const paths = [
    [
      [-520, 0],
      [-230, -20],
      [70, 10],
      [330, -10],
      [520, 0],
    ],
    [
      [-520, 0],
      [-260, 80],
      [0, 110],
      [280, 75],
      [520, 0],
    ],
  ]
  const candidate = (angle: number, scale: number) =>
    paths.map((path, index) => {
      const alignment: Alignment = {
        id: `${id}-draft-${index + 1}`,
        name: `Draft approach ${index + 1} · review required`,
        color: index ? '#2563eb' : '#d97706',
        points: path.map(([x, y], point) => ({
          id: `${id}-${index}-${point}`,
          coordinate: grid.toLonLat([
            origin[0] + scale * (x * Math.cos(angle) - y * Math.sin(angle)),
            origin[1] + scale * (x * Math.sin(angle) + y * Math.cos(angle)),
          ]),
          radiusM: point > 0 && point < path.length - 1 ? 60 : 0,
        })),
        template: { ...DEFAULT_TEMPLATE },
        vertical: [],
        overrides: [],
      }
      const length = alignmentLength(alignment)
      const profileIntervals = Math.max(2, Math.ceil(length / SCENARIO_PROFILE_STEP_M))
      alignment.vertical = Array.from({ length: profileIntervals + 1 }, (_, point) => ({
        id: `${id}-${index}-v${point}`,
        chainage: (length * point) / profileIntervals,
        elevation: source.elevationAt(...positionAt(alignment, (length * point) / profileIntervals).coordinate),
        curveLength: point > 0 && point < profileIntervals ? 40 : 0,
      }))
      return alignment
    })
  // A bounded orientation screen avoids starting every landscape with the same steep diagonal.
  // These are still draft examples: their score omits access permissions and all field evidence.
  let best: Alignment[] | null = null
  let bestScore = Infinity
  for (const scale of REGIONAL_SCENARIO_SCALES) {
    let feasible = false
    for (let direction = 0; direction < REGIONAL_SCENARIO_ORIENTATIONS; direction++) {
      const alignments = candidate((direction * Math.PI) / REGIONAL_SCENARIO_ORIENTATIONS, scale)
      if (alignments.some((alignment) => alignment.vertical.some((point) => !Number.isFinite(point.elevation))))
        continue
      const results = alignments.map((alignment) => analyzeRoad(alignment, source, DEFAULT_ROAD_SETTINGS))
      if (
        results.every(
          (result) =>
            result.coveragePercent > 99.999 && result.maxGradePercent <= DEFAULT_ROAD_SETTINGS.maxGradePercent,
        )
      )
        feasible = true
      const score = results.reduce(
        (total, result) =>
          total +
          (100 - result.coveragePercent) * 1000 +
          (result.maxGradePercent > DEFAULT_ROAD_SETTINGS.maxGradePercent ? 10_000 : 0) +
          Math.max(0, result.maxGradePercent - DEFAULT_ROAD_SETTINGS.maxGradePercent) * 100 +
          result.maxGradePercent,
        0,
      )
      if (score < bestScore) {
        bestScore = score
        best = alignments
      }
    }
    if (feasible) break
  }
  if (!best) throw Error('No complete draft profile could be initialized on this scenario terrain.')
  return best
}

function harvestedContext(areas: Awaited<ReturnType<typeof fetchHarvestedAreas>>): ContextFeature[] {
  if (areas.truncated) throw Error('The harvest query reached its record limit; narrow the scenario extent.')
  return areas.areas.flatMap((area) => {
    const polygons = area.geometry.type === 'Polygon' ? [area.geometry.coordinates] : area.geometry.coordinates
    return polygons.map((coordinates, part) => ({
      id: `bc-harvest-${area.openingId}-${part}`,
      name: `${area.name} · mapped harvest opening`,
      kind: 'harvest' as const,
      geometry: { type: 'Polygon' as const, coordinates },
    }))
  })
}

/** Public layers are optional evidence. Report failures explicitly and keep no invented replacements. */
async function scenarioContext(bounds: Bounds, signal?: AbortSignal) {
  const controller = new AbortController()
  const cancel = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const timeout = setTimeout(
    () => controller.abort(new Error('The public context request timed out.')),
    SCENARIO_CONTEXT_TIMEOUT_MS,
  )
  let results: PromiseSettledResult<ContextFeature[]>[]
  try {
    results = await Promise.allSettled([
      loadBcExistingRoads(bounds, controller.signal),
      fetchHarvestedAreas(bounds, { signal: controller.signal, simplifyDegrees: 0, maxRecords: 200 }).then(
        harvestedContext,
      ),
    ])
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
  if (signal?.aborted) throw new DOMException('Scenario loading cancelled', 'AbortError')
  const context: ContextFeature[] = []
  const warnings: string[] = []
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') context.push(...result.value)
    else
      warnings.push(
        `${index ? 'Harvest openings' : 'BC road tenures'} unavailable: ${result.reason instanceof Error ? result.reason.message : 'request failed'}`,
      )
  }
  const vertices = context.reduce(
    (total, feature) =>
      total +
      (feature.geometry.type === 'LineString'
        ? feature.geometry.coordinates.length
        : feature.geometry.coordinates.flat().length),
    0,
  )
  if (context.length > 500 || vertices > 50_000) {
    warnings.push('Public context exceeded the project budget; use a smaller area to load all roads and blocks.')
    return { context: [], warnings }
  }
  return { context, warnings }
}

/** Terrain loads and passes its corridor check before the caller replaces the open project. */
export async function loadRoadScenario(
  id: RoadScenarioId,
  {
    signal,
    onProgress,
    decodeRegionalTiles,
  }: { signal?: AbortSignal; onProgress?: (message: string) => void; decodeRegionalTiles?: TileDecoder } = {},
): Promise<{ project: RoadProject; source: TerrainSource; notice: string }> {
  const scenario = roadScenario(id)
  if (scenario.kind === 'training') {
    const project = createTrainingScenario(id)
    requireScenarioTerrain(project.alignments, demoTerrain, project.settings.crossSectionHalfWidth)
    return {
      project,
      source: demoTerrain,
      notice: `Opened ${scenario.name}. Terrain, roads, blocks, condition and material assumptions are synthetic teaching inputs.${id === 'training-local-gravel' ? ' Compare the identical roads in Review or disable the local supply in Engineering. Acquisition is zero; processing, loading, haul and placement remain costed.' : id === 'training-road-reuse' ? ' Existing-road reuse is enabled for the individually reviewed synthetic road sections; turn it off in Find a route to compare.' : ''}`,
    }
  }
  onProgress?.(`Loading ${scenario.name} terrain…`)
  const loaded: { metadata: TerrainMetadata; source: TerrainSource; alignments?: Alignment[] } =
    scenario.kind === 'lidar'
      ? await loadLidarTerrain(signal, onProgress)
      : await loadRegionalTerrain(
          [
            scenario.centre[0] - 0.018,
            scenario.centre[1] - 0.012,
            scenario.centre[0] + 0.018,
            scenario.centre[1] + 0.012,
          ],
          signal,
          decodeRegionalTiles,
        )
  const alignments = loaded.alignments
    ? loaded.alignments
    : regionalScenarioAlignments(id, scenario.kind === 'regional' ? scenario.centre : [0, 0], loaded.source)
  const coverage = requireScenarioTerrain(alignments, loaded.source, DEFAULT_ROAD_SETTINGS.crossSectionHalfWidth)
  const bounds = terrainBounds(loaded.metadata)
  if (!bounds) throw Error('The scenario terrain has no geographic footprint.')
  onProgress?.('Loading nearby BC road tenures and harvest openings…')
  const evidence = await scenarioContext(bounds, signal)
  const project = parseProject({
    schema: 'pgmaps-road-project-v1',
    name: scenario.name,
    scenario: { id, contextWarnings: evidence.warnings, terrainCoveragePercent: coverage.coveragePercent },
    activeAlignmentId: alignments[0].id,
    alignments,
    terrain: loaded.metadata,
    settings: { ...DEFAULT_ROAD_SETTINGS },
    context: evidence.context,
    cables: [],
    profiles: [],
  })
  const roads = project.context.filter((feature) => feature.kind === 'existing-road').length
  const blocks = project.context.filter((feature) => feature.kind === 'harvest').length
  const gradeChallenge = project.alignments.some(
    (alignment) =>
      analyzeRoad(alignment, loaded.source, project.settings).maxGradePercent > project.settings.maxGradePercent,
  )
  return {
    project,
    source: loaded.source,
    notice: `${scenario.name}: terrain checked across the road section corridors. Loaded ${roads} mapped road sections and ${blocks} harvest polygons. Draft alignments are unverified; mapped tenure dates do not establish road age or condition.${scenario.kind === 'regional' ? ' Regional terrain is for corridor screening only.' : ''}${gradeChallenge ? ' This starting corridor exceeds the grade limit: use route constraints to review alternatives.' : ''}${evidence.warnings.length ? ` ${evidence.warnings.join(' ')}` : ''}`,
  }
}
