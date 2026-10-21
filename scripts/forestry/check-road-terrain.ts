/** Read-only smoke check against the published, hash-verified 1 m LiDAR product.
 * node --import tsx scripts/forestry/check-road-terrain.ts
 * Proxy-managed environments may additionally need node --use-env-proxy.
 * No large raster or generated analysis is written to the repository.
 */
import assert from 'node:assert/strict'
import { analyzeRoad } from '../../src/pages/dev-forestry-roads/engine'
import {
  DEFAULT_ROAD_SETTINGS,
  loadLidarTerrain,
  loadTerrainMetadata,
  terrainBounds,
} from '../../src/pages/dev-forestry-roads/terrain'

const abort = new AbortController(),
  timeout = setTimeout(() => abort.abort(), 60000)
try {
  const loaded = await loadLidarTerrain(abort.signal, (message) => console.log(message))
  assert.equal(loaded.metadata.resolutionM, 1)
  assert.equal(loaded.metadata.epsg, 3157)
  assert.match(loaded.metadata.sha256 ?? '', /^[a-f0-9]{64}$/)
  assert.match(loaded.metadata.verticalReference, /CGVD2013/)
  assert.ok(terrainBounds(loaded.metadata))
  assert.ok(loaded.alignments?.length)
  const alignment = loaded.alignments![0]
  for (const point of alignment.points) assert.ok(Number.isFinite(loaded.source.elevationAt(...point.coordinate)))
  assert.ok(Number.isNaN(loaded.source.elevationAt(0, 0)), 'Outside-footprint terrain must remain missing')
  const restored = await loadTerrainMetadata(loaded.metadata, abort.signal)
  assert.equal(
    restored.elevationAt(...alignment.points[0].coordinate),
    loaded.source.elevationAt(...alignment.points[0].coordinate),
  )
  const analysis = analyzeRoad(alignment, loaded.source, DEFAULT_ROAD_SETTINGS)
  assert.ok(analysis.stations.length > 10 && analysis.length > 500)
  assert.ok(analysis.coveragePercent > 0)
  assert.ok(Number.isFinite(analysis.cutVolumeM3 + analysis.fillVolumeM3))
  console.log(
    JSON.stringify(
      {
        terrain: loaded.metadata,
        bounds: terrainBounds(loaded.metadata),
        lengthM: analysis.length,
        stations: analysis.stations.length,
        coveragePercent: analysis.coveragePercent,
        cutM3: analysis.cutVolumeM3,
        fillM3: analysis.fillVolumeM3,
        warnings: analysis.warnings,
      },
      null,
      2,
    ),
  )
} finally {
  clearTimeout(timeout)
}
