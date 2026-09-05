import { useEffect, useRef, useState } from 'react'
import { Marker } from 'maplibre-gl'
import { MapPin, X } from 'lucide-react'
import { Map as PgMap, MapControls, useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'
import type { BuilderLocation } from '../builder'
import { LocalMapBoundary } from './AcknowledgementMap'

type Coordinate = { latitude: number; longitude: number }
function MapInteraction({
  active,
  armed,
  onPick,
}: {
  active?: Coordinate
  armed: boolean
  onPick: (point: Coordinate) => void
}) {
  const { map } = useMap()
  useEffect(() => {
    if (!map || !active) return
    map.flyTo({ center: [active.longitude, active.latitude], zoom: Math.max(map.getZoom(), 9), duration: 0 })
  }, [map, active?.latitude, active?.longitude]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!map || !armed) return
    const handle = (event: { lngLat: { lat: number; lng: number }; originalEvent: MouseEvent }) => {
      if ((event.originalEvent.target as Element)?.closest('button, .maplibregl-marker')) return
      onPick({ latitude: event.lngLat.lat, longitude: event.lngLat.lng })
    }
    map.on('click', handle)
    return () => {
      map.off('click', handle)
    }
  }, [map, armed, onPick])
  return null
}

/** A native button avoids nested interactive controls inside MapLibre's marker wrapper. */
function LocationMarker({
  coordinate,
  label,
  text,
  selected,
  onSelect,
}: {
  coordinate: Coordinate
  label: string
  text: string
  selected?: boolean
  onSelect?: () => void
}) {
  const { map } = useMap()
  const action = useRef(onSelect)
  action.current = onSelect
  const markerRef = useRef<Marker | null>(null)
  const interactive = Boolean(onSelect)
  useEffect(() => {
    if (!map) return
    const element = document.createElement(interactive ? 'button' : 'span')
    if (element instanceof HTMLButtonElement) element.type = 'button'
    else element.setAttribute('role', 'img')
    element.setAttribute('aria-label', label)
    element.textContent = text
    element.className =
      'flex h-11 w-11 items-center justify-center rounded-full border-2 border-white font-semibold text-white shadow'
    const click = (event: Event) => {
      event.stopPropagation()
      action.current?.()
    }
    element.addEventListener('click', click)
    const marker = new Marker({ element, anchor: 'center' })
      .setLngLat([coordinate.longitude, coordinate.latitude])
      .addTo(map)
    markerRef.current = marker
    return () => {
      element.removeEventListener('click', click)
      marker.remove()
      markerRef.current = null
    }
    // Coordinate and color changes update the existing native marker below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, interactive, label, text])
  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    marker.setLngLat([coordinate.longitude, coordinate.latitude])
    if (interactive) marker.getElement().setAttribute('aria-pressed', String(Boolean(selected)))
    marker.getElement().style.backgroundColor = !interactive ? '#b45309' : selected ? '#be123c' : '#0f766e'
  }, [map, coordinate.latitude, coordinate.longitude, selected, interactive, label, text])
  return null
}

export function MultiPointComposer({
  locations,
  activeId,
  onSelect,
  onRemove,
  onMapConfirm,
}: {
  locations: BuilderLocation[]
  activeId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onMapConfirm: (coordinate: Coordinate, replace: boolean) => void
}) {
  const [showMap, setShowMap] = useState(false)
  const [placement, setPlacement] = useState<{ action: 'add' | 'move'; targetId: string | null } | null>(null)
  const mode = placement?.targetId === activeId ? placement.action : null
  const setMode = (action: 'add' | 'move' | null) => setPlacement(action ? { action, targetId: activeId } : null)
  const [pendingCoordinate, setPending] = useState<Coordinate | null>(null)
  const pending = mode ? pendingCoordinate : null
  const active = locations.find((item) => item.id === activeId)
  return (
    <section className="space-y-3" aria-label="Locations">
      <h2 className="text-base font-semibold">Your locations {locations.length > 0 && `(${locations.length})`}</h2>
      {!locations.length && (
        <p className="text-sm leading-6 text-slate-600">
          Search for a B.C. address to begin. You can add more than one location.
        </p>
      )}
      <ul className="space-y-2">
        {locations.map((location, index) => (
          <li
            key={location.id}
            className={cn(
              'flex min-w-0 items-start gap-2 rounded-xl border p-2',
              location.id === activeId && 'border-teal-600 bg-teal-50',
            )}
          >
            <button
              type="button"
              onClick={() => {
                setMode(null)
                setPending(null)
                onSelect(location.id)
              }}
              aria-pressed={location.id === activeId}
              className="flex min-h-11 min-w-0 flex-1 items-start gap-2 p-2 text-left"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-700 text-sm text-white">
                {index + 1}
              </span>
              <span className="min-w-0 break-words text-sm">
                <span className="block font-medium">{location.result.fullAddress}</span>
                <span className="mt-1 block text-slate-600">
                  {location.status === 'loading'
                    ? 'Checking sources…'
                    : location.status === 'error'
                      ? 'Source unavailable — retry in Review Nations'
                      : 'Ready to review'}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(location.id)}
              aria-label={`Remove location ${index + 1}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-white"
            >
              <X className="h-5 w-5" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        aria-expanded={showMap}
        onClick={() => setShowMap((value) => !value)}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium"
      >
        <MapPin className="h-4 w-4" />
        {showMap ? 'Hide map' : 'Choose or view on map'}
      </button>
      {showMap && (
        <div className="space-y-3 rounded-xl border p-3">
          <p className="text-sm text-slate-600">
            Pan and zoom freely. Choose an action below to place a pin, then confirm its location.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={mode === 'add'}
              onClick={() => {
                setMode('add')
                setPending(null)
              }}
              className="min-h-11 rounded-lg border px-3 text-sm"
            >
              Add map location
            </button>
            {active && (
              <button
                type="button"
                aria-pressed={mode === 'move'}
                onClick={() => {
                  setMode('move')
                  setPending(null)
                }}
                className="min-h-11 rounded-lg border px-3 text-sm"
              >
                Move selected location
              </button>
            )}
          </div>
          <div className="relative h-72 overflow-hidden rounded-lg border">
            <LocalMapBoundary result={null}>
              <PgMap
                className="h-72"
                theme="light"
                center={[-124.5, 54.5]}
                zoom={4}
                showStyleLoadingOverlay={false}
                controls={<MapControls position="top-right" showFullscreen />}
              >
                <MapInteraction active={active?.result} armed={mode !== null} onPick={setPending} />
                {locations.map((location, index) => (
                  <LocationMarker
                    key={location.id}
                    coordinate={location.result}
                    label={`Focus point ${index + 1}`}
                    text={String(index + 1)}
                    selected={activeId === location.id}
                    onSelect={() => {
                      setMode(null)
                      setPending(null)
                      onSelect(location.id)
                    }}
                  />
                ))}
                {pending && <LocationMarker coordinate={pending} label="Proposed location" text="?" />}
              </PgMap>
            </LocalMapBoundary>
          </div>
          {mode && (
            <div className="space-y-2" role="status">
              <p className="text-sm">
                {pending
                  ? `Proposed location: ${pending.latitude.toFixed(5)}, ${pending.longitude.toFixed(5)}`
                  : 'Tap the map to propose a location.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!pending}
                  onClick={() => {
                    if (pending) onMapConfirm(pending, mode === 'move')
                    setMode(null)
                    setPending(null)
                  }}
                  className="min-h-11 rounded-lg bg-teal-700 px-4 text-sm text-white disabled:opacity-50"
                >
                  Confirm location
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode(null)
                    setPending(null)
                  }}
                  className="min-h-11 rounded-lg border px-4 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
