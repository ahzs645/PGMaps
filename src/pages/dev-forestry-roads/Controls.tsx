import type { ReactNode } from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import { FormField, NumberField as SharedNumberField, NullableNumberField } from '@/components/ui/form-field'

export const roadFieldClass =
  'w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-base md:text-xs'

function hintAction(label: string, hint?: ReactNode) {
  return hint ? (
    <InfoTip label={`About ${label}`} className="absolute -top-0.5 right-0">
      {hint}
    </InfoTip>
  ) : undefined
}

export function Field({
  label,
  children,
  hideLabel = false,
  hint,
}: {
  label: string
  children: ReactNode
  hideLabel?: boolean
  hint?: ReactNode
}) {
  return (
    <FormField label={label} hideLabel={hideLabel} hintAction={hintAction(label, hint)}>
      {children}
    </FormField>
  )
}

export function NumberField({
  label,
  ariaLabel,
  value,
  onChange,
  min = 0,
  max = 100000,
  step = 0.1,
  disabled = false,
  hideLabel = false,
  hint,
}: {
  label: string
  ariaLabel?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  hideLabel?: boolean
  hint?: ReactNode
}) {
  return (
    <SharedNumberField
      label={label}
      aria-label={ariaLabel}
      value={value}
      onValueChange={onChange}
      min={min}
      max={max}
      step={step}
      precision={6}
      stepMode="increment"
      disabled={disabled}
      hideLabel={hideLabel}
      inputClassName={roadFieldClass}
      hintAction={hintAction(label, hint)}
    />
  )
}

/** An empty field remains null ("not checked"), never zero. */
export function OptionalNumberField({
  label,
  value,
  onChange,
  min = -100000,
  max = 100000,
  step = 0.1,
  placeholder = 'off',
  hideLabel = false,
  hint,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  hideLabel?: boolean
  hint?: ReactNode
}) {
  return (
    <NullableNumberField
      label={label}
      value={value}
      onValueChange={onChange}
      min={min}
      max={max}
      step={step}
      precision={6}
      stepMode="increment"
      placeholder={placeholder}
      hideLabel={hideLabel}
      inputClassName={roadFieldClass}
      hintAction={hintAction(label, hint)}
    />
  )
}
