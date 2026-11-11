import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { Map as AppMap, useMap } from '@/components/ui/map'
import { MapCanvasLayer, MapImageLayer, MapLineLayer, MapRasterLayer } from '@/components/ui/map-layers'
import { MapMarker, MarkerContent } from '@/components/ui/map-markers'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Button } from '@/components/ui/button'
import { defineTableSource, MapTableBridge, useMapTable } from '@/components/map/useMapTable'
import { numberColumn, textColumn } from '@/components/map/tableColumns'
import type { Bounds } from '../dev-view/catalogue'
import type { ControlPair, Coordinate } from './model'
import type { LoadedSource } from './sources'
import type { WarpedPreview } from './preview'
import type { FittedTransformation } from './transforms'
import { StyledSelect } from '@/components/ui/styled-select'

const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)
const SATELLITE: StyleSpecification = {
  version: 8,
  sources: {
    reference: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 20,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community',
    },
  },
  layers: [{ id: 'reference', type: 'raster', source: 'reference' }],
}
const STREET: StyleSpecification = {
  version: 8,
  sources: {
    reference: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'reference', type: 'raster', source: 'reference' }],
}
type ViewMode = 'reference' | 'current' | 'adjusted'

function MapInteraction({
  bounds,
  focus,
  armed,
  onPick,
}: {
  bounds?: Bounds
  focus: number
  armed: boolean
  onPick: (coordinate: Coordinate) => void
}) {
  const { map, isLoaded } = useMap()
  const fitted = useRef<{ map: maplibregl.Map; focus: number } | null>(null)
  useEffect(() => {
    if (!map || !bounds) return
    if (fitted.current?.map === map && fitted.current.focus === focus) return
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 35, maxZoom: 18, duration: 0 },
    )
    fitted.current = { map, focus }
  }, [map, bounds, focus])
  useEffect(() => {
    if (!map) return
    const click = (event: maplibregl.MapMouseEvent) => {
      if (armed) onPick([event.lngLat.lng, event.lngLat.lat])
    }
    map.on('click', click)
    map.getCanvas().style.cursor = armed ? 'crosshair' : ''
    return () => {
      map.off('click', click)
      if (map.getCanvas()) map.getCanvas().style.cursor = ''
    }
  }, [map, armed, onPick])
  return (
    <span className="sr-only" data-testid="georeference-map-status">
      {isLoaded ? 'Reference map ready' : 'Loading reference map'}
    </span>
  )
}

export function ReferencePane({
  source,
  readOnly = false,
  points,
  selectedId,
  preview,
  fit,
  armed,
  onPick,
  onMove,
  onSelect,
}: {
  source: LoadedSource | null
  readOnly?: boolean
  points: ControlPair[]
  selectedId: string | null
  preview: WarpedPreview | null
  fit: FittedTransformation | null
  armed: boolean
  onPick: (coordinate: Coordinate) => void
  onMove: (id: string, coordinate: Coordinate) => void
  onSelect: (id: string) => void
}) {
  const [mode, setMode] = useState<ViewMode>('adjusted')
  const [opacity, setOpacity] = useState(65)
  const [base, setBase] = useState<'satellite' | 'street'>('satellite')
  const [focus, setFocus] = useState(0)
  const [location, setLocation] = useState('')
  const [locationBounds, setLocationBounds] = useState<Bounds | undefined>()
  const [locationError, setLocationError] = useState('')
  const styles = useMemo(
    () => ({ light: base === 'satellite' ? SATELLITE : STREET, dark: base === 'satellite' ? SATELLITE : STREET }),
    [base],
  )
  const bounds = useMemo<Bounds | undefined>(() => {
    if (locationBounds) return locationBounds
    if (mode === 'adjusted' && preview)
      return [
        Math.min(...preview.coordinates.map((p) => p[0])),
        Math.min(...preview.coordinates.map((p) => p[1])),
        Math.max(...preview.coordinates.map((p) => p[0])),
        Math.max(...preview.coordinates.map((p) => p[1])),
      ]
    const original = source?.placement?.bounds || source?.record?.bounds
    if (original) return original
    if (points.length < 2) return undefined
    const xs = points.map((p) => p.coordinate[0]),
      ys = points.map((p) => p.coordinate[1]),
      w = Math.min(...xs),
      e = Math.max(...xs),
      s = Math.min(...ys),
      n = Math.max(...ys)
    const dx = Math.max(0.0001, (e - w) * 0.15),
      dy = Math.max(0.0001, (n - s) * 0.15)
    return [w - dx, s - dy, e + dx, n + dy]
  }, [locationBounds, source, mode, preview, points])
  const residuals = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (fit?.residuals || []).map((r) => ({
        type: 'Feature',
        properties: { id: r.id },
        geometry: { type: 'LineString', coordinates: [r.coordinate, r.predicted] },
      })),
    }),
    [fit],
  )
  const tableSources = useMemo(
    () =>
      points.length
        ? [
            defineTableSource<ControlPair>({
              id: 'control-pairs',
              label: 'Control point pairs',
              rows: points,
              getRowId: (point) => point.id,
              getRowCenter: (point) => point.coordinate,
              columns: [
                numberColumn('number', 'Pair', (point) => points.indexOf(point) + 1),
                textColumn('role', 'Role', (point) => point.role),
                textColumn('enabled', 'Used', (point) => (point.enabled ? 'Yes' : 'No')),
                numberColumn('pixelX', 'Source X (px)', (point) => point.pixel[0]),
                numberColumn('pixelY', 'Source Y (px)', (point) => point.pixel[1]),
                numberColumn('longitude', 'Longitude', (point) => point.coordinate[0], {
                  format: (value) => value.toFixed(7),
                }),
                numberColumn('latitude', 'Latitude', (point) => point.coordinate[1], {
                  format: (value) => value.toFixed(7),
                }),
                numberColumn(
                  'residual',
                  'Disagreement (m)',
                  (point) => fit?.residuals.find((r) => r.id === point.id)?.groundMetres,
                ),
              ],
            }),
          ]
        : [],
    [points, fit],
  )
  const table = useMapTable({
    sources: tableSources,
    selectedRowId: selectedId,
    onSelectRow: (point) => onSelect((point as ControlPair).id),
    url: false,
    flyOnSelect: false,
    inlineButton: true,
    buttonLabel: 'Open control point table',
  })
  const navigate = () => {
    const values = location
      .trim()
      .split(/[,\s]+/)
      .map(Number)
    if (
      values.length !== 2 ||
      !values.every(Number.isFinite) ||
      Math.abs(values[0]) > 180 ||
      Math.abs(values[1]) >= 85
    ) {
      setLocationError('Enter longitude, latitude, for example −125.5, 53.8.')
      return
    }
    setLocationError('')
    setLocationBounds([values[0] - 0.01, values[1] - 0.006, values[0] + 0.01, values[1] + 0.006])
    setFocus((n) => n + 1)
  }
  const fitImage = () => {
    setLocationBounds(undefined)
    setFocus((n) => n + 1)
  }
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border bg-card" aria-label="Reference map editor">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b p-3">
        <div>
          <h2 className="text-sm font-semibold">{readOnly ? '2. Compare the placement' : '2. Match on the map'}</h2>
          <p className="text-xs text-muted-foreground">
            {readOnly
              ? 'Inspect the recorded placement and its reference points'
              : armed
                ? 'Click the matching landmark to complete this pair'
                : 'Drag a numbered marker to refine its target'}
          </p>
        </div>
        <StyledSelect
          aria-label="Reference basemap"
          className="max-w-32 rounded border bg-background px-2 py-1 text-xs"
          value={base}
          onChange={(e) => setBase(e.target.value as typeof base)}
        >
          <option value="satellite">Satellite</option>
          <option value="street">Street map</option>
        </StyledSelect>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <SegmentedControl
          label="Map comparison"
          value={mode}
          onChange={(v) => setMode(v as ViewMode)}
          options={[
            { value: 'reference', label: 'Reference' },
            { value: 'current', label: 'Original placement' },
            { value: 'adjusted', label: 'Adjusted' },
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={fitImage}
          disabled={!source?.placement && !source?.record && !preview && points.length < 2}
        >
          Fit map
        </Button>
        {table.button}
      </div>
      <div className="relative h-[26rem] sm:h-[30.5rem]" data-testid="georeference-reference">
        <AppMap styles={styles} center={[-125.4, 53.8]} zoom={6} cooperativeGestures>
          <MapTableBridge table={table} />
          <MapInteraction bounds={bounds} focus={focus} armed={armed && !readOnly} onPick={onPick} />
          {source?.record?.assets.map((asset, i) => (
            <MapRasterLayer
              key={`${source.descriptor.id}-${i}`}
              id={`georef-original-${i}`}
              tiles={asset.url ? [`pmtiles://${asset.url}/{z}/{x}/{y}`] : asset.tiles!}
              tileSize={256}
              minZoom={asset.minZoom}
              maxZoom={asset.maxZoom}
              bounds={asset.bounds}
              opacity={opacity / 100}
              visible={mode === 'current'}
              addOnStyleLoad
            />
          ))}
          {!source?.record && source?.placement && (
            <MapImageLayer
              url={source.imageUrl}
              coordinates={source.placement.corners}
              opacity={opacity / 100}
              visible={mode === 'current'}
            />
          )}
          {preview && (
            <MapCanvasLayer
              canvas={preview.canvas}
              coordinates={preview.coordinates}
              revision={preview}
              opacity={opacity / 100}
              visible={mode === 'adjusted'}
            />
          )}
          {fit && (
            <MapLineLayer
              data={residuals}
              interactive={false}
              color="#e11d48"
              width={2}
              opacity={0.9}
              layerOrder={500}
            />
          )}
          {points.map((point, index) => (
            <MapMarker
              key={point.id}
              longitude={point.coordinate[0]}
              latitude={point.coordinate[1]}
              draggable={!readOnly}
              onClick={() => onSelect(point.id)}
              onDragEnd={({ lng, lat }) => onMove(point.id, [lng, lat])}
            >
              <MarkerContent>
                <button
                  type="button"
                  aria-label={`Select map point ${index + 1}`}
                  onClick={() => onSelect(point.id)}
                  className={`grid size-7 place-items-center rounded-full border-2 border-white text-xs font-bold text-white shadow-md ${!point.enabled ? 'bg-slate-500' : point.role === 'check' ? 'bg-amber-700' : 'bg-sky-700'} ${selectedId === point.id ? 'ring-2 ring-rose-500 ring-offset-1' : ''}`}
                >
                  {index + 1}
                </button>
              </MarkerContent>
            </MapMarker>
          ))}
          {table.layout.bottomPane && (
            <div className="absolute inset-x-0 bottom-0 z-30 h-64 border-t bg-background">
              {table.layout.bottomPane}
            </div>
          )}
        </AppMap>
        {!preview && mode === 'adjusted' && (
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-sm">
            Add enough control pairs to preview the adjustment. The reference map remains available.
          </div>
        )}
      </div>
      <div className="space-y-2 border-t px-3 py-2">
        <label className="flex items-center gap-3 text-xs">
          Overlay opacity{' '}
          <input
            aria-label="Adjustment opacity"
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="min-w-0 flex-1 accent-sky-700"
          />
          <span className="w-8 text-right tabular-nums">{opacity}%</span>
        </label>
        <div className="flex gap-2">
          <input
            aria-label="Go to longitude latitude"
            placeholder="Longitude, latitude"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') navigate()
            }}
            className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs"
          />
          <Button size="sm" variant="outline" onClick={navigate}>
            Go
          </Button>
        </div>
        {locationError && (
          <p role="alert" className="text-xs text-destructive">
            {locationError}
          </p>
        )}
      </div>
    </section>
  )
}
