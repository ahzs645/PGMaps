import type { ReactNode } from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import {
  FormField,
  NativeSelect,
  NumberField as SharedNumberField,
  NullableNumberField,
} from '@/components/ui/form-field'
import { cn } from '@/lib/utils'

export const roadFieldClass =
  'w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-base md:text-xs'

export interface RoadSelectOption {
  value: string
  label: string
  disabled?: boolean
  title?: string
}

/**
 * The road page's dropdown: always the browser's own select, so it opens as the platform menu (a wheel on
 * phones), works with the keyboard as people expect and is never clipped by a pane. Classes size the field.
 */
export function RoadSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
  disabled,
  title,
}: {
  value: string
  onValueChange: (value: string) => void
  options: readonly RoadSelectOption[]
  ariaLabel: string
  className?: string
  disabled?: boolean
  title?: string
}) {
  return (
    <NativeSelect
      aria-label={ariaLabel}
      title={title}
      className={cn(roadFieldClass, 'py-1', className)}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled} title={option.title}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  )
}

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
  precision = 6,
  inputClassName = roadFieldClass,
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
  /** Decimals shown; an untouched field keeps its full stored value. */
  precision?: number
  inputClassName?: string
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
      precision={precision}
      stepMode="increment"
      disabled={disabled}
      hideLabel={hideLabel}
      inputClassName={inputClassName}
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
