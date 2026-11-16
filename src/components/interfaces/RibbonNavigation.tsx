import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useScrollEdges } from '@/hooks/useScrollEdges'
import { useHorizontalWheel } from '@/components/ui/horizontal-scroll'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'

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
