/**
 * How much of each proposed block's footprint the assessment station actually sees: the visible
 * net block. The November 2026 study of BC VIA sheets found the consultants draw only the visible,
 * net part of a block (1.6–16× smaller in pixels than the gross FTEN footprint), so this sits beside
 * X as a reading, not a figure in it. Read from the run's samples, which are spread evenly over the
 * footprint. No DOM or network access.
 */
import type { AnalysisResult } from './types'

export type VisibleNetBlock = {
  targetId: string
  name: string
  /** Share of the footprint's samples the station sees, percent. */
  visiblePercent: number
  /** Share in terrain the run could not read, percent. */
  unknownPercent: number
  grossHectares: number
  visibleHectares: number
}

export function visibleNetBlocks(
  result: Pick<AnalysisResult, 'targets' | 'assessmentStationIndex'>,
  names: Readonly<Record<string, string>> = {},
): VisibleNetBlock[] {
  return result.targets
    .filter((target) => target.role === 'block' && target.sampleCount > 0)
    .map((target) => {
      const row = result.assessmentStationIndex * target.sampleCount
      let seen = 0,
        unknown = 0
      for (let i = 0; i < target.sampleCount; i++) {
        const state = target.visibleByStation[row + i]
        if (state === 1) seen++
        else if (state === 2) unknown++
      }
      const share = seen / target.sampleCount
      return {
        targetId: target.targetId,
        name: names[target.targetId] ?? target.targetId,
        visiblePercent: share * 100,
        unknownPercent: (unknown / target.sampleCount) * 100,
        grossHectares: target.areaMeters / 10_000,
        visibleHectares: (target.areaMeters * share) / 10_000,
      }
    })
}
