import type { ElementType } from 'react'
import { cn } from '@/lib/utils'
import { handleHorizontalWheelScroll } from '@/components/ui/horizontal-scroll'

export interface SectionTab<Id extends string = string> {
  id: Id
  label: string
  icon: ElementType
  /** Optional shorter label shown below the sm breakpoint. */
  shortLabel?: string
}

/** Desktop-only horizontal tab strip shown above a map section (hidden on mobile, where the navbar submenu navigates tabs). */
export function SectionTabsBar<Id extends string>({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: ReadonlyArray<SectionTab<Id>>
  activeTab: Id
  onTabChange: (id: Id) => void
}) {
  return (
    <div
      className="hidden min-w-0 shrink-0 overflow-x-auto border-b border-border bg-background/95 px-2 py-1 backdrop-blur [scrollbar-width:none] md:block md:px-4 md:py-2 [&::-webkit-scrollbar]:hidden"
      onWheel={handleHorizontalWheelScroll}
    >
      <div className="flex w-max rounded-md border border-border bg-muted/40 p-0.5 md:rounded-lg md:p-1">
        {tabs.map(({ id, label, shortLabel, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            className={cn(
              'inline-flex h-6 shrink-0 items-center gap-1 rounded px-2 text-xs font-medium transition-colors sm:h-7 sm:gap-1.5 sm:px-2.5 sm:text-xs md:h-8 md:rounded-md md:px-3',
              activeTab === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span className={shortLabel ? 'hidden sm:inline' : ''}>{label}</span>
            {shortLabel && <span className="sm:hidden">{shortLabel}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
