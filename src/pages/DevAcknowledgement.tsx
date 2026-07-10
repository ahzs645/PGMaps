import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { defaultWordingOptions } from './dev-acknowledgement/data'
import { useAcknowledgementLookups } from './dev-acknowledgement/hooks/useAcknowledgementLookups'
import {
  buildFallbackAcknowledgement as buildAcknowledgement,
  buildMultiPointAcknowledgement,
  buildRegionalAcknowledgement,
  buildRelationshipAcknowledgement,
  peopleGroupName,
} from '@/lib/acknowledgement/engine'
import type { MatchType, SourceKey, SpeakerPerspective, WordingMode, WordingOptions } from './dev-acknowledgement/types'
import type { OrgRecord } from './dev-acknowledgement/organizations'
import {
  effectiveSelectedCandidateIds,
  selectedCandidateNames,
  toggleMatchTypeState,
  visibleAcknowledgementCandidates,
} from './dev-acknowledgement/state'
import { AcknowledgementHeader } from './dev-acknowledgement/components/AcknowledgementHeader'
import { CandidateNations } from './dev-acknowledgement/components/CandidateNations'
import { DataProvenancePanel } from './dev-acknowledgement/components/DataProvenancePanel'
import { LanguageReferences } from './dev-acknowledgement/components/LanguageReferences'
import { MatchTypesPanel } from './dev-acknowledgement/components/MatchTypesPanel'
import { MultiPointComposer, type MultiPointWordingContext } from './dev-acknowledgement/components/MultiPointComposer'
import { OrganizationPreview } from './dev-acknowledgement/components/OrganizationPreview'
import { OrganizationsSidebar } from './dev-acknowledgement/components/OrganizationsSidebar'
import { SourceLayersPanel } from './dev-acknowledgement/components/SourceLayersPanel'
import { TemplatePrompts } from './dev-acknowledgement/components/TemplatePrompts'
import {
  VariantControls,
  type AcknowledgementScope,
  type WordingToggle,
} from './dev-acknowledgement/components/VariantControls'
import { WordingPreview } from './dev-acknowledgement/components/WordingPreview'

const TABS = [
  ['mapNations', 'Map & Nations'],
  ['wording', 'Wording'],
  ['organizations', 'Organizations'],
] as const

type ActiveTab = (typeof TABS)[number][0]

export default function DevAcknowledgement() {
  const [enabledMatchTypes, setEnabledMatchTypes] = useState<Record<MatchType, boolean>>(() => ({
    place: true,
    municipality: true,
    boundary: true,
  }))
  const [enabledSources, setEnabledSources] = useState<Record<SourceKey, boolean>>(() => ({
    verified: true,
    nativeLand: true,
    cad: false,
    treaty: true,
    reserve: true,
    local: true,
  }))
  // Candidate identity is the stable nation.id (see buildCandidates), so the
  // default pre-selects Lheidli T'enneh by id.
  const [selectedIds, setSelectedIds] = useState<string[]>(['lheidli-tenneh'])
  const [wordingMode, setWordingMode] = useState<WordingMode>('event')
  const [wordingOptions, setWordingOptions] = useState<WordingOptions>(defaultWordingOptions)
  const [perspective, setPerspective] = useState<SpeakerPerspective>('organization')
  const [organizationName, setOrganizationName] = useState('UNBC')
  const [scope, setScope] = useState<AcknowledgementScope>('specific')
  const [regionName, setRegionName] = useState('British Columbia')
  const [customWordingOverride, setCustomWordingOverride] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('mapNations')
  const [orgToLoad, setOrgToLoad] = useState<string | null>(null)
  const [orgPreset, setOrgPreset] = useState<string | null>(null)
  const [multiPointContext, setMultiPointContext] = useState<MultiPointWordingContext | null>(null)
  // The org currently loaded onto the map (null = free-form points). When set, the
  // speaker is unambiguously that organization, so we lock the voice to it and hide
  // the redundant Community/Individual/Organization picker.
  const [loadedOrg, setLoadedOrg] = useState<OrgRecord | null>(null)

  // From the Organizations tab: load the selected org onto the map and jump there.
  const previewOnMap = useCallback((id: string) => {
    setCustomWordingOverride(null)
    setOrgToLoad(id)
    setActiveTab('mapNations')
  }, [])

  // Keep the voice in sync with whatever org the map currently has loaded.
  const handleOrgChange = useCallback((org: OrgRecord | null) => {
    setLoadedOrg(org)
    if (org) {
      setPerspective('organization')
      setOrganizationName(org.name)
    }
  }, [])

  const {
    address,
    setAddress,
    geocodeResult,
    geocodeStatus,
    geocodeError,
    indigenousManifest,
    relationshipGraph,
    matchedRelationshipPlace,
    sourceLookups,
    candidates,
    runSourceLookups,
    geocodeAddressInput,
    dropLocation,
    clearLocation,
  } = useAcknowledgementLookups('3333 University Way, Prince George, BC', enabledMatchTypes)

  const automatedManifestSources = indigenousManifest?.automated ?? []
  const manualManifestSources = indigenousManifest?.manual ?? []

  const visibleCandidates = useMemo(
    () => visibleAcknowledgementCandidates(candidates, enabledSources),
    [candidates, enabledSources],
  )

  const effectiveSelectedIds = useMemo(
    () => effectiveSelectedCandidateIds(visibleCandidates, selectedIds),
    [selectedIds, visibleCandidates],
  )

  const selectedCandidates = useMemo(
    () => visibleCandidates.filter((candidate) => effectiveSelectedIds.includes(candidate.id)),
    [effectiveSelectedIds, visibleCandidates],
  )

  const selectedNames = useMemo(
    () => selectedCandidateNames(visibleCandidates, effectiveSelectedIds),
    [effectiveSelectedIds, visibleCandidates],
  )

  // People-group(s) each candidate Nation belongs to, drawn from the matched
  // relationship (e.g. Lheidli T'enneh → Dakelh (Carrier)). Keyed by candidate id.
  const peopleGroupsByCandidate = useMemo(() => {
    const map: Record<string, string[]> = {}
    if (!relationshipGraph || !matchedRelationshipPlace) return map
    for (const relationship of matchedRelationshipPlace.relationships) {
      const nationPeopleGroups = relationship.nationPeopleGroups
      if (!nationPeopleGroups) continue
      for (const [nationId, groupIds] of Object.entries(nationPeopleGroups)) {
        const names = groupIds.map((groupId) => peopleGroupName(relationshipGraph, groupId))
        map[nationId] = Array.from(new Set([...(map[nationId] ?? []), ...names]))
      }
    }
    return map
  }, [relationshipGraph, matchedRelationshipPlace])

  // The structured relationship wording only names Nations from the verified graph
  // match. If the selection adds non-verified candidates (Native Land overlaps, etc.),
  // fall back to wording built from the full selected list so the extra Nations show.
  const allSelectedVerified = useMemo(() => {
    return (
      enabledSources.verified &&
      selectedCandidates.length > 0 &&
      selectedCandidates.every((candidate) => Boolean(candidate.sources.verified))
    )
  }, [enabledSources.verified, selectedCandidates])

  const generatedWording = useMemo(() => {
    if (scope === 'regional') {
      return buildRegionalAcknowledgement(wordingMode, { perspective, organizationName, regionName })
    }

    if (multiPointContext) {
      return buildMultiPointAcknowledgement(wordingMode, multiPointContext.summary, {
        perspective,
        organizationName,
        regionName,
        nationNames: multiPointContext.nationNames,
        forceRegional: multiPointContext.selectedOrg?.framing === 'regional',
        forceSpecific: Boolean(multiPointContext.selectedOrg && multiPointContext.nationNames.length > 0),
      })
    }

    return relationshipGraph && matchedRelationshipPlace && enabledSources.verified && allSelectedVerified
      ? buildRelationshipAcknowledgement(
          wordingMode,
          relationshipGraph,
          matchedRelationshipPlace,
          effectiveSelectedIds,
          { ...wordingOptions, perspective, organizationName },
        )
      : buildAcknowledgement(wordingMode, selectedNames, { perspective, organizationName })
  }, [
    allSelectedVerified,
    effectiveSelectedIds,
    enabledSources.verified,
    matchedRelationshipPlace,
    multiPointContext,
    organizationName,
    perspective,
    regionName,
    relationshipGraph,
    scope,
    selectedNames,
    wordingMode,
    wordingOptions,
  ])

  const customWording = customWordingOverride ?? generatedWording
  const customWordingDirty = customWordingOverride !== null
  const selectionDisabledReason =
    scope === 'regional'
      ? 'Regional wording does not use individual Nation selections.'
      : multiPointContext
        ? 'Multi-point wording uses the combined Nations resolved across all mapped locations.'
        : undefined

  const toggleSource = (source: SourceKey) => {
    setEnabledSources((current) => ({ ...current, [source]: !current[source] }))
  }

  const toggleMatchType = (matchType: MatchType) => {
    const next = toggleMatchTypeState(enabledMatchTypes, matchType)
    setEnabledMatchTypes(next)
    // Re-match against the geocoded address, not the input text — the user may
    // have typed something new that was never submitted.
    if (geocodeResult) void runSourceLookups(geocodeResult, next, geocodeResult.fullAddress)
  }

  const toggleWordingOption = (option: WordingToggle) => {
    setWordingOptions((current) => ({ ...current, [option]: !current[option] }))
  }

  const toggleCandidate = (candidateId: string) => {
    setSelectedIds((current) => {
      const available = new Set(visibleCandidates.map((candidate) => candidate.id))
      const currentVisible = current.filter((id) => available.has(id))
      const base = currentVisible.length > 0 ? currentVisible : effectiveSelectedIds
      return base.includes(candidateId) ? base.filter((id) => id !== candidateId) : [...base, candidateId]
    })
  }

  const handleActivePoint = useCallback(
    (latitude: number, longitude: number, label?: string) => {
      setCustomWordingOverride(null)
      dropLocation({ latitude, longitude, label })
    },
    [dropLocation],
  )

  const handleClearActivePoint = useCallback(() => {
    setCustomWordingOverride(null)
    clearLocation()
  }, [clearLocation])

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tab: ActiveTab) => {
    const currentIndex = TABS.findIndex(([value]) => value === tab)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = TABS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = TABS[nextIndex][0]
    setActiveTab(nextTab)
    document.getElementById(`acknowledgement-tab-${nextTab}`)?.focus()
  }

  const copiedTimeoutRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (copiedTimeoutRef.current !== null) window.clearTimeout(copiedTimeoutRef.current)
    },
    [],
  )

  const handleCopyWording = useCallback(async () => {
    const text = customWording.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copiedTimeoutRef.current !== null) window.clearTimeout(copiedTimeoutRef.current)
      copiedTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [customWording])

  const resetCustomWording = useCallback(() => {
    setCustomWordingOverride(null)
  }, [])

  const updateCustomWording = useCallback((value: string) => {
    setCustomWordingOverride(value)
  }, [])

  return (
    <div className="min-h-full bg-stone-50 pt-12 text-slate-950 sm:pt-0">
      <AcknowledgementHeader
        address={address}
        onAddressChange={setAddress}
        onSubmit={geocodeAddressInput}
        geocodeStatus={geocodeStatus}
        geocodeError={geocodeError}
        copied={copied}
        onCopy={handleCopyWording}
      />

      <div className="border-b bg-white">
        <div
          role="tablist"
          aria-label="Acknowledgement builder sections"
          className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 sm:px-6 lg:px-8"
        >
          {TABS.map(([value, label]) => (
            <button
              key={value}
              id={`acknowledgement-tab-${value}`}
              type="button"
              role="tab"
              onClick={() => setActiveTab(value)}
              onKeyDown={(event) => handleTabKeyDown(event, value)}
              aria-selected={activeTab === value}
              aria-controls={`acknowledgement-panel-${value}`}
              tabIndex={activeTab === value ? 0 : -1}
              className={cn(
                '-mb-px flex-none whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition sm:px-4',
                activeTab === value
                  ? 'border-teal-700 text-teal-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Hidden rather than unmounted on tab switch: unmounting would destroy the
          composer's points/org state while the parent's wording context lived on. */}
      <div
        id="acknowledgement-panel-mapNations"
        role="tabpanel"
        aria-labelledby="acknowledgement-tab-mapNations"
        hidden={activeTab !== 'mapNations'}
      >
        <MultiPointComposer
          graph={relationshipGraph}
          addressPoint={geocodeResult}
          onActivePoint={handleActivePoint}
          onClearActivePoint={handleClearActivePoint}
          orgToLoad={orgToLoad}
          onOrgLoaded={() => setOrgToLoad(null)}
          onOrgChange={handleOrgChange}
          onWordingContextChange={setMultiPointContext}
        >
          {loadedOrg ? (
            // An org is loaded: the voice is unambiguously this organization, so
            // show a read-only indicator instead of the voice picker.
            <section className="rounded-lg border bg-white p-3 shadow-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Voice</div>
              <div className="rounded-md border border-teal-700 bg-teal-700 px-3 py-1.5 text-xs font-medium text-white">
                Organization · {loadedOrg.name}
              </div>
            </section>
          ) : (
            <section className="rounded-lg border bg-white p-3 shadow-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Voice</div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['collective', 'Community'],
                    ['individual', 'Individual'],
                    ['organization', 'Organization'],
                  ] as const
                ).map(([value, voiceLabel]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPerspective(value)}
                    className={cn(
                      'rounded-md border px-2 py-1.5 text-xs font-medium',
                      perspective === value
                        ? 'border-teal-700 bg-teal-700 text-white'
                        : 'bg-white hover:border-teal-300',
                    )}
                  >
                    {voiceLabel}
                  </button>
                ))}
              </div>
              {perspective === 'organization' && (
                <input
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  placeholder="Organization name (e.g. UNBC)"
                  aria-label="Organization name"
                  className="mt-2 w-full rounded-md border bg-white px-3 py-1.5 text-sm outline-none"
                />
              )}
            </section>
          )}

          <WordingPreview wording={customWording} copied={copied} onCopy={handleCopyWording} />

          <CandidateNations
            candidates={visibleCandidates}
            selectedIds={effectiveSelectedIds}
            enabledSources={enabledSources}
            onToggle={toggleCandidate}
            peopleGroups={peopleGroupsByCandidate}
            showSignals
            selectionDisabledReason={selectionDisabledReason}
          />

          <SourceLayersPanel sourceLookups={sourceLookups} enabledSources={enabledSources} onToggle={toggleSource} />
          <MatchTypesPanel enabledMatchTypes={enabledMatchTypes} onToggle={toggleMatchType} />
          <DataProvenancePanel automatedSources={automatedManifestSources} manualSources={manualManifestSources} />
        </MultiPointComposer>
      </div>

      {activeTab === 'wording' && (
        <div
          id="acknowledgement-panel-wording"
          role="tabpanel"
          aria-labelledby="acknowledgement-tab-wording"
          className="mx-auto grid max-w-7xl gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5 lg:px-8"
        >
          <VariantControls
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
            onToggleOption={toggleWordingOption}
            customWording={customWording}
            onCustomWordingChange={updateCustomWording}
            customWordingDirty={customWordingDirty}
            onResetCustomWording={resetCustomWording}
            showVoice={!loadedOrg}
            lockedOrganizationName={loadedOrg?.name}
            showContextToggles={!multiPointContext && enabledSources.verified && allSelectedVerified}
          />
          <aside className="space-y-4">
            <TemplatePrompts />
            <LanguageReferences />
          </aside>
        </div>
      )}

      {activeTab === 'organizations' && (
        <div
          id="acknowledgement-panel-organizations"
          role="tabpanel"
          aria-labelledby="acknowledgement-tab-organizations"
          className="mx-auto grid max-w-7xl gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-5 lg:px-8"
        >
          <OrganizationsSidebar selectedId={orgPreset} onSelect={setOrgPreset} />
          <OrganizationPreview key={orgPreset ?? 'none'} orgId={orgPreset} onPreviewOnMap={previewOnMap} />
        </div>
      )}
    </div>
  )
}
