/** Read-only actual-source drainage/catchment/portable-evidence checks for every built-in scenario.
 * node --use-env-proxy --import tsx scripts/forestry/check-road-drainage-scenarios.ts [scenario IDs]
 * The regional decoder replaces browser canvas only; source terrain is never replaced by a fixture.
 */
import assert from 'node:assert/strict'
import { decode } from 'fast-png'
import { decodeTerrariumElevation, DEM_TILE_SIZE } from '../../src/pages/dev-forestry/terrain'
import { analyzeRoad } from '../../src/pages/dev-forestry-roads/engine'
import { DEFAULT_DRAINAGE_SETTINGS, runDrainage } from '../../src/pages/dev-forestry-roads/drainageRun'
import {
  createDrainageEvidence,
  drainageEvidenceGeoJson,
  drainageInputFingerprint,
  parseDrainageProjectState,
} from '../../src/pages/dev-forestry-roads/drainageEvidence'
import { ROAD_SCENARIOS, loadRoadScenario } from '../../src/pages/dev-forestry-roads/scenarios'
import { localMetricGrid } from '../../src/pages/dev-forestry-roads/terrain'

const selected = new Set(process.argv.slice(2))
const results: unknown[] = []
let failures = 0
for (const scenario of ROAD_SCENARIOS.filter((item) => !selected.size || selected.has(item.id))) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    const loaded = await loadRoadScenario(scenario.id, {
      signal: controller.signal,
      onProgress: (message) => console.error(`${scenario.id}: ${message}`),
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
    const roads = loaded.project.alignments.map((alignment) => {
      const analysis = analyzeRoad(alignment, loaded.source, loaded.project.settings, loaded.project.context)
      const supported = analysis.stations.filter((s) => s.groundElevation !== null)
      assert.ok(supported.length, `${alignment.name} has no supported pour-point station`)
      const point = supported[Math.floor(supported.length / 2)]
      const settings = { ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 80 }
      const pourPoint = {
        coordinate: point.coordinate,
        surface: 'existing' as const,
        snapRadiusM: Math.max(10, loaded.project.terrain.resolutionM * 2),
      }
      const input = {
        alignment,
        roadSettings: loaded.project.settings,
        terrain: loaded.project.terrain,
        settings,
        pourPoint,
        watershedMinAreaHa: 0.4,
      }
      const run = runDrainage({
        terrain: loaded.source,
        analysis,
        culverts: alignment.engineering?.culverts ?? [],
        ...localMetricGrid(alignment.points[0].coordinate),
        resolutionM: loaded.project.terrain.resolutionM,
        settings,
        pourPoint,
        watershedMinAreaHa: 0.4,
      })
      assert.ok(run.catchment && run.catchment.feature.properties.cells > 0)
      assert.equal(
        run.catchment.feature.properties.areaHa,
        (run.catchment.feature.properties.cells * run.cellM ** 2) / 10_000,
      )
      assert.ok(run.cellM >= Math.max(1, loaded.project.terrain.resolutionM))
      const supportedAreaM2 = run.existing.accumulation.reduce(
        (area, value) => area + (value > 0 ? run.cellM ** 2 : 0),
        0,
      )
      const watershedAreaM2 = run.watersheds!.features.reduce((area, f) => area + f.properties.areaHa * 10_000, 0)
      assert.ok(watershedAreaM2 <= supportedAreaM2 + 1e-6, 'Disjoint basins cannot exceed supported raster area')
      const record = createDrainageEvidence(run, input)
      const restored = parseDrainageProjectState(
        JSON.parse(JSON.stringify({ settings, pourPoint, watershedMinAreaHa: 0.4, records: [record] })),
      )
      assert.deepEqual(restored.records[0], record)
      assert.equal(record.fingerprint, drainageInputFingerprint(input))
      assert.notEqual(
        record.fingerprint,
        drainageInputFingerprint({ ...input, settings: { ...settings, rainfallMmPerHr: 70 } }),
      )
      assert.ok(drainageEvidenceGeoJson(record, record.fingerprint, { hasLiveRun: true }).features.length > 0)
      if (loaded.project.terrain.kind === 'regional')
        assert.throws(() => drainageEvidenceGeoJson(record, record.fingerprint), /unchecksummed live terrain/)
      return {
        road: alignment.name,
        lengthM: analysis.length,
        completeSectionsPercent: analysis.coveragePercent,
        cells: run.cells,
        cellM: run.cellM,
        catchmentAreaHa: run.catchment.feature.properties.areaHa,
        catchmentTruncated: run.catchment.feature.properties.truncated,
        snapDistanceM: run.catchment.snappedDistanceM,
        watershedCount: run.watersheds!.features.length,
        watershedAreaHa: watershedAreaM2 / 10_000,
        streamCrossings: run.crossings.length,
        lowPoints: run.lowPoints.length,
        culverts: run.culverts.length,
        portableEvidence: 'passed',
        warnings: run.warnings,
      }
    })
    results.push({
      scenario: scenario.id,
      status: 'passed',
      terrain: loaded.project.terrain.name,
      sourceResolutionM: loaded.project.terrain.resolutionM,
      contextWarnings: loaded.project.scenario?.contextWarnings,
      roads,
    })
    console.error(`${scenario.id}: drainage/catchment/evidence passed for ${roads.length} road(s)`)
  } catch (error) {
    failures++
    results.push({
      scenario: scenario.id,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
    console.error(`${scenario.id}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
  }
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), failures, results }, null, 2))
if (failures) process.exitCode = 1
