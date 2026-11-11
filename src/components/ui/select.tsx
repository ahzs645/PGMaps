'use client'

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      data-floating-layer=""
      className={cn(
        'relative z-menu max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className,
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn('px-2 py-1.5 text-sm font-semibold', className)} {...props} />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

type SelectOption = {
  value: string
  label: React.ReactNode
  selectedLabel?: React.ReactNode
  disabled?: boolean
  title?: string
  /** Text a searchable select matches; defaults to the label when it is a string. */
  searchText?: string
}

type AppSelectProps = {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  triggerClassName?: string
  contentClassName?: string
  triggerAriaLabel?: string
  id?: string
  disabled?: boolean
  /** Adds a filter box: the menu becomes a combobox, for lists too long to scan. */
  searchable?: boolean
  searchPlaceholder?: string
  /** The trigger button, e.g. for a pane's initial focus. */
  triggerRef?: React.Ref<HTMLButtonElement>
}

/** A compact trigger sized like a 32 px workspace field (road designer, ribbon panes). */
const compactSelectTriggerClass =
  'h-8 w-full min-w-0 gap-1.5 bg-background px-2 py-1 text-base shadow-none md:text-xs [&>span]:min-w-0 [&>span]:truncate'
/** Menu content for a compact select that may open inside a fullscreen workspace or its dialogs. */
const workspaceSelectContentClass = 'z-workspace-popover text-base md:text-xs'

const EMPTY_SELECT_VALUE = '__app_select_empty__'

/**
 * What a list of options draws, as a key: equal keys draw the same menu. Null when a label is not
 * plain text, which only the option list itself can stand for.
 */
function optionsKey(options: readonly SelectOption[], contentClassName: string | undefined): string | null {
  const parts: unknown[] = [contentClassName ?? '']
  for (const option of options) {
    if (typeof option.label !== 'string' && typeof option.label !== 'number') return null
    parts.push(option.value, option.label, !!option.disabled, option.title ?? '')
  }
  return JSON.stringify(parts)
}

/**
 * The options the menu was last drawn from while they draw the same menu. Radix renders a closed
 * select's whole item list on every render (it reads the items for the trigger's typeahead), and
 * callers build `options` afresh each render, so without this a page that re-renders often (the
 * road designer's station hover) re-renders thousands of menu items it cannot show.
 */
function useHeldOptions(options: SelectOption[], contentClassName: string | undefined) {
  const key = optionsKey(options, contentClassName)
  const [held, setHeld] = React.useState({ key, options, contentClassName })
  if (key === null) return { options, contentClassName }
  if (held.key !== key) {
    setHeld({ key, options, contentClassName })
    return { options, contentClassName }
  }
  return held
}

function AppSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  triggerClassName,
  contentClassName,
  triggerAriaLabel,
  id,
  disabled,
  searchable,
  searchPlaceholder,
  triggerRef,
  ...props
}: AppSelectProps & React.HTMLAttributes<HTMLDivElement>) {
  if (searchable)
    return (
      <div className={className} {...props}>
        <SearchableSelect
          value={value}
          onValueChange={onValueChange}
          options={options}
          placeholder={placeholder}
          triggerClassName={triggerClassName}
          contentClassName={contentClassName}
          triggerAriaLabel={triggerAriaLabel}
          id={id}
          disabled={disabled}
          searchPlaceholder={searchPlaceholder}
          triggerRef={triggerRef}
        />
      </div>
    )
  return (
    <div className={className} {...props}>
      <PlainSelect
        value={value}
        onValueChange={onValueChange}
        options={options}
        placeholder={placeholder}
        triggerClassName={triggerClassName}
        contentClassName={contentClassName}
        triggerAriaLabel={triggerAriaLabel}
        id={id}
        disabled={disabled}
        triggerRef={triggerRef}
      />
    </div>
  )
}

function PlainSelect({
  value,
  onValueChange,
  options,
  placeholder,
  triggerClassName,
  contentClassName,
  triggerAriaLabel,
  id,
  disabled,
  triggerRef,
}: Omit<AppSelectProps, 'className' | 'searchable' | 'searchPlaceholder'>) {
  const hasEmptyOption = options.some((option) => option.value === '')
  const radixValue = hasEmptyOption && value === '' ? EMPTY_SELECT_VALUE : value
  const selectedOption = options.find((option) => option.value === value)
  const selectedLabel = selectedOption?.selectedLabel ?? selectedOption?.label
  // A stable handler keeps Radix's select context unchanged across renders, so the held menu
  // below is skipped rather than re-rendered; it always calls the caller's latest handler.
  const latestChange = React.useRef(onValueChange)
  React.useLayoutEffect(() => {
    latestChange.current = onValueChange
  })
  const change = React.useCallback(
    (nextValue: string) => latestChange.current(nextValue === EMPTY_SELECT_VALUE ? '' : nextValue),
    [],
  )
  const menu = useHeldOptions(options, contentClassName)
  const content = React.useMemo(
    () => (
      <SelectContent className={menu.contentClassName}>
        {menu.options.map((option) => (
          <SelectItem
            key={option.value || EMPTY_SELECT_VALUE}
            value={option.value === '' ? EMPTY_SELECT_VALUE : option.value}
            disabled={option.disabled}
            title={option.title}
            data-value={option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    ),
    [menu.options, menu.contentClassName],
  )

  return (
    <Select value={radixValue} onValueChange={change} disabled={disabled}>
      <SelectTrigger
        ref={triggerRef}
        id={id}
        className={triggerClassName}
        aria-label={triggerAriaLabel}
        data-value={value}
      >
        <SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
      </SelectTrigger>
      {content}
    </Select>
  )
}

const optionText = (option: SelectOption) =>
  option.searchText ?? (typeof option.label === 'string' ? option.label : String(option.value))

/**
 * The searchable form of `AppSelect`: the same trigger, with a filter box over the list. Built on
 * Radix Popover so it layers, traps focus and dismisses correctly inside dialogs. The box is an
 * ARIA combobox driving a listbox; arrows move, Enter picks, Escape closes and returns focus.
 */
function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  triggerClassName,
  contentClassName,
  triggerAriaLabel,
  id,
  disabled,
  searchPlaceholder = 'Search…',
  triggerRef,
}: Omit<AppSelectProps, 'className' | 'searchable'>) {
  const listId = React.useId()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  // Only keyboard moves scroll the list; scrolling under a moving pointer would chase it.
  const scrollToActive = React.useRef(false)
  const selected = options.find((option) => option.value === value)
  const needle = query.trim().toLowerCase()
  const shown = needle ? options.filter((option) => optionText(option).toLowerCase().includes(needle)) : options
  const changeOpen = (next: boolean) => {
    if (next) {
      setQuery('')
      scrollToActive.current = true
      setActive(
        Math.max(
          0,
          options.findIndex((option) => option.value === value),
        ),
      )
    }
    setOpen(next)
  }
  React.useEffect(() => {
    if (!open || !scrollToActive.current) return
    scrollToActive.current = false
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, listId, open])
  const pick = (option: SelectOption | undefined) => {
    if (!option || option.disabled) return
    onValueChange(option.value)
    setOpen(false)
  }
  const move = (step: number) => {
    if (!shown.length) return
    scrollToActive.current = true
    let next = active
    for (let tries = 0; tries < shown.length; tries++) {
      next = (next + step + shown.length) % shown.length
      if (!shown[next].disabled) break
    }
    setActive(next)
  }
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={changeOpen}>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-label={triggerAriaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          data-value={value}
          onKeyDown={(event) => {
            if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault()
              changeOpen(true)
            }
          }}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            triggerClassName,
          )}
        >
          <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>
            {selected ? (selected.selectedLabel ?? selected.label) : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-floating-layer=""
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            'z-menu flex max-h-[min(20rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] min-w-[12.5rem] flex-col overflow-hidden rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md',
            contentClassName,
          )}
        >
          <input
            role="combobox"
            aria-label={`Search ${triggerAriaLabel ?? 'options'}`}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') move(1)
              else if (event.key === 'ArrowUp') move(-1)
              else if (event.key === 'Home') {
                scrollToActive.current = true
                setActive(0)
              } else if (event.key === 'End') {
                scrollToActive.current = true
                setActive(Math.max(0, shown.length - 1))
              } else if (event.key === 'Enter') pick(shown[active])
              else return
              event.preventDefault()
            }}
            className="mb-1 h-8 w-full shrink-0 rounded-sm border border-input bg-background px-2 text-base outline-none focus:ring-1 focus:ring-ring md:text-sm"
          />
          <div id={listId} role="listbox" aria-label={triggerAriaLabel} className="min-h-0 overflow-y-auto">
            {shown.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                data-value={option.value}
                data-active={index === active || undefined}
                title={option.title}
                onPointerMove={() => !option.disabled && index !== active && setActive(index)}
                onClick={() => pick(option)}
                className={cn(
                  'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8',
                  index === active && 'bg-accent text-accent-foreground',
                  option.disabled && 'pointer-events-none opacity-50',
                )}
              >
                {option.label}
                {option.value === value && <Check className="absolute right-2 h-4 w-4" aria-hidden="true" />}
              </div>
            ))}
            {!shown.length && <p className="px-2 py-1.5 text-muted-foreground">No matches</p>}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export {
  AppSelect,
  compactSelectTriggerClass,
  workspaceSelectContentClass,
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
