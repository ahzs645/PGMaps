import type { InputHTMLAttributes } from 'react'

import { TextButton } from '@/components/ui/text-button'

import { designationText, nameWithDesignation } from './profile'
import { useBranding } from './useBranding'

/**
 * A field that names a person (*Checked by*, *Assessor*, *Reviewer*): a plain text box, with a link under it that
 * puts in the name from *Your details*. The link only fills on a click and the box stays the record's own, so
 * someone else's name can be typed, and a filled-in name swapped for yours with *Use mine instead*.
 */
export function PersonInput({
  value,
  onValueChange,
  withDesignation = false,
  maxLength,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
  /** Fill "J. Smith, RPF #4521" rather than the name alone. */
  withDesignation?: boolean
}) {
  const { profile } = useBranding()
  const mine = profile
    ? withDesignation
      ? nameWithDesignation(profile.name, designationText(profile))
      : profile.name.trim()
    : ''
  const fitted = maxLength != null ? mine.slice(0, maxLength) : mine
  const offer = fitted && value.trim() !== fitted
  return (
    <span className="grid min-w-0 gap-0.5">
      <input {...input} maxLength={maxLength} value={value} onChange={(event) => onValueChange(event.target.value)} />
      {offer && !input.disabled && (
        <TextButton
          className="justify-self-start text-2xs"
          data-testid="person-input-use-mine"
          aria-label={`${value.trim() ? 'Replace with' : 'Fill in'} your name, ${fitted}`}
          onClick={(event) => {
            // Inside a label the click must not also go to the input.
            event.preventDefault()
            onValueChange(fitted)
          }}
        >
          {value.trim() ? `Use mine instead (${fitted})` : `Use mine (${fitted})`}
        </TextButton>
      )}
    </span>
  )
}
