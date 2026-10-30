/** Read-only check of every library scenario against its real published terrain and public context.
 * node --use-env-proxy --import tsx scripts/forestry/check-road-scenarios.ts
 * The PNG decoder substitutes only for the browser's canvas decoder, never the terrain data.
 */
import assert from 'node:assert/strict'
import { decode } from 'fast-png'
import { decodeTerrariumElevation, DEM_TILE_SIZE } from '../../src/pages/dev-forestry/terrain'
import { analyzeRoad } from '../../src/pages/dev-forestry-roads/engine'
import { ROAD_SCENARIOS, loadRoadScenario } from '../../src/pages/dev-forestry-roads/scenarios'
import { checkScenarioTerrain } from '../../src/pages/dev-forestry-roads/scenarioCoverage'

const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 180_000)
try {
  const selected = new Set(process.argv.slice(2))
  for (const scenario of ROAD_SCENARIOS.filter((item) => !selected.size || selected.has(item.id))) {
    const loaded = await loadRoadScenario(scenario.id, {
      signal: controller.signal,
      onProgress: (message) => console.log(`${scenario.id}: ${message}`),
      decodeRegionalTiles: async (bytes) => {
        const image = decode(new Uint8Array(bytes))
        assert.equal(image.width, DEM_TILE_SIZE)
        assert.equal(image.height, DEM_TILE_SIZE)
        assert.ok(image.channels >= 3)
        const values = new Float32Array(image.width * image.height)
        for (let i = 0; i < values.length; i++) {
          const offset = i * image.channels
          values[i] =
            image.channels === 4 && image.data[offset + 3] === 0
              ? NaN
              : decodeTerrariumElevation(image.data[offset], image.data[offset + 1], image.data[offset + 2])
        }
        return values
      },
    })
    const coverage = checkScenarioTerrain(
      loaded.project.alignments,
      loaded.source,
      loaded.project.settings.crossSectionHalfWidth,
    )
    assert.equal(coverage.missing, 0)
    const analyses = loaded.project.alignments.map((alignment) => {
      const result = analyzeRoad(alignment, loaded.source, loaded.project.settings, loaded.project.context)
      assert.ok(result.stations.length > 1)
      assert.ok(result.stations.every((station) => station.groundElevation !== null))
      return {
        road: alignment.name,
        lengthM: result.length,
        completeSectionsPercent: result.coveragePercent,
        maxGradePercent: result.maxGradePercent,
        warnings: result.warnings,
      }
    })
    console.log(
      JSON.stringify(
        {
          scenario: scenario.id,
          terrain: loaded.project.terrain.name,
          resolutionM: loaded.project.terrain.resolutionM,
          corridorGroundCoveragePercent: coverage.coveragePercent,
          roads: loaded.project.context.filter((feature) => feature.kind === 'existing-road').length,
          blocks: loaded.project.context.filter((feature) => feature.kind === 'harvest').length,
          contextWarnings: loaded.project.scenario?.contextWarnings,
          analyses,
        },
        null,
        2,
      ),
    )
  }
} finally {
  clearTimeout(timer)
}
