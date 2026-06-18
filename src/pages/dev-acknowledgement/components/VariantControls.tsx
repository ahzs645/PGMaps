import { AlertTriangle, BookOpen, Check } from 'lucide-react'

import { cn } from '@/lib/utils'
import { wordingModeLabels } from '../data'
import type { WordingMode, WordingOptions } from '../types'

type VariantControlsProps = {
  wordingMode: WordingMode
  onWordingModeChange: (mode: WordingMode) => void
  wordingOptions: WordingOptions
  onToggleOption: (option: keyof WordingOptions) => void
  customWording: string
  onCustomWordingChange: (value: string) => void
}

export function VariantControls({
  wordingMode,
  onWordingModeChange,
  wordingOptions,
  onToggleOption,
  customWording,
  onCustomWordingChange,
}: VariantControlsProps) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-teal-700" />
        <h2 className="text-sm font-semibold">Variant Controls</h2>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-2 xl:grid-cols-3">
        {(['short', 'formal', 'event', 'institutional', 'educational'] as WordingMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onWordingModeChange(mode)}
            className={cn(
              'rounded-md border px-2 py-2 text-xs font-medium',
              wordingMode === mode ? 'border-teal-700 bg-teal-700 text-white' : 'bg-white hover:border-teal-300',
            )}
          >
            {wordingModeLabels[mode]}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-600">
        {([
          ['includeTreatyContext', 'Treaty context', 'Include phrases such as Treaty 8 territory or Nisg̱a’a Treaty territory when present.'],
          ['includePeopleGroupContext', 'People-group context', 'Include connected peoples such as Dakelh, Dane-zaa, Ts’msyen, or Nisg̱a’a when present.'],
        ] as const).map(([option, label, description]) => (
          <button
            key={option}
            type="button"
            onClick={() => onToggleOption(option)}
            className="flex w-full items-start gap-3 rounded-md border p-3 text-left transition hover:border-teal-300"
          >
            <span className={cn(
              'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded border',
              wordingOptions[option] ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white',
            )}>
              {wordingOptions[option] && <Check className="h-3.5 w-3.5" />}
            </span>
            <span>
              <span className="block font-medium text-slate-900">{label}</span>
              <span className="mt-0.5 block text-slate-500">{description}</span>
            </span>
          </button>
        ))}
      </div>
      <textarea
        value={customWording}
        onChange={(event) => onCustomWordingChange(event.target.value)}
        className="mt-3 min-h-44 w-full resize-none rounded-md border bg-slate-50 p-3 text-sm leading-6 outline-none"
        aria-label="Generated acknowledgement wording"
      />
      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" />
          Review needed
        </div>
        Confirm wording with local or Nation-specific guidance where possible. Verified relationship records generate controlled variants, while CAD, reserve, treaty, and proximity layers remain supporting context.
      </div>
    </section>
  )
}
