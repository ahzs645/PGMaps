import type { LucideIcon } from 'lucide-react'
import { HoverTip } from '@/components/ui/info-tip'
import { cn } from '@/lib/utils'

/**
 * One icon button in a map's control stack (`MapControls`) that puts a tool in hand: Measure, placing a point,
 * a preview with its card. Pressed while the tool is in hand; `on` adds a dot when the tool's effect stays on the map
 * after its card is closed. Hovering or focusing it shows `title` in a `HoverTip` bubble, not the browser's own
 * title. The tool's card is the page's (`MapToolPanel` in a `MapOverlay`).
 */
export function MapToolToggle({
  icon: Icon,
  label,
  active,
  on = false,
  onToggle,
  disabled,
  title = label,
}: {
  icon: LucideIcon
  /** Accessible name, e.g. "Measure". */
  label: string
  active: boolean
  on?: boolean
  onToggle: () => void
  disabled?: boolean
  /** The hover bubble's text: what the tool does, or why it is off. */
  title?: string
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background shadow-sm">
      <HoverTip content={title}>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onToggle}
          className={cn(
            'relative flex size-11 items-center justify-center transition-colors hover:bg-accent disabled:opacity-50 dark:hover:bg-accent/40 workspace-desktop:size-8',
            active && 'bg-accent text-accent-foreground dark:bg-accent/40',
          )}
        >
          <Icon className="size-4" />
          {on && !active && (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" aria-hidden="true" />
          )}
        </button>
      </HoverTip>
    </div>
  )
}
