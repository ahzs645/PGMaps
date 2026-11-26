import { fitMapToPoints } from '@pgmaps/geo-toolkit/map/map-fit'
import { LocateFixed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMap } from '@/components/ui/map'

export function FitStations({ stations }: { stations: readonly { longitude: number; latitude: number }[] }) {
  const { map, isLoaded } = useMap()
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Fit all stations"
      title="Fit all stations"
      className="absolute right-2 top-24 z-10 size-8"
      disabled={!map || !isLoaded || !stations.length}
      onClick={() => {
        if (map)
          fitMapToPoints(
            map,
            stations.map((station) => [station.longitude, station.latitude]),
            {
              padding: 35,
              maxZoom: 8,
              duration: 0,
              minSpan: 0,
              pad: 0,
            },
          )
      }}
    >
      <LocateFixed className="size-4" />
    </Button>
  )
}
