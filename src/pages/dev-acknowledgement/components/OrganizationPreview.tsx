import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, MapPin, Quote } from 'lucide-react'

import { Map as PgMap, MapControls, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { buildFallbackAcknowledgement, buildRegionalAcknowledgement } from '@/lib/acknowledgement/engine'
import type { SpeakerPerspective, WordingMode } from '@/lib/acknowledgement/engine'
import { defaultWordingOptions } from '../data'
import { inferLocationType, organizations } from '../organizations'
import { LocalMapBoundary } from './AcknowledgementMap'
import { WordingOptionsControls, type AcknowledgementScope, type WordingToggle } from './WordingOptionsControls'

const humanize = (value: string) => value.replace(/[_-]+/g, ' ')
const statementKindLabel = (kind: string | undefined) => {
  if (kind === 'exact_statement') return 'Exact statement'
  if (kind === 'exact_excerpt') return 'Exact excerpt'
  if (kind === 'not_found') return 'Not found'
  return 'Source wording'
}

type LatLng = { latitude: number; longitude: number }

/** Frames the map around the org's campus points whenever the selection changes. */
function FitToCampuses({ campuses }: { campuses: LatLng[] }) {
  const { map, isLoaded } = useMap()
  const key = campuses.map((campus) => `${campus.latitude},${campus.longitude}`).join('|')
  useEffect(() => {
    if (!map || !isLoaded || campuses.length === 0) return
    if (campuses.length === 1) {
      map.flyTo({ center: [campuses[0].longitude, campuses[0].latitude], zoom: 9, duration: 600 })
      return
    }
    let west = Infinity
    let south = Infinity
    let east = -Infinity
    let north = -Infinity
    for (const campus of campuses) {
      west = Math.min(west, campus.longitude)
      east = Math.max(east, campus.longitude)
      south = Math.min(south, campus.latitude)
      north = Math.max(north, campus.latitude)
    }
    map.fitBounds([[west, south], [east, north]], { padding: 56, maxZoom: 10, duration: 600 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, key])
  return null
}

type OrganizationPreviewProps = {
  orgId: string | null
  /** Load this org's campuses onto the Map & Nations tab. */
  onPreviewOnMap: (id: string) => void
}

/**
 * Detail view for the org selected in the preset library: a map of its campuses,
 * the Nations it documents, and a generated acknowledgement statement the user can
 * shape with the shared wording options. Mount with a key per org so the wording
 * state initializes from that org (voice = organization, name = org name).
 */
export function OrganizationPreview({ orgId, onPreviewOnMap }: OrganizationPreviewProps) {
  const org = orgId ? organizations.find((item) => item.id === orgId) ?? null : null

  const [wordingMode, setWordingMode] = useState<WordingMode>('institutional')
  const [perspective, setPerspective] = useState<SpeakerPerspective>('organization')
  const [organizationName, setOrganizationName] = useState(org?.name ?? '')
  const [scope, setScope] = useState<AcknowledgementScope>(org?.framing === 'regional' ? 'regional' : 'specific')
  const [regionName, setRegionName] = useState('British Columbia')
  const [wordingOptions, setWordingOptions] = useState(defaultWordingOptions)
  const [copied, setCopied] = useState(false)

  if (!org) {
    return (
      <div className="flex min-h-[16rem] items-center justify-center rounded-lg border border-dashed bg-white p-8 text-center text-sm text-slate-500">
        Select an organization from the list to see what it documents.
      </div>
    )
  }

  const statement = scope === 'regional'
    ? buildRegionalAcknowledgement(wordingMode, { perspective, organizationName, regionName })
    : buildFallbackAcknowledgement(wordingMode, org.acknowledges, { perspective, organizationName })

  // The note earns its place when it adds territory status ("Unceded territories of…")
  // or describes the org's approach. Hide it when it's just the same Nation list already
  // shown under "Names" (some records duplicate the list verbatim in the note).
  const normalizeList = (value: string) => value.toLowerCase().replace(/\band\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const noteIsJustNames = org.note != null && normalizeList(org.note) === normalizeList(org.acknowledges.join(' '))

  const copyStatement = () => {
    if (!statement) return
    navigator.clipboard.writeText(statement).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }).catch(() => undefined)
  }

  const toggleOption = (option: WordingToggle) => setWordingOptions((current) => ({ ...current, [option]: !current[option] }))

  return (
    <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
      {org.campuses.length > 0 && (
        <div className="relative min-h-[16rem] border-b">
          <LocalMapBoundary result={null}>
            <PgMap
              className="h-full min-h-[16rem]"
              center={[org.campuses[0].longitude, org.campuses[0].latitude]}
              zoom={8}
              pitch={0}
              bearing={0}
              showStyleLoadingOverlay={false}
            >
              <FitToCampuses campuses={org.campuses} />
              <MapControls position="top-right" showFullscreen />
              {org.campuses.map((campus, index) => (
                <MapMarker key={`${campus.name}-${campus.latitude}`} longitude={campus.longitude} latitude={campus.latitude} anchor="bottom">
                  <MarkerContent>
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-teal-700 text-xs font-semibold text-white shadow-lg">{index + 1}</span>
                  </MarkerContent>
                </MapMarker>
              ))}
            </PgMap>
          </LocalMapBoundary>
        </div>
      )}

      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{org.name}</h2>
            <div className="mt-1 flex flex-wrap gap-1">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">{humanize(org.sector)}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">{humanize(org.framing)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onPreviewOnMap(org.id)}
            className="inline-flex flex-none items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-teal-800 transition hover:border-teal-300"
          >
            <MapPin className="h-4 w-4" />
            Open on Map & Nations
          </button>
        </div>

        {org.note && !noteIsJustNames && <p className="mt-3 text-sm leading-6 text-slate-600">{org.note}</p>}

        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Names ({org.acknowledges.length})</div>
          <div className="mt-1 text-sm leading-6 text-slate-800">
            {org.acknowledges.length ? org.acknowledges.join(', ') : <span className="text-slate-400">Region-wide — no specific Nations</span>}
          </div>
        </div>

        {(org.statement || org.statementKind === 'not_found') && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Quote className="h-4 w-4 text-slate-500" />
                Official source wording
              </h3>
              <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                {statementKindLabel(org.statementKind)}
              </span>
            </div>
            {org.statement ? (
              <blockquote className="text-sm leading-6 text-slate-800">“{org.statement}”</blockquote>
            ) : (
              <p className="text-sm leading-6 text-slate-500">No official acknowledgement wording found.</p>
            )}
            <a href={org.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-800">
              Open source <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        <div className="mt-4 rounded-lg border border-teal-200 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Generated acknowledgement</h3>
            <button
              type="button"
              onClick={copyStatement}
              disabled={!statement}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-800 disabled:opacity-40"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-900">{statement}</p>
          <div className="mt-3">
            <WordingOptionsControls
              wordingMode={wordingMode}
              onWordingModeChange={setWordingMode}
              perspective={perspective}
              onPerspectiveChange={setPerspective}
              organizationName={organizationName}
              onOrganizationNameChange={setOrganizationName}
              scope={scope}
              onScopeChange={setScope}
              regionName={regionName}
              onRegionNameChange={setRegionName}
              wordingOptions={wordingOptions}
              onToggleOption={toggleOption}
              showContextToggles={false}
              showVoice={false}
            />
          </div>
        </div>

        {org.campuses.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Locations ({org.campuses.length})</div>
            <div className="mt-1 space-y-1.5">
              {org.campuses.map((campus, index) => {
                const locationType = campus.type ?? inferLocationType(campus.name, org.sector)
                return (
                  <div key={`${campus.name}-${campus.latitude}`} className="flex items-start gap-2 rounded-md border p-2 text-xs">
                    <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-700">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-medium text-slate-900">{campus.name}</span>
                          {locationType && (
                            <span className="flex-none rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600">{locationType}</span>
                          )}
                        </span>
                        <span className="flex-none font-mono text-[10px] text-slate-500">{campus.latitude.toFixed(3)}, {campus.longitude.toFixed(3)}</span>
                      </div>
                      {campus.acknowledges.length > 0 && (
                        <div className="mt-0.5 text-slate-600">{campus.acknowledges.join(', ')}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-3 border-t pt-3">
          <a href={org.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-teal-800">
            Official acknowledgement source <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </section>
  )
}
