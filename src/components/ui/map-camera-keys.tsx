import { Fragment, useEffect, useRef } from 'react'
import type * as MapLibreGL from 'maplibre-gl'

import { DialogShell } from '@/components/ui/dialog-shell'
import { useMap } from '@/components/ui/map'
import { keyBelongsElsewhere, MAP_SHORTCUTS, mapCameraAction } from '@/lib/geo/mapCameraKeys'

type HomeView = { center: MapLibreGL.LngLatLike; zoom: number; bearing: number; pitch: number }

/**
 * N turns the map north up, U looks straight down, R goes back to where the map started and ?
 * lists every map key. The keys act on the map under the pointer, or the one holding focus, so a
 * page with two maps moves only the one being used; they never act while typing, in a dialog or
 * with Ctrl, Cmd or Alt held. "Where the map started" is the camera once the map first settled,
 * after the page's own opening fit, unless the page gives `home`.
 */
export function MapCameraKeys({ home, onHelp }: { home?: HomeView; onHelp: () => void }) {
  const { map } = useMap()
  const homeRef = useRef<HomeView | undefined>(home)
  const hoveredRef = useRef(false)
  const onHelpRef = useRef(onHelp)
  useEffect(() => {
    onHelpRef.current = onHelp
    if (home) homeRef.current = home
  }, [onHelp, home])

  useEffect(() => {
    if (!map) return
    const container = map.getContainer()
    const capture = () => {
      if (!homeRef.current) {
        homeRef.current = {
          center: map.getCenter(),
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        }
      }
    }
    // The first settle after mount follows the page's opening fit. A map that is already settled
    // and draws nothing new never fires `idle` again, so a timer takes the camera as it stands.
    map.once('idle', capture)
    const fallback = setTimeout(capture, 2500)

    const enter = () => {
      hoveredRef.current = true
    }
    const leave = () => {
      hoveredRef.current = false
    }
    const keydown = (event: KeyboardEvent) => {
      const action = mapCameraAction(event)
      if (!action) return
      if (keyBelongsElsewhere(event.target as Element | null)) return
      const focused = container.contains(document.activeElement)
      if (!hoveredRef.current && !focused) return
      event.preventDefault()
      if (action === 'help') onHelpRef.current()
      else if (action === 'north') map.easeTo({ bearing: 0 })
      else if (action === 'topDown') map.easeTo({ pitch: 0 })
      else if (homeRef.current) map.easeTo({ ...homeRef.current })
    }
    container.addEventListener('pointerenter', enter)
    container.addEventListener('pointerleave', leave)
    window.addEventListener('keydown', keydown)
    return () => {
      clearTimeout(fallback)
      map.off('idle', capture)
      container.removeEventListener('pointerenter', enter)
      container.removeEventListener('pointerleave', leave)
      window.removeEventListener('keydown', keydown)
    }
  }, [map])

  return null
}

/** The list of map keys, opened with ? or from the map menu. */
export function MapShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  const groups = [...new Set(MAP_SHORTCUTS.map((shortcut) => shortcut.group))]
  return (
    <DialogShell
      title="Map keyboard shortcuts"
      size="md"
      onClose={onClose}
      contentProps={{ 'data-testid': 'map-shortcuts' }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group} aria-label={group}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
            <dl className="space-y-1.5 text-sm">
              {MAP_SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                <div key={shortcut.action} className="flex items-baseline justify-between gap-3">
                  <dt className="flex shrink-0 flex-wrap items-center gap-1">
                    {shortcut.keys.map((key, index) => (
                      <Fragment key={key}>
                        {index > 0 && shortcut.keys.length === 2 && /^(Shift|Ctrl)$/.test(shortcut.keys[0]) && (
                          <span className="text-2xs text-muted-foreground">+</span>
                        )}
                        <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs leading-none">
                          {key}
                        </kbd>
                      </Fragment>
                    ))}
                  </dt>
                  <dd className="text-right text-muted-foreground">{shortcut.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </DialogShell>
  )
}
