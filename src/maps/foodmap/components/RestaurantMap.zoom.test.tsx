import type { ReactNode } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { RestaurantMap } from './RestaurantMap'
import type { MarkerStyle, RestaurantWithStats } from '../types'

const camera = vi.hoisted(() => {
  const state = { zoom: 13 }
  const listeners = new Set<() => void>()
  return {
    state,
    listeners,
    map: {
      getZoom: () => state.zoom,
      on: (_event: string, callback: () => void) => listeners.add(callback),
      off: (_event: string, callback: () => void) => listeners.delete(callback),
    },
  }
})
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/components/ui/map', () => ({
  useMap: () => ({ map: camera.map }),
  MapMarker: () => null,
  MarkerContent: () => null,
  MarkerPopup: () => null,
  MarkerTooltip: () => null,
}))
vi.mock('@/components/ui/map-fly-to', () => ({ useFlyToSelection: () => {} }))
vi.mock('@/components/ui/persistent-map', () => ({
  SharedMap: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/map-layers', () => ({
  MapHeatmapLayer: () => null,
  MapPieClusterLayer: ({ data }: { data: { features: unknown[] } }) => (
    <div data-cluster-count={data.features.length} />
  ),
}))
vi.mock('../hooks/useLingeringMarkers', () => ({ MARKER_FADE_MS: 0, useLingeringMarkers: () => [] }))
vi.mock('./RestaurantSummary', () => ({ RestaurantSummary: () => null }))

const restaurant: RestaurantWithStats = {
  name: 'Test restaurant',
  address: '',
  latitude: 53.9,
  longitude: -122.7,
  facility_type: 'Restaurant',
  establishment_type: 'Restaurant',
  hazard_rating: 'Low',
  details_url: 'test',
  filteredInspections: [],
  hazardRatingAtDate: 'Low',
  violationStats: {
    total: 0,
    critical: 0,
    nonCritical: 0,
    inspectionCount: 0,
    risk: { severe: 0, elevated: 0, moderate: 0, administrative: 0, unknown: 0, score: 0, worstBand: 'Unknown' },
  },
}

describe('food-map zoom reveal', () => {
  it('hands off cluster data at the zoom threshold and removes subscriptions for ordinary styles', () => {
    camera.state.zoom = 13
    const render = (markerStyle: MarkerStyle) => (
      <RestaurantMap
        restaurants={[restaurant]}
        selectedRestaurant={null}
        visualizationMode="hazard"
        markerStyle={markerStyle}
        onRestaurantClick={vi.fn()}
        onViewInspections={vi.fn()}
        onClearSelection={vi.fn()}
      />
    )
    let view: ReturnType<typeof create>
    act(() => {
      view = create(render('cluster'))
    })
    try {
      const count = () =>
        view!.root.findAllByType('div').find((node) => node.props['data-cluster-count'] !== undefined)!.props[
          'data-cluster-count'
        ]
      expect(count()).toBe(1)
      expect(camera.listeners.size).toBe(1)
      act(() => {
        camera.state.zoom = 14
        for (const notify of camera.listeners) notify()
      })
      expect(count()).toBe(0)
      act(() => {
        camera.state.zoom = 13
        for (const notify of camera.listeners) notify()
      })
      expect(count()).toBe(1)
      act(() => view!.update(render('classic')))
      expect(camera.listeners.size).toBe(0)
      act(() => view!.update(render('cluster')))
      expect(count()).toBe(1)
      expect(camera.listeners.size).toBe(1)
    } finally {
      act(() => view!.unmount())
    }
    expect(camera.listeners.size).toBe(0)
  })
})
