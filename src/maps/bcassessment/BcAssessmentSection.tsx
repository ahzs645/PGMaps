import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useUrlParamSync } from '@/hooks/useUrlState'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { useIsMobile } from '@/hooks/useIsMobile'
import { MapLegendPanel, MapSteppedLegend } from '@/components/ui/map-panels'
import { Timeline } from '@/components/ui/timeline'
import { toggleArrayItem } from '@/hooks/useToggleArray'
import { BcAssessmentMap } from './components/BcAssessmentMap'
import { BcAssessmentSidebar, formatNumber, HistorySparkline } from './components/BcAssessmentSidebar'
import { useBcAssessmentData } from './hooks/useBcAssessmentData'
import { useBoundaryData } from './hooks/useBoundaryData'
import { useBoundaryAggregates } from './hooks/useBoundaryAggregates'
import { ALL_CATEGORIES, ASSESSMENT_HISTORY_START_YEAR, formatCurrency, VALUE_STOPS, YEAR_STOPS } from './constants'
import type {
  AssessmentBoundaryLevel,
  AssessmentBoundarySource,
  Property,
  PropertyCategory,
  ColorMetric,
  BoundaryLevel,
} from './types'

type AssessmentLegendMode = 'rows' | 'horizontal' | 'gradient'

const ASSESSMENT_LEGEND_MODE: AssessmentLegendMode = 'horizontal'

const DEFAULT_LEVEL_BY_SOURCE: Record<AssessmentBoundarySource, AssessmentBoundaryLevel> = {
  bcHealth: 'chsa',
  regionalDistrict: 'regionalDistrict',
  census: 'ct',
  cityPG: 'elementarySchoolCatchment',
  watershed: 'majorWatershed',
}

const SOURCE_BY_LEVEL: Record<AssessmentBoundaryLevel, AssessmentBoundarySource> = {
  healthAuthority: 'bcHealth',
  hsda: 'bcHealth',
  lha: 'bcHealth',
  chsa: 'bcHealth',
  regionalDistrict: 'regionalDistrict',
  ct: 'census',
  da: 'census',
  db: 'census',
  elementarySchoolCatchment: 'cityPG',
  secondarySchoolCatchment: 'cityPG',
  majorWatershed: 'watershed',
  watershedGroup: 'watershed',
  assessmentWatershed: 'watershed',
}

function isAssessmentBoundaryLevel(level: string | null): level is AssessmentBoundaryLevel {
  return !!level && level in SOURCE_BY_LEVEL
}

function isAssessmentBoundarySource(source: string | null): source is AssessmentBoundarySource {
  return !!source && source in DEFAULT_LEVEL_BY_SOURCE
}

export default function BcAssessmentSection() {
  const isMobileViewport = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()
  const { properties, loading, error } = useBcAssessmentData()

  // null means "no explicit selection yet" and resolves to every category, so
  // no initialization effect is needed once properties load.
  const [selectedCategoriesOverride, setSelectedCategoriesOverride] = useState<PropertyCategory[] | null>(null)
  const selectedCategories = selectedCategoriesOverride ?? ALL_CATEGORIES
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [colorMetric, setColorMetric] = useState<ColorMetric>(() => (searchParams.get('metric') as ColorMetric) || 'totalAssessed')
  const [boundaryLevel, setBoundaryLevel] = useState<BoundaryLevel>(() => {
    const boundary = searchParams.get('boundary')
    return isAssessmentBoundaryLevel(boundary) ? boundary : 'none'
  })
  const [boundarySource, setBoundarySource] = useState<AssessmentBoundarySource>(() => {
    const source = searchParams.get('source')
    if (isAssessmentBoundarySource(source)) return source
    const boundary = searchParams.get('boundary')
    return isAssessmentBoundaryLevel(boundary) ? SOURCE_BY_LEVEL[boundary] : 'census'
  })
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [ignoredUrlPropertyId, setIgnoredUrlPropertyId] = useState<string | null>(null)
  const [selectedBoundaryId, setSelectedBoundaryId] = useState<string | null>(() => searchParams.get('region'))
  const [showSidebar, setShowSidebar] = useState(true)
  const [showTimeline, setShowTimeline] = useState(false)

  const { boundaryData } = useBoundaryData(boundaryLevel)

  // Deep-linked selection derives from the URL until the user explicitly
  // clears it; remembering the cleared id keeps a fresh ?property= link live.
  const urlPropertyId = searchParams.get('property')
  const effectiveSelectedProperty = useMemo(() => {
    if (selectedProperty) return selectedProperty
    if (!urlPropertyId || urlPropertyId === ignoredUrlPropertyId) return null
    return properties.find((item) => item.id === urlPropertyId) ?? null
  }, [selectedProperty, urlPropertyId, ignoredUrlPropertyId, properties])

  const timelineYearOptions = useMemo(() => {
    const maxHistoryLength = properties.reduce((max, property) => Math.max(max, property.histValues?.length ?? 0), 0)
    if (maxHistoryLength === 0) return [new Date().getFullYear()]
    return Array.from({ length: maxHistoryLength }, (_, index) => ASSESSMENT_HISTORY_START_YEAR + index)
  }, [properties])
  const [timelineYearState, setTimelineYear] = useState(new Date().getFullYear())
  const timelineYear = timelineYearOptions.includes(timelineYearState)
    ? timelineYearState
    : timelineYearOptions[timelineYearOptions.length - 1] ?? timelineYearState

  const filteredBaseProperties = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return properties.filter((prop) => {
      const matchesCategory = selectedCategories.includes(prop.category)
      const matchesSearch = !query || prop.address.toLowerCase().includes(query)
      return matchesCategory && matchesSearch
    })
  }, [properties, selectedCategories, searchQuery])

  const filteredProperties = useMemo(() => {
    if (!showTimeline) return filteredBaseProperties
    const historyIndex = timelineYear - ASSESSMENT_HISTORY_START_YEAR

    return filteredBaseProperties.map((property) => {
      const historicalValue = property.histValues?.[historyIndex]
      if (typeof historicalValue !== 'number' || !Number.isFinite(historicalValue)) return property

      return {
        ...property,
        totalAssessed: historicalValue,
      }
    })
  }, [filteredBaseProperties, showTimeline, timelineYear])

  const visibleSelectedProperty = useMemo(() => {
    if (!effectiveSelectedProperty) return null
    return filteredBaseProperties.some((property) => property.id === effectiveSelectedProperty.id)
      ? effectiveSelectedProperty
      : null
  }, [filteredBaseProperties, effectiveSelectedProperty])

  const selectedDisplayProperty = useMemo(() => {
    if (!visibleSelectedProperty) return null
    return filteredProperties.find((property) => property.id === visibleSelectedProperty.id) ?? visibleSelectedProperty
  }, [filteredProperties, visibleSelectedProperty])

  // Sync filters to URL for shareable links
  useUrlParamSync({
    q: searchQuery.trim(),
    metric: colorMetric === 'totalAssessed' ? null : colorMetric,
    boundary: boundaryLevel === 'none' ? null : boundaryLevel,
    source: boundarySource === 'census' ? null : boundarySource,
    property: visibleSelectedProperty ? visibleSelectedProperty.id : null,
    region: selectedBoundaryId,
  })

  const timelineBucketValues = useMemo(() => {
    const totals = new Map<string, { total: number; count: number }>()
    for (const property of filteredBaseProperties) {
      property.histValues?.forEach((value, index) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return
        const year = String(ASSESSMENT_HISTORY_START_YEAR + index)
        const current = totals.get(year) ?? { total: 0, count: 0 }
        current.total += value
        current.count += 1
        totals.set(year, current)
      })
    }

    return new Map(
      Array.from(totals.entries()).map(([year, summary]) => [
        year,
        summary.count === 0 ? 0 : Math.round(summary.total / summary.count),
      ]),
    )
  }, [filteredBaseProperties])

  const timelineDateRange = useMemo(() => ({
    start: new Date(timelineYearOptions[0] ?? timelineYear, 0, 1),
    end: new Date(timelineYearOptions[timelineYearOptions.length - 1] ?? timelineYear, 0, 1),
  }), [timelineYear, timelineYearOptions])

  const boundaryAggregates = useBoundaryAggregates(filteredProperties, boundaryLevel)
  const toggleCategory = useCallback((category: PropertyCategory) => {
    setSelectedCategoriesOverride((current) => toggleArrayItem(current ?? ALL_CATEGORIES, category))
  }, [])

  const handleClearSelection = useCallback(() => {
    setIgnoredUrlPropertyId(searchParams.get('property'))
    setSelectedProperty(null)
    setSelectedBoundaryId(null)
    const params = new URLSearchParams(searchParams)
    params.delete('property')
    params.delete('region')
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  const handlePropertyClick = useCallback((property: Property) => {
    if (effectiveSelectedProperty?.id === property.id) {
      handleClearSelection()
      return
    }
    setSelectedProperty(property)
    setSelectedBoundaryId(null)
  }, [handleClearSelection, effectiveSelectedProperty])

  const handleBoundaryClick = useCallback((boundaryId: string) => {
    if (selectedBoundaryId === boundaryId) {
      handleClearSelection()
      return
    }
    setSelectedBoundaryId(boundaryId)
    setSelectedProperty(null)
  }, [handleClearSelection, selectedBoundaryId])

  const handleBoundarySourceChange = useCallback((source: AssessmentBoundarySource) => {
    setBoundarySource(source)
    setBoundaryLevel(DEFAULT_LEVEL_BY_SOURCE[source])
    setSelectedBoundaryId(null)
  }, [])

  // Build legend
  const legendItems = useMemo(() => {
    const stops = colorMetric === 'yearBuilt' ? YEAR_STOPS : VALUE_STOPS
    return stops.map(([value, color]) => ({
      label: colorMetric === 'yearBuilt' ? String(value) : formatCurrency(value),
      color,
    }))
  }, [colorMetric])

  const continuousLegendLabels = useMemo(() => {
    if (legendItems.length <= 4) return legendItems.map((item) => item.label)

    const indexes = [
      0,
      Math.round((legendItems.length - 1) / 3),
      Math.round(((legendItems.length - 1) * 2) / 3),
      legendItems.length - 1,
    ]

    return Array.from(new Set(indexes)).map((index) => legendItems[index].label)
  }, [legendItems])

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">
            BC Assessment | {filteredProperties.length.toLocaleString()} parcels
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {visibleSelectedProperty?.address || selectedBoundaryId || colorMetric}
          </div>
        </div>
      )}
      sidebar={(
        <BcAssessmentSidebar
          className="h-full w-full border-0 shadow-none md:border-r md:shadow-xl"
          properties={properties}
          filteredProperties={filteredProperties}
          selectedCategories={selectedCategories}
          selectedProperty={selectedDisplayProperty}
          boundaryAggregates={boundaryAggregates}
          searchQuery={searchQuery}
          colorMetric={colorMetric}
          boundarySource={boundarySource}
          boundaryLevel={boundaryLevel}
          loading={loading}
          error={error}
          showTimeline={showTimeline}
          timelineYear={timelineYear}
          timelineYearOptions={timelineYearOptions}
          onSearchQueryChange={setSearchQuery}
          onToggleCategory={toggleCategory}
          onColorMetricChange={setColorMetric}
          onBoundarySourceChange={handleBoundarySourceChange}
          selectedBoundary={selectedBoundaryId ? boundaryAggregates.get(selectedBoundaryId) ?? null : null}
          onBoundaryLevelChange={(level) => { setBoundaryLevel(level); setSelectedBoundaryId(null) }}
          onPropertyClick={handlePropertyClick}
          onClearSelection={handleClearSelection}
          onToggleTimeline={() => setShowTimeline((current) => !current)}
          onTimelineYearChange={setTimelineYear}
        />
      )}
    >
      <div className="relative h-full">
        <BcAssessmentMap
          properties={filteredProperties}
          colorMetric={colorMetric}
          selectedProperty={selectedDisplayProperty}
          selectedBoundaryId={selectedBoundaryId}
          boundaryLevel={boundaryLevel}
          boundaryData={boundaryData}
          boundaryAggregates={boundaryAggregates}
          colorScaleMode={ASSESSMENT_LEGEND_MODE === 'gradient' ? 'continuous' : 'stepped'}
          onPropertyClick={handlePropertyClick}
          onBoundaryClick={handleBoundaryClick}
          loading={loading}
        />

        {/* Legend */}
        {legendItems.length > 0 && (
          <MapLegendPanel
            title={`${boundaryLevel !== 'none' ? 'Avg ' : ''}${colorMetric === 'yearBuilt' ? 'Year Built' : 'Assessed Value'}`}
            collapsible
            width={ASSESSMENT_LEGEND_MODE === 'rows' ? 'md' : 'lg'}
          >
            {ASSESSMENT_LEGEND_MODE === 'rows' ? (
              <MapSteppedLegend bands={legendItems} variant="rows" showBandLabels={false} />
            ) : (
              <MapSteppedLegend
                bands={legendItems}
                variant={ASSESSMENT_LEGEND_MODE === 'gradient' ? 'gradient' : 'strip'}
                labels={ASSESSMENT_LEGEND_MODE === 'gradient' ? continuousLegendLabels : undefined}
              />
            )}
          </MapLegendPanel>
        )}

        {isMobileViewport && visibleSelectedProperty && (
          <MobileBcAssessmentFeatureCard
            property={selectedDisplayProperty ?? visibleSelectedProperty}
            onClose={handleClearSelection}
          />
        )}

        {showTimeline && timelineYearOptions.length > 1 && (
          <Timeline
            startDate={timelineDateRange.start}
            endDate={timelineDateRange.end}
            currentDate={new Date(timelineYear, 0, 1)}
            onDateChange={(date) => setTimelineYear(date.getFullYear())}
            onClose={() => setShowTimeline(false)}
            granularity="year"
            bucketCounts={timelineBucketValues}
            bucketValueFormatter={formatCurrency}
            bucketValueLabel="avg assessed"
            percentChangeMode={{ enabled: true, label: 'YoY' }}
            statsLabel={`${formatCurrency(timelineBucketValues.get(String(timelineYear)) ?? 0)} avg assessed`}
          />
        )}
      </div>
    </MapSectionLayout>
  )
}

function MobileBcAssessmentFeatureCard({
  property,
  onClose,
}: {
  property: Property
  onClose: () => void
}) {
  return (
    <MobileFeatureCard
      cardKey={property.id}
      title={property.address}
      subtitle={property.description}
      onClose={onClose}
    >
      <div className="mt-3 space-y-1 rounded-md border border-blue-300/60 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/25 dark:text-blue-100">
        <PropertyRow label="Total Assessed" value={`$${formatNumber(property.totalAssessed)}`} />
        <PropertyRow label="Land" value={`$${formatNumber(property.totalLand)}`} />
        <PropertyRow label="Building" value={`$${formatNumber(property.totalBuilding)}`} />
        {property.yearBuilt ? <PropertyRow label="Year Built" value={String(property.yearBuilt)} /> : null}
      </div>
      {property.histValues && property.histValues.length > 1 && (
        <HistorySparkline values={property.histValues} />
      )}
    </MobileFeatureCard>
  )
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[12rem] text-right font-medium text-foreground">{value}</span>
    </div>
  )
}
