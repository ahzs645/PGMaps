import { useEffect, useMemo, useState } from 'react'
import { Clock3, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Map, MapControls, MapMarker, MapPopup, MarkerContent, useMap } from '@/components/ui/map'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
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

const STATUS_META: Record<WaitStatus, { label: string; swatch: string; marker: string }> = {
  quick: {
    label: '< 2h',
    swatch: 'bg-emerald-500',
    marker: 'border-white bg-[#10b981] text-white',
  },
  moderate: {
    label: '2-5h',
    swatch: 'bg-orange-500',
    marker: 'border-white bg-[#ea7a0a] text-white',
  },
  packed: {
    label: '5h+',
    swatch: 'bg-red-500',
    marker: 'border-white bg-[#ef4444] text-white',
  },
  unknown: {
    label: 'No data',
    swatch: 'bg-slate-400',
    marker: 'border-white/80 bg-[#94a3b8] text-white opacity-90 dark:bg-slate-600 dark:text-slate-100',
  },
  closed: {
    label: 'Closed',
    swatch: 'bg-slate-800',
    marker: 'border-red-500 bg-[#1f2937] text-white shadow-[0_0_0_3px_rgba(239,68,68,0.24)]',
  },
}

function DevWait() {
  const [showSidebar, setShowSidebar] = useState(true)
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
    <aside className="flex h-full w-full flex-col bg-background/95 md:w-[360px] md:border-r md:shadow-xl">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted p-2">
            <Clock3 className="size-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">ER wait times</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              ERStat-style wait labels using local captured hospital data.
            </p>
            <Link to="/dev/health/wait/specialist" className="mt-2 inline-flex text-xs font-medium text-sky-700 hover:underline">
              Surgery specialist map
            </Link>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="space-y-2">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground" htmlFor="wait-search">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="wait-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Hospital or city"
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-sky-500"
            />
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Province</div>
          <select
            value={province}
            onChange={(event) => setProvince(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="all">Canada</option>
            {provinces.map((code) => (
              <option key={code} value={code}>{PROVINCE_NAMES[code] ?? code}</option>
            ))}
          </select>
        </section>

        <section className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Markers</div>
          <div className="grid grid-cols-2 gap-1">
            {[
              ['all', 'All'],
              ['official', 'Official'],
              ['predicted', 'Predicted'],
              ['none', 'No data'],
              ['closed', 'Closed'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSource(id as SourceFilter)}
                aria-pressed={source === id}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                  source === id
                    ? 'border-sky-500 bg-sky-500/10 text-sky-700'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="border-t border-border pt-4">
          <h2 className="mb-2 text-sm font-semibold">Legend</h2>
          <div className="space-y-2">
            {(['quick', 'moderate', 'packed', 'unknown', 'closed'] as WaitStatus[]).map((status) => (
              <div key={status} className="flex items-center gap-2 text-sm">
                <span className={cn('size-3 rounded-sm', STATUS_META[status].swatch)} />
                <span>{STATUS_META[status].label}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            Green, orange, and red are live wait thresholds. Gray pills are predicted or no-data markers. Dense areas collapse to dark count bubbles; click one to zoom in and split it into sub-clusters.
          </p>
        </section>

        <section className="border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Visible" value={`${stats.visible}/${stats.total}`} />
            <Stat label="Official" value={String(stats.live)} />
            <Stat label="Predicted" value={String(stats.predicted)} />
            <Stat label="Closed" value={String(stats.closed)} />
          </div>
          {stats.newest && (
            <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
              Latest timestamp: {stats.newest}
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
      desktopSidebarWidth={360}
      mobileInitialSheetState="collapsed"
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">{stats.visible} ER markers</div>
          <div className="truncate text-[11px] text-muted-foreground">Wait-time labels and ER status</div>
        </div>
      )}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <Map center={WAIT_MAP_CENTER} zoom={WAIT_MAP_ZOOM} loading={loading}>
          <MapControls position="top-right" className="top-16 md:top-2" />

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
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
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
    <div className="w-72 overflow-hidden rounded-md bg-popover text-popover-foreground">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase text-muted-foreground">Emergency department</div>
          <div className="mt-0.5 text-sm font-semibold leading-5">{hospitalItem.name}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {[hospitalItem.city, hospitalItem.province].filter(Boolean).join(', ')}
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close popup">
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-3 px-3 py-3">
        <div className={cn('rounded-md px-3 py-2 text-white', STATUS_META[hospitalItem.status].marker)}>
          <div className="text-[11px] uppercase tracking-wide opacity-80">{sourceLabel(hospitalItem.source)}</div>
          <div className="mt-0.5 text-xl font-semibold">{hospitalItem.waitLabel}</div>
        </div>

        <div className="grid gap-1.5 text-sm">
          <PopupRow label="Official wait" value={formatWait(hospitalItem.er_wait_minutes ?? hospitalItem.er_elos_minutes)} />
          <PopupRow label="Predicted wait" value={formatWait(hospitalItem.predicted_wait_minutes)} />
          <PopupRow label="Data source" value={hospitalItem.data_source ?? 'None'} />
          <PopupRow label="Updated" value={hospitalItem.data_updated_at ?? hospitalItem.official_updated_at ?? hospitalItem.predicted_at ?? '--'} />
          <PopupRow label="Status" value={hospitalItem.official_status ?? 'unknown'} />
        </div>

        {(hospitalItem.official_status_message || hospitalItem.advisory_message) && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {hospitalItem.official_status_message ?? hospitalItem.advisory_message}
          </div>
        )}
      </div>
    </div>
  )
}

function PopupRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2 border-b border-border/70 pb-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground">{value}</span>
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

function sourceLabel(source: WaitSource) {
  if (source === 'official') return 'Official'
  if (source === 'crowd') return 'Crowd reported'
  if (source === 'predicted') return 'Predicted'
  return 'No wait data'
}

export default DevWait
