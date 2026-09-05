import { Check, Layers3 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { CollapsiblePanel } from './CollapsiblePanel'
import { sourceMeta } from '../data'
import type { SourceKey, SourceLookupState, SourceStatus } from '../types'

function sourceLookupMessage(status: SourceStatus) {
  if (status === 'loading') return 'Checking'
  if (status === 'success') return 'Loaded'
  if (status === 'error') return 'Issue'
  if (status === 'skipped') return 'Manual'
  return 'Ready'
}

type SourceLayersPanelProps = {
  sourceLookups: Record<SourceKey, SourceLookupState>
  enabledSources: Record<SourceKey, boolean>
  onToggle: (source: SourceKey) => void
}

export function SourceLayersPanel({ sourceLookups, enabledSources, onToggle }: SourceLayersPanelProps) {
  return (
    <CollapsiblePanel title="Source evidence" icon={<Layers3 className="h-4 w-4 text-teal-700" />} defaultOpen={false}>
      <div className="space-y-2">
        {(Object.keys(sourceMeta) as SourceKey[]).map((source) => {
          const isManualReference = sourceLookups[source].status === 'skipped'
          return (
            <button
              key={source}
              type="button"
              onClick={() => onToggle(source)}
              disabled={isManualReference}
              aria-pressed={enabledSources[source]}
              className="flex min-h-11 w-full min-w-0 items-start gap-3 rounded-md border p-3 text-left transition hover:border-teal-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-75 lg:w-full lg:min-w-0"
            >
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded border',
                  enabledSources[source] ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white',
                )}
              >
                {enabledSources[source] && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="block text-sm font-medium">{sourceMeta[source].label}</span>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-xs font-semibold uppercase',
                      sourceLookups[source].status === 'success' && 'bg-emerald-100 text-emerald-800',
                      sourceLookups[source].status === 'loading' && 'bg-sky-100 text-sky-800',
                      sourceLookups[source].status === 'error' && 'bg-red-100 text-red-800',
                      sourceLookups[source].status === 'skipped' && 'bg-slate-100 text-slate-600',
                      sourceLookups[source].status === 'idle' && 'bg-slate-100 text-slate-600',
                    )}
                  >
                    {sourceLookupMessage(sourceLookups[source].status)}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">{sourceMeta[source].type}</span>
                <span className="mt-1 block text-sm leading-5 text-slate-600">{sourceMeta[source].description}</span>
                {sourceLookups[source].message && (
                  <span className="mt-1 block text-xs leading-4 text-slate-500">{sourceLookups[source].message}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
      {enabledSources.nativeLand &&
        sourceLookups.nativeLand.matches.some((match) => match.label !== 'Native Land territory overlap') && (
          <div className="mt-3 rounded-lg bg-stone-50 p-3 text-sm leading-6">
            <p className="font-medium">Language and treaty context</p>
            <p className="text-slate-600">These names are not added to Nation selections.</p>
            {sourceLookups.nativeLand.matches
              .filter((match) => match.label !== 'Native Land territory overlap')
              .map((match) => (
                <p key={`${match.label}:${match.name}`}>
                  {match.label}: {match.name}
                </p>
              ))}
          </div>
        )}
    </CollapsiblePanel>
  )
}
