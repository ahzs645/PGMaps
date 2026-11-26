import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { useEffect, useMemo, useState } from 'react'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { MapLineLayer } from '@/components/ui/map-layers'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { fetchJson } from '@/lib/fetchJson'

const BOUNDARIES = '/data/boundaries/BCFWA/named_watersheds_stream_order_8_50m.geojson.gz'
type NechakoBoundary = Feature<Polygon | MultiPolygon>
type Position = { longitude: number; latitude: number }
type BoundaryState = { boundary: NechakoBoundary | null; error: boolean }

export function useNechakoBoundary() {
  const [state, setState] = useState<BoundaryState>({ boundary: null, error: false })
  useEffect(() => {
    const controller = new AbortController()
    void fetchJson<FeatureCollection>(BOUNDARIES, controller.signal)
      .then((collection) => {
        const feature = collection.features.find(
          (item): item is NechakoBoundary =>
            String(item.properties?.boundaryCode) === '8886' &&
            (item.geometry?.type === 'Polygon' || item.geometry?.type === 'MultiPolygon'),
        )
        if (!feature) throw new Error('Nechako boundary missing')
        if (!controller.signal.aborted) setState({ boundary: feature, error: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ boundary: null, error: true })
      })
    return () => controller.abort()
  }, [])
  return state
}

export function inNechako(boundary: NechakoBoundary, station: Position) {
  return booleanPointInPolygon({ type: 'Point', coordinates: [station.longitude, station.latitude] }, boundary)
}

export function NechakoScope({
  boundary,
  error,
  active,
  onChange,
}: BoundaryState & { active: boolean; onChange: (active: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <SegmentedControl
        label="Station scope"
        size="sm"
        fullWidth={false}
        value={active ? 'nechako' : 'all'}
        onChange={(value) => onChange(value === 'nechako')}
        options={[
          {
            value: 'nechako',
            label: 'In Nechako',
            disabled: !boundary,
            title: boundary
              ? 'Only stations inside the Nechako watershed (Freshwater Atlas 8886)'
              : 'The watershed boundary is unavailable',
          },
          { value: 'all', label: 'All stations' },
        ]}
      />
      {error && <span className="text-xs text-muted-foreground">Watershed boundary unavailable</span>}
    </div>
  )
}

const DASH = [3, 2]

export function NechakoOutline({ boundary }: { boundary: NechakoBoundary | null }) {
  const data = useMemo<FeatureCollection>(
    () => ({ type: 'FeatureCollection', features: boundary ? [boundary] : [] }),
    [boundary],
  )
  return boundary ? <MapLineLayer data={data} color="#168888" width={1.6} dashArray={DASH} interactive={false} /> : null
}
