import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Activity, ExternalLink, MapPin, Search, Stethoscope, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Map, MapControls, MapMarker, MapPopup, MarkerContent, useMap } from '@/components/ui/map'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { cn } from '@/lib/utils'
import {
  SPECIALIST_WAIT_DATA_URL,
  SPECIALIST_WAIT_MAP_CENTER,
  SPECIALIST_WAIT_MAP_ZOOM,
  buildProcedureOptions,
  compareFacilities,
  facilityMatchesFilter,
  facilityWaitMetrics,
  formatCases,
  formatWeeks,
  procedureMatchesFilter,
  searchFacility,
  waitBand,
  type FacilitySpecialist,
  type FacilityWaitMetrics,
  type PatientType,
  type SpecialistFacility,
  type SpecialistFilter,
  type SpecialistMapData,
  type SpecialistSort,
  type WaitBand,
} from './dev-wait/specialistData'

type AuthorityFilter = 'all' | string
type BandFilter = 'all' | WaitBand

const PATIENT_OPTIONS: Array<{ id: PatientType; label: string }> = [
  { id: 'all', label: 'All ages' },
  { id: 'adult', label: 'Adult' },
  { id: 'pediatric', label: 'Pediatric' },
]

const BAND_OPTIONS: Array<{ id: BandFilter; label: string; swatch: string }> = [
  { id: 'all', label: 'All', swatch: 'bg-slate-400' },
  { id: 'short', label: '< 12w', swatch: 'bg-[#0f766e]' },
  { id: 'medium', label: '12-26w', swatch: 'bg-[#b45309]' },
  { id: 'long', label: '26w+', swatch: 'bg-[#991b1b]' },
  { id: 'unknown', label: 'No P90', swatch: 'bg-[#475569]' },
]

const SORT_OPTIONS: Array<{ id: SpecialistSort; label: string }> = [
  { id: 'wait', label: 'Longest P90 wait' },
  { id: 'cases', label: 'Most known cases' },
  { id: 'specialists', label: 'Most specialists' },
  { id: 'name', label: 'Facility name (A-Z)' },
]

interface SpecialistMarkerCluster {
  id: string
  longitude: number
  latitude: number
  facilities: SpecialistFacility[]
}

const CLUSTER_RADIUS_PX = 54
const REVEAL_LIMIT = 14

function DevWaitSpecialist() {
  const [showSidebar, setShowSidebar] = useState(true)
  const [facilities, setFacilities] = useState<SpecialistFacility[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [authority, setAuthority] = useState<AuthorityFilter>('all')
  const [procedureName, setProcedureName] = useState<string>('all')
  const [patientType, setPatientType] = useState<PatientType>('all')
  const [band, setBand] = useState<BandFilter>('all')
  const [sort, setSort] = useState<SpecialistSort>('wait')
  const [selected, setSelected] = useState<SpecialistFacility | null>(null)
  const [metadata, setMetadata] = useState<SpecialistMapData['metadata'] | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(SPECIALIST_WAIT_DATA_URL, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json() as SpecialistMapData
        setFacilities(data.facilities.filter((facility) => Number.isFinite(facility.latitude) && Number.isFinite(facility.longitude)))
        setMetadata(data.metadata)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError('Failed to load BC specialist wait-time data.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadData()
    return () => controller.abort()
  }, [])

  const authorities = useMemo(() => (
    Array.from(new Set(facilities.map((facility) => facility.health_authority))).sort()
  ), [facilities])

  const procedureOptions = useMemo(() => buildProcedureOptions(facilities), [facilities])

  const filter = useMemo<SpecialistFilter>(() => ({
    procedureName: procedureName === 'all' ? null : procedureName,
    patientType,
  }), [procedureName, patientType])

  const filterActive = procedureName !== 'all' || patientType !== 'all' || band !== 'all'

  const filteredFacilities = useMemo(() => {
    const matched = facilities.filter((facility) => {
      if (authority !== 'all' && facility.health_authority !== authority) return false
      if (!facilityMatchesFilter(facility, filter)) return false
      if (band !== 'all' && waitBand(facilityWaitMetrics(facility, filter).p90MedianWeeks) !== band) return false
      return searchFacility(facility, query)
    })
    return matched.sort(compareFacilities(sort, filter))
  }, [authority, band, facilities, filter, query, sort])

  const stats = useMemo(() => {
    const visibleSpecialists = new Set<string>()
    const p90Values: number[] = []
    let knownCases = 0
    filteredFacilities.forEach((facility) => {
      facility.specialists.forEach((specialist) => {
        if (specialist.procedures.some((procedure) => procedureMatchesFilter(procedure, filter))) {
          visibleSpecialists.add(specialist.specialist_id)
        }
      })
      const metrics = facilityWaitMetrics(facility, filter)
      knownCases += metrics.knownCases
      if (metrics.p90MedianWeeks != null) p90Values.push(metrics.p90MedianWeeks)
    })
    return {
      visible: filteredFacilities.length,
      facilities: facilities.length,
      specialists: visibleSpecialists.size,
      rollups: filteredFacilities.filter((facility) => facility.is_rollup_child).length,
      knownCases,
      medianP90: medianNumber(p90Values),
    }
  }, [facilities.length, filteredFacilities, filter])

  const sidebar = (
    <aside className="flex h-full w-full flex-col bg-background/95 md:w-[380px] md:border-r md:shadow-xl">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted p-2">
            <Stethoscope className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">Surgery specialists</h1>
            <p className="mt-1 text-xs leading-4 text-muted-foreground">
              BC Surgery Wait Times by facility, specialist, and procedure.
            </p>
            <Link to="/dev/health/wait" className="mt-2 inline-flex text-xs font-medium text-sky-700 hover:underline">
              ER wait map
            </Link>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="space-y-2">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground" htmlFor="specialist-search">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="specialist-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Facility, specialist, or procedure"
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-sky-500"
            />
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Filters</div>
            {filterActive && (
              <button
                type="button"
                onClick={() => {
                  setProcedureName('all')
                  setPatientType('all')
                  setBand('all')
                }}
                className="text-[11px] font-medium text-sky-700 hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          <select
            value={authority}
            onChange={(event) => setAuthority(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            aria-label="Health authority"
          >
            <option value="all">All health authorities</option>
            {authorities.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          <select
            value={procedureName}
            onChange={(event) => setProcedureName(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            aria-label="Procedure"
          >
            <option value="all">All procedures</option>
            {procedureOptions.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name} ({option.facilityCount})
              </option>
            ))}
          </select>
        </section>

        <section className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Patient type</div>
          <div className="grid grid-cols-3 gap-1">
            {PATIENT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPatientType(option.id)}
                aria-pressed={patientType === option.id}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                  patientType === option.id
                    ? 'border-sky-500 bg-sky-500/10 text-sky-700'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">P90 wait band</div>
          <div className="grid grid-cols-5 gap-1">
            {BAND_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setBand(option.id)}
                aria-pressed={band === option.id}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[10px] font-medium transition-colors',
                  band === option.id
                    ? 'border-sky-500 bg-sky-500/10 text-sky-700'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                <span className={cn('size-2.5 rounded-sm', option.swatch)} />
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            Marker color and value reflect the median 90th-percentile wait{procedureName !== 'all' ? ` for ${procedureName}` : ''}.
          </p>
        </section>

        <section className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sort facilities</div>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SpecialistSort)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            aria-label="Sort facilities"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </section>

        <section className="border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Visible" value={`${stats.visible}/${stats.facilities}`} />
            <Stat label="Specialists" value={String(stats.specialists)} />
            <Stat label="Known cases" value={formatCases(stats.knownCases)} />
            <Stat label="Median P90" value={formatWeeks(stats.medianP90)} />
          </div>
          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
            Latest scrape run: {metadata?.latest_run_id ?? '--'}. {metadata?.procedure_count ?? '--'} procedures. {stats.rollups} Greater Victoria roll-up points.
          </div>
        </section>

        <section className="border-t border-border pt-4">
          <h2 className="mb-2 text-sm font-semibold">Facilities</h2>
          {filteredFacilities.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              No facilities match the current filters.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredFacilities.slice(0, 80).map((facility) => (
                <button
                  key={facility.id}
                  type="button"
                  onClick={() => setSelected(facility)}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted',
                    selected?.id === facility.id ? 'border-sky-500 bg-sky-500/10' : 'border-border bg-background',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">{facility.facility_name}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                      {facility.specialist_count}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {[facility.locality, facility.health_authority].filter(Boolean).join(' • ')}
                  </div>
                  <FacilityListMetrics facility={facility} filter={filter} />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={380}
      mobileInitialSheetState="collapsed"
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">{stats.visible} specialist facilities</div>
          <div className="truncate text-[11px] text-muted-foreground">BC surgery wait-time source</div>
        </div>
      )}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <Map center={SPECIALIST_WAIT_MAP_CENTER} zoom={SPECIALIST_WAIT_MAP_ZOOM} loading={loading}>
          <MapControls position="top-right" className="top-16 md:top-2" />

          <SpecialistFacilityMarkers
            facilities={filteredFacilities}
            filter={filter}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
          />

          {selected && (
            <MapPopup
              longitude={selected.longitude}
              latitude={selected.latitude}
              onClose={() => setSelected(null)}
              closeButton={false}
            >
              <SpecialistFacilityPopup facility={selected} filter={filter} onClose={() => setSelected(null)} />
            </MapPopup>
          )}
        </Map>

        {error && (
          <div className="absolute left-3 top-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shadow">
            {error}
          </div>
        )}
      </div>
    </MapSectionLayout>
  )
}

function SpecialistFacilityMarkers({
  facilities,
  filter,
  selectedId,
  onSelect,
}: {
  facilities: SpecialistFacility[]
  filter: SpecialistFilter
  selectedId: string | null
  onSelect: (facility: SpecialistFacility) => void
}) {
  const { map } = useMap()
  const [version, setVersion] = useState(0)
  const [revealedClusterId, setRevealedClusterId] = useState<string | null>(null)

  useEffect(() => {
    if (!map) return
    const update = () => setVersion((current) => current + 1)
    update()
    map.on('moveend', update)
    map.on('zoomend', update)
    map.on('resize', update)
    return () => {
      map.off('moveend', update)
      map.off('zoomend', update)
      map.off('resize', update)
    }
  }, [map])

  useEffect(() => {
    setRevealedClusterId(null)
  }, [facilities])

  const clusters = useMemo(() => {
    if (!map) {
      return facilities.map((facility) => ({
        id: facility.id,
        longitude: facility.longitude,
        latitude: facility.latitude,
        facilities: [facility],
      }))
    }

    const canvas = map.getCanvas()
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const nextClusters: Array<SpecialistMarkerCluster & { x: number; y: number }> = []
    const orderedFacilities = [...facilities].sort((a, b) => markerPriority(a, filter) - markerPriority(b, filter))

    for (const facility of orderedFacilities) {
      const point = map.project([facility.longitude, facility.latitude])
      if (point.x < -140 || point.y < -140 || point.x > width + 140 || point.y > height + 140) continue

      let cluster = nextClusters.find((candidate) => (
        Math.hypot(candidate.x - point.x, candidate.y - point.y) <= CLUSTER_RADIUS_PX
      ))

      if (!cluster) {
        cluster = {
          id: `specialist-cluster-${Math.round(point.x)}-${Math.round(point.y)}-${facility.id}`,
          x: point.x,
          y: point.y,
          longitude: facility.longitude,
          latitude: facility.latitude,
          facilities: [],
        }
        nextClusters.push(cluster)
      }

      cluster.facilities.push(facility)
      const count = cluster.facilities.length
      cluster.x = cluster.x + (point.x - cluster.x) / count
      cluster.y = cluster.y + (point.y - cluster.y) / count
      cluster.longitude = cluster.longitude + (facility.longitude - cluster.longitude) / count
      cluster.latitude = cluster.latitude + (facility.latitude - cluster.latitude) / count
    }

    return nextClusters.map(({ x: _x, y: _y, ...cluster }) => cluster)
  }, [facilities, filter, map, version])

  return (
    <>
      {clusters.map((cluster) => {
        if (cluster.facilities.length === 1) {
          const facility = cluster.facilities[0]
          return (
            <SpecialistFacilityMarker
              key={facility.id}
              facility={facility}
              filter={filter}
              selected={selectedId === facility.id}
              onSelect={onSelect}
            />
          )
        }

        const isRevealed = revealedClusterId === cluster.id
        const visibleFacilities = cluster.facilities.slice(0, REVEAL_LIMIT)
        return (
          <div key={cluster.id}>
            <MapMarker longitude={cluster.longitude} latitude={cluster.latitude} anchor="center">
              <MarkerContent>
                <button
                  type="button"
                  onClick={() => setRevealedClusterId((current) => current === cluster.id ? null : cluster.id)}
                  aria-label={`${isRevealed ? 'Hide' : 'Reveal'} ${cluster.facilities.length} facilities`}
                  aria-pressed={isRevealed}
                  className={cn(
                    'flex items-center justify-center rounded-full border-2 border-white text-sm font-bold text-white shadow-md transition-transform hover:scale-105',
                    clusterStyle(cluster.facilities.length),
                    !isRevealed && 'wait-cluster-pulse',
                    isRevealed && 'ring-2 ring-sky-400 ring-offset-2 ring-offset-background',
                  )}
                >
                  {cluster.facilities.length}
                </button>
              </MarkerContent>
            </MapMarker>

            {isRevealed && visibleFacilities.map((facility, index) => (
              <SpecialistFacilityMarker
                key={`${cluster.id}-${facility.id}`}
                facility={facility}
                filter={filter}
                longitude={cluster.longitude}
                latitude={cluster.latitude}
                selected={selectedId === facility.id}
                onSelect={onSelect}
                visualOffset={revealOffset(index, visibleFacilities.length)}
                revealIndex={index}
              />
            ))}

            {isRevealed && cluster.facilities.length > visibleFacilities.length && (
              <MapMarker longitude={cluster.longitude} latitude={cluster.latitude} anchor="center">
                <MarkerContent>
                  <span
                    className="wait-cluster-reveal rounded-full border-2 border-white bg-[#475569] px-2.5 py-1.5 text-xs font-bold text-white shadow-md"
                    style={{
                      ...visualOffsetStyle(revealOffset(visibleFacilities.length, visibleFacilities.length + 1)),
                      animationDelay: `${Math.min(180, visibleFacilities.length * 16)}ms`,
                    }}
                  >
                    +{cluster.facilities.length - visibleFacilities.length}
                  </span>
                </MarkerContent>
              </MapMarker>
            )}
          </div>
        )
      })}
    </>
  )
}

function SpecialistFacilityMarker({
  facility,
  filter,
  longitude = facility.longitude,
  latitude = facility.latitude,
  selected,
  onSelect,
  visualOffset,
  revealIndex,
}: {
  facility: SpecialistFacility
  filter: SpecialistFilter
  longitude?: number
  latitude?: number
  selected: boolean
  onSelect: (facility: SpecialistFacility) => void
  visualOffset?: [number, number]
  revealIndex?: number
}) {
  const metrics = facilityWaitMetrics(facility, filter)
  const markerText = metrics.p90MedianWeeks == null
    ? String(metrics.procedureRows || facility.specialist_count)
    : formatWeeks(metrics.p90MedianWeeks)

  return (
    <MapMarker longitude={longitude} latitude={latitude} anchor="center">
      <MarkerContent>
        <div
          className={cn(visualOffset && 'wait-cluster-reveal')}
          style={visualOffset ? {
            ...visualOffsetStyle(visualOffset),
            animationDelay: `${Math.min(160, (revealIndex ?? 0) * 18)}ms`,
          } : undefined}
        >
          <button
            type="button"
            onClick={() => onSelect(facility)}
            aria-label={`${facility.facility_name}: median P90 ${formatWeeks(metrics.p90MedianWeeks)}, ${facility.specialist_count} specialists`}
            className={cn(
              'relative rounded-full border-2 px-3 py-1.5 text-[13px] font-semibold leading-none text-white shadow-md transition-transform hover:scale-105',
              facility.is_rollup_child ? 'border-amber-100 bg-[#9a5b13]' : markerClass(metrics),
              selected && 'ring-2 ring-sky-400 ring-offset-2 ring-offset-background',
            )}
          >
            {markerText}
            {facility.is_rollup_child && (
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-amber-950">
                R
              </span>
            )}
          </button>
        </div>
      </MarkerContent>
    </MapMarker>
  )
}

function SpecialistFacilityPopup({ facility, filter, onClose }: { facility: SpecialistFacility; filter: SpecialistFilter; onClose: () => void }) {
  const filterActive = Boolean(filter.procedureName) || (filter.patientType != null && filter.patientType !== 'all')
  const metrics = facilityWaitMetrics(facility, filter)
  const matchingSpecialists = facility.specialists
    .filter((specialist) => specialist.procedures.some((procedure) => procedureMatchesFilter(procedure, filter)))
  const matchingProcedures = facility.procedures.filter((procedure) => {
    if (filter.procedureName && procedure.name !== filter.procedureName) return false
    if (filter.patientType === 'adult' && procedure.adult_flag !== 'Y') return false
    if (filter.patientType === 'pediatric' && procedure.adult_flag !== 'N') return false
    return true
  })
  const topSpecialists = matchingSpecialists.slice(0, 8)
  const topProcedures = matchingProcedures.slice(0, 6)
  const specialistCount = filterActive ? matchingSpecialists.length : facility.specialist_count
  const procedureCount = filterActive ? matchingProcedures.length : facility.procedure_count

  return (
    <div className="w-80 overflow-hidden rounded-md bg-popover text-popover-foreground">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase text-muted-foreground">
            {facility.is_rollup_child ? 'Roll-up child point' : 'Surgery facility'}
          </div>
          <div className="mt-0.5 text-sm font-semibold leading-5">{facility.facility_name}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {[facility.address, facility.locality].filter(Boolean).join(', ')}
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close popup">
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-3 px-3 py-3">
        <div className="grid grid-cols-3 gap-2">
          <PopupStat icon={<Stethoscope className="size-3.5" />} label="Specialists" value={specialistCount} />
          <PopupStat icon={<Activity className="size-3.5" />} label="Procedures" value={procedureCount} />
          <PopupStat icon={<MapPin className="size-3.5" />} label="Known cases" value={formatCases(metrics.knownCases)} />
          <PopupStat icon={<Activity className="size-3.5" />} label="Median P50" value={formatWeeks(metrics.p50MedianWeeks)} />
          <PopupStat icon={<Activity className="size-3.5" />} label="Median P90" value={formatWeeks(metrics.p90MedianWeeks)} />
          <PopupStat icon={<MapPin className="size-3.5" />} label="Rows" value={metrics.procedureRows} />
        </div>

        {facility.is_rollup_child && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            Source rows are reported as Greater Victoria Hospitals and are not separated between Royal Jubilee and Victoria General.
          </div>
        )}

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top specialists</h3>
          <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
            {topSpecialists.map((specialist) => (
              <SpecialistRow key={specialist.specialist_id} specialist={specialist} filter={filter} />
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Common procedures</h3>
          <div className="space-y-1">
            {topProcedures.map((procedure) => (
              <div key={procedure.procedure_key} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate">{procedure.name}</span>
                <span className="shrink-0 text-muted-foreground">{procedure.row_count}</span>
              </div>
            ))}
          </div>
        </section>

        {facility.source_url && (
          <a
            href={facility.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline"
          >
            Location source <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  )
}

function SpecialistRow({ specialist, filter }: { specialist: FacilitySpecialist; filter: SpecialistFilter }) {
  const firstProcedure = specialist.procedures.find((procedure) => procedureMatchesFilter(procedure, filter))
    ?? specialist.procedures[0]

  return (
    <div className="rounded-md border border-border bg-muted/25 px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{specialist.specialist_name}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{firstProcedure?.procedure_name ?? 'Procedure unavailable'}</div>
        </div>
        <div className="shrink-0 text-right text-xs">
          <div className="font-semibold">{specialist.procedure_count}</div>
          <div className="text-muted-foreground">procedures</div>
        </div>
      </div>
      {firstProcedure && (
        <div className="mt-1.5 grid grid-cols-3 gap-1 text-[11px] text-muted-foreground">
          <span>Cases {firstProcedure.cases_waiting_raw ?? formatCases(firstProcedure.cases_waiting)}</span>
          <span>P50 {formatWeeks(firstProcedure.p50_weeks)}</span>
          <span>P90 {formatWeeks(firstProcedure.p90_weeks)}</span>
        </div>
      )}
    </div>
  )
}

function PopupStat({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase">{label}</span>
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  )
}

function FacilityListMetrics({ facility, filter }: { facility: SpecialistFacility; filter: SpecialistFilter }) {
  const metrics = facilityWaitMetrics(facility, filter)

  return (
    <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-muted-foreground">
      <span>P50 {formatWeeks(metrics.p50MedianWeeks)}</span>
      <span>P90 {formatWeeks(metrics.p90MedianWeeks)}</span>
      <span>Cases {formatCases(metrics.knownCases)}</span>
    </div>
  )
}

function clusterStyle(count: number): string {
  if (count >= 20) return 'size-12 bg-[#111827] text-[15px] shadow-lg'
  if (count >= 10) return 'size-11 bg-[#334155] text-sm'
  if (count >= 5) return 'size-10 bg-[#475569] text-sm'
  return 'size-9 bg-[#64748b] text-sm'
}

function markerClass(metrics: FacilityWaitMetrics): string {
  const band = waitBand(metrics.p90MedianWeeks)
  if (band === 'short') return 'border-white bg-[#0f766e]'
  if (band === 'medium') return 'border-white bg-[#b45309]'
  if (band === 'long') return 'border-white bg-[#991b1b]'
  return 'border-white bg-[#475569]'
}

function markerPriority(facility: SpecialistFacility, filter: SpecialistFilter): number {
  if (facility.is_rollup_child) return 0
  const metrics = facilityWaitMetrics(facility, filter)
  const band = waitBand(metrics.p90MedianWeeks)
  if (band === 'long') return 1
  if (band === 'medium') return 2
  if (band === 'short') return 3
  return 4
}

function revealOffset(index: number, count: number): [number, number] {
  if (count <= 1) return [0, -46]
  const ring = Math.floor(index / 8)
  const ringIndex = index % 8
  const ringCount = Math.min(8, count - ring * 8)
  const radius = 54 + ring * 32
  const angle = (-Math.PI / 2) + (ringIndex / ringCount) * Math.PI * 2
  return [Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)]
}

function visualOffsetStyle(offset: [number, number]) {
  return {
    '--wait-reveal-x': `${offset[0]}px`,
    '--wait-reveal-y': `${offset[1]}px`,
  } as CSSProperties
}

function medianNumber(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export default DevWaitSpecialist
