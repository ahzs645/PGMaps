import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type * as MapLibreGL from 'maplibre-gl'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crosshair,
  ExternalLink,
  Eye,
  Keyboard,
  ScanSearch,
} from 'lucide-react'

import { setColorVisionPreview, useColorVisionPreview } from '@/components/ui/color-vision-preview'
import { useMap } from '@/components/ui/map'
import { useMapCoordinateFormat } from '@/components/ui/map-coordinate-format'
import { terrainElevationAt } from '@/components/ui/map-status-bar'
import { COLOR_VISION_LABELS, COLOR_VISION_MODES } from '@/lib/colorVision'
import { formatCoordinate, formatDms, formatLatLngPlain, formatUtm, googleMapsUrl } from '@/lib/geo/coordinateFormat'
import { cn } from '@/lib/utils'

/** A point the menu was opened on. */
export interface MapMenuPoint {
  lng: number
  lat: number
  /** Pixel position inside the map container. */
  x: number
  y: number
}

/**
 * An entry a page adds to every right-click menu of its map, e.g. "Viewshed from here". It goes
 * after *Centre map here*. Register it with `useMapContextMenuActions`.
 */
export interface MapContextMenuAction {
  id: string
  label: string
  /** A second line, e.g. what the action will use. */
  description?: string
  icon?: ComponentType<{ className?: string }>
  disabled?: boolean
  onSelect: (point: MapMenuPoint) => void
}

const pageActions = new WeakMap<MapLibreGL.Map, Map<string, MapContextMenuAction>>()

/**
 * Adds page actions to the right-click menu of the map this renders inside. The menu reads them
 * when it opens, so the list may change at any time. A page that wants right-click for itself
 * instead (a drawing tool's undo) calls `event.preventDefault()` in its own `contextmenu` handler,
 * and the menu then stays closed.
 */
export function useMapContextMenuActions(actions: readonly MapContextMenuAction[]) {
  const { map } = useMap()
  useEffect(() => {
    if (!map) return
    let entries = pageActions.get(map)
    if (!entries) {
      entries = new Map()
      pageActions.set(map, entries)
    }
    for (const action of actions) entries.set(action.id, action)
    return () => {
      for (const action of actions) if (entries.get(action.id) === action) entries.delete(action.id)
    }
  }, [map, actions])
}

type MenuState = MapMenuPoint & { key: number; elevation: number | null }

/**
 * The right-click (or long-press) menu every PGMaps map shares: the point's coordinate in the
 * chosen format, copy actions in three formats, *What's here?*, *Centre map here*, the page's own
 * actions, *Open in Google Maps*, the colour-vision preview and the keyboard shortcuts.
 *
 * MapLibre 6 already holds `contextmenu` back during a right-drag rotate and fires it for a touch
 * long-press, so the menu listens to the map's own event. It opens after every other handler has
 * run, and stays closed when one called `preventDefault()`.
 */
export function MapContextMenu({
  onWhatsHere,
  onShowShortcuts,
}: {
  onWhatsHere: (point: MapMenuPoint) => void
  onShowShortcuts: () => void
}) {
  const { map } = useMap()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [view, setView] = useState<'main' | 'colour'>('main')
  const [copied, setCopied] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const format = useMapCoordinateFormat()
  const colourVision = useColorVisionPreview()

  useEffect(() => {
    if (!map) return
    let key = 0
    const open = (event: MapLibreGL.MapMouseEvent) => {
      queueMicrotask(() => {
        if (event.defaultPrevented) return
        key += 1
        setView('main')
        setCopied(null)
        setMenu({
          key,
          lng: event.lngLat.lng,
          lat: event.lngLat.lat,
          x: event.point.x,
          y: event.point.y,
          elevation: terrainElevationAt(map, event.lngLat),
        })
      })
    }
    map.on('contextmenu', open)
    return () => {
      map.off('contextmenu', open)
    }
  }, [map])

  useEffect(() => {
    if (!map || !menu) return
    const close = () => setMenu(null)
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', outside, true)
    map.on('movestart', close)
    map.on('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      map.off('movestart', close)
      map.off('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [map, menu])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setMenu(null), 700)
    return () => clearTimeout(timer)
  }, [copied])

  // Keep the menu inside the map: flip it left or up from the pointer when it would run off.
  useLayoutEffect(() => {
    const element = menuRef.current
    if (!element || !menu || !map) return
    const container = map.getContainer()
    const width = container.clientWidth
    const height = container.clientHeight
    const rect = element.getBoundingClientRect()
    const left = menu.x + rect.width + 4 > width ? Math.max(4, menu.x - rect.width) : menu.x
    const top = menu.y + rect.height + 4 > height ? Math.max(4, height - rect.height - 4) : menu.y
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.style.visibility = 'visible'
  }, [map, menu, view])

  useEffect(() => {
    if (!menu) return
    const first = menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')
    first?.focus({ preventScroll: true })
  }, [menu, view])

  if (!map || !menu) return null

  const close = (refocusMap = true) => {
    setMenu(null)
    if (refocusMap) map.getCanvas().focus({ preventScroll: true })
  }

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
    } catch {
      setCopied(null)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [],
    )
    const index = items.indexOf(document.activeElement as HTMLElement)
    const move = (to: number) => {
      event.preventDefault()
      items[(to + items.length) % items.length]?.focus()
    }
    if (event.key === 'ArrowDown') move(index + 1)
    else if (event.key === 'ArrowUp') move(index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(items.length - 1)
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (view === 'colour') setView('main')
      else close()
    } else if (event.key === 'ArrowLeft' && view === 'colour') {
      event.preventDefault()
      setView('main')
    } else if (event.key === 'Tab') {
      event.preventDefault()
      close()
    }
  }

  const utm = formatUtm(menu.lng, menu.lat)
  const point: MapMenuPoint = { lng: menu.lng, lat: menu.lat, x: menu.x, y: menu.y }
  const extra = [...(pageActions.get(map)?.values() ?? [])]

  return createPortal(
    <div
      key={menu.key}
      ref={menuRef}
      role="menu"
      aria-label="Map menu"
      data-testid="map-context-menu"
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: menu.x, top: menu.y, visibility: 'hidden' }}
      className="absolute z-50 w-64 max-w-[calc(100%-0.5rem)] overflow-hidden rounded-md border border-border bg-background/95 py-1 text-xs text-foreground shadow-lg backdrop-blur"
    >
      {view === 'main' ? (
        <>
          <div className="border-b border-border px-3 pb-1.5 pt-1" data-testid="map-context-menu-coordinate">
            <div className="font-mono text-2xs leading-4 tabular-nums">
              {formatCoordinate(menu.lng, menu.lat, format)}
            </div>
            {menu.elevation !== null && (
              <div className="text-2xs leading-4 text-muted-foreground">
                Ground about {Math.round(menu.elevation)} m (map terrain)
              </div>
            )}
          </div>
          <div className="py-1">
            <MenuItem
              icon={copied === 'decimal' ? Check : Copy}
              label={copied === 'decimal' ? 'Copied' : 'Copy coordinates'}
              detail={formatLatLngPlain(menu.lng, menu.lat)}
              mono
              onSelect={() => copy('decimal', formatLatLngPlain(menu.lng, menu.lat))}
            />
            <MenuItem
              icon={copied === 'dms' ? Check : Copy}
              label={copied === 'dms' ? 'Copied' : 'Copy as degrees, minutes, seconds'}
              detail={formatDms(menu.lng, menu.lat)}
              mono
              onSelect={() => copy('dms', formatDms(menu.lng, menu.lat))}
            />
            {utm && (
              <MenuItem
                icon={copied === 'utm' ? Check : Copy}
                label={copied === 'utm' ? 'Copied' : 'Copy as UTM (WGS 84)'}
                detail={utm}
                mono
                onSelect={() => copy('utm', utm)}
              />
            )}
          </div>
          <Separator />
          <div className="py-1">
            <MenuItem
              icon={ScanSearch}
              label="What’s here?"
              detail="Every layer drawn at this point"
              onSelect={() => {
                close(false)
                onWhatsHere(point)
              }}
            />
            <MenuItem
              icon={Crosshair}
              label="Centre map here"
              onSelect={() => {
                close()
                map.easeTo({ center: [menu.lng, menu.lat] })
              }}
            />
            {extra.map((action) => (
              <MenuItem
                key={action.id}
                icon={action.icon}
                label={action.label}
                detail={action.description}
                disabled={action.disabled}
                onSelect={() => {
                  close(false)
                  action.onSelect(point)
                }}
              />
            ))}
            <MenuItem
              icon={ExternalLink}
              label="Open in Google Maps"
              href={googleMapsUrl(menu.lng, menu.lat)}
              onSelect={() => close(false)}
            />
          </div>
          <Separator />
          <div className="py-1">
            <MenuItem
              icon={Eye}
              label="Colour-vision preview"
              detail={colourVision ? COLOR_VISION_LABELS[colourVision].label : 'Off'}
              trailing={<ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />}
              ariaHasPopup
              onSelect={() => setView('colour')}
            />
            <MenuItem
              icon={Keyboard}
              label="Keyboard shortcuts"
              trailing={<kbd className="rounded-sm border border-border px-1 font-mono text-2xs">?</kbd>}
              onSelect={() => {
                close(false)
                onShowShortcuts()
              }}
            />
          </div>
        </>
      ) : (
        <>
          <MenuItem icon={ChevronLeft} label="Colour-vision preview" onSelect={() => setView('main')} />
          <Separator />
          <div className="py-1" role="group" aria-label="Colour-vision preview">
            {[null, ...COLOR_VISION_MODES].map((mode) => (
              <MenuItem
                key={mode ?? 'off'}
                radio
                checked={colourVision === mode}
                label={mode ? COLOR_VISION_LABELS[mode].label : 'Off'}
                detail={mode ? COLOR_VISION_LABELS[mode].description : 'Normal colour vision'}
                onSelect={() => {
                  setColorVisionPreview(mode)
                  close()
                }}
              />
            ))}
            <p className="px-3 pb-1 pt-1.5 text-2xs leading-4 text-muted-foreground">
              Applies to the whole page, legends included, until you turn it off or close the tab.
            </p>
          </div>
        </>
      )}
    </div>,
    map.getContainer(),
  )
}

function Separator() {
  return <div role="separator" className="my-0.5 h-px bg-border" />
}

function MenuItem({
  icon: Icon,
  label,
  detail,
  trailing,
  href,
  disabled,
  radio,
  checked,
  ariaHasPopup,
  mono,
  onSelect,
}: {
  icon?: ComponentType<{ className?: string }>
  label: string
  detail?: string
  trailing?: ReactNode
  href?: string
  disabled?: boolean
  radio?: boolean
  checked?: boolean
  ariaHasPopup?: boolean
  /** Print the detail in the monospace face, for coordinates. */
  mono?: boolean
  onSelect: () => void
}) {
  const className = cn(
    'flex w-full items-start gap-2 px-3 py-1.5 text-left outline-none transition-colors',
    'hover:bg-accent focus-visible:bg-accent',
    disabled && 'pointer-events-none opacity-50',
  )
  const content = (
    <>
      {radio ? (
        <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true">
          {checked && <Check className="size-3.5" />}
        </span>
      ) : Icon ? (
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block leading-5">{label}</span>
        {detail && (
          <span
            className={cn('block truncate text-2xs leading-4 text-muted-foreground', mono && 'font-mono tabular-nums')}
            title={detail}
          >
            {detail}
          </span>
        )}
      </span>
      {trailing && <span className="mt-0.5 shrink-0">{trailing}</span>}
    </>
  )
  const role = radio ? 'menuitemradio' : 'menuitem'
  if (href) {
    return (
      <a
        role={role}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
        className={className}
        onClick={onSelect}
      >
        {content}
      </a>
    )
  }
  return (
    <button
      type="button"
      role={role}
      tabIndex={-1}
      aria-checked={radio ? Boolean(checked) : undefined}
      aria-haspopup={ariaHasPopup ? 'menu' : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      className={className}
      onClick={onSelect}
    >
      {content}
    </button>
  )
}
