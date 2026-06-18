import { Component, useEffect } from 'react'
import type { ReactNode } from 'react'
import { MapPin } from 'lucide-react'

import { Map as PgMap, MapControls, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import type { DroppedLocation, GeocodeResult } from '../types'

function DropMapEvents({
  result,
  onDrop,
}: {
  result: GeocodeResult | null
  onDrop: (location: DroppedLocation) => void
}) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded) return
    const handleClick = (event: { lngLat: { lng: number; lat: number } }) => {
      onDrop({ latitude: event.lngLat.lat, longitude: event.lngLat.lng })
    }
    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
    }
  }, [isLoaded, map, onDrop])

  useEffect(() => {
    if (!map || !isLoaded || !result) return
    map.flyTo({
      center: [result.longitude, result.latitude],
      zoom: Math.max(map.getZoom(), 12),
      duration: 700,
    })
  }, [isLoaded, map, result])

  return null
}

export function AcknowledgementDropMap({
  result,
  loading,
  onDrop,
}: {
  result: GeocodeResult | null
  loading: boolean
  onDrop: (location: DroppedLocation) => void
}) {
  const center: [number, number] = result
    ? [result.longitude, result.latitude]
    : [-122.813, 53.912]

  return (
    <PgMap
      className="h-full min-h-[18rem]"
      center={center}
      zoom={result ? 12 : 10}
      pitch={0}
      bearing={0}
      loading={loading}
      showStyleLoadingOverlay={false}
    >
      <DropMapEvents result={result} onDrop={onDrop} />
      <MapControls position="top-right" showLocate showFullscreen onLocate={(coords) => onDrop({ latitude: coords.latitude, longitude: coords.longitude })} />
      {result && (
        <MapMarker
          longitude={result.longitude}
          latitude={result.latitude}
          draggable
          onDragEnd={(coords) => onDrop({ latitude: coords.lat, longitude: coords.lng })}
          anchor="bottom"
        >
          <MarkerContent>
            <div className="relative flex h-12 w-12 items-center justify-center">
              <span className="absolute h-10 w-10 rounded-full bg-teal-700/20" />
              <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-teal-700 text-white shadow-lg">
                <MapPin className="h-5 w-5" />
              </span>
            </div>
          </MarkerContent>
        </MapMarker>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white/92 px-3 py-2 text-xs shadow-sm backdrop-blur">
        <span className="font-medium text-slate-900">Click the map or drag the pin to test a point.</span>
        <span className="font-mono text-slate-500">
          {result ? `${result.latitude.toFixed(5)}, ${result.longitude.toFixed(5)}` : 'No point selected'}
        </span>
      </div>
    </PgMap>
  )
}

export class LocalMapBoundary extends Component<{ children: ReactNode; result: GeocodeResult | null }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border bg-white text-slate-500 shadow-sm">
          <MapPin className="h-6 w-6" />
        </span>
        <div>
          <div className="text-sm font-semibold text-slate-900">Map unavailable in this browser session</div>
          <p className="mt-1 max-w-md text-xs leading-5 text-slate-600">
            Address search still runs the same source comparison. Try the map in a browser with WebGL enabled.
          </p>
        </div>
        {this.props.result && (
          <div className="rounded-md border bg-white px-3 py-2 font-mono text-xs text-slate-600 shadow-sm">
            {this.props.result.latitude.toFixed(5)}, {this.props.result.longitude.toFixed(5)}
          </div>
        )}
      </div>
    )
  }
}
