import { afterEach, describe, expect, it, vi } from 'vitest'
import { alignmentLength, distance, horizontalCurveSummary, positionAt } from './engine'
import { runFullCostComparison } from './fullCostRun'
import { demoTerrain } from './terrain'
import {
  createFullCostTrainingProject,
  FULL_COST_TRAINING_IDS,
  fullCostTrainingCoordinate,
} from './trainingFullCostScenario'
import * as routing from './routing'
import * as network from './roadNetwork'
import type { Alignment, Coordinate } from './types'
import { parseProject, serializeProject } from './project'

const budget = vi.hoisted(() => ({ paths: 10000 }))
vi.mock('./fullCostComparison', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fullCostComparison')>()
  return {
    ...actual,
    get MAX_FULL_COST_PATH_SEARCHES() {
      return budget.paths
    },
  }
})
afterEach(() => {
  vi.restoreAllMocks()
  budget.paths = 10000
})

function directSuggestions() {
  return vi.spyOn(routing, 'suggestRoutes').mockImplementation((start, end) => ({
    routes: [{ coordinates: [start, end], lengthM: distance(start, end), cost: 0, crossings: 0 }],
    visited: 2,
    message: 'Deterministic geometry fixture',
  }))
}
function cornerSuggestions() {
  return vi.spyOn(routing, 'suggestRoutes').mockImplementation((start, end) => {
    const cosine = Math.cos((start[1] * Math.PI) / 180),
      east = (end[0] - start[0]) * cosine,
      north = end[1] - start[1],
      length = Math.hypot(east, north)
    const middle: Coordinate = [
      (start[0] + end[0]) / 2 - ((north / length) * 20) / (111195 * cosine),
      (start[1] + end[1]) / 2 + ((east / length) * 20) / 111195,
    ]
    return {
      routes: [
        {
          coordinates: [start, middle, end],
          lengthM: distance(start, middle) + distance(middle, end),
          cost: 0,
          crossings: 0,
        },
      ],
      visited: 3,
      message: 'Fitted-corner fixture',
    }
  })
}
function recordedTarget(alignment: Alignment): NonNullable<Alignment['fsrConnection']> {
  return {
    targetFeatureId: FULL_COST_TRAINING_IDS.armA,
    targetName: 'Reviewed A target',
    targetCoordinate: [...alignment.points.at(-1)!.coordinate],
    originCoordinate: [...alignment.points[0].coordinate],
    originAlignmentId: alignment.id,
    endpoint: 'start',
    preference: 'chosen',
    networkScope: 'Synthetic fixture',
    straightLineDistanceM: distance(alignment.points[0].coordinate, alignment.points.at(-1)!.coordinate),
    routeLengthM: alignmentLength(alignment),
    searchCost: 0,
  }
}

describe('full-cost run with actual candidate generation, gates and network pricing', () => {
  it('changes the horizontal winner A→B when connected haul is priced, retaining the exact checked geometry', async () => {
    const project = createFullCostTrainingProject(),
      before = structuredClone(project)
    const progress: string[] = []
    const noHaul = await runFullCostComparison(project, demoTerrain, {
      onProgress: (message) => progress.push(message),
    })
    expect(noHaul.comparison.winnerId).toBe(FULL_COST_TRAINING_IDS.shortConnector)
    expect(project).toEqual(before)
    project.totalCostPlanning!.haulRatePerM3Km = 40
    const hauled = await runFullCostComparison(project, demoTerrain)
    expect(hauled.comparison.winnerId).toBe(FULL_COST_TRAINING_IDS.longConnector)
    expect(
      hauled.comparison.candidates.find((candidate) => candidate.id === FULL_COST_TRAINING_IDS.shortConnector)!.ledger!
        .supplyNetworkHaul,
    ).toBeGreaterThan(10000)
    for (const candidate of hauled.candidates) {
      expect(distance(candidate.expectedStart, candidate.alignment.points[0].coordinate)).toBeLessThan(0.001)
      expect(distance(candidate.expectedEnd, candidate.alignment.points.at(-1)!.coordinate)).toBeLessThan(0.001)
      if (!candidate.checks.adoptable) continue
      expect(candidate.checks.analysis?.length).toBeCloseTo(alignmentLength(candidate.alignment), 7)
      const samples = candidate.checks.analysis!.stations
      for (const station of [samples[0], samples[Math.floor(samples.length / 2)], samples.at(-1)!])
        expect(distance(station.coordinate, positionAt(candidate.alignment, station.chainage).coordinate)).toBeLessThan(
          0.001,
        )
    }
    expect(progress.filter((message) => message.startsWith('Pricing connector '))).toHaveLength(
      noHaul.candidates.length,
    )
    expect(noHaul.comparison.pathSearches).toBeGreaterThan(0)
  })

  it('deduplicates generated horizontal clones but preserves different entered profiles on that road', async () => {
    directSuggestions()
    const project = createFullCostTrainingProject(),
      original = project.alignments[0]
    const midpoint = positionAt(original, alignmentLength(original) / 2).coordinate
    original.points.splice(1, 0, { id: 'redundant-collinear-pi', coordinate: midpoint, radiusM: 0 })
    const changed = structuredClone(original)
    changed.id = 'explicit-profile-alternative'
    changed.name = 'Independent entered profile'
    changed.vertical = changed.vertical.map((control) => ({ ...control, elevation: control.elevation + 0.05 }))
    project.alignments.push(changed)
    const run = await runFullCostComparison(project, demoTerrain)
    expect(run.candidates.some((candidate) => candidate.alignment.id === changed.id)).toBe(true)
    const sameEnd = run.candidates.filter(
      (candidate) => distance(candidate.alignment.points.at(-1)!.coordinate, original.points.at(-1)!.coordinate) < 0.01,
    )
    expect(sameEnd.map((candidate) => candidate.alignment.id).sort()).toEqual([original.id, changed.id].sort())
  })

  it('profiles a legacy raw sketch and retains its exact mapped destination instead of erasing it as a duplicate', async () => {
    directSuggestions()
    const project = createFullCostTrainingProject(),
      sketch = project.alignments[0]
    sketch.vertical = []
    sketch.fsrConnection = recordedTarget(sketch)
    const run = await runFullCostComparison(project, demoTerrain)
    const generated = run.candidates.find(
      (candidate) =>
        candidate.alignment.id.startsWith('complete-route-') &&
        distance(candidate.expectedEnd, sketch.fsrConnection!.targetCoordinate) < 0.01,
    )!
    expect(generated).toBeDefined()
    expect(generated.alignment.vertical.length).toBeGreaterThanOrEqual(2)
    expect(generated.entryRoadId).toBe(FULL_COST_TRAINING_IDS.armA)
    expect(generated.alignment.fsrConnection?.targetCoordinate).toEqual(sketch.fsrConnection.targetCoordinate)
    expect(generated.alignment.fsrConnection?.originCoordinate).toEqual(sketch.points[0].coordinate)
    const reopened = parseProject(
      serializeProject({
        ...project,
        alignments: [...project.alignments, generated.alignment],
        activeAlignmentId: generated.alignment.id,
      }),
    )
    const saved = reopened.alignments.find((alignment) => alignment.id === generated.alignment.id)!
    expect(saved.networkEntryRoadId).toBe(generated.entryRoadId)
    expect(saved.fsrConnection?.targetCoordinate).toEqual(generated.expectedEnd)
  })

  it('retains identical entered geometry and profiles when their explicit overlapping road attachments differ', async () => {
    directSuggestions()
    const project = createFullCostTrainingProject(),
      first = project.alignments[0]
    first.networkEntryRoadId = FULL_COST_TRAINING_IDS.armA
    const otherRoad = structuredClone(project.context.find((road) => road.id === FULL_COST_TRAINING_IDS.armA)!)
    otherRoad.id = 'different-overlapping-access'
    otherRoad.name = 'Different overlapping access option'
    otherRoad.roadEvidence!.network!.access = 'closed'
    project.context.push(otherRoad)
    const second = structuredClone(first)
    second.id = 'same-geometry-other-access'
    second.name = 'Same geometry with another reviewed attachment'
    second.networkEntryRoadId = otherRoad.id
    project.alignments.push(second)
    const run = await runFullCostComparison(project, demoTerrain)
    expect(
      run.candidates.some(
        (candidate) => candidate.alignment.id === first.id && candidate.entryRoadId === first.networkEntryRoadId,
      ),
    ).toBe(true)
    expect(
      run.candidates.some(
        (candidate) => candidate.alignment.id === second.id && candidate.entryRoadId === otherRoad.id,
      ),
    ).toBe(true)
    expect(run.comparison.candidates.find((candidate) => candidate.id === first.id)!.status).toBe('feasible')
    expect(run.comparison.candidates.find((candidate) => candidate.id === second.id)!.status).toBe('infeasible')
  })

  it('preserves haul/mobilization/contingency inputs and avoids a 25→24.9 m rounding failure', async () => {
    cornerSuggestions()
    const project = createFullCostTrainingProject(),
      active = project.alignments[0]
    Object.assign(active.engineering!.haul, {
      mobilizationCost: 1234,
      contingencyPercent: 17,
      overhaulRate: 3,
      endHaulLoadingRate: 2,
    })
    const run = await runFullCostComparison(project, { elevationAt: () => 0 })
    const generated = run.candidates.filter((candidate) => candidate.alignment.id.startsWith('complete-route-'))
    expect(generated.length).toBeGreaterThan(0)
    for (const candidate of generated) {
      expect(candidate.alignment.engineering!.haul).toEqual({ ...active.engineering!.haul, enabled: true })
      const curves = horizontalCurveSummary(candidate.alignment)
      expect(curves.length).toBeGreaterThan(0)
      expect(Math.min(...curves.map((curve) => curve.radius))).toBeGreaterThanOrEqual(project.settings.minRadius - 1e-8)
      expect(candidate.checks.failures.some((issue) => issue.code === 'horizontal-radius')).toBe(false)
    }
  })

  it('requires material review before pricing generated roads that cannot inherit station-based horizons', async () => {
    cornerSuggestions()
    const project = createFullCostTrainingProject(),
      active = project.alignments[0]
    active.engineering!.materials = [
      { id: 'rock', name: 'Entered rock', color: '#888888', cutRate: 25, reusableFraction: 0.5, compactionFactor: 1 },
    ]
    active.engineering!.strata = [
      {
        id: 'entered-horizon',
        start: 0,
        end: alignmentLength(active),
        materialId: 'rock',
        topDepthM: 0,
        bottomDepthM: null,
      },
    ]
    const run = await runFullCostComparison(project, demoTerrain)
    const generated = run.candidates.filter((candidate) => candidate.alignment.id.startsWith('complete-route-'))
    expect(generated.length).toBeGreaterThan(0)
    expect(
      generated.every(
        (candidate) =>
          !candidate.checks.adoptable &&
          candidate.checks.unknowns.some((issue) => issue.code === 'generated-material-review'),
      ),
    ).toBe(true)
    expect(
      run.comparison.candidates
        .filter((candidate) => candidate.id.startsWith('complete-route-'))
        .every((candidate) => candidate.totalCost === null),
    ).toBe(true)
  })

  it('generates explicit tie-ins to eligible permit/user roads as well as FSR records', async () => {
    cornerSuggestions()
    const project = createFullCostTrainingProject()
    project.context.find((road) => road.id === FULL_COST_TRAINING_IDS.armA)!.roadEvidence!.roadClass = 'permit'
    project.context.find((road) => road.id === FULL_COST_TRAINING_IDS.armB)!.roadEvidence!.roadClass = 'user'
    const run = await runFullCostComparison(project, demoTerrain)
    const generated = run.candidates.filter((candidate) => candidate.alignment.id.startsWith('complete-route-'))
    expect(
      generated.some(
        (candidate) =>
          candidate.entryRoadId === FULL_COST_TRAINING_IDS.armA && candidate.alignment.name.includes('permit road'),
      ),
    ).toBe(true)
    expect(
      generated.some(
        (candidate) =>
          candidate.entryRoadId === FULL_COST_TRAINING_IDS.armB && candidate.alignment.name.includes('user road'),
      ),
    ).toBe(true)
    expect(
      generated
        .filter((candidate) => candidate.entryRoadId === FULL_COST_TRAINING_IDS.armA)
        .every((candidate) => candidate.alignment.fsrConnection === undefined),
    ).toBe(true)
  })

  it('refuses stale recorded FSR origins, destinations and removed road sections', async () => {
    directSuggestions()
    for (const defect of ['origin', 'destination', 'removed'] as const) {
      const project = createFullCostTrainingProject(),
        active = project.alignments[0]
      active.fsrConnection = recordedTarget(active)
      if (defect === 'origin') active.fsrConnection.originCoordinate = fullCostTrainingCoordinate(1, 0)
      if (defect === 'destination') active.fsrConnection.targetCoordinate = fullCostTrainingCoordinate(101, 0)
      if (defect === 'removed') active.fsrConnection.targetFeatureId = 'removed-road'
      const run = await runFullCostComparison(project, demoTerrain)
      const entered = run.candidates.find((candidate) => candidate.alignment.id === active.id)!
      expect(entered.checks.adoptable).toBe(false)
      expect(
        entered.checks.failures.some(
          (issue) =>
            issue.code ===
            (defect === 'origin'
              ? 'fsr-origin-registration'
              : defect === 'removed'
                ? 'fsr-target-registration'
                : 'endpoint-registration'),
        ),
      ).toBe(true)
      expect(run.comparison.candidates.find((candidate) => candidate.id === active.id)!.totalCost).toBeNull()
    }
  })

  it('yields between candidate pricing blocks so cancellation discards the incomplete run', async () => {
    vi.spyOn(routing, 'suggestRoutes').mockImplementation(() => {
      throw Error('No generated geometry in cancellation fixture')
    })
    const project = createFullCostTrainingProject(),
      controller = new AbortController()
    let message = '',
      sawFirstPricing = false
    await expect(
      runFullCostComparison(project, demoTerrain, {
        signal: controller.signal,
        onProgress: (next) => {
          message = next
        },
        yieldControl: async () => {
          if (message.startsWith('Pricing connector 1 ')) sawFirstPricing = true
          if (message.startsWith('Pricing connector 2 ')) controller.abort()
        },
      }),
    ).rejects.toThrow(/cancelled/)
    expect(sawFirstPricing).toBe(true)
  })

  it('enforces one shared network-path budget across individually chunked candidates', async () => {
    vi.spyOn(routing, 'suggestRoutes').mockImplementation(() => {
      throw Error('No generated geometry in budget fixture')
    })
    const actualPath = network.shortestRoadNetworkPath,
      counts: number[] = []
    let current = -1
    vi.spyOn(network, 'shortestRoadNetworkPath').mockImplementation((...args) => {
      counts[current] = (counts[current] ?? 0) + 1
      return actualPath(...args)
    })
    const project = createFullCostTrainingProject()
    const initial = await runFullCostComparison(project, demoTerrain, {
      onProgress: (message) => {
        if (message.startsWith('Pricing connector ')) current++
      },
    })
    expect(counts).toHaveLength(2)
    expect(counts.every((count) => count > 0)).toBe(true)
    expect(initial.comparison.pathSearches).toBe(counts.reduce((sum, count) => sum + count, 0))
    budget.paths = Math.max(...counts)
    await expect(runFullCostComparison(project, demoTerrain)).rejects.toThrow(/across the candidate comparison/)
  })
})
