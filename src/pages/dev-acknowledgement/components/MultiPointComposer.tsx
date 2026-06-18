import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, MapPin, Trash2, X } from 'lucide-react'

import { Map as PgMap, MapControls, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'
import {
  buildFallbackAcknowledgement,
  buildRegionalAcknowledgement,
  compareNationSets,
  summarizeMultiPoint,
} from '@/lib/acknowledgement/engine'
import type { RelationshipGraph, SpeakerPerspective, WordingMode } from '@/lib/acknowledgement/engine'
import { COMMUNITIES_DATA, wordingModeLabels } from '../data'
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

const MODES: WordingMode[] = ['short', 'formal', 'event', 'institutional', 'educational']
const VOICES: { value: SpeakerPerspective; label: string }[] = [
  { value: 'collective', label: 'Community' },
  { value: 'individual', label: 'Individual' },
  { value: 'organization', label: 'Organization' },
]

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

function CopyButton({ text, copiedKey, onCopy, id }: { text: string; copiedKey: string | null; onCopy: (text: string, id: string) => void; id: string }) {
  const done = copiedKey === id
  return (
    <button type="button" onClick={() => onCopy(text, id)} disabled={!text}
      className="inline-flex flex-none items-center gap-1 text-[11px] font-medium text-teal-800 disabled:opacity-40">
      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'Copied' : 'Copy'}
    </button>
  )
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
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [mode, setMode] = useState<WordingMode>('institutional')
  const [perspective, setPerspective] = useState<SpeakerPerspective>('organization')
  const [organizationName, setOrganizationName] = useState('')
  const [regionName, setRegionName] = useState('British Columbia')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
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

  const loadOrg = useCallback((org: OrgRecord | null) => {
    setSelectedOrgId(org?.id ?? '')
    if (!org) { setPoints([]); setActiveId(null); return }
    setPerspective('organization')
    setOrganizationName(org.name)
    if (org.framing === 'regional') setRegionName('British Columbia')
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

  const copy = useCallback((text: string, id: string) => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(id)
      window.setTimeout(() => setCopiedKey((current) => (current === id ? null : current)), 2000)
    }).catch(() => undefined)
  }, [])

  const resolved = points.filter((point) => point.status === 'done')
  const summary = useMemo(
    () => summarizeMultiPoint(resolved.map((point) => ({ latitude: point.latitude, longitude: point.longitude, nationNames: point.nationNames }))),
    [resolved],
  )

  const wordingOpts = { perspective, organizationName }
  const combinedSpecific = summary.nationNames.length ? buildFallbackAcknowledgement(mode, summary.nationNames, wordingOpts) : ''
  const regionalStatement = points.length ? buildRegionalAcknowledgement(mode, { ...wordingOpts, regionName }) : ''
  const perCampus = resolved
    .map((point) => ({ point, statement: point.nationNames.length ? buildFallbackAcknowledgement(mode, point.nationNames, wordingOpts) : '' }))
    .filter((entry) => entry.statement)

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
          <div className="relative min-h-[18rem] overflow-hidden rounded-md border lg:sticky lg:top-4 lg:self-start">
            <LocalMapBoundary result={null}>
              <PgMap className="h-full min-h-[18rem]" center={[-124.5, 54.5]} zoom={4} pitch={0} bearing={0} showStyleLoadingOverlay={false}>
                <MapClickLayer onAdd={addPoint} />
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
          </div>

          <div className="space-y-4 text-sm">
            {children}
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Campuses / points ({points.length})</span>
                <div className="flex items-center gap-2">
                  {summary.pointCount > 1 && (
                    <span className="text-[10px] text-slate-500">{summary.distinctNationCount} Nations · ~{Math.round(summary.maxSpreadKm)} km</span>
                  )}
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
                  <div className="rounded-md border border-dashed p-3 text-xs text-slate-500">Pick an organization above, or click the map.</div>
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

            <div className="grid grid-cols-3 gap-2">
              {MODES.slice(0, 3).map((value) => (
                <button key={value} type="button" onClick={() => setMode(value)}
                  className={cn('rounded-md border px-2 py-1.5 text-xs font-medium', mode === value ? 'border-teal-700 bg-teal-700 text-white' : 'bg-white hover:border-teal-300')}>
                  {wordingModeLabels[value]}
                </button>
              ))}
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Voice</div>
              <div className="grid grid-cols-3 gap-2">
                {VOICES.map(({ value, label }) => (
                  <button key={value} type="button" onClick={() => setPerspective(value)}
                    className={cn('rounded-md border px-2 py-1.5 text-xs font-medium', perspective === value ? 'border-teal-700 bg-teal-700 text-white' : 'bg-white hover:border-teal-300')}>
                    {label}
                  </button>
                ))}
              </div>
              {perspective === 'organization' && (
                <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)}
                  placeholder="Organization name (e.g. UNBC)" aria-label="Organization name"
                  className="mt-2 w-full rounded-md border bg-white px-3 py-1.5 text-sm outline-none" />
              )}
            </div>
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

        {/* both presentations */}
        {points.length > 0 && (
          <div className="grid gap-4 border-t p-4 lg:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-900">Specific (ours)</span>
                {!summary.suggestRegional && <span className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-teal-800">Suggested</span>}
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">All points combined</span>
                    <CopyButton id="combined" text={combinedSpecific} copiedKey={copiedKey} onCopy={copy} />
                  </div>
                  <div className="rounded bg-slate-50 p-2.5 text-sm leading-6 text-slate-900">{combinedSpecific || <span className="text-slate-400">Resolving…</span>}</div>
                </div>
                {perCampus.length > 1 && (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Per campus</div>
                    <div className="space-y-2">
                      {perCampus.map(({ point, statement }) => {
                        const cmp = point.expected?.length ? compareNationSets(point.expected, point.nationNames) : null
                        return (
                          <div key={point.id} className="rounded border p-2">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-[10px] font-semibold text-slate-600">{point.name ?? 'Point'}</span>
                              <CopyButton id={point.id} text={statement} copiedKey={copiedKey} onCopy={copy} />
                            </div>
                            <div className="text-xs leading-5 text-slate-800">{statement}</div>
                            {cmp && (cmp.missed.length > 0 || cmp.matched.length > 0) && (
                              <div className="mt-1 space-y-1">
                                <Chips label="matches org" names={cmp.matched} tone="ok" />
                                <Chips label="org names, we missed" names={cmp.missed} tone="miss" />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-900">Generalized — region-wide (ours)</span>
                {summary.suggestRegional && <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">Suggested</span>}
              </div>
              <input value={regionName} onChange={(event) => setRegionName(event.target.value)}
                placeholder="Region (e.g. British Columbia)" aria-label="Region name"
                className="mb-2 w-full rounded-md border bg-white px-3 py-1.5 text-sm outline-none" />
              <div className="mb-1 flex items-center justify-end"><CopyButton id="regional" text={regionalStatement} copiedKey={copiedKey} onCopy={copy} /></div>
              <div className="rounded bg-slate-50 p-2.5 text-sm leading-6 text-slate-900">{regionalStatement}</div>
              <p className="mt-2 text-[11px] text-slate-500">Suggested when points are far apart or span many Nations ({summary.distinctNationCount} Nations · ~{Math.round(summary.maxSpreadKm)} km).</p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 border-t bg-amber-50/60 px-4 py-3 text-xs leading-5 text-amber-900">
          <MapPin className="mt-0.5 h-3.5 w-3.5 flex-none" />
          Geometry-derived drafts use Native Land territory polygons as context triggers, and the database stores facts +
          a source link (not verbatim statements). Treat both as review-level until confirmed with the Nation or the official source.
        </div>
      </div>
    </section>
  )
}
