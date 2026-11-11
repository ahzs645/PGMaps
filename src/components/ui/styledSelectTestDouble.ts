import { createElement } from 'react'
import type { StyledSelectProps } from './styled-select'

/**
 * Stands in for `StyledSelect` in tests that render to static markup or without a DOM, where a closed
 * styled menu renders no options: a plain `<select>` with the same props and `<option>` children.
 * Mock the module with it: `vi.mock('@/components/ui/styled-select', async (actual) => ({ ...(await
 * actual()), StyledSelect: StyledSelectTestDouble }))`.
 */
export function StyledSelectTestDouble({
  onChange,
  onValueChange,
  options,
  children,
  contentClassName: _contentClassName,
  placeholder: _placeholder,
  searchable: _searchable,
  searchPlaceholder: _searchPlaceholder,
  triggerRef: _triggerRef,
  ...props
}: StyledSelectProps) {
  return createElement(
    'select',
    {
      ...props,
      onChange: (event: { target: { value: string; name?: string } }) => {
        const target = { value: event.target.value, name: event.target.name ?? props.name ?? '' }
        onChange?.({ target, currentTarget: target })
        onValueChange?.(target.value)
      },
    },
    children ??
      options?.map((option) => createElement('option', { key: option.value, value: option.value }, option.label)),
  )
}
