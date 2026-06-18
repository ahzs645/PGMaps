import { BookOpen } from 'lucide-react'

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
}

export function VariantControls({
  customWording,
  onCustomWordingChange,
  ...controls
}: VariantControlsProps) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-teal-700" />
        <h2 className="text-sm font-semibold">Variant Controls</h2>
      </div>
      <WordingOptionsControls {...controls} />
      <textarea
        value={customWording}
        onChange={(event) => onCustomWordingChange(event.target.value)}
        className="mt-3 min-h-44 w-full resize-none rounded-md border bg-slate-50 p-3 text-sm leading-6 outline-none"
        aria-label="Generated acknowledgement wording"
      />
    </section>
  )
}
