import { X } from 'lucide-react'
import { useMemo } from 'react'
import { neighbourhoodFeatures, parkFeatures, routeFeatures } from './data'
import { layerLabel } from './geo'
import type { InteractFeature, LayerId } from './types'

export function FeatureTablePanel({
  layer,
  hiddenFeatureIds,
  isolatedFeatureId,
  onClose,
  onSelect,
}: {
  layer: LayerId
  hiddenFeatureIds: Set<string>
  isolatedFeatureId: string | null
  onClose: () => void
  onSelect: (feature: InteractFeature) => void
}) {
  const rows = useMemo(() => {
    const collection = layer === 'parks' ? parkFeatures : layer === 'routes' ? routeFeatures : neighbourhoodFeatures
    return collection.features.filter((feature) => {
      if (hiddenFeatureIds.has(feature.properties.id)) return false
      if (isolatedFeatureId && feature.properties.id !== isolatedFeatureId) return false
      return true
    })
  }, [hiddenFeatureIds, isolatedFeatureId, layer])

  return (
    <div className="absolute inset-x-3 bottom-[calc(var(--map-mobile-sheet-visible-height,72px)+0.75rem)] z-30 max-h-[45vh] overflow-hidden rounded-lg border border-border bg-background/95 shadow-2xl backdrop-blur md:bottom-4 md:left-auto md:right-4 md:w-[480px]">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <div className="text-sm font-semibold">{layerLabel(layer)} table</div>
          <div className="text-xs text-muted-foreground">{rows.length} visible features</div>
        </div>
        <button type="button" className="rounded-md p-1.5 hover:bg-muted" onClick={onClose} aria-label="Close table">
          <X className="size-4" />
        </button>
      </div>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Layer</th>
              <th className="px-3 py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((feature) => (
              <tr
                key={feature.properties.id}
                className="cursor-pointer border-b border-border/70 last:border-b-0 hover:bg-muted"
                onClick={() => onSelect(feature)}
              >
                <td className="max-w-40 truncate px-3 py-2 font-medium">{feature.properties.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{layerLabel(feature.properties.layer)}</td>
                <td className="px-3 py-2">{feature.properties.value ?? '-'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={3}>No visible rows</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
