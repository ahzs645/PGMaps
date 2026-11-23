/**
 * The Forest Practices Board's published young-forest patch distributions for 2015 and 2018
 * (investigation FPB/IRC/235, Appendix 4), for the plan's reporting unit. They are shown beside
 * the projection as the record of what was measured, never joined to it into one line: the two
 * years used different methods and inventories, and the projection uses this plan's baseline.
 *
 * DOM- and network-free.
 */
import board from '../../../packages/legal-rules/observations/fpb-irc-235.json'
import { movementTowardTarget, table } from '../forest-patches/project'

export const OBSERVATION_METHODS: Record<2015 | 2018, string> = {
  2015: 'December 2005 implementation policy',
  2018: 'Interim analysis on the revised 2017 guidance',
}

export interface PublishedObservation {
  year: 2015 | 2018
  /** Shares of young forest by Table 7 class, in the order's class order. */
  shares: number[]
  method: string
}

export interface PublishedUnit {
  district: string
  ndu: string
  target: number[]
  observations: PublishedObservation[]
  /** Change in distance to target from 2015 to 2018, per class (positive: closer). Null without both years. */
  movement: (number | null)[] | null
  source: { url: string; label: string }
}

/** The Board's figures for one district and sub-unit, or null where it published none. */
export function publishedUnit(district: string, ndu: string): PublishedUnit | null {
  if (board.youngForest.classOrder.join() !== table.bins.join())
    throw Error('The Board’s class order differs from the order’s.')
  const row = board.youngForest.distributions.find((d) => d.district === district && d.ndu === ndu)
  if (!row || (!row.observed2015 && !row.observed2018)) return null
  const observations: PublishedObservation[] = []
  if (row.observed2015) observations.push({ year: 2015, shares: row.observed2015, method: OBSERVATION_METHODS[2015] })
  if (row.observed2018) observations.push({ year: 2018, shares: row.observed2018, method: OBSERVATION_METHODS[2018] })
  return {
    district,
    ndu,
    target: row.target,
    observations,
    movement:
      row.observed2015 && row.observed2018
        ? row.target.map((t, i) => movementTowardTarget(row.observed2015![i], row.observed2018![i], t))
        : null,
    source: {
      url: board.source,
      label: `Forest Practices Board, FPB/IRC/235, Appendix ${board.youngForest.appendix}, p. ${board.youngForest.page}`,
    },
  }
}
