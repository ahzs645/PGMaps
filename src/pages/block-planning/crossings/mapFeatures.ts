/**
 * The plan map's crossings for one schedule: each listed crossing with a place, coloured by its own
 * standing (`standing.ts`), and each crossing read for a block's current footprint but not added,
 * drawn dimmed as a candidate. Derived every time from the plan, never stored.
 *
 * DOM- and network-free.
 */
import type { Feature, FeatureCollection, Point } from 'geojson'
import type { Pack } from '../../../../packages/legal-rules/src/contract'
import type { Plan } from '../plan'
import { candidateState, crossingReadCurrent } from './candidates'
import { CROSSING_ORIGIN_LABELS } from './record'
import { assessCrossing, CROSSING_STANDING_WORDS, type CrossingStanding } from './standing'

export interface CrossingMapProperties {
  id: string
  label: string
  block: string
  /** A standing, or `candidate` for a crossing read and not added. */
  state: CrossingStanding | 'candidate'
  detail: string
}

export function crossingMapFeatures(
  plan: Plan,
  schedule: string,
  library: Pack[],
): FeatureCollection<Point, CrossingMapProperties> {
  const features: Feature<Point, CrossingMapProperties>[] = []
  const name = (block: string) => plan.blocks.find((b) => b.id === block)?.name ?? block
  for (const record of plan.crossings ?? []) {
    if (record.schedule !== schedule || !record.at?.point) continue
    const assessed = assessCrossing(plan, record, library)
    features.push({
      type: 'Feature',
      id: `crossing:${record.key}`,
      geometry: { type: 'Point', coordinates: record.at.point },
      properties: {
        id: `crossing:${record.key}`,
        label: record.label,
        block: record.block,
        state: assessed.standing,
        detail: `${name(record.block)} · ${CROSSING_STANDING_WORDS[assessed.standing]}${assessed.current ? '' : ' · shape changed'}`,
      },
    })
  }
  const seen = new Set<string>()
  for (const read of plan.crossingReads ?? []) {
    if (read.schedule !== schedule || !crossingReadCurrent(plan, read)) continue
    const records = (plan.crossings ?? []).filter((c) => c.block === read.block && c.schedule === schedule)
    for (const c of read.candidates) {
      const key = `${read.block}:${c.point[0]},${c.point[1]}`
      if (seen.has(key) || candidateState(records, c).state === 'added') continue
      seen.add(key)
      features.push({
        type: 'Feature',
        id: `candidate:${read.block}:${read.source}:${c.id}`,
        geometry: { type: 'Point', coordinates: c.point },
        properties: {
          id: `candidate:${read.block}:${read.source}:${c.id}`,
          label: c.label,
          block: read.block,
          state: 'candidate',
          detail: `${name(read.block)} · ${CROSSING_ORIGIN_LABELS[c.origin]}, read ${read.readOn} and not added`,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}
