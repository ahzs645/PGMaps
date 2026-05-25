import { Outlet } from 'react-router-dom'
import { PersistentMapProvider } from '@/components/ui/persistent-map'

/**
 * Layout route shared by the map modes that swap on the same basemap (food
 * safety, air quality). It keeps a single MapLibre instance alive across
 * navigations between its child routes, so switching modes no longer reloads
 * the map or resets the viewport.
 */
export function QualityMapLayout() {
  return (
    <PersistentMapProvider>
      <Outlet />
    </PersistentMapProvider>
  )
}
