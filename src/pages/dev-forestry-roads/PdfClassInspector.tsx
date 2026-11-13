import { useEffect, useMemo, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { MapOverlay, KeyValueRows } from '@/components/ui/map-panels'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { sampleClass } from '@/lib/geoPdf/classGrid'
import type { MapMouseEvent } from 'maplibre-gl'
import type { ReferenceFeature } from './referenceFeatures'

/** Read-only companion to the plan's Inspect action. Draw/edit/peg tools retain their clicks. */
export function PdfClassInspector({ features, enabled }: { features: readonly ReferenceFeature[]; enabled: boolean }) {
  const { map, isLoaded } = useMap()
  const rasters = useMemo(() => features.filter((f) => f.classGrid), [features])
  const [point, setPoint] = useState<{ coordinate: [number, number]; rasters: readonly ReferenceFeature[] } | null>(
    null,
  )
  useEffect(() => {
    if (!map || !isLoaded || !enabled || !rasters.length) return
    const click = (e: MapMouseEvent) => setPoint({ coordinate: [e.lngLat.lng, e.lngLat.lat], rasters })
    map.on('click', click)
    return () => {
      map.off('click', click)
    }
  }, [map, isLoaded, enabled, rasters])
  if (!point || !enabled || point.rasters !== rasters) return null
  const rows = rasters.map((feature) => {
    const grid = feature.classGrid!,
      value = sampleClass(grid, point.coordinate)
    return {
      key: feature.id,
      label: feature.name,
      value: value.range
        ? `${value.range.label} ${grid.unit} · ${value.estimated ? 'JPEG estimate (uncertain at one pixel)' : 'lossless palette match'}`
        : value.code === 0 && grid.undrawn
          ? (value.reason ?? 'Not drawn')
          : `Unknown · ${value.reason}`,
    }
  })
  return (
    <MapOverlay
      position="bottom-right"
      clearChrome
      className="pointer-events-auto w-72 max-w-[calc(100%-1.5rem)] p-3"
      data-testid="pdf-class-query"
    >
      <MapPopupCard
        title="Published PDF classes"
        subtitle={`${point.coordinate[1].toFixed(6)}, ${point.coordinate[0].toFixed(6)}`}
        onClose={() => setPoint(null)}
      >
        <KeyValueRows rows={rows} size="sm" />
        <p className="mt-2 text-2xs text-muted-foreground">
          Published ranges at a PDF pixel; no exact height or terrain grade is inferred.
        </p>
      </MapPopupCard>
    </MapOverlay>
  )
}
