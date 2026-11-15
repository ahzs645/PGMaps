/**
 * The high case the slope sheet points to: a copy of the road with the stretches the sheet shows
 * steeper (`SlopeSheetCheck.stretches`) cut fully into the hill (`fullBenchProfile`), so the fill
 * the flatter terrain allowed there becomes cut, and the surplus is end haul where the road has haul
 * rates. The copy is for pricing beside the estimate only; nothing is applied to the road.
 *
 * It is measured on the estimate's own terrain: where the ground is really as steep as the sheet
 * shows, the bench would go deeper still, so this is a floor under the steep-ground case, not its
 * ceiling. The downhill side of each stretch is the side whose ground stands lower beyond the
 * formation at most of its stations. No DOM.
 */
import { fullBenchProfile, type BenchStretch } from './fullBench'
import { sectionSampleAt } from './sectionGeometry'
import type { SlopeSheetInterval } from './slopeSheetCheck'
import type { Alignment, RoadStation } from './types'

/** How far past the formation edge the two sides' ground is compared. */
const SIDE_PROBE_M = 4

type Station = Pick<RoadStation, 'chainage' | 'designElevation' | 'section' | 'leftWidth' | 'rightWidth'>

/** The side whose ground falls away over the stretch, or null when no station says. */
export function downhillSide(stations: readonly Station[], from: number, to: number): 'left' | 'right' | null {
  let left = 0,
    right = 0
  for (const station of stations) {
    if (station.chainage < from - 1e-6 || station.chainage > to + 1e-6) continue
    const l = sectionSampleAt(station as RoadStation, -(station.leftWidth + SIDE_PROBE_M)).ground,
      r = sectionSampleAt(station as RoadStation, station.rightWidth + SIDE_PROBE_M).ground
    if (l === null || r === null || l === r) continue
    if (l < r) left++
    else right++
  }
  return left || right ? (left >= right ? 'left' : 'right') : null
}

export interface SlopeSheetCase {
  alignment: Alignment
  /** What the case changed, in a line. */
  change: string
  benchedLengthM: number
}

/** The road with the sheet's steeper stretches full-benched, or the reason there is none. */
export function slopeSheetCase(
  alignment: Alignment,
  stations: readonly Station[],
  stretches: readonly Pick<SlopeSheetInterval, 'from' | 'to'>[],
  newId: () => string,
): SlopeSheetCase | { error: string } {
  if (!stretches.length) return { error: 'The slope sheet shows no stretch steeper than the terrain.' }
  const benches: BenchStretch[] = stretches.flatMap((stretch) => {
    const side = downhillSide(stations, stretch.from, stretch.to)
    return side ? [{ side, rangeFrom: stretch.from, rangeTo: stretch.to }] : []
  })
  if (!benches.length) return { error: 'No downhill side could be read on the sheet’s steeper stretches.' }
  const plan = fullBenchProfile(alignment, stations, benches, newId)
  if ('error' in plan) return plan
  return {
    alignment: { ...alignment, vertical: plan.vertical },
    change: `Full bench on ${benches.length} stretch${benches.length === 1 ? '' : 'es'} the slope sheet shows steeper (${Math.round(plan.loweredLengthM)} m), up to ${plan.maxLoweringM.toFixed(1)} m lower`,
    benchedLengthM: plan.loweredLengthM,
  }
}
