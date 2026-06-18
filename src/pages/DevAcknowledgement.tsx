import { useCallback, useEffect, useMemo, useState } from 'react'

import { defaultWordingOptions } from './dev-acknowledgement/data'
import { useAcknowledgementLookups } from './dev-acknowledgement/hooks/useAcknowledgementLookups'
import { buildAcknowledgement, buildRelationshipAcknowledgement } from './dev-acknowledgement/wording'
import type { MatchType, SourceKey, WordingMode, WordingOptions } from './dev-acknowledgement/types'
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
  const [copied, setCopied] = useState(false)

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

  const wording = useMemo(() => (
    relationshipGraph && matchedRelationshipPlace && enabledSources.verified
      ? buildRelationshipAcknowledgement(wordingMode, relationshipGraph, matchedRelationshipPlace, selectedIds, wordingOptions)
      : buildAcknowledgement(wordingMode, selectedNames)
  ), [enabledSources.verified, matchedRelationshipPlace, relationshipGraph, selectedIds, selectedNames, wordingMode, wordingOptions])

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
        onSubmit={geocodeAddressInput}
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
            onDrop={dropLocation}
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
