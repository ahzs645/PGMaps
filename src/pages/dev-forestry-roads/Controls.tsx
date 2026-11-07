import { Children, isValidElement, type OptionHTMLAttributes, type ReactNode } from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import { FormField, NumberField as SharedNumberField, NullableNumberField } from '@/components/ui/form-field'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export const roadFieldClass =
  'w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-base md:text-xs'

export interface RoadSelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
  title?: string
  /** Text a searchable select matches when the label is not plain text. */
  searchText?: string
}

/** Lists longer than this get a filter box. */
const SEARCHABLE_FROM = 10
/** Width and flex classes size the wrapper; everything else styles the trigger. */
const LAYOUT_CLASS = /^(?:[\w-]+:)*(?:w-|min-w-|max-w-|flex-|basis-|shrink|grow|order-|self-|col-|row-)/
const textOf = (node: ReactNode): string =>
  Children.toArray(node)
    .map((part) => (typeof part === 'string' || typeof part === 'number' ? String(part) : ''))
    .join('')

/** Reads `<option>` children, so a former native select can keep its option markup. */
function optionsFromChildren(children: ReactNode): RoadSelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child) || child.type !== 'option') return []
    const label = textOf(child.props.children)
    return [
      {
        value: child.props.value === undefined ? label : String(child.props.value),
        label,
        disabled: child.props.disabled,
        title: child.props.title,
      },
    ]
  })
}

/**
 * The road page's dropdown: the shared styled select, sized like the other road fields and layered
 * above the fullscreen workspace. Pass `options`, or `<option>` children. A list longer than
 * SEARCHABLE_FROM options becomes a combobox with a filter box; `searchable` forces either way.
 */
export function RoadSelect({
  value,
  onValueChange,
  options,
  children,
  ariaLabel,
  className,
  disabled,
  title,
  searchable,
  placeholder,
  id,
}: {
  value: string
  onValueChange: (value: string) => void
  options?: readonly RoadSelectOption[]
  children?: ReactNode
  ariaLabel: string
  className?: string
  disabled?: boolean
  title?: string
  searchable?: boolean
  placeholder?: string
  id?: string
}) {
  const tokens = (className ?? '').split(/\s+/).filter(Boolean)
  const list = [...(options ?? optionsFromChildren(children))]
  return (
    <AppSelect
      id={id}
      title={title}
      className={cn(
        'min-w-0',
        tokens.filter((token) => LAYOUT_CLASS.test(token)),
      )}
      triggerClassName={cn(
        'h-8 w-full min-w-0 gap-1.5 bg-background px-2 py-1 text-base shadow-none md:text-xs [&>span]:min-w-0 [&>span]:truncate',
        tokens.filter((token) => !LAYOUT_CLASS.test(token)),
      )}
      contentClassName="z-workspace-popover text-base md:text-xs"
      triggerAriaLabel={ariaLabel}
      value={value}
      onValueChange={onValueChange}
      options={list}
      disabled={disabled}
      searchable={searchable ?? list.length > SEARCHABLE_FROM}
      placeholder={placeholder}
    />
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
