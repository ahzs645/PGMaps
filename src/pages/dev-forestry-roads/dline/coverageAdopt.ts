/**
 * A suggested skyline from Design → Extraction reach → Cable yarder as a D-line: its yarder and
 * tail as the D-line's ends, the yarder's rigging, and the coverage screen's supports as the D-line's
 * saved layout, so **Check saved layout** can test it and the user can refine it. The coverage
 * screen measures stations on its own metric grid; they are scaled to the D-line's great-circle
 * length so the far support lands on the far end. Pure: no DOM or network access.
 */
import type { CableLineRecord } from '../cableCoverage'
import { anchorDistanceM, SUPPORT_CLEARANCE_ZONE_M, type CableCoverageRule } from '../cableCoverageRule'
import { DEFAULT_SUPPORT_LAYOUT, SUPPORT_LAYOUT_LIMITS, type CableSupportLayout } from '../cableLayout/settings'
import { distance } from '../engine'
import type { CableLine, Coordinate } from '../types'

const clampTo = (value: number, [low, high]: readonly [number, number]) => Math.max(low, Math.min(high, value))

/** The suggested line as a new D-line. `toLonLat` is the coverage grid's; `id` names the copy. */
export function cableLineFromCoverage(
  record: CableLineRecord,
  rule: CableCoverageRule,
  toLonLat: (xy: [number, number]) => Coordinate,
  id: string,
  name = `Suggested line ${record.id}`,
): CableLine {
  if (record.points.length < 2) throw Error('The suggested line has no tail.')
  const yarder = toLonLat(record.points[0].xy)
  const tail = toLonLat(record.points.at(-1)!.xy)
  const lengthM = distance(yarder, tail)
  const lastStation = record.points.at(-1)!.stationM
  if (!(lengthM > 0) || !(lastStation > 0)) throw Error('The suggested line has no length.')
  const scale = lengthM / lastStation
  const supports = record.points.map((p, i) => ({
    stationM: i === 0 ? 0 : i === record.points.length - 1 ? lengthM : p.stationM * scale,
    heightM: Math.max(0, Math.min(100, p.heightM)),
  }))
  const heights = record.points.slice(1, -1).map((p) => p.heightM)
  const supportLayout: CableSupportLayout = {
    ...DEFAULT_SUPPORT_LAYOUT,
    startKind: 'yarder',
    endKind: 'support',
    cableSystem: rule.system,
    // The search range keeps the coverage screen's support heights, so Find supports can reproduce them.
    minSupportHeightM: clampTo(
      Math.min(DEFAULT_SUPPORT_LAYOUT.minSupportHeightM, ...heights),
      SUPPORT_LAYOUT_LIMITS.minSupportHeightM,
    ),
    maxSupportHeightM: clampTo(
      Math.max(DEFAULT_SUPPORT_LAYOUT.maxSupportHeightM, rule.supportHeightM, ...heights),
      SUPPORT_LAYOUT_LIMITS.maxSupportHeightM,
    ),
    minSupportSpacingM: clampTo(rule.minSupportSpacingM, SUPPORT_LAYOUT_LIMITS.minSupportSpacingM),
    maxLoadedDeg: clampTo(rule.maxBreakDeg, SUPPORT_LAYOUT_LIMITS.maxLoadedDeg),
    clearanceFromStartM: SUPPORT_CLEARANCE_ZONE_M,
    clearanceBeforeEndM: SUPPORT_CLEARANCE_ZONE_M,
    anchorDistanceM: clampTo(anchorDistanceM(rule), SUPPORT_LAYOUT_LIMITS.anchorDistanceM),
    saved: { preTensionKN: record.preTensionKN, complete: true, supports },
  }
  return {
    id,
    name,
    start: yarder,
    end: tail,
    startHeight: clampTo(record.points[0].heightM, [0, 100]),
    endHeight: clampTo(record.points.at(-1)!.heightM, [0, 100]),
    deflectionPercent: 5,
    yarderAt: 'start',
    sagModel: 'mechanics',
    rigging: { ...rule.rigging },
    supportLayout,
  }
}
