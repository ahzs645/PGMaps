import {
  Children,
  Fragment,
  isValidElement,
  useState,
  type AriaAttributes,
  type ChangeEvent,
  type OptgroupHTMLAttributes,
  type OptionHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { AppSelect, workspaceSelectContentClass, type SelectOption } from '@/components/ui/select'
import { FORM_INPUT_CLASS } from '@pgmaps/geo-toolkit/ui/form-field'
import { cn } from '@/lib/utils'

/**
 * The app's dropdown: a drop-in for a native `<select>` that opens the shared styled menu (`AppSelect`,
 * Radix) instead of the browser's. It keeps `<option>`/`<optgroup>` children and the `value` /
 * `defaultValue` / `onChange(event)` contract, so a native select converts by renaming the tag. A
 * list longer than `SEARCHABLE_FROM` options becomes a combobox with a filter box.
 *
 * Only `multiple` (or a `size` above 1) renders a real `<select>`: a styled menu picks one value.
 */

export type StyledSelectOption = SelectOption

/** Lists longer than this get a filter box. */
export const SEARCHABLE_FROM = 10

/**
 * Width, flex, grid, margin and display classes size the wrapper; everything else styles the trigger.
 * A native select is one box, so its classes mix both; the styled one splits them.
 */
export const LAYOUT_CLASS =
  /^(?:[\w-]+:)*(?:w-|min-w-|max-w-|flex-|basis-|shrink|grow|order-|self-|justify-self-|place-self-|col-|row-|-?m[trblxyse]?-|align-|(?:hidden|block|inline-block|inline|sr-only)$)/

/** Splits a select's classes into the wrapper's layout classes and the trigger's own. */
export function splitSelectClasses(className: string | undefined) {
  const tokens = (className ?? '').split(/\s+/).filter(Boolean)
  return {
    layout: tokens.filter((token) => LAYOUT_CLASS.test(token)),
    trigger: tokens.filter((token) => !LAYOUT_CLASS.test(token)),
  }
}

const textOf = (node: ReactNode): string =>
  Children.toArray(node)
    .map((part) =>
      typeof part === 'string' || typeof part === 'number'
        ? String(part)
        : isValidElement<{ children?: ReactNode }>(part)
          ? textOf(part.props.children)
          : '',
    )
    .join('')

/**
 * Reads `<option>` and `<optgroup>` children, through fragments, arrays and conditionals, so a former
 * native select keeps its option markup. Anything else is ignored, as a browser would.
 */
export function optionsFromChildren(children: ReactNode, group?: string, groupDisabled?: boolean): SelectOption[] {
  return Children.toArray(children).flatMap((child): SelectOption[] => {
    if (!isValidElement(child)) return []
    if (child.type === Fragment)
      return optionsFromChildren((child.props as { children?: ReactNode }).children, group, groupDisabled)
    if (child.type === 'optgroup') {
      const props = child.props as OptgroupHTMLAttributes<HTMLOptGroupElement>
      return optionsFromChildren(props.children, props.label ?? '', groupDisabled || props.disabled)
    }
    if (child.type !== 'option') return []
    const props = child.props as OptionHTMLAttributes<HTMLOptionElement>
    const label = props.label ?? textOf(props.children)
    return [
      {
        value: props.value === undefined ? label : String(props.value),
        label,
        disabled: groupDisabled || props.disabled || undefined,
        title: props.title,
        group,
      },
    ]
  })
}

/** What `onChange` receives: the parts of a select's change event that the app reads. */
export interface StyledSelectChangeEvent {
  target: { value: string; name: string }
  currentTarget: { value: string; name: string }
}

export interface StyledSelectProps {
  /** A list only with `multiple`; the styled menu picks one value. */
  value?: string | number | readonly string[]
  defaultValue?: string | number | readonly string[]
  /** Called like a native select's `onChange`, with `target.value` the chosen option's value. */
  onChange?: (event: StyledSelectChangeEvent) => void
  /** Called with the chosen value. */
  onValueChange?: (value: string) => void
  /** `<option>` and `<optgroup>` children, or pass `options`. */
  children?: ReactNode
  options?: readonly StyledSelectOption[]
  /**
   * Classes as a native select took them. Layout classes (width, flex, margins) go on the wrapper and
   * the rest on the trigger; an omitted class gives the shared form-input look.
   */
  className?: string
  /** Classes for the menu. */
  contentClassName?: string
  id?: string
  name?: string
  title?: string
  disabled?: boolean
  required?: boolean
  /** Shown when the value matches no option. Without it, the first option shows, as in a native select. */
  placeholder?: string
  /** Force the filter box on or off; by default lists longer than `SEARCHABLE_FROM` get one. */
  searchable?: boolean
  searchPlaceholder?: string
  /** The trigger button, e.g. for a pane's initial focus. */
  triggerRef?: Ref<HTMLButtonElement>
  /** Multi-select falls back to a native `<select>`: the styled menu picks one value. */
  multiple?: boolean
  size?: number
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: AriaAttributes['aria-invalid']
}

const single = (value: StyledSelectProps['value']) =>
  value === undefined ? undefined : typeof value === 'object' ? (value[0] ?? '') : String(value)

const changeEvent = (value: string, name = ''): StyledSelectChangeEvent => ({
  target: { value, name },
  currentTarget: { value, name },
})

/** The trigger when no class is given: the shared form input's look (`FORM_INPUT_CLASS`). */
const DEFAULT_TRIGGER_CLASS = FORM_INPUT_CLASS

export function StyledSelect({
  value,
  defaultValue,
  onChange,
  onValueChange,
  children,
  options,
  className,
  contentClassName,
  id,
  name,
  title,
  disabled,
  required,
  placeholder,
  searchable,
  searchPlaceholder,
  triggerRef,
  multiple,
  size,
  ...aria
}: StyledSelectProps) {
  const [uncontrolled, setUncontrolled] = useState(single(defaultValue))
  if (multiple || (size !== undefined && size > 1))
    return (
      <select
        {...aria}
        id={id}
        name={name}
        title={title}
        disabled={disabled}
        required={required}
        multiple={multiple}
        size={size}
        value={value}
        defaultValue={defaultValue}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          onChange?.(event)
          onValueChange?.(event.target.value)
        }}
        className={className ?? FORM_INPUT_CLASS}
      >
        {children}
      </select>
    )

  const list = options ? [...options] : optionsFromChildren(children)
  const requested = value !== undefined ? single(value) : uncontrolled
  // A native select whose value matches no option shows, and reports, its first enabled option.
  const current =
    requested !== undefined && list.some((option) => option.value === requested)
      ? requested
      : placeholder === undefined
        ? (list.find((option) => !option.disabled)?.value ?? requested ?? '')
        : (requested ?? '')
  const { layout, trigger } = splitSelectClasses(className)
  return (
    <AppSelect
      id={id}
      name={name}
      required={required}
      className={
        className === undefined ? 'flex w-full min-w-0' : cn('inline-flex min-w-0 max-w-full align-middle', layout)
      }
      plainTrigger
      triggerClassName={className === undefined ? DEFAULT_TRIGGER_CLASS : cn(trigger)}
      contentClassName={cn(workspaceSelectContentClass, contentClassName)}
      triggerAriaLabel={aria['aria-label']}
      triggerAriaLabelledBy={aria['aria-labelledby']}
      triggerAriaDescribedBy={aria['aria-describedby']}
      triggerAriaInvalid={aria['aria-invalid']}
      triggerTitle={title}
      value={current}
      onValueChange={(next) => {
        if (next === current) return
        if (value === undefined) setUncontrolled(next)
        onChange?.(changeEvent(next, name))
        onValueChange?.(next)
      }}
      options={list}
      disabled={disabled}
      searchable={searchable ?? list.length > SEARCHABLE_FROM}
      searchPlaceholder={searchPlaceholder}
      placeholder={placeholder}
      triggerRef={triggerRef}
    />
  )
}
