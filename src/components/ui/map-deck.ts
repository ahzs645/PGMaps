import { useEffect, useRef, type RefObject } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type MapLibreGL from 'maplibre-gl'
import { useMap } from './map'
import { attachPointerDismiss } from './map-pointer'

export interface UseDeckOverlayOptions {
  /** Skip attaching while false, e.g. a layer the user has toggled off. Defaults to true. */
  enabled?: boolean
  /**
   * Called when the pointer leaves the map, the tab hides, or the window blurs.
   * Omit for overlays that draw no hover tooltip.
   */
  onDismiss?: () => void
  /** Runs once the overlay is attached — the hook's cue to render the first layer set. */
  onAttach?: (overlay: MapboxOverlay, map: MapLibreGL.Map) => void
  /** Runs before the overlay is detached, for anything added alongside it. */
  onDetach?: (map: MapLibreGL.Map) => void
}

/**
 * Attach a single interleaved deck.gl overlay to the map for as long as the
 * component is mounted, and tear it down on unmount or theme change.
 *
 * Layers are pushed through the returned ref (`overlayRef.current?.setProps({
 * layers })`) rather than passed in, because every caller rebuilds its layer
 * list on a different set of dependencies.
 */
export function useDeckOverlay(options: UseDeckOverlayOptions = {}): RefObject<MapboxOverlay | null> {
  const { enabled = true, onDismiss, onAttach, onDetach } = options
  const { map, isLoaded } = useMap()
  const overlayRef = useRef<MapboxOverlay | null>(null)

  // Read through refs so a caller redefining these inline does not re-attach
  // the overlay on every render. useRef seeds them with the first render's
  // values, so the attach effect below sees the right callbacks on mount.
  const onDismissRef = useRef(onDismiss)
  const onAttachRef = useRef(onAttach)
  const onDetachRef = useRef(onDetach)
  useEffect(() => {
    onDismissRef.current = onDismiss
    onAttachRef.current = onAttach
    onDetachRef.current = onDetach
  })

  useEffect(() => {
    if (!isLoaded || !map || !enabled) return

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlay as unknown as MapLibreGL.IControl)
    overlayRef.current = overlay
    onAttachRef.current?.(overlay, map)

    const dismiss = () => onDismissRef.current?.()
    const detachPointerDismiss = attachPointerDismiss(map, dismiss)

    return () => {
      detachPointerDismiss()
      dismiss()
      onDetachRef.current?.(map)
      try {
        map.removeControl(overlay as unknown as MapLibreGL.IControl)
      } catch {
        // MapLibre can throw during style teardown.
      }
      overlayRef.current = null
    }
  }, [isLoaded, map, enabled])

  return overlayRef
}
