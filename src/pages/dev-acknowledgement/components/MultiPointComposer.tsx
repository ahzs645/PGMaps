import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, MapPin, Sparkles, Trash2, X } from 'lucide-react'

import { Map as PgMap, MapControls, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'
import {
  buildFallbackAcknowledgement,
  buildRegionalAcknowledgement,
  summarizeMultiPoint,
} from '@/lib/acknowledgement/engine'
import type { RelationshipGraph, SpeakerPerspective, WordingMode } from '@/lib/acknowledgement/engine'
import { wordingModeLabels } from '../data'
import { resolveNationsAtPoint } from '../spatial'
import { LocalMapBoundary } from './AcknowledgementMap'

type MappedPoint = {
  id: string
  latitude: number
  longitude: number
  status: 'loading' | 'done' | 'error'
  nationNames: string[]
}

type ScopeMode = 'auto' | 'specific' | 'regional'

const MODES: WordingMode[] = ['short', 'formal', 'event', 'institutional', 'educational']
const VOICES: { value: SpeakerPerspective; label: string }[] = [
  { value: 'collective', label: 'Community' },
  { value: 'individual', label: 'Individual' },
  { value: 'organization', label: 'Organization' },
]
const SCOPE_MODES: { value: ScopeMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'specific', label: 'Specific' },
  { value: 'regional', label: 'Regional' },
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

export function MultiPointComposer({ graph }: { graph: RelationshipGraph | null }) {
  const [points, setPoints] = useState<MappedPoint[]>([])
  const [mode, setMode] = useState<WordingMode>('event')
  const [perspective, setPerspective] = useState<SpeakerPerspective>('organization')
  const [organizationName, setOrganizationName] = useState('')
  const [regionName, setRegionName] = useState('British Columbia')
  const [scopeMode, setScopeMode] = useState<ScopeMode>('auto')
  const [copied, setCopied] = useState(false)
  const counter = useRef(0)

  const addPoint = useCallback((latitude: number, longitude: number) => {
    const id = `p${counter.current++}`
    setPoints((current) => [...current, { id, latitude, longitude, status: 'loading', nationNames: [] }])
    resolveNationsAtPoint(latitude, longitude, graph)
      .then((nationNames) => setPoints((current) => current.map((point) => (
        point.id === id ? { ...point, status: 'done', nationNames } : point
      ))))
      .catch(() => setPoints((current) => current.map((point) => (
        point.id === id ? { ...point, status: 'error', nationNames: [] } : point
      ))))
  }, [graph])

  const removePoint = (id: string) => setPoints((current) => current.filter((point) => point.id !== id))

  const summary = useMemo(() => summarizeMultiPoint(
    points.filter((point) => point.status === 'done').map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude,
      nationNames: point.nationNames,
    })),
  ), [points])

  const effectiveScope = scopeMode === 'auto' ? (summary.suggestRegional ? 'regional' : 'specific') : scopeMode

  const statement = useMemo(() => {
    if (points.length === 0) return ''
    if (effectiveScope === 'regional') {
      return buildRegionalAcknowledgement(mode, { perspective, organizationName, regionName })
    }
    return buildFallbackAcknowledgement(mode, summary.nationNames, { perspective, organizationName })
  }, [points.length, effectiveScope, mode, perspective, organizationName, regionName, summary.nationNames])

  const copy = useCallback(async () => {
    if (!statement) return
    try {
      await navigator.clipboard.writeText(statement)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [statement])

  return (
    <section className="mx-auto max-w-7xl px-3 pb-10 sm:px-6 lg:px-8">
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <div className="mb-1 inline-flex items-center gap-2 rounded-md border bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
              <Sparkles className="h-3.5 w-3.5 text-teal-700" />
              Experimental
            </div>
            <h2 className="text-base font-semibold">Multi-point composer</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Drop points to define a relationship by geography. Each point resolves to the Nation whose
              territory it falls in; the union generates a statement. A wide or many-Nation footprint
              auto-suggests the regional voice.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPoints([])}
            disabled={points.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-teal-300 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear points
          </button>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative min-h-[22rem] overflow-hidden rounded-md border">
            <LocalMapBoundary result={null}>
              <PgMap
                className="h-full min-h-[22rem]"
                center={[-124.5, 54.5]}
                zoom={4}
                pitch={0}
                bearing={0}
                showStyleLoadingOverlay={false}
              >
                <MapClickLayer onAdd={addPoint} />
                <MapControls position="top-right" showFullscreen />
                {points.map((point, index) => (
                  <MapMarker key={point.id} longitude={point.longitude} latitude={point.latitude} anchor="bottom">
                    <MarkerContent>
                      <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-teal-700 text-xs font-semibold text-white shadow-lg">
                        {index + 1}
                      </span>
                    </MarkerContent>
                  </MapMarker>
                ))}
              </PgMap>
            </LocalMapBoundary>
            <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 rounded-md border bg-white/92 px-3 py-2 text-xs font-medium text-slate-900 shadow-sm backdrop-blur">
              Click the map to add a point.
            </div>
          </div>

          <div className="space-y-4 text-sm">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Points ({points.length})</span>
                {summary.suggestRegional && (
                  <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                    Regional suggested
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {points.length === 0 && (
                  <div className="rounded-md border border-dashed p-3 text-xs text-slate-500">
                    No points yet — click the map to start.
                  </div>
                )}
                {points.map((point, index) => (
                  <div key={point.id} className="flex items-start gap-2 rounded-md border p-2 text-xs">
                    <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-700">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] text-slate-500">
                        {point.latitude.toFixed(4)}, {point.longitude.toFixed(4)}
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
              {summary.pointCount > 1 && (
                <div className="mt-2 text-[10px] text-slate-500">
                  {summary.distinctNationCount} Nation{summary.distinctNationCount === 1 ? '' : 's'} · ~{Math.round(summary.maxSpreadKm)} km spread
                </div>
              )}
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

            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Scope{scopeMode === 'auto' && ` · auto → ${effectiveScope}`}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {SCOPE_MODES.map(({ value, label }) => (
                  <button key={value} type="button" onClick={() => setScopeMode(value)}
                    className={cn('rounded-md border px-2 py-1.5 text-xs font-medium', scopeMode === value ? 'border-teal-700 bg-teal-700 text-white' : 'bg-white hover:border-teal-300')}>
                    {label}
                  </button>
                ))}
              </div>
              {effectiveScope === 'regional' && (
                <input value={regionName} onChange={(event) => setRegionName(event.target.value)}
                  placeholder="Region (e.g. British Columbia)" aria-label="Region name"
                  className="mt-2 w-full rounded-md border bg-white px-3 py-1.5 text-sm outline-none" />
              )}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Generated statement</span>
                <button type="button" onClick={copy} disabled={!statement}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-800 disabled:opacity-40">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="min-h-[5rem] rounded-md border bg-slate-50 p-3 text-sm leading-6 text-slate-900">
                {statement || <span className="text-slate-400">Drop a point to generate a statement.</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 border-t bg-amber-50/60 px-4 py-3 text-xs leading-5 text-amber-900">
          <MapPin className="mt-0.5 h-3.5 w-3.5 flex-none" />
          Geometry-derived drafts use Native Land territory polygons as context triggers — treat them as review-level
          starting points, not verified wording, until confirmed with the Nation or an official source.
        </div>
      </div>
    </section>
  )
}
