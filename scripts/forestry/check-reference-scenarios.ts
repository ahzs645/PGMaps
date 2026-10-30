/** Exercise the reference extensions against every built-in scenario's actual source terrain.
 * Engineering inputs below are deliberately synthetic test assumptions, not site recommendations.
 * node --use-env-proxy --import tsx scripts/forestry/check-reference-scenarios.ts
 */
import assert from 'node:assert/strict'
import { decode } from 'fast-png'
import { decodeTerrariumElevation, DEM_TILE_SIZE } from '../../src/pages/dev-forestry/terrain'
import { ROAD_SCENARIOS, loadRoadScenario } from '../../src/pages/dev-forestry-roads/scenarios'
import { alignmentLength, analyzeRoad } from '../../src/pages/dev-forestry-roads/engine'
import { createEngineeringDesign } from '../../src/pages/dev-forestry-roads/engineeringTypes'
import { parseProject, serializeProject, projectReportHtml } from '../../src/pages/dev-forestry-roads/project'
import { createRoadReportSettings } from '../../src/pages/dev-forestry-roads/reportSettings'
import { addVerticalAlternative } from '../../src/pages/dev-forestry-roads/verticalAlternatives'
import { plotBookHtml } from '../../src/pages/dev-forestry-roads/plotBook'
import { exportGrid } from '../../src/pages/dev-forestry-roads/terrain'

const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 600_000)
const selected = new Set(process.argv.slice(2))
try {
  for (const scenario of ROAD_SCENARIOS.filter((item) => !selected.size || selected.has(item.id))) {
    const loaded = await loadRoadScenario(scenario.id, {
      signal: controller.signal,
      onProgress: (message) => process.stderr.write(`${scenario.id}: ${message}\n`),
      decodeRegionalTiles: async (bytes) => {
        const image = decode(new Uint8Array(bytes))
        assert.equal(image.width, DEM_TILE_SIZE)
        assert.equal(image.height, DEM_TILE_SIZE)
        const values = new Float32Array(image.width * image.height)
        for (let i = 0; i < values.length; i++) {
          const at = i * image.channels
          values[i] =
            image.channels === 4 && image.data[at + 3] === 0
              ? NaN
              : decodeTerrariumElevation(image.data[at], image.data[at + 1], image.data[at + 2])
        }
        return values
      },
    })
    let project = structuredClone(loaded.project)
    const road = project.alignments[0]
    const length = alignmentLength(road)
    road.engineering = createEngineeringDesign()
    road.engineering.materials = [
      {
        id: 'test-rock',
        name: 'TEST ASSUMPTION rock',
        color: '#777777',
        cutRate: 15,
        reusableFraction: 1,
        compactionFactor: 0.9,
        quality: 80,
        cutSlope: 0.5,
        fillSlope: 1.5,
      },
      {
        id: 'test-strip',
        name: 'TEST ASSUMPTION organics',
        color: '#654321',
        cutRate: 5,
        reusableFraction: 0,
        compactionFactor: 1,
        purpose: 'stripping',
      },
    ]
    road.engineering.strata = [
      { id: 'test-geology', start: 0, end: length, topDepthM: 0, bottomDepthM: null, materialId: 'test-rock' },
    ]
    road.engineering.sitePreparation = [
      {
        id: 'test-preparation',
        start: 0,
        end: Math.min(50, length),
        depthM: 0.2,
        leftInsideM: 0,
        rightInsideM: 0,
        leftOutsideM: 0.3,
        rightOutsideM: 0.3,
        materialId: 'test-strip',
      },
    ]
    road.template.components = [
      {
        id: 'test-bench',
        name: 'TEST bench',
        side: 'left',
        kind: 'bench',
        condition: 'cut',
        widthM: 0.5,
        riseM: 0,
        code: 'test-bench-edge',
      },
    ]
    road.template.layers = [
      { id: 'test-course', name: 'TEST wearing course', side: 'both', depthM: 0.15, materialId: 'test-rock' },
    ]
    road.engineering.fillRequirements = [
      { id: 'test-fill', start: 0, end: length, layer: 'subgrade', materialId: 'test-rock', replaceable: false },
    ]
    road.engineering.sites = [
      {
        id: 'test-pit',
        name: 'TEST rock supply',
        kind: 'borrow',
        chainage: 0,
        accessDistanceM: 10,
        capacityM3: null,
        unitRate: 10,
        fixedCost: 100,
        materialId: 'test-rock',
      },
      {
        id: 'test-waste',
        name: 'TEST disposal',
        kind: 'waste',
        chainage: length,
        accessDistanceM: 10,
        capacityM3: null,
        unitRate: 2,
        fixedCost: 50,
      },
    ]
    road.engineering.haul = {
      ...road.engineering.haul,
      enabled: true,
      allocation: 'economic',
      freeHaulDistanceM: 0,
      overhaulDistanceM: 0,
      freeHaulRate: 1,
      overhaulRate: 1,
      endHaulRate: 1,
      directionRanges: [{ id: 'test-construction', start: 0, end: length, direction: 'forward' }],
      sidecastRanges: [
        {
          id: 'test-sidecast',
          start: 0,
          end: Math.min(50, length),
          capacityBankM3PerM: 1,
          unitRate: 0.5,
          materialIds: ['test-strip'],
        },
      ],
    }
    // 50 m is an explicit test sampling choice to bound the economic model, not a claim of convergence.
    project.settings.stationInterval = 50
    project.alignments[0] = addVerticalAlternative(road, 'test-profile', 'TEST saved profile')
    project.activeAlignmentId = road.id
    project.reportSettings = createRoadReportSettings()
    project.reportSettings.paper = 'A4'
    project.reportSettings.stationLabel = '{road} {station}'
    project = parseProject(project)
    const analysis = analyzeRoad(project.alignments[0], loaded.source, project.settings, project.context)
    assert.ok(analysis.stations.length > 1)
    assert.ok(analysis.stations.every((station) => station.groundElevation !== null))
    assert.ok(analysis.stations.some((station) => station.section.some((point) => point.preparedGround !== undefined)))
    assert.equal(
      analysis.engineering?.haul.optimizationStatus,
      'optimal',
      `${scenario.id}: material prescription must solve with explicit supply/disposal`,
    )
    assert.ok(analysis.engineering!.strippingCutM3 > 0)
    assert.ok(analysis.surfaceVolumeM3 > 0)
    const restored = parseProject(serializeProject(project))
    const reopened = analyzeRoad(restored.alignments[0], loaded.source, restored.settings, restored.context)
    for (const metric of [
      'cutVolumeM3',
      'fillVolumeM3',
      'surfaceVolumeM3',
      'estimatedCost',
      'coveragePercent',
    ] as const)
      assert.ok(
        Math.abs(analysis[metric] - reopened[metric]) < 1e-7,
        `${scenario.id}: ${metric} must survive project handoff`,
      )
    const book = plotBookHtml({
      projectName: restored.name,
      alignment: restored.alignments[0],
      analysis: reopened,
      terrain: restored.terrain,
      ...exportGrid(restored.terrain, restored.alignments[0].points[0].coordinate),
      settings: restored.reportSettings,
    })
    assert.ok(book.includes('A4 landscape'))
    assert.ok(projectReportHtml(restored, reopened).includes('Engineering cost breakdown'))
    process.stdout.write(
      JSON.stringify({
        scenario: scenario.id,
        source: restored.terrain.name,
        sourceResolutionM: restored.terrain.resolutionM,
        assumptions:
          'Synthetic materials, preparation, bench, source capacities, direction and prices for software validation only',
        stationIntervalM: 50,
        stations: analysis.stations.length,
        coveragePercent: analysis.coveragePercent,
        strippingBankM3: analysis.engineering!.strippingCutM3,
        cutBankM3: analysis.cutVolumeM3,
        fillCompactedM3: analysis.fillVolumeM3,
        surfaceCompactedM3: analysis.surfaceVolumeM3,
        allocationStatus: analysis.engineering!.haul.optimizationStatus,
        movements: analysis.engineering!.movements.length,
        cost: analysis.estimatedCost,
        reopenedExactly: true,
        authoredBook: true,
        warnings: analysis.warnings,
        engineeringWarnings: analysis.engineering!.warnings,
      }) + '\n',
    )
  }
} finally {
  clearTimeout(timer)
}
