import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'

interface VirtualResultListProps<T> {
  items: readonly T[]
  getKey: (item: T) => string
  estimateSize: number
  label: string
  children: (item: T) => ReactNode
}

/** Variable-height results inside MapSidebarShell's existing scroll container. */
export function VirtualResultList<T>({ items, getKey, estimateSize, label, children }: VirtualResultListProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const pendingFocus = useRef<number | null>(null)
  const getScrollElement = useCallback(
    () => listRef.current?.closest<HTMLElement>('[data-map-sidebar-scroll="true"]') ?? null,
    [],
  )
  const focusedIndex = focusedKey === null ? -1 : items.findIndex((item) => getKey(item) === focusedKey)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    getItemKey: (index) => getKey(items[index]),
    estimateSize: () => estimateSize,
    scrollMargin,
    overscan: 5,
    // Scrolling with the mouse must not unmount the keyboard's focused row.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      return focusedIndex < 0 || indexes.includes(focusedIndex)
        ? indexes
        : [...indexes, focusedIndex].sort((a, b) => a - b)
    },
  })

  // Filters/detail cards above the list can change its offset without resizing
  // the scroll viewport. Recompute after each render as well as viewport resize.
  useLayoutEffect(() => {
    const list = listRef.current
    const scroll = getScrollElement()
    if (!list || !scroll) return
    const measure = () =>
      setScrollMargin(scroll.scrollTop + list.getBoundingClientRect().top - scroll.getBoundingClientRect().top)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    return () => observer.disconnect()
  })

  useLayoutEffect(() => {
    const index = pendingFocus.current
    if (index === null) return
    const button = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"] button`)
    if (!button) return
    button.focus({ preventScroll: true })
    pendingFocus.current = null
  })

  return (
    <div
      ref={listRef}
      role="list"
      aria-label={label}
      data-virtual-result-list="true"
      style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      onFocusCapture={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
        const item = row ? items[Number(row.dataset.index)] : undefined
        if (item) setFocusedKey(getKey(item))
      }}
      onKeyDown={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
        if (!row || !items.length) return
        const index = Number(row.dataset.index)
        const next =
          event.key === 'ArrowDown'
            ? Math.min(items.length - 1, index + 1)
            : event.key === 'ArrowUp'
              ? Math.max(0, index - 1)
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : null
        if (next === null) return
        event.preventDefault()
        pendingFocus.current = next
        setFocusedKey(getKey(items[next]))
        virtualizer.scrollToIndex(next, { align: 'auto' })
      }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          ref={virtualizer.measureElement}
          data-index={row.index}
          role="listitem"
          aria-setsize={items.length}
          aria-posinset={row.index + 1}
          className="absolute left-0 top-0 w-full border-b border-border"
          style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
        >
          {children(items[row.index])}
        </div>
      ))}
    </div>
  )
}
