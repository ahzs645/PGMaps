import { memo, useEffect, useMemo, useRef } from 'react'
import { LngLatBounds, type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'
import { Map as AppMap, MapControls, MapMarker, MarkerContent, MapScaleBar, useMap } from '@/components/ui/map'
import { MapLineLayer } from '@/components/ui/map-layers'
import { snapPoint, type RouteMember } from './routing'
import { assetBase, type CityConfig } from './cities'
import type { FlattenController } from './useFlatten'
import { StreetCanvas } from './StreetCanvas'
import { SmoothRoute } from './SmoothRoute'

function mapStyle(dark: boolean, city: CityConfig): StyleSpecification {
  const DATA = city.data
  const [[south, west], [north, east]] = DATA.hillshade.bounds
  return {
    version: 8,
    sources: { 'flatten-hillshade': { type: 'image', url: assetBase(city.id) + DATA.hillshade.url.split('/').pop(), coordinates: [[west, north], [east, north], [east, south], [west, south]] } },
    layers: [
      { id: 'flatten-background', type: 'background', paint: { 'background-color': dark ? '#141b24' : '#f5f6f7' } },
      { id: 'flatten-hillshade', type: 'raster', source: 'flatten-hillshade', paint: { 'raster-opacity': dark ? 0.23 : 0.8, 'raster-resampling': 'linear' } },
    ],
  }
}

function Scene({ controller, hoverIndex, onReady }: { controller: FlattenController; hoverIndex: number | null; onReady: (map: MapLibreMap | null) => void }) {
  const { map, isLoaded } = useMap()
  const draggingRef = useRef(false)
  const lastFit = useRef('')
  const { model, trip, family, selected, setPoint, focus, setDragging } = controller
  const setPointRef = useRef(setPoint)
  setPointRef.current = setPoint
  const pendingDrag = useRef<{ which: 'from' | 'to'; lng: number; lat: number } | null>(null)
  const dragTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastDragUpdate = useRef(-Infinity)
  const cancelDragUpdate = () => {
    if (dragTimer.current !== null) clearTimeout(dragTimer.current)
    dragTimer.current = null
    pendingDrag.current = null
  }
  const flushDragUpdate = () => {
    const point = pendingDrag.current
    cancelDragUpdate()
    if (!point || !draggingRef.current) return
    lastDragUpdate.current = performance.now()
    setPointRef.current(point.which, { lon: point.lng, lat: point.lat, label: '' })
  }
  const updateDrag = (which: 'from' | 'to', { lng, lat }: { lng: number; lat: number }) => {
    pendingDrag.current = { which, lng, lat }
    const remaining = 100 - (performance.now() - lastDragUpdate.current)
    if (remaining <= 0) flushDragUpdate()
    else if (dragTimer.current === null) dragTimer.current = setTimeout(flushDragUpdate, remaining)
  }
  useEffect(() => () => { if (dragTimer.current !== null) clearTimeout(dragTimer.current) }, [])
  useEffect(() => { onReady(map); return () => onReady(null) }, [map, onReady])
  useEffect(() => {
    if (!map || !isLoaded || !model) return
    const click = (event: { lngLat: { lng: number; lat: number }; originalEvent: MouseEvent }) => {
      if ((event.originalEvent.target as Element)?.closest('.maplibregl-marker')) return
      const which = trip.loop || !trip.from ? 'from' : !trip.to ? 'to' : focus
      setPoint(which, { lon: event.lngLat.lng, lat: event.lngLat.lat, label: '' })
    }
    map.on('click', click)
    return () => { map.off('click', click) }
  }, [map, isLoaded, model, trip.loop, trip.from, trip.to, focus, setPoint])
  const fitKey = `${controller.fitRequest}:${trip.mode}:${trip.loop}:${trip.loop ? trip.loopMi : ''}`
  useEffect(() => {
    if (!map || !isLoaded || !family?.members.length || family.partial || controller.searching || draggingRef.current || lastFit.current === fitKey) return
    lastFit.current = fitKey
    const bounds = new LngLatBounds()
    for (const member of family.members) for (const coord of member.coordinates) bounds.extend(coord)
    const mobile = map.getContainer().clientWidth < 640
    const sheet = parseFloat(getComputedStyle(map.getContainer()).getPropertyValue('--map-mobile-sheet-visible-height')) || 0
    const bottom = mobile ? Math.min(Math.max(140, sheet + 36), map.getContainer().clientHeight - 120) : 48
    // Keep the endpoint grab areas clear of the shared controls on the right.
    map.fitBounds(bounds, { padding: { left: 48, right: mobile ? 88 : 72, top: 48, bottom }, maxZoom: 15, duration: 0 })
  }, [map, isLoaded, family, fitKey, controller.searching])
  const routeData = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => ({ type: 'FeatureCollection', features: family?.members.map((member, id) => ({ type: 'Feature', properties: { id }, geometry: { type: 'LineString', coordinates: member.coordinates } })) ?? [] }), [family])
  const hoverPoint = model && selected && hoverIndex !== null ? hoverNode(model.graph, selected, hoverIndex) : null
  return <>
    {model && <StreetCanvas geometry={model.geometry} />}
    <MapLineLayer sourceKey="flatten-alternatives" data={routeData} interactive={false} sourceTolerance={0} color="#64748b" width={2} opacity={0.38} />
    {selected && <SmoothRoute coordinates={selected.coordinates} />}
    {model && (['from', 'to'] as const).map((which) => {
      const place = trip[which]
      if (!place || (which === 'to' && trip.loop)) return null
      const point = snapPoint(model, place, trip.mode)
      return <MapMarker key={which} longitude={point.lon} latitude={point.lat} draggable onClick={() => controller.setFocus(which)}
        onDragStart={() => { cancelDragUpdate(); lastDragUpdate.current = -Infinity; draggingRef.current = true; setDragging(true); controller.setFocus(which) }}
        onDrag={(point) => updateDrag(which, point)}
        onDragEnd={({ lng, lat }) => { cancelDragUpdate(); draggingRef.current = false; setPoint(which, { lon: lng, lat, label: '' }); setDragging(false) }}>
        <MarkerContent><button type="button" aria-label={which === 'from' ? 'Move start point' : 'Move finish point'} aria-pressed={focus === which}
          title={`${which === 'from' ? 'Start' : 'Destination'}: ${point.label} · drag to move`}
          onFocus={() => controller.setFocus(which)} onClick={() => controller.setFocus(which)}
          className="flex h-11 w-11 touch-none select-none items-center justify-center rounded-full cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">
          <span className={`pointer-events-none h-5 w-5 rounded-full border-[3px] border-white shadow-md ${which === 'from' ? 'bg-emerald-600' : 'bg-slate-800'}`} />
        </button></MarkerContent>
      </MapMarker>
    })}
    <NeighbourhoodLabels city={controller.city} />
    {hoverPoint && <MapMarker longitude={hoverPoint[0]} latitude={hoverPoint[1]} className="pointer-events-none"><MarkerContent className="pointer-events-none"><span className="block h-3 w-3 rounded-full border-2 border-white bg-emerald-600 shadow-md" /></MarkerContent></MapMarker>}
    <MapScaleBar position="bottom-left" />
  </>
}
const NeighbourhoodLabels = memo(function NeighbourhoodLabels({ city }: { city: CityConfig }) {
  return <>{city.data.labels.map((label) => <MapMarker key={label.n} longitude={label.lon} latitude={label.lat} className="pointer-events-none">
    <MarkerContent className="pointer-events-none"><span className="whitespace-nowrap rounded-sm bg-background/55 px-1 text-[11px] text-muted-foreground">{label.n}</span></MarkerContent>
  </MapMarker>)}</>
})
function hoverNode(graph: NonNullable<FlattenController['model']>['graph'], selected: RouteMember, index: number): [number, number] {
  const safe = Math.max(0, Math.min(selected.arcs.length, index))
  const node = safe === 0 ? graph.arcTail(selected.arcs[0]) : graph.head[selected.arcs[safe - 1]]
  return [graph.nodeLon(node), graph.nodeLat(node)]
}

export function FlattenMap(props: { controller: FlattenController; hoverIndex: number | null; onReady: (map: MapLibreMap | null) => void }) {
  const city = props.controller.city
  const styles = useMemo(() => ({ light: mapStyle(false, city), dark: mapStyle(true, city) }), [city])
  return <AppMap center={city.center} zoom={city.zoom} minZoom={10} maxZoom={18} styles={styles}
    controls={<MapControls showCompass showFullscreen />} loading={props.controller.loading}
    attributionControl={{ compact: true, customAttribution: city.attribution }}>
    <Scene {...props} />
  </AppMap>
}
