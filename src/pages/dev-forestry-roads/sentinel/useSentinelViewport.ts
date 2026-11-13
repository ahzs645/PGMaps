import { useEffect, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { SENTINEL_MIN_ZOOM, SENTINEL_VIEW_IDLE_MS } from './limits'
import type { LonLatBounds } from './stac'
import { sentinelViewBounds } from './viewport'

type View = { bounds: LonLatBounds | null; moving: boolean; zoom: number | null }
const EMPTY_VIEW: View = { bounds: null, moving: false, zoom: null }

/** Subscribe only while enabled; a drag cancels pending work and only its settled view is read. */
export function useSentinelViewport(map: MapLibreMap | null, visible: boolean) {
  const [owner, setOwner] = useState({ map, visible })
  const [view, setView] = useState<View>(EMPTY_VIEW)
  if (owner.map !== map || owner.visible !== visible) {
    setOwner({ map, visible })
    setView(EMPTY_VIEW)
  }
  useEffect(() => {
    if (!map || !visible) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const start = () => {
      clearTimeout(timer)
      setView((previous) => ({ ...previous, moving: true, zoom: map.getZoom() }))
    }
    const finish = () => {
      clearTimeout(timer)
      const zoom = map.getZoom()
      if (zoom < SENTINEL_MIN_ZOOM) {
        setView({ bounds: null, moving: false, zoom })
        return
      }
      timer = setTimeout(() => {
        if (map.isMoving()) return
        const b = map.getBounds()
        setView({
          bounds: sentinelViewBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom()),
          moving: false,
          zoom: map.getZoom(),
        })
      }, SENTINEL_VIEW_IDLE_MS)
    }
    map.on('movestart', start)
    map.on('moveend', finish)
    map.on('resize', finish)
    if (map.isMoving()) start()
    else finish()
    return () => {
      clearTimeout(timer)
      map.off('movestart', start)
      map.off('moveend', finish)
      map.off('resize', finish)
    }
  }, [map, visible])
  return {
    bounds: visible && map ? view.bounds : null,
    paused: view.zoom !== null && view.zoom < SENTINEL_MIN_ZOOM,
    moving: view.moving,
  }
}
