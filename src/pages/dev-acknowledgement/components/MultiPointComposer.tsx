import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ExternalLink, Plus, Trash2, X } from 'lucide-react'

import { Map as PgMap, MapControls, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'
import { compareNationSets, summarizeMultiPoint } from '@/lib/acknowledgement/engine'
import type { MultiPointSummary, RelationshipGraph } from '@/lib/acknowledgement/engine'
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
  // Key on coordinates, not object identity: the point object is recreated every
  // time a lookup settles, and re-flying then would yank the camera back mid-pan.
  const key = point ? `${point.latitude},${point.longitude}` : null
  useEffect(() => {
    if (!map || !isLoaded || !key) return
    const [latitude, longitude] = key.split(',').map(Number)
    map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 9), duration: 700 })
  }, [map, isLoaded, key])
  return null
}

function Chips({ label, names, tone }: { label: string; names: string[]; tone: 'ok' | 'miss' | 'extra' }) {
  if (names.length === 0) return null
  const cls =
    tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : tone === 'miss'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-slate-200 bg-slate-50 text-slate-600'
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {names.map((name) => (
        <span key={name} className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', cls)}>
          {name}
        </span>
      ))}
    </div>
  )
}

type MultiPointComposerProps = {
  graph: RelationshipGraph | null
  /** Called when the focused point changes, so the page can run the full source
   *  breakdown for it. `label` carries the point's own name (address or campus)
   *  when it has one, so the header address isn't clobbered with raw coordinates. */
  onActivePoint?: (latitude: number, longitude: number, label?: string) => void
  /** Clears active-point source details after the final mapped point is removed. */
  onClearActivePoint?: () => void
  /** The single-location geocode/drop result, mirrored onto the map as the active point. */
  addressPoint?: GeocodeResult | null
  /** Org id to load as campus points (set from the Organizations tab). */
  orgToLoad?: string | null
  /** Called once the requested org has been loaded, so the parent can reset its request. */
  onOrgLoaded?: () => void
  /** Fires when the loaded organization changes (null = free-form points), so the
   *  parent can lock the voice to that org and hide the redundant voice picker. */
  onOrgChange?: (org: OrgRecord | null) => void
  /** Exposes resolved multi-point context so generated wording can reflect all points, not only the active point. */
  onWordingContextChange?: (context: MultiPointWordingContext | null) => void
  /** Active-point detail (wording preview, candidates, source panels) rendered beside the map. */
  children?: ReactNode
}

export type MultiPointWordingContext = {
  totalPointCount: number
  resolvedPointCount: number
  summary: MultiPointSummary
  nationNames: string[]
  selectedOrg: OrgRecord | null
}

export function MultiPointComposer({
  graph,
  onActivePoint,
  onClearActivePoint,
  addressPoint,
  orgToLoad,
  onOrgLoaded,
  onOrgChange,
  onWordingContextChange,
  children,
}: MultiPointComposerProps) {
  const [points, setPoints] = useState<MappedPoint[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  // Single-point by default: a map click moves the active point. "Add point" arms
  // the next click to drop an additional point instead.
  const [addMode, setAddMode] = useState(false)
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [gisFeatures, setGisFeatures] = useState<GeoJSON.Feature[] | undefined>(undefined)
  const counter = useRef(0)
  const syncedAddressKey = useRef<string | null>(null)
  // Per-point resolve token: relocating a point starts a new lookup, and only the
  // newest lookup for that point id may write its result (last-writer-wins race).
  const resolveTokens = useRef(new globalThis.Map<string, number>())

  // Load the BC First Nation Community Locations GIS dataset to validate/enrich Nation names.
  useEffect(() => {
    let cancelled = false
    loadGeoJsonLayer(COMMUNITIES_DATA)
      .then((collection) => {
        if (!cancelled) setGisFeatures(collection.features)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const selectedOrg = organizations.find((org) => org.id === selectedOrgId) ?? null

  const resolve = useCallback(
    (pt: MappedPoint) => {
      const token = (resolveTokens.current.get(pt.id) ?? 0) + 1
      resolveTokens.current.set(pt.id, token)
      const isCurrent = () => resolveTokens.current.get(pt.id) === token
      Promise.all([
        resolveNationsAtPoint(pt.latitude, pt.longitude, graph),
        resolveFpccLanguagesAtPoint(pt.latitude, pt.longitude),
      ])
        .then(([nationNames, languages]) => {
          if (!isCurrent()) return
          setPoints((current) =>
            current.map((p) => (p.id === pt.id ? { ...p, status: 'done', nationNames, languages } : p)),
          )
        })
        .catch(() => {
          if (!isCurrent()) return
          setPoints((current) =>
            current.map((p) => (p.id === pt.id ? { ...p, status: 'error', nationNames: [], languages: [] } : p)),
          )
        })
    },
    [graph],
  )

  // The alias index that canonicalizes Native Land names lives in the graph, which
  // loads async. Points resolved before it arrives keep raw names, so re-resolve
  // everything when `resolve` picks up a new graph.
  const pointsRef = useRef(points)
  pointsRef.current = points
  useEffect(() => {
    const existing = pointsRef.current
    if (existing.length === 0) return
    setPoints((current) => current.map((p) => ({ ...p, status: 'loading' as const })))
    existing.forEach(resolve)
  }, [resolve])

  const addPoint = useCallback(
    (latitude: number, longitude: number) => {
      const pt: MappedPoint = { id: `p${counter.current++}`, latitude, longitude, status: 'loading', nationNames: [] }
      setPoints((current) => [...current, pt])
      setActiveId(pt.id)
      setSelectedOrgId('')
      resolve(pt)
      onActivePoint?.(latitude, longitude)
    },
    [resolve, onActivePoint],
  )

  const selectPoint = useCallback(
    (pt: MappedPoint) => {
      setActiveId(pt.id)
      onActivePoint?.(pt.latitude, pt.longitude, pt.name)
    },
    [onActivePoint],
  )

  // Map click: in add mode (or with no points yet) drop a new point; otherwise
  // relocate the active/selected point to the clicked spot.
  const handleMapClick = useCallback(
    (latitude: number, longitude: number) => {
      if (addMode || !activeId) {
        addPoint(latitude, longitude)
        setAddMode(false)
        return
      }
      setPoints((current) =>
        current.map((point) =>
          point.id === activeId
            ? {
                ...point,
                name: undefined,
                expected: undefined,
                latitude,
                longitude,
                status: 'loading',
                nationNames: [],
                languages: undefined,
              }
            : point,
        ),
      )
      setSelectedOrgId('')
      resolve({ id: activeId, latitude, longitude, status: 'loading', nationNames: [] })
      onActivePoint?.(latitude, longitude)
    },
    [addMode, activeId, addPoint, resolve, onActivePoint],
  )

  const loadOrg = useCallback(
    (org: OrgRecord | null) => {
      setSelectedOrgId(org?.id ?? '')
      if (!org) {
        setPoints([])
        setActiveId(null)
        onClearActivePoint?.()
        return
      }
      const next: MappedPoint[] = org.campuses.map((campus) => ({
        id: `p${counter.current++}`,
        name: campus.name,
        expected: campus.acknowledges,
        latitude: campus.latitude,
        longitude: campus.longitude,
        status: 'loading',
        nationNames: [],
      }))
      setPoints(next)
      next.forEach(resolve)
      const first = next[0]
      if (first) {
        setActiveId(first.id)
        onActivePoint?.(first.latitude, first.longitude, first.name)
      }
    },
    [resolve, onActivePoint, onClearActivePoint],
  )

  const removePoint = (id: string) => {
    resolveTokens.current.delete(id)
    const remaining = points.filter((point) => point.id !== id)
    setPoints(remaining)
    setSelectedOrgId('')
    if (activeId !== id) return
    const nextActive = remaining[0] ?? null
    setActiveId(nextActive?.id ?? null)
    if (nextActive) onActivePoint?.(nextActive.latitude, nextActive.longitude, nextActive.name)
    else onClearActivePoint?.()
  }

  // Mirror an address geocode (from the header search / initial sample) onto the map as a point.
  // Map drops are added via addPoint, so skip them here to avoid duplicates / loops.
  useEffect(() => {
    if (!addressPoint) {
      syncedAddressKey.current = null
      return
    }
    if (addressPoint.matchPrecision === 'Map point') {
      // A later header search may legitimately return to the last geocoded
      // coordinate, so a map move must invalidate the geocode de-dupe key.
      syncedAddressKey.current = null
      return
    }
    const key = `${addressPoint.latitude.toFixed(5)},${addressPoint.longitude.toFixed(5)}:${addressPoint.fullAddress}`
    if (syncedAddressKey.current === key) return
    syncedAddressKey.current = key
    const existing =
      !selectedOrgId &&
      points.find(
        (point) =>
          Math.abs(point.latitude - addressPoint.latitude) < 1e-5 &&
          Math.abs(point.longitude - addressPoint.longitude) < 1e-5,
      )
    if (existing) {
      if (existing.name !== addressPoint.fullAddress) {
        setPoints((current) =>
          current.map((point) => (point.id === existing.id ? { ...point, name: addressPoint.fullAddress } : point)),
        )
      }
      setActiveId(existing.id)
      return
    }
    // Header searches replace the active free-form point. Additional locations
    // are created only through the explicit Add point action on the map.
    const activePoint = activeId ? points.find((point) => point.id === activeId) : null
    const pt: MappedPoint = {
      id: activePoint && !selectedOrgId ? activePoint.id : `p${counter.current++}`,
      name: addressPoint.fullAddress,
      latitude: addressPoint.latitude,
      longitude: addressPoint.longitude,
      status: 'loading',
      nationNames: [],
    }
    setPoints((current) => {
      if (selectedOrgId) return [pt]
      if (!activePoint) return [...current, pt]
      return current.map((point) => (point.id === activePoint.id ? pt : point))
    })
    setActiveId(pt.id)
    setSelectedOrgId('')
    resolve(pt)
    // Existing points and active state are read to replace/de-dupe; the address
    // key guards re-entry when those state updates render this effect again.
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

  // Tell the parent which org (if any) is currently loaded so it can lock the
  // voice to that org. Keyed on the id string to fire only on real changes
  // (loading an org, clearing, or dropping a free-form point that resets it).
  useEffect(() => {
    onOrgChange?.(organizations.find((org) => org.id === selectedOrgId) ?? null)
  }, [selectedOrgId, onOrgChange])

  const summary = useMemo(
    () =>
      summarizeMultiPoint(
        points
          .filter((point) => point.status === 'done')
          .map((point) => ({ latitude: point.latitude, longitude: point.longitude, nationNames: point.nationNames })),
      ),
    [points],
  )
  const wordingContext = useMemo<MultiPointWordingContext | null>(() => {
    const totalPointCount = points.length
    const resolvedPointCount = summary.pointCount
    if (selectedOrg) {
      return {
        totalPointCount,
        resolvedPointCount,
        summary,
        nationNames: selectedOrg.acknowledges.length ? selectedOrg.acknowledges : summary.nationNames,
        selectedOrg,
      }
    }
    if (totalPointCount <= 1 || resolvedPointCount < totalPointCount) return null
    return { totalPointCount, resolvedPointCount, summary, nationNames: summary.nationNames, selectedOrg: null }
  }, [points.length, selectedOrg, summary])

  useEffect(() => {
    onWordingContextChange?.(wordingContext)
  }, [onWordingContextChange, wordingContext])

  const orgComparison =
    selectedOrg && selectedOrg.acknowledges.length
      ? compareNationSets(selectedOrg.acknowledges, summary.nationNames)
      : null

  const resolveNation = useMemo(() => createNationResolver(graph, gisFeatures), [graph, gisFeatures])
  const coverage = selectedOrg ? selectedOrg.acknowledges.map(resolveNation) : []
  const unlistedNations = coverage.filter((entry) => entry.status === 'unlisted')
  const graphBackedCount = coverage.filter((entry) => entry.inGraph).length
  const gisVerifiedCount = coverage.filter((entry) => entry.gis).length

  const activePoint = activeId ? (points.find((point) => point.id === activeId) ?? null) : null

  return (
    <section className="mx-auto max-w-7xl px-3 py-4 sm:px-6 lg:px-8">
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-4 text-sm lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <div className="relative min-h-[18rem] overflow-hidden rounded-md border">
              <LocalMapBoundary result={null}>
                {/* The page is light-only, so pin the basemap to the light style. */}
                <PgMap
                  className="h-full min-h-[18rem]"
                  theme="light"
                  center={[-124.5, 54.5]}
                  zoom={4}
                  pitch={0}
                  bearing={0}
                  showStyleLoadingOverlay={false}
                >
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
                            point.id === activeId
                              ? 'bg-rose-600 ring-2 ring-rose-300'
                              : 'bg-teal-700 hover:bg-teal-600',
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
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Locations ({points.length})
                </span>
                <div className="flex items-center gap-2">
                  {summary.pointCount > 1 && (
                    <span className="text-[10px] text-slate-500">
                      {summary.distinctNationCount} Nations · ~{Math.round(summary.maxSpreadKm)} km
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setAddMode((value) => !value)}
                    aria-pressed={addMode}
                    className={cn(
                      'inline-flex min-h-8 items-center gap-1 rounded px-1 text-[10px] font-medium transition',
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
                      className="inline-flex min-h-8 items-center gap-1 rounded px-1 text-[10px] font-medium text-slate-500 transition hover:text-slate-800"
                    >
                      <Trash2 className="h-3 w-3" />
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                {points.length === 0 && (
                  <div className="rounded-md border border-dashed p-3 text-xs text-slate-500">
                    Click the map to drop a point, or load an organization from the Organizations tab.
                  </div>
                )}
                {points.map((point, index) => (
                  <div
                    key={point.id}
                    className={cn(
                      'flex items-start gap-2 rounded-md border p-2 text-xs transition',
                      point.id === activeId ? 'border-rose-300 bg-rose-50/50' : 'hover:border-teal-300',
                    )}
                  >
                    {/* The focus action is its own button (not a role="button" row wrapping
                        the remove button) so interactive controls don't nest. */}
                    <button
                      type="button"
                      onClick={() => selectPoint(point)}
                      aria-pressed={point.id === activeId}
                      className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left"
                    >
                      <span
                        className={cn(
                          'flex h-5 w-5 flex-none items-center justify-center rounded-full font-semibold',
                          point.id === activeId ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700',
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="block min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          {point.name && <span className="font-medium text-slate-900">{point.name}</span>}
                          <span className="font-mono text-[10px] text-slate-500">
                            {point.latitude.toFixed(3)}, {point.longitude.toFixed(3)}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-slate-800">
                          {point.status === 'loading' && 'Resolving…'}
                          {point.status === 'error' && 'Lookup failed'}
                          {point.status === 'done' && (
                            <>
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                Native Land
                              </span>{' '}
                              {point.nationNames.length ? point.nationNames.join(', ') : 'no territory match'}
                            </>
                          )}
                        </span>
                        {point.status === 'done' &&
                          point.languages &&
                          point.languages.length > 0 &&
                          (() => {
                            const langNations = fpccLanguageNations(point.languages)
                            return (
                              <span className="mt-0.5 block text-[10px] leading-4 text-teal-800">
                                <span className="font-semibold uppercase tracking-wide text-slate-400">FPCC</span> ·{' '}
                                {point.languages.join(', ')}
                                {langNations.length > 0 && (
                                  <span className="text-teal-900"> → {langNations.join(', ')}</span>
                                )}
                              </span>
                            )
                          })()}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removePoint(point.id)}
                      aria-label="Remove point"
                      className="flex h-8 w-8 flex-none items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4 text-sm">{children}</div>
        </div>

        {/* org comparison: theirs vs ours */}
        {selectedOrg && (
          <div className="border-t bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">{selectedOrg.name}</div>
              <a
                href={selectedOrg.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-teal-800"
              >
                Official statement <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="mt-1 text-xs text-slate-600">
              <span className="font-medium uppercase tracking-wide text-slate-400">
                {selectedOrg.framing.replace(/_/g, ' ')}
              </span>
              {selectedOrg.note ? ` · ${selectedOrg.note}` : ''}
            </div>
            {coverage.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-700">
                  Mapped to our database: {coverage.length - unlistedNations.length}/{coverage.length}
                </span>
                <span className="text-[10px] text-slate-500">
                  ({graphBackedCount} in verified graph · {gisVerifiedCount} GIS-verified)
                </span>
                {unlistedNations.length > 0 && (
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      not in our DB yet
                    </span>
                    {unlistedNations.map((entry) => (
                      <span
                        key={entry.input}
                        className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                      >
                        {entry.canonical}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border bg-white p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  They name ({selectedOrg.acknowledges.length})
                </div>
                <div className="text-xs leading-5 text-slate-800">
                  {selectedOrg.acknowledges.length
                    ? selectedOrg.acknowledges.join(', ')
                    : 'No specific Nations (region-wide framing)'}
                </div>
              </div>
              <div className="rounded-md border bg-white p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Our engine resolved ({summary.distinctNationCount})
                </div>
                <div className="text-xs leading-5 text-slate-800">
                  {summary.nationNames.length ? summary.nationNames.join(', ') : '—'}
                </div>
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
