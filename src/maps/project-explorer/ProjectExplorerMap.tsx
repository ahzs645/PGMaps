import { useMemo, useState } from 'react'

import { Map, MapControls, MapPopup } from '@/components/ui/map'
import { MapPieClusterLayer } from '@/components/ui/map-layers'
import { Timeline } from '@/components/ui/timeline'
import type { ProjectMapExplorerWorkspaceDef } from '@/lib/projectPackages'

import type { ResearchRecordsAdapterData } from './adapters/useResearchRecordsAdapter'
import { LocationPopupFeature } from './features/LocationPopupFeature'
import { MapLegendFeature } from './features/MapLegendFeature'

export function ProjectExplorerMap({
  config,
  data,
  timelineMode,
  onExitTimeline,
}: {
  config: ProjectMapExplorerWorkspaceDef
  data: ResearchRecordsAdapterData
  timelineMode: boolean
  onExitTimeline: () => void
}) {
  const { locationGeoJSON, selectedLocation, setSelectedLocationId } = data
  const timelineFeature = config.features.find((feature) => feature.type === 'timeline')
  const legendFeature = config.features.find((feature) => feature.type === 'map-legend')
  const popupFeature = config.features.find((feature) => feature.type === 'location-popup')
  const decadeValues = useMemo(() => data.decades.map((item) => item.decade), [data.decades])
  const firstDecade = decadeValues[0] ?? new Date().getFullYear()
  const lastDecade = decadeValues[decadeValues.length - 1] ?? firstDecade
  const [currentDate, setCurrentDate] = useState(() => new Date(lastDecade, 0, 1))
  const currentDecade = Math.floor(currentDate.getFullYear() / 10) * 10
  const currentIndex = data.decades.findIndex((item) => item.decade === currentDecade)
  const decadeSummary = currentIndex >= 0 ? data.decades[currentIndex] : undefined
  const timelineData = data.buildDecadeGeoJSON(currentDecade)
  const activeGeoJSON = timelineMode ? timelineData : locationGeoJSON
  const bucketCounts = useMemo(
    () => new globalThis.Map(data.decades.map((item) => [String(item.decade), item.total])),
    [data.decades],
  )
  const selectedTimelineFeature = timelineData.features.find(
    (feature) => feature.properties.id === data.selectedLocationId,
  )
  const pieBandColors = useMemo(
    () => config.data.categories.map((category) => category.color),
    [config.data.categories],
  )
  const legendCounts = timelineMode
    ? Object.entries(decadeSummary?.byResourceType ?? {}).sort((a, b) => b[1] - a[1])
    : data.filteredStats.typeBreakdown

  return (
    <Map
      center={config.map.center}
      zoom={config.map.zoom}
      minZoom={config.map.minZoom}
      maxZoom={config.map.maxZoom}
      controls={<MapControls position="top-right" showZoom showCompass showFullscreen />}
    >
      <MapPieClusterLayer
        data={activeGeoJSON}
        bandColors={pieBandColors}
        clusterRadius={52}
        preAggregated
        pointLabelProperty="name"
        expandOverlappingPoints
        onPointClick={(properties) => setSelectedLocationId(String(properties.id))}
      />
      {legendFeature?.type === 'map-legend' ? (
        <MapLegendFeature config={config} feature={legendFeature} counts={legendCounts} elevated={timelineMode} />
      ) : null}
      {!timelineMode && popupFeature?.type === 'location-popup' && selectedLocation?.coordinates ? (
        <MapPopup
          longitude={selectedLocation.coordinates.lon}
          latitude={selectedLocation.coordinates.lat}
          onClose={() => setSelectedLocationId(null)}
          closeButton
          className="w-64"
        >
          <LocationPopupFeature
            feature={popupFeature}
            name={selectedLocation.name}
            count={selectedLocation.filteredCount}
            resourceTypes={selectedLocation.filteredResourceTypes}
            resourceTypeColors={data.resourceTypeColors}
            resourceTypeLabels={data.resourceTypeLabels}
            recordPlural={config.labels.recordPlural}
          />
        </MapPopup>
      ) : null}
      {timelineMode && popupFeature?.type === 'location-popup' && selectedTimelineFeature ? (
        <MapPopup
          longitude={selectedTimelineFeature.geometry.coordinates[0]}
          latitude={selectedTimelineFeature.geometry.coordinates[1]}
          onClose={() => setSelectedLocationId(null)}
          closeButton
          className="w-56"
        >
          <div>
            <h3 className="text-sm font-semibold">{selectedTimelineFeature.properties.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedTimelineFeature.properties.count.toLocaleString()} {config.labels.recordPlural} in the{' '}
              {currentDecade}s
            </p>
          </div>
        </MapPopup>
      ) : null}
      {timelineMode && timelineFeature?.type === 'timeline' ? (
        <Timeline
          startDate={new Date(firstDecade, 0, 1)}
          endDate={new Date(lastDecade, 0, 1)}
          currentDate={currentDate}
          onDateChange={(date) => {
            setSelectedLocationId(null)
            setCurrentDate(date)
          }}
          onClose={onExitTimeline}
          bucketCounts={bucketCounts}
          bucketValueLabel={config.labels.recordPlural}
          statsLabel={`${decadeSummary?.total.toLocaleString() ?? 0} ${config.labels.recordPlural}`}
          granularity={timelineFeature.granularity}
        />
      ) : null}
    </Map>
  )
}
