import {
  Children,
  isValidElement,
  useState,
  type FormEvent,
  type OptionHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import { FormField, NumberField as SharedNumberField, NullableNumberField } from '@/components/ui/form-field'
import { AppSelect, compactSelectTriggerClass, workspaceSelectContentClass } from '@/components/ui/select'
import { engineeringCellInputClass } from '@/components/ui/engineering-table'
import { cn } from '@/lib/utils'

/**
 * A road text or number field. Single-line fields share the dropdown's 32 px height from `md` up, so an
 * input, a select and a `h-8` button line up in a row; textareas keep their own height.
 */
export const roadFieldClass =
  'w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-base md:text-xs md:[&:not(textarea)]:h-8'

export interface RoadSelectOption {
  value: string
  label: ReactNode
  /** What the closed trigger shows, when it should be shorter than the list's label. */
  selectedLabel?: ReactNode
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
  triggerRef,
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
  /** The trigger button, e.g. for a pane's initial focus. */
  triggerRef?: Ref<HTMLButtonElement>
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
        compactSelectTriggerClass,
        tokens.filter((token) => !LAYOUT_CLASS.test(token)),
      )}
      contentClassName={workspaceSelectContentClass}
      triggerAriaLabel={ariaLabel}
      value={value}
      onValueChange={onValueChange}
      options={list}
      disabled={disabled}
      searchable={searchable ?? list.length > SEARCHABLE_FROM}
      placeholder={placeholder}
      triggerRef={triggerRef}
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

// A minus sign, not a hyphen: "−1,000 to 1,000", as the tool writes signed values everywhere.
const limitText = (value: number) =>
  Number(value.toFixed(6)).toLocaleString('en-CA', { maximumFractionDigits: 6 }).replace('-', '−')

/**
 * What a number field says about a typed value outside its range: the allowed range while it is
 * being typed (the value is not applied yet), then what it was changed to once the field applies
 * its limit on blur or Enter. A value is never adjusted without saying so beside the field.
 */
export function useRangeNote(value: number | null, min: number, max: number) {
  const [typed, setTyped] = useState<{ entered: number; from: number | null } | null>(null)
  const onInput = (event: FormEvent<HTMLInputElement>) => {
    const text = event.currentTarget.value
    const entered = text.trim() ? Number(text) : NaN
    setTyped(Number.isFinite(entered) && (entered < min || entered > max) ? { entered, from: value } : null)
  }
  if (!typed) return { onInput }
  const limit = typed.entered < min ? min : max
  const range = `${limitText(min)} to ${limitText(max)}`
  if (value === limit && typed.from !== limit)
    return {
      onInput,
      adjusted: `${limitText(typed.entered)} is outside ${range}, so it was changed to ${limitText(limit)}.`,
    }
  if (value === typed.from) return { onInput, outOfRange: `Enter ${range}.` }
  return { onInput }
}

export function NumberField({
  label,
  ariaLabel,
  value,
  onChange,
  updateOn,
  min = 0,
  max = 100000,
  step = 0.1,
  disabled = false,
  hideLabel = false,
  hint,
  precision = 6,
  fixedDecimals,
  inputClassName = roadFieldClass,
  error,
  clampOn,
}: {
  label: string
  ariaLabel?: string
  value: number
  onChange: (value: number) => void
  updateOn?: 'change' | 'commit'
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  hideLabel?: boolean
  hint?: ReactNode
  /** Why the entered value cannot be calculated; shown under the field in place of a range note. */
  error?: ReactNode
  /** Decimals shown; an untouched field keeps its full stored value. */
  precision?: number
  /** Show all `precision` decimals (`283.00`), for a column that lines up. */
  fixedDecimals?: boolean
  inputClassName?: string
  /**
   * `never` keeps a typed value outside min–max instead of changing it to the nearer limit; the
   * caller then refuses to use it and says why through `error`.
   */
  clampOn?: 'commit' | 'never'
}) {
  const note = useRangeNote(value, min, max)
  return (
    <SharedNumberField
      label={label}
      aria-label={ariaLabel}
      value={value}
      onValueChange={onChange}
      updateOn={updateOn}
      onInput={note.onInput}
      min={min}
      max={max}
      step={step}
      precision={precision}
      fixedDecimals={fixedDecimals}
      stepMode="increment"
      clampOn={clampOn}
      disabled={disabled}
      hideLabel={hideLabel}
      inputClassName={inputClassName}
      hintAction={hintAction(label, hint)}
      error={error ?? note.outOfRange}
      description={note.adjusted && <span role="status">{note.adjusted}</span>}
    />
  )
}

/** An empty field remains null ("not checked"), never zero. */
/**
 * A number edited in place inside an `EngineeringTable` cell. The column header names it, so the
 * label is for assistive technology only. Values show all `precision` decimals so the column lines
 * up; `fixedDecimals={false}` drops trailing zeros where a column's values vary in scale.
 */
export function CellNumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  precision = 2,
  fixedDecimals = true,
  disabled,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  precision?: number
  fixedDecimals?: boolean
  disabled?: boolean
}) {
  return (
    <NumberField
      label={label}
      hideLabel
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
      precision={precision}
      fixedDecimals={fixedDecimals}
      disabled={disabled}
      inputClassName={engineeringCellInputClass}
    />
  )
}

export function OptionalNumberField({
  label,
  value,
  onChange,
  updateOn,
  min = -100000,
  max = 100000,
  step = 0.1,
  placeholder = 'off',
  hideLabel = false,
  disabled = false,
  hint,
  error,
  description,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  updateOn?: 'change' | 'commit'
  min?: number
  max?: number
  step?: number
  placeholder?: string
  hideLabel?: boolean
  disabled?: boolean
  hint?: ReactNode
  error?: ReactNode
  /** A standing line under the field, such as what a blank value means. */
  description?: ReactNode
}) {
  const note = useRangeNote(value, min, max)
  return (
    <NullableNumberField
      label={label}
      value={value}
      onValueChange={onChange}
      updateOn={updateOn}
      onInput={note.onInput}
      error={error ?? note.outOfRange}
      description={note.adjusted ? <span role="status">{note.adjusted}</span> : description}
      min={min}
      max={max}
      step={step}
      precision={6}
      stepMode="increment"
      placeholder={placeholder}
      hideLabel={hideLabel}
      disabled={disabled}
      inputClassName={roadFieldClass}
      hintAction={hintAction(label, hint)}
    />
  )
}
