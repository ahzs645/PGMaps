import { useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Portal edge rails keep one mounted set of tools at desktop and phone sizes. */
export function PortalDock({
  side,
  title,
  children,
  open,
  onOpenChange,
}: {
  side: 'left' | 'right'
  title: string
  children: ReactNode
  open: boolean
  onOpenChange: (value: boolean) => void
}) {
  const rail = useRef<HTMLButtonElement>(null)
  const close = () => {
    onOpenChange(false)
    rail.current?.focus()
  }
  const id = `nechako-dock-${side}`
  const Icon = (side === 'left') === open ? ChevronLeft : ChevronRight
  return (
    <aside
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close()
        }
      }}
      className={cn(
        'z-20 flex w-10 shrink-0 bg-[#075747] text-white',
        open && 'md:w-[320px]',
        side === 'right' && 'flex-row-reverse',
      )}
    >
      <button
        ref={rail}
        type="button"
        aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-10 shrink-0 flex-col items-center gap-3 py-3 text-sm font-semibold hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-white"
        onClick={() => onOpenChange(!open)}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
        <span style={{ writingMode: 'vertical-rl' }}>{title}</span>
      </button>
      <section
        id={id}
        aria-label={title}
        hidden={!open}
        className={cn(
          'absolute bottom-0 top-0 w-[min(320px,calc(100%-80px))] overflow-y-auto overscroll-contain border bg-background p-3 text-foreground shadow-xl md:relative md:w-auto md:min-w-0 md:flex-1 md:shadow-none',
          side === 'left' ? 'left-10 md:left-auto' : 'right-10 md:right-auto',
        )}
      >
        <div className="mb-4 flex items-center justify-between border-b pb-2">
          <h2 className="font-semibold">{title}</h2>
          <Button size="icon" variant="ghost" aria-label={`Close ${title}`} onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-4">{children}</div>
      </section>
    </aside>
  )
}
