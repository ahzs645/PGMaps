import { useEffect, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { CHM_MIN_ZOOM } from '@/lib/forestry/canopy/chmView'
import type { LonLatBounds } from '@/lib/forestry/canopy/metaChm'

export interface CanopyView {
  /** The view as it last came to rest, or null below the minimum zoom. */
  bounds: LonLatBounds | null
  /** Zoom of that view. */
  zoom: number | null
  /** Below `CHM_MIN_ZOOM`, where the layer draws nothing. */
  paused: boolean
}

const EMPTY: CanopyView = { bounds: null, zoom: null, paused: false }

/**
 * What the canopy card reads from the plan: the view each time it comes to rest. The tiles follow the
 * map on their own; nothing here changes while it moves, so the card never blinks during a pan.
 */
export function useCanopyView(map: MapLibreMap | null, visible: boolean): CanopyView {
  const [owner, setOwner] = useState({ map, visible })
  const [view, setView] = useState<CanopyView>(EMPTY)
  if (owner.map !== map || owner.visible !== visible) {
    setOwner({ map, visible })
    setView(EMPTY)
  }
  useEffect(() => {
    if (!map || !visible) return
    const settle = () => {
      if (map.isMoving()) return
      const zoom = map.getZoom()
      const paused = zoom < CHM_MIN_ZOOM
      const b = map.getBounds()
      const bounds: LonLatBounds | null = paused ? null : [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
      setView((previous) =>
        previous.paused === paused && previous.zoom === zoom && previous.bounds?.join() === bounds?.join()
          ? previous
          : { bounds, zoom, paused },
      )
    }
    settle()
    map.on('moveend', settle)
    map.on('resize', settle)
    return () => {
      map.off('moveend', settle)
      map.off('resize', settle)
    }
  }, [map, visible])
  return visible && map ? view : EMPTY
}
