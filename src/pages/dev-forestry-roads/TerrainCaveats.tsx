import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'

/**
 * The terrain source's standing caveats behind one amber triangle: the screening-terrain note and the
 * scenario's context warnings (an access study's evidence gaps run to four paragraphs). They are not
 * news on each visit, so the sidebar keeps the triangle in view and the wording in a dialog.
 */
export function TerrainCaveats({
  screening,
  warnings,
  className,
}: {
  /** The terrain is coarse reconnaissance, not bare-earth LiDAR. */
  screening: boolean
  warnings: readonly string[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // Mount inside the road workspace, as its other dialogs do: its fullscreen sits above the page body.
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null)
  const container = anchor
    ? (anchor.closest<HTMLElement>('.road-workspace') ?? (document.fullscreenElement as HTMLElement | null))
    : null
  const count = warnings.length + (screening ? 1 : 0)
  if (!count) return null
  const label = screening && !warnings.length ? 'Screening terrain' : `Terrain and context caveats (${count})`
  return (
    <span ref={setAnchor} className={cn('inline-flex', className)}>
      <PanelDialog
        title="Terrain and context caveats"
        subtitle="Limits of the loaded terrain and context records. Review them before relying on the road."
        open={open}
        onOpenChange={setOpen}
        portalContainer={container}
        contentProps={{ 'data-testid': 'road-terrain-caveats' }}
        trigger={
          <button
            type="button"
            aria-label={label}
            title={label}
            className={cn(
              'relative inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              "touch:after:absolute touch:after:-inset-2.5 touch:after:content-['']",
            )}
          >
            <TriangleAlert className="size-3.5 text-amber-500 dark:text-amber-400" aria-hidden="true" />
          </button>
        }
        footer={
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-2">
          {screening && (
            <InlineAlert tone="warning">
              Screening terrain. Use bare-earth LiDAR or your own DEM before relying on quantities.
            </InlineAlert>
          )}
          {warnings.map((warning, index) => (
            <InlineAlert key={index} tone="warning">
              {warning}
            </InlineAlert>
          ))}
        </div>
      </PanelDialog>
    </span>
  )
}
