import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Globe2,
  Layers3,
  MapPin,
  Search,
  ShieldCheck,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { AcknowledgementDropMap, LocalMapBoundary } from './dev-acknowledgement/AcknowledgementMap'
import { buildCandidatesFromLookups } from './dev-acknowledgement/candidates'
import {
  acknowledgementTemplatePrompts,
  confidenceLabels,
  confidenceStyles,
  defaultWordingOptions,
  INDIGENOUS_MANIFEST_DATA,
  initialLookupState,
  localLanguageResources,
  pronunciationSources,
  sourceMeta,
  unresolvedDataGaps,
  wordingModeLabels,
} from './dev-acknowledgement/data'
import { geocodeAddress, locationFromCoordinates } from './dev-acknowledgement/geocode'
import {
  loadRelationshipGraph,
  localVerifiedMatches,
  matchBoundaryRelationshipPlace,
  matchRelationshipPlace,
  queryNativeLandSource,
  queryReserveSource,
  queryTreatySources,
  relationshipMatches,
} from './dev-acknowledgement/spatial'
import {
  buildAcknowledgement,
  buildRelationshipAcknowledgement,
  formatList,
  nationName,
  selectedNationIdsForRelationship,
} from './dev-acknowledgement/wording'
import type {
  DroppedLocation,
  GeocodeResult,
  GeocodeStatus,
  IndigenousManifest,
  MatchedRelationshipPlace,
  MatchType,
  RelationshipGraph,
  SourceKey,
  SourceLookupState,
  SourceStatus,
  WordingMode,
  WordingOptions,
} from './dev-acknowledgement/types'

function sourceLookupMessage(status: SourceStatus) {
  if (status === 'loading') return 'Checking'
  if (status === 'success') return 'Local'
  if (status === 'error') return 'Issue'
  if (status === 'skipped') return 'Manual'
  return 'Ready'
}

export default function DevAcknowledgement() {
  const [address, setAddress] = useState('3333 University Way, Prince George, BC')
  const [geocodeResult, setGeocodeResult] = useState<GeocodeResult | null>(null)
  const [geocodeStatus, setGeocodeStatus] = useState<GeocodeStatus>('idle')
  const [geocodeError, setGeocodeError] = useState<string | null>(null)
  const [indigenousManifest, setIndigenousManifest] = useState<IndigenousManifest | null>(null)
  const [relationshipGraph, setRelationshipGraph] = useState<RelationshipGraph | null>(null)
  const [matchedRelationshipPlace, setMatchedRelationshipPlace] = useState<MatchedRelationshipPlace | null>(null)
  const [enabledMatchTypes, setEnabledMatchTypes] = useState<Record<MatchType, boolean>>(() => ({
    place: true,
    municipality: true,
    boundary: true,
  }))
  const [enabledSources, setEnabledSources] = useState<Record<SourceKey, boolean>>(() => ({
    verified: true,
    nativeLand: true,
    cad: true,
    treaty: true,
    reserve: true,
    local: true,
  }))
  const [selectedIds, setSelectedIds] = useState<string[]>(['lheidli'])
  const [wordingMode, setWordingMode] = useState<WordingMode>('event')
  const [wordingOptions, setWordingOptions] = useState<WordingOptions>(defaultWordingOptions)
  const [customWording, setCustomWording] = useState('')
  const [sourceLookups, setSourceLookups] = useState<Record<SourceKey, SourceLookupState>>(initialLookupState)
  const [copied, setCopied] = useState(false)

  const candidates = useMemo(() => buildCandidatesFromLookups(sourceLookups), [sourceLookups])
  const automatedManifestSources = indigenousManifest?.automated ?? []
  const manualManifestSources = indigenousManifest?.manual ?? []

  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => (
      Object.keys(candidate.sources).some((source) => enabledSources[source as SourceKey])
    )),
    [candidates, enabledSources],
  )

  const selectedNames = useMemo(
    () => candidates
      .filter((candidate) => selectedIds.includes(candidate.id))
      .map((candidate) => candidate.preferredName),
    [candidates, selectedIds],
  )

  const wording = useMemo(() => (
    relationshipGraph && matchedRelationshipPlace && enabledSources.verified
      ? buildRelationshipAcknowledgement(wordingMode, relationshipGraph, matchedRelationshipPlace, selectedIds, wordingOptions)
      : buildAcknowledgement(wordingMode, selectedNames)
  ), [enabledSources.verified, matchedRelationshipPlace, relationshipGraph, selectedIds, selectedNames, wordingMode, wordingOptions])

  useEffect(() => {
    setCustomWording(wording)
  }, [wording])

  useEffect(() => {
    let cancelled = false
    fetch(INDIGENOUS_MANIFEST_DATA)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load Indigenous manifest (${response.status})`)
        return response.json() as Promise<IndigenousManifest>
      })
      .then((manifest) => {
        if (!cancelled) setIndigenousManifest(manifest)
      })
      .catch(() => {
        if (!cancelled) setIndigenousManifest(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadRelationshipGraph()
      .then((graph) => {
        if (!cancelled) setRelationshipGraph(graph)
      })
      .catch(() => {
        if (!cancelled) setRelationshipGraph(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (candidates.length === 0) return
    setSelectedIds((current) => {
      const available = new Set(candidates.map((candidate) => candidate.id))
      const kept = current.filter((id) => available.has(id))
      if (kept.length > 0) return kept
      const strong = candidates.find((candidate) => candidate.confidence === 'strong')
      return [strong?.id ?? candidates[0].id]
    })
  }, [candidates])

  useEffect(() => {
    const controller = new AbortController()
    setGeocodeStatus('loading')
    setGeocodeError(null)
    geocodeAddress(address, controller.signal)
      .then((result) => {
        setGeocodeResult(result)
        setGeocodeStatus('success')
        void runSourceLookups(result)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setGeocodeResult(null)
        setGeocodeStatus('error')
        setGeocodeError(error instanceof Error ? error.message : 'Unable to geocode this address')
      })
    return () => controller.abort()
    // Run once to populate the default sample address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runSourceLookups = useCallback(async (result: GeocodeResult, matchTypes = enabledMatchTypes, addressForMatch = address) => {
    const controller = new AbortController()
    setSourceLookups({
      verified: { status: 'loading', matches: [] },
      nativeLand: { status: 'loading', matches: [] },
      treaty: { status: 'loading', matches: [] },
      reserve: { status: 'loading', matches: [] },
      local: { status: 'loading', matches: [] },
      cad: initialLookupState.cad,
    })
    setMatchedRelationshipPlace(null)

    const settle = (source: SourceKey, state: SourceLookupState) => {
      setSourceLookups((current) => ({ ...current, [source]: state }))
    }

    loadRelationshipGraph()
      .then(async (graph) => {
        setRelationshipGraph(graph)
        const match = matchRelationshipPlace(graph, result, addressForMatch, matchTypes)
          ?? (matchTypes.boundary ? await matchBoundaryRelationshipPlace(graph, result) : null)
        setMatchedRelationshipPlace(match)
        settle('verified', {
          status: 'success',
          matches: match ? relationshipMatches(graph, match) : [],
          message: match ? `Matched ${match.place.name}` : 'No curated place or boundary relationship matched this address.',
        })
      })
      .catch((error: unknown) => settle('verified', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Relationship graph lookup failed.',
      }))

    queryNativeLandSource(result.latitude, result.longitude, controller.signal)
      .then((matches) => settle('nativeLand', { status: 'success', matches, message: matches.length ? undefined : 'No Native Land Digital overlaps returned.' }))
      .catch((error: unknown) => settle('nativeLand', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Native Land Digital lookup failed.',
      }))

    queryTreatySources(result.latitude, result.longitude)
      .then((matches) => settle('treaty', { status: 'success', matches, message: matches.length ? undefined : 'No treaty land or treaty area intersection at this point.' }))
      .catch((error: unknown) => settle('treaty', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Treaty layer lookup failed.',
      }))

    queryReserveSource(result.latitude, result.longitude)
      .then((matches) => settle('reserve', { status: 'success', matches, message: matches.length ? undefined : 'No reserve boundary intersection at this point.' }))
      .catch((error: unknown) => settle('reserve', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Reserve layer lookup failed.',
      }))

    localVerifiedMatches(result)
      .then((matches) => settle('local', { status: 'success', matches, message: matches.length ? undefined : 'No First Nation community within range of this point.' }))
      .catch((error: unknown) => settle('local', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Community reference lookup failed.',
      }))
  }, [address, enabledMatchTypes])

  const handleGeocode = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    const trimmedAddress = address.trim()
    if (!trimmedAddress) {
      setGeocodeStatus('error')
      setGeocodeError('Enter a B.C. address to geocode')
      setGeocodeResult(null)
      return
    }

    setGeocodeStatus('loading')
    setGeocodeError(null)
    try {
      const result = await geocodeAddress(trimmedAddress)
      setGeocodeResult(result)
      setGeocodeStatus('success')
      void runSourceLookups(result, enabledMatchTypes, trimmedAddress)
    } catch (error) {
      setGeocodeResult(null)
      setGeocodeStatus('error')
      setGeocodeError(error instanceof Error ? error.message : 'Unable to geocode this address')
    }
  }

  const handleDroppedLocation = useCallback((location: DroppedLocation) => {
    const result = locationFromCoordinates(location)
    setGeocodeResult(result)
    setGeocodeStatus('success')
    setGeocodeError(null)
    setAddress(result.fullAddress)
    void runSourceLookups(result, enabledMatchTypes, result.fullAddress)
  }, [enabledMatchTypes, runSourceLookups])

  const toggleSource = (source: SourceKey) => {
    setEnabledSources((current) => ({ ...current, [source]: !current[source] }))
  }

  const toggleMatchType = (matchType: MatchType) => {
    setEnabledMatchTypes((current) => {
      const next = { ...current, [matchType]: !current[matchType] }
      if (geocodeResult) void runSourceLookups(geocodeResult, next)
      return next
    })
  }

  const toggleWordingOption = (option: keyof WordingOptions) => {
    setWordingOptions((current) => ({ ...current, [option]: !current[option] }))
  }

  const toggleCandidate = (candidateId: string) => {
    setSelectedIds((current) => (
      current.includes(candidateId)
        ? current.filter((id) => id !== candidateId)
        : [...current, candidateId]
    ))
  }

  const handleCopyWording = useCallback(async () => {
    const text = customWording.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [customWording])

  return (
    <div className="min-h-full bg-stone-50 pt-12 text-slate-950 sm:pt-0">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-md border bg-white px-3 py-1 text-sm font-medium text-slate-600">
                <ShieldCheck className="h-4 w-4 text-teal-700" />
                Multi-source acknowledgement engine
              </div>
              <h1 className="text-3xl font-semibold tracking-tight">Acknowledgement Builder</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Prototype flow for geocoding a B.C. address, comparing official and educational spatial sources,
                selecting candidate Nations, and generating editable wording with review guidance.
              </p>
            </div>
            <Button variant="outline" onClick={handleCopyWording} className="w-full sm:w-auto">
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy wording'}
            </Button>
          </div>

          <form onSubmit={handleGeocode} className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <label className="flex min-h-12 items-center gap-3 rounded-lg border bg-white px-3 shadow-sm">
              <MapPin className="h-5 w-5 flex-none text-teal-700" />
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                aria-label="Address"
              />
            </label>
            <Button type="submit" variant="outline" className="min-h-12 justify-center" disabled={geocodeStatus === 'loading'}>
              <Search className="h-4 w-4 lg:hidden" />
              <span>{geocodeStatus === 'loading' ? 'Geocoding address' : 'Run source comparison'}</span>
              <ChevronRight className="hidden h-4 w-4 lg:block" />
            </Button>
          </form>
          {geocodeStatus === 'error' && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {geocodeError}
            </div>
          )}
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[280px_1fr_360px] lg:gap-5 lg:px-8">
        <aside className="order-3 space-y-4 lg:order-1">
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Layers3 className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Source Layers</h2>
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
              {(Object.keys(sourceMeta) as SourceKey[]).map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => toggleSource(source)}
                  className="flex min-w-48 items-start gap-3 rounded-md border p-3 text-left transition hover:border-teal-300 lg:w-full lg:min-w-0"
                >
                  <span className={cn(
                    'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded border',
                    enabledSources[source] ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white',
                  )}>
                    {enabledSources[source] && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="block text-sm font-medium">{sourceMeta[source].label}</span>
                      <span className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                        sourceLookups[source].status === 'success' && 'bg-emerald-100 text-emerald-800',
                        sourceLookups[source].status === 'loading' && 'bg-sky-100 text-sky-800',
                        sourceLookups[source].status === 'error' && 'bg-red-100 text-red-800',
                        sourceLookups[source].status === 'skipped' && 'bg-slate-100 text-slate-600',
                        sourceLookups[source].status === 'idle' && 'bg-slate-100 text-slate-600',
                      )}>
                        {sourceLookupMessage(sourceLookups[source].status)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">{sourceMeta[source].type}</span>
                    {sourceLookups[source].message && (
                      <span className="mt-1 block text-xs leading-4 text-slate-500">{sourceLookups[source].message}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Match Types</h2>
            </div>
            <div className="space-y-2 text-xs leading-5 text-slate-600">
              {([
                ['place', 'Exact places', 'Campuses, institutes, and named facilities with curated records.'],
                ['municipality', 'Municipal context', 'City-level records such as Prince George.'],
                ['boundary', 'Boundary context', 'Point-in-polygon matches from configured reference areas.'],
              ] as const).map(([matchType, label, description]) => (
                <button
                  key={matchType}
                  type="button"
                  onClick={() => toggleMatchType(matchType)}
                  className="flex w-full items-start gap-3 rounded-md border p-3 text-left transition hover:border-teal-300"
                >
                  <span className={cn(
                    'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded border',
                    enabledMatchTypes[matchType] ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white',
                  )}>
                    {enabledMatchTypes[matchType] && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span>
                    <span className="block font-medium text-slate-900">{label}</span>
                    <span className="mt-0.5 block text-slate-500">{description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Database className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Data Provenance</h2>
            </div>
            <div className="space-y-3 text-xs leading-5 text-slate-600">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Automated</div>
              {automatedManifestSources.map((source) => {
                const href = source.sourceUrl ?? source.url ?? source.output ?? INDIGENOUS_MANIFEST_DATA
                return (
                  <a
                    key={source.id}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-md border border-emerald-100 bg-emerald-50/40 p-3 transition hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-slate-900">{source.title}</span>
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
                    </span>
                    <span className="mt-1 inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                      {source.access ?? 'automated'}{source.featureCount ? ` · ${source.featureCount} features` : ''}
                    </span>
                    <span className="mt-2 block">
                      {source.output ? `Synced by bcdatamapper to ${source.output}.` : 'Tracked by the bcdatamapper Indigenous source manifest.'}
                    </span>
                    <span className="mt-1 block text-slate-500">{source.caveat}</span>
                  </a>
                )
              })}
              {automatedManifestSources.length === 0 && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-500">
                  bcdatamapper manifest not loaded yet.
                </div>
              )}
              <div className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Manual</div>
              {manualManifestSources.map((source) => {
                const href = source.url ?? source.sourceUrl ?? INDIGENOUS_MANIFEST_DATA
                return (
                  <a
                    key={source.id}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-md border p-3 transition hover:border-teal-300 hover:bg-teal-50/40"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-slate-900">{source.title}</span>
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
                    </span>
                    <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                      {source.access ?? 'manual'}
                    </span>
                    <span className="mt-2 block">
                      Tracked in the bcdatamapper manifest as a non-automated source.
                    </span>
                    <span className="mt-1 block text-slate-500">{source.caveat}</span>
                  </a>
                )
              })}
              {manualManifestSources.length === 0 && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-500">
                  Manual bcdatamapper source metadata not loaded yet.
                </div>
              )}
              <div className="flex items-center gap-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                Gaps
              </div>
              {unresolvedDataGaps.map((gap) => (
                <a
                  key={gap.name}
                  href={gap.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md border p-3 transition hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900">{gap.name}</span>
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
                  </span>
                  <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                    {gap.status}
                  </span>
                  <span className="mt-2 block">{gap.use}</span>
                  <span className="mt-1 block text-slate-500">{gap.limitation}</span>
                </a>
              ))}
            </div>
          </section>
        </aside>

        <section className="order-1 space-y-4 lg:order-2">
          <div className="grid overflow-hidden rounded-lg border bg-white shadow-sm xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="relative min-h-[20rem]">
              <LocalMapBoundary result={geocodeResult}>
                <AcknowledgementDropMap
                  result={geocodeResult}
                  loading={geocodeStatus === 'loading'}
                  onDrop={handleDroppedLocation}
                />
              </LocalMapBoundary>
            </div>
            <div className="border-t p-4 xl:border-l xl:border-t-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Location</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Search an address, click the map, or drag the pin.
                  </p>
                </div>
                <span className={cn(
                  'rounded px-2 py-1 text-[10px] font-semibold uppercase',
                  geocodeStatus === 'success' && 'bg-emerald-100 text-emerald-800',
                  geocodeStatus === 'loading' && 'bg-sky-100 text-sky-800',
                  geocodeStatus === 'error' && 'bg-red-100 text-red-800',
                  geocodeStatus === 'idle' && 'bg-slate-100 text-slate-600',
                )}>
                  {geocodeStatus}
                </span>
              </div>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-xs uppercase text-slate-500">Selected point</dt>
                  <dd className="mt-1 break-words font-medium">{geocodeResult?.fullAddress ?? address}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">Coordinates</dt>
                  <dd className="mt-1 font-mono text-xs">
                    {geocodeResult ? `${geocodeResult.latitude.toFixed(6)}, ${geocodeResult.longitude.toFixed(6)}` : 'Waiting for match'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">Geocoder</dt>
                  <dd className="mt-1">{geocodeResult?.matchPrecision === 'Map point' ? 'Map drop' : 'BC Address Geocoder'}</dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs uppercase text-slate-500">Score</dt>
                    <dd className="mt-1">{geocodeResult ? `${geocodeResult.score}/100` : '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">Precision</dt>
                    <dd className="mt-1 break-words">{geocodeResult?.matchPrecision ?? '-'}</dd>
                  </div>
                </div>
              </dl>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                {(['verified', 'nativeLand', 'treaty'] as SourceKey[]).map((source) => (
                  <div key={source} className="rounded-md border bg-slate-50 px-2 py-2">
                    <div className="text-base font-semibold text-slate-950">{sourceLookups[source].matches.length}</div>
                    <div className="mt-0.5 truncate text-slate-500">{sourceMeta[source].label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {relationshipGraph && matchedRelationshipPlace && enabledSources.verified && (
            <section className="rounded-lg border border-teal-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-teal-700" />
                <h2 className="text-sm font-semibold">Verified Relationship Match</h2>
              </div>
              <div className="text-sm">
                <div className="font-semibold text-slate-950">{matchedRelationshipPlace.place.name}</div>
                <div className="mt-1 text-xs leading-5 text-slate-600">
                  Generated from structured place, Nation, people-group, territory-status, and treaty relationship facts.
                </div>
              </div>
              <div className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
                {matchedRelationshipPlace.relationships.map((relationship) => {
                  const nationIds = selectedNationIdsForRelationship(relationshipGraph, relationship, selectedIds)
                  return (
                    <div key={relationship.id} className="rounded-md border bg-teal-50/50 p-3">
                      <div className="font-semibold text-slate-900">
                        {relationship.relationshipType.replace(/_/g, ' ')}
                        {relationship.treatyName ? ` · ${relationship.treatyName}` : ''}
                      </div>
                      <div className="mt-1">
                        {formatList(nationIds.map((nationId) => nationName(relationshipGraph, nationId)))}
                      </div>
                      {(relationship.referenceAreaIds ?? []).length > 0 && (
                        <div className="mt-2 space-y-2">
                          {relationship.referenceAreaIds?.map((areaId) => {
                            const area = relationshipGraph.referenceAreas?.find((item) => item.id === areaId)
                            if (!area) return null
                            return (
                              <div key={area.id} className="rounded border border-teal-100 bg-white p-2">
                                <div className="font-medium text-slate-900">{area.name}</div>
                                <div className="mt-1 text-slate-500">{area.caveat}</div>
                                <div className="mt-1 text-[10px] font-semibold uppercase text-slate-500">
                                  {area.geometryStatus.replace(/_/g, ' ')}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[
                          ...relationship.sourceRefs,
                          ...(relationship.referenceAreaIds ?? []).flatMap((areaId) => (
                            relationshipGraph.referenceAreas?.find((area) => area.id === areaId)?.sourceRefs ?? []
                          )),
                        ].filter((sourceRef, index, sourceRefs) => sourceRefs.indexOf(sourceRef) === index).map((sourceRef) => {
                          const source = relationshipGraph.sources.find((item) => item.id === sourceRef)
                          if (!source) return null
                          return (
                            <a
                              key={sourceRef}
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 font-medium text-teal-800"
                            >
                              {source.title}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <section className="rounded-lg border bg-white shadow-sm">
            <div className="border-b p-4">
              <h2 className="text-base font-semibold">Candidate Nations</h2>
              <p className="mt-1 text-sm text-slate-600">Select what should be included in the generated acknowledgement.</p>
            </div>
            <div className="divide-y">
              {visibleCandidates.length === 0 && (
                <div className="p-4 text-sm leading-6 text-slate-600">
                  No candidate Nations have been returned from the enabled live sources yet. Try a B.C. address, enable a source with data, or add local verified wording.
                </div>
              )}
              {visibleCandidates.map((candidate) => (
                <article key={candidate.id} className="grid gap-4 p-4 md:grid-cols-[1fr_220px]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleCandidate(candidate.id)}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded border',
                          selectedIds.includes(candidate.id) ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300',
                        )}
                        aria-label={`Include ${candidate.name}`}
                      >
                        {selectedIds.includes(candidate.id) && <Check className="h-4 w-4" />}
                      </button>
                      <h3 className="min-w-0 flex-1 text-sm font-semibold sm:text-base">{candidate.name}</h3>
                      <span className={cn('rounded-md border px-2 py-0.5 text-xs font-medium', confidenceStyles[candidate.confidence])}>
                        {confidenceLabels[candidate.confidence]}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{candidate.reason}</p>
                    {candidate.pronunciation && (
                      <div className="mt-3 rounded-md border border-teal-100 bg-teal-50 p-3 text-xs leading-5 text-teal-950">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">Pronunciation</span>
                          {candidate.pronunciation.phonetic && (
                            <span className="rounded bg-white px-2 py-0.5 font-medium text-teal-900">
                              {candidate.pronunciation.phonetic}
                            </span>
                          )}
                          {candidate.pronunciation.audioUrl && (
                            <a
                              href={candidate.pronunciation.audioUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium underline"
                            >
                              Listen
                            </a>
                          )}
                          <a
                            href={candidate.pronunciation.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium underline"
                          >
                            {candidate.pronunciation.sourceLabel}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <p className="mt-1 text-teal-800">{candidate.pronunciation.caveat}</p>
                      </div>
                    )}
                    <p className="mt-2 text-xs leading-5 text-slate-500">{candidate.notes}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    {(Object.keys(sourceMeta) as SourceKey[]).map((source) => (
                      <div
                        key={source}
                        className={cn(
                          'rounded-md border p-2',
                          candidate.sources[source] && enabledSources[source] ? 'border-teal-200 bg-teal-50' : 'border-slate-100 bg-slate-50 text-slate-400',
                        )}
                      >
                        <div className="font-medium">{sourceMeta[source].label}</div>
                        <div className="mt-1 leading-4">{candidate.sources[source] ?? 'No match'}</div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>

        <aside className="order-2 space-y-4 lg:order-3">
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Variant Controls</h2>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-2 xl:grid-cols-3">
              {(['short', 'formal', 'event', 'institutional', 'educational'] as WordingMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setWordingMode(mode)}
                  className={cn(
                    'rounded-md border px-2 py-2 text-xs font-medium',
                    wordingMode === mode ? 'border-teal-700 bg-teal-700 text-white' : 'bg-white hover:border-teal-300',
                  )}
                >
                  {wordingModeLabels[mode]}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-600">
              {([
                ['includeTreatyContext', 'Treaty context', 'Include phrases such as Treaty 8 territory or Nisg̱a’a Treaty territory when present.'],
                ['includePeopleGroupContext', 'People-group context', 'Include connected peoples such as Dakelh, Dane-zaa, Ts’msyen, or Nisg̱a’a when present.'],
              ] as const).map(([option, label, description]) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleWordingOption(option)}
                  className="flex w-full items-start gap-3 rounded-md border p-3 text-left transition hover:border-teal-300"
                >
                  <span className={cn(
                    'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded border',
                    wordingOptions[option] ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white',
                  )}>
                    {wordingOptions[option] && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span>
                    <span className="block font-medium text-slate-900">{label}</span>
                    <span className="mt-0.5 block text-slate-500">{description}</span>
                  </span>
                </button>
              ))}
            </div>
            <textarea
              value={customWording}
              onChange={(event) => setCustomWording(event.target.value)}
              className="mt-3 min-h-44 w-full resize-none rounded-md border bg-slate-50 p-3 text-sm leading-6 outline-none"
              aria-label="Generated acknowledgement wording"
            />
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Review needed
              </div>
              Confirm wording with local or Nation-specific guidance where possible. Verified relationship records generate controlled variants, while CAD, reserve, treaty, and proximity layers remain supporting context.
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Template Prompts</h2>
            </div>
            <div className="space-y-2 text-xs leading-5 text-slate-600">
              {acknowledgementTemplatePrompts.map((item) => (
                <div key={item.label} className="rounded-md border p-3">
                  <div className="font-semibold text-slate-900">{item.label}</div>
                  <p className="mt-1">{item.prompt}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Language References</h2>
            </div>
            <div className="space-y-3 text-xs leading-5 text-slate-600">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pronunciation</div>
              {pronunciationSources.map((source) => (
                <a
                  key={source.name}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md border p-3 transition hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900">{source.name}</span>
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
                  </span>
                  <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                    {source.status}
                  </span>
                  <span className="mt-2 block">{source.use}</span>
                  <span className="mt-1 block text-slate-500">{source.caveat}</span>
                </a>
              ))}
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                Audio links are only shown when they come from a Nation site, FPCC permission/API access, or another source with clear reuse rights.
              </div>
              <div className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Local resources</div>
              {localLanguageResources.map((resource) => (
                <div key={resource.name} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{resource.name}</div>
                      <div className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                        {resource.status}
                      </div>
                    </div>
                    <a href={resource.url} target="_blank" rel="noreferrer" aria-label={`Open ${resource.name}`}>
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
                    </a>
                  </div>
                  <p className="mt-2">{resource.use}</p>
                  <p className="mt-1 text-slate-500">{resource.caveat}</p>
                  {(resource.audioUrl || resource.qrUrl) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {resource.audioUrl && (
                        <a href={resource.audioUrl} target="_blank" rel="noreferrer" className="rounded border bg-white px-2 py-1 font-medium text-teal-800">
                          Audio
                        </a>
                      )}
                      {resource.qrUrl && (
                        <a href={resource.qrUrl} target="_blank" rel="noreferrer" className="rounded border bg-white px-2 py-1 font-medium text-teal-800">
                          QR code
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}
