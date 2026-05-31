import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Waves } from 'lucide-react'
import { MapClusterLayer, MapPopup } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { InlineAlert, LegendItem, MapGradientLegendItem, StatGrid, ToggleChip } from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'

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

const RFC_ARCGIS_ROOT = 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services'

const FLOOD_ENDPOINTS: Record<FloodPointMode, string> = {
  current: `${RFC_ARCGIS_ROOT}/StationInformation/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=json&resultRecordCount=2000`,
  clever: `${RFC_ARCGIS_ROOT}/CLM_MapHub_forecast/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=json&resultRecordCount=2000`,
  coffee: `${RFC_ARCGIS_ROOT}/coffee_MapHub_forecast/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=json&resultRecordCount=2000`,
}

const FLOOD_BASINS_URL = `${RFC_ARCGIS_ROOT}/BC_Basins_GoogleMapPL/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson&resultRecordCount=1000`

const FLOOD_MODE_OPTIONS: Array<{ value: FloodPointMode; label: string }> = [
  { value: 'current', label: 'Current return periods' },
  { value: 'clever', label: 'CLEVER forecast' },
  { value: 'coffee', label: 'COFFEE forecast' },
]

const FLOOD_RISK_OPTIONS: Array<{ value: FloodRiskFilter; label: string }> = [
  { value: 'all', label: 'All stations' },
  { value: '2y', label: '>= 2 year' },
  { value: '5y', label: '>= 5 year' },
]

function cleanText(value: unknown, fallback = 'Not reported'): string {
  if (typeof value !== 'string') return fallback
  return value.replace(/^=/, '').trim() || fallback
}

function getReturnPeriodScore(value: string): number {
  const normalized = value.toLowerCase()
  if (normalized.includes('n/a') || normalized.includes('no data')) return -1
  if (normalized.includes('<1')) return 0
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*y/)
  return match ? Number(match[1]) : 0
}

function formatArcGisDate(value: number | undefined): string {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

async function fetchArcGis<T>(url: string, signal: AbortSignal): Promise<ArcGisResponse<T>> {
  const response = await fetch(url, { signal, cache: 'no-store' })
  if (!response.ok) throw new Error(`BC RFC request failed: ${response.status}`)
  const json = await response.json() as ArcGisResponse<T>
  if (json.error?.message) throw new Error(json.error.message)
  return json
}

function stationGeometry<T extends { LATITUDE?: number; LONGITUDE?: number }>(feature: ArcGisFeature<T>): [number, number] | null {
  const lon = feature.geometry?.x ?? feature.attributes?.LONGITUDE
  const lat = feature.geometry?.y ?? feature.attributes?.LATITUDE
  if (typeof lon !== 'number' || typeof lat !== 'number') return null
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
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
  { id: 'twoyear', label: '>= 2 year', color: '#facc15', test: (score: number) => score >= 2 && score < 5 },
  { id: 'fiveyear', label: '>= 5 year', color: '#f97316', test: (score: number) => score >= 5 && score < 10 },
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
          fetch(FLOOD_BASINS_URL, { signal: controller.signal, cache: 'no-store' }),
        ])
        const nextStations = (stationResponse.features ?? [])
          .map((feature) => mode === 'current'
            ? normalizeCurrentStation(feature as ArcGisFeature<CurrentStationAttributes>)
            : normalizeForecastStation(mode, feature as ArcGisFeature<ForecastStationAttributes>))
          .filter((feature): feature is FloodStationFeature => Boolean(feature))

        const nextBasins = await basinResponse.json() as FloodBasinCollection
        setStations(nextStations)
        setBasins(nextBasins.type === 'FeatureCollection' ? nextBasins : { type: 'FeatureCollection', features: [] })
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
    .map((feature) => String(feature.properties?.BASIN ?? feature.properties?.basin ?? ''))
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
  return (
    <div className="space-y-4 border-b border-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Waves className="h-4 w-4 text-sky-600" />
        <h2 className="text-sm font-semibold text-foreground">Flood</h2>
      </div>
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
      <StatGrid
        columns={2}
        stats={[
          { label: 'stations', value: flood.stations.length.toLocaleString() },
          { label: 'visible', value: flood.filteredStations.length.toLocaleString() },
          { label: '>= 2 year', value: flood.highRiskCount.toLocaleString() },
          { label: '>= 5 year', value: flood.severeRiskCount.toLocaleString() },
        ]}
      />
      {flood.loading && <div className="text-xs text-muted-foreground">Loading BC RFC data...</div>}
      {flood.error && <InlineAlert tone="warning">{flood.error}</InlineAlert>}
      {flood.selectedStation && (
        <div className="rounded-md border border-border bg-background p-3 text-xs">
          <div className="font-semibold text-foreground">{flood.selectedStation.properties.name}</div>
          <div className="mt-1 text-muted-foreground">{flood.selectedStation.properties.basin}</div>
          <div className="mt-3 space-y-1">
            <FloodDetailRow label="Observed" value={flood.selectedStation.properties.observedReturnPeriod} />
            <FloodDetailRow label="Forecast" value={flood.selectedStation.properties.forecastReturnPeriod} />
            <FloodDetailRow label="Reading" value={flood.selectedStation.properties.reading} />
            <FloodDetailRow label="Max forecast" value={flood.selectedStation.properties.forecastMaximum} />
            <FloodDetailRow label="Updated" value={flood.selectedStation.properties.updatedAt} />
          </div>
        </div>
      )}
      <div className="rounded-md border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
        Historical warning bulletins can be mapped by matching named rivers and regions to existing BCFWA and drought basin boundaries. This first layer uses live RFC stations, forecasts, and RFC basin polygons.
      </div>
    </div>
  )
}

function FloodDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  )
}

export function FloodLayer({ flood }: { flood: FloodState }) {
  const basinFillColor = useMemo(() => ([
    'match',
    ['get', 'BASIN'],
    'FRASER',
    '#60a5fa',
    'SKEENA',
    '#22c55e',
    'THOMPSON',
    '#f59e0b',
    'PEACE',
    '#a78bfa',
    '#94a3b8',
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
          fillOpacity={0.12}
          lineColor="#0f172a"
          lineWidth={0.8}
          lineOpacity={0.4}
          idProperty="BASIN"
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
        <MapPopup
          longitude={flood.selectedStation.geometry.coordinates[0]}
          latitude={flood.selectedStation.geometry.coordinates[1]}
          closeButton
          onClose={() => flood.setSelectedStationId(null)}
          className="max-w-xs"
        >
          <div className="space-y-2 text-xs">
            <div>
              <div className="font-semibold text-foreground">{flood.selectedStation.properties.name}</div>
              <div className="text-muted-foreground">{flood.selectedStation.properties.id.replace(/^(clever|coffee)-/, '')}</div>
            </div>
            <FloodDetailRow label="Observed" value={flood.selectedStation.properties.observedReturnPeriod} />
            <FloodDetailRow label="Forecast" value={flood.selectedStation.properties.forecastReturnPeriod} />
            <FloodDetailRow label="Reading" value={flood.selectedStation.properties.reading} />
            {(flood.selectedStation.properties.hydrographUrl || flood.selectedStation.properties.sourceUrl) && (
              <a
                href={flood.selectedStation.properties.hydrographUrl || flood.selectedStation.properties.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sky-700 underline-offset-2 hover:underline"
              >
                Open source
              </a>
            )}
          </div>
        </MapPopup>
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
      <LegendItem color="#60a5fa" label="RFC basin overlay" active={flood.showBasins} swatchShape="square" onClick={() => flood.setShowBasins((current) => !current)} />
      {flood.showBasins && (
        <div className="px-1">
          <MapGradientLegendItem colors={['#60a5fa', '#22c55e', '#f59e0b', '#a78bfa']} minLabel="RFC" maxLabel="basins" />
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
      <p>Loaded {flood.stations.length.toLocaleString()} station records and {flood.basins.features.length.toLocaleString()} RFC basin polygons.</p>
    </>
  )
}
