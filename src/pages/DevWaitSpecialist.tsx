import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, ExternalLink, MapPin, Search, Stethoscope, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Map, MapControls, MapMarker, MapPopup, MarkerContent } from '@/components/ui/map'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { cn } from '@/lib/utils'
import {
  SPECIALIST_WAIT_DATA_URL,
  SPECIALIST_WAIT_MAP_CENTER,
  SPECIALIST_WAIT_MAP_ZOOM,
  formatCases,
  formatWeeks,
  searchFacility,
  type FacilitySpecialist,
  type SpecialistFacility,
  type SpecialistMapData,
} from './dev-wait/specialistData'

type AuthorityFilter = 'all' | string

function DevWaitSpecialist() {
  const [showSidebar, setShowSidebar] = useState(true)
  const [facilities, setFacilities] = useState<SpecialistFacility[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [authority, setAuthority] = useState<AuthorityFilter>('all')
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

  const filteredFacilities = useMemo(() => facilities.filter((facility) => {
    if (authority !== 'all' && facility.health_authority !== authority) return false
    return searchFacility(facility, query)
  }), [authority, facilities, query])

  const stats = useMemo(() => {
    const visibleSpecialists = new Set<string>()
    filteredFacilities.forEach((facility) => {
      facility.specialists.forEach((specialist) => visibleSpecialists.add(specialist.specialist_id))
    })
    return {
      visible: filteredFacilities.length,
      facilities: facilities.length,
      specialists: visibleSpecialists.size,
      rollups: filteredFacilities.filter((facility) => facility.is_rollup_child).length,
    }
  }, [facilities.length, filteredFacilities])

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
            <Link to="/dev/wait" className="mt-2 inline-flex text-xs font-medium text-sky-700 hover:underline">
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
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Health authority</div>
          <select
            value={authority}
            onChange={(event) => setAuthority(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="all">All authorities</option>
            {authorities.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </section>

        <section className="border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Visible" value={`${stats.visible}/${stats.facilities}`} />
            <Stat label="Specialists" value={String(stats.specialists)} />
            <Stat label="Procedures" value={String(metadata?.procedure_count ?? '--')} />
            <Stat label="Roll-up points" value={String(stats.rollups)} />
          </div>
          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
            Latest scrape run: {metadata?.latest_run_id ?? '--'}. Greater Victoria Hospitals is shown as two roll-up child points.
          </div>
        </section>

        <section className="border-t border-border pt-4">
          <h2 className="mb-2 text-sm font-semibold">Facilities</h2>
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
              </button>
            ))}
          </div>
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

          {filteredFacilities.map((facility) => (
            <SpecialistFacilityMarker
              key={facility.id}
              facility={facility}
              selected={selected?.id === facility.id}
              onSelect={setSelected}
            />
          ))}

          {selected && (
            <MapPopup
              longitude={selected.longitude}
              latitude={selected.latitude}
              onClose={() => setSelected(null)}
              closeButton={false}
            >
              <SpecialistFacilityPopup facility={selected} onClose={() => setSelected(null)} />
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

function SpecialistFacilityMarker({
  facility,
  selected,
  onSelect,
}: {
  facility: SpecialistFacility
  selected: boolean
  onSelect: (facility: SpecialistFacility) => void
}) {
  return (
    <MapMarker longitude={facility.longitude} latitude={facility.latitude} anchor="center">
      <MarkerContent>
        <button
          type="button"
          onClick={() => onSelect(facility)}
          aria-label={`${facility.facility_name}: ${facility.specialist_count} specialists`}
          className={cn(
            'relative rounded-full border-2 px-3 py-1.5 text-[13px] font-semibold leading-none text-white shadow-md transition-transform hover:scale-105',
            facility.is_rollup_child ? 'border-amber-100 bg-[#9a5b13]' : markerClass(facility.specialist_count),
            selected && 'ring-2 ring-sky-400 ring-offset-2 ring-offset-background',
          )}
        >
          {facility.specialist_count}
          {facility.is_rollup_child && (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-amber-950">
              R
            </span>
          )}
        </button>
      </MarkerContent>
    </MapMarker>
  )
}

function SpecialistFacilityPopup({ facility, onClose }: { facility: SpecialistFacility; onClose: () => void }) {
  const topSpecialists = facility.specialists.slice(0, 8)
  const topProcedures = facility.procedures.slice(0, 6)

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
          <PopupStat icon={<Stethoscope className="size-3.5" />} label="Specialists" value={facility.specialist_count} />
          <PopupStat icon={<Activity className="size-3.5" />} label="Procedures" value={facility.procedure_count} />
          <PopupStat icon={<MapPin className="size-3.5" />} label="Rows" value={facility.wait_time_row_count} />
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
              <SpecialistRow key={specialist.specialist_id} specialist={specialist} />
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

function SpecialistRow({ specialist }: { specialist: FacilitySpecialist }) {
  const firstProcedure = specialist.procedures[0]

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

function markerClass(count: number): string {
  if (count >= 150) return 'border-white bg-[#7f1d1d]'
  if (count >= 100) return 'border-white bg-[#b45309]'
  if (count >= 60) return 'border-white bg-[#0f766e]'
  if (count >= 25) return 'border-white bg-[#2563eb]'
  return 'border-white bg-[#475569]'
}

export default DevWaitSpecialist
