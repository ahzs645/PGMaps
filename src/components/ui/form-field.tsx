// Compatibility entry point. Generic implementations live in the toolkit; the
// select field is PG Maps' own, built on the styled dropdown rather than a
// native <select>.
import { useId, type ReactNode } from 'react'
import { FormField, type FormFieldProps } from '@pgmaps/geo-toolkit/ui/form-field'
import { StyledSelect, type StyledSelectProps } from './styled-select'

export {
  CheckboxField,
  FORM_INPUT_CLASS,
  FormField,
  NumberField,
  NullableNumberField,
} from '@pgmaps/geo-toolkit/ui/form-field'
export type {
  CheckboxFieldProps,
  FormFieldProps,
  NumberFieldProps,
  NullableNumberFieldProps,
} from '@pgmaps/geo-toolkit/ui/form-field'
export { StyledSelect } from './styled-select'
export type { StyledSelectChangeEvent, StyledSelectProps } from './styled-select'

function descriptionIds(...values: (string | undefined)[]) {
  return [...new Set(values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? []))].join(' ') || undefined
}

export type SelectFieldProps = Omit<StyledSelectProps, 'contentClassName'> &
  Omit<FormFieldProps, 'children' | 'htmlFor' | 'className'> & {
    fieldClassName?: string
    /** Classes for the dropdown's menu (`contentClassName` styles the label, as on `FormField`). */
    menuClassName?: string
    children: ReactNode
  }

/** A labelled dropdown: `FormField` around the shared `StyledSelect`. */
export function SelectField({
  label,
  hint,
  description,
  error,
  hideLabel,
  group,
  labelClassName,
  contentClassName,
  descriptionClassName,
  descriptionId,
  hintAction,
  fieldClassName,
  menuClassName,
  id,
  children,
  ...props
}: SelectFieldProps) {
  const generated = useId()
  const inputId = id ?? generated
  const helpId = descriptionId ?? `${inputId}-description`
  return (
    <FormField
      label={label}
      htmlFor={inputId}
      hint={hint}
      description={description}
      error={error}
      hideLabel={hideLabel}
      group={group}
      labelClassName={labelClassName}
      contentClassName={contentClassName}
      descriptionClassName={descriptionClassName}
      descriptionId={helpId}
      hintAction={hintAction}
      className={fieldClassName}
    >
      <StyledSelect
        {...props}
        id={inputId}
        contentClassName={menuClassName}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={descriptionIds(
          props['aria-describedby'],
          (error ?? description ?? hint) != null ? helpId : undefined,
        )}
      >
        {children}
      </StyledSelect>
    </FormField>
  )
}
