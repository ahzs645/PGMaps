import { useCallback, useEffect, useMemo, useState } from 'react'
import { PawPrint } from 'lucide-react'
import { MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { MapFillLayer, MapHeatmapLayer, MapPieClusterLayer } from '@/components/ui/map-layers'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { InlineAlert, LegendItem, MapGradientLegendItem, MapLegendNote, MapSizeLegend, SelectedItemCard, SidebarSection, StatGrid, ToggleChip } from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import type { TimelineWindowOption } from '@/components/ui/timeline'
import { cn } from '@/lib/utils'
import { formatDate, useJsonManifest } from './shared'
import {
  formatWinterRangeHectares,
  getWinterRangeBounds,
  isInsideFootprint,
  isWithinFootprintExtent,
  useWarsWinterRange,
  winterRangeTooltipHtml,
} from './warsWinterRange'

export const WARS_TIMELINE_WINDOW_OPTIONS: TimelineWindowOption[] = [
  { value: 1, label: '1 yr' },
  { value: 2, label: '2 yr' },
  { value: 5, label: '5 yr' },
  { value: -1, label: 'Cumul.' },
]

interface WarsSpeciesSummary {
  name: string
  count: number
}

interface WarsYearSummary {
  year: number
  count: number
}

export interface WarsManifest {
  source: string
  sourcePage: string
  sourceLicense: string
  sourceCitation: string
  coverage: string
  serviceAreas: number[]
  generatedAt: string
  csv: string
  geojson: string
  rows: number
  totalQuantity: number
  yearStart: number | null
  yearEnd: number | null
  species: WarsSpeciesSummary[]
  years: WarsYearSummary[]
  fields: string[]
}

interface WarsCrashProperties {
  id: string
  accidentDate: string
  year: number
  timeOfKill: string
  nearestTown: string
  species: string
  sex: string
  age: string
  quantity: number
  serviceArea: number
  dataSet: string
  sourceFile: string
}

type WarsFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point, WarsCrashProperties>

const ALL_SPECIES = 'all'
const ALL_YEARS = 'all'
const RECENT_YEARS = 'recent'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

// ~1 km bins at Prince George's latitude, used to find recurrent-strike sites.
const HOTSPOT_LAT_BIN = 0.009
const HOTSPOT_LON_BIN = 0.0153
const HOTSPOT_MIN_YEARS = 3

// How many recurrent sites the sidebar ranking lists before it stops.
const HOTSPOT_LIST_LIMIT = 12

interface WarsHotspotCell {
  key: string
  longitude: number
  latitude: number
  recordCount: number
  yearCount: number
  firstYear: number | null
  lastYear: number | null
  nearestTown: string
  topSpecies: string
}

function getHotspotColor(yearCount: number): string {
  if (yearCount >= 10) return '#dc2626'
  if (yearCount >= 5) return '#ea580c'
  return '#f59e0b'
}

function getHotspotSize(yearCount: number): number {
  return 18 + Math.min(yearCount, 20) * 1.2
}

const SPECIES_COLORS: Record<string, string> = {
  Moose: '#92400e',
  Deer: '#d97706',
  Bear: '#171717',
  Elk: '#dc2626',
  Porcupine: '#525252',
  Coyote: '#facc15',
  Fox: '#ea580c',
  Wolf: '#1d4ed8',
  Beaver: '#15803d',
  Caribou: '#0d9488',
  Buffalo: '#7c2d12',
  Lynx: '#9333ea',
  Unknown: '#94a3b8',
}

const SPECIES_FALLBACK_COLORS = ['#0891b2', '#65a30d', '#db2777', '#0369a1', '#ca8a04', '#be185d', '#4338ca', '#059669']

function hashSpeciesName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return Math.abs(hash)
}

function getSpeciesColor(species: string): string {
  if (SPECIES_COLORS[species]) return SPECIES_COLORS[species]
  return SPECIES_FALLBACK_COLORS[hashSpeciesName(species) % SPECIES_FALLBACK_COLORS.length]
}

function getWarsMarkerSize(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 1) return 8
  return Math.max(8, Math.min(24, 7 + Math.sqrt(quantity) * 6))
}

function getWarsFeatureKey(feature: GeoJSON.Feature<GeoJSON.Point, WarsCrashProperties>, index: number): string {
  return `${feature.properties.sourceFile}-${feature.properties.id}-${feature.properties.accidentDate}-${index}`
}

function parseAccidentDate(properties: WarsCrashProperties): Date | null {
  if (properties.accidentDate) {
    const parsed = new Date(properties.accidentDate)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  if (Number.isFinite(properties.year) && properties.year > 0) {
    return new Date(properties.year, 0, 1)
  }
  return null
}

/**
 * Month (0-11) read from the ISO date string. Parsing via `new Date()` and
 * `getMonth()` would shift first-of-month records into the previous month in
 * timezones west of UTC, so the string is the source of truth.
 */
function getAccidentMonth(properties: WarsCrashProperties): number | null {
  const match = /^\d{4}-(\d{2})/.exec(properties.accidentDate ?? '')
  if (!match) return null
  const month = Number(match[1]) - 1
  return month >= 0 && month <= 11 ? month : null
}

/** Placeholders the source spreadsheets use where no town was recorded. */
const UNKNOWN_TOWN_VALUES = new Set(['', 'NA', 'N A', 'NONE', 'UNKNOWN'])

/**
 * The five WARS spreadsheets spell towns inconsistently ("FT ST JOHN",
 * "FORT ST JOHN", "Fort St. John"), which would otherwise split one site's
 * records across several labels. Normalising to a single title-cased form keeps
 * the recurrent-site ranking readable.
 */
function normaliseTownName(rawTown: string | null | undefined): string {
  const cleaned = String(rawTown ?? '')
    .toUpperCase()
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (UNKNOWN_TOWN_VALUES.has(cleaned)) return ''
  return cleaned
    .split(' ')
    .map((word) => (word === 'FT' ? 'FORT' : word))
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
}

/** Highest-count key in a tally, ties broken alphabetically for stable output. */
function pickTopEntry(counts: Map<string, number>): string | null {
  let bestKey: string | null = null
  let bestCount = -1
  for (const [key, count] of counts) {
    if (count > bestCount || (count === bestCount && bestKey != null && key < bestKey)) {
      bestKey = key
      bestCount = count
    }
  }
  return bestKey
}

export function useWarsData(
  active: boolean,
  initialSpecies: string | null,
  initialShowPoints: string | null = null,
  initialShowHeatmap: string | null = null,
  initialShowHotspots: string | null = null,
  initialShowWinterRange: string | null = null,
) {
  const [selectedSpecies, setSelectedSpeciesState] = useState<string>(initialSpecies || ALL_SPECIES)
  const [hiddenSpecies, setHiddenSpecies] = useState<string[]>([])
  const [showPoints, setShowPoints] = useState<boolean>(initialShowPoints !== '0')
  const [showHeatmap, setShowHeatmap] = useState<boolean>(initialShowHeatmap === '1')
  const [showHotspots, setShowHotspots] = useState<boolean>(initialShowHotspots === '1')
  const [showWinterRange, setShowWinterRangeState] = useState<boolean>(initialShowWinterRange === '1')
  const [selectedWinterRangeId, setSelectedWinterRangeId] = useState<string | null>(null)
  const [focusTarget, setFocusTarget] = useState<{ longitude: number; latitude: number; key: string } | null>(null)
  const [selectedMonths, setSelectedMonths] = useState<number[]>([])
  const [yearMode, setYearModeState] = useState<string>(ALL_YEARS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [timelineWindowSize, setTimelineWindowSize] = useState(1)
  const manifest = useJsonManifest<WarsManifest>(active ? '/data/wars/manifest.json' : null)
  const crashes = useJsonManifest<WarsFeatureCollection>(active && manifest.data ? manifest.data.geojson : null)
  const features = useMemo(() => crashes.data?.features ?? [], [crashes.data])
  // Changing the species or year filter invalidates the current selection, so
  // the setters clear it together instead of an effect doing it a render late.
  const setSelectedSpecies = useCallback((species: string) => {
    setSelectedSpeciesState(species)
    setSelectedId(null)
  }, [])
  const setYearMode = useCallback((mode: string) => {
    setYearModeState(mode)
    setSelectedId(null)
  }, [])
  // Hiding the layer has to drop its selection too, or re-enabling it would
  // restore a highlight for a polygon the user can no longer see.
  const setShowWinterRange = useCallback((next: boolean) => {
    setShowWinterRangeState(next)
    if (!next) setSelectedWinterRangeId(null)
  }, [])
  const toggleMonth = useCallback((month: number) => {
    setSelectedMonths((current) => (
      current.includes(month) ? current.filter((item) => item !== month) : [...current, month]
    ))
    setSelectedId(null)
  }, [])
  const clearMonths = useCallback(() => {
    setSelectedMonths([])
    setSelectedId(null)
  }, [])
  const yearEnd = manifest.data?.yearEnd ?? null
  const recentYearStart = yearEnd == null ? null : yearEnd - 9

  const speciesFilteredFeatures = useMemo(() => (
    features.filter((feature) => {
      const species = feature.properties.species || 'Unknown'
      if (hiddenSpecies.includes(species)) return false
      return selectedSpecies === ALL_SPECIES || species === selectedSpecies
    })
  ), [features, hiddenSpecies, selectedSpecies])

  const baseFilteredFeatures = useMemo(() => {
    if (yearMode !== RECENT_YEARS || recentYearStart == null) return speciesFilteredFeatures
    return speciesFilteredFeatures.filter((feature) => feature.properties.year >= recentYearStart)
  }, [speciesFilteredFeatures, recentYearStart, yearMode])

  const accidentDateRange = useMemo(() => {
    if (features.length === 0) {
      const now = new Date()
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
    }
    let min: Date | null = null
    let max: Date | null = null
    for (const feature of features) {
      const date = parseAccidentDate(feature.properties)
      if (!date) continue
      if (!min || date < min) min = date
      if (!max || date > max) max = date
    }
    if (!min || !max) {
      const now = new Date()
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
    }
    return { start: min, end: max }
  }, [features])

  // The scrub defaults to the most recent accident year until the user picks
  // one explicitly; deriving it avoids a state write when the timeline opens.
  const effectiveTimelineDate = useMemo(() => {
    if (timelineDate) return timelineDate
    return features.length > 0 ? new Date(accidentDateRange.end.getFullYear(), 0, 1) : null
  }, [timelineDate, features.length, accidentDateRange.end])

  const timelineFilterRange = useMemo(() => {
    if (!timelineEnabled || !effectiveTimelineDate) return null
    const timelineDate = effectiveTimelineDate
    const isCumulative = timelineWindowSize === -1
    const startYear = isCumulative ? accidentDateRange.start.getFullYear() : timelineDate.getFullYear()
    const endYear = isCumulative ? timelineDate.getFullYear() : timelineDate.getFullYear() + timelineWindowSize - 1
    return {
      start: new Date(startYear, 0, 1).getTime(),
      end: new Date(endYear, 11, 31, 23, 59, 59, 999).getTime(),
    }
  }, [timelineEnabled, effectiveTimelineDate, timelineWindowSize, accidentDateRange.start])

  // Timeline-filtered but month-agnostic, so the monthly chart keeps showing
  // the full seasonal distribution while a month filter is active.
  const timelineFilteredFeatures = useMemo(() => {
    if (!timelineFilterRange) return baseFilteredFeatures
    const { start, end } = timelineFilterRange
    return baseFilteredFeatures.filter((feature) => {
      const date = parseAccidentDate(feature.properties)
      if (!date) return false
      const t = date.getTime()
      return t >= start && t <= end
    })
  }, [baseFilteredFeatures, timelineFilterRange])

  const filteredFeatures = useMemo(() => {
    if (selectedMonths.length === 0) return timelineFilteredFeatures
    return timelineFilteredFeatures.filter((feature) => {
      const month = getAccidentMonth(feature.properties)
      return month != null && selectedMonths.includes(month)
    })
  }, [timelineFilteredFeatures, selectedMonths])

  const monthlyBreakdown = useMemo(() => {
    const counts = new Array<number>(12).fill(0)
    for (const feature of timelineFilteredFeatures) {
      const month = getAccidentMonth(feature.properties)
      if (month != null) counts[month] += 1
    }
    return counts
  }, [timelineFilteredFeatures])

  // Species- and month-filtered but deliberately year-agnostic: the annual
  // series stays whole while a year window is active, so the chart shows where
  // the current selection sits in the record rather than collapsing to it.
  const yearSeriesFeatures = useMemo(() => {
    if (selectedMonths.length === 0) return speciesFilteredFeatures
    return speciesFilteredFeatures.filter((feature) => {
      const month = getAccidentMonth(feature.properties)
      return month != null && selectedMonths.includes(month)
    })
  }, [speciesFilteredFeatures, selectedMonths])

  const yearlyBreakdown = useMemo(() => {
    const counts = new Map<number, number>()
    for (const feature of yearSeriesFeatures) {
      const year = feature.properties.year
      if (Number.isFinite(year) && year > 0) counts.set(year, (counts.get(year) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year)
  }, [yearSeriesFeatures])

  /** Year span currently kept by the year filter and the timeline scrub. */
  const activeYearRange = useMemo(() => {
    let start = yearMode === RECENT_YEARS && recentYearStart != null ? recentYearStart : null
    let end: number | null = null
    if (timelineFilterRange) {
      const timelineStart = new Date(timelineFilterRange.start).getFullYear()
      const timelineEnd = new Date(timelineFilterRange.end).getFullYear()
      start = start == null ? timelineStart : Math.max(start, timelineStart)
      end = timelineEnd
    }
    if (start == null && end == null) return null
    return { start, end }
  }, [recentYearStart, timelineFilterRange, yearMode])

  const speciesLegendFeatures = useMemo(() => {
    const yearFiltered = features.filter((feature) => {
      if (yearMode === RECENT_YEARS && recentYearStart != null) return feature.properties.year >= recentYearStart
      return true
    })
    const monthFiltered = selectedMonths.length === 0 ? yearFiltered : yearFiltered.filter((feature) => {
      const month = getAccidentMonth(feature.properties)
      return month != null && selectedMonths.includes(month)
    })
    if (!timelineFilterRange) return monthFiltered
    const { start, end } = timelineFilterRange
    return monthFiltered.filter((feature) => {
      const date = parseAccidentDate(feature.properties)
      if (!date) return false
      const t = date.getTime()
      return t >= start && t <= end
    })
  }, [features, recentYearStart, selectedMonths, timelineFilterRange, yearMode])

  const handleTimelineDisable = useCallback(() => {
    setTimelineEnabled(false)
    setTimelineDate(null)
  }, [])

  const toggleSpeciesVisibility = useCallback((species: string) => {
    setHiddenSpecies((current) => (
      current.includes(species)
        ? current.filter((item) => item !== species)
        : [...current, species]
    ))
  }, [])

  const selectedCrash = useMemo(() => {
    if (!selectedId) return null
    return filteredFeatures.find((feature, index) => getWarsFeatureKey(feature, index) === selectedId) ?? null
  }, [filteredFeatures, selectedId])

  const totalQuantity = useMemo(() => (
    filteredFeatures.reduce((sum, feature) => sum + (Number(feature.properties.quantity) || 0), 0)
  ), [filteredFeatures])

  const speciesBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    filteredFeatures.forEach((feature) => {
      const name = feature.properties.species || 'Unknown'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count, color: getSpeciesColor(name) }))
      .sort((a, b) => b.count - a.count)
  }, [filteredFeatures])

  const speciesLegendBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    speciesLegendFeatures.forEach((feature) => {
      const name = feature.properties.species || 'Unknown'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count, color: getSpeciesColor(name) }))
      .sort((a, b) => b.count - a.count)
  }, [speciesLegendFeatures])

  const bucketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const feature of baseFilteredFeatures) {
      const date = parseAccidentDate(feature.properties)
      if (!date) continue
      const key = String(date.getFullYear())
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [baseFilteredFeatures])

  // Recurrent-strike sites: ~1 km cells with records from several distinct
  // years. Sorted ascending so the most recurrent sites render on top.
  const hotspotCells = useMemo<WarsHotspotCell[]>(() => {
    interface HotspotAccumulator {
      lonSum: number
      latSum: number
      recordCount: number
      years: Set<number>
      towns: Map<string, number>
      species: Map<string, number>
    }
    const cells = new Map<string, HotspotAccumulator>()
    for (const feature of filteredFeatures) {
      const [longitude, latitude] = feature.geometry.coordinates
      const key = `${Math.round(longitude / HOTSPOT_LON_BIN)}:${Math.round(latitude / HOTSPOT_LAT_BIN)}`
      let cell = cells.get(key)
      if (!cell) {
        cell = { lonSum: 0, latSum: 0, recordCount: 0, years: new Set(), towns: new Map(), species: new Map() }
        cells.set(key, cell)
      }
      cell.lonSum += longitude
      cell.latSum += latitude
      cell.recordCount += 1
      if (Number.isFinite(feature.properties.year)) cell.years.add(feature.properties.year)
      // Town spellings vary between source spreadsheets ("FT ST JOHN" vs
      // "Fort St. John"), so the label is normalised before it is tallied.
      const town = normaliseTownName(feature.properties.nearestTown)
      if (town) cell.towns.set(town, (cell.towns.get(town) ?? 0) + 1)
      const species = feature.properties.species || 'Unknown'
      cell.species.set(species, (cell.species.get(species) ?? 0) + 1)
    }
    return Array.from(cells.entries())
      .filter(([, cell]) => cell.years.size >= HOTSPOT_MIN_YEARS)
      .map(([key, cell]) => {
        const years = Array.from(cell.years)
        return {
          key,
          longitude: cell.lonSum / cell.recordCount,
          latitude: cell.latSum / cell.recordCount,
          recordCount: cell.recordCount,
          yearCount: cell.years.size,
          firstYear: years.length > 0 ? Math.min(...years) : null,
          lastYear: years.length > 0 ? Math.max(...years) : null,
          nearestTown: pickTopEntry(cell.towns) ?? 'Unknown location',
          topSpecies: pickTopEntry(cell.species) ?? 'Unknown',
        }
      })
      .sort((a, b) => a.yearCount - b.yearCount)
  }, [filteredFeatures])

  // Descending copy for the sidebar ranking; `hotspotCells` stays ascending so
  // the most recurrent rings draw on top of the quieter ones.
  const rankedHotspots = useMemo(() => (
    [...hotspotCells]
      .sort((a, b) => (b.yearCount - a.yearCount) || (b.recordCount - a.recordCount))
      .slice(0, HOTSPOT_LIST_LIMIT)
  ), [hotspotCells])

  const heatmapData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: filteredFeatures.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        weight: Math.max(1, Number(feature.properties.quantity) || 1),
      },
    })),
  }), [filteredFeatures])

  const winterRange = useWarsWinterRange(active && showWinterRange)

  const selectedWinterRange = useMemo(() => {
    if (!selectedWinterRangeId) return null
    return winterRange.data.features.find((feature) => feature.properties.key === selectedWinterRangeId) ?? null
  }, [selectedWinterRangeId, winterRange.data])

  const toggleWinterRangeSelection = useCallback((key: string) => {
    setSelectedWinterRangeId((current) => (current === key ? null : key))
  }, [])

  /**
   * Designated winter range is a legal forestry boundary, not a habitat model,
   * and the snapshot only covers part of the WARS extent. The readout is
   * therefore scored against the records that fall inside the polygons' own
   * envelope, so the denominator matches where the layer can actually say
   * anything.
   */
  const winterRangeOverlap = useMemo(() => {
    const footprint = winterRange.mooseFootprint
    if (!showWinterRange || !footprint) return null
    let withinExtent = 0
    let insideRange = 0
    for (const feature of filteredFeatures) {
      const [longitude, latitude] = feature.geometry.coordinates
      if (!isWithinFootprintExtent(longitude, latitude, footprint)) continue
      withinExtent += 1
      if (isInsideFootprint(longitude, latitude, footprint)) insideRange += 1
    }
    return { withinExtent, insideRange }
  }, [filteredFeatures, showWinterRange, winterRange.mooseFootprint])

  const focusHotspot = useCallback((cell: WarsHotspotCell) => {
    setFocusTarget({ longitude: cell.longitude, latitude: cell.latitude, key: cell.key })
  }, [])

  return {
    manifest,
    crashes,
    winterRange,
    winterRangeOverlap,
    showWinterRange,
    setShowWinterRange,
    selectedWinterRangeId,
    selectedWinterRange,
    setSelectedWinterRangeId,
    toggleWinterRangeSelection,
    focusTarget,
    focusHotspot,
    yearlyBreakdown,
    activeYearRange,
    rankedHotspots,
    selectedSpecies,
    setSelectedSpecies,
    hiddenSpecies,
    toggleSpeciesVisibility,
    showPoints,
    setShowPoints,
    showHeatmap,
    setShowHeatmap,
    showHotspots,
    setShowHotspots,
    selectedMonths,
    toggleMonth,
    clearMonths,
    monthlyBreakdown,
    hotspotCells,
    yearMode,
    setYearMode,
    selectedId,
    setSelectedId,
    features,
    baseFilteredFeatures,
    filteredFeatures,
    heatmapData,
    selectedCrash,
    totalQuantity,
    speciesBreakdown,
    speciesLegendBreakdown,
    bucketCounts,
    recentYearStart,
    timelineEnabled,
    setTimelineEnabled,
    timelineDate: effectiveTimelineDate,
    setTimelineDate,
    timelineWindowSize,
    setTimelineWindowSize,
    accidentDateRange,
    handleTimelineDisable,
  }
}

export type WarsState = ReturnType<typeof useWarsData>

export function WarsLayerControls({ wars }: { wars: WarsState }) {
  return (
    <div className="flex items-center gap-1.5">
      <ToggleChip
        active={wars.showPoints}
        onClick={() => wars.setShowPoints(!wars.showPoints)}
      >
        {wars.showPoints ? 'Hide points' : 'Show points'}
      </ToggleChip>
      <ToggleChip
        active={wars.showHeatmap}
        onClick={() => wars.setShowHeatmap(!wars.showHeatmap)}
        tone="orange"
      >
        Heatmap
      </ToggleChip>
      <ToggleChip
        active={wars.showHotspots}
        onClick={() => wars.setShowHotspots(!wars.showHotspots)}
        tone="rose"
      >
        Hotspots
      </ToggleChip>
      <ToggleChip
        active={wars.showWinterRange}
        onClick={() => wars.setShowWinterRange(!wars.showWinterRange)}
        tone="green"
      >
        Winter range
      </ToggleChip>
    </div>
  )
}

function WarsMonthChart({ wars }: { wars: WarsState }) {
  const maxMonthly = Math.max(...wars.monthlyBreakdown, 1)
  const hasMonthFilter = wars.selectedMonths.length > 0

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Records by month</span>
        {hasMonthFilter && (
          <button
            type="button"
            onClick={wars.clearMonths}
            className="text-[11px] font-medium text-sky-600 hover:underline dark:text-sky-400"
          >
            Clear
          </button>
        )}
      </div>
      <div className="mt-1.5 flex h-16 items-end gap-[3px]">
        {wars.monthlyBreakdown.map((count, month) => {
          const dimmed = hasMonthFilter && !wars.selectedMonths.includes(month)
          const height = Math.max(count > 0 ? 8 : 2, (count / maxMonthly) * 100)
          return (
            <button
              key={month}
              type="button"
              onClick={() => wars.toggleMonth(month)}
              aria-pressed={wars.selectedMonths.includes(month)}
              title={`${MONTH_NAMES[month]}: ${count.toLocaleString()} record${count === 1 ? '' : 's'}`}
              className="flex h-full flex-1 items-end"
            >
              <span
                className={cn(
                  'block w-full rounded-sm bg-amber-600 transition-opacity hover:opacity-70 dark:bg-amber-500',
                  dimmed && 'opacity-30',
                )}
                style={{ height: `${height}%` }}
              />
            </button>
          )
        })}
      </div>
      <div className="mt-1 flex gap-[3px] text-center text-[10px] text-muted-foreground">
        {MONTH_INITIALS.map((initial, month) => (
          <span key={month} className="flex-1">{initial}</span>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Click months to filter the map.</p>
    </div>
  )
}

function WarsYearChart({ wars }: { wars: WarsState }) {
  const series = wars.yearlyBreakdown
  if (series.length === 0) return null

  const maxYearly = Math.max(...series.map((entry) => entry.count), 1)
  const range = wars.activeYearRange
  const isInActiveRange = (year: number) => {
    if (!range) return true
    if (range.start != null && year < range.start) return false
    if (range.end != null && year > range.end) return false
    return true
  }
  const firstYear = series[0].year
  const lastYear = series[series.length - 1].year
  const monthNote = wars.selectedMonths.length > 0
    ? ` (${wars.selectedMonths.slice().sort((a, b) => a - b).map((month) => MONTH_INITIALS[month]).join('')} only)`
    : ''

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Records by year{monthNote}</span>
        <span className="text-[11px] text-muted-foreground">{firstYear}-{lastYear}</span>
      </div>
      <div className="mt-1.5 flex h-16 items-end gap-px">
        {series.map((entry) => {
          const dimmed = !isInActiveRange(entry.year)
          const height = Math.max(entry.count > 0 ? 6 : 2, (entry.count / maxYearly) * 100)
          return (
            <span
              key={entry.year}
              title={`${entry.year}: ${entry.count.toLocaleString()} record${entry.count === 1 ? '' : 's'}`}
              className="flex h-full flex-1 items-end"
            >
              <span
                className={cn(
                  'block w-full rounded-sm bg-sky-600 dark:bg-sky-500',
                  dimmed && 'opacity-25',
                )}
                style={{ height: `${height}%` }}
              />
            </span>
          )
        })}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Counts follow reporting effort as well as collision rates, so read year-to-year changes as trends in what was recorded.
      </p>
    </div>
  )
}

function WarsHotspotList({ wars }: { wars: WarsState }) {
  const sites = wars.rankedHotspots
  if (!wars.showHotspots) return null

  return (
    <div>
      <span className="text-xs font-medium text-foreground">Most recurrent sites</span>
      {sites.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          No ~1 km site has strikes in {HOTSPOT_MIN_YEARS}+ separate years under the current filters.
        </p>
      ) : (
        <>
          <ol className="mt-1.5 space-y-1">
            {sites.map((cell, index) => (
              <li key={cell.key}>
                <button
                  type="button"
                  onClick={() => wars.focusHotspot(cell)}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left transition-colors hover:border-sky-500"
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: getHotspotColor(cell.yearCount) }}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-foreground">{cell.nearestTown}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {cell.topSpecies} · {cell.recordCount.toLocaleString()} records
                      {cell.firstYear != null && cell.lastYear != null ? ` · ${cell.firstYear}-${cell.lastYear}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] font-medium text-muted-foreground">{cell.yearCount} yr</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-1 text-[11px] text-muted-foreground">Click a site to zoom the map to it.</p>
        </>
      )}
    </div>
  )
}

/**
 * Winter range caveats and the overlap readout live in the dataset info dialog
 * rather than the sidebar: they explain how to read the layer, which is a
 * once-per-session question, not something to re-read on every filter change.
 */
function WarsWinterRangeNotes({ wars }: { wars: WarsState }) {
  if (!wars.showWinterRange) return null
  const overlap = wars.winterRangeOverlap
  const share = overlap && overlap.withinExtent > 0 ? (overlap.insideRange / overlap.withinExtent) * 100 : 0
  const { window: coverageWindow, clippedTo } = wars.winterRange.coverage

  return (
    <>
      {overlap && (
        <p>
          Of {overlap.withinExtent.toLocaleString()} filtered records inside the mapped moose winter-range extent,{' '}
          {overlap.insideRange.toLocaleString()} ({share.toFixed(1)}%) fall within a designated polygon. Winter range is
          a forestry designation that excludes highway corridors, so this measures overlap with the legal boundary, not
          habitat suitability.
        </p>
      )}
      <p>
        Winter range polygons are legal designations, not a habitat model. The snapshot is clipped to{' '}
        {coverageWindow ?? 'a regional window'}
        {clippedTo ? ` (${clippedTo})` : ''} — a fraction of the WARS record extent — so blank map outside that window
        means no data rather than no habitat.
      </p>
    </>
  )
}

export function WarsSidebar({
  wars,
  showSelectedRecord = true,
}: {
  wars: WarsState
  showSelectedRecord?: boolean
}) {
  const manifest = wars.manifest.data
  const yearLabel = wars.yearMode === RECENT_YEARS && wars.recentYearStart && manifest?.yearEnd
    ? `${wars.recentYearStart}-${manifest.yearEnd}`
    : manifest?.yearStart && manifest.yearEnd
      ? `${manifest.yearStart}-${manifest.yearEnd}`
      : 'All years'

  return (
    <>
      <SidebarSection
        title="Wildlife Accident Records"
        icon={PawPrint}
        iconClassName="text-amber-700"
        actions={(
          <ToggleChip
            active={wars.timelineEnabled}
            onClick={() => wars.setTimelineEnabled(!wars.timelineEnabled)}
          >
            Timeline
          </ToggleChip>
        )}
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium text-foreground">
            Species
            <AppSelect
              value={wars.selectedSpecies}
              onValueChange={wars.setSelectedSpecies}
              options={[
                { value: ALL_SPECIES, label: 'All species' },
                ...(manifest?.species ?? []).slice(0, 40).map((species) => ({
                  value: species.name,
                  label: `${species.name} (${species.count.toLocaleString()})`,
                  selectedLabel: species.name,
                })),
              ]}
              className="mt-1"
              triggerClassName="h-8 rounded-md text-xs"
            />
          </label>

          <label className="block text-xs font-medium text-foreground">
            Years
            <AppSelect
              value={wars.yearMode}
              onValueChange={wars.setYearMode}
              options={[
                { value: RECENT_YEARS, label: 'Most recent 10 years' },
                { value: ALL_YEARS, label: 'All years' },
              ]}
              className="mt-1"
              triggerClassName="h-8 rounded-md text-xs"
            />
          </label>

          <StatGrid
            stats={[
              { label: 'records', value: wars.filteredFeatures.length.toLocaleString() },
              { label: 'animals', value: wars.totalQuantity.toLocaleString() },
              { label: 'period', value: yearLabel },
            ]}
          />

          <WarsMonthChart wars={wars} />

          <WarsYearChart wars={wars} />

          <WarsHotspotList wars={wars} />

          {wars.crashes.error && <InlineAlert tone="error">{wars.crashes.error}</InlineAlert>}
          {wars.manifest.error && <InlineAlert tone="error">{wars.manifest.error}</InlineAlert>}
          {wars.showWinterRange && wars.winterRange.source.error && (
            <InlineAlert tone="error">{wars.winterRange.source.error}</InlineAlert>
          )}
        </div>
      </SidebarSection>

      {wars.selectedWinterRange && (
        <SidebarSection title="Selected Winter Range">
          <SelectedItemCard
            title={`${wars.selectedWinterRange.properties.speciesLabel} winter range`}
            subtitle={wars.selectedWinterRange.properties.label}
            onClear={() => wars.setSelectedWinterRangeId(null)}
            rows={[
              { label: 'Area', value: formatWinterRangeHectares(wars.selectedWinterRange.properties.hectares) || 'Unknown' },
              { label: 'Harvest zone', value: wars.selectedWinterRange.properties.harvestCode || 'Not recorded' },
              { label: 'Species code', value: wars.selectedWinterRange.properties.speciesCode },
            ]}
          />
        </SidebarSection>
      )}

      {showSelectedRecord && wars.selectedCrash && (
        <SidebarSection title="Selected Record">
          <SelectedItemCard
            title={wars.selectedCrash.properties.species}
            onClear={() => wars.setSelectedId(null)}
            rows={[
              { label: 'Date', value: wars.selectedCrash.properties.accidentDate || 'Unknown' },
              { label: 'Quantity', value: wars.selectedCrash.properties.quantity.toLocaleString() },
              { label: 'Nearest town', value: wars.selectedCrash.properties.nearestTown },
              { label: 'Service area', value: wars.selectedCrash.properties.serviceArea.toLocaleString() },
            ]}
          />
        </SidebarSection>
      )}
    </>
  )
}

function MobileWarsDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[12rem] text-right font-medium text-foreground">{value}</span>
    </div>
  )
}

export function MobileWarsFeatureCard({ wars }: { wars: WarsState }) {
  const crash = wars.selectedCrash
  const winterRange = wars.selectedWinterRange

  // A record selection wins over a polygon selection: points sit above the
  // winter range fill, so the record is what the tap was aimed at.
  if (!crash && winterRange) {
    return (
      <MobileFeatureCard
        cardKey={`winter-range-${winterRange.properties.key}`}
        title={`${winterRange.properties.speciesLabel} winter range`}
        subtitle={winterRange.properties.label}
        onClose={() => wars.setSelectedWinterRangeId(null)}
      >
        <div className="rounded-md border border-border bg-background p-3 text-xs text-foreground">
          <div className="space-y-1">
            <MobileWarsDetailRow
              label="Area"
              value={formatWinterRangeHectares(winterRange.properties.hectares) || 'Unknown'}
            />
            <MobileWarsDetailRow label="Harvest zone" value={winterRange.properties.harvestCode || 'Not recorded'} />
            <MobileWarsDetailRow label="Species code" value={winterRange.properties.speciesCode} />
          </div>
        </div>
      </MobileFeatureCard>
    )
  }

  if (!crash) return null

  return (
    <MobileFeatureCard
      cardKey={wars.selectedId ?? crash.properties.id}
      title={crash.properties.species || 'Wildlife record'}
      subtitle={crash.properties.accidentDate || String(crash.properties.year)}
      onClose={() => wars.setSelectedId(null)}
    >
      <div className="rounded-md border border-border bg-background p-3 text-xs text-foreground">
        <div className="space-y-1">
          <MobileWarsDetailRow label="Date" value={crash.properties.accidentDate || 'Unknown'} />
          <MobileWarsDetailRow label="Quantity" value={crash.properties.quantity.toLocaleString()} />
          <MobileWarsDetailRow label="Nearest town" value={crash.properties.nearestTown} />
          <MobileWarsDetailRow label="Service area" value={crash.properties.serviceArea.toLocaleString()} />
        </div>
      </div>
    </MobileFeatureCard>
  )
}

export function WarsSourceNotes({ wars }: { wars: WarsState }) {
  return (
    <>
      <p>WARS extracts updated {formatDate(wars.manifest.data?.generatedAt)}.</p>
      <p>{wars.manifest.data?.sourceCitation ?? 'BC Ministry of Transportation and Transit Wildlife Accident Reporting System.'}</p>
      <p>
        Records cover the Ministry's whole Northern Region (service areas 18-28), not just the Prince George area: Haida
        Gwaii, Prince Rupert and Stewart in the west, east to the Alberta border past Dawson Creek, north to Atlin and
        Dease Lake, and south to Williams Lake, Blue River and Avola. Only records carrying mapped coordinates in the
        source spreadsheets are shown.
      </p>
      <WarsWinterRangeNotes wars={wars} />
    </>
  )
}

/**
 * Lives inside the map so the sidebar's recurrent-site list and the winter range
 * selection can recentre the view without the section having to thread a map ref
 * down to them.
 */
function WarsMapFocus({ wars }: { wars: WarsState }) {
  const { map, isLoaded } = useMap()
  const focusTarget = wars.focusTarget
  const selectedWinterRange = wars.selectedWinterRange

  useEffect(() => {
    if (!map || !isLoaded || !focusTarget) return
    map.flyTo({ center: [focusTarget.longitude, focusTarget.latitude], zoom: 12, duration: 800 })
  }, [map, isLoaded, focusTarget])

  // Winter range units span anything from a single hillside to hundreds of km²,
  // so the selection frames the polygon's own bounds rather than a fixed zoom.
  useEffect(() => {
    if (!map || !isLoaded || !selectedWinterRange) return
    const bounds = getWinterRangeBounds(selectedWinterRange.geometry)
    if (!bounds) return
    map.fitBounds(bounds, {
      padding: { top: 72, right: 72, bottom: 72, left: 72 },
      maxZoom: 13,
      duration: 800,
    })
  }, [map, isLoaded, selectedWinterRange])

  return null
}

export function WarsLayer({ wars }: { wars: WarsState }) {
  // Clusters render as species-split donut charts with the record count in
  // the centre (shared MapPieClusterLayer, as on the food map); wedge order
  // follows the speciesBreakdown so it matches the legend.
  const bandColors = useMemo(() => wars.speciesBreakdown.map((entry) => entry.color), [wars.speciesBreakdown])

  const clusterData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    const bandIndexBySpecies = new Map(wars.speciesBreakdown.map((entry, index) => [entry.name, index]))
    return {
      type: 'FeatureCollection',
      features: wars.filteredFeatures.map((feature, index) => {
        const species = feature.properties.species || 'Unknown'
        return {
          type: 'Feature' as const,
          geometry: feature.geometry,
          properties: {
            color: getSpeciesColor(species),
            bandIndex: bandIndexBySpecies.get(species) ?? 0,
            featureKey: getWarsFeatureKey(feature, index),
            spiderTitle: `${species} · ${feature.properties.quantity.toLocaleString()} animal${feature.properties.quantity === 1 ? '' : 's'}`,
            spiderSubtitle: [feature.properties.accidentDate, feature.properties.nearestTown].filter(Boolean).join(' · '),
          },
        }
      }),
    }
  }, [wars.filteredFeatures, wars.speciesBreakdown])

  return (
    <>
      <WarsMapFocus wars={wars} />

      {/* Rendered before the heatmap and points so the polygons stay underneath. */}
      {wars.showWinterRange && wars.winterRange.data.features.length > 0 && (
        <MapFillLayer
          data={wars.winterRange.data}
          idProperty="key"
          fillColor={['get', 'color']}
          fillOpacity={0.28}
          lineColor={['get', 'color']}
          lineWidth={1}
          lineOpacity={0.85}
          selectedId={wars.selectedWinterRangeId}
          selectionWidth={3}
          onFeatureClick={(key) => wars.toggleWinterRangeSelection(key)}
          hoverHtml={winterRangeTooltipHtml}
        />
      )}

      {wars.showHeatmap && (
        <MapHeatmapLayer
          data={wars.heatmapData}
          weight={['interpolate', ['linear'], ['coalesce', ['get', 'weight'], 1], 1, 0.25, 4, 1]}
          intensityStops={[
            [8, 0.7],
            [11, 1.25],
            [14, 1.9],
          ]}
          radiusStops={[
            [8, 16],
            [11, 30],
            [14, 46],
          ]}
          opacity={[
            [8, 0.58],
            [14, 0.76],
          ]}
          colorRamp="crime"
        />
      )}

      {wars.showPoints && (
        <MapPieClusterLayer
          data={clusterData}
          bandColors={bandColors}
          expandOverlappingPoints
          onPointClick={(properties) => {
            const featureKey = String(properties.featureKey ?? '')
            if (featureKey) wars.setSelectedId(wars.selectedId === featureKey ? null : featureKey)
          }}
        />
      )}

      {wars.showHotspots && wars.hotspotCells.map((cell) => {
        const color = getHotspotColor(cell.yearCount)
        const size = getHotspotSize(cell.yearCount)
        return (
          <MapMarker key={cell.key} longitude={cell.longitude} latitude={cell.latitude}>
            <MarkerContent>
              {/* pointer-events-none keeps cluster and point clicks working underneath */}
              <div
                className="pointer-events-none flex items-center justify-center rounded-full border-2 text-[10px] font-bold"
                style={{
                  width: size,
                  height: size,
                  borderColor: color,
                  backgroundColor: `${color}2a`,
                  color,
                  textShadow: '0 0 3px rgba(255,255,255,0.9), 0 0 1px rgba(255,255,255,0.9)',
                }}
              >
                {cell.yearCount}
              </div>
            </MarkerContent>
          </MapMarker>
        )
      })}

      {wars.showPoints && wars.selectedCrash && (() => {
        const [longitude, latitude] = wars.selectedCrash.geometry.coordinates
        const size = getWarsMarkerSize(wars.selectedCrash.properties.quantity)
        const color = getSpeciesColor(wars.selectedCrash.properties.species || 'Unknown')

        return (
          <MapMarker
            longitude={longitude}
            latitude={latitude}
            onClick={() => wars.setSelectedId(null)}
          >
            <MarkerContent>
              <div
                className="rounded-full border-2 border-white shadow-md ring-2 ring-cyan-400"
                style={{ width: size, height: size, backgroundColor: color }}
                title={`${wars.selectedCrash.properties.species}: ${wars.selectedCrash.properties.accidentDate || wars.selectedCrash.properties.year}`}
              />
            </MarkerContent>
          </MapMarker>
        )
      })()}
    </>
  )
}

export function WarsLegend({ wars }: { wars: WarsState }) {
  return (
    <div className="w-full space-y-1.5 text-xs text-muted-foreground md:w-56 md:space-y-2 md:text-xs">
      {wars.showPoints && (
        <>
          {wars.speciesLegendBreakdown.length === 0 ? (
            <MapLegendNote className="italic">No records in current filter.</MapLegendNote>
          ) : (
            <ul className="max-h-32 space-y-0.5 overflow-y-auto pr-1 md:max-h-44 md:space-y-1">
              {wars.speciesLegendBreakdown.map((entry) => (
                <li key={entry.name}>
                  <LegendItem
                    color={entry.color}
                    label={entry.name}
                    active={!wars.hiddenSpecies.includes(entry.name)}
                    className="md:gap-2"
                    onClick={() => wars.toggleSpeciesVisibility(entry.name)}
                  />
                </li>
              ))}
            </ul>
          )}
          <MapSizeLegend
            className="border-t border-border pt-1.5 md:pt-2"
            minLabel="Single"
            maxLabel="Multiple"
            sizes={[8, 16, 24]}
            color="rgb(100 116 139 / 0.6)"
          />
        </>
      )}
      {wars.showHeatmap && (
        <div className={cn(wars.showPoints && 'border-t border-border pt-2')}>
          <MapGradientLegendItem colors={['#67e8f9', '#fde047', '#dc2626']} minLabel="Lower density" maxLabel="Higher density" />
          <div className="mt-2 text-xs">Heatmap aggregates all selected species.</div>
        </div>
      )}
      {wars.showHotspots && (
        <div className={cn((wars.showPoints || wars.showHeatmap) && 'border-t border-border pt-2')}>
          <div className="text-xs font-medium text-foreground">Recurrent sites</div>
          <ul className="mt-1 space-y-1">
            {([['3-4 years', 3], ['5-9 years', 5], ['10+ years', 10]] as const).map(([label, tier]) => (
              <li key={label} className="flex items-center gap-2">
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border-2"
                  style={{ borderColor: getHotspotColor(tier), backgroundColor: `${getHotspotColor(tier)}2a` }}
                />
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <MapLegendNote className="mt-1.5">
            Rings mark ~1 km sites with strikes in {HOTSPOT_MIN_YEARS}+ separate years; the number is how many years.
          </MapLegendNote>
        </div>
      )}
      {wars.showWinterRange && (
        <div className={cn((wars.showPoints || wars.showHeatmap || wars.showHotspots) && 'border-t border-border pt-2')}>
          <div className="text-xs font-medium text-foreground">Ungulate winter range</div>
          {wars.winterRange.legend.length === 0 ? (
            <MapLegendNote className="mt-1 italic">Loading winter range boundaries...</MapLegendNote>
          ) : (
            <ul className="mt-1 space-y-1">
              {wars.winterRange.legend.map((entry) => (
                <li key={entry.label} className="flex items-center gap-2">
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm border"
                    style={{ borderColor: entry.color, backgroundColor: `${entry.color}47` }}
                  />
                  <span>{entry.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!wars.showPoints && !wars.showHeatmap && !wars.showHotspots && !wars.showWinterRange && (
        <MapLegendNote className="italic">All layers are hidden.</MapLegendNote>
      )}
    </div>
  )
}
