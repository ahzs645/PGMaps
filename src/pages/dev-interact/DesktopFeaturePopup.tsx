import { ChevronRight, MoreHorizontal, X } from 'lucide-react'
import { layerLabel } from './geo'
import type { InteractFeature } from './types'

export function DesktopFeaturePopup({
  feature,
  count,
  index,
  onPrevious,
  onNext,
  onClose,
}: {
  feature: InteractFeature
  count: number
  index: number
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}) {
  return (
    <div className="flex w-72 flex-col gap-1.5">
      {count > 1 && (
        <div className="flex items-center gap-1 self-center rounded-md border border-border bg-popover px-1.5 py-1 shadow-md">
          <button type="button" className="flex size-7 items-center justify-center rounded-md hover:bg-muted" onClick={onPrevious} aria-label="Previous selected feature">
            <ChevronRight className="size-4 rotate-180" />
          </button>
          <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
            <span className="justify-self-end text-foreground">{index + 1}</span>
            <span>of</span>
            <span className="justify-self-start text-foreground">{count}</span>
          </span>
          <button type="button" className="flex size-7 items-center justify-center rounded-md hover:bg-muted" onClick={onNext} aria-label="Next selected feature">
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase text-muted-foreground">{layerLabel(feature.properties.layer)}</div>
            <div className="mt-1 truncate text-sm font-semibold">{feature.properties.name}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className="rounded-md p-1.5 hover:bg-muted" aria-label="Feature actions">
              <MoreHorizontal className="size-4" />
            </button>
            <button type="button" className="rounded-md p-1.5 hover:bg-muted" onClick={onClose} aria-label="Close desktop feature popup">
              <X className="size-4" />
            </button>
          </div>
        </div>
      </div>
      <div aria-label="Vector feature popup contents" className="max-h-64 overflow-y-auto px-3 py-1">
        {feature.properties.properties.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-border/70 py-2 text-sm last:border-b-0">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="min-w-0 truncate font-medium text-foreground">{row.value || '-'}</span>
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}
