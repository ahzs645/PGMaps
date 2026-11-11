import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type Key,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { Search, X } from 'lucide-react'
// The toolkit module directly: the app's map-panels adapter pulls in DatasetInfo, and select.tsx imports this file.
import { SearchInput } from '@pgmaps/geo-toolkit/ui/map-panels'

/**
 * A text box driving a listbox through `aria-activedescendant`: focus stays in the box while the
 * arrow keys move a highlighted option and Enter picks it. `useSearchCombobox` holds the keyboard
 * and highlight logic; `SearchComboboxInput` and `SearchResultList` render the usual markup, and a
 * page with markup of its own spreads `inputProps` and `getOptionProps` instead.
 */

export interface UseSearchComboboxOptions<T> {
  /** The options shown, in render order. */
  items: readonly T[]
  /** Called for an enabled option picked with Enter or a click. */
  onPick: (item: T, index: number) => void
  isDisabled?: (item: T, index: number) => boolean
  /** Arrow keys, Home/End and hover pass over disabled options. Default true. */
  skipDisabled?: boolean
  /** ArrowDown on the last option goes to the first, and back. Default true; false stops at the ends. */
  loop?: boolean
  /** Home and End move to the first and last option. Default false, leaving them to the text caret. */
  homeEnd?: boolean
  /** When this value changes (usually the query), the highlight returns to the first option. */
  resetKey?: unknown
  /**
   * When the highlighted option scrolls into view: `'keyboard'` (default) after arrow keys,
   * Home/End and `setActiveIndex(…, { scroll: true })`, never under a moving pointer;
   * `'always'` also on every highlight or `resetKey` change; `false` never.
   */
  scrollIntoView?: 'keyboard' | 'always' | false
  /** Moving the pointer over an option highlights it. Default false. */
  activateOnHover?: boolean
  /** `aria-expanded` on the box. Default true. */
  expanded?: boolean
  /** The listbox id; option ids are `${id}-${index}`. Default `useId()`. */
  id?: string
}

export interface SearchOptionState {
  index: number
  active: boolean
  disabled: boolean
}

export interface SearchComboboxInputProps {
  role: 'combobox'
  'aria-autocomplete': 'list'
  'aria-expanded': boolean
  'aria-controls': string
  'aria-activedescendant': string | undefined
  autoComplete: 'off'
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export interface SearchOptionProps {
  id: string
  role: 'option'
  'aria-selected': boolean
  'aria-disabled': true | undefined
  'data-active': true | undefined
  onClick: () => void
  onPointerMove?: () => void
}

export interface SearchCombobox<T> {
  items: readonly T[]
  listId: string
  /** The highlighted option, or -1 when there is none. */
  activeIndex: number
  activeId: string | undefined
  optionId: (index: number) => string
  isDisabled: (index: number) => boolean
  setActiveIndex: (index: number, options?: { scroll?: boolean }) => void
  /** Highlight the first option (the first enabled one when skipping disabled options). */
  resetActive: () => void
  /** Pick the option at `index` unless it is disabled. */
  pick: (index: number) => void
  /** Arrow keys, Home/End and Enter. Returns true when it handled the key (and prevented its default). */
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean
  /** Spread on the text box. */
  inputProps: SearchComboboxInputProps
  /** Spread on the listbox. */
  listProps: { id: string; role: 'listbox' }
  /** Spread on an option; `selected` overrides `aria-selected` (a select marks its chosen value). */
  getOptionProps: (index: number, options?: { selected?: boolean }) => SearchOptionProps
}

const FIRST = -2

export function useSearchCombobox<T>({
  items,
  onPick,
  isDisabled: isItemDisabled,
  skipDisabled = true,
  loop = true,
  homeEnd = false,
  resetKey,
  scrollIntoView = 'keyboard',
  activateOnHover = false,
  expanded = true,
  id,
}: UseSearchComboboxOptions<T>): SearchCombobox<T> {
  const generatedId = useId()
  const listId = id ?? generatedId
  const [requested, setRequested] = useState(FIRST)
  const [scrollTick, setScrollTick] = useState(0)
  const [previousKey, setPreviousKey] = useState(resetKey)
  if (!Object.is(previousKey, resetKey)) {
    setPreviousKey(resetKey)
    setRequested(FIRST)
  }

  const count = items.length
  const isDisabled = (index: number) => Boolean(isItemDisabled?.(items[index], index))
  const skippable = (index: number) => skipDisabled && isDisabled(index)
  const firstFrom = (start: number, step: 1 | -1) => {
    for (let index = start; index >= 0 && index < count; index += step) if (!skippable(index)) return index
    return count ? start : -1
  }
  const activeIndex = requested === FIRST ? firstFrom(0, 1) : Math.min(requested, count - 1)
  const optionId = (index: number) => `${listId}-${index}`
  const activeId = activeIndex >= 0 ? optionId(activeIndex) : undefined

  // 'always' follows the highlight and the reset key; 'keyboard' only the scroll requests.
  const handled = useRef(scrollTick)
  const followedKey = scrollIntoView === 'always' ? resetKey : undefined
  useEffect(() => {
    if (!scrollIntoView || !activeId || typeof document === 'undefined') return
    if (scrollIntoView === 'keyboard' && handled.current === scrollTick) return
    handled.current = scrollTick
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId, scrollIntoView, scrollTick, followedKey])

  const setActiveIndex = (index: number, options?: { scroll?: boolean }) => {
    setRequested(index)
    if (options?.scroll) setScrollTick((tick) => tick + 1)
  }
  const step = (from: number, direction: 1 | -1) => {
    let next = from
    for (let tries = 0; tries < count; tries++) {
      let candidate = next + direction
      if (loop) candidate = (candidate + count) % count
      else if (candidate < 0 || candidate >= count) break
      next = candidate
      if (!skippable(next)) return next
    }
    return from
  }
  const pick = (index: number) => {
    if (index < 0 || index >= count || isDisabled(index)) return
    onPick(items[index], index)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || !count) return false
    let next: number
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') next = step(activeIndex, event.key === 'ArrowUp' ? -1 : 1)
    else if (homeEnd && event.key === 'Home') next = firstFrom(0, 1)
    else if (homeEnd && event.key === 'End') next = firstFrom(count - 1, -1)
    else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      pick(activeIndex)
      return true
    } else return false
    event.preventDefault()
    setActiveIndex(next, { scroll: true })
    return true
  }

  return {
    items,
    listId,
    activeIndex,
    activeId,
    optionId,
    isDisabled,
    setActiveIndex,
    resetActive: () => setRequested(FIRST),
    pick,
    handleKeyDown,
    inputProps: {
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': expanded,
      'aria-controls': listId,
      'aria-activedescendant': activeId,
      autoComplete: 'off',
      onKeyDown: (event) => void handleKeyDown(event),
    },
    listProps: { id: listId, role: 'listbox' },
    getOptionProps: (index, options) => {
      const active = index === activeIndex
      return {
        id: optionId(index),
        role: 'option',
        'aria-selected': options?.selected ?? active,
        'aria-disabled': isDisabled(index) || undefined,
        'data-active': active || undefined,
        onClick: () => pick(index),
        onPointerMove: activateOnHover
          ? () => {
              if (index !== activeIndex && !skippable(index)) setRequested(index)
            }
          : undefined,
      }
    },
  }
}

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'role' | 'type'>

export interface SearchComboboxFieldProps extends NativeInputProps {
  combobox: Pick<SearchCombobox<unknown>, 'inputProps'>
  /**
   * `'field'` (default) is the shared sidebar `SearchInput`: bordered, 16px on phones, and the
   * target of the map search shortcut unless it is given `data-map-search-input="false"`.
   * `'bare'` is a borderless box for a palette or dialog header: `icon`, the input and the
   * clear/close buttons in a row styled by `boxClassName`. It never takes the map shortcut.
   */
  variant?: 'field' | 'bare'
  /** `'field'`: show the magnifier. `'bare'`: the leading node (default a magnifier); `false` for none. */
  icon?: ReactNode
  /** Show a clear button while the box has a value. */
  onClear?: () => void
  clearLabel?: string
  /** `'bare'`: an always-shown close button. */
  onClose?: () => void
  closeLabel?: string
  /** `'bare'`: classes for the clear and close buttons. */
  buttonClassName?: string
  /** `'bare'`: the icon inside the clear and close buttons. */
  buttonIcon?: ReactNode
  /** `'field'`: the wrapper's classes. `'bare'`: the row's classes. */
  boxClassName?: string
}

/** The search box of a combobox: the hook's ARIA and keys on the shared field or a bare row. */
export const SearchComboboxInput = forwardRef<HTMLInputElement, SearchComboboxFieldProps>(function SearchComboboxInput(
  {
    combobox,
    variant = 'field',
    icon,
    onClear,
    clearLabel = 'Clear search',
    onClose,
    closeLabel = 'Close search',
    buttonClassName,
    buttonIcon,
    boxClassName,
    onKeyDown,
    ...props
  },
  ref,
) {
  const { onKeyDown: comboboxKeyDown, ...aria } = combobox.inputProps
  const inputProps = {
    ...aria,
    ...props,
    // The list's keys first, then the page's own (Escape, blur after a pick).
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      comboboxKeyDown(event)
      onKeyDown?.(event)
    },
  }
  if (variant === 'field') {
    return (
      <SearchInput ref={ref} icon={Boolean(icon)} onClear={onClear} wrapperClassName={boxClassName} {...inputProps} />
    )
  }
  const hasValue = props.value != null && String(props.value) !== ''
  const button = (label: string, onClick: () => void) => (
    <button type="button" aria-label={label} onClick={onClick} className={buttonClassName}>
      {buttonIcon ?? <X className="h-4 w-4" aria-hidden="true" />}
    </button>
  )
  return (
    <div className={boxClassName}>
      {icon === undefined ? <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : icon}
      <input ref={ref} type="text" {...inputProps} />
      {onClear && hasValue && button(clearLabel, onClear)}
      {onClose && button(closeLabel, onClose)}
    </div>
  )
})

export interface SearchResultListProps<T> {
  combobox: SearchCombobox<T>
  getKey: (item: T, index: number) => Key
  /** An option's content: `SearchResultContent` for an icon, title and secondary line, or your own. */
  renderOption: (item: T, state: SearchOptionState) => ReactNode
  /** Consecutive options with the same group share a heading, in a `role="group"` named by it. */
  getGroup?: (item: T) => string | undefined
  groupHeadingClassName?: string
  optionClassName?: string | ((state: SearchOptionState) => string | undefined)
  /** Marks an option `aria-selected` by its value rather than the highlight (a select's choice). */
  isSelected?: (item: T) => boolean
  /** Extra attributes for an option (`title`, `data-value`). */
  optionAttributes?: (item: T, index: number) => HTMLAttributes<HTMLElement> & Record<`data-${string}`, unknown>
  /** `ul` renders `li` options. */
  as?: 'div' | 'ul'
  /** The option element. Default `li` in a `ul`, else `div`. */
  optionAs?: 'div' | 'li' | 'button'
  /** Clicking an option leaves focus in the box (a dropdown that closes when the box blurs). */
  keepInputFocus?: boolean
  /** Shown inside the listbox when there are no options (an empty or loading note). */
  empty?: ReactNode
  className?: string
  'aria-label'?: string
}

/** The listbox of a combobox, optionally grouped under headings. */
export function SearchResultList<T>({
  combobox,
  getKey,
  renderOption,
  getGroup,
  groupHeadingClassName,
  optionClassName,
  isSelected,
  optionAttributes,
  as: List = 'div',
  optionAs,
  keepInputFocus = false,
  empty,
  className,
  'aria-label': ariaLabel,
}: SearchResultListProps<T>) {
  const Option = optionAs ?? (List === 'ul' ? 'li' : 'div')
  const { items, listProps, getOptionProps, activeIndex, isDisabled } = combobox
  const preventBlur = keepInputFocus ? (event: MouseEvent) => event.preventDefault() : undefined
  const option = (item: T, index: number) => {
    const state = { index, active: index === activeIndex, disabled: isDisabled(index) }
    return (
      <Option
        key={getKey(item, index)}
        {...(Option === 'button' ? { type: 'button' as const } : {})}
        {...optionAttributes?.(item, index)}
        {...getOptionProps(index, isSelected ? { selected: isSelected(item) } : undefined)}
        onMouseDown={preventBlur}
        className={typeof optionClassName === 'function' ? optionClassName(state) : optionClassName}
      >
        {renderOption(item, state)}
      </Option>
    )
  }
  const runs: { group: string | undefined; entries: { item: T; index: number }[] }[] = []
  items.forEach((item, index) => {
    const group = getGroup?.(item)
    const last = runs.at(-1)
    if (last && last.group === group) last.entries.push({ item, index })
    else runs.push({ group, entries: [{ item, index }] })
  })
  return (
    <List {...listProps} aria-label={ariaLabel} className={className}>
      {!items.length && empty}
      {runs.map((run, runIndex) => {
        const rows = run.entries.map(({ item, index }) => option(item, index))
        if (run.group === undefined) return rows
        const headingId = `${listProps.id}-group-${runIndex}`
        const Group = List === 'ul' ? 'li' : 'div'
        return (
          <Group key={headingId} role="group" aria-labelledby={headingId}>
            <div id={headingId} className={groupHeadingClassName}>
              {run.group}
            </div>
            {List === 'ul' ? <ul role="presentation">{rows}</ul> : rows}
          </Group>
        )
      })}
    </List>
  )
}

/** An option's usual content: an icon, a one-line title and a secondary line, both truncated. */
export function SearchResultContent({
  icon,
  title,
  detail,
  trailing,
}: {
  icon?: ReactNode
  title: ReactNode
  detail?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {detail != null && <div className="truncate text-xs text-muted-foreground">{detail}</div>}
      </div>
      {trailing}
    </>
  )
}
