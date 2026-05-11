import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Timeline } from '@/components/ui/timeline'
import { DroughtMap } from './components/DroughtMap'
import { DroughtSidebar } from './components/DroughtSidebar'
import { useDroughtData } from './hooks/useDroughtData'
import type { DroughtFeature, DroughtFeatureCollection } from './types'

const DEFAULT_YEAR = 2025
const FALLBACK_YEARS = Array.from({ length: 11 }, (_, index) => 2025 - index)

const EMPTY_COLLECTION: DroughtFeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

function dateFromIso(value: string | null) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfWeekKey(date: Date) {
  const week = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  week.setDate(week.getDate() - week.getDay())
  return week.toISOString().slice(0, 10)
}

function featureIsActive(feature: DroughtFeature, currentDate: Date) {
  const current = currentDate.getTime()
  const start = feature.properties.startDateMs
  const end = feature.properties.endDateMs
  if (start == null && end == null) return true
  if (start != null && current < start) return false
  if (end != null && current > end) return false
  return true
}

export function DroughtSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialYear = Number(searchParams.get('year')) || DEFAULT_YEAR
  const [selectedYear, setSelectedYear] = useState(initialYear)
  const [showSidebar, setShowSidebar] = useState(true)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { manifest, collection, loading, error } = useDroughtData(selectedYear)

  const availableYears = useMemo(() => {
    const years = manifest?.years.map((item) => item.year).sort((a, b) => b - a)
    return years?.length ? years : FALLBACK_YEARS
  }, [manifest])

  const dateRange = useMemo(() => {
    const yearInfo = manifest?.years.find((item) => item.year === selectedYear)
    const start = dateFromIso(yearInfo?.startDate ?? null) ?? new Date(selectedYear, 0, 1)
    const end = dateFromIso(yearInfo?.endDate ?? null) ?? new Date(selectedYear, 11, 31)
    return { start, end }
  }, [manifest, selectedYear])

  useEffect(() => {
    setTimelineDate(dateRange.end)
    setSelectedId(null)
  }, [dateRange.end, selectedYear])

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    params.set('year', String(selectedYear))
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [searchParams, selectedYear, setSearchParams])

  const bucketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const feature of collection?.features ?? []) {
      const startDate = dateFromIso(feature.properties.startDate)
      if (!startDate) continue
      const key = startOfWeekKey(startDate)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [collection])

  const activeCollection = useMemo<DroughtFeatureCollection>(() => {
    if (!collection || !timelineDate) return collection ?? EMPTY_COLLECTION
    return {
      ...collection,
      features: collection.features.filter((feature) => featureIsActive(feature, timelineDate)),
    }
  }, [collection, timelineDate])

  const selectedFeature = useMemo(() => {
    if (!selectedId) return null
    return activeCollection.features.find((feature) => String(feature.id) === selectedId) ?? null
  }, [activeCollection.features, selectedId])

  useEffect(() => {
    if (!selectedId) return
    if (!activeCollection.features.some((feature) => String(feature.id) === selectedId)) {
      setSelectedId(null)
    }
  }, [activeCollection.features, selectedId])

  const handleYearChange = useCallback((year: number) => {
    setSelectedYear(year)
  }, [])

  const mobilePeek = (
    <div className="min-w-0 text-left">
      <div className="truncate text-xs font-semibold text-foreground">
        Drought Levels | {selectedYear}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">
        {activeCollection.features.length.toLocaleString()} active basin records
      </div>
    </div>
  )

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      mobilePeek={mobilePeek}
      sidebar={(
        <DroughtSidebar
          className="h-full w-full border-0 shadow-none md:w-[350px] md:border-r md:shadow-xl"
          manifest={manifest}
          selectedYear={selectedYear}
          availableYears={availableYears}
          visibleCount={activeCollection.features.length}
          totalCount={collection?.features.length ?? 0}
          loading={loading}
          error={error}
          selectedFeature={selectedFeature}
          onYearChange={handleYearChange}
          onClearSelection={() => setSelectedId(null)}
        />
      )}
    >
      <div className="relative h-full">
        <DroughtMap
          data={activeCollection}
          selectedId={selectedId}
          onFeatureClick={setSelectedId}
        />

        <div className="absolute right-4 top-4 z-10 rounded-lg border border-border bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur md:right-16">
          <div className="font-semibold text-foreground">{selectedYear}</div>
          <div className="text-muted-foreground">
            {timelineDate?.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>

        {timelineDate && (
          <Timeline
            startDate={dateRange.start}
            endDate={dateRange.end}
            currentDate={timelineDate}
            onDateChange={setTimelineDate}
            bucketCounts={bucketCounts}
            statsLabel={`${activeCollection.features.length.toLocaleString()} active records`}
            granularity="week"
          />
        )}
      </div>
    </MapSectionLayout>
  )
}
