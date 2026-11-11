import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'

/** Measure the real strip, including changes in the availability and width of configured tools. */
function useScrollEdges(container: RefObject<HTMLElement>, selector: string) {
  const [edges, setEdges] = useState({ previous: false, next: false })
  useLayoutEffect(() => {
    const viewport = container.current?.querySelector<HTMLElement>(selector)
    if (!viewport) return
    const measure = () => {
      const offset = Math.abs(viewport.scrollLeft)
      const overflows = viewport.scrollWidth > (container.current?.clientWidth ?? viewport.clientWidth) + 1
      const previous = overflows && offset > 1
      const next = overflows && viewport.scrollWidth - viewport.clientWidth - offset > 1
      setEdges((old) => (old.previous === previous && old.next === next ? old : { previous, next }))
    }
    const resize = new ResizeObserver(measure)
    const observeWidths = () => {
      resize.disconnect()
      if (container.current) resize.observe(container.current)
      resize.observe(viewport)
      for (const child of viewport.children) resize.observe(child)
      measure()
    }
    observeWidths()
    const changes = new MutationObserver(observeWidths)
    changes.observe(viewport, { childList: true })
    viewport.addEventListener('scroll', measure, { passive: true })
    return () => {
      resize.disconnect()
      changes.disconnect()
      viewport.removeEventListener('scroll', measure)
    }
  }, [container, selector])
  return edges
}

export function RibbonTabs({
  names,
  active,
  onChoose,
  children,
}: {
  names: string[]
  active: string
  onChoose: (tab: string) => void
  children: ReactNode
}) {
  const nav = useRef<HTMLDivElement>(null)
  const { previous, next } = useScrollEdges(nav, '[role="tablist"]')
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
  function step(direction: number) {
    const viewport = frame.current?.querySelector<HTMLElement>('.lp-tools')
    if (!viewport) return
    const sign = getComputedStyle(viewport).direction === 'rtl' ? -1 : 1
    viewport.scrollBy({ left: Math.max(80, viewport.clientWidth - 60) * direction * sign })
  }
  return (
    <div className="lp-strip-frame" ref={frame}>
      {children}
      {(previous || next) && (
        <>
          <button
            type="button"
            className="lp-strip-edge lp-prev"
            aria-label="Previous ribbon tools"
            disabled={!previous}
            onClick={() => step(-1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lp-strip-edge lp-next"
            aria-label="Next ribbon tools"
            disabled={!next}
            onClick={() => step(1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  )
}
