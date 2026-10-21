import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeoJSONSource, ImageSource, MapMouseEvent } from 'maplibre-gl'
import { LocateFixed } from 'lucide-react'
import { Map, MapControls, MapMarker, MapScaleBar, MarkerContent, useMap } from '@/components/ui/map'
import { Button } from '@/components/ui/button'
import { MapGradientLegendItem } from '@/components/ui/map-panels'
import { distance, nearestStation, offsetCoordinate } from './engine'
import { terrainBounds } from './terrain'
import { buildTerrainDisplay, TERRAIN_SLOPE_STOPS } from './terrainDisplay'
import type { Alignment, Coordinate, RoadAnalysis, RoadProject, TerrainSource } from './types'

export type DrawMode = 'inspect' | 'edit' | 'road' | 'profile' | 'cable' | 'stream' | 'avoid'
interface PlanProps {
  project: RoadProject
  alignment: Alignment
  analyses: Map<string, RoadAnalysis>
  source: TerrainSource
  station: number
  onStation: (station: number) => void
  onSelectAlignment: (id: string) => void
  mode: DrawMode
  draft: Coordinate[]
  onDraw: (coordinate: Coordinate) => void
  onMovePoint: (id: string, coordinate: Coordinate) => void
  onHover: (coordinate: Coordinate | null) => void
  onSelectPoint: (id: string) => void
  selectedPoint: string | null
  fitRevision: number
}
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const line = (
  coordinates: Coordinate[],
  properties: GeoJSON.GeoJsonProperties = {},
): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties,
})

function Layers(
  props: PlanProps & { terrainLayer: 'hillshade' | 'slope' | 'elevation' | 'none'; showContours: boolean },
) {
  const { map, isLoaded } = useMap()
  const { mode, onDraw, onStation, onSelectAlignment, onHover } = props
  const activeAlignmentId = props.alignment.id
  const previousFit = useRef('')
  const analysis = props.analyses.get(props.alignment.id)!
  const bounds = useMemo(() => terrainBounds(props.project.terrain), [props.project.terrain])
  const display = useMemo(
    () => (bounds ? buildTerrainDisplay(props.source, bounds, 192) : null),
    [bounds, props.source],
  )
  const chosen = nearestStation(analysis.stations, props.station)
  const allLines = useMemo(
    () =>
      fc(
        props.project.alignments.flatMap((a) => {
          const result = props.analyses.get(a.id)
          if (!result) return []
          if (a.id !== props.alignment.id)
            return [line(result.centerline, { id: a.id, color: a.color, selected: false })]
          return result.stations.slice(1).map((p, i) =>
            line([result.stations[i].coordinate, p.coordinate], {
              id: a.id,
              selected: true,
              chainage: p.chainage,
              color:
                p.groundElevation === null
                  ? '#9ca3af'
                  : p.gradePercent !== null && Math.abs(p.gradePercent) > props.project.settings.maxGradePercent
                    ? '#dc2626'
                    : '#d97706',
            }),
          )
        }),
      ),
    [props.project.alignments, props.project.settings.maxGradePercent, props.analyses, props.alignment.id],
  )
  const corridor = useMemo(
    () =>
      fc(
        analysis.stations.slice(1).flatMap((b, i) => {
          const a = analysis.stations[i]
          if (
            !a.complete ||
            !b.complete ||
            a.leftDaylightM === null ||
            a.rightDaylightM === null ||
            b.leftDaylightM === null ||
            b.rightDaylightM === null
          )
            return []
          const points = [
            offsetCoordinate(a.coordinate, a.bearing - 90, Math.abs(a.leftDaylightM)),
            offsetCoordinate(b.coordinate, b.bearing - 90, Math.abs(b.leftDaylightM)),
            offsetCoordinate(b.coordinate, b.bearing + 90, Math.abs(b.rightDaylightM)),
            offsetCoordinate(a.coordinate, a.bearing + 90, Math.abs(a.rightDaylightM)),
          ]
          return [
            {
              type: 'Feature' as const,
              geometry: { type: 'Polygon' as const, coordinates: [[...points, points[0]]] },
              properties: {},
            },
          ]
        }),
      ),
    [analysis],
  )
  const context = useMemo(
    () =>
      fc(
        props.project.context.map((feature) => ({
          type: 'Feature',
          geometry: feature.geometry,
          properties: { ...feature, geometry: undefined },
        })),
      ),
    [props.project.context],
  )
  const cable = useMemo(
    () => fc(props.project.cables.map((c) => line([c.start, c.end], { name: c.name }))),
    [props.project.cables],
  )
  const draft = useMemo(() => fc(props.draft.length > 1 ? [line(props.draft)] : []), [props.draft])
  const section = useMemo(
    () =>
      fc(
        chosen
          ? [
              line([
                offsetCoordinate(chosen.coordinate, chosen.bearing - 90, props.project.settings.crossSectionHalfWidth),
                offsetCoordinate(chosen.coordinate, chosen.bearing + 90, props.project.settings.crossSectionHalfWidth),
              ]),
            ]
          : [],
      ),
    [chosen, props.project.settings.crossSectionHalfWidth],
  )

  useEffect(() => {
    if (!map || !isLoaded) return
    const key = `${props.project.terrain.sha256 ?? props.project.terrain.name}:${props.fitRevision}`
    if (key === previousFit.current) return
    const coordinates = props.project.alignments.flatMap((a) => a.points.map((p) => p.coordinate))
    if (coordinates.length)
      map.fitBounds(
        [
          [Math.min(...coordinates.map((p) => p[0])), Math.min(...coordinates.map((p) => p[1]))],
          [Math.max(...coordinates.map((p) => p[0])), Math.max(...coordinates.map((p) => p[1]))],
        ],
        { padding: 45, maxZoom: 16, duration: 0 },
      )
    previousFit.current = key
  }, [map, isLoaded, props.project.terrain, props.project.alignments, props.fitRevision])

  useEffect(() => {
    if (!map || !isLoaded) return
    const inputs: Record<string, GeoJSON.FeatureCollection> = {
      roads: allLines,
      corridor,
      context,
      cable,
      draft,
      section,
      contours: display?.contours ?? fc([]),
    }
    for (const [name, data] of Object.entries(inputs)) {
      const id = `road-${name}`
      const existing = map.getSource(id) as GeoJSONSource | undefined
      if (existing) existing.setData(data)
      else map.addSource(id, { type: 'geojson', data })
    }
    if (display && props.terrainLayer !== 'none') {
      const url = display[props.terrainLayer]
      const existing = map.getSource('road-terrain') as ImageSource | undefined
      const coordinates = display.coordinates as [Coordinate, Coordinate, Coordinate, Coordinate]
      if (existing) existing.updateImage({ url, coordinates })
      else map.addSource('road-terrain', { type: 'image', url, coordinates })
      if (!map.getLayer('road-terrain'))
        map.addLayer({
          id: 'road-terrain',
          type: 'raster',
          source: 'road-terrain',
          paint: { 'raster-opacity': 0.82, 'raster-fade-duration': 0 },
        })
    }
    const add = (layer: Parameters<typeof map.addLayer>[0]) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer)
    }
    add({
      id: 'road-contours',
      type: 'line',
      source: 'road-contours',
      paint: { 'line-color': '#57534e', 'line-width': 0.65, 'line-opacity': 0.45 },
    })
    add({
      id: 'road-context-fill',
      type: 'fill',
      source: 'road-context',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#be123c', 'fill-opacity': 0.18 },
    })
    add({
      id: 'road-context-line',
      type: 'line',
      source: 'road-context',
      paint: {
        'line-color': [
          'match',
          ['get', 'kind'],
          'stream',
          '#0284c7',
          'existing-road',
          '#52525b',
          'harvest',
          '#15803d',
          '#be123c',
        ],
        'line-width': 2,
        'line-dasharray': [3, 2],
      },
    })
    add({
      id: 'road-corridor',
      type: 'fill',
      source: 'road-corridor',
      paint: { 'fill-color': '#d97706', 'fill-opacity': 0.25 },
    })
    add({
      id: 'road-alignments-halo',
      type: 'line',
      source: 'road-roads',
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.7 },
    })
    add({
      id: 'road-alignments',
      type: 'line',
      source: 'road-roads',
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 4, 2.5] },
    })
    add({
      id: 'road-cable',
      type: 'line',
      source: 'road-cable',
      paint: { 'line-color': '#7c3aed', 'line-width': 2, 'line-dasharray': [2, 2] },
    })
    add({
      id: 'road-section',
      type: 'line',
      source: 'road-section',
      paint: { 'line-color': '#e11d48', 'line-width': 2 },
    })
    add({
      id: 'road-draft',
      type: 'line',
      source: 'road-draft',
      paint: { 'line-color': '#0d9488', 'line-width': 3, 'line-dasharray': [2, 1] },
    })
    if (map.getLayer('road-terrain'))
      map.setLayoutProperty('road-terrain', 'visibility', props.terrainLayer === 'none' ? 'none' : 'visible')
    map.setLayoutProperty('road-contours', 'visibility', props.showContours ? 'visible' : 'none')
    // Keep all analytical overlays above a replaced terrain image/style.
    for (const id of [
      'road-contours',
      'road-context-fill',
      'road-context-line',
      'road-corridor',
      'road-alignments-halo',
      'road-alignments',
      'road-cable',
      'road-section',
      'road-draft',
    ])
      map.moveLayer(id)
  }, [
    map,
    isLoaded,
    allLines,
    corridor,
    context,
    cable,
    draft,
    section,
    display,
    props.terrainLayer,
    props.showContours,
  ])

  useEffect(() => {
    if (!map || !isLoaded) return
    const click = (e: MapMouseEvent) => {
      if ((e.originalEvent.target as Element)?.closest('.maplibregl-marker')) return
      if (!['inspect', 'edit'].includes(mode)) {
        onDraw([e.lngLat.lng, e.lngLat.lat])
        return
      }
      const hits = map.queryRenderedFeatures(e.point, { layers: ['road-alignments'] })
      const hit = hits[0]?.properties
      if (hit?.id && hit.id !== activeAlignmentId) onSelectAlignment(String(hit.id))
      else if (hit?.chainage !== undefined) onStation(Number(hit.chainage))
      else if (mode === 'inspect' && analysis.stations.length) {
        const nearest = analysis.stations.reduce((best, s) =>
          distance(s.coordinate, [e.lngLat.lng, e.lngLat.lat]) < distance(best.coordinate, [e.lngLat.lng, e.lngLat.lat])
            ? s
            : best,
        )
        onStation(nearest.chainage)
      }
    }
    const move = (e: MapMouseEvent) => {
      if (!['inspect', 'edit'].includes(mode)) onHover([e.lngLat.lng, e.lngLat.lat])
      else {
        const hit = map.queryRenderedFeatures(e.point, { layers: ['road-alignments'] })[0]?.properties
        if (hit?.id === activeAlignmentId && hit.chainage !== undefined) onStation(Number(hit.chainage))
      }
    }
    map.getCanvas().style.cursor = ['inspect', 'edit'].includes(mode) ? '' : 'crosshair'
    map.doubleClickZoom.disable()
    map.on('click', click)
    map.on('mousemove', move)
    return () => {
      map.off('click', click)
      map.off('mousemove', move)
      map.getCanvas().style.cursor = ''
    }
  }, [map, isLoaded, mode, onDraw, onStation, onSelectAlignment, onHover, activeAlignmentId, analysis])

  return (
    <>
      {props.mode === 'edit' &&
        props.alignment.points.map((p, index) => (
          <MapMarker
            key={p.id}
            longitude={p.coordinate[0]}
            latitude={p.coordinate[1]}
            draggable
            onDrag={({ lng, lat }) => props.onMovePoint(p.id, [lng, lat])}
            onClick={() => props.onSelectPoint(p.id)}
          >
            <MarkerContent>
              <button
                aria-label={`Horizontal point ${index + 1}`}
                aria-pressed={props.selectedPoint === p.id}
                className={`size-6 rounded-full border-2 bg-background text-[10px] font-bold shadow ${props.selectedPoint === p.id ? 'border-rose-500 text-rose-600' : 'border-amber-600 text-amber-700'}`}
              >
                {index + 1}
              </button>
            </MarkerContent>
          </MapMarker>
        ))}
      {chosen && (
        <MapMarker longitude={chosen.coordinate[0]} latitude={chosen.coordinate[1]}>
          <MarkerContent>
            <div
              data-testid="road-active-map-station"
              data-chainage={chosen.chainage}
              className="pointer-events-none size-3 rounded-full border-2 border-white bg-rose-600 shadow"
            />
          </MarkerContent>
        </MapMarker>
      )}
      {props.draft.map((coordinate, i) => (
        <MapMarker key={i} longitude={coordinate[0]} latitude={coordinate[1]}>
          <MarkerContent>
            <span className="block size-3 rounded-full border-2 border-white bg-teal-600" />
          </MarkerContent>
        </MapMarker>
      ))}
      {analysis.crossings
        .filter((c) => c.kind === 'stream')
        .map((crossing) => (
          <MapMarker key={crossing.id} longitude={crossing.coordinate[0]} latitude={crossing.coordinate[1]}>
            <MarkerContent>
              <button
                title={`${crossing.name} — crossing review`}
                aria-label={`Select crossing ${crossing.name}`}
                onClick={() => props.onStation(crossing.chainage)}
                className="rounded border border-sky-700 bg-sky-50 px-1 text-xs text-sky-800"
              >
                ≈
              </button>
            </MarkerContent>
          </MapMarker>
        ))}
      <span data-testid="road-map-ready" data-ready={isLoaded} className="sr-only">
        {isLoaded ? 'Road map ready' : 'Loading road map'}
      </span>
      {display && (props.showContours || props.terrainLayer !== 'none') && (
        <div className="pointer-events-none absolute bottom-16 left-2 max-w-[75%] rounded bg-background/90 px-2 py-1 text-[10px]">
          <p className="truncate font-medium" title={props.project.terrain.name}>
            {props.project.terrain.name}
          </p>
          {props.terrainLayer === 'slope' && (
            <MapGradientLegendItem
              className="py-1"
              aria-label="Terrain slope in degrees"
              colors={TERRAIN_SLOPE_STOPS.map((stop) => `${stop.color} ${(stop.value / 60) * 100}%`)}
              minLabel="Slope 0°"
              maxLabel="60°+"
            />
          )}
          {props.terrainLayer === 'elevation' && (
            <p>
              Elevation {Math.round(display.elevationRange[0])}–{Math.round(display.elevationRange[1])} m
            </p>
          )}
          <p>
            {props.showContours ? `${display.contourInterval} m contours · ` : ''}display sampled at ~
            {Math.round(display.resolutionM)} m; analysis uses native terrain
          </p>
        </div>
      )}
    </>
  )
}

export function PlanView(props: PlanProps) {
  const [terrainLayer, setTerrainLayer] = useState<'hillshade' | 'slope' | 'elevation' | 'none'>('hillshade')
  const [showContours, setShowContours] = useState(true)
  const [fit, setFit] = useState(0)
  const center = props.alignment.points[0]?.coordinate ?? [-122.82, 53.89]
  return (
    <div className="relative h-full min-h-[280px] overflow-hidden rounded-lg" data-testid="road-plan-view">
      <Map
        center={center}
        zoom={14}
        controls={<MapControls position="top-right" showZoom showCompass={false} />}
        showLoadingOverlay={false}
      >
        <Layers
          {...props}
          fitRevision={props.fitRevision + fit}
          terrainLayer={terrainLayer}
          showContours={showContours}
        />
        <MapScaleBar position="bottom-left" />
      </Map>
      <div className="absolute left-2 top-2 flex max-w-[calc(100%-60px)] flex-wrap items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
        <select
          aria-label="Terrain display"
          className="min-w-0 rounded border bg-background px-1 py-1 text-xs"
          value={terrainLayer}
          onChange={(e) => setTerrainLayer(e.target.value as typeof terrainLayer)}
        >
          <option value="hillshade">Hillshade</option>
          <option value="slope">Slope</option>
          <option value="elevation">Elevation</option>
          <option value="none">Basemap</option>
        </select>
        <label className="flex items-center gap-1 px-1 text-xs">
          <input type="checkbox" checked={showContours} onChange={(e) => setShowContours(e.target.checked)} />
          Contours
        </label>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Fit road alignments"
          onClick={() => setFit((n) => n + 1)}
        >
          <LocateFixed className="size-4" />
        </Button>
      </div>
    </div>
  )
}
