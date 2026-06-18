import { Check, Layers3 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { CollapsiblePanel } from './CollapsiblePanel'
import { sourceMeta } from '../data'
import type { SourceKey, SourceLookupState, SourceStatus } from '../types'

function sourceLookupMessage(status: SourceStatus) {
  if (status === 'loading') return 'Checking'
  if (status === 'success') return 'Local'
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
    <CollapsiblePanel title="Source Layers" icon={<Layers3 className="h-4 w-4 text-teal-700" />} defaultOpen={false}>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
        {(Object.keys(sourceMeta) as SourceKey[]).map((source) => (
          <button
            key={source}
            type="button"
            onClick={() => onToggle(source)}
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
    </CollapsiblePanel>
  )
}
