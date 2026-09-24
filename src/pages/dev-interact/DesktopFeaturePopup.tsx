import { ChevronRight, MoreHorizontal, X } from 'lucide-react'
import { KeyValueRows } from '@/components/ui/map-panels'
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
          <button type="button" className="flex size-7 items-center justify-center rounded-md hover:bg-muted touch:size-9" onClick={onPrevious} aria-label="Previous selected feature">
            <ChevronRight className="size-4 rotate-180" />
          </button>
          <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
            <span className="justify-self-end text-foreground">{index + 1}</span>
            <span>of</span>
            <span className="justify-self-start text-foreground">{count}</span>
          </span>
          <button type="button" className="flex size-7 items-center justify-center rounded-md hover:bg-muted touch:size-9" onClick={onNext} aria-label="Next selected feature">
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
        <div className="border-b border-border px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase text-muted-foreground">{layerLabel(feature.properties.layer)}</div>
              <div className="mt-1 truncate text-sm font-semibold">{feature.properties.name}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" className="rounded-md p-1.5 hover:bg-muted touch:p-2.5" aria-label="Feature actions">
                <MoreHorizontal className="size-4" />
              </button>
              <button type="button" className="rounded-md p-1.5 hover:bg-muted touch:p-2.5" onClick={onClose} aria-label="Close desktop feature popup">
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>
        <div aria-label="Vector feature popup contents" className="max-h-64 overflow-y-auto px-3 py-2">
          <KeyValueRows
            variant="divided"
            size="sm"
            rows={feature.properties.properties.map((row) => ({ key: row.label, label: row.label, value: row.value || '-' }))}
          />
        </div>
      </div>
    </div>
  )
}
