import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MapMouseEvent } from 'maplibre-gl'
import { Button } from '@/components/ui/button'
import { Map, useMap } from '@/components/ui/map'
import { MapRasterLayer } from '@/components/ui/map-layers'
import { InlineAlert } from '@/components/ui/map-panels'
import { MapControls, MapScaleBar } from '@/components/ui/map-controls'
import { DialogShell } from '@/components/ui/dialog-shell'
import { PortalDock } from './PortalDock'
import { downloadText } from '@/lib/download'
import { PortalProjectManager } from './PortalProjectManager'
import { PortalVectors, VectorLayers } from './PortalVectors'
import { refreshSharedLayer, workspaceRenderOrder } from './data/nativeLayers'
import { checkedSldUrl } from './data/vectorStyle'
import { importWorkspace, type ActiveWms, type Workspace } from './data/workspace'
import { loadSnapshotCapabilities, loadSnapshotSources, type CatalogueSource } from './data/showcase'
import {
  errorText,
  portalRead,
  isWmsSource,
  loadPortalSources,
  loadWmsCapabilities,
  wmsLegend,
  wmsTiles,
  wmsUrl,
  type PortalSource,
  type WmsCapabilities,
} from '@/lib/nechakoPortal'

type ActiveLayer = ActiveWms
type Inspection = { layer: string; text: string; loading?: boolean; error?: boolean }

function Identify({
  selected,
  onResult,
  onMapError,
}: {
  selected?: ActiveLayer
  onResult: (result: Inspection) => void
  onMapError: (message: string) => void
}) {
  const { map, isLoaded } = useMap()
  const source = selected?.source
  const layer = selected?.layer
  const style = selected?.style
  const formats = selected?.formats
  useEffect(() => {
    if (!map || !isLoaded) return
    const controller = new AbortController()
    let request: AbortController | undefined
    const click = async (event: MapMouseEvent) => {
      if (!source || !layer) return
      request?.abort()
      request = new AbortController()
      const current = request
      onResult({ layer: layer.title, text: 'Looking up this location…', loading: true })
      const width = Math.round(map.getCanvas().clientWidth)
      const height = Math.round(map.getCanvas().clientHeight)
      // Use the exact Web Mercator tile containing the click. This works at any
      // bearing/pitch and avoids treating a rotated screen as an unrotated WMS map.
      const world = 20037508.342789244
      const z = Math.min(20, Math.max(0, Math.floor(map.getZoom())))
      const n = 2 ** z
      const lng = ((((event.lngLat.lng + 180) % 360) + 360) % 360) - 180
      const lat = (Math.max(-85.05112878, Math.min(85.05112878, event.lngLat.lat)) * Math.PI) / 180
      const tx = ((lng + 180) / 360) * n
      const ty = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n
      const x = Math.floor(tx),
        y = Math.floor(ty),
        size = (2 * world) / n
      const bbox = [-world + x * size, world - (y + 1) * size, -world + (x + 1) * size, world - y * size].join(',')
      const format =
        formats?.find((value) => ['application/json', 'application/geo+json'].includes(value)) ?? 'text/plain'
      const url = wmsUrl(source.resource, {
        REQUEST: 'GetFeatureInfo',
        LAYERS: layer.name,
        QUERY_LAYERS: layer.name,
        STYLES: style ?? '',
        SRS: 'EPSG:3857',
        BBOX: bbox,
        WIDTH: '256',
        HEIGHT: '256',
        X: String(Math.min(255, Math.floor((tx - x) * 256))),
        Y: String(Math.min(255, Math.floor((ty - y) * 256))),
        FORMAT: 'image/png',
        INFO_FORMAT: format,
        FEATURE_COUNT: '10',
      })
      if (!width || !height) return
      const timeout = setTimeout(() => current.abort(), 30000)
      try {
        const response = await fetch(url, { credentials: 'omit', signal: current.signal })
        if (!response.ok) throw new Error(`Identify HTTP ${response.status}`)
        const text = await response.text()
        if (/ServiceException|ExceptionReport/.test(text))
          throw new Error(
            text
              .replace(/<[^>]*>/g, ' ')
              .trim()
              .slice(0, 500),
          )
        let readable = text
        if (format.includes('json')) {
          const value = JSON.parse(text)
          readable =
            Array.isArray(value.features) && !value.features.length
              ? 'No features at this location.'
              : JSON.stringify(value, null, 2)
        }
        if (request === current && !controller.signal.aborted)
          onResult({ layer: layer.title, text: readable || 'No attributes returned.' })
      } catch (error) {
        if (request === current && !controller.signal.aborted)
          onResult({ layer: layer.title, text: errorText(error), error: true })
      } finally {
        clearTimeout(timeout)
      }
    }
    const fail = (event: { error: Error }) => onMapError(event.error.message)
    map.on('click', click)
    map.on('error', fail)
    return () => {
      controller.abort()
      request?.abort()
      map.off('click', click)
      map.off('error', fail)
    }
  }, [map, isLoaded, source, layer, style, formats, onResult, onMapError])
  return null
}

function LayerLegend({ active }: { active: ActiveLayer }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">{active.layer.title}</p>
      {failed ? (
        <p className="text-xs text-muted-foreground">The service could not provide a legend.</p>
      ) : (
        <img
          src={wmsLegend(active.source.resource, active.layer.name, active.style)}
          alt={`Legend for ${active.layer.title}`}
          onError={() => setFailed(true)}
          className="max-h-72 max-w-full bg-white"
        />
      )}
    </div>
  )
}

export function PortalLayers({
  workspace,
  setWorkspace,
  onBounds,
  catalogueSource = 'live',
  layout = 'workbench',
  projectsOpen = false,
  onProjectsClose,
  onOpenFiles,
  initialBounds,
  requestedPane,
}: {
  workspace: Workspace
  setWorkspace: React.Dispatch<React.SetStateAction<Workspace>>
  onBounds: (bounds: [number, number, number, number]) => void
  catalogueSource?: CatalogueSource
  layout?: 'workbench' | 'portal'
  projectsOpen?: boolean
  onProjectsClose?: () => void
  onOpenFiles?: () => void
  initialBounds?: [number, number, number, number]
  requestedPane?: { pane: 'tools' | 'layers'; revision: number }
}) {
  const [sources, setSources] = useState<PortalSource[]>([])
  const [sourceUrl, setSourceUrl] = useState('')
  const [caps, setCaps] = useState<WmsCapabilities | null>(null)
  const [layerName, setLayerName] = useState('')
  const [style, setStyle] = useState('')
  const [activeStyleError, setActiveStyleError] = useState('')
  const [verifyingId, setVerifyingId] = useState('')
  const active = workspace.layers
  const setActive = (value: React.SetStateAction<ActiveLayer[]>) =>
    setWorkspace((current) => ({ ...current, layers: typeof value === 'function' ? value(current.layers) : value }))
  const [drawing, setDrawing] = useState(false)
  const [sketch, setSketch] = useState<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })
  const [picked, setPicked] = useState<{ id: string; index: number }>()
  const [toolsOpen, setToolsOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  useEffect(() => {
    if (requestedPane?.pane === 'tools') setToolsOpen(true)
    if (requestedPane?.pane === 'layers') setLayersOpen(true)
  }, [requestedPane])
  const onVectorSelect = useCallback(
    (id: string, index: number) => {
      setPicked({ id, index })
      if (layout === 'portal') setToolsOpen(true)
    },
    [layout],
  )
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const renderOrder = workspaceRenderOrder(workspace)
  const rasterOrder =
    renderOrder.map((item) => item.id).join('|') +
    '|' +
    workspace.vectors
      .filter((item) => item.visible)
      .map((item) => item.id)
      .join('|')
  const [workspaceError, setWorkspaceError] = useState('')
  const [workspaceMessage, setWorkspaceMessage] = useState('')
  const [identifyId, setIdentifyId] = useState('')
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [catalogueError, setCatalogueError] = useState('')
  const [capError, setCapError] = useState('')
  const [loading, setLoading] = useState(true)
  const [capLoading, setCapLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const [mapError, setMapError] = useState('')
  const mapRef = useRef<import('maplibre-gl').Map>(null)
  const source = sources.find((item) => item.resource === sourceUrl)
  const layer = caps?.layers.find((item) => item.name === layerName)
  const selected = active.find((item) => item.id === identifyId)
  const onResult = useCallback(
    (result: Inspection) => {
      setInspection(result)
      if (layout === 'portal') setLayersOpen(true)
    },
    [layout],
  )
  const onMapError = useCallback((message: string) => setMapError(message), [])
  const onCamera = useCallback(
    (camera: Workspace['camera']) => setWorkspace((current) => ({ ...current, camera })),
    [setWorkspace],
  )
  const applyWorkspace = (value: unknown) => {
    const imported = importWorkspace(value)
    setWorkspace(imported)
    setWorkspaceRevision((revision) => revision + 1)
    setPicked(undefined)
    mapRef.current?.jumpTo(imported.camera)
    setIdentifyId('')
    setInspection(null)
    setWorkspaceError('')
    setWorkspaceMessage('Workspace loaded. Native conversion warnings appear below.')
  }

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    const timeout = setTimeout(() => controller.abort(), 30000)
    const loadSources = catalogueSource === 'snapshot' ? loadSnapshotSources : loadPortalSources
    loadSources(controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setSources(items)
        setCapLoading(items.some(isWmsSource))
        setSourceUrl(
          (current) =>
            (items.some((item) => item.resource === current) ? current : '') ||
            items.find((item) => item.name === 'Watershed Context')?.resource ||
            items.find(isWmsSource)?.resource ||
            '',
        )
      })
      .catch((error) => {
        if (cancelled) return
        if (!controller.signal.aborted) setCatalogueError(errorText(error))
        else setCatalogueError('The catalogue request timed out.')
      })
      .finally(() => {
        clearTimeout(timeout)
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [retry, catalogueSource])

  useEffect(() => {
    if (!source || !isWmsSource(source)) return
    const controller = new AbortController()
    let cancelled = false
    const timeout = setTimeout(() => controller.abort(), 30000)
    const loadCapabilities = catalogueSource === 'snapshot' ? loadSnapshotCapabilities : loadWmsCapabilities
    loadCapabilities(source, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        setCaps(value)
        setLayerName(value.layers.find((item) => item.name === 'main map')?.name ?? value.layers[0]?.name ?? '')
      })
      .catch((error) => {
        if (cancelled) return
        if (!controller.signal.aborted) setCapError(errorText(error))
        else setCapError('The service request timed out.')
      })
      .finally(() => {
        clearTimeout(timeout)
        if (!cancelled) setCapLoading(false)
      })
    return () => {
      cancelled = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [source, retry, catalogueSource])

  const tiles = useMemo(
    () => active.map((item) => ({ ...item, tiles: [wmsTiles(item.source.resource, item.layer.name, item.style)] })),
    [active],
  )
  const canRender = layer?.crs.includes('EPSG:3857') && caps?.mapFormats.includes('image/png')
  const add = () => {
    if (!source || !layer || !caps || !canRender) return
    const id = `${source.resource}|${layer.name}|${style}`
    setActive((current) =>
      current.some((item) => item.id === id)
        ? current
        : [...current, { id, source, layer, style, opacity: 0.75, formats: caps.featureInfoFormats }],
    )
    if (layer.queryable) setIdentifyId(id)
    setInspection(null)
    setMapError('')
  }

  const cataloguePanel = (
    <>
      <h2 className="text-xl font-semibold">
        {catalogueSource === 'snapshot' ? 'Bundled portal catalogue' : 'Live portal layers'}
      </h2>
      <p className="text-sm text-muted-foreground">
        Choose a service, then add its named layers to the map. Groups use the portal’s original symbology.
        {catalogueSource === 'snapshot' &&
          ' Service definitions load from the repository; map imagery and identify still use the live services.'}
      </p>
      {loading && !catalogueError && (
        <InlineAlert loading>Loading the {catalogueSource === 'snapshot' ? 'bundled' : 'live'} catalogue…</InlineAlert>
      )}
      {catalogueError && (
        <InlineAlert tone="error" title="Catalogue unavailable">
          {catalogueError}
        </InlineAlert>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setLoading(true)
          setCatalogueError('')
          setCaps(null)
          setCapError('')
          setStyle('')
          setCapLoading(!!sourceUrl)
          setRetry((value) => value + 1)
        }}
      >
        Refresh catalogue
      </Button>
      <label className="block text-sm font-medium">
        Map service
        <select
          aria-label="Map service"
          className="mt-1 w-full rounded-md border bg-background p-2 text-base"
          value={sourceUrl}
          onChange={(event) => {
            setCaps(null)
            setCapError('')
            setStyle('')
            setCapLoading(!!event.target.value)
            setSourceUrl(event.target.value)
          }}
        >
          <option value="">Choose a service</option>
          {sources.filter(isWmsSource).map((item) => (
            <option key={item.resource} value={item.resource}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        {sources.filter(isWmsSource).length} WMS services in the current catalogue. HTTPS basemaps remain available in
        PGMaps.
      </p>
      {capLoading && !capError && <InlineAlert loading>Loading service layers…</InlineAlert>}
      {capError && (
        <InlineAlert tone="error" title="Service unavailable">
          {capError}
        </InlineAlert>
      )}
      {caps && (
        <>
          <label className="block text-sm font-medium">
            Named layer or group ({caps.layers.length})
            <select
              aria-label="Named layer or group"
              className="mt-1 w-full rounded-md border bg-background p-2 text-base"
              value={layerName}
              onChange={(event) => {
                setLayerName(event.target.value)
                setStyle('')
              }}
            >
              {caps.layers.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          {(layer?.styles.length ?? 0) > 0 && (
            <label className="block text-sm font-medium">
              Layer style
              <select
                aria-label="Layer style"
                className="mt-1 w-full rounded-md border bg-background p-2 text-base"
                value={style}
                onChange={(event) => setStyle(event.target.value)}
              >
                <option value="">Service default</option>
                {layer?.styles.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!canRender && (
            <InlineAlert tone="warning">
              This layer does not advertise PNG maps in Web Mercator; it cannot be added to this view.
            </InlineAlert>
          )}
          <Button onClick={add} disabled={!canRender}>
            Add layer to map
          </Button>
          {source && (
            <a className="ml-3 text-sm text-primary underline" href={source.resource} target="_blank" rel="noreferrer">
              Capabilities XML
            </a>
          )}
        </>
      )}
    </>
  )
  const activePanel = (
    <>
      <h3 className="border-t pt-4 font-semibold">Map layers ({active.length})</h3>
      {!active.length && (
        <p className="text-sm text-muted-foreground">
          Add a layer to begin. Then click the map to inspect a queryable layer.
        </p>
      )}
      {active.map((item, index) => (
        <div key={item.id} className="space-y-2 rounded-md border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{item.layer.title}</p>
              <p className="text-xs text-muted-foreground">{item.source.name}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${item.layer.title}`}
              onClick={() => {
                setActive((current) => current.filter((value) => value.id !== item.id))
                if (identifyId === item.id) {
                  setIdentifyId('')
                  setInspection(null)
                }
              }}
            >
              Remove
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs">
              <input
                aria-label={`Show ${item.layer.title}`}
                type="checkbox"
                checked={item.visible !== false}
                onChange={(event) =>
                  setActive((current) =>
                    current.map((value) =>
                      value.id === item.id ? { ...value, visible: event.target.checked } : value,
                    ),
                  )
                }
              />{' '}
              Visible
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={index === 0}
              aria-label={`Lower ${item.layer.title}`}
              onClick={() =>
                setActive((current) => {
                  const next = [...current]
                  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                  return next
                })
              }
            >
              Lower
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={index === active.length - 1}
              aria-label={`Raise ${item.layer.title}`}
              onClick={() =>
                setActive((current) => {
                  const next = [...current]
                  ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                  return next
                })
              }
            >
              Raise
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!!verifyingId}
            onClick={async () => {
              setVerifyingId(item.id)
              setActiveStyleError('')
              try {
                const verified = await loadWmsCapabilities(item.source)
                const named = verified.layers.find((layer) => layer.name === item.layer.name)
                if (!named) throw new Error('This source no longer advertises the imported layer.')
                if (
                  !named.crs.some((crs) => crs.toUpperCase() === 'EPSG:3857') ||
                  !verified.mapFormats.includes('image/png')
                )
                  throw new Error('This source does not advertise EPSG:3857 PNG rendering.')
                setActive((current) =>
                  current.map((value) =>
                    value.id === item.id ? { ...value, layer: named, formats: verified.featureInfoFormats } : value,
                  ),
                )
              } catch (reason) {
                setActiveStyleError(errorText(reason))
              } finally {
                setVerifyingId('')
              }
            }}
          >
            {verifyingId === item.id ? 'Verifying service…' : 'Verify service / query fields'}
          </Button>
          {item.native?.directDb && item.native.layerId && (
            <Button
              size="sm"
              variant="outline"
              disabled={!!verifyingId}
              onClick={async () => {
                setVerifyingId(item.id)
                setActiveStyleError('')
                try {
                  const resolved = await refreshSharedLayer(item.native!, portalRead)
                  const refreshedResource = new URL(resolved.resource)
                  const savedStyle = new URL(item.source.resource).searchParams.get('SLD')
                  if (savedStyle && !refreshedResource.searchParams.has('SLD'))
                    refreshedResource.searchParams.set('SLD', checkedSldUrl(savedStyle))
                  setActive((current) =>
                    current.map((value) =>
                      value.id === item.id
                        ? {
                            ...value,
                            native: resolved.reference,
                            source: { ...value.source, resource: refreshedResource.href },
                            layer: {
                              ...value.layer,
                              name: resolved.name,
                              title: resolved.title,
                              queryable: false,
                              styles: [],
                            },
                            formats: [],
                            style: '',
                          }
                        : value,
                    ),
                  )
                  setActiveStyleError(
                    'Reference refreshed. Verify service to enable identify. A generated default SLD is not requested; existing expired styles need an explicit source styling change.',
                  )
                } catch (reason) {
                  setActiveStyleError(errorText(reason))
                } finally {
                  setVerifyingId('')
                }
              }}
            >
              Refresh authorized native reference
            </Button>
          )}
          {item.layer.styles.length > 0 && (
            <label className="block text-xs">
              Advertised WMS style
              <select
                aria-label={`WMS style for ${item.layer.title}`}
                className="mt-1 w-full rounded border bg-background p-2"
                value={item.style}
                onChange={(event) =>
                  setActive((current) =>
                    current.map((value) => (value.id === item.id ? { ...value, style: event.target.value } : value)),
                  )
                }
              >
                <option value="">Service default</option>
                {item.style && !item.layer.styles.some((style) => style.name === item.style) && (
                  <option value={item.style}>{item.style} · imported unverified</option>
                )}
                {item.layer.styles.map((style) => (
                  <option key={style.name} value={style.name}>
                    {style.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <details className="text-xs">
            <summary>SLD reference / source query</summary>
            <p className="my-2 break-all">{item.source.resource}</p>
            <p>
              HTTPS SLD references can be rendered by the WMS service. Inline SLD rules, symbolizers and filters are
              preserved in original metadata; their vector styling is not translated.
            </p>
            <label className="mt-2 block">
              HTTPS SLD URL
              <input
                key={item.source.resource}
                aria-label={`SLD URL for ${item.layer.title}`}
                className="mt-1 w-full rounded border bg-background p-2"
                defaultValue={new URL(item.source.resource).searchParams.get('SLD') ?? ''}
                onBlur={(event) => {
                  try {
                    const resource = new URL(item.source.resource)
                    if (event.target.value.trim())
                      resource.searchParams.set('SLD', checkedSldUrl(event.target.value.trim()))
                    else resource.searchParams.delete('SLD')
                    setActive((current) =>
                      current.map((value) =>
                        value.id === item.id
                          ? { ...value, source: { ...value.source, resource: resource.href } }
                          : value,
                      ),
                    )
                    setActiveStyleError('')
                  } catch (reason) {
                    setActiveStyleError(errorText(reason))
                  }
                }}
              />
            </label>
          </details>
          {activeStyleError && <InlineAlert tone="error">{activeStyleError}</InlineAlert>}
          <label className="block text-xs">
            Opacity {Math.round(item.opacity * 100)}%
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              aria-label={`Opacity for ${item.layer.title}`}
              value={item.opacity}
              onChange={(event) =>
                setActive((current) =>
                  current.map((value) =>
                    value.id === item.id ? { ...value, opacity: Number(event.target.value) } : value,
                  ),
                )
              }
              className="mt-2 w-full"
            />
          </label>
          {item.layer.bounds && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                mapRef.current?.fitBounds(
                  [
                    [item.layer.bounds![0], item.layer.bounds![1]],
                    [item.layer.bounds![2], item.layer.bounds![3]],
                  ],
                  { padding: 30, maxZoom: 12 },
                )
              }
            >
              Zoom to layer
            </Button>
          )}
        </div>
      ))}
    </>
  )
  const mapSurface = (
    <div
      className={
        layout === 'portal'
          ? 'relative h-full min-h-0 overflow-hidden'
          : 'relative h-[420px] overflow-hidden rounded-lg border lg:h-[580px]'
      }
    >
      <Map
        ref={mapRef}
        center={workspace.camera.center}
        zoom={workspace.camera.zoom}
        pitch={workspace.camera.pitch}
        bearing={workspace.camera.bearing}
        className="h-full"
        showLoadingOverlay={false}
        controls={
          layout === 'portal' ? (
            <MapControls position="top-left" mobilePosition="top-left" showCompass showZoom />
          ) : undefined
        }
      >
        {renderOrder.map((entry) => {
          if (entry.kind === 'tile') {
            const item = workspace.tiles.find((item) => item.id === entry.id)!
            return (
              <MapRasterLayer
                key={`tile-${rasterOrder}-${item.id}`}
                tiles={item.urls}
                attribution={item.attribution}
                visible={item.visible}
              />
            )
          }
          if (entry.kind === 'wms') {
            const item = tiles.find((item) => item.id === entry.id)!
            return (
              <MapRasterLayer
                key={`wms-${rasterOrder}-${item.id}`}
                tiles={item.tiles}
                opacity={item.opacity}
                visible={item.visible !== false}
                attribution={item.source.attributions || item.source.name}
              />
            )
          }
          const item = workspace.vectors.find((item) => item.id === entry.id)!
          return (
            <VectorLayers
              key={`vector-${rasterOrder}-${item.id}`}
              vectors={[item]}
              onSelect={!drawing ? onVectorSelect : undefined}
            />
          )
        })}
        <VectorLayers
          vectors={[
            { id: 'drawing-preview', name: 'Drawing preview', data: sketch, color: '#a21caf', visible: drawing },
          ]}
        />
        <MapScaleBar />
        {layout === 'portal' && <InitialWatershedView bounds={initialBounds} />}
        <CameraObserver onCamera={onCamera} onBounds={onBounds} />
        <Identify
          selected={!drawing && selected?.visible !== false ? selected : undefined}
          onResult={onResult}
          onMapError={onMapError}
        />
      </Map>
    </div>
  )
  const workspacePanel = (
    <details className="rounded-lg border p-3" open={layout === 'portal' ? true : undefined}>
      <summary className="cursor-pointer text-sm font-semibold">Save, load and import workspaces</summary>
      <p className="mt-2 text-xs text-muted-foreground">
        JSON saves include camera, layer order/visibility, WMS styles and local vectors. Browser saves use this device.
        Named browser projects and original portal project controls are available below. Imports preserve the native
        project and report conversion limits.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadText(JSON.stringify(workspace, null, 2), 'nechako-workspace.json', 'application/json')}
        >
          Export workspace JSON
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            try {
              localStorage.setItem('pgmaps.nechako.workspace.v1', JSON.stringify(workspace))
              setWorkspaceMessage('Workspace saved in this browser.')
              setWorkspaceError('')
            } catch (error) {
              setWorkspaceError(errorText(error))
            }
          }}
        >
          Save workspace in browser
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            try {
              const saved = localStorage.getItem('pgmaps.nechako.workspace.v1')
              if (!saved) throw new Error('No saved workspace in this browser.')
              applyWorkspace(JSON.parse(saved))
            } catch (error) {
              setWorkspaceError(errorText(error))
            }
          }}
        >
          Restore browser workspace
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            localStorage.removeItem('pgmaps.nechako.workspace.v1')
            setWorkspaceMessage('Browser workspace removed.')
          }}
        >
          Remove browser save
        </Button>
        {workspace.originalProject !== undefined && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadText(
                JSON.stringify(workspace.originalProject, null, 2),
                'original-portal-project.json',
                'application/json',
              )
            }
          >
            Export original portal project
          </Button>
        )}
        <label className="block w-full text-sm">
          Import portal project or workspace JSON
          <input
            aria-label="Import portal project or workspace JSON"
            type="file"
            accept=".json"
            className="mt-1 block max-w-full"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              try {
                if (file.size > 20 * 1024 * 1024) throw new Error('Workspace exceeds 20 MB.')
                applyWorkspace(JSON.parse(await file.text()))
              } catch (error) {
                setWorkspaceError(errorText(error))
              }
            }}
          />
        </label>
      </div>
      <div className="mt-4 border-t pt-4">
        <PortalProjectManager workspace={workspace} onWorkspace={applyWorkspace} />
      </div>
      {workspaceError && <InlineAlert tone="error">{workspaceError}</InlineAlert>}
      {workspaceMessage && (
        <p className="mt-2 text-sm" role="status">
          {workspaceMessage}
        </p>
      )}
      {!!workspace.warnings.length && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {workspace.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}
      {workspace.tiles.map((item) => (
        <label key={item.id} className="mt-2 block text-sm">
          <input
            type="checkbox"
            checked={item.visible}
            onChange={(event) =>
              setWorkspace((current) => ({
                ...current,
                tiles: current.tiles.map((value) =>
                  value.id === item.id ? { ...value, visible: event.target.checked } : value,
                ),
              }))
            }
          />{' '}
          {item.name}
        </label>
      ))}
    </details>
  )
  const vectorPanel = (
    <PortalVectors
      key={workspaceRevision}
      vectors={workspace.vectors}
      setVectors={(vectors) => setWorkspace((current) => ({ ...current, vectors }))}
      map={mapRef}
      onDrawing={setDrawing}
      onSketch={setSketch}
      picked={picked}
    />
  )
  const inspectionPanel = (
    <>
      {mapError && (
        <InlineAlert tone="error" title="A map request failed">
          {mapError}
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => {
              setMapError('')
              mapRef.current?.triggerRepaint()
            }}
          >
            Dismiss
          </Button>
        </InlineAlert>
      )}
      <label className="block text-sm font-medium">
        Inspect on map click
        <select
          aria-label="Inspect on map click"
          className="mt-1 w-full rounded-md border bg-background p-2 text-base"
          value={identifyId}
          onChange={(event) => {
            setIdentifyId(event.target.value)
            setInspection(null)
          }}
        >
          <option value="">Inspection off</option>
          {active
            .filter((item) => item.layer.queryable && item.visible !== false)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.source.name} — {item.layer.title}
              </option>
            ))}
        </select>
      </label>
      {inspection && (
        <div className="rounded-lg border p-4" aria-live="polite">
          <h3 className="font-semibold">Identify: {inspection.layer}</h3>
          {inspection.error ? (
            <InlineAlert tone="error">{inspection.text}</InlineAlert>
          ) : (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{inspection.text}</pre>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Up to 10 features at the clicked location. Attribute responses may contain no geometry; they are not
            complete vector downloads.
          </p>
        </div>
      )}
      {active.length > 0 && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Layer legends ({active.length})</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {active.map((item) => (
              <LayerLegend key={item.id} active={item} />
            ))}
          </div>
        </details>
      )}
    </>
  )

  if (layout === 'portal') {
    return (
      <div className="relative flex h-full min-h-0" data-nechako-portal-map>
        <PortalDock side="left" title="Map Tools" open={toolsOpen} onOpenChange={setToolsOpen}>
          <Button variant="outline" className="w-full" onClick={onOpenFiles}>
            Import files
          </Button>
          {cataloguePanel}
          {vectorPanel}
        </PortalDock>
        <div className="min-w-0 flex-1">{mapSurface}</div>
        <PortalDock side="right" title="Map" open={layersOpen} onOpenChange={setLayersOpen}>
          {activePanel}
          {workspace.vectors.map((vector) => (
            <label key={vector.id} className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                aria-label={`Show ${vector.name}`}
                checked={vector.visible}
                onChange={(event) =>
                  setWorkspace((current) => ({
                    ...current,
                    vectors: current.vectors.map((item) =>
                      item.id === vector.id ? { ...item, visible: event.target.checked } : item,
                    ),
                  }))
                }
              />
              <span>
                {vector.name} ({vector.data.features.length} features)
              </span>
            </label>
          ))}
          {inspectionPanel}
        </PortalDock>
        <DialogShell
          title="Projects"
          subtitle="Save, restore or import the map workspace. Browser saves stay on this device."
          open={projectsOpen}
          onClose={onProjectsClose}
          size="lg"
        >
          {workspacePanel}
        </DialogShell>
      </div>
    )
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="space-y-4">
        {cataloguePanel}
        {activePanel}
      </div>
      <div className="min-w-0 space-y-3">
        {mapSurface}
        {workspacePanel}
        {vectorPanel}
        {inspectionPanel}
      </div>
    </div>
  )
}

function InitialWatershedView({ bounds }: { bounds?: [number, number, number, number] }) {
  const { map, isLoaded } = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (!map || !isLoaded || fitted.current || !bounds) return
    fitted.current = true
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 35, maxZoom: 7, duration: 0 },
    )
  }, [map, isLoaded, bounds])
  return null
}

function CameraObserver({
  onCamera,
  onBounds,
}: {
  onCamera: (camera: Workspace['camera']) => void
  onBounds: (bounds: [number, number, number, number]) => void
}) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    const update = () => {
      const center = map.getCenter(),
        bounds = map.getBounds()
      onCamera({
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      })
      onBounds([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()])
    }
    update()
    map.on('moveend', update)
    return () => {
      map.off('moveend', update)
    }
  }, [map, isLoaded, onCamera, onBounds])
  return null
}
