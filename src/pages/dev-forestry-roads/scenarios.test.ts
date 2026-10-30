import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeRoad } from './engine'
import { parseProject, serializeProject } from './project'
import { createTrainingScenario, loadRoadScenario, ROAD_SCENARIOS, regionalScenarioAlignments } from './scenarios'
import { demoTerrain } from './terrain'
import * as terrain from './terrain'
import * as existingRoads from './existingRoads'
import * as harvestInventory from '../dev-forestry/bcVisualInventory'
import { requireScenarioTerrain } from './scenarioCoverage'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('road scenario library', () => {
  it('loads each training example without a network request, retaining terrain, roads and blocks together', async () => {
    const fetch = vi.fn(() => {
      throw Error('Offline training must not fetch')
    })
    vi.stubGlobal('fetch', fetch)
    for (const scenario of ROAD_SCENARIOS.filter((item) => item.kind === 'training')) {
      const loaded = await loadRoadScenario(scenario.id)
      expect(loaded.project.terrain.kind).toBe('demo')
      expect(loaded.source).toBe(demoTerrain)
      expect(loaded.project.scenario?.id).toBe(scenario.id)
      expect(loaded.project.context.some((feature) => feature.kind === 'harvest')).toBe(true)
      expect(loaded.project.context.some((feature) => feature.kind === 'existing-road')).toBe(true)
      requireScenarioTerrain(loaded.project.alignments, loaded.source, loaded.project.settings.crossSectionHalfWidth)
      expect(parseProject(serializeProject(loaded.project))).toEqual(loaded.project)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('compares the same geometry with free-acquisition stockpile supply enabled and disabled', () => {
    const project = createTrainingScenario('training-local-gravel')
    const [local, purchased] = project.alignments
    expect(local.points.map((point) => point.coordinate)).toEqual(purchased.points.map((point) => point.coordinate))
    expect(local.engineering?.surfacingSupply?.acquisitionRate).toBe(0)
    expect(local.engineering?.surfacingSupply?.loadingRate).toBeGreaterThan(0)
    const localResult = analyzeRoad(local, demoTerrain, project.settings)
    const purchasedResult = analyzeRoad(purchased, demoTerrain, project.settings)
    expect(localResult.coveragePercent).toBeCloseTo(100, 6)
    expect(localResult.surfaceVolumeM3).toBeCloseTo(purchasedResult.surfaceVolumeM3, 8)
    expect(localResult.estimatedCost).toBeLessThan(purchasedResult.estimatedCost)
    expect(purchased.engineering?.surfacingSupply?.enabled).toBe(false)
  })

  it('keeps road reuse an explicit synthetic condition assumption', () => {
    const project = createTrainingScenario('training-road-reuse')
    expect(project.routeSearch?.reuseExistingRoads).toBe(true)
    const roads = project.context.filter((feature) => feature.kind === 'existing-road')
    expect(roads).toHaveLength(2)
    expect(roads.map((road) => road.roadEvidence?.condition)).toEqual(['serviceable', 'rehabilitation'])
    expect(
      roads.every((road) => road.roadEvidence?.source === 'scenario' && road.roadEvidence.conditionBasis === 'assumed'),
    ).toBe(true)
    expect(roads.every((road) => road.roadEvidence?.constructionYear === undefined)).toBe(true)
  })

  it('builds each regional example around its own place with its own sampled profile', () => {
    const source = { elevationAt: (_lon: number, lat: number) => 100 + lat * 10 }
    for (const scenario of ROAD_SCENARIOS) {
      if (scenario.kind !== 'regional') continue
      const alignments = regionalScenarioAlignments(scenario.id, scenario.centre, source)
      expect(alignments).toHaveLength(2)
      for (const alignment of alignments) {
        for (const point of alignment.points) {
          expect(Math.abs(point.coordinate[0] - scenario.centre[0])).toBeLessThan(0.02)
          expect(Math.abs(point.coordinate[1] - scenario.centre[1])).toBeLessThan(0.01)
        }
        expect(alignment.vertical.every((point) => Number.isFinite(point.elevation))).toBe(true)
      }
      expect(alignments[0].points[0].coordinate).toEqual(alignments[1].points[0].coordinate)
      expect(alignments[0].points.at(-1)?.coordinate).toEqual(alignments[1].points.at(-1)?.coordinate)
    }
  })

  it('retains public context failures in a portable project without substituting invented roads', async () => {
    const fixture = terrain.createDemoProject()
    vi.spyOn(terrain, 'loadLidarTerrain').mockResolvedValue({
      metadata: fixture.terrain,
      source: demoTerrain,
      alignments: fixture.alignments,
    })
    vi.spyOn(existingRoads, 'loadBcExistingRoads').mockRejectedValue(Error('The road service is offline.'))
    vi.spyOn(harvestInventory, 'fetchHarvestedAreas').mockResolvedValue({ areas: [], truncated: false })
    const loaded = await loadRoadScenario('bc-lidar')
    expect(loaded.project.context).toEqual([])
    expect(loaded.project.scenario?.contextWarnings).toEqual([
      'BC road tenures unavailable: The road service is offline.',
    ])
    expect(parseProject(serializeProject(loaded.project)).scenario).toEqual(loaded.project.scenario)
    expect(loaded.source).toBe(demoTerrain)
  })

  it('refuses real source failures before loading context or manufacturing substitute terrain', async () => {
    vi.spyOn(terrain, 'loadLidarTerrain').mockRejectedValue(Error('Native terrain checksum changed.'))
    const roads = vi.spyOn(existingRoads, 'loadBcExistingRoads')
    await expect(loadRoadScenario('bc-lidar')).rejects.toThrow('Native terrain checksum changed.')
    expect(roads).not.toHaveBeenCalled()
  })
})
