import { BookOpen, RotateCcw } from 'lucide-react'

import type { SpeakerPerspective, WordingMode, WordingOptions } from '../types'
import { WordingOptionsControls, type AcknowledgementScope, type WordingToggle } from './WordingOptionsControls'

export type { AcknowledgementScope, WordingToggle } from './WordingOptionsControls'

type VariantControlsProps = {
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
  customWording: string
  onCustomWordingChange: (value: string) => void
  customWordingDirty?: boolean
  onResetCustomWording?: () => void
  showVoice?: boolean
  lockedOrganizationName?: string
  showContextToggles?: boolean
}

export function VariantControls({
  customWording,
  onCustomWordingChange,
  customWordingDirty = false,
  onResetCustomWording,
  showVoice = true,
  lockedOrganizationName,
  showContextToggles = true,
  ...controls
}: VariantControlsProps) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-teal-700" />
          <h2 className="text-sm font-semibold">Variant Controls</h2>
        </div>
        {customWordingDirty && onResetCustomWording && (
          <button
            type="button"
            onClick={onResetCustomWording}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        )}
      </div>
      {!showVoice && lockedOrganizationName && (
        <div className="mb-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Voice</div>
          <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900">
            Organization · {lockedOrganizationName}
          </div>
        </div>
      )}
      <WordingOptionsControls {...controls} showVoice={showVoice} showContextToggles={showContextToggles} />
      {customWordingDirty && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Manual edit active. Generator controls will be reflected after you reset the wording.
        </p>
      )}
      <textarea
        value={customWording}
        onChange={(event) => onCustomWordingChange(event.target.value)}
        className="mt-3 min-h-44 w-full resize-none rounded-md border bg-slate-50 p-3 text-sm leading-6 outline-none"
        aria-label="Generated acknowledgement wording"
      />
    </section>
  )
}
