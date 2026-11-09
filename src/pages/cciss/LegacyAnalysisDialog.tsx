import { useState } from 'react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import type { ComparisonSnapshot } from './comparison'
import { CoordinateForm } from './CoordinateForm'
import { LEGACY_LIMITATION } from './legacyComparison'
import { LegacyPointComparison } from './LegacyPointComparison'

/** Typed coordinates for the legacy analysis; a map click while the dialog is closed does the same. */
function Location({ point, onChange }: { point: [number, number]; onChange: (point: [number, number]) => void }) {
  const [error, setError] = useState('')
  return (
    <CoordinateForm
      initial={point}
      submitLabel="Analyse location"
      onSubmit={(next) => {
        if (!next) return setError('Enter valid longitude (−180 to 180) and latitude (−90 to 90).')
        setError('')
        onChange(next)
      }}
    >
      <p className="mt-2 text-xs text-muted-foreground">
        Use these coordinates or close this window and click the map. The analysis uses numeric rasters; the displayed
        map layer does not change its inputs.
      </p>
      {error && (
        <InlineAlert tone="error" className="mt-2">
          {error}
        </InlineAlert>
      )}
    </CoordinateForm>
  )
}

export function LegacyAnalysisDialog({
  point,
  onPointChange,
  onClose,
  onCaptureComparison,
  onOpenComparison,
  comparisonCount = 0,
}: {
  point: [number, number]
  onPointChange: (point: [number, number]) => void
  onClose: () => void
  onCaptureComparison?: (snapshot: ComparisonSnapshot) => void
  onOpenComparison?: () => void
  comparisonCount?: number
}) {
  return (
    <DialogShell
      title="Legacy CCISS analysis"
      subtitle="Location → species comparison → report"
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-4">
        <InlineAlert tone="warning">{LEGACY_LIMITATION}</InlineAlert>
        <Location key={`location:${point.join(',')}`} point={point} onChange={onPointChange} />
        <LegacyPointComparison
          point={point}
          onCaptureComparison={onCaptureComparison}
          onOpenComparison={onOpenComparison}
          comparisonCount={comparisonCount}
        />
      </div>
    </DialogShell>
  )
}
