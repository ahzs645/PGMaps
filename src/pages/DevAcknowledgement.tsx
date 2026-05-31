import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
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
type SourceStatus = 'idle' | 'loading' | 'success' | 'error' | 'skipped'

type CandidateNation = {
  id: string
  name: string
  preferredName: string
  confidence: Confidence
  reason: string
  sources: Partial<Record<SourceKey, string>>
  notes: string
}

type SourceMatch = {
  source: SourceKey
  name: string
  label: string
  detail?: string
}

type SourceLookupState = {
  status: SourceStatus
  matches: SourceMatch[]
  message?: string
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

type ArcGisQueryResponse = {
  features?: Array<{
    attributes?: Record<string, string | number | null>
  }>
  error?: {
    message?: string
    details?: string[]
  }
}

type NativeLandResponse = {
  features?: Array<{
    properties?: {
      Name?: string
      Slug?: string
      description?: string
    }
  }>
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

const sourceUrls: Record<SourceKey, string> = {
  nativeLand: 'https://api-docs.native-land.ca/by-names-and-or-position',
  cad: 'https://maps.gov.bc.ca/ess/hm/imap4m/',
  treaty: 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_legal_admin_boundaries/MapServer',
  reserve: 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/34',
  local: 'https://github.com/ahmadjalil/PGMaps',
}

const BC_GEOCODER_URL = 'https://geocoder.api.gov.bc.ca/addresses.json'
const NATIVE_LAND_URL = 'https://native-land.ca/api/index.php'
const TREATY_AREAS_URL = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_legal_admin_boundaries/MapServer/17/query'
const TREATY_LANDS_URL = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_legal_admin_boundaries/MapServer/19/query'
const RESERVES_URL = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/34/query'
const NATIVE_LAND_API_KEY = import.meta.env.VITE_NATIVE_LAND_API_KEY as string | undefined

const initialLookupState: Record<SourceKey, SourceLookupState> = {
  nativeLand: { status: 'idle', matches: [] },
  cad: { status: 'skipped', matches: [], message: 'CAD is available through B.C.’s external iMapBC report workflow, not a stable public point-query layer.' },
  treaty: { status: 'idle', matches: [] },
  reserve: { status: 'idle', matches: [] },
  local: { status: 'idle', matches: [] },
}

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

function sourceLookupMessage(status: SourceStatus) {
  if (status === 'loading') return 'Checking'
  if (status === 'success') return 'Live'
  if (status === 'error') return 'Issue'
  if (status === 'skipped') return 'Manual'
  return 'Ready'
}

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/first nation|indian band|band|treaty area|treaty lands/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function candidateId(name: string) {
  return normalizeName(name).replace(/\s+/g, '-') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function uniqueMatches(matches: SourceMatch[]) {
  const seen = new Set<string>()
  return matches.filter((match) => {
    const key = `${match.source}:${normalizeName(match.name)}:${match.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function arcGisPointParams(lat: number, lng: number, outFields: string) {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'false',
  })
  return params
}

async function queryArcGisSource(
  url: string,
  lat: number,
  lng: number,
  outFields: string,
  toMatch: (attributes: Record<string, string | number | null>) => SourceMatch | null,
  signal?: AbortSignal,
) {
  const response = await fetch(`${url}?${arcGisPointParams(lat, lng, outFields).toString()}`, { signal })
  if (!response.ok) throw new Error(`ArcGIS service returned ${response.status}`)
  const data = await response.json() as ArcGisQueryResponse
  if (data.error) throw new Error(data.error.message ?? 'ArcGIS query failed')
  return uniqueMatches((data.features ?? [])
    .map((feature) => feature.attributes ? toMatch(feature.attributes) : null)
    .filter((match): match is SourceMatch => Boolean(match)))
}

async function queryTreatySources(lat: number, lng: number, signal?: AbortSignal) {
  const [lands, areas] = await Promise.all([
    queryArcGisSource(
      TREATY_LANDS_URL,
      lat,
      lng,
      'TREATY,FIRST_NATION_NAME,LAND_TYPE',
      (attributes) => {
        const name = String(attributes.FIRST_NATION_NAME || attributes.TREATY || '').trim()
        if (!name) return null
        return {
          source: 'treaty',
          name,
          label: 'Treaty land intersection',
          detail: [attributes.TREATY, attributes.LAND_TYPE].filter(Boolean).join(' / '),
        }
      },
      signal,
    ),
    queryArcGisSource(
      TREATY_AREAS_URL,
      lat,
      lng,
      'TREATY,FIRST_NATION_NAME,AREA_TYPE,LAND_TYPE,GEOGRAPHIC_LOCATION',
      (attributes) => {
        const name = String(attributes.FIRST_NATION_NAME || attributes.TREATY || '').trim()
        if (!name) return null
        return {
          source: 'treaty',
          name,
          label: 'Treaty area intersection',
          detail: [attributes.TREATY, attributes.AREA_TYPE, attributes.GEOGRAPHIC_LOCATION].filter(Boolean).join(' / '),
        }
      },
      signal,
    ),
  ])
  return uniqueMatches([...lands, ...areas])
}

async function queryReserveSource(lat: number, lng: number, signal?: AbortSignal) {
  return queryArcGisSource(
    RESERVES_URL,
    lat,
    lng,
    'ENGLISH_NAME,BAND_NAME,BAND_NUMBER',
    (attributes) => {
      const name = String(attributes.BAND_NAME || attributes.ENGLISH_NAME || '').trim()
      if (!name) return null
      return {
        source: 'reserve',
        name,
        label: 'Reserve boundary intersection',
        detail: [attributes.ENGLISH_NAME, attributes.BAND_NUMBER ? `Band ${attributes.BAND_NUMBER}` : null].filter(Boolean).join(' / '),
      }
    },
    signal,
  )
}

async function queryNativeLandSource(lat: number, lng: number, signal?: AbortSignal) {
  if (!NATIVE_LAND_API_KEY) {
    throw new Error('Set VITE_NATIVE_LAND_API_KEY to enable Native Land Digital lookups.')
  }

  const params = new URLSearchParams({
    maps: 'territories,languages,treaties',
    position: `${lat},${lng}`,
    key: NATIVE_LAND_API_KEY,
  })

  const response = await fetch(`${NATIVE_LAND_URL}?${params.toString()}`, { signal })
  if (!response.ok) throw new Error(`Native Land Digital returned ${response.status}`)
  const data = await response.json() as NativeLandResponse
  const matches: SourceMatch[] = (data.features ?? [])
    .map((feature): SourceMatch | null => {
      const name = feature.properties?.Name?.trim()
      if (!name) return null
      return {
        source: 'nativeLand',
        name,
        label: 'Native Land overlap',
        detail: feature.properties?.Slug,
      }
    })
    .filter((match): match is SourceMatch => Boolean(match))
  return uniqueMatches(matches)
}

function localVerifiedMatches(result: GeocodeResult): SourceMatch[] {
  const haystack = `${result.fullAddress} ${result.latitude} ${result.longitude}`.toLowerCase()
  if (haystack.includes('prince george') || haystack.includes('university way')) {
    return [{
      source: 'local',
      name: "Lheidli T'enneh First Nation",
      label: 'Institution-verified wording',
      detail: 'Sample local acknowledgement for Prince George / UNBC-style locations',
    }]
  }
  return []
}

function buildCandidatesFromLookups(lookups: Record<SourceKey, SourceLookupState>): CandidateNation[] {
  const byName = new Map<string, CandidateNation>()
  const sourceOrder: SourceKey[] = ['local', 'nativeLand', 'treaty', 'reserve', 'cad']

  Object.values(lookups).flatMap((lookup) => lookup.matches).forEach((match) => {
    const key = normalizeName(match.name) || match.name
    const existing = byName.get(key)
    const nextSources = {
      ...(existing?.sources ?? {}),
      [match.source]: match.detail ? `${match.label}: ${match.detail}` : match.label,
    }
    const sourceCount = sourceOrder.filter((source) => nextSources[source]).length
    const confidence: Confidence = sourceCount >= 2 || Boolean(nextSources.local) ? 'strong' : match.source === 'treaty' ? 'moderate' : 'review_required'
    const sourceLabels = sourceOrder
      .filter((source) => nextSources[source])
      .map((source) => sourceMeta[source].label)

    byName.set(key, {
      id: candidateId(match.name),
      name: existing?.name ?? match.name,
      preferredName: existing?.preferredName ?? match.name,
      confidence,
      reason: `${match.name} appears in ${sourceLabels.join(', ')} for this location.`,
      sources: nextSources,
      notes: confidence === 'strong'
        ? 'Multiple source signals or local verified wording are present. Final wording should still be reviewed.'
        : 'Single-source match. Keep as context and confirm before using in final wording.',
    })
  })

  return Array.from(byName.values()).sort((left, right) => {
    const rank: Record<Confidence, number> = { strong: 0, moderate: 1, review_required: 2 }
    return rank[left.confidence] - rank[right.confidence] || left.name.localeCompare(right.name)
  })
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
  const [sourceLookups, setSourceLookups] = useState<Record<SourceKey, SourceLookupState>>(initialLookupState)

  const candidates = useMemo(() => buildCandidatesFromLookups(sourceLookups), [sourceLookups])

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

  const wording = useMemo(() => buildAcknowledgement(wordingMode, selectedNames), [selectedNames, wordingMode])

  useEffect(() => {
    setCustomWording(wording)
  }, [wording])

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

  const runSourceLookups = async (result: GeocodeResult) => {
    const controller = new AbortController()
    setSourceLookups({
      nativeLand: { status: NATIVE_LAND_API_KEY ? 'loading' : 'skipped', matches: [], message: NATIVE_LAND_API_KEY ? undefined : 'Set VITE_NATIVE_LAND_API_KEY to enable Native Land Digital.' },
      treaty: { status: 'loading', matches: [] },
      reserve: { status: 'loading', matches: [] },
      local: { status: 'loading', matches: [] },
      cad: initialLookupState.cad,
    })

    const settle = (source: SourceKey, state: SourceLookupState) => {
      setSourceLookups((current) => ({ ...current, [source]: state }))
    }

    if (NATIVE_LAND_API_KEY) {
      queryNativeLandSource(result.latitude, result.longitude, controller.signal)
        .then((matches) => settle('nativeLand', { status: 'success', matches, message: matches.length ? undefined : 'No Native Land Digital overlaps returned.' }))
        .catch((error: unknown) => settle('nativeLand', {
          status: 'error',
          matches: [],
          message: error instanceof Error ? error.message : 'Native Land Digital lookup failed.',
        }))
    }

    queryTreatySources(result.latitude, result.longitude, controller.signal)
      .then((matches) => settle('treaty', { status: 'success', matches, message: matches.length ? undefined : 'No treaty land or treaty area intersections.' }))
      .catch((error: unknown) => settle('treaty', {
        status: 'error',
        matches: [],
        message: `${error instanceof Error ? error.message : 'Treaty layer lookup failed.'} A server proxy may be required if CORS blocks this browser request.`,
      }))

    queryReserveSource(result.latitude, result.longitude, controller.signal)
      .then((matches) => settle('reserve', { status: 'success', matches, message: matches.length ? undefined : 'No reserve boundary intersection.' }))
      .catch((error: unknown) => settle('reserve', {
        status: 'error',
        matches: [],
        message: `${error instanceof Error ? error.message : 'Reserve layer lookup failed.'} A server proxy may be required if CORS blocks this browser request.`,
      }))

    settle('local', {
      status: 'success',
      matches: localVerifiedMatches(result),
      message: localVerifiedMatches(result).length ? undefined : 'No local verified acknowledgement saved for this location.',
    })
  }

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
      void runSourceLookups(result)
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
                    <a href={sourceUrls[source]} target="_blank" rel="noreferrer" aria-label={`Open ${sourceMeta[source].label} source`}>
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                    </a>
                  </div>
                  <p className="mt-1">{sourceMeta[source].description}</p>
                  <p className="mt-2 font-medium text-slate-700">
                    {sourceLookupMessage(sourceLookups[source].status)}
                    {sourceLookups[source].matches.length > 0 && ` · ${sourceLookups[source].matches.length} match${sourceLookups[source].matches.length === 1 ? '' : 'es'}`}
                  </p>
                  {sourceLookups[source].message && <p className="mt-1">{sourceLookups[source].message}</p>}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}
