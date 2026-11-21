import { useEffect, useMemo, useRef, useState } from 'react'

import { useMap } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MapHandoffNote, MapRasterHandoff, useMapLayerHandoff } from '@/components/ui/map-raster-handoff'
import { RegionalReliefLayer } from '@/components/ui/map-regional-relief'
import { SatelliteImagery } from '@/components/ui/map-satellite-imagery'
import { useViewWindowRead, type ViewReadState } from '@/components/ui/map-view-read'
import type { ViewWindow } from '@/components/ui/map-view-window'
import { escapeHtml } from '@/lib/escapeHtml'

import {
  ALL_ROADS_MIN_ZOOM,
  chartSheetsOf,
  CUTBLOCK_MIN_ZOOM,
  CUTBLOCK_READ,
  DEPTH_BANDS,
  describeBoatLaunch,
  describeCutblock,
  describeDepthChart,
  describeDepthContour,
  describeForestRoad,
  describeStand,
  forestRoadReads,
  FSR_MIN_ZOOM,
  huntZoneFilter,
  MAX_READ_DETAIL_ZOOM,
  OPENNESS_COLORS,
  parseCoastalLaunches,
  parseCutblocks,
  parseDepthCharts,
  parseDepthContours,
  parseForestRoads,
  parseHuntZones,
  parseRecLaunches,
  parseStands,
  readArcgis,
  readWfs,
  WFS_SOURCES,
  type CardText,
  type HuntZoneSpecies,
  type LayerAnswer,
} from './bcLayers'
import { huntsForHuntArea, loadLehDraws, oddsText, seasonText, type LehHunt } from './leh'
import { describeRailway, fetchRailways, RAILWAY_MIN_ZOOM } from './railways'
import {
  RECENT_IMAGERY_ATTRIBUTION,
  RECENT_IMAGERY_LAYERS,
  RECENT_IMAGERY_MAX_ZOOM,
  recentImageryTiles,
} from './recentImagery'

/**
 * Draw order, low to high. Every layer here takes a slot, because the management-unit fill covers
 * the province with a hover card and only the topmost card layer under the pointer shows its card:
 * anything left beneath it could never be read. The planner's own features sit at
 * `PLAN_LAYER_ORDER` and up, above all of these.
 */
const ORDER = {
  stands: 6,
  huntZones: 8,
  depthCharts: 10,
  depthContours: 11,
  cutblocks: 12,
  forestRoads: 16,
  rail: 20,
  launches: 26,
} as const
export const PLAN_LAYER_ORDER = 40

/** A lake chart outranks the management unit beneath it, so clicking a lake opens its chart without adding the unit. */
const CHART_PICK_PRIORITY = 1

export const BASE_LAYER_KEYS = [
  'satellite',
  'recent',
  'relief',
  'huntZones',
  'forestRoads',
  'rail',
  'cutblocks',
  'openness',
  'launches',
  'lakeDepth',
] as const
export type BaseLayerKey = (typeof BASE_LAYER_KEYS)[number]
export type BaseLayerChoices = Record<BaseLayerKey, boolean>

export const DEFAULT_BASE_LAYERS: BaseLayerChoices = {
  satellite: false,
  recent: false,
  relief: false,
  huntZones: false,
  forestRoads: false,
  rail: false,
  cutblocks: false,
  openness: false,
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
export type DataLayerKey = Exclude<BaseLayerKey, 'satellite' | 'recent' | 'relief'>
export type LayerStatuses = Partial<Record<DataLayerKey, LayerStatus>>

type Collection<P> = GeoJSON.FeatureCollection<GeoJSON.Geometry, P>
const EMPTY = { type: 'FeatureCollection', features: [] } as const
function emptyCollection<P>(): Collection<P> {
  return EMPTY as unknown as Collection<P>
}

export const OUTDOORS_RELIEF_ID = 'outdoors-relief'
const RELIEF_INTENSITY = { plain: 0.6, imagery: 0.35 }

function cardHtml(card: CardText, extra = ''): string {
  return `<div class="max-w-64 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
    <div class="font-semibold">${escapeHtml(card.title)}</div>
    ${card.lines.map((line) => `<div class="mt-1 text-muted-foreground">${escapeHtml(line)}</div>`).join('')}
    ${extra}
    ${card.caution ? `<div class="mt-1 text-warning">${escapeHtml(card.caution)}</div>` : ''}
  </div>`
}

/** A read's answer as the sidebar states it. A failed read keeps the last answer on the map. */
function statusOf<P>(read: ViewReadState<LayerAnswer<P>>): LayerStatus {
  if (read.belowMinZoom) return { state: 'zoom-in' }
  if (read.error && !read.loading) return { state: 'error', message: read.error }
  if (read.loading || !read.data) return { state: 'loading' }
  return { state: 'ready', count: read.data.collection.features.length, truncated: read.data.truncated }
}

function useReportStatus(status: LayerStatus, onStatus: (status: LayerStatus) => void) {
  const key = JSON.stringify(status)
  const onStatusRef = useRef(onStatus)
  useEffect(() => {
    onStatusRef.current = onStatus
  })
  useEffect(() => {
    onStatusRef.current(JSON.parse(key) as LayerStatus)
  }, [key])
  useEffect(() => () => onStatusRef.current({ state: 'off' }), [])
}

/** A WFS layer reads at full detail at every zoom, so one window serves every zoom it holds. */
const ONE_LEVEL = () => 0
/** An ArcGIS layer is generalised to the zoom it is read at, up to `MAX_READ_DETAIL_ZOOM`. */
const detailLevel = (_view: unknown, zoom: number) => Math.min(Math.floor(zoom), MAX_READ_DETAIL_ZOOM)

/** A layer read by the view, drawn until the next answer arrives. */
function useLayerRead<P>(
  enabled: boolean,
  minZoom: number,
  read: (window: ViewWindow, signal: AbortSignal) => Promise<LayerAnswer<P>>,
  onStatus: (status: LayerStatus) => void,
  options: { readKey?: string; level?: typeof detailLevel; overscan?: number } = {},
): { collection: Collection<P>; visible: boolean } {
  const { map } = useMap()
  const state = useViewWindowRead(map, {
    enabled,
    minZoom,
    read,
    level: options.level ?? ONE_LEVEL,
    readKey: options.readKey,
    overscan: options.overscan,
  })
  useReportStatus(statusOf(state), onStatus)
  return { collection: state.data?.collection ?? emptyCollection<P>(), visible: !state.belowMinZoom }
}

/** Data small enough to read whole, once, when the layer is switched on. */
function useWholeData<P>(
  load: (signal: AbortSignal) => Promise<LayerAnswer<P>>,
  onStatus: (status: LayerStatus) => void,
): Collection<P> {
  const [answer, setAnswer] = useState<LayerAnswer<P> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  useEffect(() => {
    const controller = new AbortController()
    loadRef
      .current(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setAnswer(result)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'The layer could not be loaded')
      })
    return () => controller.abort()
  }, [])
  const status: LayerStatus = error
    ? { state: 'error', message: error }
    : answer
      ? { state: 'ready', count: answer.collection.features.length, truncated: answer.truncated }
      : { state: 'loading' }
  useReportStatus(status, onStatus)
  return answer?.collection ?? emptyCollection<P>()
}

/** The basemap's first label layer: imagery goes under the labels. */
function useFirstLabelLayerId(active: boolean): string | undefined {
  const { map, isLoaded } = useMap()
  const [id, setId] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!map || !isLoaded || !active) return
    const find = () => setId(map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id)
    find()
    map.on('style.load', find)
    return () => {
      map.off('style.load', find)
    }
  }, [map, isLoaded, active])
  return active ? id : undefined
}

/**
 * One day's satellite passes over the undated photo, one hand-off for each of the two products, so a
 * new day loads behind the one shown and swaps in one frame rather than blanking the map. Where no
 * satellite passed that day the tiles are transparent and the photo shows.
 */
function RecentImageryLayers({ date, visible }: { date: string; visible: boolean }) {
  const beforeId = useFirstLabelLayerId(visible)
  const landsat = useMapLayerHandoff('outdoors-recent-l30', visible ? { key: date, value: date } : null)
  const sentinel = useMapLayerHandoff('outdoors-recent-s30', visible ? { key: date, value: date } : null)
  const handoffs = [landsat, sentinel] as const
  return (
    <>
      {RECENT_IMAGERY_LAYERS.map((layer, index) => (
        <MapRasterHandoff
          key={layer}
          handoff={handoffs[index]}
          layer={(day) => ({
            tiles: [recentImageryTiles(layer, day)],
            tileSize: 256,
            maxZoom: RECENT_IMAGERY_MAX_ZOOM,
            attribution: index === 0 ? RECENT_IMAGERY_ATTRIBUTION : undefined,
            beforeId,
          })}
        />
      ))}
      {/* The sidebar names the new day at once; the map says when it has not caught up. */}
      <MapHandoffNote handoff={sentinel}>Loading {date}. The map still shows the previous day.</MapHandoffNote>
    </>
  )
}

const railwayHoverHtml = (properties: Record<string, unknown>) => {
  const { title, detail, caution } = describeRailway(properties)
  return cardHtml({ title, lines: detail ? [detail] : [], caution })
}

function RailwayLayer({ onStatus }: { onStatus: (status: LayerStatus) => void }) {
  const read = useMemo(() => (window: ViewWindow, signal: AbortSignal) => fetchRailways(window.bounds, signal), [])
  const { collection, visible } = useLayerRead(true, RAILWAY_MIN_ZOOM, read, onStatus)
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
      {/* A line two pixels wide is hard to point at, so a wide, near-invisible copy on top takes the
          pointer and shows the card. */}
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

const forestRoadHoverHtml = (properties: Record<string, unknown>) => cardHtml(describeForestRoad(properties))

function ForestRoadLayer({ onStatus }: { onStatus: (status: LayerStatus) => void }) {
  const read = useMemo(
    () => async (window: ViewWindow, signal: AbortSignal) => {
      const zoom = Number(window.level)
      const answer = await readArcgis(forestRoadReads(zoom), window.bounds, zoom, signal)
      return { collection: parseForestRoads(answer.features), truncated: answer.truncated }
    },
    [],
  )
  const { collection, visible } = useLayerRead(true, FSR_MIN_ZOOM, read, onStatus, { level: detailLevel })
  if (!visible) return null
  return (
    <>
      {/* Forest Service Roads in strong orange; permit roads thinner and paler. Retired tenure
          fades, since the road may no longer be there. */}
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

const cutblockHoverHtml = (properties: Record<string, unknown>) => cardHtml(describeCutblock(properties))

function CutblockLayer({ onStatus }: { onStatus: (status: LayerStatus) => void }) {
  // One year for the whole visit, so a block's age class cannot change mid-session.
  const [currentYear] = useState(() => new Date().getFullYear())
  const read = useMemo(
    () => async (window: ViewWindow, signal: AbortSignal) => {
      const zoom = Number(window.level)
      const answer = await readArcgis([CUTBLOCK_READ], window.bounds, zoom, signal)
      return { collection: parseCutblocks(answer.features, currentYear), truncated: answer.truncated }
    },
    [currentYear],
  )
  const { collection, visible } = useLayerRead(true, CUTBLOCK_MIN_ZOOM, read, onStatus, { level: detailLevel })
  if (!visible) return null
  return (
    <MapFillLayer
      data={collection}
      fillColor={['get', 'color']}
      fillOpacity={0.3}
      lineColor={['get', 'color']}
      lineWidth={1.2}
      lineOpacity={0.95}
      hoverHtml={cutblockHoverHtml}
      layerOrder={ORDER.cutblocks}
    />
  )
}

const standHoverHtml = (properties: Record<string, unknown>) => cardHtml(describeStand(properties))
const OPENNESS_COLOR = ['match', ['get', 'openness'], ...Object.entries(OPENNESS_COLORS).flat(), OPENNESS_COLORS.timber]
const readStands = async (window: ViewWindow, signal: AbortSignal) =>
  parseStands(await readWfs('stands', window.bounds, signal))

/** Forest stands coloured by how far a person is likely to see through them. */
function OpennessLayer({ onStatus }: { onStatus: (status: LayerStatus) => void }) {
  const { collection, visible } = useLayerRead(true, WFS_SOURCES.stands.minZoom ?? 0, readStands, onStatus)
  if (!visible) return null
  return (
    <MapFillLayer
      data={collection}
      fillColor={OPENNESS_COLOR}
      fillOpacity={0.45}
      lineColor={OPENNESS_COLOR}
      lineWidth={0.6}
      lineOpacity={0.8}
      hoverHtml={standHoverHtml}
      layerOrder={ORDER.stands}
    />
  )
}

const loadRecLaunches = async (signal: AbortSignal) => parseRecLaunches(await readWfs('recLaunches', undefined, signal))
const loadCoastalLaunches = async (signal: AbortSignal) =>
  parseCoastalLaunches(await readWfs('coastalLaunches', undefined, signal))
const boatLaunchHoverHtml = (properties: Record<string, unknown>) => cardHtml(describeBoatLaunch(properties))

function BoatLaunchLayer({ onStatus }: { onStatus: (status: LayerStatus) => void }) {
  // Two inventories, one switch: the status the sidebar shows is their sum.
  const [parts, setParts] = useState<{ rec: LayerStatus; coast: LayerStatus }>({
    rec: { state: 'loading' },
    coast: { state: 'loading' },
  })
  const recreation = useWholeData(loadRecLaunches, (rec) => setParts((current) => ({ ...current, rec })))
  const coastal = useWholeData(loadCoastalLaunches, (coast) => setParts((current) => ({ ...current, coast })))
  const { rec, coast } = parts
  const status: LayerStatus =
    rec.state === 'error' && coast.state === 'error'
      ? rec
      : rec.state === 'loading' || coast.state === 'loading'
        ? { state: 'loading' }
        : {
            state: 'ready',
            count: (rec.state === 'ready' ? rec.count : 0) + (coast.state === 'ready' ? coast.count : 0),
            // A failed half means the count is short of what exists.
            truncated:
              rec.state === 'error' ||
              coast.state === 'error' ||
              (rec.state === 'ready' && rec.truncated) ||
              (coast.state === 'ready' && coast.truncated),
          }
  useReportStatus(status, onStatus)

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

const readDepthCharts = async (window: ViewWindow, signal: AbortSignal) =>
  parseDepthCharts(await readWfs('depthCharts', window.bounds, signal))
const loadDepthContours = async (signal: AbortSignal) =>
  parseDepthContours(await readWfs('depthContours', undefined, signal))
const depthChartHoverHtml = (properties: Record<string, unknown>) => cardHtml(describeDepthChart(properties))
const depthContourHoverHtml = (properties: Record<string, unknown>) => cardHtml(describeDepthContour(properties))
const ignoreStatus = () => {}

/**
 * The scanned chart's sheets as links. The province serves them as PDFs without the headers a page
 * needs to read them, so they open in the browser's own viewer in a new tab. A scan is not
 * georeferenced and cannot be laid over the map; the few digitized lakes are drawn as depth bands.
 */
const depthChartClickHtml = (properties: Record<string, unknown>) => {
  const sheets = chartSheetsOf(properties)
  if (sheets.length === 0) return null
  const links = sheets
    .map(
      (sheet) =>
        `<a class="mt-1 block text-primary underline underline-offset-2" href="${escapeHtml(sheet.url)}" target="_blank" rel="noreferrer">${
          sheets.length > 1 ? `Sheet ${sheet.sheet} (PDF)` : 'Depth chart (PDF)'
        }</a>`,
    )
    .join('')
  return cardHtml({ ...describeDepthChart(properties), lines: [] }, links)
}
/** `step` reads "this colour until the depth reaches the next band's start". */
const DEPTH_COLOR = [
  'step',
  ['get', 'depthM'],
  DEPTH_BANDS[0].color,
  ...DEPTH_BANDS.slice(1).flatMap((band) => [band.fromM, band.color]),
]

function LakeDepthLayer({ onStatus }: { onStatus: (status: LayerStatus) => void }) {
  const { collection: charts, visible } = useLayerRead(
    true,
    WFS_SOURCES.depthCharts.minZoom ?? 0,
    readDepthCharts,
    onStatus,
  )
  // The digitized contours cover only a few lakes; the charts carry the count.
  const contours = useWholeData(loadDepthContours, ignoreStatus)

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
          clickHtml={depthChartClickHtml}
          pickPriority={CHART_PICK_PRIORITY}
          layerOrder={ORDER.depthCharts}
        />
      )}
      <MapFillLayer
        data={contours}
        fillColor={DEPTH_COLOR}
        fillOpacity={0.85}
        lineColor="#f0f9ff"
        lineWidth={0.7}
        lineOpacity={0.8}
        hoverHtml={depthContourHoverHtml}
        layerOrder={ORDER.depthContours}
      />
    </>
  )
}

function huntLine(hunt: LehHunt): string {
  const tags = hunt.authorizations != null ? `${hunt.authorizations} tag${hunt.authorizations === 1 ? '' : 's'}` : null
  return [hunt.animalClass, seasonText(hunt), tags, oddsText(hunt)].filter(Boolean).join(' · ')
}

/** The zones a management unit is split into for one species' draw. A new species reads again. */
function HuntZoneLayer({ species, onStatus }: { species: HuntZoneSpecies; onStatus: (status: LayerStatus) => void }) {
  const read = useMemo(() => {
    const filter = huntZoneFilter(species)
    return async (window: ViewWindow, signal: AbortSignal) =>
      parseHuntZones(await readWfs('huntZones', window.bounds, signal, filter))
  }, [species])
  const { collection, visible } = useLayerRead(true, WFS_SOURCES.huntZones.minZoom ?? 0, read, onStatus, {
    readKey: species,
  })

  // The draw report joins to a zone by its hunt area id. Without it the card still names the zone;
  // it just cannot list the hunts.
  const [draws, setDraws] = useState<{ drawYear: number | null; hunts: LehHunt[] } | null>(null)
  useEffect(() => {
    let live = true
    loadLehDraws()
      .then((result) => {
        if (live) setDraws(result)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const hoverHtml = useMemo(
    () => (properties: Record<string, unknown>) => {
      const zoneSpecies = typeof properties.species === 'string' ? properties.species : ''
      const label = typeof properties.label === 'string' ? properties.label : 'Zone'
      const huntAreaId = typeof properties.huntAreaId === 'string' ? properties.huntAreaId : ''
      const hunts = draws && huntAreaId ? huntsForHuntArea(draws.hunts, huntAreaId, zoneSpecies) : []
      const lines = !draws
        ? ['Loading the draw report…']
        : hunts.length > 0
          ? hunts.map(huntLine)
          : [`No ${zoneSpecies.toLowerCase()} hunt was drawn here in ${draws.drawYear ?? 'the last draw'}`]
      return cardHtml({
        title: `${zoneSpecies} zone: ${label}`,
        lines,
        caution: draws?.drawYear ? `${draws.drawYear} draw results, not the coming season.` : undefined,
      })
    },
    [draws],
  )

  if (!visible) return null
  return (
    <MapFillLayer
      data={collection}
      fillColor="#a21caf"
      fillOpacity={0.06}
      lineColor="#a21caf"
      lineWidth={2}
      lineOpacity={0.9}
      hoverHtml={hoverHtml}
      layerOrder={ORDER.huntZones}
    />
  )
}

/** The zoom each data layer starts at, for the sidebar's "zoom in" line. */
export const LAYER_MIN_ZOOM: Partial<Record<DataLayerKey, number>> = {
  forestRoads: FSR_MIN_ZOOM,
  cutblocks: CUTBLOCK_MIN_ZOOM,
  rail: RAILWAY_MIN_ZOOM,
  openness: WFS_SOURCES.stands.minZoom,
  huntZones: WFS_SOURCES.huntZones.minZoom,
  lakeDepth: WFS_SOURCES.depthCharts.minZoom,
}
export { ALL_ROADS_MIN_ZOOM }

/** The trip planner's optional layers. Render inside the planner's `Map`. */
export function OutdoorsBaseLayers({
  choices,
  recentDate,
  zoneSpecies,
  onStatus,
}: {
  choices: BaseLayerChoices
  /** The day shown by the recent-imagery layer, yyyy-mm-dd. */
  recentDate: string
  zoneSpecies: HuntZoneSpecies
  onStatus: (layer: DataLayerKey, status: LayerStatus) => void
}) {
  // One stable reporter per layer, so a layer's effects do not restart on every render.
  const report = useMemo(
    () => ({
      huntZones: (status: LayerStatus) => onStatus('huntZones', status),
      forestRoads: (status: LayerStatus) => onStatus('forestRoads', status),
      rail: (status: LayerStatus) => onStatus('rail', status),
      cutblocks: (status: LayerStatus) => onStatus('cutblocks', status),
      openness: (status: LayerStatus) => onStatus('openness', status),
      launches: (status: LayerStatus) => onStatus('launches', status),
      lakeDepth: (status: LayerStatus) => onStatus('lakeDepth', status),
    }),
    [onStatus],
  )
  const imagery = choices.satellite || choices.recent
  return (
    <>
      <SatelliteImagery visible={choices.satellite} />
      <RecentImageryLayers date={recentDate} visible={choices.recent} />
      <RegionalReliefLayer
        id={OUTDOORS_RELIEF_ID}
        visible={choices.relief}
        imagery={imagery}
        intensity={RELIEF_INTENSITY}
      />
      {choices.huntZones && <HuntZoneLayer species={zoneSpecies} onStatus={report.huntZones} />}
      {choices.lakeDepth && <LakeDepthLayer onStatus={report.lakeDepth} />}
      {choices.openness && <OpennessLayer onStatus={report.openness} />}
      {choices.cutblocks && <CutblockLayer onStatus={report.cutblocks} />}
      {choices.forestRoads && <ForestRoadLayer onStatus={report.forestRoads} />}
      {choices.rail && <RailwayLayer onStatus={report.rail} />}
      {choices.launches && <BoatLaunchLayer onStatus={report.launches} />}
    </>
  )
}
