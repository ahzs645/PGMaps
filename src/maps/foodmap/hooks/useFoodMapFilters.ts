import { useMemo } from 'react'
import {
  numberCodec,
  stringArrayCodec,
  stringCodec,
  stringUnionCodec,
  useUrlState,
  type UrlCodec,
} from '@/hooks/useUrlState'
import type { HazardRating, VisualizationMode, ViolationTimelineMode } from '../types'

export const HAZARD_RATING_OPTIONS: readonly HazardRating[] = ['Low', 'Moderate', 'Unknown']

export const FACILITY_TYPE_OPTIONS: readonly string[] = [
  'Restaurant', 'Food Truck', 'Camp', 'Catering', 'Concession', 'Stand',
  'Bakery', 'Coffee Shop', 'Bar/Pub', 'Brewery/Winery', 'Deli',
  'Community Kitchen', 'Social Services', 'Gas Station', 'Hotel',
  'Recreation', 'Farm', 'Institutional Kitchen', 'Store', 'Other', 'Unknown',
]

/**
 * stringArrayCodec cannot round-trip an empty selection: it encodes to '',
 * which useUrlState treats as "remove the param", and an absent param decodes
 * back to the defaults. Encode the empty selection as a 'none' sentinel so
 * deselect-all survives a reload/share.
 */
function emptyAwareArrayCodec<T extends string>(allowed: readonly T[], defaults: readonly T[]): UrlCodec<T[]> {
  const base = stringArrayCodec(allowed, defaults)
  return {
    encode: (value) => (value.length === 0 ? 'none' : base.encode(value)),
    decode: (raw) => (raw === 'none' ? [] : base.decode(raw)),
  }
}

const VISUALIZATION_MODES: readonly VisualizationMode[] = ['violations', 'hazard']
const VIOLATION_TIMELINE_MODES: readonly ViolationTimelineMode[] = ['period', 'cumulative']

// Codecs must stay module-level so useUrlState's decoded values are stable.
const hazardCodec = emptyAwareArrayCodec(HAZARD_RATING_OPTIONS, HAZARD_RATING_OPTIONS)
const facilityCodec = emptyAwareArrayCodec(FACILITY_TYPE_OPTIONS, FACILITY_TYPE_OPTIONS)
const searchCodec = stringCodec('')
const modeCodec = stringUnionCodec(VISUALIZATION_MODES, 'violations')
const monthsCodec = numberCodec(12)
const timelineModeCodec = stringUnionCodec(VIOLATION_TIMELINE_MODES, 'period')

export interface FoodMapFilters {
  hazardRatings: HazardRating[]
  facilityTypes: string[]
  searchQuery: string
  visualizationMode: VisualizationMode
  timelineMonths: number
  violationTimelineMode: ViolationTimelineMode
}

export interface FoodMapFilterActions {
  setHazardRatings: (ratings: HazardRating[]) => void
  setFacilityTypes: (types: string[]) => void
  setSearchQuery: (query: string) => void
  setVisualizationMode: (mode: VisualizationMode) => void
  setTimelineMonths: (months: number) => void
  setViolationTimelineMode: (mode: ViolationTimelineMode) => void
}

/**
 * Food map filter state, persisted to URL search params so filtered views are
 * shareable. Defaults produce a clean URL (params are only set when a value
 * differs from its default).
 */
export function useFoodMapFilters(): { filters: FoodMapFilters; actions: FoodMapFilterActions } {
  const [hazardRatings, setHazardRatings] = useUrlState('hazard', hazardCodec)
  const [facilityTypes, setFacilityTypes] = useUrlState('facility', facilityCodec)
  const [searchQuery, setSearchQuery] = useUrlState('q', searchCodec)
  const [visualizationMode, setVisualizationMode] = useUrlState('mode', modeCodec)
  const [timelineMonths, setTimelineMonths] = useUrlState('months', monthsCodec)
  const [violationTimelineMode, setViolationTimelineMode] = useUrlState('violationTimeline', timelineModeCodec)

  const filters = useMemo<FoodMapFilters>(
    () => ({
      hazardRatings,
      facilityTypes,
      searchQuery,
      visualizationMode,
      timelineMonths,
      violationTimelineMode,
    }),
    [hazardRatings, facilityTypes, searchQuery, visualizationMode, timelineMonths, violationTimelineMode],
  )

  const actions = useMemo<FoodMapFilterActions>(
    () => ({
      setHazardRatings,
      setFacilityTypes,
      setSearchQuery,
      setVisualizationMode,
      setTimelineMonths,
      setViolationTimelineMode,
    }),
    [setHazardRatings, setFacilityTypes, setSearchQuery, setVisualizationMode, setTimelineMonths, setViolationTimelineMode],
  )

  return { filters, actions }
}
