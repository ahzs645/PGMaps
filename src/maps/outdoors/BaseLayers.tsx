import { useEffect, useMemo, useRef, useState } from 'react'

import { useMap } from '@/components/ui/map'
import {
  MapCircleLayer,
  MapFillLayer,
  MapLineLayer,
  MapRasterLayer,
  MapTerrain,
  type MapTerrainProps,
} from '@/components/ui/map-layers'
import { escapeHtml } from '@/lib/escapeHtml'
import { SATELLITE_ATTRIBUTION, SATELLITE_TILES } from '@/pages/dev-forestry/SatelliteImagery'
import { MAX_DEM_ZOOM, TERRAIN_ATTRIBUTION, TERRARIUM_TILE_URL } from '@/pages/dev-forestry/terrain'

import {
  BC_LAYER_SOURCES,
  CUTBLOCK_AGE_COLORS,
  describeBoatLaunch,
  describeCutblock,
  describeDepthChart,
  describeDepthContour,
  describeForestRoad,
  fetchBcLayer,
  parseCoastalLaunches,
  parseCutblocks,
  parseDepthCharts,
  parseDepthContours,
  parseForestRoads,
  parseRecLaunches,
  type BcLayerId,
  type CardText,
  type LayerAnswer,
} from './bcLayers'
import {
  RAILWAY_MIN_ZOOM,
  boundsContain,
  clampRailwayBounds,
  describeRailway,
  fetchRailways,
  padBounds,
  type Bounds,
} from './railways'

const TERRAIN_ID = 'outdoors'
const HILLSHADE_LAYER_ID = `${TERRAIN_ID}-hillshade`

/**
 * Draw order, low to high. Every layer here takes a slot, because the
 * management-unit fill covers the province with a hover card and only the
 * topmost card layer under the pointer shows its card: anything left beneath
 * it could never be read. The planner's own features sit at
 * `PLAN_LAYER_ORDER` and up, above all of these.
 */
const ORDER = {
  depthCharts: 10,
  depthContours: 11,
  cutblocks: 12,
  forestRoads: 16,
  rail: 20,
  launches: 26,
} as const
export const PLAN_LAYER_ORDER = 40

const DEM: MapTerrainProps['dem'] = {
  tiles: [TERRARIUM_TILE_URL],
  encoding: 'terrarium',
  maxZoom: MAX_DEM_ZOOM,
  attribution: TERRAIN_ATTRIBUTION,
}

export const BASE_LAYER_KEYS = [
  'satellite',
  'relief',
  'forestRoads',
  'rail',
  'cutblocks',
  'launches',
  'lakeDepth',
] as const
export type BaseLayerKey = (typeof BASE_LAYER_KEYS)[number]
export type BaseLayerChoices = Record<BaseLayerKey, boolean>

export const DEFAULT_BASE_LAYERS: BaseLayerChoices = {
  satellite: false,
  relief: false,
  forestRoads: false,
  rail: false,
  cutblocks: false,
  launches: false,
  lakeDepth: false,
}

export type LayerStatus =
  | { state: 'off' }
  | { state: 'zoom-in' }
  | { state: 'loading' }
  | { state: 'ready'; count: number; truncated: boolean }
  | { state: 'error'; message: string }

/** The layers that load data and so have something to report. */
export type DataLayerKey = Exclude<BaseLayerKey, 'satellite' | 'relief'>
export type LayerStatuses = Partial<Record<DataLayerKey, LayerStatus>>

type MapInstance = NonNullable<ReturnType<typeof useMap>['map']>
type Collection<P> = GeoJSON.FeatureCollection<GeoJSON.Geometry, P>

const EMPTY = { type: 'FeatureCollection', features: [] } as const

function emptyCollection<P>(): Collection<P> {
  return EMPTY as unknown as Collection<P>
}

function viewBounds(map: MapInstance): Bounds {
  const bounds = map.getBounds()
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
}

function cardHtml(card: CardText): string {
  return `<div class="max-w-64 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
    <div class="font-semibold">${escapeHtml(card.title)}</div>
    ${card.lines.map((line) => `<div class="mt-1 text-muted-foreground">${escapeHtml(line)}</div>`).join('')}
    ${card.caution ? `<div class="mt-1 text-amber-700 dark:text-amber-400">${escapeHtml(card.caution)}</div>` : ''}
  </div>`
}

/**
 * Data for the current view, asked for again only when the map leaves the box
 * the last answer covered. Zoomed out past `minZoom` nothing is asked for and
 * `visible` is false, so the caller hides what it last drew.
 */
function useViewData<P>(
  load: (bounds: Bounds, signal: AbortSignal) => Promise<LayerAnswer<P> & { bounds: Bounds }>,
  minZoom: number,
  onStatus: (status: LayerStatus) => void,
): { collection: Collection<P>; visible: boolean } {
  const { map, isLoaded } = useMap()
  const [collection, setCollection] = useState<Collection<P>>(emptyCollection)
  const [visible, setVisible] = useState(false)
  const coveredRef = useRef<Bounds | null>(null)
  const loadRef = useRef(load)
  const onStatusRef = useRef(onStatus)

  useEffect(() => {
    loadRef.current = load
    onStatusRef.current = onStatus
  }, [load, onStatus])

  useEffect(() => {
    if (!map || !isLoaded) return
    let controller: AbortController | null = null

    const refresh = () => {
      const near = map.getZoom() >= minZoom
      setVisible(near)
      if (!near) {
        controller?.abort()
        onStatusRef.current({ state: 'zoom-in' })
        return
      }
      const view = viewBounds(map)
      if (coveredRef.current && boundsContain(coveredRef.current, view)) return
      controller?.abort()
      const request = new AbortController()
      controller = request
      onStatusRef.current({ state: 'loading' })
      loadRef
        .current(padBounds(view, 0.5), request.signal)
        .then((result) => {
          if (request.signal.aborted) return
          // A truncated answer does not cover its box, so the next move asks again.
          coveredRef.current = result.truncated ? null : result.bounds
          setCollection(result.collection)
          onStatusRef.current({
            state: 'ready',
            count: result.collection.features.length,
            truncated: result.truncated,
          })
        })
        .catch((error: unknown) => {
          if (request.signal.aborted) return
          coveredRef.current = null
          onStatusRef.current({
            state: 'error',
            message: error instanceof Error ? error.message : 'The layer could not be loaded',
          })
        })
    }

    refresh()
    map.on('moveend', refresh)
    return () => {
      map.off('moveend', refresh)
      controller?.abort()
      onStatusRef.current({ state: 'off' })
    }
  }, [map, isLoaded, minZoom])

  return { collection, visible }
}

/** Data small enough to read whole, once, when the layer is switched on. */
function useWholeData<P>(
  load: (signal: AbortSignal) => Promise<LayerAnswer<P>>,
  onStatus: (status: LayerStatus) => void,
): Collection<P> {
  const [collection, setCollection] = useState<Collection<P>>(emptyCollection)
  const loadRef = useRef(load)
  const onStatusRef = useRef(onStatus)

  useEffect(() => {
    loadRef.current = load
    onStatusRef.current = onStatus
  }, [load, onStatus])

  useEffect(() => {
    const controller = new AbortController()
    onStatusRef.current({ state: 'loading' })
    loadRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setCollection(result.collection)
        onStatusRef.current({
          state: 'ready',
          count: result.collection.features.length,
          truncated: result.truncated,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        onStatusRef.current({
          state: 'error',
          message: error instanceof Error ? error.message : 'The layer could not be loaded',
        })
      })
    return () => {
      controller.abort()
      onStatusRef.current({ state: 'off' })
    }
  }, [])

  return collection
}

function viewLoader<P>(layer: BcLayerId, parse: (payload: unknown) => LayerAnswer<P>) {
  return async (bounds: Bounds, signal: AbortSignal) => ({
    ...parse(await fetchBcLayer(layer, bounds, signal)),
    bounds: clampRailwayBounds(bounds),
  })
}

/**
 * Satellite imagery under the labels and under the relief shading when that is
 * on, so the hills still read on the photo. A raster added above the hillshade
 * would hide it, and the two can be switched on in either order, so the anchor
 * is looked up after the relief has had its turn to mount.
 */
function ImageryLayer({ visible, relief }: { visible: boolean; relief: boolean }) {
  const { map, isLoaded } = useMap()
  const [anchor, setAnchor] = useState<{ id: string | undefined } | null>(null)

  useEffect(() => {
    if (!map || !isLoaded || !visible) return
    const find = () => {
      const firstLabel = map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id
      setAnchor({ id: map.getLayer(HILLSHADE_LAYER_ID) ? HILLSHADE_LAYER_ID : firstLabel })
    }
    find()
    map.on('style.load', find)
    return () => {
      map.off('style.load', find)
      setAnchor(null)
    }
    // `relief` is a dependency on purpose: the hillshade layer appears and
    // disappears with it, and the imagery has to be re-anchored each time.
  }, [map, isLoaded, visible, relief])

  if (!visible || !anchor) return null
  return (
    <MapRasterLayer
      key={anchor.id ?? 'top'}
      tiles={SATELLITE_TILES}
      tileSize={256}
      // Esri answers z19 in rural BC with a grey placeholder tile; z18 is real.
      maxZoom={18}
      attribution={SATELLITE_ATTRIBUTION}
      beforeId={anchor.id}
    />
  )
}

const loadRailways = async (bounds: Bounds, signal: AbortSignal) => fetchRailways(bounds, signal)
const railwayHoverHtml = (properties: Record<string, unknown>) => {
  const { title, detail, caution } = describeRailway(properties)
  return cardHtml({ title, lines: detail ? [detail] : [], caution })
}

function RailwayLayer({ onStatus }: { onStatus: (status: LayerStatus) => void }) {
  const { collection, visible } = useViewData(loadRailways, RAILWAY_MIN_ZOOM, onStatus)
  if (!visible) return null
  return (
    <>
      <MapLineLayer
        data={collection}
        color="#111827"
        width={['case', ['get', 'through'], 3.6, 2.2]}
        opacity={0.9}
        interactive={false}
        layerOrder={ORDER.rail}
      />
      <MapLineLayer
        data={collection}
        color="#ffffff"
        width={['case', ['get', 'through'], 1.8, 1]}
        dashArray={[3, 3]}
        interactive={false}
        layerOrder={ORDER.rail + 1}
      />
      {/* A line two pixels wide is hard to point at, so a wide, near-invisible
          copy on top takes the pointer and shows the card. */}
      <MapLineLayer
        data={collection}
        color="#ffffff"
        width={14}
        opacity={0.01}
        hoverHtml={railwayHoverHtml}
        layerOrder={ORDER.rail + 2}
      />
    </>
  )
}

const loadForestRoads = viewLoader('forestRoads', parseForestRoads)
const forestRoadHoverHtml = (properties: Record<string, unknown>) => cardHtml(describeForestRoad(properties))

function ForestRoadLayer({ onStatus }: { onStatus: (status: LayerStatus) => void }) {
  const { collection, visible } = useViewData(loadForestRoads, BC_LAYER_SOURCES.forestRoads.minZoom ?? 0, onStatus)
  if (!visible) return null
  return (
    <>
      {/* Forest Service Roads in strong orange; permit roads thinner and paler.
          Retired tenure fades, since the road may no longer be there. */}
      <MapLineLayer
        data={collection}
        color={['case', ['get', 'fsr'], '#ea580c', '#fbbf24']}
        width={['case', ['get', 'fsr'], 2.6, 1.4]}
        opacity={['case', ['get', 'retired'], 0.45, 0.95]}
        interactive={false}
        layerOrder={ORDER.forestRoads}
      />
      <MapLineLayer
        data={collection}
        color="#ffffff"
        width={12}
        opacity={0.01}
        hoverHtml={forestRoadHoverHtml}
        layerOrder={ORDER.forestRoads + 1}
      />
    </>
  )
}

const CUTBLOCK_COLOR = [
  'match',
  ['get', 'age'],
  ...Object.entries(CUTBLOCK_AGE_COLORS).flat(),
  CUTBLOCK_AGE_COLORS.unknown,
]

function CutblockLayer({ onStatus }: { onStatus: (status: LayerStatus) => void }) {
  // One year for the whole visit, so a block's age class cannot change mid-session.
  const currentYear = useMemo(() => new Date().getFullYear(), [])
  const load = useMemo(() => viewLoader('cutblocks', (payload) => parseCutblocks(payload, currentYear)), [currentYear])
  const hoverHtml = useMemo(
    () => (properties: Record<string, unknown>) => cardHtml(describeCutblock(properties, currentYear)),
    [currentYear],
  )
  const { collection, visible } = useViewData(load, BC_LAYER_SOURCES.cutblocks.minZoom ?? 0, onStatus)
  if (!visible) return null
  return (
    <MapFillLayer
      data={collection}
      fillColor={CUTBLOCK_COLOR}
      fillOpacity={0.3}
      lineColor={CUTBLOCK_COLOR}
      lineWidth={1.2}
      lineOpacity={0.95}
      hoverHtml={hoverHtml}
      layerOrder={ORDER.cutblocks}
    />
  )
}

const loadRecLaunches = async (signal: AbortSignal) =>
  parseRecLaunches(await fetchBcLayer('recLaunches', undefined, signal))
const loadCoastalLaunches = async (signal: AbortSignal) =>
  parseCoastalLaunches(await fetchBcLayer('coastalLaunches', undefined, signal))
const boatLaunchHoverHtml = (properties: Record<string, unknown>) => cardHtml(describeBoatLaunch(properties))

function BoatLaunchLayer({ onStatus }: { onStatus: (status: LayerStatus) => void }) {
  // Two inventories, one switch: the status the sidebar shows is their sum.
  const [parts, setParts] = useState<{ rec: LayerStatus; coast: LayerStatus }>({
    rec: { state: 'loading' },
    coast: { state: 'loading' },
  })
  const recreation = useWholeData(loadRecLaunches, (rec) => setParts((current) => ({ ...current, rec })))
  const coastal = useWholeData(loadCoastalLaunches, (coast) => setParts((current) => ({ ...current, coast })))

  useEffect(() => {
    const { rec, coast } = parts
    if (rec.state === 'error' && coast.state === 'error') onStatus(rec)
    else if (rec.state === 'loading' || coast.state === 'loading') onStatus({ state: 'loading' })
    else if (rec.state === 'off' && coast.state === 'off') onStatus({ state: 'off' })
    else
      onStatus({
        state: 'ready',
        count: (rec.state === 'ready' ? rec.count : 0) + (coast.state === 'ready' ? coast.count : 0),
        // A failed half means the count is short of what exists.
        truncated:
          rec.state === 'error' ||
          coast.state === 'error' ||
          (rec.state === 'ready' && rec.truncated) ||
          (coast.state === 'ready' && coast.truncated),
      })
  }, [parts, onStatus])

  return (
    <>
      {[recreation, coastal].map((data, index) => (
        <MapCircleLayer
          key={index === 0 ? 'recreation' : 'coastal'}
          data={data}
          color="#0d9488"
          radius={6}
          strokeColor="#ffffff"
          strokeWidth={2}
          hoverHtml={boatLaunchHoverHtml}
          layerOrder={ORDER.launches + index}
        />
      ))}
    </>
  )
}

const loadDepthCharts = viewLoader('depthCharts', parseDepthCharts)
const loadDepthContours = async (signal: AbortSignal) =>
  parseDepthContours(await fetchBcLayer('depthContours', undefined, signal))
const depthChartHoverHtml = (properties: Record<string, unknown>) => cardHtml(describeDepthChart(properties))
const depthContourHoverHtml = (properties: Record<string, unknown>) => cardHtml(describeDepthContour(properties))
const ignoreStatus = () => {}

function LakeDepthLayer({ onStatus }: { onStatus: (status: LayerStatus) => void }) {
  const { collection: charts, visible } = useViewData(
    loadDepthCharts,
    BC_LAYER_SOURCES.depthCharts.minZoom ?? 0,
    onStatus,
  )
  // The digitized contours cover only a few lakes; the charts carry the count.
  const contours = useWholeData(loadDepthContours, ignoreStatus)

  const chartUrls = useMemo(() => {
    const urls = new Map<string, string>()
    for (const feature of charts.features) {
      if (feature.properties.pdfUrl) urls.set(feature.properties.id, feature.properties.pdfUrl)
    }
    return urls
  }, [charts])

  return (
    <>
      {visible && (
        <MapFillLayer
          data={charts}
          fillColor="#38bdf8"
          fillOpacity={0.25}
          lineColor="#0369a1"
          lineWidth={1.4}
          lineOpacity={0.9}
          idProperty="id"
          hoverHtml={depthChartHoverHtml}
          onFeatureClick={(id) => {
            const url = chartUrls.get(String(id))
            if (url) window.open(url, '_blank', 'noopener,noreferrer')
          }}
          layerOrder={ORDER.depthCharts}
        />
      )}
      {/* Stacked translucent fills: each polygon is "deeper than this", so the
          lake darkens toward its deepest point without a colour ramp. */}
      <MapFillLayer
        data={contours}
        fillColor="#0c4a6e"
        fillOpacity={0.16}
        lineColor="#e0f2fe"
        lineWidth={0.6}
        lineOpacity={0.7}
        hoverHtml={depthContourHoverHtml}
        layerOrder={ORDER.depthContours}
      />
    </>
  )
}

/** The trip planner's optional layers. Render inside the planner's `Map`. */
export function OutdoorsBaseLayers({
  choices,
  onStatus,
}: {
  choices: BaseLayerChoices
  onStatus: (layer: DataLayerKey, status: LayerStatus) => void
}) {
  // One stable reporter per layer, so a layer's effects do not restart on every render.
  const report = useMemo(
    () => ({
      forestRoads: (status: LayerStatus) => onStatus('forestRoads', status),
      rail: (status: LayerStatus) => onStatus('rail', status),
      cutblocks: (status: LayerStatus) => onStatus('cutblocks', status),
      launches: (status: LayerStatus) => onStatus('launches', status),
      lakeDepth: (status: LayerStatus) => onStatus('lakeDepth', status),
    }),
    [onStatus],
  )
  return (
    <>
      {choices.relief && (
        <MapTerrain
          id={TERRAIN_ID}
          dem={DEM}
          reliefOnly
          // Over a photo the shading only has to hint at the slope; on the
          // pale plan map it carries the whole picture of the ground.
          hillshadeIntensity={choices.satellite ? 0.35 : 0.6}
          hillshadeShadowColor="#1e293b"
          hillshadeHighlightColor="#f8fafc"
        />
      )}
      <ImageryLayer visible={choices.satellite} relief={choices.relief} />
      {choices.lakeDepth && <LakeDepthLayer onStatus={report.lakeDepth} />}
      {choices.cutblocks && <CutblockLayer onStatus={report.cutblocks} />}
      {choices.forestRoads && <ForestRoadLayer onStatus={report.forestRoads} />}
      {choices.rail && <RailwayLayer onStatus={report.rail} />}
      {choices.launches && <BoatLaunchLayer onStatus={report.launches} />}
    </>
  )
}
