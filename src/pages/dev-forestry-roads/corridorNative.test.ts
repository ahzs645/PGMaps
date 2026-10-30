import { mkdir, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { loadLidarTerrain, terrainBounds, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import { corridorFrame, optimizeRoadCorridor, type RoadOptimizationResult } from './corridorOptimizer'
import { corridorCandidate } from './corridorCandidate'
import { alignmentLength } from './engine'
import type { Coordinate } from './types'

/** Live native data, never mocked. Fixed, documented subareas of ONE BC tile. */
describe.skipIf(process.env.PGMAPS_ROAD_NATIVE !== '1')('live 1 m BC LiDAR corridor trials', () => {
  it('records all attempts, source provenance and exact adopted geometry', async () => {
    const loaded = await loadLidarTerrain()
    const b = terrainBounds(loaded.metadata)!
    expect(loaded.metadata.sha256).toBe('b1259f310ceed97a11f25883d7df609390b977a293b622f9e4946a7853ad00e2')
    const source = loaded.source
    const records: Array<Record<string, unknown>> = []
    const features: GeoJSON.Feature[] = []
    const settings = { ...DEFAULT_ROAD_SETTINGS, maxGradePercent: 12, minRadius: 15 }
    const sites = [
      [0.25, 0.4],
      [0.5, 0.55],
      [0.7, 0.65],
    ]
    for (let i = 0; i < sites.length; i++) {
      const [u, v] = sites[i]
      const centre: Coordinate = [b[0] + (b[2] - b[0]) * u, b[1] + (b[3] - b[1]) * v]
      const f = corridorFrame(centre)
      const z = (x: number, y: number) => source.elevationAt(...f.fromXY([x, y]))
      const dx = (z(5, 0) - z(-5, 0)) / 10,
        dy = (z(0, 5) - z(0, -5)) / 10
      const theta = Number.isFinite(dx + dy) && Math.hypot(dx, dy) > 0.001 ? Math.atan2(dy, dx) + Math.PI / 2 : 0
      // Contour-oriented 80 m trial, selected by a declared local-gradient rule,
      // not an existing road, surveyed route or hand-picked optimization success.
      const guide = [-40, 40].map((t) => f.fromXY([t * Math.cos(theta), t * Math.sin(theta)]))
      for (const objective of ['shortest', 'balanced', 'contour'] as const) {
        const start = performance.now()
        let result: RoadOptimizationResult
        try {
          result = optimizeRoadCorridor(guide, source, settings, [], {
            objective,
            corridorHalfWidthM: 60,
            maxStates: 12000,
            maxTerrainSamples: 2000000,
          })
        } catch (error) {
          records.push({
            site: i + 1,
            centre,
            guide,
            objective,
            status: 'no verified candidate',
            error: error instanceof Error ? error.message : String(error),
            durationMs: Math.round(performance.now() - start),
          })
          continue
        }
        // Validation errors are test failures, never disguised as unsuccessful searches.
        const candidate = corridorCandidate(result, DEFAULT_TEMPLATE, 'Native trial ' + (i + 1))
        expect(alignmentLength(candidate)).toBeCloseTo(result.lengthM, 3)
        expect(result.complete).toBe(true)
        expect(result.maxSampledGroundPitchPercent).toBeLessThanOrEqual(12.00001)
        records.push({
          site: i + 1,
          centre,
          guide,
          objective,
          status: result.searchStatus,
          lengthM: result.lengthM,
          baselineLengthM: result.baseline.lengthM,
          gradePercent: result.maxSampledGroundPitchPercent,
          baselineGradePercent: result.baseline.maxSampledGroundPitchPercent,
          excessVerticalM: result.excessVerticalM,
          baselineExcessVerticalM: result.baseline.excessVerticalM,
          controls: candidate.points.length,
          explored: result.explored,
          durationMs: Math.round(performance.now() - start),
        })
        features.push({
          type: 'Feature',
          properties: { site: i + 1, objective },
          geometry: { type: 'LineString', coordinates: result.coordinates },
        })
      }
    }
    await mkdir('road-optimizer-results', { recursive: true })
    const report = {
      source: loaded.metadata,
      scope: 'Three subareas of one real BC LiDAR tile; no field verification or real road/exclusion layers supplied.',
      selectionRule:
        'Fixed tile fractions; contour-oriented endpoints 40 m either side of the local centre using a 10 m central gradient.',
      settings,
      records,
    }
    await writeFile('road-optimizer-results/native-trials.json', JSON.stringify(report, null, 2))
    await writeFile(
      'road-optimizer-results/native-routes.geojson',
      JSON.stringify({ type: 'FeatureCollection', features }),
    )
    console.log('NATIVE_CORRIDOR_RESULTS=' + JSON.stringify(report))
    expect(records).toHaveLength(9)
    // Failures are evidence, not hidden skips. At least one real-data candidate
    // must pass the application's own geometry check before this trial passes.
    expect(features.length).toBeGreaterThan(0)
  }, 240000)
})
