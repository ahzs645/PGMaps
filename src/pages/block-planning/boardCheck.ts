/**
 * Runs the patch calculation (`pg-2005-buffer-v1`, unchanged) on the plan's baseline alone at 2015
 * and 2018, the years of the Forest Practices Board's published distributions, and sets each class
 * beside the Board's figure. It tests the method and the inputs together: today's DataBC records of
 * past harvests and fires are not the inventories the 2015 and 2018 analyses used, and 2018 used the
 * revised 2017 guidance, so a difference is evidence to explain, never a verdict on either.
 *
 * DOM- and network-free.
 */
import { periodCalculator, type Period } from '../forest-patches/analysis'
import type { Footprint, Project } from '../forest-patches/project'
import { publishedUnit, type PublishedObservation, type PublishedUnit } from './observations'
import { baselineFootprintId, countingUnit, type Plan } from './plan'

export const BOARD_YEARS = [2015, 2018] as const
const YOUNG_WINDOW_YEARS = 20

export interface BoardYear {
  year: number
  published: PublishedObservation
  modelled: Period
  /** Modelled minus published, per class, in percentage points. Null where the model has no share. */
  difference: (number | null)[]
}

export interface BoardCheck {
  unit: PublishedUnit
  years: BoardYear[]
  /** The year the DataBC read started from: the check needs every disturbance from 1995 on. */
  baselineFrom: number | null
  /** Why the baseline may not cover the young forest of 2015, or null when it does. */
  coverageGap: string | null
  /** Largest absolute class difference over both years, in points. */
  largestDifference: number | null
}

function baselineProject(plan: Plan, year: number): Project {
  const features: Footprint[] = plan.baseline.map((d) => ({
    type: 'Feature',
    geometry: d.geometry,
    properties: {
      id: baselineFootprintId(d.id),
      scenario: 'reference',
      year: d.year,
      yearBasis: d.yearBasis,
      source: d.source,
    },
  }))
  return {
    format: 'pgmaps-patches-v1',
    type: 'FeatureCollection',
    district: plan.area.district,
    ndu: plan.area.ndu,
    source: plan.area.source.trim() || 'Inventory source not stated.',
    startYear: year,
    features,
    countWithin: countingUnit(plan),
  }
}

/** The check for the plan's unit, or null when the Board published nothing for it or the area is unset. */
export function boardCheck(plan: Plan): BoardCheck | null {
  const unit = publishedUnit(plan.area.district, plan.area.ndu)
  if (!unit || !plan.baseline.length) return null
  const years = unit.observations.map((published) => {
    const modelled = periodCalculator(
      baselineProject(plan, published.year),
      published.year,
      'proposed',
    )(published.year, 'proposed')
    return {
      year: published.year,
      published,
      modelled,
      difference: modelled.classes.map((c, i) => (c.percent === null ? null : c.percent - published.shares[i])),
    }
  })
  const baselineFrom = plan.area.baselineRead?.fromYear ?? null
  const needed = BOARD_YEARS[0] - YOUNG_WINDOW_YEARS
  const diffs = years.flatMap((y) => y.difference).filter((d): d is number => d !== null)
  return {
    unit,
    years,
    baselineFrom,
    coverageGap:
      baselineFrom === null
        ? `The baseline was not read from DataBC, so whether it holds every disturbance since ${needed} is not known.`
        : baselineFrom > needed
          ? `The baseline was read from ${baselineFrom}; 2015's young forest includes disturbances from ${needed}. Read it again from step 1.`
          : null,
    largestDifference: diffs.length ? Math.max(...diffs.map(Math.abs)) : null,
  }
}
