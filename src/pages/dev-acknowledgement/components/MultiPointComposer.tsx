import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, MapPin, Sparkles, Trash2, X } from 'lucide-react'

import { Map as PgMap, MapControls, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'
import {
  buildFallbackAcknowledgement,
  buildRegionalAcknowledgement,
  compareNationSets,
  summarizeMultiPoint,
} from '@/lib/acknowledgement/engine'
import type { RelationshipGraph, SpeakerPerspective, WordingMode } from '@/lib/acknowledgement/engine'
import { wordingModeLabels } from '../data'
import { organizations, type OrgRecord } from '../organizations'
import { createNationResolver } from '../organizations/nations'
import { resolveNationsAtPoint } from '../spatial'
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

export function MultiPointComposer({ graph }: { graph: RelationshipGraph | null }) {
  const [points, setPoints] = useState<MappedPoint[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [mode, setMode] = useState<WordingMode>('institutional')
  const [perspective, setPerspective] = useState<SpeakerPerspective>('organization')
  const [organizationName, setOrganizationName] = useState('')
  const [regionName, setRegionName] = useState('British Columbia')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const counter = useRef(0)

  const selectedOrg = organizations.find((org) => org.id === selectedOrgId) ?? null

  const resolve = useCallback((pt: MappedPoint) => {
    resolveNationsAtPoint(pt.latitude, pt.longitude, graph)
      .then((nationNames) => setPoints((current) => current.map((p) => (p.id === pt.id ? { ...p, status: 'done', nationNames } : p))))
      .catch(() => setPoints((current) => current.map((p) => (p.id === pt.id ? { ...p, status: 'error', nationNames: [] } : p))))
  }, [graph])

  const addPoint = useCallback((latitude: number, longitude: number) => {
    const pt: MappedPoint = { id: `p${counter.current++}`, latitude, longitude, status: 'loading', nationNames: [] }
    setPoints((current) => [...current, pt])
    setSelectedOrgId('')
    resolve(pt)
  }, [resolve])

  const loadOrg = useCallback((org: OrgRecord | null) => {
    setSelectedOrgId(org?.id ?? '')
    if (!org) { setPoints([]); return }
    setPerspective('organization')
    setOrganizationName(org.name)
    if (org.framing === 'regional') setRegionName('British Columbia')
    const next: MappedPoint[] = org.campuses.map((campus) => ({
      id: `p${counter.current++}`, name: campus.name, expected: campus.acknowledges,
      latitude: campus.latitude, longitude: campus.longitude, status: 'loading', nationNames: [],
    }))
    setPoints(next)
    next.forEach(resolve)
  }, [resolve])

  const removePoint = (id: string) => setPoints((current) => current.filter((point) => point.id !== id))

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

  const resolveNation = useMemo(() => createNationResolver(graph), [graph])
  const coverage = selectedOrg ? selectedOrg.acknowledges.map(resolveNation) : []
  const unlistedNations = coverage.filter((entry) => entry.status === 'unlisted')
  const graphBackedCount = coverage.filter((entry) => entry.inGraph).length

  return (
    <section className="mx-auto max-w-7xl px-3 pb-10 sm:px-6 lg:px-8">
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <div className="mb-1 inline-flex items-center gap-2 rounded-md border bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
              <Sparkles className="h-3.5 w-3.5 text-teal-700" />
              Experimental
            </div>
            <h2 className="text-base font-semibold">Multi-point composer & org comparison</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Pick a tracked organization (or click the map) to drop a point per campus. Each resolves to the Nation
              whose territory it falls in, so you can compare <span className="font-medium">what our engine generates</span>{' '}
              against <span className="font-medium">what the organization actually names</span>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedOrgId}
              onChange={(event) => loadOrg(organizations.find((org) => org.id === event.target.value) ?? null)}
              aria-label="Organization"
              className="rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none"
            >
              <option value="">Pick an organization…</option>
              {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
            <button type="button" onClick={() => loadOrg(null)} disabled={points.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-teal-300 disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="relative min-h-[24rem] overflow-hidden rounded-md border">
            <LocalMapBoundary result={null}>
              <PgMap className="h-full min-h-[24rem]" center={[-124.5, 54.5]} zoom={4} pitch={0} bearing={0} showStyleLoadingOverlay={false}>
                <MapClickLayer onAdd={addPoint} />
                <MapControls position="top-right" showFullscreen />
                {points.map((point, index) => (
                  <MapMarker key={point.id} longitude={point.longitude} latitude={point.latitude} anchor="bottom">
                    <MarkerContent>
                      <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-teal-700 text-xs font-semibold text-white shadow-lg">{index + 1}</span>
                    </MarkerContent>
                  </MapMarker>
                ))}
              </PgMap>
            </LocalMapBoundary>
            <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 rounded-md border bg-white/92 px-3 py-2 text-xs font-medium text-slate-900 shadow-sm backdrop-blur">
              Click the map to add a campus / site point.
            </div>
          </div>

          <div className="space-y-4 text-sm">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Campuses / points ({points.length})</span>
                {summary.pointCount > 1 && (
                  <span className="text-[10px] text-slate-500">{summary.distinctNationCount} Nations · ~{Math.round(summary.maxSpreadKm)} km</span>
                )}
              </div>
              <div className="space-y-2">
                {points.length === 0 && (
                  <div className="rounded-md border border-dashed p-3 text-xs text-slate-500">Pick an organization above, or click the map.</div>
                )}
                {points.map((point, index) => (
                  <div key={point.id} className="flex items-start gap-2 rounded-md border p-2 text-xs">
                    <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-700">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {point.name && <span className="font-medium text-slate-900">{point.name}</span>}
                        <span className="font-mono text-[10px] text-slate-500">{point.latitude.toFixed(3)}, {point.longitude.toFixed(3)}</span>
                      </div>
                      <div className="mt-0.5 text-slate-800">
                        {point.status === 'loading' && 'Resolving…'}
                        {point.status === 'error' && 'Lookup failed'}
                        {point.status === 'done' && (point.nationNames.length ? point.nationNames.join(', ') : 'No territory match')}
                      </div>
                    </div>
                    <button type="button" onClick={() => removePoint(point.id)} aria-label="Remove point" className="flex-none text-slate-400 hover:text-slate-700">
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
                <span className="text-[10px] text-slate-500">({graphBackedCount} in verified graph, rest in registry)</span>
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
