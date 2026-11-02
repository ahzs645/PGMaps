import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as MapLibreGL from 'maplibre-gl'
import type { FeatureCollection, Geometry } from 'geojson'
import {
  Clock3,
  Download,
  Globe2,
  Layers3,
  Map as MapIcon,
  MousePointer2,
  Mountain,
  PanelLeftClose,
  Pencil,
  Plus,
  Redo2,
  Satellite,
  Search,
  Settings2,
  Table2,
  Undo2,
  X,
} from 'lucide-react'
import { Map, MapControls, MapMarker, MarkerContent } from '@/components/ui/map'
import { MapSectionLayout, MAP_SIDEBAR_CLASS } from '@/components/layout/MapSectionLayout'
import { MapSidebarShell, InlineAlert } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { FileDropTarget } from '@/components/ui/file-drop-target'
import { ResizableSplit } from '@/components/ui/resizable-split'
import { downloadBlob, downloadText, toCsv } from '@pgmaps/geo-toolkit/export'
import { captureMapImage } from '@pgmaps/geo-toolkit/map'
import { featureCollectionBounds } from '@pgmaps/geo-toolkit/calculations'
import { readGeoFile, parseGeoJsonText } from '@/lib/geoFileImport'
import { AddDataDialog } from './dev-data/AddDataDialog'
import type { CatalogEntry } from './dev-data/catalog'
import { DataTablePanel } from './dev-data/DataTablePanel'
import {
  effectiveStyle,
  featureCenter,
  FEATURE_ID_KEY,
  filteredCollection,
  prepareLayer as prepare,
  type DataFeature,
  type LoadedLayer,
  type ViewportBounds,
} from './dev-data/layerData'
import { ViewportTracker } from './dev-data/MapBehaviors'
import type { LocalRaster } from './dev-forestry/types'
import { ViewshedOverlay } from '@/features/terrain-viewshed/ViewshedOverlay'
import { useViewshed } from '@/features/terrain-viewshed/useViewshed'
import { LayersPanel } from './dev-mmgis/LayersPanel'
import { FeatureInspector } from './dev-mmgis/FeatureInspector'
import { SearchPanel } from './dev-mmgis/SearchPanel'
import { ToolsPanel } from './dev-mmgis/ToolsPanel'
import { TerrainPanel } from './dev-mmgis/TerrainPanel'
import { RasterPanel } from './dev-mmgis/RasterPanel'
import { RasterOverlay } from './dev-mmgis/RasterOverlay'
import { WorkspacePanel } from './dev-mmgis/WorkspacePanel'
import { WorkbenchMapEvents, SyncScene } from './dev-mmgis/MapBehaviors'
import { MissionLayers, DrawingOverlay, VertexEditor } from './dev-mmgis/MapLayers'
import { TimeBar } from './dev-mmgis/TimeBar'
import { useMission } from './dev-mmgis/useMission'
import {
  drawingGeometry,
  inTime,
  makeLayer,
  matchesSearch,
  type Camera,
  type Coordinate,
  type Panel,
  type Tool,
} from './dev-mmgis/model'
import { httpUrl, validateCollection } from './dev-mmgis/missionCodec'
import { useWebMCPTools } from '@/lib/webmcp'
import './dev-mmgis/workbench.css'

const PANELS = [
  ['layers', 'Layers', Layers3],
  ['search', 'Search', Search],
  ['draw', 'Draw', Pencil],
  ['terrain', 'Terrain', Mountain],
  ['raster', 'Rasters', Satellite],
  ['workspace', 'Mission', Settings2],
] as const
const FALLBACK: MapLibreGL.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8eeeb' } }],
}

export default function DevMmgis() {
  const { mission, change, undo, redo, canUndo, canRedo, error, setError, status } = useMission()
  const [panel, setPanel] = useState<Panel>('layers'),
    [tool, setTool] = useState<Tool>('inspect')
  const [points, setPointsState] = useState<Coordinate[]>([]),
    [name, setName] = useState('')
  // Native map events can finish a shape before React's next effect runs.
  const draft = useRef<Coordinate[]>([])
  const setPoints = useCallback((value: Coordinate[] | ((old: Coordinate[]) => Coordinate[])) => {
    const next = typeof value === 'function' ? value(draft.current) : value
    draft.current = next
    setPointsState(next)
  }, [])
  const [profilePoint, setProfilePoint] = useState<Coordinate | null>(null)
  const [selected, setSelected] = useState<{ layer: string; id: string } | null>(null),
    [editing, setEditing] = useState(false)
  const [detail, setDetail] = useState<string | null>(null),
    [table, setTable] = useState<string | null>(null)
  const [tableHeight, setTableHeight] = useState(260),
    [inView, setInView] = useState(false),
    [bounds, setBounds] = useState<ViewportBounds | null>(null)
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState(false)
  const [library, setLibrary] = useState(false),
    [busy, setBusy] = useState(false)
  const [map, setMap] = useState<MapLibreGL.Map | null>(null),
    [pointer, setPointer] = useState<Coordinate | null>(null)
  const [raster, setRaster] = useState<LocalRaster | null>(null),
    [showSidebar, setShowSidebar] = useState(true)
  const [observer, setObserver] = useState<Coordinate>(mission.camera.center),
    [radius, setRadius] = useState(1500),
    [height, setHeight] = useState(1.6)
  const [viewshedOn, setViewshedOn] = useState(false),
    [retry, setRetry] = useState(0),
    [fallback, setFallback] = useState(false)
  const camera = useRef<Camera>(mission.camera)
  const viewshedSettings = useMemo(
    () => ({
      observer: { lng: observer[0], lat: observer[1] },
      radiusMeters: radius,
      heightA: height,
      heightB: height,
    }),
    [observer, radius, height],
  )
  const viewshed = useViewshed(viewshedSettings, retry, false, {
    enabled: viewshedOn,
    horizon: false,
    detailSize: 128,
    demZoom: 13,
  })
  const raw = useMemo(() => new globalThis.Map(mission.layers.map((l) => [l.id, prepare(l, l.data)])), [mission.layers])
  const loaded = useMemo(
    () =>
      new globalThis.Map(
        mission.layers.map((l) => {
          const data = raw.get(l.id)!
          return [
            l.id,
            {
              ...data,
              collection: {
                ...data.collection,
                features: data.collection.features.filter(
                  (f) => inTime(f, l.timeProperty, mission.time) && (!filter || matchesSearch(f, query)),
                ),
              },
            },
          ] as const
        }),
      ),
    [mission.layers, mission.time, raw, filter, query],
  )
  const getLayer = useCallback(
    (id: string): LoadedLayer =>
      loaded.get(id) ?? { status: 'ready', collection: { type: 'FeatureCollection', features: [] }, attributes: [] },
    [loaded],
  )
  const selectedLayer = mission.layers.find((l) => l.id === selected?.layer)
  const selectedFeature =
    selectedLayer?.visible && selected
      ? filteredCollection(
          getLayer(selectedLayer.id).collection,
          selectedLayer,
          effectiveStyle(selectedLayer, getLayer(selectedLayer.id)),
        ).features.find((f) => f.properties[FEATURE_ID_KEY] === selected.id)
      : undefined
  const tableLayer = mission.layers.find((l) => l.id === table)
  const visibleCount = mission.layers
    .filter((l) => l.visible)
    .reduce(
      (sum, l) =>
        sum + filteredCollection(getLayer(l.id).collection, l, effectiveStyle(l, getLayer(l.id))).features.length,
      0,
    )
  useWebMCPTools([
    {
      name: 'read_mission_workbench',
      title: 'Read mission workbench',
      description:
        'Read the current local Earth mission, source feature counts, filtered feature counts, selection and actual rendered map state.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute(args) {
        if (Object.keys(args).length) throw new Error('This tool takes no parameters.')
        return {
          name: mission.name,
          view: mission.view,
          time: mission.time,
          tool,
          selected: selectedFeature ? selected : null,
          selectedFeature: selectedFeature
            ? { geometry: selectedFeature.geometry, properties: selectedFeature.properties }
            : null,
          draftVertices: points.length,
          bookmarks: mission.bookmarks.map((b) => ({ name: b.name, camera: b.camera })),
          layers: mission.layers.map((l) => ({
            id: l.id,
            name: l.label,
            visible: l.visible,
            editable: l.editable,
            features: l.data.features.length,
            geometryTypes: [...new Set(l.data.features.map((f) => f.geometry?.type))],
            opacity: l.opacity,
            style: l.style,
            shown: filteredCollection(getLayer(l.id).collection, l, effectiveStyle(l, getLayer(l.id))).features.length,
          })),
          visibleFeatures: visibleCount,
          map: {
            loaded: map?.isStyleLoaded() ?? false,
            terrain: map?.getTerrain() ?? null,
            layerCount: map?.getStyle()?.layers?.length ?? 0,
            sources: map ? Object.keys(map.getStyle()?.sources ?? {}) : [],
            dataSources: map
              ? Object.keys(map.getStyle()?.sources ?? {}).flatMap((id) => {
                  const source = map.getSource(id)?.serialize()
                  if (
                    source?.type !== 'geojson' ||
                    !source.data ||
                    typeof source.data !== 'object' ||
                    source.data.type !== 'FeatureCollection'
                  )
                    return []
                  return [
                    {
                      id,
                      features: source.data.features.length,
                      geometryTypes: [
                        ...new Set((source.data as FeatureCollection).features.map((f) => f.geometry?.type)),
                      ],
                    },
                  ]
                })
              : [],
            camera: camera.current,
            paintedLayers:
              map
                ?.getStyle()
                ?.layers?.filter((l) => /^((fill|line|circle)-layer-|fill-shared-mmgis)/.test(l.id))
                .map((l) => ({ id: l.id, type: l.type, paint: l.paint, visible: l.layout?.visibility !== 'none' })) ??
              [],
          },
          localRaster: raster
            ? { name: raster.name, width: raster.width, height: raster.height, epsg: raster.epsg }
            : null,
          viewshed: { enabled: viewshedOn, current: !!viewshed.result, message: viewshed.message },
        }
      },
    },
  ])
  useEffect(() => {
    const previous = document.title
    document.title = 'Mission workbench · PGMaps'
    return () => {
      document.title = previous
    }
  }, [])
  useEffect(() => {
    if (!map) return
    camera.current = mission.camera
    const current = map.getCenter(),
      target = mission.camera
    if (
      Math.abs(current.lng - target.center[0]) < 1e-8 &&
      Math.abs(current.lat - target.center[1]) < 1e-8 &&
      Math.abs(map.getZoom() - target.zoom) < 1e-8 &&
      Math.abs(map.getBearing() - target.bearing) < 1e-8 &&
      Math.abs(map.getPitch() - target.pitch) < 1e-8
    )
      return
    map.jumpTo({ ...mission.camera, roll: 0 })
  }, [map, mission.id, mission.camera])
  const recordCamera = useCallback((c: Camera) => {
    camera.current = c
  }, [])
  const persistCamera = useCallback(
    () =>
      change(
        (m) => (JSON.stringify(m.camera) === JSON.stringify(camera.current) ? m : { ...m, camera: camera.current }),
        false,
      ),
    [change],
  )
  useEffect(() => {
    if (!map) return
    map.on('moveend', persistCamera)
    return () => {
      map.off('moveend', persistCamera)
    }
  }, [map, persistCamera])
  const activate = useCallback(
    (next: Tool) => {
      if (next !== tool && next !== 'inspect') setPoints([])
      setTool(next)
      setEditing(false)
      if (next === 'inspect') return
      setPanel(next === 'viewshed' ? 'terrain' : 'draw')
    },
    [tool, setPoints],
  )
  const saveDrawing = useCallback(
    (asPath = false) => {
      const geometry = drawingGeometry(asPath ? 'line' : tool, draft.current)
      if (!geometry) return
      const layer = makeLayer(
        name.trim() || `${asPath ? 'Path' : tool[0].toUpperCase() + tool.slice(1)} ${mission.layers.length + 1}`,
        {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry,
              properties: { name: name.trim() || 'Untitled feature', created: new Date().toISOString() },
            },
          ],
        },
        'Your drawings',
      )
      layer.editable = true
      layer.style = { type: 'simple', color: '#d49138' }
      change((m) => ({ ...m, layers: [...m.layers, layer] }))
      setSelected({ layer: layer.id, id: `${layer.id}:0` })
      setTool('inspect')
      setName('')
      setPoints([])
    },
    [tool, name, mission.layers.length, change, setPoints],
  )
  const finish = useCallback(() => {
    if (tool === 'measure') {
      setTool('inspect')
      return
    }
    saveDrawing()
  }, [tool, saveDrawing])
  const click = useCallback(
    (p: Coordinate) => {
      if (tool === 'viewshed') {
        setObserver(p)
        setViewshedOn(true)
        return
      }
      if (tool === 'point') {
        const layer = makeLayer(
          name.trim() || 'Field point',
          {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { name: name.trim() || 'Field point', created: new Date().toISOString() },
                geometry: { type: 'Point', coordinates: p },
              },
            ],
          },
          'Your drawings',
        )
        layer.editable = true
        change((m) => ({ ...m, layers: [...m.layers, layer] }))
        setSelected({ layer: layer.id, id: `${layer.id}:0` })
        setTool('inspect')
        setName('')
        return
      }
      setPoints((previous) => {
        const last = previous.at(-1)
        return last && Math.abs(last[0] - p[0]) < 1e-10 && Math.abs(last[1] - p[1]) < 1e-10
          ? previous
          : [...previous, p]
      })
    },
    [tool, name, change, setPoints],
  )
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return
      if (e.key === 'Escape') {
        setTool('inspect')
        setEditing(false)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else if (points.length) setPoints((p) => p.slice(0, -1))
        else undo()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [undo, redo, points.length, setPoints])
  const select = useCallback(
    (layer: string, id: string) => {
      if (tool !== 'inspect') return
      setSelected({ layer, id })
      setEditing(false)
      const feature = getLayer(layer).collection.features.find((f) => f.properties[FEATURE_ID_KEY] === id)
      const center = feature ? featureCenter(feature) : null
      if (center) map?.easeTo({ center, duration: 400 })
    },
    [tool, getLayer, map],
  )
  const editFeature = useCallback(
    (patch: { geometry?: Geometry; properties?: Record<string, unknown> }, remove = false) => {
      if (!selected || !selectedLayer?.editable) return
      const index = Number(selected.id.slice(selected.id.lastIndexOf(':') + 1))
      change((m) => ({
        ...m,
        layers: m.layers.map((l) =>
          l.id !== selected.layer
            ? l
            : {
                ...l,
                data: {
                  ...l.data,
                  features: l.data.features.flatMap((f, i) => (i !== index ? [f] : remove ? [] : [{ ...f, ...patch }])),
                },
              },
        ),
      }))
      if (remove) {
        setSelected(null)
        setEditing(false)
      }
    },
    [selected, selectedLayer, change],
  )
  const addCollection = useCallback(
    (title: string, collection: FeatureCollection) => {
      const data = validateCollection(collection),
        layer = makeLayer(title, data)
      layer.editable = true
      change((m) => ({ ...m, layers: [...m.layers, layer] }))
      const box = featureCollectionBounds(data)
      if (box)
        map?.fitBounds(
          [
            [box[0], box[1]],
            [box[2], box[3]],
          ],
          { padding: 50, maxZoom: 16, duration: 500 },
        )
      return layer
    },
    [change, map],
  )
  const files = useCallback(
    async (input: File[]) => {
      setBusy(true)
      setError('')
      const errors: string[] = []
      for (const file of input) {
        try {
          if (file.size > 32 * 1024 * 1024) throw new Error('Vector imports are limited to 32 MB.')
          const result = await readGeoFile(file)
          addCollection(result.name, result.collection)
          if (result.skipped) errors.push(`${file.name}: skipped ${result.skipped} features without usable geometry.`)
        } catch (e) {
          errors.push(`${file.name}: ${e instanceof Error ? e.message : 'Could not read file.'}`)
        }
      }
      setBusy(false)
      setError(errors.join(' '))
      if (!errors.length) setLibrary(false)
    },
    [addCollection, setError],
  )
  const addCatalog = async (entry: CatalogEntry) => {
    setBusy(true)
    setError('')
    try {
      const r = await fetch(entry.path, { signal: AbortSignal.timeout(30000) })
      if (!r.ok) throw new Error(`Data returned ${r.status}.`)
      const layer = addCollection(entry.name, await r.json())
      change((m) => ({
        ...m,
        layers: m.layers.map((l) =>
          l.id === layer.id
            ? {
                ...l,
                description: `${entry.sourceUrl}${entry.snapshotDate ? ` · Snapshot ${entry.snapshotDate}` : ''}`,
                group: 'City of Prince George open data',
              }
            : l,
        ),
      }))
      setLibrary(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this layer.')
    } finally {
      setBusy(false)
    }
  }
  const addUrl = async (url: string) => {
    setBusy(true)
    setError('')
    try {
      const checked = httpUrl(url),
        r = await fetch(checked, { signal: AbortSignal.timeout(30000) })
      if (!r.ok) throw new Error(`Data returned ${r.status}.`)
      const parsed = parseGeoJsonText(await r.text())
      addCollection(new URL(checked).pathname.split('/').at(-1) || 'Linked GeoJSON', parsed.collection)
      setLibrary(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this URL. The server must allow CORS.')
    } finally {
      setBusy(false)
    }
  }
  const zoom = (id: string) => {
    const l = mission.layers.find((l) => l.id === id)
    if (!l) return
    const b = featureCollectionBounds(l.data)
    if (b)
      map?.fitBounds(
        [
          [b[0], b[1]],
          [b[2], b[3]],
        ],
        { padding: 50, maxZoom: 16, duration: 500 },
      )
  }
  const snapshot = async () => {
    if (!map) {
      setError('Wait for the map to finish loading before exporting an image.')
      return
    }
    try {
      downloadBlob(await captureMapImage(map), 'mission-map.png')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not capture the map.')
    }
  }
  const exportData = (format: 'csv' | 'geojson' = 'csv') => {
    const layer = tableLayer ?? selectedLayer ?? mission.layers.find((l) => l.visible)
    if (!layer) return
    const data = filteredCollection(getLayer(layer.id).collection, layer, effectiveStyle(layer, getLayer(layer.id)))
    if (format === 'geojson') {
      downloadText(
        JSON.stringify(
          {
            ...data,
            features: data.features.map((f) => ({
              ...f,
              properties: Object.fromEntries(Object.entries(f.properties).filter(([k]) => !k.startsWith('__'))),
            })),
          },
          null,
          2,
        ),
        `${layer.label}.geojson`,
        'application/geo+json',
      )
      return
    }
    const rows = data.features.map((f) =>
      Object.fromEntries(Object.entries(f.properties).filter(([k]) => !k.startsWith('__'))),
    )
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
    downloadText(toCsv(keys, rows), `${layer.label}.csv`, 'text/csv')
  }
  const nav = (
    <nav className="mm-panel-nav" aria-label="Workbench tools">
      {PANELS.map(([id, label, Icon]) => (
        <button
          key={id}
          aria-pressed={panel === id}
          onClick={() => {
            setPanel(id)
            setDetail(null)
          }}
          title={label}
        >
          <Icon size={17} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
  const inspector =
    selectedFeature && selectedLayer ? (
      <FeatureInspector
        key={`${selected?.id}:${JSON.stringify(selectedFeature.properties)}`}
        feature={selectedFeature}
        layer={selectedLayer}
        loaded={getLayer(selectedLayer.id)}
        onClose={() => {
          setSelected(null)
          setEditing(false)
        }}
        onTable={() => setTable(selectedLayer.id)}
        onProperties={(properties) => editFeature({ properties })}
        onDelete={() => editFeature({}, true)}
        editing={editing}
        onEditing={setEditing}
      />
    ) : null
  const sidebar = (
    <MapSidebarShell
      className={`${MAP_SIDEBAR_CLASS} mm-sidebar`}
      title="Mission workbench"
      subtitle="Earth exploration · local workspace"
      icon={Globe2}
      actions={
        <button aria-label="Hide sidebar" onClick={() => setShowSidebar(false)}>
          <PanelLeftClose size={16} />
        </button>
      }
      metadata={nav}
    >
      {error && (
        <div className="mm-message">
          <InlineAlert tone="error" title="Workspace message">
            {error}
          </InlineAlert>
          <button aria-label="Dismiss message" onClick={() => setError('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {inspector}
      {panel === 'layers' && (
        <LayersPanel
          mission={mission}
          change={change}
          getLayer={getLayer}
          detail={detail}
          onDetail={setDetail}
          onAdd={() => setLibrary(true)}
          onTable={setTable}
          onZoom={zoom}
          bounds={bounds}
        />
      )}
      {panel === 'search' && (
        <SearchPanel
          mission={mission}
          getLayer={getLayer}
          query={query}
          onQuery={setQuery}
          filter={filter}
          onFilter={setFilter}
          onSelect={select}
        />
      )}
      {panel === 'draw' && (
        <ToolsPanel
          tool={tool}
          onTool={activate}
          points={points}
          onPoints={setPoints}
          pointer={pointer}
          name={name}
          onName={setName}
          onFinish={finish}
          onSave={() => saveDrawing(true)}
        />
      )}
      {panel === 'terrain' && (
        <TerrainPanel
          mission={mission}
          change={change}
          tool={tool}
          setTool={activate}
          points={points}
          raster={raster}
          observer={observer}
          radius={radius}
          height={height}
          onRadius={setRadius}
          onHeight={setHeight}
          onRetry={() => setRetry((v) => v + 1)}
          viewshedStatus={viewshed.message}
          viewshedCurrent={Boolean(viewshed.result)}
          viewshedOn={viewshedOn}
          onViewshedChange={setViewshedOn}
          onProfilePoint={setProfilePoint}
        />
      )}
      {panel === 'raster' && (
        <RasterPanel
          mission={mission}
          change={change}
          raster={raster}
          onRaster={setRaster}
          point={pointer}
          onError={setError}
        />
      )}
      {panel === 'workspace' && (
        <WorkspacePanel
          mission={mission}
          change={change}
          camera={camera.current}
          onFly={(c) => map?.easeTo({ ...c, duration: 600 })}
          onError={setError}
          status={status}
          onExportLayer={exportData}
          onExportMap={() => void snapshot()}
        />
      )}
    </MapSidebarShell>
  )
  const overlays = (
    <>
      <MissionLayers
        mission={mission}
        getLayer={getLayer}
        selected={selectedFeature ? (selected?.id ?? null) : null}
        onSelect={select}
        interactive={tool === 'inspect' && !editing}
      />
      {raster && <RasterOverlay raster={raster} />}
      <DrawingOverlay tool={tool} points={points} pointer={pointer} />
      {profilePoint && (
        <MapMarker longitude={profilePoint[0]} latitude={profilePoint[1]}>
          <MarkerContent>
            <div className="mm-profile-cursor" role="img" aria-label="Elevation profile location" />
          </MarkerContent>
        </MapMarker>
      )}
      {editing && selectedFeature?.geometry && selectedLayer?.editable && (
        <VertexEditor geometry={selectedFeature.geometry} onChange={(geometry) => editFeature({ geometry })} />
      )}
      {viewshedOn && (
        <>
          <ViewshedOverlay
            result={viewshed.overlayResult}
            mode="standing"
            opacity={0.7}
            showHidden
            sourceKey="mmgis-viewshed"
          />
          <MapMarker
            longitude={observer[0]}
            latitude={observer[1]}
            draggable
            onDragEnd={(p) => setObserver([p.lng, p.lat])}
          >
            <MarkerContent>
              <button
                type="button"
                className="mm-observer"
                aria-label="Move viewshed observer"
                onKeyDown={(e) => {
                  const delta = e.shiftKey ? 0.001 : 0.0001
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
                  e.preventDefault()
                  setObserver(([lng, lat]) => [
                    lng + (e.key === 'ArrowRight' ? delta : e.key === 'ArrowLeft' ? -delta : 0),
                    lat + (e.key === 'ArrowUp' ? delta : e.key === 'ArrowDown' ? -delta : 0),
                  ])
                }}
              />
            </MarkerContent>
          </MapMarker>
        </>
      )}
    </>
  )
  const plan = (
    <Map
      center={mission.camera.center}
      zoom={mission.camera.zoom}
      bearing={mission.camera.bearing}
      pitch={mission.camera.pitch}
      projection={{ type: mission.view === 'globe' ? 'globe' : 'mercator' }}
      fallbackStyles={{ light: FALLBACK, dark: FALLBACK }}
      onStyleFallback={() => setFallback(true)}
      controls={<MapControls position="top-right" />}
    >
      <WorkbenchMapEvents
        onReady={setMap}
        onCamera={recordCamera}
        onPointer={setPointer}
        onClick={click}
        onFinish={finish}
        tool={tool}
        terrain={mission.terrain}
      />
      <ViewportTracker onChange={setBounds} />
      {overlays}
    </Map>
  )
  const scene = (
    <Map
      center={mission.camera.center}
      zoom={mission.camera.zoom}
      pitch={55}
      projection={{ type: 'globe' }}
      fallbackStyles={{ light: FALLBACK, dark: FALLBACK }}
      controls={<MapControls position="top-right" />}
    >
      <WorkbenchMapEvents tool="inspect" terrain={mission.terrain} />
      <SyncScene source={map} />
      <MissionLayers
        mission={mission}
        getLayer={getLayer}
        selected={selected?.id ?? null}
        onSelect={select}
        interactive={tool === 'inspect'}
      />
      {raster && <RasterOverlay raster={raster} />}
    </Map>
  )
  const tablePane = tableLayer ? (
    <DataTablePanel
      layer={tableLayer}
      layers={mission.layers}
      loaded={getLayer(tableLayer.id)}
      getLayer={getLayer}
      bounds={bounds}
      showOnlyInView={inView}
      selectedFeatureId={selectedFeature ? (selected?.id ?? null) : null}
      height={tableHeight}
      onHeightChange={setTableHeight}
      onShowOnlyInViewChange={setInView}
      onLayerChange={setTable}
      onClose={() => setTable(null)}
      onSelect={(f: DataFeature) => select(tableLayer.id, f.properties[FEATURE_ID_KEY])}
    />
  ) : undefined
  return (
    <div className="mm-workbench">
      <header className="mm-mission-header">
        <div className="mm-mission-mark">
          <Globe2 size={21} />
        </div>
        <div className="mm-mission-title">
          <span>
            MISSION CONTROL <i>LOCAL</i>
          </span>
          <h1>{mission.name}</h1>
        </div>
        <div className="mm-header-actions">
          <Button size="sm" variant="outline" aria-label="Add data" onClick={() => setLibrary(true)}>
            <Plus size={14} />
            <span>Add data</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="Configure mission"
            onClick={() => {
              setPanel('workspace')
              setShowSidebar(true)
            }}
          >
            <Settings2 size={14} />
            <span>Configure</span>
          </Button>
        </div>
      </header>
      <MapSectionLayout
        className="mm-layout"
        sidebar={sidebar}
        desktopSidebarWidth={360}
        showDesktopSidebar={showSidebar}
        onToggleDesktopSidebar={() => setShowSidebar((v) => !v)}
        mobileInitialSheetState="collapsed"
        mobilePeekTitle="Mission workbench"
        mobilePeekSubtitle={`${visibleCount} features · ${tool === 'inspect' ? 'Inspect map' : `${tool} tool active`}`}
        mobileScrimEnabled={false}
        bottomPane={tablePane}
        bottomPaneHeight={tablePane ? tableHeight : 0}
      >
        <FileDropTarget onFiles={(f) => void files(f)} className="h-full min-h-0">
          <div className="mm-map-space">
            <div className="mm-map-toolbar">
              <div className="mm-toolbar-group">
                <button
                  aria-label="Inspect features"
                  aria-pressed={tool === 'inspect'}
                  onClick={() => activate('inspect')}
                >
                  <MousePointer2 size={16} />
                  <span>Inspect</span>
                </button>
                <button aria-label="Draw and measure" aria-pressed={panel === 'draw'} onClick={() => setPanel('draw')}>
                  <Pencil size={16} />
                </button>
                <button aria-label="Undo mission edit" disabled={!canUndo} onClick={undo}>
                  <Undo2 size={16} />
                </button>
                <button aria-label="Redo mission edit" disabled={!canRedo} onClick={redo}>
                  <Redo2 size={16} />
                </button>
              </div>
              <div className="mm-toolbar-group" role="group" aria-label="Map views">
                {(
                  [
                    ['map', '2D', MapIcon],
                    ['split', 'Split', Layers3],
                    ['globe', 'Globe', Globe2],
                  ] as const
                ).map(([v, label, Icon]) => (
                  <button key={v} aria-pressed={mission.view === v} onClick={() => change((m) => ({ ...m, view: v }))}>
                    <Icon size={15} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="mm-toolbar-group">
                <button
                  aria-label="Toggle time control"
                  aria-pressed={mission.time.enabled}
                  onClick={() => change((m) => ({ ...m, time: { ...m.time, enabled: !m.time.enabled } }))}
                >
                  <Clock3 size={16} />
                </button>
                <button
                  aria-label="Open attribute table"
                  disabled={!mission.layers.length}
                  onClick={() =>
                    setTable(
                      table ??
                        selectedLayer?.id ??
                        mission.layers.find((l) => l.visible)?.id ??
                        mission.layers[0]?.id ??
                        null,
                    )
                  }
                >
                  <Table2 size={16} />
                </button>
                <button aria-label="Export map PNG" disabled={!map} onClick={() => void snapshot()}>
                  <Download size={16} />
                </button>
              </div>
            </div>
            <ResizableSplit
              className="mm-scenes"
              direction="row"
              splitQuery={mission.view === 'split' ? '(min-width: 900px)' : '(min-width: 0px)'}
              storageKey="mmgis:scenes"
              panes={[
                {
                  id: 'plan',
                  label: 'plan',
                  content: (
                    <div className="mm-map-pane" data-testid="mission-plan">
                      {plan}
                      <div className="mm-view-label">
                        {mission.view === 'globe' ? 'EARTH GLOBE' : 'PLAN VIEW'}
                        <span>WGS84</span>
                      </div>
                    </div>
                  ),
                  stackedHeight: 380,
                },
                {
                  id: 'scene',
                  label: '3D scene',
                  hidden: mission.view !== 'split',
                  content: (
                    <div className="mm-map-pane" data-testid="mission-scene">
                      {scene}
                      <div className="mm-view-label">
                        3D SCENE<span>Linked to plan</span>
                      </div>
                    </div>
                  ),
                  stackedHeight: 320,
                },
              ]}
            />
            {mission.time.enabled && <TimeBar mission={mission} change={(fn) => change(fn, false)} />}
            <footer className="mm-statusbar">
              <span>
                <i className="mm-live-dot" />
                {visibleCount.toLocaleString()} visible features
              </span>
              <span>
                {pointer ? `${pointer[1].toFixed(5)}°, ${pointer[0].toFixed(5)}°` : 'Move over map for coordinates'}
              </span>
              <button onClick={() => exportData()} disabled={!mission.layers.length}>
                Export layer CSV
              </button>
              <button onClick={() => exportData('geojson')} disabled={!mission.layers.length}>
                GeoJSON
              </button>
            </footer>
            {fallback && <div className="mm-basemap-note">Basemap unavailable · data layers remain available</div>}
          </div>
        </FileDropTarget>
      </MapSectionLayout>
      <AddDataDialog
        open={library}
        onOpenChange={setLibrary}
        addedIds={new Set()}
        busy={busy}
        error={error || null}
        onAddCatalog={(e) => void addCatalog(e)}
        onFiles={(f) => void files(f)}
        onUrl={(u) => void addUrl(u)}
      />
    </div>
  )
}
