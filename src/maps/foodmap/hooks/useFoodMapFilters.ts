import { useMemo } from 'react'
import {
  numberCodec,
  stringArrayCodec,
  stringCodec,
  stringUnionCodec,
  useSetUrlParams,
  useUrlState,
} from '@/hooks/useUrlState'
import type { HazardRating, MarkerStyle, VisualizationMode, ViolationTimelineMode } from '../types'

export const HAZARD_RATING_OPTIONS: readonly HazardRating[] = ['Low', 'Moderate', 'Unknown']

export const FACILITY_TYPE_OPTIONS: readonly string[] = [
  'Restaurant',
  'Food Truck',
  'Camp',
  'Catering',
  'Concession',
  'Stand',
  'Bakery',
  'Coffee Shop',
  'Bar/Pub',
  'Brewery/Winery',
  'Deli',
  'Community Kitchen',
  'Social Services',
  'Gas Station',
  'Hotel',
  'Recreation',
  'Farm',
  'Institutional Kitchen',
  'Store',
  'Other',
  'Unknown',
]

const VISUALIZATION_MODES: readonly VisualizationMode[] = ['violations', 'hazard']
export const MARKER_STYLE_OPTIONS: readonly { value: MarkerStyle; label: string }[] = [
  { value: 'classic', label: 'Classic dots' },
  { value: 'rings', label: 'Outlined rings' },
  { value: 'glow', label: 'Severity glow' },
  { value: 'badges', label: 'Count badges' },
  { value: 'heat', label: 'Heatmap reveal' },
  { value: 'cluster', label: 'Cluster reveal' },
]
const VIOLATION_TIMELINE_MODES: readonly ViolationTimelineMode[] = ['period', 'cumulative']

// Codecs must stay module-level so useUrlState's decoded values are stable.
const hazardCodec = stringArrayCodec(HAZARD_RATING_OPTIONS, HAZARD_RATING_OPTIONS)
const facilityCodec = stringArrayCodec(FACILITY_TYPE_OPTIONS, FACILITY_TYPE_OPTIONS)
const searchCodec = stringCodec('')
const modeCodec = stringUnionCodec(VISUALIZATION_MODES, 'violations')
const markerStyleCodec = stringUnionCodec(
  MARKER_STYLE_OPTIONS.map((opt) => opt.value),
  'cluster',
)
const monthsCodec = numberCodec(12)
const timelineModeCodec = stringUnionCodec(VIOLATION_TIMELINE_MODES, 'period')

export interface FoodMapFilters {
  hazardRatings: HazardRating[]
  facilityTypes: string[]
  searchQuery: string
  visualizationMode: VisualizationMode
  markerStyle: MarkerStyle
  timelineMonths: number
  violationTimelineMode: ViolationTimelineMode
}

export interface FoodMapFilterActions {
  setHazardRatings: (ratings: HazardRating[]) => void
  setFacilityTypes: (types: string[]) => void
  setSearchQuery: (query: string) => void
  setVisualizationMode: (mode: VisualizationMode) => void
  setMarkerStyle: (style: MarkerStyle) => void
  setTimelineMonths: (months: number) => void
  setViolationTimelineMode: (mode: ViolationTimelineMode) => void
  applyFilters: (filters: Partial<FoodMapFilters>) => void
}

/**
 * Food map filter state, persisted to URL search params so filtered views are
 * shareable. Defaults produce a clean URL (params are only set when a value
 * differs from its default).
 */
export function useFoodMapFilters(): { filters: FoodMapFilters; actions: FoodMapFilterActions } {
  const setUrlParams = useSetUrlParams()
  const [hazardRatings, setHazardRatings] = useUrlState('hazard', hazardCodec)
  const [facilityTypes, setFacilityTypes] = useUrlState('facility', facilityCodec)
  const [searchQuery, setSearchQuery] = useUrlState('q', searchCodec)
  const [visualizationMode, setVisualizationMode] = useUrlState('mode', modeCodec)
  const [markerStyle, setMarkerStyle] = useUrlState('dots', markerStyleCodec)
  const [timelineMonths, setTimelineMonths] = useUrlState('months', monthsCodec)
  const [violationTimelineMode, setViolationTimelineMode] = useUrlState('violationTimeline', timelineModeCodec)

  const filters = useMemo<FoodMapFilters>(
    () => ({
      hazardRatings,
      facilityTypes,
      searchQuery,
      visualizationMode,
      markerStyle,
      timelineMonths,
      violationTimelineMode,
    }),
    [hazardRatings, facilityTypes, searchQuery, visualizationMode, markerStyle, timelineMonths, violationTimelineMode],
  )

  const actions = useMemo<FoodMapFilterActions>(() => {
    const applyFilters = (patch: Partial<FoodMapFilters>) => {
      const updates: Record<string, string | null> = {}
      if (patch.hazardRatings !== undefined) updates.hazard = hazardCodec.encode(patch.hazardRatings)
      if (patch.facilityTypes !== undefined) updates.facility = facilityCodec.encode(patch.facilityTypes)
      if (patch.searchQuery !== undefined) updates.q = searchCodec.encode(patch.searchQuery)
      if (patch.visualizationMode !== undefined) updates.mode = modeCodec.encode(patch.visualizationMode)
      if (patch.markerStyle !== undefined) updates.dots = markerStyleCodec.encode(patch.markerStyle)
      if (patch.timelineMonths !== undefined) updates.months = monthsCodec.encode(patch.timelineMonths)
      if (patch.violationTimelineMode !== undefined) {
        updates.violationTimeline = timelineModeCodec.encode(patch.violationTimelineMode)
      }
      setUrlParams(updates)
    }

    return {
      setHazardRatings,
      setFacilityTypes,
      setSearchQuery,
      setVisualizationMode,
      setMarkerStyle,
      setTimelineMonths,
      setViolationTimelineMode,
      applyFilters,
    }
  }, [
    setFacilityTypes,
    setHazardRatings,
    setMarkerStyle,
    setSearchQuery,
    setTimelineMonths,
    setUrlParams,
    setViolationTimelineMode,
    setVisualizationMode,
  ])

  return { filters, actions }
}
