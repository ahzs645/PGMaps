/**
 * The arithmetic of `ZoomPan` (`zoom-pan.tsx`): where a zoomed picture stands in its viewport. Free of DOM access, so
 * the rules a reviewer feels (the spot under the pointer stays under it; a picture never leaves a gap at an edge) are
 * tested without a browser.
 *
 * A view is a scale over the fitted picture and the content box's offset in viewport pixels. The content box is the
 * viewport's own size, scaled from its top-left corner.
 */

export type ZoomPanView = { scale: number; x: number; y: number }
export type ZoomPanBox = { width: number; height: number }

/** The picture as it is first shown: whole, in the middle of its box. */
export const FIT_VIEW: ZoomPanView = Object.freeze({ scale: 1, x: 0, y: 0 })

/**
 * The view at another scale with the viewport point `at` kept over the same spot of the picture. The scale is held
 * between fitted and `maxScale` before the picture is moved, so a wheel turned past either end leaves it still.
 */
export function zoomAbout(
  view: ZoomPanView,
  scale: number,
  at: { x: number; y: number },
  maxScale = Infinity,
): ZoomPanView {
  if (!(scale > 0) || !(view.scale > 0)) return view
  const held = Math.max(1, Math.min(Math.max(1, maxScale), scale))
  const ratio = held / view.scale
  return { scale: held, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio }
}

/**
 * The view held to its limits: no smaller than fitted, no larger than `maxScale`, and never moved so far that the
 * content box leaves a gap inside the viewport. At the fitted scale that leaves only one place to stand.
 */
export function clampView(view: ZoomPanView, box: ZoomPanBox, maxScale: number): ZoomPanView {
  const scale = Math.max(1, Math.min(Math.max(1, maxScale), Number.isFinite(view.scale) ? view.scale : 1))
  if (scale === 1) return FIT_VIEW
  const within = (offset: number, length: number) =>
    Math.min(0, Math.max(length - length * scale, Number.isFinite(offset) ? offset : 0))
  return { scale, x: within(view.x, box.width), y: within(view.y, box.height) }
}

/**
 * The largest box of a picture's shape (`aspect`, width over height) that fits in a space, centred by its holder:
 * how a picture is sized to stay whole in view. Zero until the space is measured.
 */
export function fitBox(space: ZoomPanBox, aspect: number): ZoomPanBox {
  if (!(space.width > 0) || !(space.height > 0) || !(aspect > 0)) return { width: 0, height: 0 }
  // The side that binds keeps the space's own length exactly, so the picture's edge sits on the space's edge.
  return space.width / space.height > aspect
    ? { width: space.height * aspect, height: space.height }
    : { width: space.width, height: space.width / aspect }
}
