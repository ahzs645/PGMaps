import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildFallbackAcknowledgement,
  buildLocatedAcknowledgement,
  type AcknowledgementPurpose,
  buildRegionalAcknowledgement,
  compareNationSets,
} from '@/lib/acknowledgement/engine'
import { cn } from '@/lib/utils'
import {
  chosenCandidates,
  createLocation,
  defaultSources,
  locationCandidates,
  locationReady,
} from './dev-acknowledgement/builder'
import {
  DRAFT_STORAGE_KEY,
  readSavedBuilder,
  saveBuilder,
  type AuthoredDraft,
} from './dev-acknowledgement/draftStorage'
import { defaultWordingOptions, INDIGENOUS_MANIFEST_DATA, initialLookupState } from './dev-acknowledgement/data'
import { geocodeAddress, locationFromCoordinates } from './dev-acknowledgement/geocode'
import { useBuilderLocations } from './dev-acknowledgement/hooks/useBuilderLocations'
import { organizations } from './dev-acknowledgement/organizations'
import type { GeocodeResult, IndigenousManifest, MatchType, SourceKey } from './dev-acknowledgement/types'
import { CandidateNations } from './dev-acknowledgement/components/CandidateNations'
import { DataProvenancePanel } from './dev-acknowledgement/components/DataProvenancePanel'
import { DraftEditor } from './dev-acknowledgement/components/DraftEditor'
import { EvidenceLinks } from './dev-acknowledgement/components/EvidenceLinks'
import { LanguageContext } from './dev-acknowledgement/components/LanguageContext'
import { LanguageReferences } from './dev-acknowledgement/components/LanguageReferences'
import { MatchTypesPanel } from './dev-acknowledgement/components/MatchTypesPanel'
import { MultiPointComposer } from './dev-acknowledgement/components/MultiPointComposer'
import {
  OrganizationPreview,
  type OrganizationDraftOptions,
} from './dev-acknowledgement/components/OrganizationPreview'
import { OrganizationsSidebar } from './dev-acknowledgement/components/OrganizationsSidebar'
import { SourceLayersPanel } from './dev-acknowledgement/components/SourceLayersPanel'
import { TemplatePrompts } from './dev-acknowledgement/components/TemplatePrompts'
import { WordingOptionsControls } from './dev-acknowledgement/components/WordingOptionsControls'
import './dev-acknowledgement/builder.css'

const STEPS = [
  ['location', 'Location'],
  ['review', 'Review Nations'],
  ['wording', 'Your wording'],
] as const
type Step = (typeof STEPS)[number][0]

export default function DevAcknowledgement() {
  const [saved] = useState(readSavedBuilder)
  const [step, setStep] = useState<Step>('location')
  const [library, setLibrary] = useState(false)
  const [previewOrg, setPreviewOrg] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(saved?.orgId ?? null)
  const org = organizations.find((item) => item.id === orgId) ?? null
  const [enabledSources, setEnabledSources] = useState(saved?.enabledSources ?? defaultSources)
  const [matchTypes, setMatchTypes] = useState<Record<MatchType, boolean>>(
    saved?.matchTypes ?? { place: true, municipality: true, boundary: true },
  )
  const { locations, setLocations, graph, retry } = useBuilderLocations(
    saved?.locations ?? [],
    enabledSources,
    matchTypes,
  )
  const [activeId, setActiveId] = useState<string | null>(saved?.locations[0]?.id ?? null)
  const active = locations.find((item) => item.id === activeId) ?? locations[0]
  const [address, setAddress] = useState('')
  const [searchMode, setSearchMode] = useState<'add' | 'replace'>('add')
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [searchError, setSearchError] = useState('')
  const [pendingAddress, setPendingAddress] = useState<GeocodeResult | null>(null)
  const searchController = useRef<AbortController | null>(null)
  const [perspective, setPerspective] = useState(saved?.perspective ?? 'collective')
  const [organizationName, setOrganizationName] = useState(saved?.organizationName ?? '')
  const [wordingMode, setWordingMode] = useState(saved?.wordingMode ?? 'event')
  const [scope, setScope] = useState<'specific' | 'regional'>(saved?.scope ?? 'specific')
  const [purpose, setPurpose] = useState<AcknowledgementPurpose>(saved?.purpose ?? 'venue')
  const [venueId, setVenueId] = useState<string | null>(saved?.venueId ?? null)
  const [regionName, setRegionName] = useState(saved?.regionName ?? 'British Columbia')
  const [wordingOptions, setWordingOptions] = useState(saved?.wordingOptions ?? defaultWordingOptions)
  const [authored, setAuthored] = useState<AuthoredDraft | null>(saved?.authored ?? null)
  const lastPreview = useRef<AuthoredDraft | null>(saved?.authored ?? null)
  const [storageMessage, setStorageMessage] = useState(saved ? 'Restored your saved work from this device.' : '')
  const [manifest, setManifest] = useState<IndigenousManifest | null>(null)
  const [showResearch, setShowResearch] = useState(false)
  const startRef = useRef<HTMLDivElement>(null)

  const reviews = locations.map((location) => {
    const candidates = locationCandidates(location, graph, enabledSources)
    const selected = chosenCandidates(location, candidates)
    return { location, candidates, selected, ready: locationReady(location, selected) }
  })
  const activeReview = reviews.find((item) => item.location.id === active?.id)
  const draftReviews =
    purpose === 'venue' ? reviews.filter((item) => item.location.id === (venueId ?? locations[0]?.id)) : reviews
  const completeCount = draftReviews.filter((item) => item.ready).length
  const allReady = draftReviews.length > 0 && completeCount === draftReviews.length
  const nationNames = [...new Set(reviews.flatMap((item) => item.selected.map((candidate) => candidate.preferredName)))]
  const draftNationNames = [
    ...new Set(draftReviews.flatMap((item) => item.selected.map((candidate) => candidate.preferredName))),
  ]
  const locationContext = org
    ? `Organization: ${org.name}`
    : scope === 'regional'
      ? `Region: ${regionName || 'British Columbia'}`
      : draftReviews.length
        ? `${purpose === 'venue' ? 'Venue' : purpose === 'operations' ? 'Operating locations' : 'Participant locations'}: ${draftReviews.map((item) => item.location.result.fullAddress).join('; ')}`
        : 'No location selected'
  const context =
    locationContext +
    (scope === 'specific' && !org ? ` · Nations: ${draftNationNames.join(', ') || 'not selected'}` : '')
  const currentSources =
    scope === 'regional'
      ? []
      : org
        ? [{ title: org.name, url: org.sourceUrl }]
        : [
            ...new Map(
              draftReviews
                .flatMap((item) => {
                  const refs = new Set(
                    item.location.match?.relationships
                      .filter((relation) =>
                        relation.nationIds.some((id) => item.selected.some((candidate) => candidate.id === id)),
                      )
                      .flatMap((relation) => relation.sourceRefs) ?? [],
                  )
                  return (
                    graph?.sources
                      .filter((source) => refs.has(source.id))
                      .map((source) => ({ title: source.title, url: source.url })) ?? []
                  )
                })
                .map((source) => [source.url, source]),
            ).values(),
          ]
  const sourcesKey = JSON.stringify(currentSources)
  let suggestion = ''
  if (scope === 'regional')
    suggestion = buildRegionalAcknowledgement(wordingMode, { perspective, organizationName, regionName })
  else if (org && org.acknowledges.length)
    suggestion = buildFallbackAcknowledgement(wordingMode, org.acknowledges, { perspective, organizationName })
  else if (!org && allReady && graph) {
    suggestion = buildLocatedAcknowledgement(
      wordingMode,
      graph,
      draftReviews.map((item) => ({
        label: item.location.result.fullAddress,
        match: item.location.match,
        selectedIds: item.selected.map((candidate) => candidate.id),
      })),
      { ...wordingOptions, perspective, organizationName, purpose },
    )
  }
  const text = authored?.text ?? suggestion
  const notice =
    org && scope === 'specific' && !org.acknowledges.length
      ? 'This organization uses regional wording and does not list specific Nations. Choose Regional in the scope controls.'
      : !org && scope === 'specific' && !allReady
        ? `${completeCount} of ${draftReviews.length} locations ready. Review a Nation selection for each location used in this draft.${authored ? ' Your saved wording is kept with its original context.' : ''}`
        : !org && scope === 'specific' && !suggestion
          ? 'These selections include context that does not establish a documented relationship for this location. Map overlaps, nearby communities, reserve records, and example templates need further review. Use the sources to write your own draft, or choose a documented location. Your selections are kept.'
          : authored && authored.context !== context
            ? `The current context has changed to ${context}. Your edited draft still belongs to ${authored.context}.`
            : undefined
  const options = {
    wordingMode,
    onWordingModeChange: setWordingMode,
    perspective,
    onPerspectiveChange: setPerspective,
    organizationName,
    onOrganizationNameChange: setOrganizationName,
    scope,
    onScopeChange: setScope,
    regionName,
    onRegionNameChange: setRegionName,
    wordingOptions,
    onToggleOption: (option: 'includeTreatyContext' | 'includePeopleGroupContext') =>
      setWordingOptions((value) => ({ ...value, [option]: !value[option] })),
    showVoice: !org,
    showContextToggles: !org && draftReviews.length > 0 && draftReviews.every((item) => Boolean(item.location.match)),
  }

  useEffect(() => {
    try {
      if (suggestion) lastPreview.current = { text: suggestion, context, sources: JSON.parse(sourcesKey) }
      saveBuilder({
        preview: lastPreview.current,
        locations,
        authored,
        perspective,
        organizationName,
        wordingMode,
        scope,
        purpose,
        venueId,
        regionName,
        orgId,
        enabledSources,
        matchTypes,
        wordingOptions,
      })
    } catch {
      // Report failure of the external storage write, rather than derive UI state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageMessage('Device storage is unavailable. Keep a copy of your draft before leaving.')
    }
  }, [
    locations,
    authored,
    perspective,
    organizationName,
    wordingMode,
    scope,
    purpose,
    venueId,
    regionName,
    orgId,
    enabledSources,
    matchTypes,
    wordingOptions,
    suggestion,
    context,
    sourcesKey,
  ])
  useEffect(() => () => searchController.current?.abort(), [])
  useEffect(() => {
    if (!showResearch) return
    const controller = new AbortController()
    fetch(INDIGENOUS_MANIFEST_DATA, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(setManifest)
      .catch(() => undefined)
    return () => controller.abort()
  }, [showResearch])
  const navigate = (next: Step) => {
    setLibrary(false)
    setStep(next)
    requestAnimationFrame(() => {
      startRef.current?.scrollIntoView({ block: 'start' })
      startRef.current?.focus({ preventScroll: true })
    })
  }
  const cancelSearch = useCallback(() => {
    searchController.current?.abort()
    setSearchStatus('idle')
    setPendingAddress(null)
    setSearchError('')
  }, [])
  const search = async (value: string) => {
    cancelSearch()
    if (!value.trim()) {
      setSearchStatus('error')
      setSearchError('Enter a B.C. address.')
      return
    }
    const controller = new AbortController()
    searchController.current = controller
    setSearchStatus('loading')
    try {
      const result = await geocodeAddress(value.trim(), controller.signal)
      if (controller.signal.aborted) return
      setPendingAddress(result)
      setSearchStatus('idle')
    } catch {
      if (controller.signal.aborted) return
      setSearchStatus('error')
      setSearchError('Address search failed. Check the address and try again. Your confirmed locations have been kept.')
    }
  }
  const acceptLocation = (result: GeocodeResult, replace: boolean) => {
    cancelSearch()
    setOrgId(null)
    const next = createLocation(result, replace && active ? active.id : undefined)
    setLocations((items) =>
      replace && active ? items.map((item) => (item.id === active.id ? next : item)) : [...items, next],
    )
    setActiveId(next.id)
    setAddress('')
  }
  const toggleNation = (id: string) => {
    if (!activeReview) return
    const ids = activeReview.selected.map((item) => item.id)
    setLocations((items) =>
      items.map((item) =>
        item.id === active.id
          ? { ...item, selectedIds: ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id] }
          : item,
      ),
    )
  }
  const useOrganization = (id: string, values: OrganizationDraftOptions) => {
    const selected = organizations.find((item) => item.id === id)
    if (!selected) return
    cancelSearch()
    setOrgId(id)
    setPerspective('organization')
    setOrganizationName(selected.name)
    setWordingMode(values.wordingMode)
    setScope(values.scope)
    setRegionName(values.regionName)
    const next = selected.campuses.map((campus) =>
      createLocation(locationFromCoordinates({ ...campus, label: campus.name })),
    )
    setLocations(next)
    setActiveId(next[0]?.id ?? null)
    // Existing authored text remains recoverable; the imported configuration creates a suggestion.
    navigate('wording')
  }
  const clearSaved = () => {
    lastPreview.current = null
    cancelSearch()
    setLocations([])
    setActiveId(null)
    setOrgId(null)
    setAuthored(null)
    setAddress('')
    setScope('specific')
    setPurpose('venue')
    setVenueId(null)
    setPerspective('collective')
    setOrganizationName('')
    setWordingMode('event')
    setRegionName('British Columbia')
    setWordingOptions(defaultWordingOptions)
    setEnabledSources(defaultSources)
    setMatchTypes({ place: true, municipality: true, boundary: true })
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY)
    } catch {
      /* The storage message already describes recovery limits. */
    }
    setStorageMessage('Started a new draft.')
    navigate('location')
  }

  return (
    <div className="ack-builder min-h-full bg-stone-50 pb-6 pt-14 text-slate-950 sm:pt-0">
      <header className="border-b bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Acknowledgment builder</h1>
            <p className="mt-1 text-sm text-slate-600">
              Find your place. Review local guidance. Make the wording your own.
            </p>
          </div>
          <button
            type="button"
            aria-pressed={library}
            onClick={() => {
              setLibrary((value) => !value)
              setPreviewOrg(null)
            }}
            className="min-h-11 rounded-lg border px-3 text-sm"
          >
            {library ? 'Back to builder' : 'Organization examples'}
          </button>
        </div>
      </header>
      <div ref={startRef} tabIndex={-1} className="mx-auto max-w-6xl scroll-mt-14 px-3 sm:scroll-mt-0 sm:px-6">
        {!library && (
          <nav aria-label="Builder steps" className="my-4 grid grid-cols-3 gap-1 rounded-xl border bg-white p-1">
            {STEPS.map(([id, label], index) => (
              <button
                key={id}
                type="button"
                aria-current={step === id ? 'step' : undefined}
                onClick={() => navigate(id)}
                className={cn(
                  'min-h-12 rounded-lg px-1 py-2 text-sm font-medium',
                  step === id ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-stone-50',
                )}
              >
                <span aria-hidden="true">{index + 1}. </span>
                {label}
              </button>
            ))}
          </nav>
        )}
        {library ? (
          <div className="my-4 grid min-w-0 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className={previewOrg ? 'hidden lg:block' : ''}>
              <OrganizationsSidebar
                selectedId={previewOrg}
                onSelect={(id) => {
                  setPreviewOrg(id)
                  requestAnimationFrame(() => startRef.current?.scrollIntoView({ block: 'start' }))
                }}
              />
            </div>
            <div className={cn('min-w-0', !previewOrg && 'hidden lg:block')}>
              {previewOrg && (
                <button
                  type="button"
                  onClick={() => setPreviewOrg(null)}
                  className="mb-3 min-h-11 rounded-lg border bg-white px-3 text-sm lg:hidden"
                >
                  Back to organizations
                </button>
              )}
              <OrganizationPreview key={previewOrg ?? 'none'} orgId={previewOrg} onPreviewOnMap={useOrganization} />
            </div>
          </div>
        ) : (
          <>
            {step === 'location' && (
              <div className="grid min-w-0 gap-5 lg:grid-cols-2">
                <section className="min-w-0 space-y-4 rounded-xl border bg-white p-4">
                  <h2 className="text-lg font-semibold">Where will you speak?</h2>
                  {locations.length > 0 && (
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Search action">
                      {(['add', 'replace'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={searchMode === mode}
                          onClick={() => {
                            cancelSearch()
                            setSearchMode(mode)
                          }}
                          className={cn(
                            'min-h-11 rounded-lg border px-3 text-sm',
                            searchMode === mode && 'border-teal-700 bg-teal-50',
                          )}
                        >
                          {mode === 'add' ? 'Add another address' : 'Replace selected location'}
                        </button>
                      ))}
                    </div>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void search(address)
                    }}
                    className="space-y-2"
                  >
                    <label htmlFor="ack-address" className="block text-sm font-medium">
                      B.C. address
                    </label>
                    <input
                      id="ack-address"
                      value={address}
                      onChange={(event) => {
                        cancelSearch()
                        setAddress(event.target.value)
                      }}
                      placeholder="Street address, city, BC"
                      autoComplete="street-address"
                      enterKeyHint="search"
                      className="min-h-12 w-full min-w-0 rounded-lg border px-3 text-base"
                    />
                    <button
                      type="submit"
                      disabled={searchStatus === 'loading'}
                      className="min-h-11 w-full rounded-lg bg-teal-700 px-4 font-medium text-white disabled:opacity-50"
                    >
                      {searchStatus === 'loading' ? 'Finding address…' : 'Find address'}
                    </button>
                  </form>
                  {searchStatus === 'loading' && (
                    <p role="status" className="text-sm">
                      Searching for your address…
                    </p>
                  )}
                  {searchStatus === 'error' && (
                    <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-900">
                      {searchError}
                    </p>
                  )}
                  {pendingAddress && (
                    <div className="space-y-3 rounded-lg border border-teal-200 bg-teal-50 p-3" role="status">
                      <h3 className="font-semibold">Confirm this location</h3>
                      <p className="break-words text-sm">{pendingAddress.fullAddress}</p>
                      <p className="text-sm text-slate-600">
                        Match: {pendingAddress.matchPrecision} · score {pendingAddress.score}/100
                      </p>
                      {(pendingAddress.score < 90 ||
                        !['CIVIC_NUMBER', 'SITE', 'OCCUPANT'].includes(pendingAddress.matchPrecision)) && (
                        <p className="text-sm text-amber-950">
                          This may be an approximate match. Check the returned address before using it.
                        </p>
                      )}
                      {pendingAddress.faults.length > 0 && (
                        <p className="text-sm text-slate-600">
                          Address details need review: {pendingAddress.faults.join(', ')}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => acceptLocation(pendingAddress, searchMode === 'replace')}
                        className="min-h-11 rounded-lg bg-teal-700 px-4 text-sm font-medium text-white"
                      >
                        Use this location
                      </button>
                    </div>
                  )}
                  {!locations.length && (
                    <button
                      type="button"
                      onClick={() => {
                        const sample = '3333 University Way, Prince George, BC'
                        setAddress(sample)
                        void search(sample)
                      }}
                      className="min-h-11 text-left text-sm text-teal-800 underline"
                    >
                      Try a sample: UNBC, Prince George
                    </button>
                  )}
                </section>
                <div className="min-w-0 rounded-xl border bg-white p-4">
                  <MultiPointComposer
                    locations={locations}
                    activeId={active?.id ?? null}
                    onSelect={(id) => {
                      cancelSearch()
                      setActiveId(id)
                    }}
                    onRemove={(id) => {
                      cancelSearch()
                      setLocations((items) => items.filter((item) => item.id !== id))
                      setOrgId(null)
                      if (id === activeId) setActiveId(null)
                    }}
                    onMapConfirm={(point, replace) => acceptLocation(locationFromCoordinates(point), replace)}
                  />
                </div>
              </div>
            )}
            {step === 'review' && (
              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <section className="min-w-0 space-y-4">
                  <div className="rounded-xl border bg-white p-4">
                    <h2 className="text-lg font-semibold">Review each location</h2>
                    <p role="status" className="mt-1 text-sm text-slate-600">
                      {completeCount} of {locations.length} locations ready.
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Documented place relationships may be selected initially. Map overlaps and nearby communities
                      require your review; they do not establish traditional territory.
                    </p>
                    {locations.length > 0 && (
                      <label className="mt-3 block text-sm font-medium">
                        Reviewing location
                        <select
                          value={active?.id ?? ''}
                          onChange={(event) => setActiveId(event.target.value)}
                          className="mt-1 min-h-12 w-full min-w-0 rounded-lg border bg-white px-2 text-base"
                        >
                          {locations.map((item, index) => (
                            <option key={item.id} value={item.id}>
                              {index + 1}. {item.result.fullAddress}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {org && (
                    <div className="space-y-2 rounded-xl border bg-teal-50 p-4">
                      <p className="text-sm leading-6">
                        Your draft uses the Nations documented by {org.name}. Location comparisons are additional
                        context.
                      </p>
                      <a
                        className="block py-2 text-sm text-teal-800 underline"
                        href={org.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Organization source
                      </a>
                      <button
                        type="button"
                        onClick={() => setOrgId(null)}
                        className="min-h-11 rounded-lg border bg-white px-3 text-sm"
                      >
                        Use individual location selections instead
                      </button>
                    </div>
                  )}
                  {activeReview && (
                    <>
                      {active.status === 'loading' && (
                        <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm">
                          Checking enabled sources for this location…
                        </p>
                      )}
                      {Object.values(active.lookups).some((item) => item.status === 'error') && (
                        <div role="status" className="rounded-lg bg-amber-50 p-3 text-sm">
                          Some source lookups failed. Available evidence is shown below.
                          <button type="button" onClick={retry} className="ml-2 min-h-11 px-3 font-medium underline">
                            Retry sources
                          </button>
                        </div>
                      )}
                      {active.selectedIds?.some(
                        (id) => !activeReview.candidates.some((candidate) => candidate.id === id),
                      ) && (
                        <div className="rounded-lg bg-amber-50 p-3 text-sm leading-6">
                          <p>
                            Some saved Nation selections are unavailable from the enabled sources. Enable their sources
                            or explicitly update your selection.
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setLocations((items) =>
                                items.map((item) =>
                                  item.id === active.id
                                    ? { ...item, selectedIds: activeReview.selected.map((candidate) => candidate.id) }
                                    : item,
                                ),
                              )
                            }
                            className="min-h-11 underline"
                          >
                            Use only the currently available selections
                          </button>
                        </div>
                      )}
                      <CandidateNations
                        key={active.id}
                        candidates={activeReview.candidates}
                        selectedIds={activeReview.selected.map((item) => item.id)}
                        enabledSources={enabledSources}
                        onToggle={toggleNation}
                        showSignals
                        selectionDisabledReason={
                          org
                            ? 'Organization wording uses its documented Nation list.'
                            : active.status === 'loading'
                              ? 'Wait for source checks to complete.'
                              : undefined
                        }
                        renderEvidence={(id) => <EvidenceLinks location={active} graph={graph} nationId={id} />}
                      />
                      {org && (
                        <details className="rounded-xl border bg-white p-4">
                          <summary className="min-h-11 cursor-pointer font-medium">
                            Compare organization and selected location evidence
                          </summary>
                          {Object.entries(compareNationSets(org.acknowledges, nationNames)).map(([kind, names]) => (
                            <p key={kind} className="mt-2 text-sm leading-6">
                              <strong>
                                {kind === 'matched'
                                  ? 'Shared names'
                                  : kind === 'missed'
                                    ? 'Organization names not selected at locations'
                                    : 'Additional location matches'}
                                :
                              </strong>{' '}
                              {names.join(', ') || 'None'}
                            </p>
                          ))}
                        </details>
                      )}
                    </>
                  )}
                </section>
                <aside className="min-w-0 space-y-4">
                  <SourceLayersPanel
                    sourceLookups={active?.lookups ?? initialLookupState}
                    enabledSources={enabledSources}
                    onToggle={(source: SourceKey) =>
                      setEnabledSources((value) => ({ ...value, [source]: !value[source] }))
                    }
                  />
                  {active && (
                    <LanguageContext
                      key={`${active.id}:${active.result.latitude}:${active.result.longitude}`}
                      result={active.result}
                    />
                  )}
                  <MatchTypesPanel
                    enabledMatchTypes={matchTypes}
                    onToggle={(key) => setMatchTypes((value) => ({ ...value, [key]: !value[key] }))}
                  />
                  <details
                    onToggle={(event) => {
                      if (event.currentTarget.open) setShowResearch(true)
                    }}
                    className="rounded-xl border bg-white p-4"
                  >
                    <summary className="min-h-11 cursor-pointer text-sm font-semibold">
                      Data sources and language resources
                    </summary>
                    {showResearch && (
                      <div className="space-y-3">
                        <DataProvenancePanel
                          automatedSources={manifest?.automated ?? []}
                          manualSources={manifest?.manual ?? []}
                        />
                        <LanguageReferences />
                      </div>
                    )}
                  </details>
                </aside>
              </div>
            )}
            {step === 'wording' && (
              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <DraftEditor
                  text={text}
                  onChange={(value) =>
                    setAuthored({
                      text: value,
                      context: authored?.context ?? context,
                      sources: authored?.sources ?? currentSources,
                    })
                  }
                  suggestion={suggestion}
                  context={authored?.context ?? context}
                  edited={authored !== null}
                  onReplace={() => setAuthored(null)}
                  purposeControls={
                    !org &&
                    scope === 'specific' && (
                      <div className="space-y-3 rounded-lg border p-3">
                        <label className="block text-sm font-medium">
                          What is this acknowledgment for?
                          <select
                            aria-label="Acknowledgment purpose"
                            value={purpose}
                            onChange={(event) => setPurpose(event.target.value as AcknowledgementPurpose)}
                            className="mt-2 min-h-11 w-full rounded-md border bg-white px-2 text-base"
                          >
                            <option value="venue">One event venue</option>
                            <option value="operations">Work or operations at these locations</option>
                            <option value="distributed">Participants joining from different locations</option>
                          </select>
                        </label>
                        {purpose === 'venue' && locations.length > 1 && (
                          <label className="block text-sm font-medium">
                            Event venue
                            <select
                              aria-label="Event venue"
                              value={venueId ?? locations[0]?.id ?? ''}
                              onChange={(event) => setVenueId(event.target.value)}
                              className="mt-2 min-h-11 w-full rounded-md border bg-white px-2 text-base"
                            >
                              {!locations.some((location) => location.id === venueId) && venueId && (
                                <option value={venueId}>Choose a venue</option>
                              )}
                              {locations.map((location) => (
                                <option key={location.id} value={location.id}>
                                  {location.result.fullAddress}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <p className="text-sm text-slate-600">
                          {purpose === 'venue'
                            ? 'Only the chosen venue contributes to this draft.'
                            : 'Each location keeps its own Nations, treaty context, and territorial qualifiers.'}
                        </p>
                      </div>
                    )
                  }
                  canCopy={Boolean(authored || suggestion)}
                  notice={notice}
                >
                  <WordingOptionsControls {...options} />
                  {graph && (
                    <p className="text-sm text-slate-600">
                      Registry coverage:{' '}
                      {graph.places.filter((place) => place.type !== 'boundary_reference_area').length} places and{' '}
                      {graph.nations.length} Nation or Peoples records. Coverage is limited; a missing match does not
                      mean there is no Indigenous relationship to a place.
                    </p>
                  )}
                  {org && (
                    <p className="text-sm text-slate-600">
                      This draft recognizes the names listed by the organization. Consult its source wording above for
                      location-specific relationships and qualifiers.
                    </p>
                  )}
                </DraftEditor>
                <aside className="min-w-0 space-y-4">
                  <details className="rounded-xl border bg-white p-4">
                    <summary className="min-h-11 cursor-pointer font-semibold">Sources for this draft</summary>
                    {authored ? (
                      <div>
                        <p className="text-sm leading-6">
                          Sources saved with this wording. Your additions may need further sources.
                        </p>
                        {authored.sources?.map((source) => (
                          <a
                            key={source.url}
                            className="block py-3 text-sm text-teal-800 underline"
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {source.title}
                          </a>
                        ))}
                        {!authored.sources?.length && (
                          <p className="text-sm">No curated source links were saved with this wording.</p>
                        )}
                      </div>
                    ) : org ? (
                      <a
                        className="block py-3 text-sm text-teal-800 underline"
                        href={org.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {org.name}: official source
                      </a>
                    ) : (
                      draftReviews.map((item) => (
                        <div key={item.location.id} className="mt-3 border-t pt-3">
                          <p className="break-words text-sm font-medium">{item.location.result.fullAddress}</p>
                          <p className="mt-1 text-sm">
                            {item.selected.map((candidate) => candidate.preferredName).join(', ') ||
                              'No Nations selected'}
                          </p>
                          <EvidenceLinks location={item.location} graph={graph} />
                        </div>
                      ))
                    )}
                  </details>
                  <TemplatePrompts />
                  <LanguageReferences />
                </aside>
              </div>
            )}
            <nav
              aria-label="Continue building"
              className="ack-step-actions sticky bottom-0 z-10 mt-4 flex flex-wrap justify-between gap-2 border-t bg-stone-50/95 py-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]"
            >
              {step !== 'location' ? (
                <button
                  type="button"
                  onClick={() => navigate(step === 'wording' ? 'review' : 'location')}
                  className="min-h-11 rounded-lg border bg-white px-4 text-sm"
                >
                  Back
                </button>
              ) : (
                <span />
              )}
              {step !== 'wording' && (
                <button
                  type="button"
                  disabled={!locations.length && !org}
                  onClick={() => navigate(step === 'location' ? 'review' : 'wording')}
                  className="min-h-11 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {step === 'location' ? 'Review Nations' : 'Your wording'} →
                </button>
              )}
            </nav>
          </>
        )}
        <footer className="mt-4 space-y-2 border-t py-4 text-sm text-slate-600">
          <p role="status">{storageMessage || 'Your draft and confirmed locations are saved on this device.'}</p>
          <details>
            <summary className="min-h-11 cursor-pointer py-3">Start a new draft</summary>
            <p className="mb-2">This clears the draft and locations saved on this device.</p>
            <button type="button" onClick={clearSaved} className="min-h-11 rounded-lg border bg-white px-3 text-sm">
              Clear saved draft and locations
            </button>
          </details>
        </footer>
      </div>
    </div>
  )
}
