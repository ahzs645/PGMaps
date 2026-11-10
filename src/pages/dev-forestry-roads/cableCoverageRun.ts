/**
 * One cable-coverage run on a prepared extraction grid: the ground under the skylines, landings,
 * candidate lines, the screen, coverage, and the results for the extraction panel. The screen is
 * passed in: the page hands it the cable-layout worker (`screenCoverLines`), so the long part runs
 * off the page's thread and Cancel terminates it; tests hand it the module directly.
 *
 * Pure: no DOM or network access (the screen may use a worker).
 */
import {
  cableCandidateSteps,
  cableCoverageSteps,
  cableCoverBatches,
  cableGroundSteps,
  cableLandings,
  type CableCoverageResult,
} from './cableCoverage'
import type { CableCoverInput, CoverLineResult } from './cableLayout/cableLayout'
import { cancelled, runCooperatively } from './cooperative'
import { cableExtractionResult, type ExtractionGrid, type ExtractionResult } from './extractionReach'
import type { SkidProgress, SkidRoad } from './skidReach'
import type { TerrainSource } from './types'

/** Screens the batches in order; reports the share of lines done. */
export type CoverScreen = (
  batches: CableCoverInput[],
  onProgress: (share: number, lines: number) => void,
  signal?: AbortSignal,
) => Promise<CoverLineResult[]>

export interface CableRunInput {
  eg: ExtractionGrid
  /** The source terrain: skyline profiles keep it, as every profile does. */
  terrain: TerrainSource
  /** The roads the run counts (all of them by default). */
  include?: (road: SkidRoad) => boolean
  /** Also report the run without designed roads. */
  compare: boolean
  barriersStop: boolean
}

export interface CableRunResult {
  coverage: CableCoverageResult
  after: ExtractionResult
  /** Without designed roads; null without a comparison or a designed road. */
  before: ExtractionResult | null
}

export async function runCableCoverage(
  input: CableRunInput,
  screen: CoverScreen,
  control: { signal?: AbortSignal; onProgress?: (progress: SkidProgress) => void } = {},
): Promise<CableRunResult> {
  const { eg } = input
  const rule = eg.settings.cable
  const include = input.include ?? (() => true)
  const { signal, onProgress } = control
  const ground = await runCooperatively(cableGroundSteps(eg, input.terrain), control, 'Cable coverage cancelled.')
  const landings = cableLandings(eg, ground, include, rule.landingSpacingM)
  if (!landings.length)
    throw Error('No counted truck road lies within the travel band around the block, so no line can start.')
  const candidates = await runCooperatively(
    cableCandidateSteps(eg, ground, rule, landings, { barriersStop: input.barriersStop }),
    control,
    'Cable coverage cancelled.',
  )
  const { batches, index } = cableCoverBatches(rule, eg.sg.grid.cellM, candidates)
  const screened = batches.length
    ? await screen(
        batches,
        (share, lines) =>
          onProgress?.({ phase: 'Testing skylines', done: Math.round(share * lines), total: Math.max(1, lines) }),
        signal,
      )
    : []
  if (signal?.aborted) throw cancelled('Cable coverage cancelled.')
  const coverage = await runCooperatively(
    cableCoverageSteps(eg, rule, landings, candidates, screened, index),
    control,
    'Cable coverage cancelled.',
  )
  const after = cableExtractionResult(eg, include, coverage.after)
  const designed =
    landings.some((l) => l.designed) || eg.sg.roads.some((r) => include(r.road) && r.road.kind === 'design')
  const before =
    input.compare && designed
      ? cableExtractionResult(eg, (road) => include(road) && road.kind !== 'design', coverage.before)
      : null
  return { coverage, after, before }
}
