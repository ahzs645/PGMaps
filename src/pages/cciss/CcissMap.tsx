import { useEffect } from 'react'
import { Map, MapMarker, MarkerContent, useMap, WORKSPACE_MAP_CONTROLS } from '@/components/ui/map'
import { MapRasterLayer } from '@/components/ui/map-layers'
import {
  MapCategoricalRaster,
  type CategoricalRasterPick,
  type CategoricalRasterStatus,
} from '@/components/ui/map-categorical-raster'
import { LegendItem, MapLegendNote, MapLegendPanel, MapMarkerDot, MapSwatch } from '@/components/ui/map-panels'
import { useObserveMapViewport } from '@/components/ui/map-viewport'
import { ccissTileUrl, type CcissLayerSelection } from './layers'
import { NativeSuitabilityLayer } from './NativeSuitabilityLayer'
import { SUITABILITY_LEGEND, suitabilityColor, TRACE_UNCERTAIN_LEGEND, traceColor } from './palette'
import type { GeoTIFFImage } from './raster'

/** What the map draws for the current selection and source; `null` draws nothing. */
export type CcissOverlay =
  | { kind: 'polygons'; manifestUrl: string; trace: boolean }
  | { kind: 'native'; image: GeoTIFFImage; tileId: string }
  | { kind: 'tiles'; tileId: string }
  | null

const POINT_COLOR = '#c026d3'

/** Map clicks set the inspection point, except where a polygon layer picks its own. */
function ClickToInspect({ onSelect }: { onSelect: (point: [number, number]) => void }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    const handleClick = (event: { lngLat: { lng: number; lat: number } }) =>
      onSelect([event.lngLat.lng, event.lngLat.lat])
    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
    }
  }, [map, isLoaded, onSelect])
  return null
}

/** The camera lives in `lng`/`lat`/`z`, apart from the inspection point, so panning never moves an assessment. */
function SyncMapUrl() {
  const { map, isLoaded } = useMap()
  useObserveMapViewport(
    map,
    ({ zoom }) => {
      if (!map) return
      const center = map.getCenter()
      const url = new URL(window.location.href)
      url.searchParams.set('lng', center.lng.toFixed(6))
      url.searchParams.set('lat', center.lat.toFixed(6))
      url.searchParams.set('z', zoom.toFixed(2))
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
    },
    { enabled: isLoaded, events: ['moveend'], initial: 'none' },
  )
  return null
}

function SuitabilityLegend({
  selection,
  statisticCount,
  trace,
}: {
  selection: CcissLayerSelection
  statisticCount: number
  trace: boolean
}) {
  if (selection.kind !== 'suitability') return null
  if (selection.statistic === 'MeanChange' && !selection.period.startsWith('1961_1990')) {
    if (statisticCount < 2) return null
    return (
      <MapLegendPanel title="Suitability change" collapsible defaultCollapsed="mobile" width="sm">
        <MapLegendNote>
          Red tones indicate decline; blue tones indicate improvement. See the CCISS Spatial legend for newly suitable
          and unsuitable classes.
        </MapLegendNote>
      </MapLegendPanel>
    )
  }
  const items = trace ? [...SUITABILITY_LEGEND, TRACE_UNCERTAIN_LEGEND] : SUITABILITY_LEGEND
  return (
    <MapLegendPanel title="Climatic suitability" collapsible defaultCollapsed="mobile" width="fit">
      {items.map((item) => (
        <LegendItem
          key={item.label}
          color={item.color}
          label={item.label}
          swatch={<MapSwatch color={item.color} style={{ borderColor: 'rgb(0 0 0 / 0.25)' }} />}
        />
      ))}
    </MapLegendPanel>
  )
}

export function CcissMap({
  camera,
  overlay,
  selection,
  statisticCount,
  point,
  onPointChange,
  onPickPolygon,
  onPolygonStatus,
}: {
  camera: { center: [number, number]; zoom: number }
  overlay: CcissOverlay
  selection: CcissLayerSelection
  statisticCount: number
  point: [number, number]
  onPointChange: (point: [number, number]) => void
  onPickPolygon: (pick: CategoricalRasterPick) => void
  onPolygonStatus: (status: CategoricalRasterStatus) => void
}) {
  return (
    <Map center={camera.center} zoom={camera.zoom} controls={WORKSPACE_MAP_CONTROLS}>
      <SyncMapUrl />
      {overlay?.kind === 'polygons' && (
        <MapCategoricalRaster
          manifestUrl={overlay.manifestUrl}
          colorForValue={overlay.trace ? traceColor : suitabilityColor}
          onPick={onPickPolygon}
          onStatus={onPolygonStatus}
          attribution={
            overlay.trace
              ? 'Inferred CCISS WebP colours · BC Ministry of Forests'
              : 'CCISS GeoTIFF download · BC Ministry of Forests'
          }
        />
      )}
      {overlay?.kind === 'native' && <NativeSuitabilityLayer key={overlay.tileId} image={overlay.image} />}
      {overlay?.kind === 'tiles' && (
        <MapRasterLayer
          key={overlay.tileId}
          tiles={[ccissTileUrl(overlay.tileId)]}
          minZoom={5}
          maxZoom={12}
          opacity={0.8}
          resampling="nearest"
          attribution="CCISS · BC Ministry of Forests"
        />
      )}
      {overlay?.kind !== 'polygons' && <ClickToInspect onSelect={onPointChange} />}
      <MapMarker longitude={point[0]} latitude={point[1]}>
        <MarkerContent>
          <MapMarkerDot color={POINT_COLOR} className="size-4 ring-4 ring-fuchsia-300/50" />
        </MarkerContent>
      </MapMarker>
      {overlay && (
        <SuitabilityLegend
          selection={selection}
          statisticCount={statisticCount}
          trace={overlay.kind === 'polygons' && overlay.trace}
        />
      )}
    </Map>
  )
}
