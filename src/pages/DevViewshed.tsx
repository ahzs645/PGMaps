import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { NativeSelect } from '@/components/ui/form-field'
import { visibilityOutline } from '@/features/terrain-viewshed'
import { useMemo, useRef, useState } from 'react'
import type { StyleSpecification } from 'maplibre-gl'
import { Eye, MapPin, Mountain, Sun } from 'lucide-react'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import {
  Map,
  MapControls,
  MapMarker,
  MapScaleBar,
  MarkerContent,
  MarkerTooltip,
  type MapRef,
} from '@/components/ui/map'
import { MapLineLayer } from '@/components/ui/map-layers'
import { InlineAlert, MapOverlay, MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ToggleRow } from '@/components/ui/toggle-row'
import { StatGroup } from '@/components/ui/stat-group'
import { MapDrawCapture } from './dev-forestry/MapDrawCapture'
import { TerrainSupport } from './dev-forestry/TerrainSupport'
import {
  dateTimeInZone,
  destination,
  solarPosition,
  sunVisibility,
  VIEWSHED_COLORS,
  type GeoPoint,
} from '@/features/terrain-viewshed'
import { ViewshedOverlay, type OverlayMode } from '@/features/terrain-viewshed'
import { useViewshed } from '@/features/terrain-viewshed'

const INITIAL_OBSERVER = { lng: -122.532, lat: 53.872 }
const MOUNTAIN_OBSERVER = { lng: -119.1753, lat: 53.0786 }
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles © Esri — Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
}
const SATELLITE_STYLES = { light: SATELLITE_STYLE, dark: SATELLITE_STYLE }
const MODES = [
  { value: 'standing', label: 'Standing' },
  { value: 'seated', label: 'Seated' },
  { value: 'compare', label: 'Compare' },
] as const
const SUN_LABELS = {
  clear: 'Clear within checked range',
  blocked: 'Blocked by terrain',
  unknown: 'Terrain incomplete',
  'below-horizon': 'Below astronomical horizon',
}
const timeLabel = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export default function DevViewshed() {
  const mapRef = useRef<MapRef>(null)
  const [observer, setObserver] = useState<GeoPoint>(INITIAL_OBSERVER)
  const [radius, setRadius] = useState(5000)
  const [heightA, setHeightA] = useState(1.2)
  const [heightB, setHeightB] = useState(1.7)
  const [mode, setMode] = useState<OverlayMode>('standing')
  const [terrain, setTerrain] = useState(true)
  const [pitch, setPitch] = useState(55)
  const [satellite, setSatellite] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [opacity, setOpacity] = useState(0.6)
  const [retry, setRetry] = useState(0)
  const [zone, setZone] = useState('America/Vancouver')
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Vancouver',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
  )
  const [minutes, setMinutes] = useState(420)
  const [coordinateDraft, setCoordinateDraft] = useState({
    lng: String(INITIAL_OBSERVER.lng),
    lat: String(INITIAL_OBSERVER.lat),
  })
  const [coordinateError, setCoordinateError] = useState('')
  const settings = useMemo(
    () => ({ observer, radiusMeters: radius, heightA, heightB }),
    [observer, radius, heightA, heightB],
  )
  const analysis = useViewshed(settings, retry, dragging)
  const result = analysis.result
  const outline = useMemo(() => visibilityOutline(analysis.overlayResult, mode), [analysis.overlayResult, mode])
  const instant = dateTimeInZone(date, minutes, zone)
  const sun = useMemo(() => {
    const time = dateTimeInZone(date, minutes, zone)
    return time ? solarPosition(time, observer) : null
  }, [date, minutes, zone, observer])
  const sunA = result && sun ? sunVisibility(result, sun, 'A') : null
  const sunB = result && sun ? sunVisibility(result, sun, 'B') : null
  const skylinePath = useMemo(() => {
    if (!result) return ''
    let connected = false
    return Array.from(result.horizonB, (height, index) => {
      // Missing terrain breaks the profile instead of drawing an invented flat skyline.
      if (result.horizonUnknown[index] || !Number.isFinite(height)) {
        connected = false
        return ''
      }
      const command = connected ? 'L' : 'M'
      connected = true
      return `${command}${(index / result.horizonB.length) * 360},${80 - Math.max(-5, Math.min(50, height)) * 1.4}`
    }).join(' ')
  }, [result])
  const boundary = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              Array.from({ length: 181 }, (_, i) => {
                const p = destination(observer, i * 2, radius)
                return [p.lng, p.lat]
              }),
            ],
          },
        },
      ],
    }),
    [observer, radius],
  )
  const sunLine = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!sun) return { type: 'FeatureCollection', features: [] }
    const end = destination(observer, sun.azimuth, radius)
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [observer.lng, observer.lat],
              [end.lng, end.lat],
            ],
          },
        },
      ],
    }
  }, [observer, radius, sun])
  const placeObserver = (point: GeoPoint) => {
    setObserver(point)
    setCoordinateDraft({ lng: point.lng.toFixed(5), lat: point.lat.toFixed(5) })
    setCoordinateError('')
  }
  const percent = (count: number) =>
    result?.counts.total ? `${((count / result.counts.total) * 100).toFixed(1)}%` : '—'
  const legend =
    mode === 'compare'
      ? [
          [VIEWSHED_COLORS.both, 'Visible at both heights'],
          [VIEWSHED_COLORS.aOnly, 'Seated only'],
          [VIEWSHED_COLORS.bOnly, 'Standing only'],
        ]
      : [[VIEWSHED_COLORS.visible, `Visible ${mode === 'seated' ? 'seated' : 'standing'}`]]
  if (showHidden) legend.push([VIEWSHED_COLORS.hidden, 'Hidden by terrain'])
  legend.push([VIEWSHED_COLORS.unknown, 'Unknown terrain'])

  const sidebar = (
    <MapSidebarShell
      title="Viewshed"
      subtitle="See beyond the next ridge"
      icon={Eye}
      iconClassName="bg-rose-600 text-white"
    >
      <SidebarSection className="space-y-3" title="Observer" icon={MapPin}>
        <p className="text-xs text-muted-foreground">
          Drag the pin or place it on the map. The overlay updates as you move.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant={placing ? 'default' : 'outline'} onClick={() => setPlacing(!placing)}>
            {placing ? 'Cancel placement' : 'Place on map'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const center = mapRef.current?.getCenter()
              if (center) placeObserver(center)
            }}
          >
            Use map centre
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            placeObserver(MOUNTAIN_OBSERVER)
            setRadius(5000)
            setTerrain(true)
            setPlacing(false)
            mapRef.current?.stop()
            mapRef.current?.jumpTo({
              center: [MOUNTAIN_OBSERVER.lng, MOUNTAIN_OBSERVER.lat],
              zoom: 11.5,
              pitch: 65,
              bearing: 0,
              roll: 0,
            })
          }}
        >
          <Mountain size={14} /> Mountain example
        </Button>
        <p className="text-xs text-muted-foreground">Explore the ridges around Mount Robson in 3D.</p>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            const lng = Number(coordinateDraft.lng),
              lat = Number(coordinateDraft.lat)
            if (
              !coordinateDraft.lng.trim() ||
              !coordinateDraft.lat.trim() ||
              !Number.isFinite(lng) ||
              !Number.isFinite(lat) ||
              Math.abs(lng) > 179 ||
              Math.abs(lat) > 80
            ) {
              setCoordinateError('Enter longitude −179 to 179 and latitude −80 to 80.')
              return
            }
            placeObserver({ lng, lat })
            mapRef.current?.easeTo({ center: [lng, lat], duration: 600 })
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            {(['lng', 'lat'] as const).map((axis) => (
              <label key={axis} className="text-xs text-muted-foreground">
                {axis === 'lng' ? 'Longitude' : 'Latitude'}
                <input
                  aria-label={axis === 'lng' ? 'Longitude' : 'Latitude'}
                  type="number"
                  step="any"
                  value={coordinateDraft[axis]}
                  onChange={(event) => setCoordinateDraft({ ...coordinateDraft, [axis]: event.target.value })}
                  className="mt-1 w-full rounded border border-input bg-background p-2 text-sm text-foreground"
                />
              </label>
            ))}
          </div>
          <Button size="sm" variant="outline" type="submit">
            Go to coordinates
          </Button>
        </form>
        {coordinateError && <InlineAlert tone="warning">{coordinateError}</InlineAlert>}
        <NumericRangeField
          className="text-sm"
          inputClassName="h-auto accent-rose-600"
          valueClassName="font-mono text-xs tabular-nums"
          label="Analysis radius"
          value={radius}
          min={500}
          max={25000}
          step={500}
          display={`${(radius / 1000).toFixed(1)} km`}
          onChange={setRadius}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const [w, s, e, n] = result?.bounds ?? [
              observer.lng - 0.08,
              observer.lat - 0.05,
              observer.lng + 0.08,
              observer.lat + 0.05,
            ]
            mapRef.current?.fitBounds(
              [
                [w, s],
                [e, n],
              ],
              { padding: 60, duration: 600 },
            )
          }}
        >
          Fit analysis area
        </Button>
      </SidebarSection>
      <SidebarSection className="space-y-3" title="View height" icon={Eye}>
        <SegmentedControl options={MODES} value={mode} onChange={setMode} label="Observer height view" />
        <NumericRangeField
          className="text-sm"
          inputClassName="h-auto accent-rose-600"
          valueClassName="font-mono text-xs tabular-nums"
          label="Seated eye height"
          value={heightA}
          min={0.5}
          max={20}
          step={0.1}
          display={`${heightA.toFixed(1)} m`}
          onChange={setHeightA}
        />
        <NumericRangeField
          className="text-sm"
          inputClassName="h-auto accent-rose-600"
          valueClassName="font-mono text-xs tabular-nums"
          label="Standing eye height"
          value={heightB}
          min={0.5}
          max={20}
          step={0.1}
          display={`${heightB.toFixed(1)} m`}
          onChange={setHeightB}
        />
        {result && (
          <StatGroup
            variant="tiles"
            size="sm"
            columns={2}
            items={[
              { label: 'Seated visible', value: percent(result.counts.visibleA) },
              { label: 'Standing visible', value: percent(result.counts.visibleB) },
            ]}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Heights are above ground. Percentages count sampled terrain within the circle; unknown samples stay in the
          denominator.
        </p>
      </SidebarSection>
      <SidebarSection className="space-y-3" title="Sun planner" icon={Sun}>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>
            Date
            <input
              aria-label="Sun date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 w-full rounded border border-input bg-background p-2 text-sm"
            />
          </label>
          <label>
            Time zone
            <NativeSelect
              aria-label="Sun time zone"
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              className="mt-1 w-full rounded border border-input bg-background p-2 text-sm"
            >
              <option value="America/Vancouver">Vancouver</option>
              <option value="UTC">UTC</option>
              <option value="America/Toronto">Toronto</option>
              <option value="Europe/London">London</option>
            </NativeSelect>
          </label>
        </div>
        <NumericRangeField
          className="text-sm"
          inputClassName="h-auto accent-rose-600"
          valueClassName="font-mono text-xs tabular-nums"
          label="Sun time"
          value={minutes}
          min={0}
          max={1439}
          step={1}
          display={timeLabel(minutes)}
          onChange={setMinutes}
        />
        {!instant && (
          <InlineAlert tone="warning">
            Choose a valid date and time. This local time may be skipped by daylight saving.
          </InlineAlert>
        )}
        {sun && (
          <p className="text-xs text-muted-foreground">
            Azimuth {sun.azimuth.toFixed(1)}° · altitude {sun.altitude.toFixed(1)}°<br />
            The gold line points toward the sun from true north.
          </p>
        )}
        {sunA && sunB && (
          <div className="space-y-1 rounded border border-border p-3 text-xs" aria-live="polite">
            <p>
              Seated: <strong>{SUN_LABELS[sunA.status]}</strong>
            </p>
            <p>
              Standing: <strong>{SUN_LABELS[sunB.status]}</strong>
            </p>
            <p className="text-muted-foreground">
              Standing skyline: {Number.isFinite(sunB.horizon) ? `${sunB.horizon.toFixed(1)}°` : 'unknown'}
            </p>
          </div>
        )}
        {result && sun && (
          <svg
            viewBox="0 0 360 108"
            role="img"
            aria-label="Terrain skyline and current sun altitude"
            className="w-full rounded border border-border bg-muted/30"
          >
            <title>Terrain skyline and sun altitude by compass direction</title>
            <path d="M0 80H360" stroke="currentColor" opacity="0.25" />
            <path d={skylinePath} fill="none" stroke={VIEWSHED_COLORS.visible} strokeWidth="1.5" />
            <circle cx={sun.azimuth} cy={80 - Math.max(-5, Math.min(50, sun.altitude)) * 1.4} r="5" fill="#f59e0b" />
            {['N', 'E', 'S', 'W', 'N'].map((label, i) => (
              <text key={i} x={i * 89 + 2} y="100" fontSize="10" fill="currentColor">
                {label}
              </text>
            ))}
          </svg>
        )}
        <p className="text-xs text-muted-foreground">
          Checks terrain out to {(radius / 1000).toFixed(1)} km only. Increase the radius for distant ridges. Uses the
          geometric sun centre; atmospheric refraction, cloud and the solar disc are not modelled.
        </p>
      </SidebarSection>
      <SidebarSection className="space-y-3" title="Map appearance" icon={Mountain}>
        <ToggleRow
          label="3D terrain"
          active={terrain}
          onClick={() => {
            // End camera movement before changing terrain; an elevation transition
            // begun against the old terrain can stall when it is removed mid-animation.
            mapRef.current?.stop()
            mapRef.current?.jumpTo({ pitch: !terrain ? 55 : 0, roll: 0 })
            setTerrain(!terrain)
          }}
        />
        {terrain && (
          <NumericRangeField
            className="text-sm"
            inputClassName="h-auto accent-rose-600"
            valueClassName="font-mono text-xs tabular-nums"
            label="Map tilt"
            value={pitch}
            min={0}
            max={75}
            step={1}
            display={`${pitch}°`}
            onChange={(value) => {
              mapRef.current?.stop()
              mapRef.current?.jumpTo({ pitch: value, roll: 0 })
            }}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Right-drag to rotate and tilt around the terrain. Elevation is shown at its real scale.
        </p>
        <ToggleRow label="Satellite imagery" active={satellite} onClick={() => setSatellite(!satellite)} />
        <ToggleRow label="Show hidden terrain" active={showHidden} onClick={() => setShowHidden(!showHidden)} />
        <NumericRangeField
          className="text-sm"
          inputClassName="h-auto accent-rose-600"
          valueClassName="font-mono text-xs tabular-nums"
          label="Overlay opacity"
          value={opacity}
          min={0.1}
          max={1}
          step={0.05}
          display={`${Math.round(opacity * 100)}%`}
          onChange={setOpacity}
        />
        <div className="space-y-1 text-xs">
          {legend.map(([color, label]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
              {label}
            </div>
          ))}
        </div>
      </SidebarSection>
      <SidebarSection className="space-y-3" title="Terrain & precision">
        <Button size="sm" variant="outline" asChild>
          <a href="/dev/viewshed/terrain">Local DEM tools</a>
        </Button>
        <p className="text-xs text-muted-foreground">
          Import a terrain GeoTIFF and adjust target height in the BC terrain tool.
        </p>
        <div data-viewshed-status>
          <InlineAlert loading={!result && !analysis.error} tone={analysis.error ? 'warning' : 'info'}>
            {analysis.message}
          </InlineAlert>
        </div>
        <Button size="sm" variant="outline" onClick={() => setRetry(retry + 1)}>
          Retry terrain
        </Button>
        {result && (
          <p className="text-xs text-muted-foreground">
            Ground:{' '}
            {Number.isFinite(result.groundMeters) ? `${result.groundMeters.toFixed(0)} m above sea level` : 'unknown'}
            <br />
            DEM sampling: ~{result.sourceResolutionMeters.toFixed(0)} m · overlay cells: ~
            {((radius * 2) / result.size).toFixed(0)} m<br />
            Unknown: {percent(result.counts.unknown)} · missing tiles: {result.missingTileCount}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Terrain-only estimate using{' '}
          <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer" className="underline">
            AWS Terrain Tiles
          </a>
          . Trees and buildings are excluded. DEM accuracy may not resolve the difference between seated and standing
          heights. 3D terrain is drawn at 1× elevation.
        </p>
      </SidebarSection>
    </MapSidebarShell>
  )

  return (
    <MapSectionLayout
      sidebar={sidebar}
      desktopSidebarWidth={360}
      mobileInitialSheetState="collapsed"
      mobileSnapTo={placing ? 'collapsed' : undefined}
      mobileSnapKey={placing ? 'placing' : 'viewing'}
      selectedFeatureMobilePeek={{ title: 'Viewshed', subtitle: `${(radius / 1000).toFixed(1)} km · ${mode}` }}
    >
      <Map
        ref={mapRef}
        styles={satellite ? SATELLITE_STYLES : undefined}
        center={[INITIAL_OBSERVER.lng, INITIAL_OBSERVER.lat]}
        zoom={12}
        pitch={55}
        maxPitch={75}
        onViewportChange={(viewport) => setPitch(Math.round(viewport.pitch))}
        controls={<MapControls position="top-right" mobilePosition="bottom-right" />}
      >
        <TerrainSupport terrain={terrain} exaggeration={1} hillshade />
        <ViewshedOverlay result={analysis.overlayResult} mode={mode} opacity={opacity} showHidden={showHidden} />
        <MapLineLayer
          data={outline}
          color={['get', 'color']}
          width={1.5}
          opacity={1}
          interactive={false}
          sourceTolerance={0}
          sourceKey="viewshed-outline"
        />
        <MapLineLayer data={boundary} color="#cbd5e1" width={1} dashArray={[3, 3]} interactive={false} />
        <MapLineLayer data={sunLine} color="#f59e0b" width={2} dashArray={[3, 2]} />
        <MapDrawCapture
          active={placing}
          onPoint={([lng, lat]) => {
            placeObserver({ lng, lat })
            setPlacing(false)
          }}
        />
        <MapMarker
          longitude={observer.lng}
          latitude={observer.lat}
          draggable
          opacityWhenCovered="1"
          onDragStart={() => setDragging(true)}
          onDrag={placeObserver}
          onDragEnd={(point) => {
            placeObserver(point)
            setDragging(false)
          }}
        >
          <MarkerContent>
            <div
              role="img"
              aria-label="Observer location"
              className="flex h-10 w-10 cursor-grab items-center justify-center rounded-full border-2 border-white bg-rose-600 text-white shadow-lg"
              style={{ backgroundColor: VIEWSHED_COLORS.visible }}
            >
              <Eye size={20} />
            </div>
          </MarkerContent>
          <MarkerTooltip>Observer · drag to update visibility</MarkerTooltip>
        </MapMarker>
        <MapScaleBar position="bottom-right" className="max-md:hidden" />
        <MapOverlay
          data-viewshed-legend
          position="top-left"
          className="max-w-[240px] p-3 text-xs pointer-events-none max-md:!top-16"
        >
          <p className="font-semibold">{placing ? 'Click to place the observer' : 'Terrain visibility'}</p>
          <p className="mt-1 text-muted-foreground">
            {result ? `${(radius / 1000).toFixed(1)} km radius · ${mode}` : analysis.message}
          </p>
          <div className="mt-2 space-y-1">
            {legend.map(([color, label]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </div>
            ))}
          </div>
        </MapOverlay>
      </Map>
    </MapSectionLayout>
  )
}
