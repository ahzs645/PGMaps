import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useScrollEdges } from '@/hooks/useScrollEdges'
import { useHorizontalWheel } from '@/components/ui/horizontal-scroll'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'
import { moveTo } from './ribbonPreferences'

/** Where a tab dragged over `target` lands: before it on its leading half, after it on its trailing half. */
function dropIndex(tabs: readonly HTMLElement[], from: number, target: number, clientX: number, rtl: boolean) {
  const box = tabs[target].getBoundingClientRect()
  const leading = rtl ? clientX > box.left + box.width / 2 : clientX < box.left + box.width / 2
  const slot = leading ? target : target + 1
  // Removing the dragged tab first shifts every later slot one place back.
  return slot > from ? slot - 1 : slot
}

/**
 * Drag a tab along the row to reorder it, or move the focused tab with Alt+Shift+Left/Right. The tab
 * row is the toolkit's `TabBar`, so this listens on its frame rather than changing the tab buttons.
 */
function useTabReorder(
  frame: RefObject<HTMLDivElement | null>,
  names: readonly string[],
  onReorder?: (names: string[]) => void,
) {
  const latest = useRef({ names, onReorder })
  useLayoutEffect(() => {
    latest.current = { names, onReorder }
  })
  const enabled = !!onReorder
  useEffect(() => {
    const root = frame.current
    if (!root || !enabled) return
    const tabsOf = () => Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'))
    const rtl = () => getComputedStyle(root).direction === 'rtl'
    const mark = () => {
      for (const tab of tabsOf()) {
        tab.draggable = true
        tab.setAttribute('aria-roledescription', 'reorderable tab')
      }
    }
    mark()
    const observer = new MutationObserver(mark)
    observer.observe(root, { childList: true, subtree: true })
    let from = -1
    const clear = () => {
      for (const tab of tabsOf()) tab.removeAttribute('data-drop')
    }
    const commit = (to: number) => {
      const { names, onReorder } = latest.current
      if (from < 0 || to === from) return
      onReorder?.(moveTo(names, from, to))
    }
    const onDragStart = (event: DragEvent) => {
      const tab = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="tab"]')
      from = tab ? tabsOf().indexOf(tab) : -1
      if (from < 0 || !event.dataTransfer) return
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', latest.current.names[from] ?? '')
      tab?.setAttribute('data-dragging', '')
    }
    const onDragOver = (event: DragEvent) => {
      if (from < 0) return
      const tabs = tabsOf()
      const tab = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="tab"]')
      const target = tab ? tabs.indexOf(tab) : -1
      if (target < 0) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      const box = tab!.getBoundingClientRect()
      const leading = rtl() ? event.clientX > box.left + box.width / 2 : event.clientX < box.left + box.width / 2
      clear()
      if (target !== from) tab!.setAttribute('data-drop', leading ? 'before' : 'after')
    }
    const onDrop = (event: DragEvent) => {
      const tabs = tabsOf()
      const tab = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="tab"]')
      const target = tab ? tabs.indexOf(tab) : -1
      clear()
      if (from < 0 || target < 0) return
      event.preventDefault()
      commit(dropIndex(tabs, from, target, event.clientX, rtl()))
    }
    const onDragEnd = () => {
      clear()
      for (const tab of tabsOf()) tab.removeAttribute('data-dragging')
      from = -1
    }
    const onDragLeave = (event: DragEvent) => {
      if (!root.contains(event.relatedTarget as Node | null)) clear()
    }
    // Ahead of the tab row's own arrow keys, which move the selection rather than the tab.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
      const tab = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="tab"]')
      const tabs = tabsOf()
      const index = tab ? tabs.indexOf(tab) : -1
      if (index < 0) return
      event.preventDefault()
      event.stopPropagation()
      const step = (event.key === 'ArrowRight' ? 1 : -1) * (rtl() ? -1 : 1)
      const to = Math.max(0, Math.min(tabs.length - 1, index + step))
      // Named before the move: the row re-renders with the next order, and its buttons stay by place.
      const name = latest.current.names[index]
      from = index
      commit(to)
      from = -1
      // The moved tab keeps focus in its new place. The row re-renders shortly after, and its buttons are
      // keyed by place, so wait until the tab's name reaches that place. A timer, not animation frames,
      // which a background tab never runs.
      let tries = 0
      const follow = () => {
        const moved = tabsOf()[to]
        if (moved?.textContent?.trim() === name) moved.focus()
        else if (++tries < 30) setTimeout(follow, 16)
      }
      setTimeout(follow, 0)
    }
    root.addEventListener('dragstart', onDragStart)
    root.addEventListener('dragover', onDragOver)
    root.addEventListener('dragleave', onDragLeave)
    root.addEventListener('drop', onDrop)
    root.addEventListener('dragend', onDragEnd)
    root.addEventListener('keydown', onKeyDown, true)
    return () => {
      observer.disconnect()
      for (const tab of tabsOf()) {
        tab.draggable = false
        tab.removeAttribute('aria-roledescription')
      }
      root.removeEventListener('dragstart', onDragStart)
      root.removeEventListener('dragover', onDragOver)
      root.removeEventListener('dragleave', onDragLeave)
      root.removeEventListener('drop', onDrop)
      root.removeEventListener('dragend', onDragEnd)
      root.removeEventListener('keydown', onKeyDown, true)
    }
  }, [frame, enabled])
}

export function RibbonTabs({
  names,
  active,
  onChoose,
  onReorder,
  children,
}: {
  names: string[]
  active: string
  onChoose: (tab: string) => void
  /** Given, the tabs can be dragged along the row (or moved with Alt+Shift+Left/Right) into a new order. */
  onReorder?: (names: string[]) => void
  children: ReactNode
}) {
  const nav = useRef<HTMLDivElement>(null)
  const { previous, next } = useScrollEdges(nav, '[role="tablist"]')
  useTabReorder(nav, names, onReorder)
  useLayoutEffect(() => {
    nav.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])
  return (
    <div className="lp-tab-navigation" ref={nav}>
      {children}
      {(previous || next) && (
        <ActionMenu
          label="Choose ribbon tab"
          triggerClassName="lp-all-tabs"
          trigger={<ChevronDown size={15} aria-hidden="true" />}
          width={200}
          items={names.map((name) => ({
            id: name,
            label: name,
            radio: true,
            checked: name === active,
            onSelect: () => onChoose(name),
          }))}
        />
      )}
    </div>
  )
}

export function RibbonStrip({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  const { previous, next } = useScrollEdges(frame, '.lp-tools')
  // The strip shows no scrollbar (it would change the band's height), so a vertical wheel scrolls it sideways.
  useHorizontalWheel(frame, '.lp-tools')
  function step(direction: number) {
    const viewport = frame.current?.querySelector<HTMLElement>('.lp-tools')
    if (!viewport) return
    const sign = getComputedStyle(viewport).direction === 'rtl' ? -1 : 1
    viewport.scrollBy({ left: Math.max(80, viewport.clientWidth - 60) * direction * sign })
  }
  return (
    <div className="lp-strip-frame" ref={frame}>
      {children}
      {previous && (
        <button
          type="button"
          className="lp-strip-edge lp-prev"
          aria-label="Previous ribbon tools"
          onClick={() => step(-1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
      )}
      {next && (
        <button type="button" className="lp-strip-edge lp-next" aria-label="Next ribbon tools" onClick={() => step(1)}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
