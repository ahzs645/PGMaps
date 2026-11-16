/**
 * Where a section's cut and fill batters come from: the template's stated slope, or the ground
 * materials' (RoadEng's AUTO slope).
 *
 * RoadEng (Softree's help, template slopes and ground types): a template slope set to AUTO takes, in
 * cut, the cut slope of the ground type of the stratum layer it passes through, so the leg bends
 * where it crosses a layer boundary; in fill, the fill slope of the fill material assigned to the
 * station, and with none assigned, stratum layer 1's ground type. A slope that is not AUTO is the
 * template's whatever the ground.
 *
 * PGMaps' section (`assembledSection.ts`) already cuts each horizon at its material's batter and
 * fills at the required fill material's. `RoadTemplate.cutSlopeFrom` and its kin choose:
 *
 * - `material`: as RoadEng's AUTO. Cut: the horizon's material's batter, else the template's (a rock
 *   material without one takes the template's rock batter). Fill: the subgrade fill requirement's
 *   material, else the top horizon's material at the station (stratum layer 1), else the template's.
 * - `template`: the stated batter everywhere; a rock horizon still takes the rock batter.
 * - omitted: the batter rule before this choice existed (a horizon's material batter in cut, the fill
 *   requirement's in fill), so every existing template builds the same section.
 *
 * Pure: no DOM or network access.
 */
import type { BatterSource, RoadTemplate } from './types'

type Side = 'left' | 'right'

/** The batter source on one side: the side's own value, else the template's. */
export function batterSource(t: RoadTemplate, side: Side, which: 'cut' | 'fill'): BatterSource | undefined {
  return which === 'cut' ? (t[`${side}CutSlopeFrom`] ?? t.cutSlopeFrom) : (t[`${side}FillSlopeFrom`] ?? t.fillSlopeFrom)
}

export const BATTER_SOURCE_KEYS = [
  'cutSlopeFrom',
  'fillSlopeFrom',
  'leftCutSlopeFrom',
  'rightCutSlopeFrom',
  'leftFillSlopeFrom',
  'rightFillSlopeFrom',
] as const

/** Reads one batter source from a project file; throws on anything else. */
export function parseBatterSource(value: unknown, label: string): BatterSource {
  if (value !== 'material' && value !== 'template') throw Error(`${label} must be material or template.`)
  return value
}

/**
 * Sets one side's batter source on a template, writing the base value when both sides agree so a
 * symmetric template stays symmetric. `undefined` returns the side to the omitted rule.
 */
export function withBatterSource(
  t: RoadTemplate,
  side: Side,
  which: 'cut' | 'fill',
  value: BatterSource | undefined,
): RoadTemplate {
  const Kind = which === 'cut' ? 'Cut' : 'Fill'
  const other: Side = side === 'left' ? 'right' : 'left'
  const next: RoadTemplate = { ...t }
  const otherValue = batterSource(t, other, which)
  delete next[`left${Kind}SlopeFrom`]
  delete next[`right${Kind}SlopeFrom`]
  delete next[`${which}SlopeFrom`]
  if (value === otherValue) {
    if (value !== undefined) next[`${which}SlopeFrom`] = value
    return next
  }
  if (value !== undefined) next[`${side}${Kind}SlopeFrom`] = value
  if (otherValue !== undefined) next[`${other}${Kind}SlopeFrom`] = otherValue
  return next
}

/** Words for a source, for labels and notes. */
export function batterSourceLabel(value: BatterSource | undefined, which: 'cut' | 'fill'): string {
  if (value === 'material') return which === 'cut' ? 'ground material (bends at horizons)' : 'fill material'
  if (value === 'template') return 'this slope'
  return which === 'cut' ? 'a material’s own, else this slope' : 'the fill requirement’s, else this slope'
}
