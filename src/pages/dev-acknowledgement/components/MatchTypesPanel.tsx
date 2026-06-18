import { Check, ShieldCheck } from 'lucide-react'

import { cn } from '@/lib/utils'
import { CollapsiblePanel } from './CollapsiblePanel'
import type { MatchType } from '../types'

type MatchTypesPanelProps = {
  enabledMatchTypes: Record<MatchType, boolean>
  onToggle: (matchType: MatchType) => void
}

export function MatchTypesPanel({ enabledMatchTypes, onToggle }: MatchTypesPanelProps) {
  return (
    <CollapsiblePanel title="Match Types" icon={<ShieldCheck className="h-4 w-4 text-teal-700" />} defaultOpen={false}>
      <div className="space-y-2 text-xs leading-5 text-slate-600">
        {([
          ['place', 'Exact places', 'Campuses, institutes, and named facilities with curated records.'],
          ['municipality', 'Municipal context', 'City-level records such as Prince George.'],
          ['boundary', 'Boundary context', 'Point-in-polygon matches from configured reference areas.'],
        ] as const).map(([matchType, label, description]) => (
          <button
            key={matchType}
            type="button"
            onClick={() => onToggle(matchType)}
            className="flex w-full items-start gap-3 rounded-md border p-3 text-left transition hover:border-teal-300"
          >
            <span className={cn(
              'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded border',
              enabledMatchTypes[matchType] ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white',
            )}>
              {enabledMatchTypes[matchType] && <Check className="h-3.5 w-3.5" />}
            </span>
            <span>
              <span className="block font-medium text-slate-900">{label}</span>
              <span className="mt-0.5 block text-slate-500">{description}</span>
            </span>
          </button>
        ))}
      </div>
    </CollapsiblePanel>
  )
}
