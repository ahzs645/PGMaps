import { useRef, type CSSProperties, type Key, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  SearchComboboxInput,
  SearchResultList,
  useSearchCombobox,
  type SearchOptionState,
  type UseSearchComboboxOptions,
} from '@/components/ui/search-combobox'

/**
 * A search box over a result list in a dialog near the top of the screen: the site search and the
 * ribbon's Find tools are both this. The caller owns the query and the filtering; the palette owns
 * the dialog, the keys, the highlight and the look. Give each option its content through
 * `SearchResultContent`, so every palette reads the same.
 */
export interface SearchPaletteProps<T> {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The dialog's accessible name. Not shown. */
  title: string
  /** What the palette searches, for assistive technology. Not shown. */
  description: string
  query: string
  onQueryChange: (query: string) => void
  placeholder?: string
  /** The box's accessible name. Default `title`. */
  inputLabel?: string
  inputId?: string
  /** The options to show, already filtered, in render order. */
  items: readonly T[]
  /** Runs once the palette has closed, so a pick that moves focus or opens a dialog keeps it. */
  onPick: (item: T, index: number) => void
  getKey: (item: T, index: number) => Key
  renderOption: (item: T, state: SearchOptionState) => ReactNode
  /** Consecutive options with the same group share a heading. */
  getGroup?: (item: T) => string | undefined
  isDisabled?: (item: T, index: number) => boolean
  /** Keyboard and highlight settings passed to `useSearchCombobox`. */
  combobox?: Pick<
    UseSearchComboboxOptions<T>,
    'skipDisabled' | 'loop' | 'homeEnd' | 'resetKey' | 'scrollIntoView' | 'activateOnHover' | 'id'
  >
  /** A line between the box and the list: sources still loading, a source that failed. */
  status?: ReactNode
  /** Said in place of the list when nothing matches. */
  empty?: ReactNode
  /** The footer's count. Default "3 results". */
  countLabel?: (count: number) => string
  /** What Enter does, in the footer's key hints. Default "Open". */
  pickHint?: string
  /**
   * Focused when the palette closes. Without it, a dismissed palette returns focus to where it was
   * and a pick leaves focus wherever `onPick` put it.
   */
  returnFocus?: RefObject<HTMLElement | null>
  /** The list's accessible name. Default "Search results". */
  resultsLabel?: string
  /**
   * Keys pressed in the palette, before it stops them: no key typed here reaches a page's own
   * shortcuts, so a shortcut that should still work while it is open is handled here.
   */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}

// Centred across the screen and anchored below its top, so the box stays put while the list under
// it grows and shrinks. Set inline: the dialog's own centring transform and a Tailwind translate
// class each reset the other's axis, which left a palette starting at the middle of the screen.
const PALETTE_POSITION: CSSProperties = { transform: 'translateX(-50%)' }

const defaultCount = (count: number) => `${count} ${count === 1 ? 'result' : 'results'}`

export function SearchPalette<T>({
  open,
  onOpenChange,
  title,
  description,
  query,
  onQueryChange,
  placeholder,
  inputLabel,
  inputId,
  items,
  onPick,
  getKey,
  renderOption,
  getGroup,
  isDisabled,
  combobox: comboboxOptions,
  status,
  empty = 'No results found.',
  countLabel = defaultCount,
  pickHint = 'Open',
  returnFocus,
  resultsLabel = 'Search results',
  onKeyDown,
}: SearchPaletteProps<T>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const picked = useRef(false)
  const opener = useRef<Element | null>(null)
  const combobox = useSearchCombobox({
    resetKey: query,
    ...comboboxOptions,
    items,
    isDisabled,
    onPick: (item, index) => {
      picked.current = true
      // Closed before the pick runs: the dialog's focus trap is gone by then, so a control the
      // pick focuses keeps focus, and a file picker it opens still has the click behind it.
      flushSync(() => onOpenChange(false))
      onPick(item, index)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        elevated
        showClose={false}
        style={PALETTE_POSITION}
        className="top-[min(15vh,6rem)] flex max-h-[min(32rem,calc(100dvh_-_min(15vh,6rem)_-_1rem))] flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          picked.current = false
          opener.current = document.activeElement
          inputRef.current?.focus()
        }}
        // The dialog returns focus only to a trigger of its own, and the palette has none.
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocus) returnFocus.current?.focus()
          else if (!picked.current && opener.current instanceof HTMLElement) opener.current.focus()
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          event.stopPropagation()
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <SearchComboboxInput
          id={inputId}
          ref={inputRef}
          combobox={combobox}
          variant="bare"
          // One height with or without the clear button, so typing never moves the list.
          boxClassName="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4"
          icon={<Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          aria-label={inputLabel ?? title}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none touch:text-base"
          onClear={() => {
            onQueryChange('')
            inputRef.current?.focus()
          }}
          buttonClassName="-mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground touch:h-11 touch:w-11"
          buttonIcon={<X className="h-4 w-4" aria-hidden="true" />}
        />
        {status}
        <SearchResultList
          combobox={combobox}
          aria-label={resultsLabel}
          className={cn('min-h-0 overflow-y-auto overscroll-contain p-2', !items.length && 'hidden')}
          optionAs="button"
          getKey={getKey}
          getGroup={getGroup}
          groupHeadingClassName="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          optionClassName={({ active, disabled }) =>
            cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
              active ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent',
              disabled && 'cursor-default text-muted-foreground',
            )
          }
          renderOption={renderOption}
        />
        {!items.length && (
          <p role="status" className="px-4 py-8 text-center text-sm text-muted-foreground">
            {empty}
          </p>
        )}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>{countLabel(items.length)}</span>
          <div className="hidden items-center gap-2 sm:flex">
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">↑↓</kbd>
            <span>Navigate</span>
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">↵</kbd>
            <span>{pickHint}</span>
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">Esc</kbd>
            <span>Close</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
