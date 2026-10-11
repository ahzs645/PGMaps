import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { Eye, RotateCw } from 'lucide-react'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MapSidebarShell, SidebarSection, InlineAlert } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ToggleRow } from '@/components/ui/toggle-row'
import { StatGroup } from '@/components/ui/stat-group'
import { useWebMCPTools, type WebMCPTool } from '@/lib/webmcp'
import { importLocalRaster } from './dev-forestry/toolImports'
import type { LocalRaster } from './dev-forestry/types'
import type { GeoPoint } from './dev-forestry/visibility'
import { VIEWSHED_COLORS, type ViewshedInput } from './dev-viewshed/analysis'
import { useViewshed } from './dev-viewshed/useViewshed'
import { ViewshedMap } from './dev-viewshed/ViewshedMap'

const PRESETS = [
  { label: 'Prince George', lng: -122.7497, lat: 53.9171 },
  { label: 'Tabor Mountain', lng: -122.448, lat: 53.916 },
  { label: 'Vancouver', lng: -123.12, lat: 49.28 },
  { label: 'Whistler', lng: -122.957, lat: 50.116 },
]
function HeightControl({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void
}) {
  return <div className="space-y-2">
    <div className="flex justify-between gap-3 text-sm"><span>{label}</span><span className="tabular-nums">{value} m</span></div>
    <Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={([next]) => onChange(next)} />
  </div>
}
export default function DevViewshed() {
  const [observer, setObserver] = useState<GeoPoint>(PRESETS[0])
  const [observerHeight, setObserverHeight] = useState(1.6)
  const [targetHeight, setTargetHeight] = useState(0)
  const [radius, setRadius] = useState(2000)
  const [demZoom, setDemZoom] = useState(13)
  const [terrain, setTerrain] = useState(false)
  const [localTerrain, setLocalTerrain] = useState<LocalRaster | null>(null)
  const [verticalReference, setVerticalReference] = useState('')
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [revision, setRevision] = useState(0)
  const [recenter, setRecenter] = useState(0)
  const mapRef = useRef<MapLibreMap | null>(null)
  const onReady = useCallback((map: MapLibreMap | null) => { mapRef.current = map }, [])
  const moveObserver = useCallback((point: GeoPoint) => {
    if (point.lng < -140 || point.lng > -113 || point.lat < 48 || point.lat > 61) {
      setLocationError('Choose a location within British Columbia.')
      return
    }
    setLocationError('')
    setObserver({ lng: point.lng, lat: point.lat })
  }, [])
  const input = useMemo<ViewshedInput>(() => ({
    observer, radiusMeters: radius, observerHeightMeters: observerHeight,
    targetHeightMeters: targetHeight, demZoom, localTerrain,
  }), [observer, radius, observerHeight, targetHeight, demZoom, localTerrain])
  const { result, error, progress, loading } = useViewshed(input, revision)
  useEffect(() => {
    const previous = document.title
    document.title = 'Viewshed · PGMaps Dev'
    return () => { document.title = previous }
  }, [])
  const tools: WebMCPTool[] = [{
    name: 'read_viewshed', title: 'Read terrain viewshed',
    description: 'Read the current BC terrain-only viewshed settings, sampled results, data source, and MapLibre layer state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute(args) {
      if (Object.keys(args).length) throw new Error('This tool takes no parameters.')
      return { observer, observerHeightMeters: observerHeight, targetHeightMeters: targetHeight, radiusMeters: radius,
        source: localTerrain ? { name: localTerrain.name, epsg: localTerrain.epsg, verticalReference: localTerrain.verticalReference } : 'AWS Terrain Tiles (overview)',
        loading, error, result: result ? { visible: result.visible, occluded: result.occluded, unknown: result.unknown,
          outputCellMeters: result.layout.cellMeters, demPixelMeters: result.demPixelMeters, elapsedMs: result.elapsedMs } : null,
        map: { engine: 'MapLibre', loaded: mapRef.current?.loaded() ?? false,
          coverageLayer: !!mapRef.current?.getLayer('viewshed-coverage'), terrain: !!mapRef.current?.getTerrain() } }
    },
  }]
  useWebMCPTools(tools)
  const assessed = result ? result.visible + result.occluded + result.unknown : 0
  const legend = (['visible', 'occluded', 'unknown'] as const).map((status) => {
    const [r, g, b] = VIEWSHED_COLORS[status]
    return <div key={status} className="flex items-center gap-2 text-sm">
      <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }} />
      {status === 'visible' ? 'Visible terrain' : status === 'occluded' ? 'Hidden by terrain' : 'Unknown terrain'}
    </div>
  })
  const sidebar = <MapSidebarShell title="Viewshed" subtitle="British Columbia · terrain visibility" icon={Eye} className={MAP_SIDEBAR_CLASS}>
    <SidebarSection title="Observer" className="space-y-3">
      <p className="text-sm text-muted-foreground">Drag the blue observer or tap the map. Coverage updates as you move; arrow keys on the marker move it 100 m.</p>
      <div className="flex flex-wrap gap-2">{PRESETS.map((point) =>
        <Button key={point.label} variant="outline" size="sm" onClick={() => { moveObserver(point); setRecenter((v) => v + 1) }}>{point.label}</Button>
      )}</div>
      <p className="text-xs tabular-nums text-muted-foreground">{observer.lat.toFixed(5)}, {observer.lng.toFixed(5)}</p>
      {locationError && <InlineAlert tone="error">{locationError}</InlineAlert>}
      <HeightControl label="Observer height above ground" value={observerHeight} min={0.5} max={120} step={0.1} onChange={setObserverHeight} />
      <HeightControl label="Target height above ground" value={targetHeight} min={0} max={120} step={1} onChange={setTargetHeight} />
      <HeightControl label="View radius" value={radius} min={250} max={10000} step={250} onChange={setRadius} />
      <SegmentedControl label="Terrain tile detail" value={String(demZoom)} options={[
        { value: '12', label: 'Overview' }, { value: '13', label: 'Standard' }, { value: '14', label: 'Fine' },
      ]} onChange={(value) => setDemZoom(Number(value))} />
      <ToggleRow label="3D terrain" description="Tilt the map to explore the relief" active={terrain} onClick={() => setTerrain((v) => !v)} />
    </SidebarSection>
    <SidebarSection title="Coverage" className="space-y-3">
      {loading && <p role="status" className="text-sm text-muted-foreground">{progress}</p>}
      {error && <InlineAlert tone="error">{error}<Button variant="outline" size="sm" className="mt-2" onClick={() => setRevision((v) => v + 1)}><RotateCw className="mr-2 h-4 w-4" />Retry</Button></InlineAlert>}
      <div className="space-y-2">{legend}</div>
      {result && <>
        <StatGroup variant="tiles" size="sm" columns={3} items={[
          { label: 'Visible', value: `${(100 * result.visible / Math.max(1, assessed)).toFixed(1)}%` },
          { label: 'Hidden', value: `${(100 * result.occluded / Math.max(1, assessed)).toFixed(1)}%` },
          { label: 'Unknown', value: `${(100 * result.unknown / Math.max(1, assessed)).toFixed(1)}%` },
        ]} />
        <p className="text-xs leading-5 text-muted-foreground">
          Sampled cells about {Math.round(result.layout.cellMeters)} m apart · DEM grid pixels about {result.demPixelMeters.toFixed(1)} m · observer ground {result.groundElevationMeters.toFixed(1)} m · {(result.elapsedMs / 1000).toFixed(2)} s.
        </p>
        <p className="text-xs text-muted-foreground">Percentages count sampled cells inside the radius, including unknown cells.</p>
        {result.missingTiles > 0 && <InlineAlert tone="warning">{result.missingTiles} terrain tiles failed. Grey cells include sightlines through missing terrain.</InlineAlert>}
      </>}
      <p className="text-sm leading-6 text-muted-foreground">Terrain-only line of sight, with Earth curvature and a fixed 0.13 refraction coefficient. Trees, buildings and RF link quality are not modelled. Each coloured cell reports visibility at its centre.</p>
    </SidebarSection>
    <SidebarSection title="BC elevation data" className="space-y-3">
      <p className="text-sm leading-6 text-muted-foreground">The default is a key-free terrain overview. A finer tile grid does not guarantee finer survey detail. For local detail, download a bare-earth DEM from <a className="underline" href="https://lidar.gov.bc.ca/" target="_blank" rel="noreferrer">LidarBC</a> or <a className="underline" href="https://open.canada.ca/data/en/dataset/957782bf-847c-4644-a757-e383c0057995" target="_blank" rel="noreferrer">NRCan HRDEM</a>, then import a cropped GeoTIFF.</p>
      <label className="block space-y-1 text-sm"><span>DEM vertical reference</span>
        <input value={verticalReference} onChange={(event) => setVerticalReference(event.target.value)} placeholder="e.g. CGVD2013, metres"
          className="w-full rounded-md border bg-background p-2" />
      </label>
      <label className="block space-y-1 text-sm"><span>Import terrain GeoTIFF</span>
        <input type="file" accept=".tif,.tiff" disabled={importing || !verticalReference.trim()}
          className="block w-full text-xs file:mr-2 file:rounded-md file:border file:bg-background file:px-3 file:py-2"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            setImporting(true); setImportError('')
            try { setLocalTerrain(await importLocalRaster(file, 'terrain', '', verticalReference)) }
            catch (failure) { setImportError(failure instanceof Error ? failure.message : String(failure)) }
            finally { setImporting(false) }
          }} />
      </label>
      <p className="text-xs text-muted-foreground">Single-band elevations in metres; up to 1,048,576 native cells and 64 MB. BC Albers, WGS84, Web Mercator and NAD83/WGS84 UTM zones 7–11 are supported. Match the crop to the observer and radius.</p>
      {importing && <p role="status" className="text-sm">Reading terrain GeoTIFF…</p>}
      {importError && <InlineAlert tone="error">{importError}</InlineAlert>}
      {localTerrain && <><p className="text-sm">{localTerrain.name} · {localTerrain.verticalReference}</p>
        <InlineAlert tone="warning">Analysis uses your imported DEM. Map relief still uses the overview tiles. Areas outside the imported DEM stay unknown.</InlineAlert>
        <Button variant="outline" size="sm" onClick={() => setLocalTerrain(null)}>Use overview terrain</Button></>}
      <a className="block text-xs underline" href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Default terrain data and attribution</a>
    </SidebarSection>
  </MapSidebarShell>
  return <MapSectionLayout sidebar={sidebar} mobileInitialSheetState="half" mobileScrimEnabled={false}
    mobilePeekTitle="Viewshed" mobilePeekSubtitle={loading ? 'Updating terrain visibility' : 'Drag the observer to explore'}>
    <ViewshedMap observer={observer} onObserver={moveObserver} result={result} terrain={terrain} onReady={onReady} recenter={recenter} />
  </MapSectionLayout>
}
