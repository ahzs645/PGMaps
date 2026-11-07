import { createElement, type ReactNode } from 'react'
import type { RoadSelectOption } from './Controls'

/**
 * Stands in for `RoadSelect` in renderer tests, which run without a DOM: a plain `<select>` with the
 * same accessible name, so a test can call `onChange({ target: { value } })` as it would on the field.
 */
export function RoadSelectTestDouble(props: {
  ariaLabel?: string
  'aria-label'?: string
  value: string
  onValueChange: (value: string) => void
  options?: readonly RoadSelectOption[]
  children?: ReactNode
  disabled?: boolean
}) {
  return createElement(
    'select',
    {
      'aria-label': props['aria-label'] ?? props.ariaLabel,
      value: props.value,
      disabled: props.disabled,
      onChange: (event: { target: { value: string } }) => props.onValueChange(event.target.value),
    },
    props.children ??
      props.options?.map((option) => createElement('option', { key: option.value, value: option.value }, option.label)),
  )
}
