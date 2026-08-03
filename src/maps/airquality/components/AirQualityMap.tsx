import { useEffect, useMemo } from 'react'
import {
  MapClusterLayer,
  MapMarker,
  MapPopup,
  MarkerContent,
  useMap
} from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MobileFeatureCard, ResponsiveFeatureDetail } from '@/components/ui/mobile-feature-card'
import { SharedMap } from '@/components/ui/persistent-map'
import bbox from '@turf/bbox'
import { MAP_STYLES } from '@/components/ui/map-styles'
import { getNetworkColor } from '../constants'
import { calculateCorrectedPm25, formatMeasurement, formatPm25 } from '../lib/corrections'
import { AirQualityHeatmapLayer } from './AirQualityHeatmapLayer'
import type {
  AirMonitor,
  AirQualityBasemap,
  AirQualityBoundaryColorMetric,
  AirQualityCorrectionModel
} from '../types'
import { hexToRgba } from '@/lib/color'

/** Stable empty collection so MapFillLayer does not resubmit a new object each render. */
const EMPTY_BOUNDARY_COLLECTION: GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { code: string; name: string; colorValue?: number | null; hasColorValue?: boolean }
> = { type: 'FeatureCollection', features: [] }

interface AirQualityMapProps {
  monitors: AirMonitor[]
  selectedMonitor: AirMonitor | null
  selectedRegionFeature?: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  browseBoundaryFeatures?: GeoJSON.FeatureCollection<
    GeoJSON.Polygon | GeoJSON.MultiPolygon,
    { code: string; name: string; colorValue?: number | null; hasColorValue?: boolean }
  > | null
  browseBoundariesVisible?: boolean
  selectedBrowseBoundaryCode?: string | null
  browseBoundaryColorMetric: AirQualityBoundaryColorMetric
  maxBrowseBoundaryColorValue?: number
  showHeatmap: boolean
  showPoints: boolean
  basemap: AirQualityBasemap
  correctionModel: AirQualityCorrectionModel
  loading?: boolean
  onBoundsChange?: (bounds: AirQualityMapBounds) => void
  onMonitorClick: (monitor: AirMonitor) => void
  onBrowseBoundaryClick?: (feature: { code: string; name: string }) => void
  onMonitorClear?: () => void
}

export interface AirQualityMapBounds {
  west: number
  east: number
  south: number
  north: number
}

type MonitorFeatureProperties = {
  id: string
  network: string
  name: string
  city: string
  province: string
}

function uniqueParameters(parameters: string[]): string[] {
  return Array.from(new Set(parameters.map((parameter) => parameter.trim()).filter(Boolean)))
}

function monitorLocationKey(monitor: AirMonitor): string {
  return `${monitor.longitude.toFixed(6)}:${monitor.latitude.toFixed(6)}`
}

function monitorEntryKey(monitor: AirMonitor): string {
  return `${monitor.network}:${monitor.id}:${monitor.longitude.toFixed(6)}:${monitor.latitude.toFixed(6)}`
}

function isSameLocation(a: AirMonitor, b: AirMonitor): boolean {
  return monitorLocationKey(a) === monitorLocationKey(b)
}

const AIR_QUALITY_MAP_STYLES: Record<AirQualityBasemap, { light: string; dark: string }> = {
  light: MAP_STYLES,
  topographic: {
    light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    dark: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
  },
  dark: {
    light: MAP_STYLES.dark,
    dark: MAP_STYLES.dark
  }
}

function SelectedMonitorDetails({
  monitor,
  correctionModel,
  showHeading = true,
}: {
  monitor: AirMonitor
  correctionModel: AirQualityCorrectionModel
  showHeading?: boolean
}) {
  const parameters = uniqueParameters(monitor.parameters)
  const correction = calculateCorrectedPm25(monitor, correctionModel)

  return (
    <div>
      {showHeading && (
        <>
          <div className="pr-5 text-sm font-semibold text-foreground">{monitor.name}</div>
          <div className="text-xs text-muted-foreground">
            {[monitor.city, monitor.province].filter(Boolean).join(', ') || 'Location available'}
          </div>
        </>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: getNetworkColor(monitor.network) }}
        />
        <span className="font-medium text-foreground">{monitor.network}</span>
        {monitor.status && (
          <span className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold uppercase text-secondary-foreground">
            {monitor.status}
          </span>
        )}
      </div>
      {parameters.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parameters.map((parameter) => (
            <span
              key={`${monitorEntryKey(monitor)}:${parameter}`}
              className="rounded border bg-secondary/40 px-1.5 py-0.5 text-xs font-medium text-secondary-foreground"
            >
              {parameter}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 rounded-md border border-border bg-background/80 p-2 text-xs">
        <div className="mb-1 font-semibold text-foreground">{correction.label}</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <span className="text-muted-foreground">Raw PM2.5</span>
          <span className="text-right font-medium text-foreground">{formatPm25(correction.rawPm25)}</span>
          <span className="text-muted-foreground">Corrected</span>
          <span className="text-right font-medium text-foreground">{formatPm25(correction.correctedPm25)}</span>
          <span className="text-muted-foreground">RH</span>
          <span className="text-right font-medium text-foreground">{formatMeasurement(correction.humidity, '%')}</span>
          <span className="text-muted-foreground">Uncertainty</span>
          <span className="text-right font-medium text-foreground">
            {correction.uncertainty === null ? 'No data' : `+/- ${correction.uncertainty.toFixed(1)} ug/m3`}
          </span>
        </div>
      </div>
    </div>
  )
}

function BoundaryBrowseLayer({
  features,
  visible,
  selectedCode,
  colorMetric,
  maxColorValue,
  onBoundaryClick
}: {
  features: GeoJSON.FeatureCollection<
    GeoJSON.Polygon | GeoJSON.MultiPolygon,
    { code: string; name: string; colorValue?: number | null; hasColorValue?: boolean }
  > | null | undefined
  visible: boolean
  selectedCode: string | null | undefined
  colorMetric: AirQualityBoundaryColorMetric
  maxColorValue: number
  onBoundaryClick?: (feature: { code: string; name: string }) => void
}) {
  const collection = features ?? EMPTY_BOUNDARY_COLLECTION
  const hasFeatures = collection.features.length > 0

  const maxStop = maxColorValue > 0 ? maxColorValue : 1
  const colorStops = colorMetric === 'correctedPm25' || colorMetric === 'rawPm25'
    ? ['#dcfce7', '#fde047', '#fb923c', '#b91c1c']
    : ['#e0f2fe', '#7dd3fc', '#0ea5e9', '#0369a1']

  return (
    <MapFillLayer
      data={collection}
      idProperty="code"
      visible={visible && hasFeatures}
      fillColor={[
        'interpolate',
        ['linear'],
        ['to-number', ['get', 'colorValue'], 0],
        0, colorStops[0],
        maxStop * 0.25, colorStops[1],
        maxStop * 0.6, colorStops[2],
        maxStop, colorStops[3],
      ]}
      fillOpacity={['case', ['==', ['get', 'hasColorValue'], true], 0.26, 0.1]}
      lineColor="#0284c7"
      lineWidth={1.1}
      lineOpacity={0.9}
      selectedId={selectedCode ?? null}
      selectionColor="#ea580c"
      selectionWidth={2.2}
      onFeatureClick={(code, _event, properties) => {
        onBoundaryClick?.({ code, name: String(properties.name ?? code) })
      }}
    />
  )
}

export function AirQualityMap({
  monitors,
  selectedMonitor,
  selectedRegionFeature,
  browseBoundaryFeatures,
  browseBoundariesVisible = false,
  selectedBrowseBoundaryCode,
  browseBoundaryColorMetric,
  maxBrowseBoundaryColorValue = 0,
  showHeatmap,
  showPoints,
  basemap,
  correctionModel,
  loading = false,
  onBoundsChange,
  onMonitorClick,
  onBrowseBoundaryClick,
  onMonitorClear
}: AirQualityMapProps) {
  const { map } = useMap()

  const monitorById = useMemo(() => {
    const map = new globalThis.Map<string, AirMonitor>()
    monitors.forEach((monitor) => map.set(monitor.id, monitor))
    return map
  }, [monitors])

  const collectionsByNetwork = useMemo(() => {
    const grouped = new globalThis.Map<string, GeoJSON.FeatureCollection<GeoJSON.Point, MonitorFeatureProperties>>()

    monitors.forEach((monitor) => {
      const network = monitor.network || 'Unknown'
      if (!grouped.has(network)) {
        grouped.set(network, {
          type: 'FeatureCollection',
          features: []
        })
      }

      grouped.get(network)?.features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [monitor.longitude, monitor.latitude]
        },
        properties: {
          id: monitor.id,
          network,
          name: monitor.name,
          city: monitor.city || '',
          province: monitor.province || ''
        }
      })
    })

    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [monitors])

  const selectedMonitorsAtLocation = useMemo(() => {
    if (!selectedMonitor) return []

    const matches = monitors.filter((monitor) => isSameLocation(monitor, selectedMonitor))
    const uniqueByEntry = new Map<string, AirMonitor>()
    matches.forEach((monitor) => uniqueByEntry.set(monitorEntryKey(monitor), monitor))

    const uniqueMatches = Array.from(uniqueByEntry.values()).sort((a, b) => {
      return a.name.localeCompare(b.name) || a.network.localeCompare(b.network)
    })

    const selectedKey = monitorEntryKey(selectedMonitor)
    const selectedMatch = uniqueMatches.find((monitor) => monitorEntryKey(monitor) === selectedKey)
    if (!selectedMatch) return uniqueMatches

    return [
      selectedMatch,
      ...uniqueMatches.filter((monitor) => monitorEntryKey(monitor) !== selectedKey)
    ]
  }, [monitors, selectedMonitor])

  const mapStyles = useMemo(() => AIR_QUALITY_MAP_STYLES[basemap], [basemap])

  useEffect(() => {
    if (!selectedMonitor || !map) return
    map.flyTo({
      center: [selectedMonitor.longitude, selectedMonitor.latitude],
      duration: 800
    })
  }, [selectedMonitor, map])

  useEffect(() => {
    if (!selectedRegionFeature || !map) return
    const [minLon, minLat, maxLon, maxLat] = bbox(selectedRegionFeature)
    map.flyTo({
      center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
      zoom: map.getZoom(),
      duration: 800
    })
  }, [selectedRegionFeature, map])

  useEffect(() => {
    if (!onBoundsChange || !map) return

    const publishBounds = () => {
      const bounds = map.getBounds()
      onBoundsChange({
        west: bounds.getWest(),
        east: bounds.getEast(),
        south: bounds.getSouth(),
        north: bounds.getNorth()
      })
    }

    map.on('load', publishBounds)
    map.on('moveend', publishBounds)
    map.on('zoomend', publishBounds)
    map.on('resize', publishBounds)

    if (map.loaded()) {
      publishBounds()
    }

    return () => {
      map.off('load', publishBounds)
      map.off('moveend', publishBounds)
      map.off('zoomend', publishBounds)
      map.off('resize', publishBounds)
    }
  }, [map, onBoundsChange])

  return (
    <SharedMap styles={mapStyles} loading={loading} loadingLabel="Loading air quality data">
      <BoundaryBrowseLayer
          features={browseBoundaryFeatures}
          visible={browseBoundariesVisible}
          selectedCode={selectedBrowseBoundaryCode}
          colorMetric={browseBoundaryColorMetric}
          maxColorValue={maxBrowseBoundaryColorValue}
          onBoundaryClick={onBrowseBoundaryClick}
        />
        <AirQualityHeatmapLayer monitors={monitors} visible={showHeatmap} />

        {showPoints && collectionsByNetwork.map(([network, collection]) => {
          const color = getNetworkColor(network)
          const clusterColors: [string, string, string] = [
            hexToRgba(color, 0.65),
            hexToRgba(color, 0.8),
            color
          ]

          return (
            <MapClusterLayer<MonitorFeatureProperties>
              key={network}
              data={collection}
              pointColor={color}
              clusterColors={clusterColors}
              clusterThresholds={[40, 150]}
              onPointClick={(feature) => {
                const id = feature.properties?.id
                if (!id) return
                const selected = monitorById.get(id)
                if (selected) onMonitorClick(selected)
              }}
            />
          )
        })}

        {selectedMonitor && (
          <>
            <MapMarker
              longitude={selectedMonitor.longitude}
              latitude={selectedMonitor.latitude}
              onClick={onMonitorClear}
            >
              <MarkerContent>
                <div
                  className="h-5 w-5 rounded-full border-2 border-white shadow-lg ring-2 ring-sky-500 ring-offset-2"
                  style={{ backgroundColor: getNetworkColor(selectedMonitor.network) }}
                />
              </MarkerContent>
            </MapMarker>

          </>
        )}
        {selectedMonitor && (
          <ResponsiveFeatureDetail
            popup={(
              <MapPopup
                key={monitorEntryKey(selectedMonitor)}
                longitude={selectedMonitor.longitude}
                latitude={selectedMonitor.latitude}
                closeButton
                onClose={onMonitorClear}
                className={selectedMonitorsAtLocation.length > 1 ? 'max-w-sm' : 'max-w-xs'}
              >
                <SelectedMonitorStack
                  monitors={selectedMonitorsAtLocation}
                  correctionModel={correctionModel}
                  showLocationCount
                />
              </MapPopup>
            )}
            card={(
              <MobileAirQualityFeatureCard
                monitor={selectedMonitor}
                monitorsAtLocation={selectedMonitorsAtLocation}
                correctionModel={correctionModel}
                onClose={() => onMonitorClear?.()}
              />
            )}
          />
        )}
    </SharedMap>
  )
}

function SelectedMonitorStack({
  monitors,
  correctionModel,
  showLocationCount,
  showFirstHeading = true,
}: {
  monitors: AirMonitor[]
  correctionModel: AirQualityCorrectionModel
  showLocationCount?: boolean
  showFirstHeading?: boolean
}) {
  return (
    <div>
      {showLocationCount && monitors.length > 1 && (
        <div className="mb-2 pr-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {monitors.length} sensors at this location
        </div>
      )}

      <div className="space-y-2">
        {monitors.map((monitor, index) => (
          <div
            key={monitorEntryKey(monitor)}
            className={index === 0 ? '' : 'border-t border-border pt-2'}
          >
            <SelectedMonitorDetails
              monitor={monitor}
              correctionModel={correctionModel}
              showHeading={index > 0 || showFirstHeading}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function MobileAirQualityFeatureCard({
  monitor,
  monitorsAtLocation,
  correctionModel,
  onClose,
}: {
  monitor: AirMonitor
  monitorsAtLocation: AirMonitor[]
  correctionModel: AirQualityCorrectionModel
  onClose: () => void
}) {
  const subtitle = [monitor.city, monitor.province].filter(Boolean).join(', ') || 'Location available'

  return (
    <MobileFeatureCard
      title={monitor.name}
      subtitle={subtitle}
      onClose={onClose}
    >
      {monitorsAtLocation.length > 1 && (
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {monitorsAtLocation.length} sensors at this location
        </div>
      )}
      <SelectedMonitorStack
        monitors={monitorsAtLocation}
        correctionModel={correctionModel}
        showFirstHeading={monitorsAtLocation.length > 1}
      />
    </MobileFeatureCard>
  )
}
