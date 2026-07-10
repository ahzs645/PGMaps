import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'
import { wordingModeLabels } from '../data'
import type { SpeakerPerspective, WordingMode, WordingOptions } from '../types'

/** The boolean wording options that the context checkboxes toggle. */
export type WordingToggle = 'includeTreatyContext' | 'includePeopleGroupContext'

/** Whether to name the specific Nation(s) or fall back to a region-wide statement. */
export type AcknowledgementScope = 'specific' | 'regional'

const MODES: WordingMode[] = ['short', 'formal', 'event', 'institutional']

const PERSPECTIVES: { value: SpeakerPerspective; label: string }[] = [
  { value: 'collective', label: 'Community' },
  { value: 'individual', label: 'Individual' },
  { value: 'organization', label: 'Organization' },
]

const SCOPES: { value: AcknowledgementScope; label: string }[] = [
  { value: 'specific', label: 'Specific' },
  { value: 'regional', label: 'Regional' },
]

export type WordingOptionsControlsProps = {
  wordingMode: WordingMode
  onWordingModeChange: (mode: WordingMode) => void
  perspective: SpeakerPerspective
  onPerspectiveChange: (perspective: SpeakerPerspective) => void
  organizationName: string
  onOrganizationNameChange: (value: string) => void
  scope: AcknowledgementScope
  onScopeChange: (scope: AcknowledgementScope) => void
  regionName: string
  onRegionNameChange: (value: string) => void
  wordingOptions: WordingOptions
  onToggleOption: (option: WordingToggle) => void
  /** Context toggles only affect verified-relationship wording; hide where they have no effect. */
  showContextToggles?: boolean
  /** Voice picker — hide where the speaker is already fixed (e.g. an org preview). */
  showVoice?: boolean
}

/** Shared mode / voice / scope / context controls used by the Wording tab and the org preview. */
export function WordingOptionsControls({
  wordingMode,
  onWordingModeChange,
  perspective,
  onPerspectiveChange,
  organizationName,
  onOrganizationNameChange,
  scope,
  onScopeChange,
  regionName,
  onRegionNameChange,
  wordingOptions,
  onToggleOption,
  showContextToggles = true,
  showVoice = true,
}: WordingOptionsControlsProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-3">
        {MODES.map((mode) => (
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
      {showVoice && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Voice</div>
          <div className="grid grid-cols-3 gap-2">
            {PERSPECTIVES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => onPerspectiveChange(value)}
                className={cn(
                  'rounded-md border px-2 py-2 text-xs font-medium',
                  perspective === value ? 'border-teal-700 bg-teal-700 text-white' : 'bg-white hover:border-teal-300',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {perspective === 'organization' && (
            <input
              value={organizationName}
              onChange={(event) => onOrganizationNameChange(event.target.value)}
              placeholder="Organization name (e.g. UNBC)"
              aria-label="Organization name"
              className="mt-2 w-full rounded-md border bg-white px-3 py-2 text-sm outline-none"
            />
          )}
        </div>
      )}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Scope</div>
        <div className="grid grid-cols-2 gap-2">
          {SCOPES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onScopeChange(value)}
              className={cn(
                'rounded-md border px-2 py-2 text-xs font-medium',
                scope === value ? 'border-teal-700 bg-teal-700 text-white' : 'bg-white hover:border-teal-300',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {scope === 'regional' && (
          <input
            value={regionName}
            onChange={(event) => onRegionNameChange(event.target.value)}
            placeholder="Region (e.g. British Columbia)"
            aria-label="Region name"
            className="mt-2 w-full rounded-md border bg-white px-3 py-2 text-sm outline-none"
          />
        )}
      </div>
      {showContextToggles && scope !== 'regional' && (
        <div className="grid gap-2 text-xs leading-5 text-slate-600">
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
      )}
    </div>
  )
}
