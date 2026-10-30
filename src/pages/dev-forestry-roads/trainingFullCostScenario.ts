/** Offline teaching inputs on the existing synthetic hillside, with explicitly invented evidence and prices. */
import { alignmentLength, distance, positionAt } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { createRoadPlanSource, createTotalCostPlanningDefaults } from './fullCostPlanning'
import { createRoadNetworkEvidence } from './roadNetwork'
import { createDemoProject, DEFAULT_TEMPLATE, DEMO_ORIGIN, demoTerrain } from './terrain'
import type { Alignment, ContextFeature, Coordinate, RoadProject } from './types'

export const FULL_COST_TRAINING_DATE = '2026-10-28'
export const FULL_COST_TRAINING_IDS = {
  shortConnector: 'training-full-cost-short-a',
  longConnector: 'training-full-cost-long-b',
  armA: 'training-full-cost-arm-a',
  upperConnection: 'training-full-cost-upper',
  armB: 'training-full-cost-arm-b',
  aggregate: 'training-full-cost-aggregate',
  waste: 'training-full-cost-waste',
} as const

/** Same local geographic frame as demoTerrain; no replacement sampler or misleading raster identity. */
export function fullCostTrainingCoordinate(x: number, y: number): Coordinate {
  return [DEMO_ORIGIN[0] + x / (111195 * Math.cos((DEMO_ORIGIN[1] * Math.PI) / 180)), DEMO_ORIGIN[1] + y / 111195]
}

function connector(id: string, name: string, end: Coordinate, color: string): Alignment {
  const alignment: Alignment = {
    id,
    name,
    color,
    points: [fullCostTrainingCoordinate(0, 0), end].map((coordinate, index) => ({
      id: `${id}-p${index}`,
      coordinate,
      radiusM: 0,
    })),
    vertical: [],
    template: { ...DEFAULT_TEMPLATE, crossfallPercent: 0, ditchWidth: 0, ditchDepth: 0, surfaceDepth: 0.2 },
    overrides: [],
    engineering: createEngineeringDesign(),
  }
  alignment.engineering!.haul.enabled = true
  const length = alignmentLength(alignment)
  const intervals = Math.max(1, Math.ceil(length / 20))
  alignment.vertical = Array.from({ length: intervals + 1 }, (_, index) => {
    const chainage = (length * index) / intervals
    return {
      id: `${id}-v${index}`,
      chainage,
      elevation: demoTerrain.elevationAt(...positionAt(alignment, chainage).coordinate),
      curveLength: 0,
    }
  })
  return alignment
}

/** Known synthetic grades come from this demo terrain rather than a false zero-grade road attribute. */
function roadGrades(coordinates: Coordinate[]) {
  let uphill = 0,
    downhill = 0
  for (let segment = 1; segment < coordinates.length; segment++) {
    const a = coordinates[segment - 1],
      b = coordinates[segment]
    const count = Math.max(1, Math.ceil(distance(a, b) / 20))
    let previous = a
    for (let index = 1; index <= count; index++) {
      const t = index / count
      const current: Coordinate = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      const grade =
        ((demoTerrain.elevationAt(...current) - demoTerrain.elevationAt(...previous)) / distance(previous, current)) *
        100
      uphill = Math.max(uphill, grade)
      downhill = Math.max(downhill, -grade)
      previous = current
    }
  }
  return { forwardUphillGradePercent: uphill, forwardDownhillGradePercent: downhill }
}

function networkRoad(
  id: string,
  name: string,
  coordinates: Coordinate[],
  junctions: { id: string; coordinate: Coordinate }[],
): ContextFeature {
  return {
    id,
    name,
    kind: 'existing-road',
    geometry: { type: 'LineString', coordinates },
    roadEvidence: {
      source: 'scenario',
      roadClass: 'fsr',
      condition: 'serviceable',
      conditionBasis: 'assumed',
      reuseAllowed: true,
      observations: [
        {
          id: `${id}-synthetic-observation`,
          source: 'inspection',
          component: 'overall',
          observedAt: '2026-10-27',
          sourceUrl: `https://example.invalid/pgmaps-synthetic-training/${id}`,
          notes:
            'Invented teaching record, not an actual inspection. Synthetic road, access, vehicle permissions and no-bridge assumption require replacement for a real project.',
          finding: 'serviceable',
          review: { reviewer: 'Synthetic scenario reviewer · teaching record', reviewedAt: FULL_COST_TRAINING_DATE },
        },
      ],
      conditionPolicy: { maxInspectionAgeDays: 365, maxImageryAgeDays: 30 },
      network: {
        ...createRoadNetworkEvidence(),
        access: 'allowed',
        seasons: ['summer'],
        vehicleClasses: ['logging-truck'],
        maxVehicleWeightTonnes: 100,
        bridgeStatus: 'none',
        level: 0,
        ...roadGrades(coordinates),
        rehabilitationCostPerM: 0,
        accessCost: 0,
        structureCost: 0,
        fixedCost: 0,
        haulCostFactor: 1,
        junctions,
      },
    },
  }
}

export function createFullCostTrainingProject(): RoadProject {
  const project = createDemoProject()
  const a = fullCostTrainingCoordinate(100, 0)
  const b = fullCostTrainingCoordinate(-400, 0)
  const upperA = fullCostTrainingCoordinate(100, 1000)
  const upperB = fullCostTrainingCoordinate(-400, 1000)
  const junctionA = { id: 'training-full-cost-junction-a', coordinate: upperA }
  const junctionB = { id: 'training-full-cost-junction-b', coordinate: upperB }
  const short = connector(
    FULL_COST_TRAINING_IDS.shortConnector,
    'Short connector A · 2.5 km aggregate haul',
    a,
    '#d97706',
  )
  const long = connector(
    FULL_COST_TRAINING_IDS.longConnector,
    'Long connector B · beside aggregate source',
    b,
    '#2563eb',
  )
  const planning = createTotalCostPlanningDefaults(FULL_COST_TRAINING_DATE)
  planning.networkPolicy = {
    ...planning.networkPolicy,
    requireCurrentConditionEvidence: true,
    season: 'summer',
    vehicleClass: 'logging-truck',
    vehicleWeightTonnes: 40,
    maxUphillGradePercent: 12,
    maxDownhillGradePercent: 15,
  }
  planning.connectorChecks = {
    ...planning.connectorChecks,
    loadedDirection: 'start-to-end',
    maxAdverseGradePercent: 12,
    maxFavourableGradePercent: 15,
    maxCutDepthM: 10,
    maxFillHeightM: 10,
  }
  planning.outlet = upperB
  planning.outletRoadId = FULL_COST_TRAINING_IDS.armB
  planning.newConstructionFixedCost = 0
  planning.haulRatePerM3Km = 0
  planning.returnHaulRatePerM3Km = 0
  planning.sources = [
    {
      ...createRoadPlanSource(FULL_COST_TRAINING_IDS.aggregate),
      name: 'Synthetic zero-acquisition aggregate at B',
      enabled: true,
      entrance: b,
      entranceRoadId: FULL_COST_TRAINING_IDS.armB,
      accessConfirmed: true,
      qualityConfirmed: true,
      uses: ['surfacing', 'fill'],
      capacityM3: 100_000,
      acquisitionRate: 0,
      processingRate: 0,
      loadingRate: 0,
      placementRate: 0,
      fixedCost: 0,
      notes:
        'Invented, fully specified teaching inputs. Shared compacted capacity for fill and surfacing. All zero handling prices are explicit scenario assumptions, not supplier quotes or permission to take gravel.',
    },
    {
      ...createRoadPlanSource(FULL_COST_TRAINING_IDS.waste),
      name: 'Synthetic accepted waste disposal at B',
      enabled: true,
      entrance: b,
      entranceRoadId: FULL_COST_TRAINING_IDS.armB,
      accessConfirmed: true,
      qualityConfirmed: true,
      uses: ['waste'],
      capacityM3: 100_000,
      acquisitionRate: 0,
      processingRate: 0,
      loadingRate: 0,
      placementRate: 0,
      fixedCost: 0,
      notes:
        'Invented teaching disposal allowance and independent bank-volume capacity. No real site acceptance or disposal authorization is established.',
    },
  ]
  return {
    ...project,
    name: 'Training · connected access, gravel and condition',
    activeAlignmentId: short.id,
    alignments: [short, long],
    settings: { ...project.settings, cutRate: 2, fillRate: 3, clearingRate: 1 },
    totalCostPlanning: planning,
    context: [
      networkRoad(FULL_COST_TRAINING_IDS.armA, 'Synthetic A arm · short connector access', [a, upperA], [junctionA]),
      networkRoad(
        FULL_COST_TRAINING_IDS.upperConnection,
        'Synthetic upper connection',
        [upperA, upperB],
        [junctionA, junctionB],
      ),
      networkRoad(FULL_COST_TRAINING_IDS.armB, 'Synthetic B arm · source and outlet access', [upperB, b], [junctionB]),
      {
        id: 'training-full-cost-block',
        name: 'Synthetic block · planning demonstration',
        kind: 'harvest',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-70, -80],
              [70, -80],
              [70, 80],
              [-70, 80],
              [-70, -80],
            ].map(([x, y]) => fullCostTrainingCoordinate(x, y)),
          ],
        },
      },
    ],
    cables: [],
    profiles: [],
  }
}
