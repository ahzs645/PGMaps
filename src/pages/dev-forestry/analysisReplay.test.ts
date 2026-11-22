import { describe, it, expect } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { ElevationGrid, DEM_TILE_SIZE } from '@/lib/forestry/terrain/terrain'
import { computeAnalysis } from './analysis'
import { retainRun, replayRun, type RunInputs } from './analysisReplay'
import { DEFAULT_ANALYSIS_SETTINGS } from './types'
import { compareReplayFigures, replayEvidence, REPLAY_TOLERANCE_PP, SIGHTLINE_CALC_VERSION } from './replayComparison'

/** The archive with its manifest's saved figures (or the manifest itself) changed by `edit`; the inputs untouched. */
async function withManifest(file: Blob, edit: (manifest: Record<string, unknown>) => void) {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const manifest = JSON.parse(strFromU8(entries['manifest.json']))
  edit(manifest)
  entries['manifest.json'] = strToU8(JSON.stringify(manifest))
  return new Blob([zipSync(entries) as BlobPart])
}
it('recomputes the stored figures offline and detects a changed terrain cell', async () => {
  const range = { zoom: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, tileCount: 1 },
    grid = new ElevationGrid(range)
  const cells = new Float32Array(DEM_TILE_SIZE ** 2).fill(120)
  grid.setTile(0, 0, cells)
  const square = (r: number): GeoJSON.Polygon => ({
    type: 'Polygon',
    coordinates: [
      [
        [-r, -r],
        [r, -r],
        [r, r],
        [-r, r],
        [-r, -r],
      ],
    ],
  })
  const data: RunInputs = {
    range,
    canopy: [],
    forested: [square(0.02)],
    context: {},
    terrain: { tileCount: 1, missingTileCount: 0, resolutionMeters: 25 },
    input: {
      assessmentYear: 2000,
      viewpoint: { mode: 'spot', coordinates: [[-0.06, 0]] },
      settings: {
        ...DEFAULT_ANALYSIS_SETTINGS,
        observerHeightMeters: 3000,
        maxViewDistanceMeters: 40000,
        sampleBudget: 300,
      },
      targets: [
        {
          id: 'face',
          name: 'Face',
          role: 'landscape',
          geometry: square(0.02),
          harvestYear: null,
          clearcutPercent: null,
        },
        { id: 'cut', name: 'Cut', role: 'block', geometry: square(0.005), harvestYear: null, clearcutPercent: null },
      ],
    },
  }
  const original = computeAnalysis(grid, data.input, data.terrain, undefined, data.canopy, data.forested, data.context)
  const file = await retainRun(data, new Map([['dem/0-0.f32', new Uint8Array(cells.buffer)]]), original, {
    viewId: 'v',
    rowId: 'sheet',
    landformId: 'face',
  })
  const replay = await replayRun(file)
  expect(replay.replayMatches).toBe(true)
  expect(replay.replayMaxDeltaPp).toBe(0)
  expect(replay.replayCalcVersion).toBe(SIGHTLINE_CALC_VERSION)
  expect(replay.replayRowId).toBe('sheet')
  expect(replay.result.perspectiveByStation).toEqual(original.perspectiveByStation)
  const station = original.assessmentStationIndex
  expect(original.perspectiveByStation[station]?.cumulativePercent).toBeGreaterThan(0)
  const nudge = (by: number) =>
    withManifest(file, (manifest) => {
      const expected = manifest.expected as { perspective: Array<{ cumulativePercent: number } | null> }
      expected.perspective[station]!.cumulativePercent += by
    })
  // Summed in another order: within the tolerance, and the difference is reported.
  const nudged = await replayRun(await nudge(1e-11))
  expect(nudged.replayMatches).toBe(true)
  expect(nudged.replayMaxDeltaPp).toBeGreaterThan(0)
  expect(nudged.replayMaxDeltaPp).toBeLessThan(1e-9)
  // A real change: a hundredth of a point fails and is named.
  const changed = await replayRun(await nudge(0.01))
  expect(changed.replayMatches).toBe(false)
  expect(changed.replayMaxDeltaPp).toBeCloseTo(0.01, 9)
  expect(changed.replayMismatches).toEqual([expect.stringContaining(`perspective[${station}].cumulativePercent`)])
  // An archive written before the calculation version was recorded still replays, and says so.
  const older = await replayRun(await withManifest(file, (manifest) => delete manifest.calcVersion))
  expect(older.replayMatches).toBe(true)
  expect(older.replayCalcVersion).toBeNull()
  expect(replayEvidence(older)).toContain('Calculation version not recorded')
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  entries['dem/0-0.f32'][0] ^= 1
  await expect(replayRun(new Blob([zipSync(entries) as BlobPart]))).rejects.toThrow('checksum mismatch')
})

describe('compareReplayFigures', () => {
  const saved = () => ({
    perspective: [null, { existingPercent: 1, disturbancePercent: 0, proposedPercent: 2.5, cumulativePercent: 3.5 }],
    plan: { existingPercent: 1, disturbancePercent: 0, proposedPercent: 2, cumulativePercent: 3 },
    station: 1,
    sightlines: 21348,
  })

  it('accepts percentages within the tolerance and reports the largest difference', () => {
    const replayed = saved()
    replayed.perspective[1]!.cumulativePercent += 1e-11
    replayed.plan.proposedPercent -= 3e-12
    const comparison = compareReplayFigures(saved(), replayed)
    expect(comparison.matches).toBe(true)
    expect(comparison.mismatches).toEqual([])
    expect(comparison.maxAbsDeltaPp).toBeCloseTo(1e-11, 15)
    expect(compareReplayFigures(saved(), saved())).toEqual({ matches: true, maxAbsDeltaPp: 0, mismatches: [] })
  })

  it('fails a change one sightline would make, and anything compared exactly', () => {
    const oneSightline = saved()
    oneSightline.perspective[1]!.cumulativePercent += 100 / 21348
    expect(100 / 21348).toBeGreaterThan(REPLAY_TOLERANCE_PP)
    expect(compareReplayFigures(saved(), oneSightline).matches).toBe(false)
    const hundredth = saved()
    hundredth.plan.cumulativePercent += 0.01
    expect(compareReplayFigures(saved(), hundredth)).toMatchObject({
      matches: false,
      mismatches: ['plan.cumulativePercent: 3 → 3.01'],
    })
    const station = { ...saved(), station: 0 }
    expect(compareReplayFigures(saved(), station).mismatches).toEqual(['station: 1 → 0'])
    const sightlines = { ...saved(), sightlines: 21349 }
    expect(compareReplayFigures(saved(), sightlines).mismatches).toEqual(['sightlines: 21348 → 21349'])
    // A figure present on one side and null on the other, or a station list of another length.
    const swapped = saved()
    swapped.perspective = [swapped.perspective[1], null]
    expect(compareReplayFigures(saved(), swapped).matches).toBe(false)
    const shorter = { ...saved(), perspective: [null] }
    expect(compareReplayFigures(saved(), shorter).mismatches).toEqual(['perspective: 2 entries → 1'])
    const noPlan = { ...saved(), plan: null }
    expect(compareReplayFigures(saved(), noPlan).matches).toBe(false)
  })

  it('says whether the replay matched, within what, and the largest difference', () => {
    expect(replayEvidence({ replayMatches: true, replayMaxDeltaPp: 2.8e-14, replayCalcVersion: 1 })).toBe(
      'Replayed the saved numerical results: within 1e-6 points (largest difference 2.8e-14 points). Calculation version 1 in the archive.',
    )
    expect(
      replayEvidence({
        replayMatches: false,
        replayMaxDeltaPp: 0.01,
        replayMismatches: ['plan.cumulativePercent: 3 → 3.01'],
        replayCalcVersion: null,
      }),
    ).toBe(
      'Replayed figures differ from the saved run (largest difference 0.01 points; 1 differ: plan.cumulativePercent: 3 → 3.01). Calculation version not recorded in the archive.',
    )
  })
})
