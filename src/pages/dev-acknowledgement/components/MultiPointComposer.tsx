import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ExternalLink, Plus, Trash2, X } from 'lucide-react'

import { Map as PgMap, MapControls, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'
import { compareNationSets, summarizeMultiPoint } from '@/lib/acknowledgement/engine'
import type { RelationshipGraph } from '@/lib/acknowledgement/engine'
import { COMMUNITIES_DATA } from '../data'
import { organizations, type OrgRecord } from '../organizations'
import { fpccLanguageNations } from '../organizations/fpcc'
import { createNationResolver } from '../organizations/nations'
import { loadGeoJsonLayer, resolveFpccLanguagesAtPoint, resolveNationsAtPoint } from '../spatial'
import type { GeocodeResult } from '../types'
import { LocalMapBoundary } from './AcknowledgementMap'

type MappedPoint = {
  id: string
  name?: string
  /** Nations the source org names for this campus (when loaded from the database). */
  expected?: string[]
  latitude: number
  longitude: number
  status: 'loading' | 'done' | 'error'
  nationNames: string[]
  /** FPCC Indigenous language-territory polygon(s) the point falls in. */
  languages?: string[]
}

function MapClickLayer({ onAdd }: { onAdd: (lat: number, lng: number) => void }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    const handle = (event: { lngLat: { lng: number; lat: number } }) => onAdd(event.lngLat.lat, event.lngLat.lng)
    map.on('click', handle)
    return () => {
      map.off('click', handle)
    }
  }, [map, isLoaded, onAdd])
  return null
}

/** Recenters the map on the active point so the focused location stays in view. */
function FlyToActive({ point }: { point: { latitude: number; longitude: number } | null }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded || !point) return
    map.flyTo({ center: [point.longitude, point.latitude], zoom: Math.max(map.getZoom(), 9), duration: 700 })
  }, [map, isLoaded, point])
  return null
}

function Chips({ label, names, tone }: { label: string; names: string[]; tone: 'ok' | 'miss' | 'extra' }) {
  if (names.length === 0) return null
  const cls = tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'miss'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-slate-200 bg-slate-50 text-slate-600'
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {names.map((name) => (
        <span key={name} className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', cls)}>{name}</span>
      ))}
    </div>
  )
}

type MultiPointComposerProps = {
  graph: RelationshipGraph | null
  /** Called when the focused point changes, so the page can run the full source breakdown for it. */
  onActivePoint?: (latitude: number, longitude: number) => void
  /** The single-location geocode/drop result, mirrored onto the map as the active point. */
  addressPoint?: GeocodeResult | null
  /** Org id to load as campus points (set from the Organizations tab). */
  orgToLoad?: string | null
  /** Called once the requested org has been loaded, so the parent can reset its request. */
  onOrgLoaded?: () => void
  /** Active-point detail (wording preview, candidates, source panels) rendered beside the map. */
  children?: ReactNode
}

export function MultiPointComposer({ graph, onActivePoint, addressPoint, orgToLoad, onOrgLoaded, children }: MultiPointComposerProps) {
  const [points, setPoints] = useState<MappedPoint[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  // Single-point by default: a map click moves the active point. "Add point" arms
  // the next click to drop an additional point instead.
  const [addMode, setAddMode] = useState(false)
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [gisFeatures, setGisFeatures] = useState<GeoJSON.Feature[] | undefined>(undefined)
  const counter = useRef(0)
  const syncedAddressKey = useRef<string | null>(null)

  // Load the BC First Nation Community Locations GIS dataset to validate/enrich Nation names.
  useEffect(() => {
    let cancelled = false
    loadGeoJsonLayer(COMMUNITIES_DATA)
      .then((collection) => { if (!cancelled) setGisFeatures(collection.features) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const selectedOrg = organizations.find((org) => org.id === selectedOrgId) ?? null

  const resolve = useCallback((pt: MappedPoint) => {
    Promise.all([
      resolveNationsAtPoint(pt.latitude, pt.longitude, graph),
      resolveFpccLanguagesAtPoint(pt.latitude, pt.longitude),
    ])
      .then(([nationNames, languages]) => setPoints((current) => current.map((p) => (p.id === pt.id ? { ...p, status: 'done', nationNames, languages } : p))))
      .catch(() => setPoints((current) => current.map((p) => (p.id === pt.id ? { ...p, status: 'error', nationNames: [], languages: [] } : p))))
  }, [graph])

  const addPoint = useCallback((latitude: number, longitude: number) => {
    const pt: MappedPoint = { id: `p${counter.current++}`, latitude, longitude, status: 'loading', nationNames: [] }
    setPoints((current) => [...current, pt])
    setActiveId(pt.id)
    setSelectedOrgId('')
    resolve(pt)
    onActivePoint?.(latitude, longitude)
  }, [resolve, onActivePoint])

  const selectPoint = useCallback((pt: MappedPoint) => {
    setActiveId(pt.id)
    onActivePoint?.(pt.latitude, pt.longitude)
  }, [onActivePoint])

  // Map click: in add mode (or with no points yet) drop a new point; otherwise
  // relocate the active/selected point to the clicked spot.
  const handleMapClick = useCallback((latitude: number, longitude: number) => {
    if (addMode || !activeId) {
      addPoint(latitude, longitude)
      setAddMode(false)
      return
    }
    setPoints((current) => current.map((point) => (
      point.id === activeId
        ? { ...point, name: undefined, expected: undefined, latitude, longitude, status: 'loading', nationNames: [], languages: undefined }
        : point
    )))
    resolve({ id: activeId, latitude, longitude, status: 'loading', nationNames: [] })
    onActivePoint?.(latitude, longitude)
  }, [addMode, activeId, addPoint, resolve, onActivePoint])

  const loadOrg = useCallback((org: OrgRecord | null) => {
    setSelectedOrgId(org?.id ?? '')
    if (!org) { setPoints([]); setActiveId(null); return }
    const next: MappedPoint[] = org.campuses.map((campus) => ({
      id: `p${counter.current++}`, name: campus.name, expected: campus.acknowledges,
      latitude: campus.latitude, longitude: campus.longitude, status: 'loading', nationNames: [],
    }))
    setPoints(next)
    next.forEach(resolve)
    const first = next[0]
    if (first) {
      setActiveId(first.id)
      onActivePoint?.(first.latitude, first.longitude)
    }
  }, [resolve, onActivePoint])

  const removePoint = (id: string) => {
    setPoints((current) => current.filter((point) => point.id !== id))
    setActiveId((current) => (current === id ? null : current))
  }

  // Mirror an address geocode (from the header search / initial sample) onto the map as a point.
  // Map drops are added via addPoint, so skip them here to avoid duplicates / loops.
  useEffect(() => {
    if (!addressPoint || addressPoint.matchPrecision === 'Map point') return
    const key = `${addressPoint.latitude.toFixed(5)},${addressPoint.longitude.toFixed(5)}`
    if (syncedAddressKey.current === key) return
    syncedAddressKey.current = key
    const existing = points.find((point) => (
      Math.abs(point.latitude - addressPoint.latitude) < 1e-5 && Math.abs(point.longitude - addressPoint.longitude) < 1e-5
    ))
    if (existing) {
      setActiveId(existing.id)
      return
    }
    const pt: MappedPoint = {
      id: `p${counter.current++}`,
      name: addressPoint.fullAddress,
      latitude: addressPoint.latitude,
      longitude: addressPoint.longitude,
      status: 'loading',
      nationNames: [],
    }
    setPoints((current) => [...current, pt])
    setActiveId(pt.id)
    setSelectedOrgId('')
    resolve(pt)
    // points read for de-dupe only; syncedAddressKey guards re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressPoint, resolve])

  // Load an org's campuses when the Organizations tab requests it, then clear the request.
  useEffect(() => {
    if (!orgToLoad) return
    const org = organizations.find((item) => item.id === orgToLoad)
    if (org) loadOrg(org)
    onOrgLoaded?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgToLoad])

  const resolved = points.filter((point) => point.status === 'done')
  const summary = useMemo(
    () => summarizeMultiPoint(resolved.map((point) => ({ latitude: point.latitude, longitude: point.longitude, nationNames: point.nationNames }))),
    [resolved],
  )

  const orgComparison = selectedOrg && selectedOrg.acknowledges.length ? compareNationSets(selectedOrg.acknowledges, summary.nationNames) : null

  const resolveNation = useMemo(() => createNationResolver(graph, gisFeatures), [graph, gisFeatures])
  const coverage = selectedOrg ? selectedOrg.acknowledges.map(resolveNation) : []
  const unlistedNations = coverage.filter((entry) => entry.status === 'unlisted')
  const graphBackedCount = coverage.filter((entry) => entry.inGraph).length
  const gisVerifiedCount = coverage.filter((entry) => entry.gis).length

  const activePoint = activeId ? points.find((point) => point.id === activeId) ?? null : null

  return (
    <section className="mx-auto max-w-7xl px-3 py-4 sm:px-6 lg:px-8">
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-4 text-sm lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <div className="relative min-h-[18rem] overflow-hidden rounded-md border">
            <LocalMapBoundary result={null}>
              <PgMap className="h-full min-h-[18rem]" center={[-124.5, 54.5]} zoom={4} pitch={0} bearing={0} showStyleLoadingOverlay={false}>
                <MapClickLayer onAdd={handleMapClick} />
                <FlyToActive point={activePoint} />
                <MapControls position="top-right" showFullscreen />
                {points.map((point, index) => (
                  <MapMarker key={point.id} longitude={point.longitude} latitude={point.latitude} anchor="bottom">
                    <MarkerContent>
                      <button
                        type="button"
                        onClick={() => selectPoint(point)}
                        aria-label={`Focus point ${index + 1}`}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow-lg transition',
                          point.id === activeId ? 'bg-rose-600 ring-2 ring-rose-300' : 'bg-teal-700 hover:bg-teal-600',
                        )}
                      >
                        {index + 1}
                      </button>
                    </MarkerContent>
                  </MapMarker>
                ))}
              </PgMap>
            </LocalMapBoundary>
              {addMode && (
                <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 rounded-md border bg-teal-50/95 px-3 py-2 text-xs font-medium text-teal-900 shadow-sm">
                  Click the map to place the new point.
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Campuses / points ({points.length})</span>
                <div className="flex items-center gap-2">
                  {summary.pointCount > 1 && (
                    <span className="text-[10px] text-slate-500">{summary.distinctNationCount} Nations · ~{Math.round(summary.maxSpreadKm)} km</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setAddMode((value) => !value)}
                    aria-pressed={addMode}
                    className={cn(
                      'inline-flex items-center gap-1 text-[10px] font-medium transition',
                      addMode ? 'text-teal-700' : 'text-slate-500 hover:text-slate-800',
                    )}
                  >
                    <Plus className="h-3 w-3" />
                    {addMode ? 'Click map to place' : 'Add point'}
                  </button>
                  {points.length > 0 && (
                    <button
                      type="button"
                      onClick={() => loadOrg(null)}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 transition hover:text-slate-800"
                    >
                      <Trash2 className="h-3 w-3" />
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                {points.length === 0 && (
                  <div className="rounded-md border border-dashed p-3 text-xs text-slate-500">Click the map to drop a point, or load an organization from the Organizations tab.</div>
                )}
                {points.map((point, index) => (
                  <div
                    key={point.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectPoint(point)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPoint(point) } }}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs transition',
                      point.id === activeId ? 'border-rose-300 bg-rose-50/50' : 'hover:border-teal-300',
                    )}
                  >
                    <span className={cn(
                      'flex h-5 w-5 flex-none items-center justify-center rounded-full font-semibold',
                      point.id === activeId ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700',
                    )}>{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {point.name && <span className="font-medium text-slate-900">{point.name}</span>}
                        <span className="font-mono text-[10px] text-slate-500">{point.latitude.toFixed(3)}, {point.longitude.toFixed(3)}</span>
                      </div>
                      <div className="mt-0.5 text-slate-800">
                        {point.status === 'loading' && 'Resolving…'}
                        {point.status === 'error' && 'Lookup failed'}
                        {point.status === 'done' && (
                          <>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Native Land</span>{' '}
                            {point.nationNames.length ? point.nationNames.join(', ') : 'no territory match'}
                          </>
                        )}
                      </div>
                      {point.status === 'done' && point.languages && point.languages.length > 0 && (() => {
                        const langNations = fpccLanguageNations(point.languages)
                        return (
                          <div className="mt-0.5 text-[10px] leading-4 text-teal-800">
                            <span className="font-semibold uppercase tracking-wide text-slate-400">FPCC</span> · {point.languages.join(', ')}
                            {langNations.length > 0 && <span className="text-teal-900"> → {langNations.join(', ')}</span>}
                          </div>
                        )
                      })()}
                    </div>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); removePoint(point.id) }}
                      aria-label="Remove point"
                      className="flex-none text-slate-400 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4 text-sm">
            {children}
          </div>
        </div>

        {/* org comparison: theirs vs ours */}
        {selectedOrg && (
          <div className="border-t bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">{selectedOrg.name}</div>
              <a href={selectedOrg.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-teal-800">
                Official statement <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="mt-1 text-xs text-slate-600">
              <span className="font-medium uppercase tracking-wide text-slate-400">{selectedOrg.framing.replace(/_/g, ' ')}</span>
              {selectedOrg.note ? ` · ${selectedOrg.note}` : ''}
            </div>
            {coverage.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-700">Mapped to our database: {coverage.length - unlistedNations.length}/{coverage.length}</span>
                <span className="text-[10px] text-slate-500">({graphBackedCount} in verified graph · {gisVerifiedCount} GIS-verified)</span>
                {unlistedNations.length > 0 && (
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">not in our DB yet</span>
                    {unlistedNations.map((entry) => (
                      <span key={entry.input} className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">{entry.canonical}</span>
                    ))}
                  </span>
                )}
              </div>
            )}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border bg-white p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">They name ({selectedOrg.acknowledges.length})</div>
                <div className="text-xs leading-5 text-slate-800">{selectedOrg.acknowledges.length ? selectedOrg.acknowledges.join(', ') : 'No specific Nations (region-wide framing)'}</div>
              </div>
              <div className="rounded-md border bg-white p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Our engine resolved ({summary.distinctNationCount})</div>
                <div className="text-xs leading-5 text-slate-800">{summary.nationNames.length ? summary.nationNames.join(', ') : '—'}</div>
              </div>
            </div>
            {orgComparison && (
              <div className="mt-3 space-y-1.5">
                <Chips label="matched" names={orgComparison.matched} tone="ok" />
                <Chips label="missed" names={orgComparison.missed} tone="miss" />
                <Chips label="extra (noise)" names={orgComparison.extra} tone="extra" />
              </div>
            )}
          </div>
        )}

      </div>
    </section>
  )
}
