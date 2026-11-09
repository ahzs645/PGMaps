import { loadBcHarvestHistory } from './harvestHistory'
import type { TileDecoder } from '../dev-forestry/demLoader'
import type { Bounds } from '../dev-forestry/terrain'
import { loadBcExistingRoads } from './existingRoads'
import { alignmentLength, analyzeRoad, distance, positionAt } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { parseProject } from './project'
import { blockLandings, nearestBlockEdge, suggestBlockAccess } from './blockAccess'
import { nearestExistingRoadPoint } from './fsrNetwork'
import { fitHorizontalRadii } from './horizontalTools'
import { DEFAULT_ROUTE_OPTIONS, suggestRoutes } from './routing'
import { requireScenarioTerrain } from './scenarioCoverage'
import { createFullCostTrainingProject } from './trainingFullCostScenario'
import { createAccessHistoryTrainingProject } from './trainingAccessHistoryScenario'
import { loadBcAccessPilotScenario } from './bcAccessPilotScenario'
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

/**
 * What a scenario brings besides its terrain and draft roads. Mapped context is fetched live from BC
 * services when the scenario loads, so it records what that area held when checked (November 2026);
 * the load notice states what actually arrived, and a failed source is reported, never invented.
 */
export type ScenarioContent = 'mapped' | 'synthetic' | 'none'
export interface ScenarioContents {
  roads: ScenarioContent
  cutblocks: ScenarioContent
}

export const ROAD_SCENARIOS = [
  {
    id: 'bc-opening-60677',
    name: 'BC records · opening 60677',
    terrain: 'Regional DEM · live source investigation',
    detail:
      'A real FTEN block and nearby road segments, cross-checked with RESULTS. Missing road dates and crossing evidence stay visible.',
    focus: 'Inspect source identity, nearby-road candidates and the evidence still needed for historical access',
    kind: 'history-pilot',
    contents: { roads: 'mapped', cutblocks: 'mapped' },
  },
  {
    id: 'bc-lidar',
    name: 'Prince George · native LiDAR',
    terrain: 'Verified 1 m ground DTM',
    detail: 'A draft road on the published 1 km BC LiDAR tile. No mapped roads or cutblocks fall inside the tile.',
    focus: 'Sections, terrain coverage and preliminary earthworks',
    kind: 'lidar',
    contents: { roads: 'none', cutblocks: 'none' },
  },
  {
    id: 'tabor-access',
    name: 'Tabor Mountain · access alternatives',
    terrain: 'Regional DEM · screening only',
    detail:
      'Opens on two routes to a mapped cutblock, from either end of a hillside corridor. The area has no mapped roads.',
    focus: 'Compare two ways into the same block',
    kind: 'regional',
    contents: { roads: 'none', cutblocks: 'mapped' },
    centre: [-122.5537, 53.796] as Coordinate,
  },
  {
    id: 'kamloops-dry-interior',
    name: 'Kamloops · dry Interior',
    terrain: 'Regional DEM · screening only',
    detail: 'Opens on an access road from a mapped FSR to a cutblock on steep dry-Interior ground.',
    focus: 'Review grades, curves and earthworks on a steep access road',
    kind: 'regional',
    contents: { roads: 'mapped', cutblocks: 'mapped' },
    centre: [-120.47, 50.84] as Coordinate,
  },
  {
    id: 'vernon-upland',
    name: 'Vernon · upland access',
    terrain: 'Regional DEM · screening only',
    detail: 'Opens on a spur from a mapped road up an upland hillside. The area has no cutblocks.',
    focus: 'Extend existing access onto rough ground',
    kind: 'regional',
    contents: { roads: 'mapped', cutblocks: 'none' },
    centre: [-119.12, 50.35] as Coordinate,
  },
  {
    id: 'smithers-northwest',
    name: 'Smithers · Northwest hillside',
    terrain: 'Regional DEM · screening only',
    detail: 'Opens on two spurs from different mapped roads into the same cutblock.',
    focus: 'Compare short access options from existing roads',
    kind: 'regional',
    contents: { roads: 'mapped', cutblocks: 'mapped' },
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
    contents: { roads: 'synthetic', cutblocks: 'synthetic' },
  },
  {
    id: 'training-hillside',
    name: 'Training · hillside and drainage',
    terrain: 'Synthetic ground · offline',
    detail:
      'Two roads, a drainage line, a review area, a harvest block, a turnout and landing. All context is synthetic.',
    focus: 'Learn the connected plan, profile and section views',
    kind: 'training',
    contents: { roads: 'synthetic', cutblocks: 'synthetic' },
  },
  {
    id: 'training-road-reuse',
    name: 'Training · reuse an old road',
    terrain: 'Synthetic ground · offline',
    detail: 'An assumed serviceable access road and a rehabilitation section, with a synthetic harvest block.',
    focus: 'Toggle road reuse and review condition assumptions',
    kind: 'training',
    contents: { roads: 'synthetic', cutblocks: 'synthetic' },
  },
  {
    id: 'training-harvest-history',
    name: 'Training · cutblocks and old access roads',
    terrain: 'Synthetic ground · offline',
    detail:
      'Recent, older, estimated and undated cutblocks beside road sections with known and unknown deactivation dates.',
    focus: 'Compare harvest ages in 2026 and inspect nearby road candidates',
    kind: 'training',
    contents: { roads: 'synthetic', cutblocks: 'synthetic' },
  },
  {
    id: 'training-local-gravel',
    name: 'Training · nearby free gravel',
    terrain: 'Synthetic ground · offline',
    detail:
      'The same road with and without a zero-acquisition local stockpile. Processing, loading and haul still cost.',
    focus: 'Compare enabled supply, finite capacity and purchased surfacing',
    kind: 'training',
    contents: { roads: 'synthetic', cutblocks: 'synthetic' },
  },
  {
    id: 'training-access-history',
    name: 'Training · reconstruct block access and bridges',
    terrain: 'Synthetic ground · offline',
    detail:
      'Two blocks share a bridge in 2010. A later bypass, bridge closure and conflicting ratings change the evidence.',
    focus: 'Trace dated access, inspect shared structures and save reviewed assertions',
    kind: 'training',
    contents: { roads: 'synthetic', cutblocks: 'synthetic' },
  },
] as const satisfies readonly ({ contents: ScenarioContents } & Record<string, unknown>)[]

export type RoadScenarioId = (typeof ROAD_SCENARIOS)[number]['id']
export const REGIONAL_SCENARIO_ORIENTATIONS = 24
export const SCENARIO_PROFILE_STEP_M = 60
export const REGIONAL_SCENARIO_SCALES = [1, 0.55] as const
export const SCENARIO_CONTEXT_TIMEOUT_MS = 12_000
/** Each public source is tried this many more times after a failure or timeout. */
export const SCENARIO_CONTEXT_RETRIES = 1
/** Outweighs a grade failure, so drafts that cross mapped roads are chosen only when nothing else fits. */
const SCENARIO_ROAD_CROSSING_PENALTY = 50_000
/** Draft centres tried, in metres east and north of the scenario centre, when mapped roads are present. */
const SCENARIO_DRAFT_OFFSETS_M = [
  [0, 0],
  [400, 0],
  [-400, 0],
  [0, 400],
  [0, -400],
  [400, 400],
  [-400, -400],
  [400, -400],
  [-400, 400],
] as const
/** Road options a real-data scenario opens with. */
export const MAX_SCENARIO_ROADS = 2
/** A block this close to a mapped road already has access; it gets no proposed road. */
export const SCENARIO_ACCESSIBLE_BLOCK_M = 30
/** Denser than this, a routed option is a grid staircase up ground too steep for the grade limit. */
const SCENARIO_MAX_POINTS_PER_100M = 4
/** This many consecutive legs shorter than the minimum radius make a routed option a staircase. */
const SCENARIO_MAX_SHORT_LEGS = 4

const isActiveMappedRoad = (feature: ContextFeature) =>
  feature.kind === 'existing-road' &&
  feature.geometry.type === 'LineString' &&
  feature.roadEvidence?.condition !== 'closed' &&
  (!feature.roadEvidence?.lifecycleStatus || feature.roadEvidence.lifecycleStatus === 'ACTIVE')

/**
 * The roads a real-data scenario opens with. Each one connects something: it starts on the nearest
 * active mapped road (FSR, permit or tenure road), or at a draft's start where the area has none,
 * and ends on the edge of the block nearest the drafts, or at the draft's far end where there is no
 * block. Up to MAX_SCENARIO_ROADS options, searched on the scenario terrain at the default limits and
 * given the minimum radius at each corner. Empty when the area has neither roads nor blocks, or no
 * option passes; the caller then keeps the drafts.
 */
export function scenarioRoads(
  id: string,
  context: ContextFeature[],
  source: TerrainSource,
  drafts: Alignment[],
): Alignment[] {
  if (!drafts.length) return []
  const blocks = context.filter((feature) => feature.kind === 'harvest' && feature.geometry.type === 'Polygon')
  const mapped = context.filter(isActiveMappedRoad)
  const options = { ...DEFAULT_ROUTE_OPTIONS, groundWindowM: 0 }
  const middle = positionAt(drafts[0], alignmentLength(drafts[0]) / 2).coordinate
  const found: { coordinates: Coordinate[]; name: string }[] = []
  // Ground steeper than the grade limit makes the grid climb cell by cell; that staircase is not a road option.
  // A road that crosses another mapped road on its way should start from that nearer road instead.
  const side = (p: Coordinate, q: Coordinate, r: Coordinate) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const crossesMapped = (coordinates: Coordinate[]) =>
    mapped.some((road) => {
      const line = (road.geometry as GeoJSON.LineString).coordinates as Coordinate[]
      return coordinates.slice(1).some((b, i) => {
        const a = coordinates[i]
        return line
          .slice(1)
          .some((d, j) => side(a, b, line[j]) * side(a, b, d) < 0 && side(line[j], d, a) * side(line[j], d, b) < 0)
      })
    })
  // A run of legs too short to hold the minimum radius is a local staircase, even on an otherwise clean road.
  const staircase = (coordinates: Coordinate[]) => {
    let run = 0
    for (let i = 1; i < coordinates.length; i++) {
      run = distance(coordinates[i - 1], coordinates[i]) < DEFAULT_ROAD_SETTINGS.minRadius ? run + 1 : 0
      if (run >= SCENARIO_MAX_SHORT_LEGS) return true
    }
    return false
  }
  const plausible = (coordinates: Coordinate[], lengthM: number) =>
    coordinates.length <= 2 + (lengthM / 100) * SCENARIO_MAX_POINTS_PER_100M &&
    !staircase(coordinates) &&
    !crossesMapped(coordinates)
  const route = (from: Coordinate, to: Coordinate) => {
    const found = suggestRoutes(from, to, source, DEFAULT_ROAD_SETTINGS, context, options).routes[0]
    if (!plausible(found.coordinates, found.lengthM)) throw Error('The route climbs in a grid staircase.')
    return found.coordinates
  }
  const shortName = (feature: ContextFeature) => feature.name.split(' · ')[0]
  if (blocks.length && mapped.length) {
    const ranked = blocks
      .map((block) => ({ block, distanceM: nearestBlockEdge(block, middle).distanceM }))
      .sort((a, b) => a.distanceM - b.distanceM)
    for (const { block } of ranked) {
      if (found.length >= MAX_SCENARIO_ROADS) break
      const nearest = blockLandings(block, context, 1, 'mapped-roads')[0]
      if (!nearest || nearest.target.distanceM < SCENARIO_ACCESSIBLE_BLOCK_M) continue
      try {
        for (const option of suggestBlockAccess(
          block,
          source,
          DEFAULT_ROAD_SETTINGS,
          context,
          options,
          3,
          'mapped-roads',
        ).options) {
          if (found.length >= MAX_SCENARIO_ROADS) break
          if (!plausible(option.coordinates, option.lengthM)) continue
          // Chainage runs from the junction on the mapped road to the landing on the block edge.
          found.push({
            coordinates: [...option.coordinates].reverse(),
            name: `Access to ${shortName(block)} · from ${option.target.name}`,
          })
        }
      } catch {
        // No route from any nearby road at the default limits: try the next block.
      }
    }
  } else if (blocks.length) {
    const block = blocks
      .map((candidate) => ({ candidate, distanceM: nearestBlockEdge(candidate, middle).distanceM }))
      .sort((a, b) => a.distanceM - b.distanceM)[0].candidate
    // The drafts share their ends, so the two options start from the corridor's two ends.
    const ends = [drafts[0].points[0].coordinate, drafts[0].points[drafts[0].points.length - 1].coordinate]
    for (const start of ends) {
      try {
        found.push({
          coordinates: route(start, nearestBlockEdge(block, start).coordinate),
          name: `Access to ${shortName(block)} · option ${found.length + 1}`,
        })
      } catch {
        // This start has no route at the default limits.
      }
    }
  } else if (mapped.length) {
    // Spurs from the two nearest mapped roads to the drafts' far end, so the options differ.
    const end = drafts[0].points[drafts[0].points.length - 1].coordinate
    const junctions = mapped
      .map((road) => ({ road, point: nearestExistingRoadPoint(drafts[0].points[0].coordinate, road) }))
      .filter((candidate): candidate is { road: ContextFeature; point: NonNullable<typeof candidate.point> } =>
        Boolean(candidate.point),
      )
      .sort((a, b) => a.point.distanceM - b.point.distanceM)
      .slice(0, MAX_SCENARIO_ROADS)
    for (const junction of junctions) {
      try {
        found.push({
          coordinates: route(junction.point.coordinate, end),
          name: `Spur from ${junction.road.name} · option ${found.length + 1}`,
        })
      } catch {
        // No route from the road at the default limits.
      }
    }
  }
  return found.flatMap(({ coordinates, name }, index) => {
    const n = index + 1
    const alignment: Alignment = {
      id: `${id}-road-${n}`,
      name: name.slice(0, 200),
      color: n === 1 ? '#16a34a' : '#2563eb',
      points: fitHorizontalRadii(
        coordinates.map((coordinate, point) => ({ id: `${id}-road-${n}-${point}`, coordinate, radiusM: 0 })),
        { kind: 'radius', radiusM: DEFAULT_ROAD_SETTINGS.minRadius },
      ).points,
      template: { ...DEFAULT_TEMPLATE },
      vertical: [],
      overrides: [],
    }
    return analyzeRoad(alignment, source, DEFAULT_ROAD_SETTINGS).coveragePercent > 99.999 ? [alignment] : []
  })
}

export function roadScenario(id: string) {
  const scenario = ROAD_SCENARIOS.find((item) => item.id === id)
  if (!scenario) throw Error('That road scenario is not in the library.')
  return scenario
}

export function createTrainingScenario(id: RoadScenarioId): RoadProject {
  const scenario = roadScenario(id)
  if (scenario.kind !== 'training') throw Error('This scenario requires its real terrain to be loaded first.')
  const project =
    id === 'training-full-cost-access'
      ? createFullCostTrainingProject()
      : id === 'training-access-history'
        ? createAccessHistoryTrainingProject()
        : createDemoProject()
  project.name = scenario.name
  project.scenario = { id, contextWarnings: [], terrainCoveragePercent: 100 }
  if (id === 'training-harvest-history') {
    project.harvestHistoryYear = 2026
    const origin = project.alignments[0].points[0].coordinate
    const grid = localMetricGrid(origin),
      centre = grid.toGrid(origin)
    const xy = (x: number, y: number) => grid.toLonLat([centre[0] + x, centre[1] + y])
    const block = (
      id: string,
      name: string,
      x: number,
      y: number,
      evidence: NonNullable<ContextFeature['harvestEvidence']>,
    ): ContextFeature => ({
      id,
      name,
      kind: 'harvest',
      geometry: {
        type: 'Polygon',
        coordinates: [[xy(x, y), xy(x + 200, y), xy(x + 200, y + 150), xy(x, y + 150), xy(x, y)]],
      },
      harvestEvidence: evidence,
    })
    project.context = [
      ...project.context.filter((feature) => feature.kind !== 'harvest' && feature.kind !== 'existing-road'),
      block('history-recent', 'Synthetic block · harvested 2021–2022', 200, 150, {
        source: 'scenario',
        status: 'harvested',
        sourceId: 'teaching-recent',
        startDate: '2021-09-01',
        endDate: '2022-02-15',
        startYear: 2021,
        endYear: 2022,
        yearMethod: 'reported-dates',
      }),
      block('history-older', 'Synthetic block · harvested 1989–1990', 520, 420, {
        source: 'scenario',
        status: 'harvested',
        sourceId: 'teaching-older',
        startYear: 1989,
        endYear: 1990,
        yearMethod: 'reported-year',
      }),
      block('history-estimated', 'Synthetic block · estimated harvest 2008', 850, 300, {
        source: 'scenario',
        status: 'harvested',
        sourceId: 'teaching-estimated',
        midYear: 2008,
        yearMethod: 'estimated-midpoint',
      }),
      block('history-unknown', 'Synthetic block · harvest date unknown', 1100, 620, {
        source: 'scenario',
        status: 'harvested',
        sourceId: 'teaching-unknown',
        yearMethod: 'unknown',
      }),
      block('history-proposed', 'Synthetic proposed cutblock', 1000, 900, {
        source: 'scenario',
        status: 'proposed',
        yearMethod: 'unknown',
      }),
      {
        id: 'history-road-deactivated',
        name: 'Synthetic spur · deactivated 2016',
        kind: 'existing-road',
        geometry: { type: 'LineString', coordinates: [xy(50, 100), xy(350, 130), xy(620, 450)] },
        roadEvidence: {
          source: 'scenario',
          condition: 'rehabilitation',
          conditionBasis: 'assumed',
          reuseAllowed: false,
          deactivation: {
            status: 'deactivated',
            basis: 'scenario',
            reference: 'Synthetic training assumption',
            deactivatedOn: '2016-09-15',
          },
        },
      },
      {
        id: 'history-road-undated',
        name: 'Synthetic old access · deactivation date unknown',
        kind: 'existing-road',
        geometry: { type: 'LineString', coordinates: [xy(620, 450), xy(900, 280), xy(1150, 600)] },
        roadEvidence: {
          source: 'scenario',
          condition: 'closed',
          conditionBasis: 'assumed',
          reuseAllowed: false,
          deactivation: {
            status: 'deactivated',
            basis: 'scenario',
            reference: 'Synthetic training assumption; event date not supplied',
          },
        },
      },
      {
        id: 'history-road-unreviewed',
        name: 'Synthetic mapped access · status unknown',
        kind: 'existing-road',
        geometry: { type: 'LineString', coordinates: [xy(50, 100), xy(200, -50), xy(1000, 0)] },
        roadEvidence: { source: 'scenario', condition: 'unknown', conditionBasis: 'unreviewed', reuseAllowed: false },
      },
    ]
  }
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
export function regionalScenarioAlignments(
  id: string,
  centre: Coordinate,
  source: TerrainSource,
  mappedRoads: ContextFeature[] = [],
): Alignment[] {
  const grid = localMetricGrid(centre)
  const origin = grid.toGrid(centre)
  // A draft that cuts across mapped roads reads as nonsense, so the orientation screen avoids it.
  const roadSegments = mappedRoads.flatMap((road) =>
    road.geometry.type === 'LineString'
      ? road.geometry.coordinates
          .slice(1)
          .map((end, i) => [grid.toGrid(road.geometry.coordinates[i] as Coordinate), grid.toGrid(end as Coordinate)])
      : [],
  )
  const side = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const roadCrossings = (alignment: Alignment) => {
    const points = alignment.points.map((point) => grid.toGrid(point.coordinate))
    let count = 0
    for (let i = 1; i < points.length; i++)
      for (const [a, b] of roadSegments)
        if (
          side(points[i - 1], points[i], a) * side(points[i - 1], points[i], b) < 0 &&
          side(a, b, points[i - 1]) * side(a, b, points[i]) < 0
        )
          count++
    return count
  }
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
  const candidate = (angle: number, scale: number, [dx, dy]: readonly number[]) =>
    paths.map((path, index) => {
      const alignment: Alignment = {
        id: `${id}-draft-${index + 1}`,
        name: `Draft approach ${index + 1} · review required`,
        color: index ? '#2563eb' : '#d97706',
        points: path.map(([x, y], point) => ({
          id: `${id}-${index}-${point}`,
          coordinate: grid.toLonLat([
            origin[0] + dx + scale * (x * Math.cos(angle) - y * Math.sin(angle)),
            origin[1] + dy + scale * (x * Math.sin(angle) + y * Math.cos(angle)),
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
  // Where mapped roads are dense, the drafts may also shift off the centre to find clear ground.
  const offsets = roadSegments.length ? SCENARIO_DRAFT_OFFSETS_M : [[0, 0]]
  search: for (const scale of REGIONAL_SCENARIO_SCALES) {
    let feasible = false
    for (const offset of offsets) {
      for (let direction = 0; direction < REGIONAL_SCENARIO_ORIENTATIONS; direction++) {
        const alignments = candidate((direction * Math.PI) / REGIONAL_SCENARIO_ORIENTATIONS, scale, offset)
        const crossingPenalty = alignments.reduce(
          (total, alignment) => total + roadCrossings(alignment) * SCENARIO_ROAD_CROSSING_PENALTY,
          0,
        )
        // A candidate whose crossings alone outscore the best so far cannot win; skip its analysis.
        if (crossingPenalty >= bestScore) continue
        if (alignments.some((alignment) => alignment.vertical.some((point) => !Number.isFinite(point.elevation))))
          continue
        const results = alignments.map((alignment) => analyzeRoad(alignment, source, DEFAULT_ROAD_SETTINGS))
        if (
          results.every(
            (result) =>
              result.coveragePercent > 99.999 && result.maxGradePercent <= DEFAULT_ROAD_SETTINGS.maxGradePercent,
          ) &&
          alignments.every((alignment) => !roadCrossings(alignment))
        )
          feasible = true
        const score =
          crossingPenalty +
          results.reduce(
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
      // Keep the best of the first scale and offset that has a feasible pair, as before offsets existed.
      if (feasible) break search
    }
  }
  if (!best) throw Error('No complete draft profile could be initialized on this scenario terrain.')
  return best
}

/** Public layers are optional evidence. Report failures explicitly and keep no invented replacements. */
/**
 * One public source with its own timeout and one retry, so a single slow reply neither costs the
 * scenario that source nor takes the other source down with it.
 */
async function loadContextSource(
  load: (signal: AbortSignal) => Promise<ContextFeature[]>,
  signal?: AbortSignal,
): Promise<ContextFeature[]> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    const cancel = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    const timeout = setTimeout(
      () => controller.abort(new Error('The public context request timed out.')),
      SCENARIO_CONTEXT_TIMEOUT_MS,
    )
    try {
      return await load(controller.signal)
    } catch (error) {
      if (signal?.aborted || attempt >= SCENARIO_CONTEXT_RETRIES) throw error
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
    }
  }
}

async function scenarioContext(bounds: Bounds, signal?: AbortSignal) {
  const results = await Promise.allSettled([
    loadContextSource((attempt) => loadBcExistingRoads(bounds, attempt), signal),
    loadContextSource((attempt) => loadBcHarvestHistory(bounds, attempt), signal),
  ])
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
  if (scenario.kind === 'history-pilot') return loadBcAccessPilotScenario({ signal, onProgress, decodeRegionalTiles })
  if (scenario.kind === 'training') {
    const project = createTrainingScenario(id)
    requireScenarioTerrain(project.alignments, demoTerrain, project.settings.crossSectionHalfWidth)
    return {
      project,
      source: demoTerrain,
      notice: `Opened ${scenario.name}. Terrain, roads, blocks, condition and material assumptions are synthetic teaching inputs.${id === 'training-local-gravel' ? ' Compare the identical roads in Review or disable the local supply in Engineering. Acquisition is zero; processing, loading, haul and placement remain costed.' : id === 'training-road-reuse' ? ' Existing-road reuse is enabled for the individually reviewed synthetic road sections; turn it off in Search tools to compare.' : ''}`,
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
  // Roads and blocks load first, so the drafts can keep off mapped roads and an access road can reach a block.
  const bounds = terrainBounds(loaded.metadata)
  if (!bounds) throw Error('The scenario terrain has no geographic footprint.')
  onProgress?.('Loading nearby BC road tenures and harvest openings…')
  const evidence = await scenarioContext(bounds, signal)
  const mappedRoads = evidence.context.filter((feature) => feature.kind === 'existing-road')
  const drafts = loaded.alignments
    ? loaded.alignments
    : regionalScenarioAlignments(
        id,
        scenario.kind === 'regional' ? scenario.centre : [0, 0],
        loaded.source,
        mappedRoads,
      )
  const coverage = requireScenarioTerrain(drafts, loaded.source, DEFAULT_ROAD_SETTINGS.crossSectionHalfWidth)
  onProgress?.('Routing the scenario roads from mapped roads to the blocks…')
  const routed = scenarioRoads(id, evidence.context, loaded.source, drafts)
  // Routed roads replace the drafts: a draft that joins nothing to nothing is not a road option.
  const alignments = routed.length ? routed : drafts
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
  const gradeChallenge = alignments.some(
    (alignment) =>
      analyzeRoad(alignment, loaded.source, project.settings).maxGradePercent > project.settings.maxGradePercent,
  )
  return {
    project,
    source: loaded.source,
    notice: `${scenario.name}: terrain checked across the road section corridors. Loaded ${roads} mapped road sections and ${blocks} harvest polygons. Draft alignments are unverified; mapped tenure dates do not establish road age or condition.${routed.length ? ` Opened with ${routed.length} routed road option${routed.length > 1 ? 's' : ''}: ${routed.map((road) => road.name).join('; ')}.` : roads || blocks ? ' No road from the mapped roads to the blocks passed the grade and terrain checks; the unconnected draft corridors are shown instead.' : ''}${scenario.kind === 'regional' ? ' Regional terrain is for corridor screening only.' : ''}${gradeChallenge ? ' This starting corridor exceeds the grade limit: use route constraints to review alternatives.' : ''}${evidence.warnings.length ? ` ${evidence.warnings.join(' ')}` : ''}`,
  }
}
