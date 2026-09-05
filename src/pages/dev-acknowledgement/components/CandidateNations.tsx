import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CandidateNation, SourceKey } from '../types'
import { sourceMeta } from '../data'

export function CandidateNations({
  candidates,
  selectedIds,
  enabledSources,
  onToggle,
  selectionDisabledReason,
  renderEvidence,
}: {
  candidates: CandidateNation[]
  selectedIds: string[]
  enabledSources: Record<SourceKey, boolean>
  onToggle: (id: string) => void
  selectionDisabledReason?: string
  renderEvidence?: (id: string) => ReactNode
  showSignals?: boolean
  peopleGroups?: Record<string, string[]>
}) {
  const inputPrefix = useId()
  const pendingFocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    document.getElementById(pendingFocus.current)?.focus({ preventScroll: true })
    pendingFocus.current = null
  }, [selectedIds])
  const [showAdditional, setShowAdditional] = useState(false)
  const selected = candidates.filter((item) => selectedIds.includes(item.id))
  const additional = candidates.filter((item) => !selectedIds.includes(item.id))
  const row = (candidate: CandidateNation) => (
    <article key={candidate.id} className="space-y-2 border-t p-4">
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center">
          <input
            id={`${inputPrefix}-${candidate.id}`}
            type="checkbox"
            checked={selectedIds.includes(candidate.id)}
            disabled={Boolean(selectionDisabledReason)}
            onChange={() => {
              // Keep the moved row available for undo and retain keyboard focus.
              pendingFocus.current = `${inputPrefix}-${candidate.id}`
              setShowAdditional(true)
              onToggle(candidate.id)
            }}
            aria-label={`Include ${candidate.name}`}
            className="h-6 w-6 accent-teal-700"
          />
        </span>
        <span className="min-w-0 py-2">
          <span className="block break-words text-base font-semibold">{candidate.name}</span>
          <span className="mt-1 block text-sm text-slate-600">
            {candidate.sources.verified
              ? candidate.confidence === 'strong'
                ? 'Documented place relationship'
                : 'Curated context — review needed'
              : candidate.sources.nativeLand
                ? 'Map overlap — review needed'
                : 'Reference context — review needed'}
          </span>
        </span>
      </label>
      <p className="text-sm leading-6 text-slate-600">{candidate.reason}</p>
      {candidate.pronunciation && (
        <div className="rounded-lg bg-teal-50 p-3 text-sm leading-6">
          <span className="font-semibold">Pronunciation</span>
          {candidate.pronunciation.phonetic && <span> · {candidate.pronunciation.phonetic}</span>}
          <div className="flex flex-wrap gap-x-4">
            {candidate.pronunciation.audioUrl && (
              <a
                className="inline-flex min-h-11 items-center text-teal-800 underline"
                href={candidate.pronunciation.audioUrl}
                target="_blank"
                rel="noreferrer"
              >
                Listen
              </a>
            )}
            <a
              className="inline-flex min-h-11 items-center text-teal-800 underline"
              href={candidate.pronunciation.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {candidate.pronunciation.sourceLabel}
            </a>
          </div>
          <p className="text-slate-600">{candidate.pronunciation.caveat}</p>
        </div>
      )}
      {renderEvidence?.(candidate.id)}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Source details</summary>
        <p className="text-sm leading-6 text-slate-600">{candidate.notes}</p>
        {(Object.keys(candidate.sources) as SourceKey[])
          .filter((source) => enabledSources[source])
          .map((source) => (
            <p key={source} className="mt-2 break-words text-sm leading-6">
              <strong>{sourceMeta[source].label}:</strong> {candidate.sources[source]}
            </p>
          ))}
        {candidate.sources.nativeLand && (
          <a
            className="inline-flex min-h-11 items-center text-sm text-teal-800 underline"
            href="https://native-land.ca/"
            target="_blank"
            rel="noreferrer"
          >
            Explore Native Land Digital and its sources
          </a>
        )}
      </details>
    </article>
  )
  return (
    <section className="overflow-hidden rounded-xl border bg-white">
      <div className="p-4">
        <h2 className="text-base font-semibold">Selected Nations ({selected.length})</h2>
        {selectionDisabledReason && <p className="mt-2 text-sm leading-6 text-amber-950">{selectionDisabledReason}</p>}
      </div>
      {selected.map(row)}
      {!candidates.length && (
        <p className="p-4 text-sm leading-6 text-slate-600">
          No Nation candidates are available from the enabled sources. Enable additional evidence or check the address.
          An empty result does not mean there are no Indigenous relationships with this place.
        </p>
      )}
      {additional.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowAdditional((value) => !value)}
            aria-expanded={showAdditional || selected.length === 0}
            className="min-h-11 w-full border-t px-4 py-3 text-left text-sm font-medium text-teal-800"
          >
            Additional candidates ({additional.length}) — review before including
          </button>
          {(showAdditional || selected.length === 0) && additional.map(row)}
        </>
      )}
    </section>
  )
}
