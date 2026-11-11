import { useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import { FormField, NumberField as SharedNumberField, NullableNumberField } from '@/components/ui/form-field'
import { AppSelect, compactSelectTriggerClass, workspaceSelectContentClass } from '@/components/ui/select'
import {
  SEARCHABLE_FROM,
  optionsFromChildren,
  splitSelectClasses,
  type StyledSelectOption,
} from '@/components/ui/styled-select'
import { engineeringCellInputClass } from '@/components/ui/engineering-table'
import { cn } from '@/lib/utils'

/**
 * A road text or number field. Single-line fields share the dropdown's 32 px height from `md` up, so an
 * input, a select and a `h-8` button line up in a row; textareas keep their own height.
 */
export const roadFieldClass =
  'w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-base md:text-xs md:[&:not(textarea)]:h-8'

export type RoadSelectOption = Omit<StyledSelectOption, 'group'>

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
  const { layout, trigger } = splitSelectClasses(className)
  const list = [...(options ?? optionsFromChildren(children))]
  return (
    <AppSelect
      id={id}
      title={title}
      className={cn('min-w-0', layout)}
      triggerClassName={cn(compactSelectTriggerClass, trigger)}
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
    <InfoTip label={`About ${label}`} className="road-field-hint absolute -top-0.5 right-0">
      {hint}
    </InfoTip>
  ) : undefined
}

/**
 * A label that ends in a short unit, "Grade limit (%)" or "Cut ($/m³)", shows the unit inside the
 * field's box instead. The input keeps the whole label as its name, so assistive technology and
 * `getByLabel` read it unchanged. Bracketed words such as "(optional)" are not units.
 */
export function splitUnit(label: string): { text: string; unit: string } | null {
  const match = /^(.*\S)\s*\(([^\s()]{1,6})\)$/.exec(label)
  return match ? { text: match[1], unit: match[2] } : null
}

/** The bordered box, its borderless input and the unit inside it (`splitUnit`). */
const unitRowClass =
  'road-unit-field flex w-full min-w-0 items-center rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring md:h-8'
const unitInputClass =
  'w-full min-w-0 flex-1 border-0 bg-transparent px-2 py-1.5 text-base outline-none md:h-full md:text-xs'
const unitClass = 'pointer-events-none shrink-0 pr-2 text-xs text-muted-foreground'

/** Label, name and box props for a road number field, with the unit inside the box when it has one. */
function unitProps(label: string, ariaLabel: string | undefined, hideLabel: boolean, inputClassName: string) {
  const split = !hideLabel && inputClassName === roadFieldClass ? splitUnit(label) : null
  if (!split) return { label, 'aria-label': ariaLabel, inputClassName }
  return {
    label: split.text,
    'aria-label': ariaLabel ?? label,
    unit: split.unit,
    rowClassName: unitRowClass,
    inputClassName: unitInputClass,
    unitClassName: unitClass,
  }
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
      {...unitProps(label, ariaLabel, hideLabel, inputClassName)}
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
      {...unitProps(label, undefined, hideLabel, roadFieldClass)}
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
      hintAction={hintAction(label, hint)}
    />
  )
}
