import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, FORM_INPUT_CLASS } from '@/components/ui/form-field'
import type { ComparisonSnapshot } from './comparison'
import { errorMessage } from './useLatestRequest'

interface CaptureAction {
  label: string
  create: (label?: string) => ComparisonSnapshot
  disabled?: boolean
}

/**
 * Save the open analysis for comparison, with an optional name, and open the collection. Source adapters
 * decide which inputs and metrics belong in the snapshot. Renders nothing without `onCapture`.
 */
export function ComparisonCapture({
  actions,
  onCapture,
  onOpen,
  count = 0,
  nameLabel = 'Comparison name',
  namePlaceholder = 'Use a name generated from this analysis',
  description = 'Optional. Saved results keep the settings used when captured.',
  openLabel = 'View comparisons',
}: {
  actions: CaptureAction[]
  onCapture?: (snapshot: ComparisonSnapshot) => void
  onOpen?: () => void
  count?: number
  nameLabel?: string
  namePlaceholder?: string
  description?: ReactNode
  /** The open button reads `<openLabel> (<count>)`. */
  openLabel?: string
}) {
  const [label, setLabel] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  if (!onCapture) return null
  function capture(action: CaptureAction) {
    setError('')
    try {
      const snapshot = action.create(label.trim() || undefined)
      onCapture!(snapshot)
      setSaved(snapshot.label)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <FormField label={nameLabel} description={description}>
        <input
          className={FORM_INPUT_CLASS}
          value={label}
          maxLength={200}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={namePlaceholder}
        />
      </FormField>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button key={action.label} variant="outline" disabled={action.disabled} onClick={() => capture(action)}>
            {action.label}
          </Button>
        ))}
        {onOpen && (
          <Button variant="outline" disabled={count === 0} onClick={onOpen}>
            {openLabel} ({count})
          </Button>
        )}
      </div>
      {saved && (
        <p role="status" className="text-sm">
          Saved for comparison: {saved}.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
