import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Activity, MapPin, Stethoscope } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Map, MapControls, MapMarker, MapPopup, MarkerContent, useMap } from '@/components/ui/map'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { FilterChipGroup, InlineAlert, MapSidebarShell, SearchInput, SidebarSection } from '@/components/ui/map-panels'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { AppSelect } from '@/components/ui/select'
import { StatGroup } from '@/components/ui/stat-group'
import { ExternalLink, TextButton } from '@/components/ui/text-button'
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
  type PatientType,
  type SpecialistFacility,
  type SpecialistFilter,
  type SpecialistMapData,
  type SpecialistSort,
  type WaitBand,
} from './dev-wait/specialistData'

type AuthorityFilter = 'all' | string
type BandFilter = 'all' | WaitBand

const PATIENT_OPTIONS: Array<{ value: PatientType; label: string }> = [
  { value: 'all', label: 'All ages' },
  { value: 'adult', label: 'Adult' },
  { value: 'pediatric', label: 'Pediatric' },
]

/** Marker fill per P90 band; the band filter chips read the same colours. */
const BAND_COLORS: Record<WaitBand, string> = {
  short: '#0f766e',
  medium: '#b45309',
  long: '#991b1b',
  unknown: '#475569',
}

const BAND_OPTIONS: Array<{ value: BandFilter; label: string; color: string }> = [
  { value: 'all', label: 'All', color: '#94a3b8' },
  { value: 'short', label: '< 12w', color: BAND_COLORS.short },
  { value: 'medium', label: '12-26w', color: BAND_COLORS.medium },
  { value: 'long', label: '26w+', color: BAND_COLORS.long },
  { value: 'unknown', label: 'No P90', color: BAND_COLORS.unknown },
]

const SORT_OPTIONS: Array<{ value: SpecialistSort; label: string }> = [
  { value: 'wait', label: 'Longest P90 wait' },
  { value: 'cases', label: 'Most known cases' },
  { value: 'specialists', label: 'Most specialists' },
  { value: 'name', label: 'Facility name (A-Z)' },
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
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title="Surgery specialists"
      subtitle={(
        <>
          BC Surgery Wait Times by facility, specialist, and procedure.
          <Link to="/dev/health/wait" className="mt-1 block text-xs font-medium text-sky-700 hover:underline dark:text-sky-400">
            ER wait map
          </Link>
        </>
      )}
      icon={Stethoscope}
    >
      <SidebarSection title="Search">
        <SearchInput
          id="specialist-search"
          icon
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Facility, specialist, or procedure"
          aria-label="Search facilities, specialists, or procedures"
        />
      </SidebarSection>

      <SidebarSection
        title="Filters"
        actions={filterActive && (
          <TextButton
            onClick={() => {
              setProcedureName('all')
              setPatientType('all')
              setBand('all')
            }}
          >
            Clear
          </TextButton>
        )}
      >
        <div className="space-y-2">
          <AppSelect
            value={authority}
            onValueChange={setAuthority}
            options={[
              { value: 'all', label: 'All health authorities' },
              ...authorities.map((name) => ({ value: name, label: name })),
            ]}
            triggerAriaLabel="Health authority"
            className="w-full"
            triggerClassName="h-9 rounded-md text-sm"
          />
          <AppSelect
            value={procedureName}
            onValueChange={setProcedureName}
            options={[
              { value: 'all', label: 'All procedures' },
              ...procedureOptions.map((option) => ({ value: option.name, label: `${option.name} (${option.facilityCount})` })),
            ]}
            triggerAriaLabel="Procedure"
            className="w-full"
            triggerClassName="h-9 rounded-md text-sm"
          />
        </div>
      </SidebarSection>

      <SidebarSection title="Patient type">
        <SegmentedControl<PatientType>
          label="Patient type"
          value={patientType}
          options={PATIENT_OPTIONS}
          onChange={setPatientType}
        />
      </SidebarSection>

      <SidebarSection title="P90 wait band">
        <FilterChipGroup<BandFilter>
          layout="grid"
          columns={3}
          items={BAND_OPTIONS}
          selectedValues={[band]}
          onToggle={setBand}
          chipClassName="justify-center rounded-md py-1.5"
        />
        <p className="mt-2 text-xs leading-4 text-muted-foreground">
          Marker color and value reflect the median 90th-percentile wait{procedureName !== 'all' ? ` for ${procedureName}` : ''}.
        </p>
      </SidebarSection>

      <SidebarSection title="Sort facilities">
        <AppSelect
          value={sort}
          onValueChange={(value) => setSort(value as SpecialistSort)}
          options={SORT_OPTIONS}
          triggerAriaLabel="Sort facilities"
          className="w-full"
          triggerClassName="h-9 rounded-md text-sm"
        />
      </SidebarSection>

      <SidebarSection>
        <StatGroup
          variant="tiles"
          size="sm"
          columns={2}
          items={[
            { label: 'Visible', value: `${stats.visible}/${stats.facilities}` },
            { label: 'Specialists', value: String(stats.specialists) },
            { label: 'Known cases', value: formatCases(stats.knownCases) },
            { label: 'Median P90', value: formatWeeks(stats.medianP90) },
          ]}
        />
        <InlineAlert className="mt-3">
          Latest scrape run: {metadata?.latest_run_id ?? '--'}. {metadata?.procedure_count ?? '--'} procedures. {stats.rollups} Greater Victoria roll-up points.
        </InlineAlert>
      </SidebarSection>

      <SidebarSection title="Facilities">
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
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">
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
      </SidebarSection>
    </MapSidebarShell>
  )

  return (
    <MapSectionLayout
      desktopSidebarWidth={380}
      mobileInitialSheetState="collapsed"
      mobilePeekTitle={`${stats.visible} specialist facilities`}
      mobilePeekSubtitle="BC surgery wait-time source"
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <Map
          center={SPECIALIST_WAIT_MAP_CENTER}
          zoom={SPECIALIST_WAIT_MAP_ZOOM}
          loading={loading}
          controls={<MapControls position="top-right" className="top-16 md:top-2" />}
        >

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
          <InlineAlert tone="error" className="absolute left-3 top-3 z-10 text-sm shadow">
            {error}
          </InlineAlert>
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
  const [revealedClusterId, setRevealedClusterId] = useState<{
    clusterId: string
    facilitiesKey: string
  } | null>(null)

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

  const facilitiesKey = useMemo(() => facilities.map((facility) => facility.id).join('|'), [facilities])

  const clusters = useMemo(() => {
    void version

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
  const activeRevealedClusterId = revealedClusterId?.facilitiesKey === facilitiesKey
    ? revealedClusterId.clusterId
    : null

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

        const isRevealed = activeRevealedClusterId === cluster.id
        const visibleFacilities = cluster.facilities.slice(0, REVEAL_LIMIT)
        return (
          <div key={cluster.id}>
            <MapMarker longitude={cluster.longitude} latitude={cluster.latitude} anchor="center">
              <MarkerContent>
                <button
                  type="button"
                  onClick={() => setRevealedClusterId((current) => (
                    current?.clusterId === cluster.id && current.facilitiesKey === facilitiesKey
                      ? null
                      : { clusterId: cluster.id, facilitiesKey }
                  ))}
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
              facility.is_rollup_child ? 'border-amber-100 bg-[#9a5b13]' : 'border-white',
              selected && 'ring-2 ring-sky-400 ring-offset-2 ring-offset-background',
            )}
            style={facility.is_rollup_child ? undefined : { backgroundColor: BAND_COLORS[waitBand(metrics.p90MedianWeeks)] }}
          >
            {markerText}
            {facility.is_rollup_child && (
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-amber-950">
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
    <MapPopupCard
      className="w-72"
      eyebrow={facility.is_rollup_child ? 'Roll-up child point' : 'Surgery facility'}
      title={facility.facility_name}
      subtitle={[facility.address, facility.locality].filter(Boolean).join(', ')}
      onClose={onClose}
      closeLabel="Close popup"
      actions={facility.source_url && <ExternalLink href={facility.source_url}>Location source</ExternalLink>}
    >
      <div className="space-y-3">
        <StatGroup
          variant="tiles"
          size="sm"
          columns={3}
          items={[
            { label: 'Specialists', value: specialistCount, icon: <Stethoscope className="size-3.5" /> },
            { label: 'Procedures', value: procedureCount, icon: <Activity className="size-3.5" /> },
            { label: 'Known cases', value: formatCases(metrics.knownCases), icon: <MapPin className="size-3.5" /> },
            { label: 'Median P50', value: formatWeeks(metrics.p50MedianWeeks), icon: <Activity className="size-3.5" /> },
            { label: 'Median P90', value: formatWeeks(metrics.p90MedianWeeks), icon: <Activity className="size-3.5" /> },
            { label: 'Rows', value: metrics.procedureRows, icon: <MapPin className="size-3.5" /> },
          ]}
        />

        {facility.is_rollup_child && (
          <InlineAlert tone="warning">
            Source rows are reported as Greater Victoria Hospitals and are not separated between Royal Jubilee and Victoria General.
          </InlineAlert>
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
      </div>
    </MapPopupCard>
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
        <div className="mt-1.5 grid grid-cols-3 gap-1 text-xs text-muted-foreground">
          <span>Cases {firstProcedure.cases_waiting_raw ?? formatCases(firstProcedure.cases_waiting)}</span>
          <span>P50 {formatWeeks(firstProcedure.p50_weeks)}</span>
          <span>P90 {formatWeeks(firstProcedure.p90_weeks)}</span>
        </div>
      )}
    </div>
  )
}

function FacilityListMetrics({ facility, filter }: { facility: SpecialistFacility; filter: SpecialistFilter }) {
  const metrics = facilityWaitMetrics(facility, filter)

  return (
    <div className="mt-2 grid grid-cols-3 gap-1 text-xs text-muted-foreground">
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
