import { useCallback, useEffect, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'
import { defaultWordingOptions } from './dev-acknowledgement/data'
import { useAcknowledgementLookups } from './dev-acknowledgement/hooks/useAcknowledgementLookups'
import { buildFallbackAcknowledgement as buildAcknowledgement, buildRegionalAcknowledgement, buildRelationshipAcknowledgement } from '@/lib/acknowledgement/engine'
import type { MatchType, SourceKey, SpeakerPerspective, WordingMode, WordingOptions } from './dev-acknowledgement/types'
import { AcknowledgementHeader } from './dev-acknowledgement/components/AcknowledgementHeader'
import { CandidateNations } from './dev-acknowledgement/components/CandidateNations'
import { DataProvenancePanel } from './dev-acknowledgement/components/DataProvenancePanel'
import { LanguageReferences } from './dev-acknowledgement/components/LanguageReferences'
import { MatchTypesPanel } from './dev-acknowledgement/components/MatchTypesPanel'
import { MultiPointComposer } from './dev-acknowledgement/components/MultiPointComposer'
import { OrganizationPreview } from './dev-acknowledgement/components/OrganizationPreview'
import { OrganizationsSidebar } from './dev-acknowledgement/components/OrganizationsSidebar'
import { SourceLayersPanel } from './dev-acknowledgement/components/SourceLayersPanel'
import { TemplatePrompts } from './dev-acknowledgement/components/TemplatePrompts'
import { VariantControls, type AcknowledgementScope, type WordingToggle } from './dev-acknowledgement/components/VariantControls'
import { WordingPreview } from './dev-acknowledgement/components/WordingPreview'

export default function DevAcknowledgement() {
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
  // Candidate identity is the stable nation.id (see buildCandidates), so the
  // default pre-selects Lheidli T'enneh by id.
  const [selectedIds, setSelectedIds] = useState<string[]>(['lheidli-tenneh'])
  const [wordingMode, setWordingMode] = useState<WordingMode>('event')
  const [wordingOptions, setWordingOptions] = useState<WordingOptions>(defaultWordingOptions)
  const [perspective, setPerspective] = useState<SpeakerPerspective>('collective')
  const [organizationName, setOrganizationName] = useState('')
  const [scope, setScope] = useState<AcknowledgementScope>('specific')
  const [regionName, setRegionName] = useState('British Columbia')
  const [customWording, setCustomWording] = useState('')
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'mapNations' | 'wording' | 'organizations'>('mapNations')
  const [orgToLoad, setOrgToLoad] = useState<string | null>(null)
  const [orgPreset, setOrgPreset] = useState<string | null>(null)

  // From the Organizations tab: load the selected org onto the map and jump there.
  const previewOnMap = useCallback((id: string) => {
    setOrgToLoad(id)
    setActiveTab('mapNations')
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
  } = useAcknowledgementLookups('3333 University Way, Prince George, BC', enabledMatchTypes)

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

  const wording = useMemo(() => {
    if (scope === 'regional') {
      return buildRegionalAcknowledgement(wordingMode, { perspective, organizationName, regionName })
    }
    return relationshipGraph && matchedRelationshipPlace && enabledSources.verified
      ? buildRelationshipAcknowledgement(wordingMode, relationshipGraph, matchedRelationshipPlace, selectedIds, { ...wordingOptions, perspective, organizationName })
      : buildAcknowledgement(wordingMode, selectedNames, { perspective, organizationName })
  }, [enabledSources.verified, matchedRelationshipPlace, organizationName, perspective, regionName, relationshipGraph, scope, selectedIds, selectedNames, wordingMode, wordingOptions])

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

  const toggleWordingOption = (option: WordingToggle) => {
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
        onSubmit={geocodeAddressInput}
        geocodeStatus={geocodeStatus}
        geocodeError={geocodeError}
        copied={copied}
        onCopy={handleCopyWording}
      />

      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl gap-1 px-3 sm:px-6 lg:px-8">
          {([['mapNations', 'Map & Nations'], ['wording', 'Wording'], ['organizations', 'Organizations']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveTab(value)}
              aria-current={activeTab === value}
              className={cn(
                '-mb-px border-b-2 px-4 py-3 text-sm font-medium transition',
                activeTab === value ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'mapNations' && (
        <MultiPointComposer
          graph={relationshipGraph}
          addressPoint={geocodeResult}
          onActivePoint={(latitude, longitude) => dropLocation({ latitude, longitude })}
          orgToLoad={orgToLoad}
          onOrgLoaded={() => setOrgToLoad(null)}
        >
          <section className="rounded-lg border bg-white p-3 shadow-sm">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Voice</div>
            <div className="grid grid-cols-3 gap-2">
              {([['collective', 'Community'], ['individual', 'Individual'], ['organization', 'Organization']] as const).map(([value, voiceLabel]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPerspective(value)}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-xs font-medium',
                    perspective === value ? 'border-teal-700 bg-teal-700 text-white' : 'bg-white hover:border-teal-300',
                  )}
                >
                  {voiceLabel}
                </button>
              ))}
            </div>
          </section>

          <WordingPreview wording={customWording} copied={copied} onCopy={handleCopyWording} />

          <CandidateNations
            candidates={visibleCandidates}
            selectedIds={selectedIds}
            enabledSources={enabledSources}
            onToggle={toggleCandidate}
          />

          <SourceLayersPanel sourceLookups={sourceLookups} enabledSources={enabledSources} onToggle={toggleSource} />
          <MatchTypesPanel enabledMatchTypes={enabledMatchTypes} onToggle={toggleMatchType} />
          <DataProvenancePanel automatedSources={automatedManifestSources} manualSources={manualManifestSources} />
        </MultiPointComposer>
      )}

      {activeTab === 'wording' && (
        <main className="mx-auto grid max-w-7xl gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5 lg:px-8">
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
            onCustomWordingChange={setCustomWording}
          />
          <aside className="space-y-4">
            <TemplatePrompts />
            <LanguageReferences />
          </aside>
        </main>
      )}

      {activeTab === 'organizations' && (
        <main className="mx-auto grid max-w-7xl gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-5 lg:px-8">
          <OrganizationsSidebar selectedId={orgPreset} onSelect={setOrgPreset} />
          <OrganizationPreview orgId={orgPreset} onPreviewOnMap={previewOnMap} />
        </main>
      )}
    </div>
  )
}
