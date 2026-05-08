import { useEffect, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapClusterLayer,
  MapControls,
  MapMarker,
  MapPopup,
  MarkerContent,
  type MapRef,
} from '@/components/ui/map'
import { MapFillLayer, MapHeatmapLayer } from '@/components/ui/map-layers'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import { getCrimeCategory, getCrimeCategoryColor, CRIME_CATEGORY_COLORS } from '../constants'
import type { CrimeIncident, CrimeCategory } from '../types'

interface CrimeMapProps {
  incidents: CrimeIncident[]
  selectedIncident: CrimeIncident | null
  showHeatmap: boolean
  onIncidentClick: (incident: CrimeIncident) => void
  onIncidentClear: () => void
  // Overlay layers
  showCrimeLayer: boolean
  showAirQualityLayer: boolean
  showCensusLayer: boolean
  airMonitorGeojson: GeoJSON.FeatureCollection<GeoJSON.Point> | null
  censusGeojson: GeoJSON.FeatureCollection | null
  censusFillColor: unknown[] | string
}

type CrimeFeatureProperties = {
  id: number
  crimeType: string
  category: string
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '')
  const full = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(time: string): string {
  if (!time || time === '00:00:00') return ''
  const parts = time.split(':')
  if (parts.length < 2) return time
  const h = parseInt(parts[0], 10)
  const m = parts[1]
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m} ${ampm}`
}

function CrimeHeatmapLayer({ incidents }: { incidents: CrimeIncident[] }) {
  const heatmapWeight = useMemo(() => {
    if (incidents.length === 0) return 0
    return Math.min(0.75, Math.max(0.12, 3600 / incidents.length))
  }, [incidents.length])

  const geojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: 'FeatureCollection',
      features: incidents.map((inc) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [inc.longitude, inc.latitude] },
        properties: { weight: heatmapWeight },
      })),
    }),
    [incidents, heatmapWeight],
  )

  return (
    <MapHeatmapLayer
      data={geojson}
      intensityStops={[
        [8, 0.45],
        [12, 1],
        [15, 1.6],
      ]}
      radiusStops={[
        [8, 8],
        [12, 18],
        [15, 28],
      ]}
      opacity={[
        [10, 0.76],
        [14, 0.68],
        [16, 0.45],
      ]}
      colorRamp="crime"
    />
  )
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export function CrimeMap({
  incidents,
  selectedIncident,
  showHeatmap,
  onIncidentClick,
  onIncidentClear,
  showCrimeLayer,
  showAirQualityLayer,
  showCensusLayer,
  airMonitorGeojson,
  censusGeojson,
  censusFillColor,
}: CrimeMapProps) {
  const mapRef = useRef<MapRef>(null)

  const incidentById = useMemo(() => {
    const map = new Map<number, CrimeIncident>()
    incidents.forEach((inc) => map.set(inc.id, inc))
    return map
  }, [incidents])

  const collectionsByCategory = useMemo(() => {
    if (!showCrimeLayer) return []
    const grouped = new Map<CrimeCategory, GeoJSON.FeatureCollection<GeoJSON.Point, CrimeFeatureProperties>>()

    incidents.forEach((inc) => {
      const category = getCrimeCategory(inc.crimeType)
      if (!grouped.has(category)) {
        grouped.set(category, { type: 'FeatureCollection', features: [] })
      }
      grouped.get(category)!.features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [inc.longitude, inc.latitude],
        },
        properties: {
          id: inc.id,
          crimeType: inc.crimeType,
          category,
        },
      })
    })

    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [incidents, showCrimeLayer])

  useEffect(() => {
    if (!selectedIncident || !mapRef.current) return
    mapRef.current.flyTo({
      center: [selectedIncident.longitude, selectedIncident.latitude],
      zoom: 15,
      duration: 800,
    })
  }, [selectedIncident])

  return (
    <div className="h-full w-full">
      <PgMap ref={mapRef} center={PG_CENTER} zoom={12} styles={MAP_STYLES}>
        <MapControls position="top-right" showZoom showCompass />

        {/* Census choropleth layer (render first so it's below points) */}
        {showCensusLayer && (
          <MapFillLayer
            data={censusGeojson ?? EMPTY_FC}
            fillColor={censusFillColor as string}
            fillOpacity={0.55}
            lineOpacity={0.3}
            lineWidth={0.5}
            idProperty="GeoUID"
          />
        )}

        {/* Crime cluster layers */}
        {showCrimeLayer && !showHeatmap &&
          collectionsByCategory.map(([category, collection]) => {
            const color = CRIME_CATEGORY_COLORS[category]
            const clusterColors: [string, string, string] = [
              hexToRgba(color, 0.65),
              hexToRgba(color, 0.8),
              color,
            ]
            return (
              <MapClusterLayer<CrimeFeatureProperties>
                key={category}
                data={collection}
                pointColor={color}
                clusterColors={clusterColors}
                clusterThresholds={[50, 200]}
                onPointClick={(feature) => {
                  const id = feature.properties?.id
                  if (id == null) return
                  const selected = incidentById.get(id)
                  if (selected) onIncidentClick(selected)
                }}
              />
            )
          })}

        {showCrimeLayer && showHeatmap && <CrimeHeatmapLayer incidents={incidents} />}

        {/* Air quality monitor layer */}
        {showAirQualityLayer && airMonitorGeojson && (
          <MapClusterLayer
            data={airMonitorGeojson}
            pointColor="#22c55e"
            clusterColors={['rgba(34,197,94,0.5)', 'rgba(34,197,94,0.7)', '#22c55e']}
            clusterThresholds={[5, 15]}
          />
        )}

        {/* Selected crime incident */}
        {selectedIncident && (
          <>
            <MapMarker
              longitude={selectedIncident.longitude}
              latitude={selectedIncident.latitude}
            >
              <MarkerContent>
                <div
                  className="h-5 w-5 rounded-full border-2 border-white shadow-lg ring-2 ring-sky-500 ring-offset-2"
                  style={{ backgroundColor: getCrimeCategoryColor(selectedIncident.crimeType) }}
                />
              </MarkerContent>
            </MapMarker>

            <MapPopup
              key={selectedIncident.id}
              longitude={selectedIncident.longitude}
              latitude={selectedIncident.latitude}
              closeButton
              onClose={onIncidentClear}
              className="max-w-xs"
            >
              <div className="pr-6">
                <div className="text-sm font-semibold text-foreground">
                  {selectedIncident.crimeType}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {selectedIncident.address}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatDate(selectedIncident.date)}</span>
                  {formatTime(selectedIncident.time) && (
                    <span>{formatTime(selectedIncident.time)}</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {selectedIncident.community}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: getCrimeCategoryColor(selectedIncident.crimeType) }}
                  />
                  <span className="text-[10px] font-medium text-foreground">
                    {getCrimeCategory(selectedIncident.crimeType)}
                  </span>
                </div>
              </div>
            </MapPopup>
          </>
        )}
      </PgMap>
    </div>
  )
}
