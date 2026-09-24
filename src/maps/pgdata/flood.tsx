import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Waves } from 'lucide-react'
import { MapClusterLayer, MapPopup } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import {
  InlineAlert,
  KeyValueRows,
  LegendItem,
  MapGradientLegendItem,
  SelectedItemCard,
  SidebarSection,
  ToggleChip,
} from '@/components/ui/map-panels'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { MobileFeatureCard, ResponsiveFeatureDetail } from '@/components/ui/mobile-feature-card'
import { AppSelect } from '@/components/ui/select'
import { StatGroup } from '@/components/ui/stat-group'
import { ExternalLink } from '@/components/ui/text-button'
import { DEFAULT_LOCALE, formatNumber } from '@/lib/format'
import { BC_RFC_ARCGIS_ROOT, loadStudyAreaRegions, studyAreaRegionsToFeatureCollection } from '@/lib/studyArea'

type FloodPointMode = 'current' | 'clever' | 'coffee'
type FloodRiskFilter = 'all' | '2y' | '5y'

interface ArcGisFeature<T> {
  attributes?: T
  geometry?: {
    x?: number
    y?: number
  }
}

interface ArcGisResponse<T> {
  features?: Array<ArcGisFeature<T>>
  error?: {
    message?: string
  }
}

interface CurrentStationAttributes {
  Station_ID?: string
  Station_Name?: string
  LATITUDE?: number
  LONGITUDE?: number
  Current_Reading_?: string
  Return_Period?: string
  PCT_of_Mean_Ann_Disch_?: string
  WSC_Real_Time_Data?: string
  Updated_at?: number
}

interface ForecastStationAttributes {
  Station_ID?: string
  Basin?: string
  Station_Name?: string
  LATITUDE?: number
  LONGITUDE?: number
  Latest_Reading?: string
  Return_Period_OBS?: string
  Forecast_maximum_in_5_days?: string
  Return_Period_FOR?: string
  Forecast_average_in_5_days?: string
  ReturnPeriodAve?: string
  Forecast_minimum_in_5_days?: string
  ReturnPeriodMin?: string
  Hydrograph_url?: string
  Issued_at?: string
}

interface FloodStationProperties {
  id: string
  name: string
  mode: FloodPointMode
  basin: string
  reading: string
  observedReturnPeriod: string
  forecastReturnPeriod: string
  forecastMaximum: string
  hydrographUrl: string
  sourceUrl: string
  updatedAt: string
  riskScore: number
}

type FloodStationFeature = GeoJSON.Feature<GeoJSON.Point, FloodStationProperties>
type FloodStationCollection = GeoJSON.FeatureCollection<GeoJSON.Point, FloodStationProperties>
type FloodBasinCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>

const FLOOD_ENDPOINTS: Record<FloodPointMode, string> = {
  current: `${BC_RFC_ARCGIS_ROOT}/StationInformation/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=json&resultRecordCount=2000`,
  clever: `${BC_RFC_ARCGIS_ROOT}/CLM_MapHub_forecast/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=json&resultRecordCount=2000`,
  coffee: `${BC_RFC_ARCGIS_ROOT}/coffee_MapHub_forecast/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=json&resultRecordCount=2000`,
}

const FLOOD_MODE_OPTIONS: Array<{ value: FloodPointMode; label: string }> = [
  { value: 'current', label: 'Current return periods' },
  { value: 'clever', label: 'CLEVER forecast' },
  { value: 'coffee', label: 'COFFEE forecast' },
]

const FLOOD_RISK_OPTIONS: Array<{ value: FloodRiskFilter; label: string }> = [
  { value: 'all', label: 'All stations' },
  { value: '2y', label: '2-year or higher' },
  { value: '5y', label: '5-year or higher' },
]

function cleanText(value: unknown, fallback = 'Not reported'): string {
  if (typeof value !== 'string') return fallback
  return value.replace(/^=/, '').trim() || fallback
}

export function getReturnPeriodScore(value: string): number {
  const normalized = value.replace(/^=/, '').trim().toLowerCase()
  if (!normalized || normalized.includes('n/a') || normalized.includes('no data') || normalized.includes('no rtp')) return -1
  if (normalized.includes('<1')) return 0
  const rangeMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*y?/)
  if (rangeMatch) return Number(rangeMatch[1])
  const singleMatch = normalized.match(/(\d+(?:\.\d+)?)\s*y/)
  return singleMatch ? Number(singleMatch[1]) : 0
}

function formatArcGisDate(value: number | undefined): string {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleString(DEFAULT_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

async function fetchArcGis<T>(url: string, signal: AbortSignal): Promise<ArcGisResponse<T>> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`BC RFC request failed: ${response.status}`)
  const json = await response.json() as ArcGisResponse<T>
  if (json.error?.message) throw new Error(json.error.message)
  return json
}

function stationGeometry<T extends { LATITUDE?: number; LONGITUDE?: number }>(feature: ArcGisFeature<T>): [number, number] | null {
  const attrLon = feature.attributes?.LONGITUDE
  const attrLat = feature.attributes?.LATITUDE
  if (
    typeof attrLon === 'number' &&
    typeof attrLat === 'number' &&
    Number.isFinite(attrLon) &&
    Number.isFinite(attrLat) &&
    Math.abs(attrLon) <= 180 &&
    Math.abs(attrLat) <= 90
  ) {
    return [attrLon, attrLat]
  }

  const lon = feature.geometry?.x
  const lat = feature.geometry?.y
  if (typeof lon !== 'number' || typeof lat !== 'number') return null
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null
  return [lon, lat]
}

function normalizeCurrentStation(feature: ArcGisFeature<CurrentStationAttributes>): FloodStationFeature | null {
  const coordinates = stationGeometry(feature)
  const attributes = feature.attributes
  if (!coordinates || !attributes?.Station_ID) return null
  const observedReturnPeriod = cleanText(attributes.Return_Period, 'N/A')
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: {
      id: attributes.Station_ID,
      name: cleanText(attributes.Station_Name, attributes.Station_ID),
      mode: 'current',
      basin: 'Current WSC station',
      reading: cleanText(attributes.Current_Reading_),
      observedReturnPeriod,
      forecastReturnPeriod: observedReturnPeriod,
      forecastMaximum: cleanText(attributes.PCT_of_Mean_Ann_Disch_),
      hydrographUrl: '',
      sourceUrl: attributes.WSC_Real_Time_Data ?? '',
      updatedAt: formatArcGisDate(attributes.Updated_at),
      riskScore: getReturnPeriodScore(observedReturnPeriod),
    },
  }
}

function normalizeForecastStation(mode: 'clever' | 'coffee', feature: ArcGisFeature<ForecastStationAttributes>): FloodStationFeature | null {
  const coordinates = stationGeometry(feature)
  const attributes = feature.attributes
  if (!coordinates || !attributes?.Station_ID) return null
  const forecastReturnPeriod = cleanText(attributes.Return_Period_FOR, 'N/A')
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: {
      id: `${mode}-${attributes.Station_ID}`,
      name: cleanText(attributes.Station_Name, attributes.Station_ID),
      mode,
      basin: cleanText(attributes.Basin, 'Unassigned basin'),
      reading: cleanText(attributes.Latest_Reading),
      observedReturnPeriod: cleanText(attributes.Return_Period_OBS, 'N/A'),
      forecastReturnPeriod,
      forecastMaximum: cleanText(attributes.Forecast_maximum_in_5_days),
      hydrographUrl: attributes.Hydrograph_url ?? '',
      sourceUrl: '',
      updatedAt: cleanText(attributes.Issued_at, 'Unknown'),
      riskScore: getReturnPeriodScore(forecastReturnPeriod),
    },
  }
}

function filterByRisk(feature: FloodStationFeature, riskFilter: FloodRiskFilter): boolean {
  if (riskFilter === 'all') return true
  if (riskFilter === '2y') return feature.properties.riskScore >= 2
  return feature.properties.riskScore >= 5
}

const FLOOD_POINT_BUCKETS = [
  { id: 'normal', label: '< 2 year / normal', color: '#38bdf8', test: (score: number) => score >= 0 && score < 2 },
  { id: 'twoyear', label: '2-5 year', color: '#facc15', test: (score: number) => score >= 2 && score < 5 },
  { id: 'fiveyear', label: '5-10 year', color: '#f97316', test: (score: number) => score >= 5 && score < 10 },
  { id: 'tenyear', label: '>= 10 year', color: '#dc2626', test: (score: number) => score >= 10 },
  { id: 'nodata', label: 'No data', color: '#94a3b8', test: (score: number) => score < 0 },
]

export function useFloodData(active: boolean) {
  const [mode, setMode] = useState<FloodPointMode>('current')
  const [riskFilter, setRiskFilter] = useState<FloodRiskFilter>('all')
  const [showBasins, setShowBasins] = useState(true)
  const [showStations, setShowStations] = useState(true)
  const [stations, setStations] = useState<FloodStationFeature[]>([])
  const [basins, setBasins] = useState<FloodBasinCollection>({ type: 'FeatureCollection', features: [] })
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()

    async function load() {
      try {
        setLoading(true)
        setError(null)
        const [stationResponse, basinResponse] = await Promise.all([
          mode === 'current'
            ? fetchArcGis<CurrentStationAttributes>(FLOOD_ENDPOINTS.current, controller.signal)
            : fetchArcGis<ForecastStationAttributes>(FLOOD_ENDPOINTS[mode], controller.signal),
          loadStudyAreaRegions('bcRfc', 'rfcSnowBasin', controller.signal),
        ])
        const nextStations = (stationResponse.features ?? [])
          .map((feature) => mode === 'current'
            ? normalizeCurrentStation(feature as ArcGisFeature<CurrentStationAttributes>)
            : normalizeForecastStation(mode, feature as ArcGisFeature<ForecastStationAttributes>))
          .filter((feature): feature is FloodStationFeature => Boolean(feature))

        const nextBasins = studyAreaRegionsToFeatureCollection(basinResponse) as FloodBasinCollection
        setStations(nextStations)
        setBasins(nextBasins)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError((err as Error).message || 'Unable to load BC RFC flood data')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [active, mode])

  const filteredStations = useMemo(() => stations.filter((feature) => filterByRisk(feature, riskFilter)), [stations, riskFilter])

  const stationCollection = useMemo<FloodStationCollection>(() => ({
    type: 'FeatureCollection',
    features: filteredStations,
  }), [filteredStations])

  const selectedStation = useMemo(() => (
    stations.find((feature) => feature.properties.id === selectedStationId) ?? null
  ), [stations, selectedStationId])

  const highRiskCount = useMemo(() => stations.filter((feature) => feature.properties.riskScore >= 2).length, [stations])
  const severeRiskCount = useMemo(() => stations.filter((feature) => feature.properties.riskScore >= 5).length, [stations])
  const basinNames = useMemo(() => basins.features
    .map((feature) => String(feature.properties?.basinName ?? feature.properties?.BASIN ?? feature.properties?.basin ?? ''))
    .filter(Boolean)
    .sort(), [basins])

  return {
    mode,
    setMode,
    riskFilter,
    setRiskFilter,
    showBasins,
    setShowBasins,
    showStations,
    setShowStations,
    stations,
    filteredStations,
    stationCollection,
    basins,
    selectedStation,
    selectedStationId,
    setSelectedStationId,
    loading,
    error,
    highRiskCount,
    severeRiskCount,
    basinNames,
  }
}

export type FloodState = ReturnType<typeof useFloodData>

export function FloodLayerControls({ flood }: { flood: FloodState }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ToggleChip active={flood.showStations} onClick={() => flood.setShowStations((current) => !current)}>
        {flood.showStations ? 'Hide stations' : 'Show stations'}
      </ToggleChip>
      <ToggleChip active={flood.showBasins} onClick={() => flood.setShowBasins((current) => !current)} tone="cyan">
        {flood.showBasins ? 'Hide basins' : 'Show basins'}
      </ToggleChip>
    </div>
  )
}

export function FloodSidebar({ flood }: { flood: FloodState }) {
  const selected = flood.selectedStation?.properties
  return (
    <SidebarSection title="Flood" icon={Waves} iconClassName="text-sky-600">
      <div className="space-y-4">
        <label className="block text-xs font-medium text-foreground">
          RFC layer
          <AppSelect
            value={flood.mode}
            onValueChange={(value) => flood.setMode(value as FloodPointMode)}
            options={FLOOD_MODE_OPTIONS}
            className="mt-1"
            triggerClassName="h-8 rounded-md text-xs"
          />
        </label>
        <label className="block text-xs font-medium text-foreground">
          Return-period filter
          <AppSelect
            value={flood.riskFilter}
            onValueChange={(value) => flood.setRiskFilter(value as FloodRiskFilter)}
            options={FLOOD_RISK_OPTIONS}
            className="mt-1"
            triggerClassName="h-8 rounded-md text-xs"
          />
        </label>
        <StatGroup
          variant="tiles"
          size="sm"
          columns={2}
          items={[
            { label: 'stations', value: formatNumber(flood.stations.length) },
            { label: 'visible', value: formatNumber(flood.filteredStations.length) },
            { label: '2-year or higher', value: formatNumber(flood.highRiskCount) },
            { label: '5-year or higher', value: formatNumber(flood.severeRiskCount) },
          ]}
        />
        {flood.loading && <InlineAlert loading>Loading BC RFC data...</InlineAlert>}
        {flood.error && <InlineAlert tone="warning">{flood.error}</InlineAlert>}
        {selected && (
          <SelectedItemCard
            title={selected.name}
            subtitle={selected.basin}
            rows={[
              { label: 'Observed', value: selected.observedReturnPeriod },
              { label: 'Forecast', value: selected.forecastReturnPeriod },
              { label: 'Reading', value: selected.reading },
              { label: 'Max forecast', value: selected.forecastMaximum },
              { label: 'Updated', value: selected.updatedAt },
            ]}
          />
        )}
        <InlineAlert>
          Historical warning bulletins can be mapped by matching named rivers and regions to existing BCFWA and drought basin boundaries. This first layer uses live RFC stations, forecasts, and RFC snow-basin polygons.
        </InlineAlert>
      </div>
    </SidebarSection>
  )
}

function floodStationSourceUrl(station: FloodStationProperties): string {
  return station.hydrographUrl || station.sourceUrl
}

function FloodPopup({ station, onClose }: { station: FloodStationFeature; onClose: () => void }) {
  const props = station.properties
  const sourceUrl = floodStationSourceUrl(props)
  return (
    <MapPopup
      longitude={station.geometry.coordinates[0]}
      latitude={station.geometry.coordinates[1]}
      onClose={onClose}
      className="max-w-xs"
    >
      <MapPopupCard
        title={props.name}
        subtitle={props.id.replace(/^(clever|coffee)-/, '')}
        onClose={onClose}
        actions={sourceUrl ? <ExternalLink href={sourceUrl} /> : undefined}
      >
        <KeyValueRows
          rows={[
            { label: 'Observed', value: props.observedReturnPeriod },
            { label: 'Forecast', value: props.forecastReturnPeriod },
            { label: 'Reading', value: props.reading },
          ]}
        />
      </MapPopupCard>
    </MapPopup>
  )
}

function MobileFloodFeatureCard({ station, onClose }: { station: FloodStationFeature; onClose: () => void }) {
  const props = station.properties
  const sourceUrl = floodStationSourceUrl(props)
  return (
    <MobileFeatureCard cardKey={props.id} title={props.name} subtitle={props.basin} onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-md border border-border bg-background p-3">
          <KeyValueRows
            rows={[
              { label: 'Observed', value: props.observedReturnPeriod },
              { label: 'Forecast', value: props.forecastReturnPeriod },
              { label: 'Reading', value: props.reading },
              { label: 'Max forecast', value: props.forecastMaximum },
              { label: 'Updated', value: props.updatedAt },
            ]}
          />
        </div>
        {sourceUrl && <ExternalLink href={sourceUrl} variant="button" />}
      </div>
    </MobileFeatureCard>
  )
}

export function FloodLayer({ flood }: { flood: FloodState }) {
  const basinFillColor = useMemo(() => ([
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'basinID'], 0],
    1,
    '#38bdf8',
    8,
    '#22c55e',
    15,
    '#f59e0b',
    22,
    '#a78bfa',
    26,
    '#64748b',
  ]), [])

  const pointCollections = useMemo(() => (
    FLOOD_POINT_BUCKETS
      .map((bucket) => [
        bucket,
        {
          type: 'FeatureCollection' as const,
          features: flood.stationCollection.features.filter((feature) => bucket.test(feature.properties.riskScore)),
        },
      ] as const)
      .filter(([, collection]) => collection.features.length > 0)
  ), [flood.stationCollection])

  return (
    <>
      {flood.showBasins && flood.basins.features.length > 0 && (
        <MapFillLayer
          data={flood.basins}
          fillColor={basinFillColor}
          fillOpacity={0.14}
          lineColor={basinFillColor}
          lineOpacity={0.6}
          lineWidth={0.8}
          idProperty="OBJECTID_12"
          visible
        />
      )}
      {flood.showStations && pointCollections.map(([bucket, collection]) => (
        <MapClusterLayer<FloodStationProperties>
          key={bucket.id}
          data={collection}
          pointColor={bucket.color}
          clusterColors={[`${bucket.color}99`, `${bucket.color}cc`, bucket.color]}
          clusterThresholds={[20, 80]}
          onPointClick={(feature) => flood.setSelectedStationId(
            flood.selectedStationId === feature.properties.id ? null : feature.properties.id,
          )}
        />
      ))}
      {flood.selectedStation && (
        <ResponsiveFeatureDetail
          popup={<FloodPopup station={flood.selectedStation} onClose={() => flood.setSelectedStationId(null)} />}
          card={<MobileFloodFeatureCard station={flood.selectedStation} onClose={() => flood.setSelectedStationId(null)} />}
        />
      )}
    </>
  )
}

export function FloodLegend({ flood }: { flood: FloodState }) {
  return (
    <div className="w-full space-y-2 text-xs text-muted-foreground md:w-56">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        RFC flood context
      </div>
      {FLOOD_POINT_BUCKETS.slice(0, 4).map((bucket) => (
        <LegendItem
          key={bucket.id}
          color={bucket.color}
          label={bucket.label}
          active={flood.showStations}
          onClick={() => {
            if (!flood.showStations) flood.setShowStations(true)
            else if (bucket.id === 'normal') flood.setRiskFilter('all')
            else if (bucket.id === 'twoyear') flood.setRiskFilter('2y')
            else if (bucket.id === 'fiveyear') flood.setRiskFilter('5y')
          }}
        />
      ))}
      <LegendItem color="#60a5fa" label="RFC snow-basin polygons" active={flood.showBasins} swatchShape="square" onClick={() => flood.setShowBasins((current) => !current)} />
      {flood.showBasins && (
        <div className="px-1">
          <MapGradientLegendItem colors={['#38bdf8', '#22c55e', '#f59e0b', '#a78bfa']} minLabel="RFC" maxLabel="basins" />
        </div>
      )}
    </div>
  )
}

export function FloodSourceNotes({ flood }: { flood: FloodState }) {
  const latest = flood.stations
    .map((feature) => feature.properties.updatedAt)
    .filter((value) => value && value !== 'Unknown')[0]
  return (
    <>
      <p>BC River Forecast Centre live ArcGIS layers{latest ? ` updated ${latest}` : ''}.</p>
      <p>Advisory history is available from BC RFC bulletins, but polygons are inferred from watershed or basin names rather than supplied as historical shapes.</p>
      <p>Loaded {formatNumber(flood.stations.length)} station records and {formatNumber(flood.basins.features.length)} RFC snow-basin polygons.</p>
    </>
  )
}
