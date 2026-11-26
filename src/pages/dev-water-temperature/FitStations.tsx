import { useEffect, useRef } from 'react'
import { fitMapToPoints } from '@pgmaps/geo-toolkit/map/map-fit'
import { LocateFixed } from 'lucide-react'
import { HoverTip } from '@/components/ui/info-tip'
import { useMap } from '@/components/ui/map'
import { MAP_CONTROL_SQUARE } from '@/components/ui/map-control-overflow'
import { cn } from '@/lib/utils'

type StationPoint = { longitude: number; latitude: number }

type MapInstance = NonNullable<ReturnType<typeof useMap>['map']>

const fitStations = (map: MapInstance, stations: readonly StationPoint[], duration: number) =>
  fitMapToPoints(
    map,
    stations.map((station) => [station.longitude, station.latitude]),
    { padding: 48, maxZoom: 8, minSpan: 0, pad: 0, duration },
  )

/**
 * Frames every station. Rendered inside `MapControls`, so it stacks under the zoom buttons at
 * their own size on every device. `fitOnLoad` frames the stations once, when they first arrive.
 */
export function FitStations({
  stations,
  fitOnLoad = false,
}: {
  stations: readonly StationPoint[]
  fitOnLoad?: boolean
}) {
  const { map, isLoaded } = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (!fitOnLoad || fitted.current || !map || !isLoaded || !stations.length) return
    fitted.current = true
    fitStations(map, stations, 0)
  }, [fitOnLoad, map, isLoaded, stations])

  const disabled = !map || !isLoaded || !stations.length
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background shadow-sm">
      <HoverTip content="Fit all stations">
        <button
          type="button"
          aria-label="Fit all stations"
          disabled={disabled}
          onClick={() => map && fitStations(map, stations, 300)}
          className={cn(
            'flex items-center justify-center transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-accent/40',
            MAP_CONTROL_SQUARE,
          )}
        >
          <LocateFixed className="size-4" />
        </button>
      </HoverTip>
    </div>
  )
}
