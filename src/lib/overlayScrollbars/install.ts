/**
 * The application's one scrollbar. Installed once (`main.tsx`), it hides every native scrollbar and draws a thumb
 * over the edge of whichever scroller the pointer is in or the reader is scrolling: sidebars, dialogs, lists, tables,
 * menus and the page itself, in the application's own code and in the toolkit's alike. A scroller stays a native one
 * (wheel, keys, touch, `scrollTo`, sticky children, virtual lists); only the bar is ours, so no element reserves a
 * strip for it and content keeps one width whether or not it scrolls.
 *
 * Nothing is mounted per scroller and no component opts in: a new `overflow-y-auto` anywhere gets the same bar. The
 * look is in `src/index.css` (`.overlay-scrollbar`), the arithmetic in `geometry.ts`. Two ways out, both in CSS or
 * markup, never here: `--overlay-scrollbar: none` on a scroller that shows no bar on purpose (a tab strip, a ribbon
 * band), and `data-native-scrollbar` on an element that must keep the browser's own.
 *
 * Browser only.
 */
import { dragOffset, thumbGeometry, type ThumbGeometry } from './geometry'

/** How long a bar stays after the last scroll when the pointer is not in its scroller. */
const LINGER_MS = 900
/** The track's thickness, pixels: the strip that takes the pointer. Keep in step with `.overlay-scrollbar` in CSS. */
const TRACK_PX = 12
/** A press on the track pages by this share of the port, as a native track does. */
const PAGE_SHARE = 0.9

type Axis = 'y' | 'x'
const AXES: readonly Axis[] = ['y', 'x']
const SCROLLS = /^(auto|scroll|overlay)$/

interface Bar {
  axis: Axis
  track: HTMLDivElement
  thumb: HTMLDivElement
  geometry: ThumbGeometry | null
}

const installedFlag = '__pgmapsOverlayScrollbars'

/** Whether this device has a mouse or trackpad. A touch-only device keeps its own overlay scrollbars. */
const hasFinePointer = () => typeof matchMedia !== 'function' || matchMedia('(any-pointer: fine)').matches

/**
 * Installs the overlay scrollbar for this document. Returns what removes it. A second call while one is installed
 * returns the first's removal and installs nothing.
 */
export function installOverlayScrollbars(): () => void {
  const host = window as unknown as Record<string, (() => void) | undefined>
  if (host[installedFlag]) return host[installedFlag]!
  if (!hasFinePointer()) return () => {}

  const root = document.documentElement
  const page = () => (document.scrollingElement as HTMLElement | null) ?? root
  const isPage = (element: Element) => element === root || element === document.body || element === page()

  const bars: Bar[] = AXES.map((axis) => {
    const track = document.createElement('div')
    track.className = 'overlay-scrollbar'
    track.dataset.axis = axis
    track.setAttribute('aria-hidden', 'true')
    track.hidden = true
    const thumb = document.createElement('div')
    thumb.className = 'overlay-scrollbar-thumb'
    track.append(thumb)
    return { axis, track, thumb, geometry: null }
  })

  /** The scroller the bars stand for now, and why they are up. */
  let target: HTMLElement | null = null
  let hovered: HTMLElement | null = null
  let dragging: { bar: Bar; from: number; offset: number } | null = null
  let overBar = false
  let frame = 0
  let linger = 0

  const scrollable = (element: HTMLElement, axis: Axis, style: CSSStyleDeclaration) => {
    const content = axis === 'y' ? element.scrollHeight : element.scrollWidth
    const port = axis === 'y' ? element.clientHeight : element.clientWidth
    if (content - port <= 1) return false
    // The page scrolls whatever its `overflow` says; anything else only when it is set to.
    return isPage(element) || SCROLLS.test(axis === 'y' ? style.overflowY : style.overflowX)
  }
  /** The nearest scroller at or above `from` that shows a bar, or null. */
  const scrollerOf = (from: Element | null): HTMLElement | null => {
    for (let element = from; element && element !== root; element = element.parentElement) {
      if (!(element instanceof HTMLElement) || element === document.body) continue
      const style = getComputedStyle(element)
      if (style.getPropertyValue('--overlay-scrollbar').trim() === 'none') continue
      if (element.closest('[data-native-scrollbar]')) return null
      if (scrollable(element, 'y', style) || scrollable(element, 'x', style)) return element
    }
    const whole = page()
    const style = getComputedStyle(whole)
    return scrollable(whole, 'y', style) || scrollable(whole, 'x', style) ? whole : null
  }

  const layout = () => {
    frame = 0
    const element = target
    if (!element || !element.isConnected) return hide()
    const whole = isPage(element)
    const box = whole ? null : element.getBoundingClientRect()
    const left = box ? box.left + element.clientLeft : 0
    const top = box ? box.top + element.clientTop : 0
    const width = whole ? root.clientWidth : element.clientWidth
    const height = whole ? root.clientHeight : element.clientHeight
    const style = getComputedStyle(element)
    const on = { y: scrollable(element, 'y', style), x: scrollable(element, 'x', style) }
    for (const bar of bars) {
      const vertical = bar.axis === 'y'
      // Where both bars show, each stops short of the corner they would share.
      const track = (vertical ? height : width) - (on.x && on.y ? TRACK_PX : 0)
      bar.geometry = on[bar.axis]
        ? thumbGeometry({
            port: vertical ? height : width,
            content: vertical ? element.scrollHeight : element.scrollWidth,
            offset: vertical ? element.scrollTop : Math.abs(element.scrollLeft),
            track,
          })
        : null
      bar.track.hidden = !bar.geometry
      if (!bar.geometry) continue
      const s = bar.track.style
      if (vertical) {
        s.left = `${left + width - TRACK_PX}px`
        s.top = `${top}px`
        s.width = `${TRACK_PX}px`
        s.height = `${track}px`
        bar.thumb.style.height = `${bar.geometry.size}px`
        bar.thumb.style.width = ''
        bar.thumb.style.transform = `translateY(${bar.geometry.position}px)`
      } else {
        s.left = `${left}px`
        s.top = `${top + height - TRACK_PX}px`
        s.width = `${track}px`
        s.height = `${TRACK_PX}px`
        bar.thumb.style.width = `${bar.geometry.size}px`
        bar.thumb.style.height = ''
        bar.thumb.style.transform = `translateX(${bar.geometry.position}px)`
      }
    }
    // The scroller can move or grow under a still pointer (a pane dragged, a list filling): follow it while shown.
    frame = requestAnimationFrame(layout)
  }
  const hide = () => {
    cancelAnimationFrame(frame)
    frame = 0
    target = null
    for (const bar of bars) {
      bar.track.hidden = true
      bar.track.removeAttribute('data-active')
    }
  }
  const show = (element: HTMLElement) => {
    window.clearTimeout(linger)
    if (target !== element) target = element
    for (const bar of bars) bar.track.setAttribute('data-active', '')
    if (!frame) frame = requestAnimationFrame(layout)
  }
  /** Hides the bars once nothing holds them: the pointer has left the scroller and the bars, and no drag is on. */
  const release = (after = 0) => {
    window.clearTimeout(linger)
    linger = window.setTimeout(() => {
      if (dragging || overBar || (hovered && hovered === target)) return
      if (hovered) show(hovered)
      else hide()
    }, after)
  }

  const onScroll = (event: Event) => {
    const source = event.target
    const element = source === document ? page() : source instanceof HTMLElement ? source : null
    if (!element || dragging) return
    // A scroll the reader made: in the scroller under the pointer, in the one holding the focus, or of the page.
    // A list scrolling itself somewhere else (a log, a carousel) raises no bar.
    const focused = document.activeElement
    const theirs =
      element === hovered || isPage(element) || (!!focused && focused !== document.body && element.contains(focused))
    if (!theirs || scrollerOf(element) !== element) return
    show(element)
    release(LINGER_MS)
  }
  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || dragging) return
    const over = event.target instanceof Element ? event.target : null
    if (over?.closest('.overlay-scrollbar')) return
    hovered = scrollerOf(over)
    if (hovered) show(hovered)
    else release()
  }
  const onPointerGone = () => {
    hovered = null
    release()
  }

  const cleanups: Array<() => void> = []
  const listen = <T extends Event>(
    on: EventTarget,
    type: string,
    handler: (event: T) => void,
    options?: AddEventListenerOptions,
  ) => {
    on.addEventListener(type, handler as EventListener, options)
    cleanups.push(() => on.removeEventListener(type, handler as EventListener, options))
  }
  // `scroll` does not bubble: caught on the way down, for every scroller in the document.
  listen(document, 'scroll', onScroll, { capture: true, passive: true })
  listen(document, 'pointerover', onPointerOver, { passive: true })
  listen(root, 'pointerleave', onPointerGone, { passive: true })
  listen(window, 'blur', onPointerGone)

  for (const bar of bars) {
    const vertical = bar.axis === 'y'
    const along = (event: PointerEvent) => (vertical ? event.clientY : event.clientX)
    const offsetOf = (element: HTMLElement) => (vertical ? element.scrollTop : element.scrollLeft)
    const scrollTo = (element: HTMLElement, offset: number, smooth = false) =>
      element.scrollTo({ [vertical ? 'top' : 'left']: offset, behavior: smooth ? 'smooth' : 'auto' })
    listen<PointerEvent>(bar.track, 'pointerenter', () => (overBar = true))
    listen<PointerEvent>(bar.track, 'pointerleave', () => {
      overBar = false
      release()
    })
    // A press on a bar is not a press outside a dialog or a menu: it must not close the layer its scroller is in.
    listen<PointerEvent>(bar.track, 'pointerdown', (event) => {
      if (event.button !== 0 || !target || !bar.geometry) return
      event.preventDefault()
      event.stopPropagation()
      if (event.target === bar.thumb) {
        dragging = { bar, from: along(event), offset: offsetOf(target) }
        bar.thumb.setPointerCapture(event.pointerId)
        bar.thumb.setAttribute('data-dragging', '')
        return
      }
      const box = bar.thumb.getBoundingClientRect()
      const before = along(event) < (vertical ? box.top : box.left)
      const port = vertical ? target.clientHeight : target.clientWidth
      scrollTo(target, offsetOf(target) + (before ? -1 : 1) * port * PAGE_SHARE, true)
    })
    listen<MouseEvent>(bar.track, 'mousedown', (event) => event.stopPropagation())
    listen<MouseEvent>(bar.track, 'click', (event) => event.stopPropagation())
    listen<PointerEvent>(bar.thumb, 'pointermove', (event) => {
      if (!dragging || dragging.bar !== bar || !target || !bar.geometry) return
      scrollTo(target, dragOffset(bar.geometry, dragging.offset, along(event) - dragging.from))
    })
    const drop = (event: PointerEvent) => {
      if (!dragging || dragging.bar !== bar) return
      dragging = null
      if (bar.thumb.hasPointerCapture(event.pointerId)) bar.thumb.releasePointerCapture(event.pointerId)
      bar.thumb.removeAttribute('data-dragging')
      release()
    }
    listen<PointerEvent>(bar.thumb, 'pointerup', drop)
    listen<PointerEvent>(bar.thumb, 'pointercancel', drop)
    document.body.append(bar.track)
  }
  root.setAttribute('data-overlay-scrollbars', '')

  const remove = () => {
    window.clearTimeout(linger)
    cancelAnimationFrame(frame)
    for (const cleanup of cleanups) cleanup()
    for (const bar of bars) bar.track.remove()
    root.removeAttribute('data-overlay-scrollbars')
    delete host[installedFlag]
  }
  host[installedFlag] = remove
  return remove
}
