import { useState } from 'react'
import { Check, ChevronDown, ExternalLink } from 'lucide-react'

import { cn } from '@/lib/utils'
import { confidenceLabels, confidenceStyles, sourceMeta } from '../data'
import type { CandidateNation, SourceKey } from '../types'

const SOURCE_KEYS = Object.keys(sourceMeta) as SourceKey[]

/** Short chip labels for the collapsed-row matched-source summary. */
const SOURCE_CHIP_LABEL: Record<SourceKey, string> = {
  verified: 'Verified',
  nativeLand: 'Native Land',
  cad: 'BC CAD',
  treaty: 'Treaty',
  reserve: 'Reserve',
  local: 'Nearest',
}

type CandidateNationsProps = {
  candidates: CandidateNation[]
  selectedIds: string[]
  enabledSources: Record<SourceKey, boolean>
  onToggle: (id: string) => void
}

export function CandidateNations({ candidates, selectedIds, enabledSources, onToggle }: CandidateNationsProps) {
  return (
    <section className="rounded-lg border bg-white shadow-sm">
      <div className="border-b p-4">
        <h2 className="text-base font-semibold">Candidate Nations</h2>
        <p className="mt-1 text-sm text-slate-600">Select what should be included in the generated acknowledgement.</p>
      </div>
      <div className="divide-y">
        {candidates.length === 0 && (
          <div className="p-4 text-sm leading-6 text-slate-600">
            No candidate Nations have been returned from the enabled live sources yet. Try a B.C. address, enable a source with data, or add local verified wording.
          </div>
        )}
        {candidates.map((candidate) => (
          <CandidateRow
            key={candidate.id}
            candidate={candidate}
            selected={selectedIds.includes(candidate.id)}
            enabledSources={enabledSources}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  )
}

type CandidateRowProps = {
  candidate: CandidateNation
  selected: boolean
  enabledSources: Record<SourceKey, boolean>
  onToggle: (id: string) => void
}

function CandidateRow({ candidate, selected, enabledSources, onToggle }: CandidateRowProps) {
  // Collapsed by default — the row shows the name, confidence, and matched-source
  // chips; click to expand the full breakdown.
  const [expanded, setExpanded] = useState(false)
  const matchedSources = SOURCE_KEYS.filter((source) => candidate.sources[source] && enabledSources[source])

  return (
    <article className="p-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onToggle(candidate.id)}
          className={cn(
            'mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded border',
            selected ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300',
          )}
          aria-label={`Include ${candidate.name}`}
        >
          {selected && <Check className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-sm font-semibold sm:text-base">{candidate.name}</span>
            <span className={cn('rounded-md border px-2 py-0.5 text-xs font-medium', confidenceStyles[candidate.confidence])}>
              {confidenceLabels[candidate.confidence]}
            </span>
            <ChevronDown className={cn('h-4 w-4 flex-none text-slate-400 transition-transform', expanded && 'rotate-180')} />
          </span>
          {matchedSources.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {matchedSources.map((source) => (
                <span
                  key={source}
                  className="inline-flex items-center gap-1 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-800"
                >
                  <Check className="h-3 w-3" />
                  {SOURCE_CHIP_LABEL[source]}
                </span>
              ))}
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 grid gap-4 pl-9 md:grid-cols-[1fr_220px]">
          <div>
            <p className="text-sm leading-6 text-slate-600">{candidate.reason}</p>
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
            {SOURCE_KEYS.filter((source) => candidate.sources[source]).map((source) => (
              <div
                key={source}
                className={cn(
                  'rounded-md border p-2',
                  enabledSources[source] ? 'border-teal-200 bg-teal-50' : 'border-slate-100 bg-slate-50 text-slate-400',
                )}
              >
                <div className="font-medium">{sourceMeta[source].label}</div>
                <div className="mt-1 leading-4">{candidate.sources[source]}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}
