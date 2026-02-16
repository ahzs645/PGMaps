import { useCallback, useRef, useState, type CSSProperties, type ReactNode, type TouchEvent } from 'react'
import { ChevronsLeft, ChevronsRight, GripHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

type MobileSheetState = 'collapsed' | 'half' | 'full'

interface MapSectionLayoutProps {
  sidebar: ReactNode
  showDesktopSidebar: boolean
  onToggleDesktopSidebar: () => void
  desktopSidebarWidth?: number
  children: ReactNode
  className?: string
}

const MOBILE_SHEET_TRANSFORM: Record<MobileSheetState, string> = {
  collapsed: 'translate-y-[calc(100%-8rem)]',
  half: 'translate-y-[calc(100%-58dvh)]',
  full: 'translate-y-0',
}

export function MapSectionLayout({
  sidebar,
  showDesktopSidebar,
  onToggleDesktopSidebar,
  desktopSidebarWidth = 350,
  children,
  className
}: MapSectionLayoutProps) {
  const [mobileSheetState, setMobileSheetState] = useState<MobileSheetState>('collapsed')
  const touchStartY = useRef(0)
  const touchStartX = useRef(0)

  const cycleSheetState = useCallback(() => {
    setMobileSheetState((previous) => {
      if (previous === 'collapsed') return 'half'
      if (previous === 'half') return 'full'
      return 'collapsed'
    })
  }, [])

  const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    touchStartY.current = event.touches[0].clientY
    touchStartX.current = event.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const deltaY = touchStartY.current - event.changedTouches[0].clientY
    const deltaX = touchStartX.current - event.changedTouches[0].clientX

    if (Math.abs(deltaY) < 30 || Math.abs(deltaX) > Math.abs(deltaY)) {
      return
    }

    if (deltaY > 0) {
      setMobileSheetState((previous) => {
        if (previous === 'collapsed') return 'half'
        if (previous === 'half') return 'full'
        return 'full'
      })
      return
    }

    setMobileSheetState((previous) => {
      if (previous === 'full') return 'half'
      if (previous === 'half') return 'collapsed'
      return 'collapsed'
    })
  }, [])

  return (
    <div className={cn('relative flex h-full w-full bg-slate-100 dark:bg-slate-950', className)}>
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-30 md:pointer-events-auto md:relative md:inset-auto md:z-10 md:h-full md:shrink-0',
          showDesktopSidebar ? 'md:block md:w-[var(--desktop-sidebar-width)]' : 'md:hidden'
        )}
        style={{ '--desktop-sidebar-width': `${desktopSidebarWidth}px` } as CSSProperties}
      >
        <div
          className={cn(
            'pointer-events-auto absolute inset-x-0 bottom-0 h-full max-h-full overflow-hidden rounded-t-2xl border border-border border-b-0 bg-background/95 shadow-2xl backdrop-blur transition-transform duration-300 ease-out md:relative md:inset-auto md:h-full md:translate-y-0 md:rounded-none md:border-0 md:bg-transparent md:shadow-none md:backdrop-blur-none md:transition-none',
            MOBILE_SHEET_TRANSFORM[mobileSheetState]
          )}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button
            type="button"
            onClick={cycleSheetState}
            className="flex w-full items-center justify-center py-1.5 text-muted-foreground/60 hover:text-muted-foreground md:hidden"
            aria-label="Cycle mobile sheet size"
          >
            <GripHorizontal className="h-5 w-8" />
          </button>
          <div className="h-[calc(100%-2rem)] min-h-0 md:h-full">
            {sidebar}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleDesktopSidebar}
        aria-label={showDesktopSidebar ? 'Hide sidebar' : 'Show sidebar'}
        style={{ left: showDesktopSidebar ? desktopSidebarWidth : 0 }}
        className={cn(
          'absolute top-6 z-20 hidden h-10 w-8 items-center justify-center border border-l-0 border-slate-300/80 bg-slate-50/95 text-slate-600 shadow-md backdrop-blur transition-[left,background-color,color,border-color] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:bg-slate-800 md:flex',
          'rounded-r-lg'
        )}
      >
        {showDesktopSidebar ? (
          <ChevronsLeft className="h-4 w-4" />
        ) : (
          <ChevronsRight className="h-4 w-4" />
        )}
      </button>

      <div className="relative flex-1">
        {children}
      </div>
    </div>
  )
}
