import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { buildCandidatesFromLookups } from './dev-acknowledgement/candidates'
import { INDIGENOUS_MANIFEST_DATA, defaultWordingOptions, initialLookupState } from './dev-acknowledgement/data'
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
import { buildAcknowledgement, buildRelationshipAcknowledgement } from './dev-acknowledgement/wording'
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
  WordingMode,
  WordingOptions,
} from './dev-acknowledgement/types'
import { AcknowledgementHeader } from './dev-acknowledgement/components/AcknowledgementHeader'
import { CandidateNations } from './dev-acknowledgement/components/CandidateNations'
import { DataProvenancePanel } from './dev-acknowledgement/components/DataProvenancePanel'
import { LanguageReferences } from './dev-acknowledgement/components/LanguageReferences'
import { LocationPanel } from './dev-acknowledgement/components/LocationPanel'
import { MatchTypesPanel } from './dev-acknowledgement/components/MatchTypesPanel'
import { SourceLayersPanel } from './dev-acknowledgement/components/SourceLayersPanel'
import { TemplatePrompts } from './dev-acknowledgement/components/TemplatePrompts'
import { VariantControls } from './dev-acknowledgement/components/VariantControls'
import { VerifiedRelationshipMatch } from './dev-acknowledgement/components/VerifiedRelationshipMatch'

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
      <AcknowledgementHeader
        address={address}
        onAddressChange={setAddress}
        onSubmit={handleGeocode}
        geocodeStatus={geocodeStatus}
        geocodeError={geocodeError}
        copied={copied}
        onCopy={handleCopyWording}
      />

      <main className="mx-auto grid max-w-7xl gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[280px_1fr_360px] lg:gap-5 lg:px-8">
        <aside className="order-3 space-y-4 lg:order-1">
          <SourceLayersPanel sourceLookups={sourceLookups} enabledSources={enabledSources} onToggle={toggleSource} />
          <MatchTypesPanel enabledMatchTypes={enabledMatchTypes} onToggle={toggleMatchType} />
          <DataProvenancePanel automatedSources={automatedManifestSources} manualSources={manualManifestSources} />
        </aside>

        <section className="order-1 space-y-4 lg:order-2">
          <LocationPanel
            geocodeResult={geocodeResult}
            geocodeStatus={geocodeStatus}
            address={address}
            sourceLookups={sourceLookups}
            onDrop={handleDroppedLocation}
          />

          {relationshipGraph && matchedRelationshipPlace && enabledSources.verified && (
            <VerifiedRelationshipMatch graph={relationshipGraph} match={matchedRelationshipPlace} selectedIds={selectedIds} />
          )}

          <CandidateNations
            candidates={visibleCandidates}
            selectedIds={selectedIds}
            enabledSources={enabledSources}
            onToggle={toggleCandidate}
          />
        </section>

        <aside className="order-2 space-y-4 lg:order-3">
          <VariantControls
            wordingMode={wordingMode}
            onWordingModeChange={setWordingMode}
            wordingOptions={wordingOptions}
            onToggleOption={toggleWordingOption}
            customWording={customWording}
            onCustomWordingChange={setCustomWording}
          />
          <TemplatePrompts />
          <LanguageReferences />
        </aside>
      </main>
    </div>
  )
}
