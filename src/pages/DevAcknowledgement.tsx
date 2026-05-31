import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
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

type SourceKey = 'nativeLand' | 'cad' | 'treaty' | 'reserve' | 'local'
type Confidence = 'strong' | 'moderate' | 'review_required'
type WordingMode = 'general' | 'event' | 'research'
type GeocodeStatus = 'idle' | 'loading' | 'success' | 'error'

type CandidateNation = {
  id: string
  name: string
  preferredName: string
  confidence: Confidence
  reason: string
  sources: Partial<Record<SourceKey, string>>
  notes: string
}

type GeocodeResult = {
  fullAddress: string
  latitude: number
  longitude: number
  score: number
  matchPrecision: string
  precisionPoints: number
  faults: string[]
  baseDataDate: string
  searchTimestamp: string
}

type BcGeocoderFeature = {
  geometry?: {
    coordinates?: [number, number]
  }
  properties?: {
    fullAddress?: string
    score?: number
    matchPrecision?: string
    precisionPoints?: number
    faults?: unknown[]
  }
}

type BcGeocoderResponse = {
  baseDataDate?: string
  searchTimestamp?: string
  features?: BcGeocoderFeature[]
}

const sourceMeta: Record<SourceKey, { label: string; type: string; description: string }> = {
  nativeLand: {
    label: 'Native Land Digital',
    type: 'Educational territory layer',
    description: 'Territories, languages, and treaties for review-oriented public education.',
  },
  cad: {
    label: 'BC CAD',
    type: 'Consultative area',
    description: 'Candidate First Nations associated with asserted/proven rights or title. Review required.',
  },
  treaty: {
    label: 'Treaty lands',
    type: 'Legal/admin layer',
    description: 'Treaty-related geography where official treaty data is available.',
  },
  reserve: {
    label: 'Reserve boundaries',
    type: 'Administrative layer',
    description: 'Reserve and band-name reference geography, not traditional territory.',
  },
  local: {
    label: 'Local verified',
    type: 'Institution/user verified',
    description: 'Saved wording and local guidance maintained by the organization.',
  },
}

const BC_GEOCODER_URL = 'https://geocoder.api.gov.bc.ca/addresses.json'

const candidates: CandidateNation[] = [
  {
    id: 'lheidli',
    name: "Lheidli T'enneh First Nation",
    preferredName: "Lheidli T'enneh",
    confidence: 'strong',
    reason: 'Appears in local verified wording and multiple reference sources for the sample Prince George location.',
    sources: {
      nativeLand: 'Territory overlap',
      cad: 'Consultative-area association',
      reserve: 'Nearby band/reserve reference',
      local: 'UNBC-style local acknowledgement',
    },
    notes: 'Best candidate for default wording, with final wording still reviewed against Nation or local protocol.',
  },
  {
    id: 'nation-b',
    name: 'Candidate Nation B',
    preferredName: 'Candidate Nation B',
    confidence: 'review_required',
    reason: 'Appears in educational territory data only for this prototype result.',
    sources: {
      nativeLand: 'Territory overlap',
    },
    notes: 'Keep visible as a possible overlapping-territory candidate rather than silently removing it.',
  },
  {
    id: 'nation-c',
    name: 'Candidate Nation C',
    preferredName: 'Candidate Nation C',
    confidence: 'review_required',
    reason: 'Appears in consultative-area data only.',
    sources: {
      cad: 'Consultative-area association',
    },
    notes: 'CAD-style results are useful for relationship-building prompts, not automatic acknowledgements.',
  },
  {
    id: 'treaty-area',
    name: 'Treaty-area reference',
    preferredName: 'Treaty-area reference',
    confidence: 'moderate',
    reason: 'Treaty geography may be relevant, but it does not replace local territory or protocol guidance.',
    sources: {
      treaty: 'Treaty-area intersection',
    },
    notes: 'Shown as context unless the user explicitly chooses to include it in wording.',
  },
]

const confidenceStyles: Record<Confidence, string> = {
  strong: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  moderate: 'border-amber-200 bg-amber-50 text-amber-800',
  review_required: 'border-slate-200 bg-slate-50 text-slate-700',
}

const confidenceLabels: Record<Confidence, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  review_required: 'Review',
}

function buildAcknowledgement(mode: WordingMode, nationNames: string[]) {
  const names = nationNames.length > 0 ? nationNames.join(', ') : '[selected Nation(s)]'

  if (mode === 'event') {
    return `We acknowledge that today's event is taking place on lands connected to ${names}. We are grateful to gather here and recognize the continuing presence, rights, and stewardship of Indigenous Peoples.`
  }

  if (mode === 'research') {
    return `This work takes place in areas connected to ${names}. We recognize the importance of respectful relationship-building, local protocols, and Indigenous rights and title.`
  }

  return `We acknowledge that we are on lands connected to ${names}. We recognize their histories, cultures, and ongoing relationships with these lands.`
}

function parseFaults(faults: unknown[] | undefined) {
  if (!faults) return []
  return faults.map((fault) => {
    if (typeof fault === 'string') return fault
    if (fault && typeof fault === 'object' && 'value' in fault) return String(fault.value)
    return String(fault)
  })
}

async function geocodeAddress(address: string, signal?: AbortSignal): Promise<GeocodeResult> {
  const params = new URLSearchParams({
    addressString: address,
    maxResults: '1',
    interpolation: 'adaptive',
    echo: 'true',
    brief: 'false',
    autoComplete: 'false',
    setBack: '0',
    outputSRS: '4326',
  })

  const response = await fetch(`${BC_GEOCODER_URL}?${params.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`BC Address Geocoder returned ${response.status}`)
  }

  const data = await response.json() as BcGeocoderResponse
  const feature = data.features?.[0]
  const coordinates = feature?.geometry?.coordinates
  if (!feature || !coordinates || coordinates.length < 2) {
    throw new Error('No B.C. address match found')
  }

  return {
    fullAddress: feature.properties?.fullAddress ?? address,
    longitude: coordinates[0],
    latitude: coordinates[1],
    score: feature.properties?.score ?? 0,
    matchPrecision: feature.properties?.matchPrecision ?? 'Unknown',
    precisionPoints: feature.properties?.precisionPoints ?? 0,
    faults: parseFaults(feature.properties?.faults),
    baseDataDate: data.baseDataDate ?? '',
    searchTimestamp: data.searchTimestamp ?? '',
  }
}

export default function DevAcknowledgement() {
  const [address, setAddress] = useState('3333 University Way, Prince George, BC')
  const [geocodeResult, setGeocodeResult] = useState<GeocodeResult | null>(null)
  const [geocodeStatus, setGeocodeStatus] = useState<GeocodeStatus>('idle')
  const [geocodeError, setGeocodeError] = useState<string | null>(null)
  const [enabledSources, setEnabledSources] = useState<Record<SourceKey, boolean>>(() => ({
    nativeLand: true,
    cad: true,
    treaty: true,
    reserve: true,
    local: true,
  }))
  const [selectedIds, setSelectedIds] = useState<string[]>(['lheidli'])
  const [wordingMode, setWordingMode] = useState<WordingMode>('event')
  const [customWording, setCustomWording] = useState('')

  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => (
      Object.keys(candidate.sources).some((source) => enabledSources[source as SourceKey])
    )),
    [enabledSources],
  )

  const selectedNames = useMemo(
    () => candidates
      .filter((candidate) => selectedIds.includes(candidate.id))
      .map((candidate) => candidate.preferredName),
    [selectedIds],
  )

  const wording = useMemo(() => buildAcknowledgement(wordingMode, selectedNames), [selectedNames, wordingMode])

  useEffect(() => {
    setCustomWording(wording)
  }, [wording])

  useEffect(() => {
    const controller = new AbortController()
    setGeocodeStatus('loading')
    setGeocodeError(null)
    geocodeAddress(address, controller.signal)
      .then((result) => {
        setGeocodeResult(result)
        setGeocodeStatus('success')
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
    } catch (error) {
      setGeocodeResult(null)
      setGeocodeStatus('error')
      setGeocodeError(error instanceof Error ? error.message : 'Unable to geocode this address')
    }
  }

  const toggleSource = (source: SourceKey) => {
    setEnabledSources((current) => ({ ...current, [source]: !current[source] }))
  }

  const toggleCandidate = (candidateId: string) => {
    setSelectedIds((current) => (
      current.includes(candidateId)
        ? current.filter((id) => id !== candidateId)
        : [...current, candidateId]
    ))
  }

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
            <Button className="w-full bg-teal-700 hover:bg-teal-800 sm:w-auto">
              <FileText className="h-4 w-4" />
              Save verified wording
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
                    <span className="block text-sm font-medium">{sourceMeta[source].label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">{sourceMeta[source].type}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <Database className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Pipeline</h2>
            </div>
            <div className="space-y-3 text-xs text-slate-600">
              {['BC Address Geocoder', 'Point-in-polygon lookup', 'Source comparison', 'User-selected wording'].map((step, index) => (
                <div key={step} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-700">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="order-1 space-y-4 lg:order-2">
          <div className="grid overflow-hidden rounded-lg border bg-white shadow-sm md:grid-cols-[1fr_240px]">
            <div className="relative min-h-56 bg-[linear-gradient(135deg,#d8eee8_0%,#f4f0df_45%,#dbe7f3_100%)] sm:min-h-72">
              <div className="absolute inset-0 opacity-55 [background-image:radial-gradient(circle_at_20%_20%,rgba(15,118,110,.18),transparent_22%),radial-gradient(circle_at_72%_40%,rgba(180,83,9,.15),transparent_24%),linear-gradient(90deg,rgba(15,23,42,.08)_1px,transparent_1px),linear-gradient(rgba(15,23,42,.08)_1px,transparent_1px)] [background-size:auto,auto,48px_48px,48px_48px]" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-white bg-teal-700 text-white shadow-lg">
                  <MapPin className="h-6 w-6" />
                </span>
                <span className="max-w-56 rounded-md bg-white/95 px-3 py-1 text-center text-xs font-semibold shadow">
                  {geocodeStatus === 'success' ? 'BC geocoded point' : geocodeStatus === 'loading' ? 'Looking up address' : 'Address lookup needed'}
                </span>
              </div>
            </div>
            <div className="border-t p-4 md:border-l md:border-t-0">
              <h2 className="text-sm font-semibold">Location Result</h2>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="text-xs uppercase text-slate-500">Normalized address</dt>
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
                  <dd className="mt-1">BC Address Geocoder</dd>
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
            </div>
          </div>

          <section className="rounded-lg border bg-white shadow-sm">
            <div className="border-b p-4">
              <h2 className="text-base font-semibold">Candidate Nations</h2>
              <p className="mt-1 text-sm text-slate-600">Select what should be included in the generated acknowledgement.</p>
            </div>
            <div className="divide-y">
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
              <h2 className="text-sm font-semibold">Wording Mode</h2>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['general', 'event', 'research'] as WordingMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setWordingMode(mode)}
                  className={cn(
                    'rounded-md border px-2 py-2 text-xs font-medium capitalize',
                    wordingMode === mode ? 'border-teal-700 bg-teal-700 text-white' : 'bg-white hover:border-teal-300',
                  )}
                >
                  {mode}
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
              Confirm wording with local or Nation-specific guidance where possible. CAD, reserve, and treaty layers should not be treated as automatic acknowledgement text.
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Source Transparency</h2>
            </div>
            <div className="space-y-3 text-xs leading-5 text-slate-600">
              {(Object.keys(sourceMeta) as SourceKey[]).map((source) => (
                <div key={source} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{sourceMeta[source].label}</span>
                    <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <p className="mt-1">{sourceMeta[source].description}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}
