import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MOBILE_FEATURE_CARD_MEDIA_QUERY, MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { Timeline } from '@/components/ui/timeline'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { formatDate } from '@/lib/format'
import { DroughtMap } from './components/DroughtMap'
import { DroughtSidebar } from './components/DroughtSidebar'
import { useDroughtData } from './hooks/useDroughtData'
import type { DroughtFeature, DroughtFeatureCollection, DroughtTimeSeriesRecord } from './types'

const DEFAULT_YEAR = 2025
const FALLBACK_YEARS = Array.from({ length: 11 }, (_, index) => 2025 - index)

const EMPTY_COLLECTION: DroughtFeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

const DROUGHT_TIMELINE_WINDOW_OPTIONS = [
  { value: 1, label: '1 wk' },
  { value: 2, label: '2 wk' },
  { value: 4, label: '4 wk' },
  { value: -1, label: 'Cumul.' },
]

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

function getTimelineWindow(dateRange: { start: Date; end: Date }, currentDate: Date, windowSize: number) {
  const start = windowSize === -1
    ? new Date(dateRange.start)
    : new Date(currentDate)
  const end = new Date(currentDate)
  if (windowSize !== -1) {
    end.setDate(end.getDate() + (windowSize * 7) - 1)
  }
  end.setHours(23, 59, 59, 999)
  return {
    startMs: start.getTime(),
    endMs: Math.min(end.getTime(), dateRange.end.getTime()),
  }
}

function recordOverlapsWindow(record: DroughtTimeSeriesRecord, startMs: number, endMs: number) {
  const start = record.startDateMs
  const end = record.endDateMs
  if (start == null && end == null) return true
  if (start != null && start > endMs) return false
  if (end != null && end < startMs) return false
  return true
}

function selectRecordForBasin(records: DroughtTimeSeriesRecord[]) {
  if (records.length === 0) return null
  return records.slice().sort((left, right) => {
    const leftLevel = left.droughtLevel ?? -1
    const rightLevel = right.droughtLevel ?? -1
    if (leftLevel !== rightLevel) return rightLevel - leftLevel
    return (right.endDateMs ?? 0) - (left.endDateMs ?? 0)
  })[0]
}

interface DroughtSectionProps {
  yearParam?: string
}

export function DroughtSection({ yearParam = 'year' }: DroughtSectionProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const isMobileViewport = useMediaQuery(MOBILE_FEATURE_CARD_MEDIA_QUERY)
  const initialYear = Number(searchParams.get(yearParam)) || DEFAULT_YEAR
  const [selectedYear, setSelectedYear] = useState(initialYear)
  const [showSidebar, setShowSidebar] = useState(true)
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [timelineWindowSize, setTimelineWindowSize] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { manifest, collection, records, yearInfo, loading, error } = useDroughtData(selectedYear)

  const availableYears = useMemo(() => {
    const years = manifest?.years.map((item) => item.year).sort((a, b) => b - a)
    return years?.length ? years : FALLBACK_YEARS
  }, [manifest])

  const dateRange = useMemo(() => {
    const start = dateFromIso(yearInfo?.startDate ?? null) ?? new Date(selectedYear, 0, 1)
    const end = dateFromIso(yearInfo?.endDate ?? null) ?? new Date(selectedYear, 11, 31)
    return { start, end }
  }, [selectedYear, yearInfo])

  // The scrub follows the end of the selected year's range until the user
  // picks a date; switching years clears the override in handleYearChange.
  const effectiveTimelineDate = timelineDate ?? dateRange.end

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    params.set(yearParam, String(selectedYear))
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [searchParams, selectedYear, setSearchParams, yearParam])

  const bucketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const record of records) {
      const startDate = dateFromIso(record.startDate)
      if (!startDate) continue
      const key = startOfWeekKey(startDate)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [records])

  const activeCollection = useMemo<DroughtFeatureCollection>(() => {
    if (!collection) return EMPTY_COLLECTION
    const recordsByBasin = new Map<string, DroughtTimeSeriesRecord[]>()
    const window = timelineEnabled && effectiveTimelineDate
      ? getTimelineWindow(dateRange, effectiveTimelineDate, timelineWindowSize)
      : null
    const candidateRecords = !timelineEnabled || !effectiveTimelineDate
      ? records
      : records.filter((record) => window && recordOverlapsWindow(record, window.startMs, window.endMs))

    for (const record of candidateRecords) {
      const basinRecords = recordsByBasin.get(record.basinId) ?? []
      basinRecords.push(record)
      recordsByBasin.set(record.basinId, basinRecords)
    }

    return {
      ...collection,
      features: collection.features.map((feature) => {
        const basinId = String(feature.properties.basinId ?? feature.id)
        const record = selectRecordForBasin(recordsByBasin.get(basinId) ?? [])
        return {
          ...feature,
          properties: {
            ...feature.properties,
            droughtLevel: record?.droughtLevel ?? null,
            droughtLevelRaw: record?.droughtLevelRaw ?? null,
            droughtColor: record?.droughtColor ?? 'rgba(0, 0, 0, 0)',
            startDate: record?.startDate ?? null,
            endDate: record?.endDate ?? null,
            startDateMs: record?.startDateMs ?? null,
            endDateMs: record?.endDateMs ?? null,
            activeRecordId: record?.id ?? null,
            sourceBasinName: record?.sourceBasinName ?? null,
          },
        }
      }),
    }
  }, [collection, dateRange, records, effectiveTimelineDate, timelineEnabled, timelineWindowSize])

  const filledBasinCount = useMemo(() => (
    activeCollection.features.filter((feature) => feature.properties.activeRecordId).length
  ), [activeCollection.features])

  const selectedFeature = useMemo(() => {
    if (!selectedId) return null
    return activeCollection.features.find((feature) => String(feature.id) === selectedId) ?? null
  }, [activeCollection.features, selectedId])

  const handleYearChange = useCallback((year: number) => {
    setSelectedYear(year)
    setTimelineDate(null)
    setSelectedId(null)
  }, [])

  const mobilePeek = (
    <div className="min-w-0 text-left">
      <div className="truncate text-xs font-semibold text-foreground">
        Drought Levels | {selectedYear}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">
        {filledBasinCount.toLocaleString()} filled basins
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
          visibleCount={filledBasinCount}
          totalCount={records.length}
          loading={loading}
          error={error}
          selectedFeature={selectedFeature}
          showSelectedFeature={!isMobileViewport}
          timelineEnabled={timelineEnabled}
          onYearChange={handleYearChange}
          onClearSelection={() => setSelectedId(null)}
          onToggleTimeline={() => setTimelineEnabled((current) => !current)}
        />
      )}
    >
      <div className="relative h-full">
        <DroughtMap
          data={activeCollection}
          selectedId={selectedId}
          onFeatureClick={(id) => setSelectedId((current) => current === id ? null : id)}
          loading={loading}
        />

        <div className="absolute right-14 top-16 z-10 rounded-md border border-border bg-background/95 px-2 py-1.5 text-[11px] shadow-lg backdrop-blur sm:right-16 sm:rounded-lg sm:px-3 sm:py-2 sm:text-xs md:right-16 md:top-4">
          <div className="font-semibold leading-tight text-foreground">{selectedYear}</div>
          <div className="leading-tight text-muted-foreground">
            {formatDate(effectiveTimelineDate, { fallback: '' })}
          </div>
        </div>

        {isMobileViewport && selectedFeature && (
          <MobileDroughtFeatureCard
            feature={selectedFeature}
            onClose={() => setSelectedId(null)}
          />
        )}

        {timelineEnabled && effectiveTimelineDate && (
          <Timeline
            startDate={dateRange.start}
            endDate={dateRange.end}
            currentDate={effectiveTimelineDate}
            onDateChange={setTimelineDate}
            onClose={() => setTimelineEnabled(false)}
            bucketCounts={bucketCounts}
            statsLabel={`${filledBasinCount.toLocaleString()} filled basins`}
            granularity="week"
            windowMode={{
              size: timelineWindowSize,
              onSizeChange: setTimelineWindowSize,
              options: DROUGHT_TIMELINE_WINDOW_OPTIONS,
            }}
          />
        )}
      </div>
    </MapSectionLayout>
  )
}

function MobileDroughtFeatureCard({
  feature,
  onClose,
}: {
  feature: DroughtFeature
  onClose: () => void
}) {
  return (
    <MobileFeatureCard
      title={feature.properties.basinName || 'Drought basin'}
      subtitle="Selected Basin"
      cardKey={String(feature.id)}
      onClose={onClose}
    >
      <div className="rounded-md border border-border bg-background p-3 text-xs text-foreground">
        <div className="space-y-1">
          {[
            { label: 'Level', value: feature.properties.droughtLevelRaw ?? 'Not updated' },
            { label: 'Start', value: feature.properties.startDate ?? 'Unknown' },
            { label: 'End', value: feature.properties.endDate ?? 'Unknown' },
          ].map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="max-w-[12rem] text-right font-medium text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </MobileFeatureCard>
  )
}
