import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useMap } from '@/components/ui/map'

/** Room a popup leaves for its offset from the point, its tip and the map's edge, in pixels. */
const POPUP_EDGE_PX = 28
/** The fade over the last of a popup body that scrolls, so a cut line reads as "more below". */
const MORE_FADE_PX = 18

/**
 * The tallest a map popup can be and still fit on its map: half the map's height less its offset,
 * since MapLibre puts a popup on whichever side of its point has more room. Null until the map is
 * there. Follows the map's resizes (a pane drag, fullscreen).
 */
export function useMapPopupMaxHeight(): number | null {
  const { map } = useMap()
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    if (!map) return
    const read = () => setHeight(map.getContainer().clientHeight)
    read()
    map.on('resize', read)
    return () => {
      map.off('resize', read)
    }
  }, [map])
  return height === null ? null : Math.max(120, Math.floor(height / 2 - POPUP_EDGE_PX))
}

/**
 * A popup body that scrolls instead of running off its map, its last lines fading while more is
 * below. Opt in where a card can grow past a short map pane (long warnings, many rows); place it
 * inside `MapPopup`.
 */
export function MapPopupFit({ children }: { children: ReactNode }) {
  const maxHeight = useMapPopupMaxHeight()
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const check = () => {
    const el = ref.current
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 1)
  }
  // Measured after each render and resize: the content or the cap can change the overflow.
  useLayoutEffect(check)
  return (
    <div
      ref={ref}
      className="-m-3 overflow-y-auto overscroll-contain p-3"
      style={{
        ...(maxHeight === null ? {} : { maxHeight }),
        ...(more
          ? {
              maskImage: `linear-gradient(to bottom, black calc(100% - ${MORE_FADE_PX}px), transparent)`,
              WebkitMaskImage: `linear-gradient(to bottom, black calc(100% - ${MORE_FADE_PX}px), transparent)`,
            }
          : {}),
      }}
      onScroll={check}
      data-map-popup-fit
      data-more-below={more || undefined}
    >
      {children}
    </div>
  )
}
