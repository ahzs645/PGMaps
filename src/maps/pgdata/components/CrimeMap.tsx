import { useEffect, useMemo } from 'react'
import {
  MapClusterLayer,
  MapMarker,
  MapPopup,
  MarkerContent,
  useMap,
} from '@/components/ui/map'
import { MapHeatmapLayer } from '@/components/ui/map-layers'
import { MOBILE_FEATURE_CARD_MEDIA_QUERY, MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { SharedMap } from '@/components/ui/persistent-map'
import { MAP_STYLES } from '@/components/ui/map-styles'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { formatDate } from '@/lib/format'
import { getCrimeCategory, getCrimeCategoryColor, CRIME_CATEGORY_COLORS } from '../constants'
import type { CrimeIncident, CrimeCategory } from '../types'

interface CrimeMapProps {
  incidents: CrimeIncident[]
  selectedIncident: CrimeIncident | null
  showHeatmap: boolean
  onIncidentClick: (incident: CrimeIncident) => void
  onIncidentClear: () => void
  showCrimeLayer: boolean
  loading?: boolean
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

export function CrimeMap({
  incidents,
  selectedIncident,
  showHeatmap,
  onIncidentClick,
  onIncidentClear,
  showCrimeLayer,
  loading = false,
}: CrimeMapProps) {
  const { map } = useMap()
  const isMobileViewport = useMediaQuery(MOBILE_FEATURE_CARD_MEDIA_QUERY)

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
    if (!selectedIncident || !map) return
    map.flyTo({
      center: [selectedIncident.longitude, selectedIncident.latitude],
      zoom: 15,
      duration: 800,
    })
  }, [map, selectedIncident])

  return (
    <div className="h-full w-full">
      <SharedMap styles={MAP_STYLES} loading={loading} loadingLabel="Loading crime map data">
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
                  if (selectedIncident?.id === id) {
                    onIncidentClear()
                    return
                  }
                  if (selected) onIncidentClick(selected)
                }}
              />
            )
          })}

        {showCrimeLayer && showHeatmap && <CrimeHeatmapLayer incidents={incidents} />}

        {/* Selected crime incident */}
        {selectedIncident && (
          <>
            <MapMarker
              longitude={selectedIncident.longitude}
              latitude={selectedIncident.latitude}
              onClick={onIncidentClear}
            >
              <MarkerContent>
                <div
                  className="h-5 w-5 rounded-full border-2 border-white shadow-lg ring-2 ring-sky-500 ring-offset-2"
                  style={{ backgroundColor: getCrimeCategoryColor(selectedIncident.crimeType) }}
                />
              </MarkerContent>
            </MapMarker>

            {!isMobileViewport && (
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
                    <span className="text-xs font-medium text-foreground">
                      {getCrimeCategory(selectedIncident.crimeType)}
                    </span>
                  </div>
                </div>
              </MapPopup>
            )}

            {isMobileViewport && (
              <MobileCrimeFeatureCard
                incident={selectedIncident}
                onClose={onIncidentClear}
              />
            )}
          </>
        )}
      </SharedMap>
    </div>
  )
}

function MobileCrimeFeatureCard({
  incident,
  onClose,
}: {
  incident: CrimeIncident
  onClose: () => void
}) {
  const category = getCrimeCategory(incident.crimeType)
  const categoryColor = getCrimeCategoryColor(incident.crimeType)
  const incidentTime = formatTime(incident.time)

  return (
    <MobileFeatureCard
      title={incident.crimeType}
      subtitle={incident.address}
      onClose={onClose}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{formatDate(incident.date)}</span>
        {incidentTime ? <span>{incidentTime}</span> : null}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{incident.community}</div>
      <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: categoryColor }}
        />
        <span className="text-xs font-medium text-foreground">{category}</span>
      </div>
      <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">File</span>
          <span className="max-w-[12rem] text-right font-medium text-foreground">
            {incident.fileNumber}
          </span>
        </div>
      </div>
    </MobileFeatureCard>
  )
}
