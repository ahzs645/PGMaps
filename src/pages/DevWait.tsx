import { useEffect, useMemo, useState } from 'react'
import { Clock3 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Map, MapControls, MapMarker, MapPopup, MarkerContent, useMap } from '@/components/ui/map'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import {
  FilterChipGroup,
  InlineAlert,
  KeyValueRows,
  LegendItem,
  MapLegendNote,
  MapLegendPanel,
  MapSidebarShell,
  SearchInput,
  SidebarSection,
} from '@/components/ui/map-panels'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { AppSelect } from '@/components/ui/select'
import { StatGroup } from '@/components/ui/stat-group'
import { cn } from '@/lib/utils'
import {
  PROVINCE_NAMES,
  WAIT_DATA_URL,
  WAIT_MAP_CENTER,
  WAIT_MAP_ZOOM,
  formatWait,
  newestTimestamp,
  normalizeHospital,
  type ErstatHospital,
  type WaitHospital,
  type WaitSource,
  type WaitStatus,
} from './dev-wait/data'

type SourceFilter = 'all' | WaitSource | 'closed'

interface MarkerCluster {
  id: string
  longitude: number
  latitude: number
  hospitals: WaitHospital[]
}

const CLUSTER_RADIUS_PX = 54

const SOURCE_FILTERS: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'official', label: 'Official' },
  { value: 'predicted', label: 'Predicted' },
  { value: 'none', label: 'No data' },
  { value: 'closed', label: 'Closed' },
]

const LEGEND_STATUSES: WaitStatus[] = ['quick', 'moderate', 'packed', 'unknown', 'closed']

const STATUS_META: Record<WaitStatus, { label: string; color: string; marker: string }> = {
  quick: {
    label: '< 2h',
    color: '#10b981',
    marker: 'border-white bg-[#10b981] text-white',
  },
  moderate: {
    label: '2-5h',
    color: '#ea7a0a',
    marker: 'border-white bg-[#ea7a0a] text-white',
  },
  packed: {
    label: '5h+',
    color: '#ef4444',
    marker: 'border-white bg-[#ef4444] text-white',
  },
  unknown: {
    label: 'No data',
    color: '#94a3b8',
    marker: 'border-white/80 bg-[#94a3b8] text-white opacity-90 dark:bg-slate-600 dark:text-slate-100',
  },
  closed: {
    label: 'Closed',
    color: '#1f2937',
    marker: 'border-red-500 bg-[#1f2937] text-white shadow-[0_0_0_3px_rgba(239,68,68,0.24)]',
  },
}

function DevWait() {
  const [hospitals, setHospitals] = useState<WaitHospital[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [province, setProvince] = useState('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<WaitHospital | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadHospitals() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(WAIT_DATA_URL, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json() as ErstatHospital[]
        setHospitals(data.filter((item) => item.has_er && Number.isFinite(item.lat) && Number.isFinite(item.lng)).map(normalizeHospital))
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError('Failed to load ERStat hospital data.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadHospitals()
    return () => controller.abort()
  }, [])

  const provinces = useMemo(() => {
    const codes = new Set(hospitals.map((hospitalItem) => hospitalItem.province).filter((value): value is string => Boolean(value)))
    return Array.from(codes).sort()
  }, [hospitals])

  const filteredHospitals = useMemo(() => {
    const term = query.trim().toLowerCase()
    return hospitals.filter((hospitalItem) => {
      if (province !== 'all' && hospitalItem.province !== province) return false
      if (source === 'closed' && hospitalItem.status !== 'closed') return false
      if (source !== 'all' && source !== 'closed' && hospitalItem.source !== source) return false
      if (!term) return true
      return [hospitalItem.name, hospitalItem.city, hospitalItem.province]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(term))
    })
  }, [hospitals, province, query, source])

  const stats = useMemo(() => {
    const live = hospitals.filter((hospitalItem) => hospitalItem.source === 'official').length
    const predicted = hospitals.filter((hospitalItem) => hospitalItem.source === 'predicted').length
    const closed = hospitals.filter((hospitalItem) => hospitalItem.status === 'closed').length
    return {
      total: hospitals.length,
      visible: filteredHospitals.length,
      live,
      predicted,
      closed,
      newest: newestTimestamp(hospitals),
    }
  }, [filteredHospitals.length, hospitals])

  const sidebar = (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title="ER wait times"
      subtitle={(
        <>
          ERStat-style wait labels using local captured hospital data.
          <Link to="/dev/health/wait/specialist" className="mt-1 block text-xs font-medium text-sky-700 hover:underline dark:text-sky-400">
            Surgery specialist map
          </Link>
        </>
      )}
      icon={Clock3}
    >
      <SidebarSection title="Search">
        <SearchInput
          id="wait-search"
          icon
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Hospital or city"
          aria-label="Search hospitals"
        />
      </SidebarSection>

      <SidebarSection title="Province">
        <AppSelect
          value={province}
          onValueChange={setProvince}
          options={[
            { value: 'all', label: 'Canada' },
            ...provinces.map((code) => ({ value: code, label: PROVINCE_NAMES[code] ?? code })),
          ]}
          triggerAriaLabel="Province"
          className="w-full"
          triggerClassName="h-9 rounded-md text-sm"
        />
      </SidebarSection>

      <SidebarSection title="Markers">
        <FilterChipGroup<SourceFilter>
          layout="grid"
          columns={2}
          showDot={false}
          items={SOURCE_FILTERS}
          selectedValues={[source]}
          onToggle={setSource}
          selectedClassName="border-sky-500 text-sky-700 dark:text-sky-300"
          chipClassName="justify-center rounded-md py-1.5"
        />
      </SidebarSection>

      <SidebarSection>
        <StatGroup
          variant="tiles"
          size="sm"
          columns={2}
          items={[
            { label: 'Visible', value: `${stats.visible}/${stats.total}` },
            { label: 'Official', value: String(stats.live) },
            { label: 'Predicted', value: String(stats.predicted) },
            { label: 'Closed', value: String(stats.closed) },
          ]}
        />
        {stats.newest && (
          <InlineAlert className="mt-3">Latest timestamp: {stats.newest}</InlineAlert>
        )}
      </SidebarSection>
    </MapSidebarShell>
  )

  return (
    <MapSectionLayout
      desktopSidebarWidth={360}
      mobileInitialSheetState="collapsed"
      mobilePeekTitle={`${stats.visible} ER markers`}
      mobilePeekSubtitle="Wait-time labels and ER status"
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <Map
          center={WAIT_MAP_CENTER}
          zoom={WAIT_MAP_ZOOM}
          loading={loading}
          controls={<MapControls position="top-right" className="top-16 md:top-2" />}
        >

          <WaitMarkers
            hospitals={filteredHospitals}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
          />

          {selected && (
            <MapPopup
              longitude={selected.lng}
              latitude={selected.lat}
              onClose={() => setSelected(null)}
              closeButton={false}
            >
              <HospitalPopup hospitalItem={selected} onClose={() => setSelected(null)} />
            </MapPopup>
          )}

          <MapLegendPanel title="Legend" collapsible defaultCollapsed="mobile" width="sm">
            <div className="space-y-1 text-xs">
              {LEGEND_STATUSES.map((status) => (
                <LegendItem key={status} color={STATUS_META[status].color} label={STATUS_META[status].label} swatchShape="square" />
              ))}
            </div>
            <MapLegendNote className="mt-2 px-0">
              Green, orange, and red are live wait thresholds. Gray pills are predicted or no-data markers. Dense areas collapse to dark count bubbles; click one to zoom in and split it into sub-clusters.
            </MapLegendNote>
          </MapLegendPanel>
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

function WaitMarkers({
  hospitals,
  selectedId,
  onSelect,
}: {
  hospitals: WaitHospital[]
  selectedId: string | null
  onSelect: (hospitalItem: WaitHospital) => void
}) {
  const { map } = useMap()
  const [version, setVersion] = useState(0)

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

  const clusters = useMemo(() => {
    void version

    if (!map) {
      return hospitals.map((hospitalItem) => ({
        id: hospitalItem.id,
        longitude: hospitalItem.lng,
        latitude: hospitalItem.lat,
        hospitals: [hospitalItem],
      }))
    }

    const canvas = map.getCanvas()
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const nextClusters: Array<MarkerCluster & { x: number; y: number }> = []
    const orderedHospitals = [...hospitals].sort((a, b) => markerPriority(a) - markerPriority(b))

    for (const hospitalItem of orderedHospitals) {
      const point = map.project([hospitalItem.lng, hospitalItem.lat])
      if (point.x < -140 || point.y < -140 || point.x > width + 140 || point.y > height + 140) continue

      let cluster = nextClusters.find((candidate) => (
        Math.hypot(candidate.x - point.x, candidate.y - point.y) <= CLUSTER_RADIUS_PX
      ))

      if (!cluster) {
        cluster = {
          id: `cluster-${Math.round(point.x)}-${Math.round(point.y)}-${hospitalItem.id}`,
          x: point.x,
          y: point.y,
          longitude: hospitalItem.lng,
          latitude: hospitalItem.lat,
          hospitals: [],
        }
        nextClusters.push(cluster)
      }

      cluster.hospitals.push(hospitalItem)
      const count = cluster.hospitals.length
      cluster.x = cluster.x + (point.x - cluster.x) / count
      cluster.y = cluster.y + (point.y - cluster.y) / count
      cluster.longitude = cluster.longitude + (hospitalItem.lng - cluster.longitude) / count
      cluster.latitude = cluster.latitude + (hospitalItem.lat - cluster.latitude) / count
    }

    return nextClusters.map(({ x: _x, y: _y, ...cluster }) => cluster)
  }, [hospitals, map, version])

  const expandCluster = (cluster: MarkerCluster) => {
    if (!map) return

    let minLng = Infinity
    let minLat = Infinity
    let maxLng = -Infinity
    let maxLat = -Infinity
    for (const hospitalItem of cluster.hospitals) {
      minLng = Math.min(minLng, hospitalItem.lng)
      minLat = Math.min(minLat, hospitalItem.lat)
      maxLng = Math.max(maxLng, hospitalItem.lng)
      maxLat = Math.max(maxLat, hospitalItem.lat)
    }

    const currentZoom = map.getZoom()
    if (minLng === maxLng && minLat === maxLat) {
      map.easeTo({
        center: [cluster.longitude, cluster.latitude],
        zoom: Math.min(13, currentZoom + 2.4),
        duration: 650,
      })
      return
    }

    map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      {
        padding: 96,
        maxZoom: Math.min(13, currentZoom + 3),
        duration: 650,
      },
    )
  }

  return (
    <>
      {clusters.map((cluster) => {
        if (cluster.hospitals.length === 1) {
          const hospitalItem = cluster.hospitals[0]
          return (
            <WaitMarker
              key={hospitalItem.id}
              hospitalItem={hospitalItem}
              selected={selectedId === hospitalItem.id}
              onSelect={onSelect}
            />
          )
        }

        return (
          <div key={cluster.id}>
            <MapMarker longitude={cluster.longitude} latitude={cluster.latitude} anchor="center">
              <MarkerContent>
                <button
                  type="button"
                  onClick={() => expandCluster(cluster)}
                  aria-label={`Zoom to ${cluster.hospitals.length} hospitals`}
                  className={cn(
                    'flex items-center justify-center rounded-full border-2 border-white text-sm font-bold text-white shadow-md transition-transform hover:scale-105',
                    clusterStyle(cluster.hospitals.length),
                    'wait-cluster-pulse',
                  )}
                >
                  {cluster.hospitals.length}
                </button>
              </MarkerContent>
            </MapMarker>
          </div>
        )
      })}
    </>
  )
}

function WaitMarker({
  hospitalItem,
  selected,
  onSelect,
}: {
  hospitalItem: WaitHospital
  selected: boolean
  onSelect: (hospitalItem: WaitHospital) => void
}) {
  return (
    <MapMarker
      longitude={hospitalItem.lng}
      latitude={hospitalItem.lat}
      anchor="center"
    >
      <MarkerContent>
        <button
          type="button"
          onClick={() => onSelect(hospitalItem)}
          aria-label={`${hospitalItem.name}: ${hospitalItem.waitLabel}`}
          className={cn(
            'relative rounded-full border-2 px-3 py-1.5 text-[13px] font-semibold leading-none shadow-md transition-transform hover:scale-105',
            markerClass(hospitalItem),
            selected && 'ring-2 ring-sky-400 ring-offset-2 ring-offset-background',
          )}
        >
          {hospitalItem.waitLabel}
          {(hospitalItem.advisory_status === 'disruption' || hospitalItem.advisory_status === 'advisory') && (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
              !
            </span>
          )}
        </button>
      </MarkerContent>
    </MapMarker>
  )
}

function clusterStyle(count: number): string {
  if (count >= 100) return 'size-14 bg-[#111827] text-base shadow-lg'
  if (count >= 50) return 'size-12 bg-[#1f2937] text-[15px] shadow-lg'
  if (count >= 15) return 'size-11 bg-[#334155] text-sm'
  if (count >= 5) return 'size-10 bg-[#475569] text-sm'
  return 'size-9 bg-[#64748b] text-sm'
}

function markerClass(hospitalItem: WaitHospital): string {
  if (hospitalItem.status === 'closed') return STATUS_META.closed.marker
  if (hospitalItem.source === 'predicted') return 'border-white/80 bg-[#94a3b8] text-white opacity-90 dark:bg-slate-600 dark:text-slate-100'
  return STATUS_META[hospitalItem.status].marker
}

function markerPriority(hospitalItem: WaitHospital): number {
  if (hospitalItem.status === 'closed') return 0
  if (hospitalItem.source === 'official') return 1
  if (hospitalItem.source === 'crowd') return 2
  if (hospitalItem.source === 'predicted') return 3
  return 4
}

function HospitalPopup({ hospitalItem, onClose }: { hospitalItem: WaitHospital; onClose: () => void }) {
  return (
    <MapPopupCard
      className="w-64"
      eyebrow="Emergency department"
      title={hospitalItem.name}
      subtitle={[hospitalItem.city, hospitalItem.province].filter(Boolean).join(', ')}
      onClose={onClose}
      closeLabel="Close popup"
    >
      <div className={cn('rounded-md px-3 py-2 text-white', STATUS_META[hospitalItem.status].marker)}>
        <div className="text-xs uppercase tracking-wide opacity-80">{sourceLabel(hospitalItem.source)}</div>
        <div className="mt-0.5 text-xl font-semibold">{hospitalItem.waitLabel}</div>
      </div>

      <KeyValueRows
        variant="divided"
        rows={[
          { label: 'Official wait', value: formatWait(hospitalItem.er_wait_minutes ?? hospitalItem.er_elos_minutes) },
          { label: 'Predicted wait', value: formatWait(hospitalItem.predicted_wait_minutes) },
          { label: 'Data source', value: hospitalItem.data_source ?? 'None' },
          { label: 'Updated', value: hospitalItem.data_updated_at ?? hospitalItem.official_updated_at ?? hospitalItem.predicted_at ?? '--' },
          { label: 'Status', value: hospitalItem.official_status ?? 'unknown' },
        ]}
      />

      {(hospitalItem.official_status_message || hospitalItem.advisory_message) && (
        <InlineAlert>{hospitalItem.official_status_message ?? hospitalItem.advisory_message}</InlineAlert>
      )}
    </MapPopupCard>
  )
}

function sourceLabel(source: WaitSource) {
  if (source === 'official') return 'Official'
  if (source === 'crowd') return 'Crowd reported'
  if (source === 'predicted') return 'Predicted'
  return 'No wait data'
}

export default DevWait
