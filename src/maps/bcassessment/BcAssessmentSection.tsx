import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { MapLegendPanel, MapSteppedLegend } from '@/components/ui/map-panels'
import { BcAssessmentMap } from './components/BcAssessmentMap'
import { BcAssessmentSidebar, formatNumber, HistorySparkline } from './components/BcAssessmentSidebar'
import { useBcAssessmentData } from './hooks/useBcAssessmentData'
import { useBoundaryData } from './hooks/useBoundaryData'
import { useBoundaryAggregates } from './hooks/useBoundaryAggregates'
import { ALL_CATEGORIES, formatCurrency, VALUE_STOPS, YEAR_STOPS } from './constants'
import type {
  AssessmentBoundaryLevel,
  AssessmentBoundarySource,
  Property,
  PropertyCategory,
  ColorMetric,
  BoundaryLevel,
} from './types'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const { properties, loading, error } = useBcAssessmentData()

  const [selectedCategories, setSelectedCategories] = useState<PropertyCategory[]>([])
  const [categoriesInitialized, setCategoriesInitialized] = useState(false)
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
  const [selectedBoundaryId, setSelectedBoundaryId] = useState<string | null>(() => searchParams.get('region'))
  const [showSidebar, setShowSidebar] = useState(true)

  const { boundaryData } = useBoundaryData(boundaryLevel)

  // Initialize filters with all categories
  useEffect(() => {
    if (!categoriesInitialized && properties.length > 0) {
      setSelectedCategories(ALL_CATEGORIES)
      setCategoriesInitialized(true)
    }
  }, [properties, categoriesInitialized])

  useEffect(() => {
    const propertyId = searchParams.get('property')
    if (propertyId && !selectedProperty) {
      const property = properties.find((item) => item.id === propertyId)
      if (property) setSelectedProperty(property)
    }
  }, [properties, searchParams, selectedProperty])

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    if (searchQuery.trim()) params.set('q', searchQuery.trim())
    else params.delete('q')
    if (colorMetric !== 'totalAssessed') params.set('metric', colorMetric)
    else params.delete('metric')
    if (boundaryLevel !== 'none') params.set('boundary', boundaryLevel)
    else params.delete('boundary')
    if (boundarySource !== 'census') params.set('source', boundarySource)
    else params.delete('source')
    if (selectedProperty) params.set('property', selectedProperty.id)
    else params.delete('property')
    if (selectedBoundaryId) params.set('region', selectedBoundaryId)
    else params.delete('region')
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [boundaryLevel, boundarySource, colorMetric, searchParams, searchQuery, selectedBoundaryId, selectedProperty, setSearchParams])

  const filteredProperties = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return properties.filter((prop) => {
      const matchesCategory = selectedCategories.includes(prop.category)
      const matchesSearch = !query || prop.address.toLowerCase().includes(query)
      return matchesCategory && matchesSearch
    })
  }, [properties, selectedCategories, searchQuery])

  const boundaryAggregates = useBoundaryAggregates(filteredProperties, boundaryLevel)
  // Clear selection if it's no longer visible
  useEffect(() => {
    if (selectedProperty && !filteredProperties.some((p) => p.id === selectedProperty.id)) {
      setSelectedProperty(null)
    }
  }, [filteredProperties, selectedProperty])

  const toggleCategory = useCallback((category: PropertyCategory) => {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category]
    )
  }, [])

  const handlePropertyClick = useCallback((property: Property) => {
    setSelectedProperty(property)
    setSelectedBoundaryId(null)
  }, [])

  const handleBoundaryClick = useCallback((boundaryId: string) => {
    setSelectedBoundaryId(boundaryId)
    setSelectedProperty(null)
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedProperty(null)
    setSelectedBoundaryId(null)
  }, [])

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

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">
            BC Assessment | {filteredProperties.length.toLocaleString()} parcels
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {selectedProperty?.address || selectedBoundaryId || colorMetric}
          </div>
        </div>
      )}
      sidebar={(
        <BcAssessmentSidebar
          className="h-full w-full border-0 shadow-none md:w-[350px] md:border-r md:shadow-xl"
          properties={properties}
          filteredProperties={filteredProperties}
          selectedCategories={selectedCategories}
          selectedProperty={selectedProperty}
          boundaryAggregates={boundaryAggregates}
          searchQuery={searchQuery}
          colorMetric={colorMetric}
          boundarySource={boundarySource}
          boundaryLevel={boundaryLevel}
          loading={loading}
          error={error}
          onSearchQueryChange={setSearchQuery}
          onToggleCategory={toggleCategory}
          onColorMetricChange={setColorMetric}
          onBoundarySourceChange={handleBoundarySourceChange}
          selectedBoundary={selectedBoundaryId ? boundaryAggregates.get(selectedBoundaryId) ?? null : null}
          onBoundaryLevelChange={(level) => { setBoundaryLevel(level); setSelectedBoundaryId(null) }}
          onPropertyClick={handlePropertyClick}
          onClearSelection={handleClearSelection}
        />
      )}
    >
      <div className="relative h-full">
        <BcAssessmentMap
          properties={filteredProperties}
          colorMetric={colorMetric}
          selectedProperty={selectedProperty}
          selectedBoundaryId={selectedBoundaryId}
          boundaryLevel={boundaryLevel}
          boundaryData={boundaryData}
          boundaryAggregates={boundaryAggregates}
          onPropertyClick={handlePropertyClick}
          onBoundaryClick={handleBoundaryClick}
          loading={loading}
        />

        {/* Legend */}
        {legendItems.length > 0 && (
          <MapLegendPanel
            title={`${boundaryLevel !== 'none' ? 'Avg ' : ''}${colorMetric === 'yearBuilt' ? 'Year Built' : 'Assessed Value'}`}
            collapsible
          >
            <MapSteppedLegend bands={legendItems} variant="rows" showBandLabels={false} />
          </MapLegendPanel>
        )}

        {selectedProperty && (
          <MobileBcAssessmentFeatureCard
            property={selectedProperty}
            onClose={() => setSelectedProperty(null)}
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
      title={property.address}
      subtitle={property.description}
      onClose={onClose}
    >
      <div className="text-[10px] font-medium text-blue-700 dark:text-blue-300">Active property</div>
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
