import { Outlet, useLocation } from 'react-router-dom'
import { PersistentMapProvider, type MapStylePair } from '@/components/ui/persistent-map'

interface SharedMapLayoutProps {
  /** Initial basemap. Sections can override per-mode via useMapBasemap / SharedMap. */
  defaultStyles?: MapStylePair
  center?: [number, number]
  zoom?: number
}

/**
 * Layout route that keeps a single MapLibre instance alive across all of its
 * child routes. Wrap any group of map modes that share a basemap with this and
 * they will swap without reloading the map or resetting the viewport:
 *
 *   <Route element={<SharedMapLayout />}>
 *     <Route path="/foodmap" element={<FoodMap />} />
 *     <Route path="/airquality" element={<AirQualitySection />} />
 *   </Route>
 *
 * Each child section renders its map via <SharedMap> (or PersistentMapHost) and
 * its overlays via the standard useMap() helpers.
 */
export function SharedMapLayout({ defaultStyles, center, zoom }: SharedMapLayoutProps) {
  const location = useLocation()

  return (
    <PersistentMapProvider
      defaultStyles={defaultStyles}
      center={center}
      zoom={zoom}
      routeLoadingKey={`${location.pathname}${location.search}`}
    >
      <Outlet />
    </PersistentMapProvider>
  )
}
