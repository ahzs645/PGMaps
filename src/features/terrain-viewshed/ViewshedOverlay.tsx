import { useMemo } from 'react'
import { MapFillLayer } from '@/components/ui/map-layers'
import type { ViewshedResult } from './model'
import { visibilityAreas } from './outline'

export type OverlayMode = 'standing' | 'seated' | 'compare'

export function ViewshedOverlay({
  result,
  mode,
  opacity,
  showHidden,
  sourceKey = 'viewshed-overlay',
}: {
  result: ViewshedResult | null
  mode: OverlayMode
  opacity: number
  showHidden: boolean
  sourceKey?: string
}) {
  const areas = useMemo(() => visibilityAreas(result, mode, showHidden), [result, mode, showHidden])
  return (
    <MapFillLayer
      data={areas}
      sourceKey={sourceKey}
      layerOrder={100}
      fillColor={['get', 'color']}
      fillOpacity={opacity * 0.55}
      lineWidth={0}
      lineOpacity={0}
    />
  )
}
