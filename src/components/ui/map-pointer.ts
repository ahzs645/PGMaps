import type MapLibreGL from 'maplibre-gl'

/**
 * Dismiss a hover tooltip on every way the pointer can leave the map without
 * MapLibre firing `mouseleave`: dragging out over an overlay, switching tabs,
 * or the window losing focus. Attaching only `mouseleave` strands the tooltip.
 *
 * Call inside the effect that owns the tooltip and use the returned function as
 * (part of) its cleanup.
 */
export function attachPointerDismiss(map: MapLibreGL.Map, dismiss: () => void): () => void {
  const canvas = map.getCanvas()

  const handleDocumentPointerMove = (event: PointerEvent) => {
    if (event.target instanceof Node && canvas.contains(event.target)) return
    dismiss()
  }
  const handleVisibilityChange = () => {
    if (document.hidden) dismiss()
  }

  canvas.addEventListener('mouseleave', dismiss)
  document.addEventListener('pointermove', handleDocumentPointerMove, true)
  window.addEventListener('blur', dismiss)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    canvas.removeEventListener('mouseleave', dismiss)
    document.removeEventListener('pointermove', handleDocumentPointerMove, true)
    window.removeEventListener('blur', dismiss)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}
