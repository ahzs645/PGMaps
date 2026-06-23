import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import { Layers, Satellite, Trees } from 'lucide-react'
import { Map as PgMap, MapClusterLayer, MapControls, MapMarker, MapPopup, MarkerContent } from '@/components/ui/map'
import { MapFillLayer, MapHeatmapLayer, MapPmtilesFillLayer } from '@/components/ui/map-layers'
import { handleHorizontalWheelScroll } from '@/components/ui/horizontal-scroll'
import { MOBILE_FEATURE_CARD_MEDIA_QUERY, MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { DatasetInfo } from '@/components/DatasetInfo'
import {
  getDefaultLevelForSource,
  getLevelOptionsForSource,
  isValidLevelForSource,
  useStudyAreaRegions,
  type BoundarySource,
  type RegionLevel,
} from '@/lib/studyArea'
import { LegendItem, MapGradientLegendItem, MapLegendPanel, ToggleChip } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
import { useHeatShadeData } from '@/maps/scorebuilder/hooks/useHeatShadeData'
import { formatDate, formatNullableNumber, useJsonManifest } from './shared'
import {
  NetworkAvailabilitySidebar,
  useNetworkAvailabilityLayer,
  type NetworkAvailabilityManifest,
} from './networkAvailability'
import {
  EvChargingSidebar,
  type EvChargingFeature,
  type EvChargingFeatureCollection,
  type EvChargingManifest,
} from './evCharging'
import { CanueGraphDrawer, MobileCanueBoundaryFeatureCard } from './CanueGraphDrawer'
import { CanueSidebar } from './CanueSidebar'
import { useCanueController } from './useCanueController'
import { MISC_LEGEND_TITLES, MISC_TABS, parseMiscDataTab, type MiscDataTab } from './miscDataTabs'
import {
  CANUE_TIMELINE_WINDOW_OPTIONS,
  MISC_LAYERS,
  canueV2Paint,
  getCanueV2VariableLabel,
  getCanueVariableLabel,
  renderCanueDisplayLabel,
  type BoundaryFeatureCollection,
  type MiscLayerId,
} from './canueCore'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  WALKABILITY_DEFAULT_VARIANT,
  WALKABILITY_DEFAULT_DISPLAY_MODE,
  WalkabilityLayer,
  WalkabilityLegend,
  MobileWalkabilityFeatureCard,
  WalkabilitySidebar,
  WalkabilitySourceNotes,
  useWalkabilityData,
} from './walkability'
import {
  ICBC_TIMELINE_WINDOW_OPTIONS,
  IcbcLayer,
  IcbcLayerControls,
  IcbcLegend,
  IcbcSidebar,
  IcbcSourceNotes,
  MobileIcbcFeatureCard,
  useIcbcData,
} from './icbc'
import {
  WARS_TIMELINE_WINDOW_OPTIONS,
  WarsLayer,
  WarsLayerControls,
  WarsLegend,
  MobileWarsFeatureCard,
  WarsSidebar,
  WarsSourceNotes,
  useWarsData,
} from './wars'
import {
  WATER_TIMELINE_WINDOW_OPTIONS,
  WaterLayer,
  WaterLayerControls,
  WaterLegend,
  WaterSidebar,
  WaterSourceNotes,
  useWaterData,
} from './water'
import { FloodLayer, FloodLayerControls, FloodLegend, FloodSidebar, FloodSourceNotes, useFloodData } from './flood'
import {
  BCER_CENTER,
  BCER_ZOOM,
  BcerLayer,
  BcerLayerControls,
  BcerLegend,
  BcerSidebar,
  BcerSourceNotes,
  MobileBcerFeatureCard,
  useBcerData,
} from './bcer'
import { Timeline } from '@/components/ui/timeline'
import { DroughtSection } from '@/maps/drought'
import { CANUE_V2_ENABLED } from './canueV2'

interface HeatShadeManifestSource {
  id: string
  name: string
  kind: string
  featureCount?: number
  sceneCount?: number
  years?: number[]
}

interface HeatShadeManifest {
  generatedAt: string
  sources: HeatShadeManifestSource[]
  caveats?: string[]
}

function MobileEvStationFeatureCard({ station, onClose }: { station: EvChargingFeature; onClose: () => void }) {
  const location = [station.properties?.city, station.properties?.province].filter(Boolean).join(', ')

  return (
    <MobileFeatureCard
      cardKey={station.properties?.id ?? station.properties?.name}
      title={station.properties?.name || 'EV charging station'}
      subtitle={location || station.properties?.network || 'EV charging'}
      onClose={onClose}
    >
      <div className="rounded-md border border-border bg-background p-3 text-xs text-foreground">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Network</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {station.properties?.network || 'Unknown'}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Connectors</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {station.properties?.connectors || 'Unknown'}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Level 2</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {station.properties?.level2 ?? 0}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">DC fast</span>
            <span className="max-w-[12rem] text-right font-medium text-foreground">
              {station.properties?.dcFast ?? 0}
            </span>
          </div>
        </div>
      </div>
    </MobileFeatureCard>
  )
}

export default function MiscDataSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const isMobileViewport = useMediaQuery(MOBILE_FEATURE_CARD_MEDIA_QUERY)
  const [showSidebar, setShowSidebar] = useState(true)
  const activeTab = parseMiscDataTab(searchParams.get('tab'))
  const setActiveTab = useCallback(
    (tab: MiscDataTab) => {
      const params = new URLSearchParams(searchParams)
      if (tab === 'canue') params.delete('tab')
      else params.set('tab', tab)
      setSearchParams(params)
    },
    [searchParams, setSearchParams],
  )
  const [activeLayers, setActiveLayers] = useState<MiscLayerId[]>(['trees', 'forests', 'facilities'])
  const [showMobileLegend, setShowMobileLegend] = useState(false)
  const [evShowPoints, setEvShowPoints] = useState(() => searchParams.get('evPoints') !== '0')
  const [evShowHeatmap, setEvShowHeatmap] = useState(() => searchParams.get('evHeatmap') === '1')
  const [evShowBoundaries, setEvShowBoundaries] = useState(
    () => searchParams.get('evBoundaries') === '1' || searchParams.has('evSrc') || searchParams.has('evLevel'),
  )
  const [evBoundarySource, setEvBoundarySource] = useState<BoundarySource>(
    () => (searchParams.get('evSrc') as BoundarySource | null) || 'bcHealth',
  )
  const [evRegionLevel, setEvRegionLevel] = useState<RegionLevel>(
    () => (searchParams.get('evLevel') as RegionLevel | null) || 'healthAuthority',
  )
  const [selectedEvStation, setSelectedEvStation] = useState<EvChargingFeature | null>(null)
  const {
    canueBoundaryLevel,
    setCanueBoundaryLevel,
    canueBoundarySource,
    showCanueBoundaries,
    setShowCanueBoundaries,
    selectedCanueDatasetId,
    setSelectedCanueDatasetId,
    selectedCanueYear,
    setSelectedCanueYear,
    canueYearMode,
    setCanueYearMode,
    canueRangeStartYear,
    setCanueRangeStartYear,
    canueRangeEndYear,
    setCanueRangeEndYear,
    selectedCanueMonth,
    setSelectedCanueMonth,
    selectedCanueVariable,
    setSelectedCanueVariable,
    selectedCanueV2Family,
    setSelectedCanueV2Family,
    selectedCanueV2Year,
    setSelectedCanueV2Year,
    selectedCanueV2Measure,
    setSelectedCanueV2Measure,
    selectedCanueV2Cadence,
    setSelectedCanueV2Cadence,
    selectedCanueV2Month,
    setSelectedCanueV2Month,
    selectedCanueV2Property,
    setSelectedCanueV2Property,
    selectedCanueBoundaryId,
    setSelectedCanueBoundaryId,
    showCanueGraphs,
    setShowCanueGraphs,
    setCanueTimelineEnabled,
    canueTimelineWindowSize,
    setCanueTimelineWindowSize,
    selectedCanueGraphKeys,
    canueManifest,
    canueV2Catalog,
    canueV2Metadata,
    canueMembership,
    canueBoundaryConfig,
    canueBoundaries,
    canueDatasetGroups,
    canueBoundaryLevelOptions,
    selectedCanueDataset,
    selectedCanueFile,
    canueV2Families,
    selectedCanueV2FamilyEntry,
    selectedCanueV2FamilySelections,
    canueV2GridVariableOptions,
    selectedCanueV2GridVariableKey,
    selectedCanueV2GridVariableSelections,
    canueV2CadenceOptions,
    selectedCanueV2ResolvedCadence,
    selectedCanueV2CadenceSelections,
    canueV2MeasureOptions,
    selectedCanueV2MeasureKey,
    canueV2YearOptions,
    selectedCanueV2ResolvedYear,
    canueV2MonthOptions,
    selectedCanueV2ResolvedMonth,
    selectedCanueV2Layer,
    selectedCanueV2Selection,
    selectedCanueV2DatasetHelp,
    canueTimelineIsMonthly,
    canueTimelineDateRange,
    canueTimelineDate,
    canueTimelineBucketCounts,
    canueTimelineAvailable,
    canueTimelineActive,
    handleCanueTimelineDateChange,
    handleCanueTimelineDisable,
    canueTimelinePrefetch,
    canuePeriodLabel,
    canuePmtilesBoundaryData,
    canueV2AggregateData,
    activeCanueBoundaryData,
    activeCanueBoundaryProperty,
    selectedCanueBoundary,
    selectedCanueBoundaryCard,
    canueGraphVariableOptions,
    activeCanueGraphRows,
    canueGraphsAvailable,
    renderedCanueBoundaryLayer,
    renderedCanueFillColor,
    canueMapCenter,
    canueMapZoom,
    mapLoadingCanue,
    handleCanueBoundarySourceChange,
    handleCanueGraphVariableToggle,
  } = useCanueController({ activeTab, searchParams })
  const { trees, forests, facilities, loading, error } = useHeatShadeData(activeTab === 'heatShade')
  const heatShadeManifest = useJsonManifest<HeatShadeManifest>(
    activeTab === 'heatShade' ? '/data/heat-shade/manifest.json' : null,
  )
  const networkAvailabilityManifest = useJsonManifest<NetworkAvailabilityManifest>(
    activeTab === 'network' ? '/data/network-availability/manifest.json' : null,
  )
  const networkAvailabilityLayer = useNetworkAvailabilityLayer(activeTab === 'network')
  const evChargingManifest = useJsonManifest<EvChargingManifest>(
    activeTab === 'ev' ? '/data/ev-charging/manifest.json' : null,
  )
  const evChargingStations = useJsonManifest<EvChargingFeatureCollection>(
    activeTab === 'ev' ? '/data/ev-charging/stations.geojson' : null,
  )
  const {
    regions: evStudyAreaRegions,
    loading: evBoundaryLoading,
    error: evBoundaryError,
  } = useStudyAreaRegions(evBoundarySource, evRegionLevel)
  const icbc = useIcbcData(
    activeTab === 'icbc',
    searchParams.get('icbcDataset'),
    searchParams.get('icbcPoints'),
    searchParams.get('icbcHeatmap'),
  )
  const wars = useWarsData(
    activeTab === 'wars',
    searchParams.get('warsSpecies'),
    searchParams.get('warsPoints'),
    searchParams.get('warsHeatmap'),
  )
  const walkability = useWalkabilityData(
    activeTab === 'walkability',
    searchParams.get('walkability') || WALKABILITY_DEFAULT_VARIANT,
    searchParams.get('walkabilityMode') || WALKABILITY_DEFAULT_DISPLAY_MODE,
    searchParams.get('walkabilityHeatmap'),
  )
  const water = useWaterData(activeTab === 'water')
  const flood = useFloodData(activeTab === 'flood')
  const bcer = useBcerData(activeTab === 'bcer')

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    if (activeTab !== 'canue') params.set('tab', activeTab)
    else params.delete('tab')
    if (activeTab === 'canue') {
      if (selectedCanueDatasetId) params.set('dataset', selectedCanueDatasetId)
      else params.delete('dataset')
      if (selectedCanueYear != null) params.set('year', String(selectedCanueYear))
      else params.delete('year')
      if (canueYearMode !== 'single') params.set('years', canueYearMode)
      else params.delete('years')
      if (canueYearMode === 'month') params.set('month', String(selectedCanueMonth))
      else params.delete('month')
      if (selectedCanueV2Family) params.set('family', selectedCanueV2Family)
      else params.delete('family')
      if (selectedCanueV2Year != null) params.set('gridYear', String(selectedCanueV2Year))
      else params.delete('gridYear')
      if (selectedCanueV2Measure) params.set('measure', selectedCanueV2Measure)
      else params.delete('measure')
      if (selectedCanueV2Cadence === 'monthly') params.set('cadence', selectedCanueV2Cadence)
      else params.delete('cadence')
      if (selectedCanueV2Month) params.set('gridMonth', selectedCanueV2Month)
      else params.delete('gridMonth')
      if (selectedCanueV2Property) params.set('property', selectedCanueV2Property)
      else params.delete('property')
      params.set('boundary', canueBoundaryLevel)
    } else {
      params.delete('dataset')
      params.delete('year')
      params.delete('years')
      params.delete('month')
      params.delete('family')
      params.delete('gridYear')
      params.delete('measure')
      params.delete('cadence')
      params.delete('gridMonth')
      params.delete('property')
      params.delete('boundary')
    }
    if (activeTab === 'icbc' && icbc.selectedDatasetId) params.set('icbcDataset', icbc.selectedDatasetId)
    else params.delete('icbcDataset')
    if (activeTab === 'icbc' && !icbc.showPoints) params.set('icbcPoints', '0')
    else params.delete('icbcPoints')
    if (activeTab === 'icbc' && icbc.showHeatmap) params.set('icbcHeatmap', '1')
    else params.delete('icbcHeatmap')
    if (activeTab === 'wars' && wars.selectedSpecies !== 'all') params.set('warsSpecies', wars.selectedSpecies)
    else params.delete('warsSpecies')
    if (activeTab === 'wars' && !wars.showPoints) params.set('warsPoints', '0')
    else params.delete('warsPoints')
    if (activeTab === 'wars' && wars.showHeatmap) params.set('warsHeatmap', '1')
    else params.delete('warsHeatmap')
    if (activeTab === 'walkability' && walkability.selectedVariantId !== WALKABILITY_DEFAULT_VARIANT)
      params.set('walkability', walkability.selectedVariantId)
    else params.delete('walkability')
    if (activeTab === 'walkability' && walkability.displayMode !== WALKABILITY_DEFAULT_DISPLAY_MODE)
      params.set('walkabilityMode', walkability.displayMode)
    else params.delete('walkabilityMode')
    if (
      activeTab === 'walkability' &&
      walkability.displayMode === 'heatmap' &&
      walkability.selectedHeatmapVariantId !== 'report_fidelity'
    ) {
      params.set('walkabilityHeatmap', walkability.selectedHeatmapVariantId)
    } else {
      params.delete('walkabilityHeatmap')
    }
    if (activeTab === 'ev' && !evShowPoints) params.set('evPoints', '0')
    else params.delete('evPoints')
    if (activeTab === 'ev' && evShowHeatmap) params.set('evHeatmap', '1')
    else params.delete('evHeatmap')
    if (activeTab === 'ev' && evShowBoundaries) {
      params.set('evBoundaries', '1')
      params.set('evSrc', evBoundarySource)
      params.set('evLevel', evRegionLevel)
    } else {
      params.delete('evBoundaries')
      params.delete('evSrc')
      params.delete('evLevel')
    }
    if (activeTab !== 'drought') {
      params.delete('droughtYear')
    }
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [
    activeTab,
    canueBoundaryLevel,
    canueYearMode,
    searchParams,
    selectedCanueDatasetId,
    selectedCanueMonth,
    selectedCanueV2Cadence,
    selectedCanueV2Family,
    selectedCanueV2Measure,
    selectedCanueV2Month,
    selectedCanueV2Property,
    selectedCanueV2Year,
    selectedCanueYear,
    icbc.showHeatmap,
    icbc.showPoints,
    icbc.selectedDatasetId,
    wars.showHeatmap,
    wars.showPoints,
    wars.selectedSpecies,
    walkability.displayMode,
    walkability.selectedHeatmapVariantId,
    walkability.selectedVariantId,
    evBoundarySource,
    evRegionLevel,
    evShowBoundaries,
    evShowHeatmap,
    evShowPoints,
    setSearchParams,
  ])

  const forestGeojson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: forests.map((forest) => ({
        type: 'Feature',
        id: forest.id,
        properties: {
          id: forest.id,
          name: forest.name,
          areaSqKm: forest.areaSqKm,
        },
        geometry: forest.geometry,
      })),
    }),
    [forests],
  )

  const visibleTrees = useMemo(() => trees.slice(0, 900), [trees])
  const visibleFacilities = useMemo(() => facilities.slice(0, 350), [facilities])
  const evRegionLevelOptions = useMemo(
    () =>
      getLevelOptionsForSource(evBoundarySource).map((option) => ({
        value: option.value as RegionLevel,
        label: option.label,
      })),
    [evBoundarySource],
  )
  const activeEvStudyAreaRegions = useMemo(
    () => (evShowBoundaries ? evStudyAreaRegions : []),
    [evShowBoundaries, evStudyAreaRegions],
  )
  const evStudyAreaFeatureCollection = useMemo<BoundaryFeatureCollection | null>(() => {
    if (activeEvStudyAreaRegions.length === 0) return null
    return {
      type: 'FeatureCollection',
      features: activeEvStudyAreaRegions.map((region) => ({
        ...region.feature,
        properties: {
          ...(region.feature.properties ?? {}),
          id: region.code,
          code: region.code,
          name: region.name,
        },
      })),
    }
  }, [activeEvStudyAreaRegions])
  const evStudyAreaBounds = useMemo<[number, number, number, number] | null>(() => {
    if (activeEvStudyAreaRegions.length === 0) return null
    return activeEvStudyAreaRegions.reduce<[number, number, number, number]>(
      (bounds, region) => [
        Math.min(bounds[0], region.bounds[0]),
        Math.min(bounds[1], region.bounds[1]),
        Math.max(bounds[2], region.bounds[2]),
        Math.max(bounds[3], region.bounds[3]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    )
  }, [activeEvStudyAreaRegions])
  const filteredEvStations = useMemo<EvChargingFeatureCollection>(() => {
    const features = (evChargingStations.data?.features ?? []) as EvChargingFeature[]
    if (activeEvStudyAreaRegions.length === 0 || !evStudyAreaBounds) {
      return { type: 'FeatureCollection', features }
    }

    const filtered = features.filter((feature) => {
      const [longitude, latitude] = feature.geometry.coordinates
      if (
        longitude < evStudyAreaBounds[0] ||
        longitude > evStudyAreaBounds[2] ||
        latitude < evStudyAreaBounds[1] ||
        latitude > evStudyAreaBounds[3]
      ) {
        return false
      }

      const stationPoint = point([longitude, latitude])
      return activeEvStudyAreaRegions.some(
        (region) =>
          longitude >= region.bounds[0] &&
          longitude <= region.bounds[2] &&
          latitude >= region.bounds[1] &&
          latitude <= region.bounds[3] &&
          booleanPointInPolygon(stationPoint, region.feature),
      )
    })

    return { type: 'FeatureCollection', features: filtered }
  }, [activeEvStudyAreaRegions, evChargingStations.data?.features, evStudyAreaBounds])
  const handleEvBoundarySourceChange = useCallback((source: BoundarySource) => {
    setEvShowBoundaries(true)
    setEvBoundarySource(source)
    setEvRegionLevel((current) => (isValidLevelForSource(source, current) ? current : getDefaultLevelForSource(source)))
  }, [])

  const handleEvBoundaryLevelChange = useCallback((level: RegionLevel) => {
    setEvShowBoundaries(true)
    setEvRegionLevel(level)
  }, [])

  const handleEvClearBoundaries = useCallback(() => {
    setEvShowBoundaries(false)
  }, [])

  const toggleLayer = (layer: MiscLayerId) => {
    setActiveLayers((current) =>
      current.includes(layer) ? current.filter((item) => item !== layer) : [...current, layer],
    )
  }

  const sourceNotes = (
    <>
      {activeTab === 'heatShade' && <p>Heat/shade updated {formatDate(heatShadeManifest.data?.generatedAt)}.</p>}
      {activeTab === 'canue' && <p>CANUE raw extracts updated {formatDate(canueManifest.data?.generatedAt)}.</p>}
      {activeTab === 'network' && (
        <p>Network availability inventory updated {formatDate(networkAvailabilityManifest.data?.generatedAt)}.</p>
      )}
      {activeTab === 'network' && networkAvailabilityLayer.error && <p>{networkAvailabilityLayer.error}</p>}
      {activeTab === 'ev' && <p>EV charging inventory updated {formatDate(evChargingManifest.data?.generatedAt)}.</p>}
      {activeTab === 'ev' && evChargingStations.error && <p>{evChargingStations.error}</p>}
      {activeTab === 'icbc' && <IcbcSourceNotes icbc={icbc} />}
      {activeTab === 'wars' && <WarsSourceNotes wars={wars} />}
      {activeTab === 'walkability' && <WalkabilitySourceNotes walkability={walkability} />}
      {activeTab === 'water' && <WaterSourceNotes water={water} />}
      {activeTab === 'flood' && <FloodSourceNotes flood={flood} />}
      {activeTab === 'bcer' && <BcerSourceNotes bcer={bcer} />}
      {activeTab === 'heatShade' &&
        (heatShadeManifest.data?.caveats ?? []).slice(0, 2).map((caveat) => <p key={caveat}>{caveat}</p>)}
    </>
  )

  const activeMapTitle =
    activeTab === 'canue'
      ? 'CANUE'
      : activeTab === 'network'
        ? 'Network'
        : activeTab === 'ev'
          ? 'EV Chargers'
          : activeTab === 'icbc'
            ? 'ICBC'
            : activeTab === 'wars'
              ? 'WARS'
              : activeTab === 'walkability'
                ? 'Walkability'
                : activeTab === 'water'
                  ? 'Water'
                  : activeTab === 'flood'
                    ? 'Flood'
                    : activeTab === 'drought'
                      ? 'Drought'
                      : activeTab === 'bcer'
                        ? 'BCER'
                        : 'Heat & Shade'
  const heatShadeSources = heatShadeManifest.data?.sources ?? []
  const landsatSource = heatShadeSources.find((source) => source.id.includes('landsat'))
  const evMapCenter = useMemo<[number, number]>(
    () =>
      evStudyAreaBounds
        ? [(evStudyAreaBounds[0] + evStudyAreaBounds[2]) / 2, (evStudyAreaBounds[1] + evStudyAreaBounds[3]) / 2]
        : PG_CENTER,
    [evStudyAreaBounds],
  )
  const mapCenter =
    activeTab === 'canue'
      ? canueMapCenter
      : activeTab === 'bcer'
        ? BCER_CENTER
        : activeTab === 'ev' && evShowBoundaries
          ? evMapCenter
          : PG_CENTER
  const mapZoom =
    activeTab === 'canue'
      ? canueMapZoom
      : activeTab === 'bcer'
        ? BCER_ZOOM
        : activeTab === 'ev' && evShowBoundaries
          ? evBoundarySource === 'census' || evBoundarySource === 'cityPG'
            ? 9.2
            : 4.6
          : 9.4
  const mapKey = [
    activeTab,
    activeTab === 'canue' ? canueBoundaryLevel : '',
    activeTab === 'ev' ? `${evBoundarySource}-${evRegionLevel}-${evShowBoundaries ? 'boundaries' : 'points'}` : '',
  ].join(':')
  const mapLoading =
    activeTab === 'canue'
      ? mapLoadingCanue
      : activeTab === 'heatShade'
        ? loading
        : activeTab === 'network'
          ? !networkAvailabilityLayer.data && !networkAvailabilityLayer.error
          : activeTab === 'ev'
            ? (!evChargingStations.data && !evChargingStations.error) || (evShowBoundaries && evBoundaryLoading)
            : activeTab === 'flood'
              ? flood.loading
              : activeTab === 'bcer'
                ? bcer.loading
                : false

  const sidebar = (
    <div className="z-10 flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">{activeMapTitle}</h1>
        {activeTab === 'ev' && (
          <div className="flex flex-wrap gap-2">
            <ToggleChip active={evShowPoints} onClick={() => setEvShowPoints((current) => !current)} tone="sky">
              {evShowPoints ? 'Hide points' : 'Show points'}
            </ToggleChip>
            <ToggleChip active={evShowHeatmap} onClick={() => setEvShowHeatmap((current) => !current)} tone="orange">
              Heatmap
            </ToggleChip>
          </div>
        )}
        {activeTab === 'icbc' && <IcbcLayerControls icbc={icbc} />}
        {activeTab === 'wars' && <WarsLayerControls wars={wars} />}
        {activeTab === 'water' && <WaterLayerControls water={water} />}
        {activeTab === 'flood' && <FloodLayerControls flood={flood} />}
        {activeTab === 'bcer' && <BcerLayerControls bcer={bcer} />}
      </div>

      <DatasetInfo
        dataset={{
          ...(activeTab === 'heatShade'
            ? DATASETS.heatShade
            : activeTab === 'network'
              ? DATASETS.networkAvailability
              : activeTab === 'ev'
                ? DATASETS.evCharging
                : activeTab === 'icbc'
                  ? DATASETS.icbc
                  : activeTab === 'wars'
                    ? DATASETS.wars
                    : activeTab === 'walkability'
                      ? DATASETS.walkability
                      : activeTab === 'water'
                        ? DATASETS.water
                        : activeTab === 'flood'
                          ? DATASETS.flood
                          : activeTab === 'bcer'
                            ? DATASETS.bcer
                            : DATASETS.canue),
          updated:
            activeTab === 'heatShade'
              ? heatShadeManifest.data?.generatedAt
              : activeTab === 'network'
                ? networkAvailabilityManifest.data?.generatedAt
                : activeTab === 'ev'
                  ? evChargingManifest.data?.generatedAt
                  : activeTab === 'icbc'
                    ? icbc.manifest.data?.generatedAt
                    : activeTab === 'wars'
                      ? wars.manifest.data?.generatedAt
                      : activeTab === 'walkability'
                        ? walkability.manifest.data?.generatedAt
                        : activeTab === 'water'
                          ? water.manifest.data?.generatedAt
                          : activeTab === 'flood'
                            ? undefined
                            : activeTab === 'bcer'
                              ? bcer.meta?.importTimestamp
                              : canueManifest.data?.generatedAt,
        }}
        sourceNotes={sourceNotes}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'heatShade' && (
          <>
            <div className="border-b border-border p-4">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Map Layers</h2>
              <div className="space-y-2">
                {MISC_LAYERS.map((layer) => (
                  <label key={layer.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={activeLayers.includes(layer.id)}
                        onChange={() => toggleLayer(layer.id)}
                        className="h-3.5 w-3.5 rounded border-input"
                        style={{ accentColor: layer.color }}
                      />
                      <span className="text-sm text-foreground">{layer.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {layer.id === 'trees'
                        ? trees.length.toLocaleString()
                        : layer.id === 'forests'
                          ? forests.length.toLocaleString()
                          : facilities.length.toLocaleString()}
                    </span>
                  </label>
                ))}
              </div>
              {loading && <div className="mt-3 text-xs text-muted-foreground">Loading heat and shade data...</div>}
              {error && <div className="mt-3 text-xs text-red-500">{error}</div>}
            </div>

            <div className="border-b border-border p-4">
              <div className="mb-3 flex items-center gap-2">
                <Trees className="h-4 w-4 text-green-600" />
                <h2 className="text-sm font-semibold text-foreground">Heat, Shade, and Canopy</h2>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border border-border p-2">
                  <div className="text-lg font-bold text-foreground">{trees.length.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">tree points</div>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="text-lg font-bold text-foreground">{forests.length.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">forest areas</div>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="text-lg font-bold text-foreground">{facilities.length.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">facilities</div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Tree points are shown as a canopy and shade proxy until a full canopy raster or canopy polygon layer is
                available.
              </p>
            </div>

            <div className="border-b border-border p-4">
              <div className="mb-3 flex items-center gap-2">
                <Satellite className="h-4 w-4 text-violet-600" />
                <h2 className="text-sm font-semibold text-foreground">Remote Sensing Queue</h2>
              </div>
              <div className="rounded-md border border-border p-3 text-sm">
                <div className="font-medium text-foreground">{landsatSource?.name ?? 'Landsat warm-season scenes'}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {landsatSource?.sceneCount ?? 0} scenes
                  {landsatSource?.years?.length ? ` across ${landsatSource.years.join(', ')}` : ''}
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'canue' && (
          <CanueSidebar
            showCanueBoundaries={showCanueBoundaries}
            canueBoundarySource={canueBoundarySource}
            canueBoundaryLevel={canueBoundaryLevel}
            canueBoundaryLevelOptions={canueBoundaryLevelOptions}
            canueBoundaryConfig={canueBoundaryConfig}
            canueTimelineAvailable={canueTimelineAvailable}
            canueTimelineActive={canueTimelineActive}
            canueGraphsAvailable={canueGraphsAvailable}
            showCanueGraphs={showCanueGraphs}
            canueV2Catalog={canueV2Catalog}
            canueV2Metadata={canueV2Metadata}
            canueV2Families={canueV2Families}
            selectedCanueV2FamilyEntry={selectedCanueV2FamilyEntry}
            selectedCanueV2FamilySelections={selectedCanueV2FamilySelections}
            selectedCanueV2GridVariableKey={selectedCanueV2GridVariableKey}
            selectedCanueV2GridVariableSelections={selectedCanueV2GridVariableSelections}
            selectedCanueV2ResolvedCadence={selectedCanueV2ResolvedCadence}
            selectedCanueV2CadenceSelections={selectedCanueV2CadenceSelections}
            selectedCanueV2MeasureKey={selectedCanueV2MeasureKey}
            selectedCanueV2ResolvedYear={selectedCanueV2ResolvedYear}
            selectedCanueV2ResolvedMonth={selectedCanueV2ResolvedMonth}
            selectedCanueV2Layer={selectedCanueV2Layer}
            selectedCanueV2Selection={selectedCanueV2Selection}
            selectedCanueV2DatasetHelp={selectedCanueV2DatasetHelp}
            canueV2GridVariableOptions={canueV2GridVariableOptions}
            canueV2CadenceOptions={canueV2CadenceOptions}
            canueV2MeasureOptions={canueV2MeasureOptions}
            canueV2YearOptions={canueV2YearOptions}
            canueV2MonthOptions={canueV2MonthOptions}
            activeCanueBoundaryData={activeCanueBoundaryData}
            canueV2AggregateData={canueV2AggregateData}
            canuePmtilesBoundaryData={canuePmtilesBoundaryData}
            selectedCanueBoundary={selectedCanueBoundary}
            selectedCanueDataset={selectedCanueDataset}
            selectedCanueFile={selectedCanueFile}
            selectedCanueVariable={selectedCanueVariable}
            canueDatasetGroups={canueDatasetGroups}
            canueYearMode={canueYearMode}
            selectedCanueMonth={selectedCanueMonth}
            canueRangeStartYear={canueRangeStartYear}
            canueRangeEndYear={canueRangeEndYear}
            canuePeriodLabel={canuePeriodLabel}
            activeCanueBoundaryProperty={activeCanueBoundaryProperty}
            canueManifest={canueManifest}
            canueMembership={canueMembership}
            canueBoundaries={canueBoundaries}
            setShowCanueBoundaries={setShowCanueBoundaries}
            handleCanueBoundarySourceChange={handleCanueBoundarySourceChange}
            setCanueBoundaryLevel={setCanueBoundaryLevel}
            setCanueTimelineEnabled={setCanueTimelineEnabled}
            setShowCanueGraphs={setShowCanueGraphs}
            setSelectedCanueV2Family={setSelectedCanueV2Family}
            setSelectedCanueV2Cadence={setSelectedCanueV2Cadence}
            setSelectedCanueV2Measure={setSelectedCanueV2Measure}
            setSelectedCanueV2Year={setSelectedCanueV2Year}
            setSelectedCanueV2Month={setSelectedCanueV2Month}
            setSelectedCanueV2Property={setSelectedCanueV2Property}
            setSelectedCanueDatasetId={setSelectedCanueDatasetId}
            setSelectedCanueYear={setSelectedCanueYear}
            setCanueYearMode={setCanueYearMode}
            setCanueRangeStartYear={setCanueRangeStartYear}
            setCanueRangeEndYear={setCanueRangeEndYear}
            setSelectedCanueVariable={setSelectedCanueVariable}
            setSelectedCanueMonth={setSelectedCanueMonth}
          />
        )}

        {activeTab === 'network' && <NetworkAvailabilitySidebar manifest={networkAvailabilityManifest} />}

        {activeTab === 'ev' && (
          <EvChargingSidebar
            manifest={evChargingManifest}
            stationCount={filteredEvStations.features.length}
            boundariesVisible={evShowBoundaries}
            boundarySource={evBoundarySource}
            selectedRegionLevel={evRegionLevel}
            regionLevelOptions={evRegionLevelOptions}
            boundaryLoading={evShowBoundaries && evBoundaryLoading}
            boundaryError={evShowBoundaries ? evBoundaryError : null}
            onBoundarySourceChange={handleEvBoundarySourceChange}
            onClearBoundaries={handleEvClearBoundaries}
            onRegionLevelChange={handleEvBoundaryLevelChange}
          />
        )}

        {activeTab === 'icbc' && <IcbcSidebar icbc={icbc} />}

        {activeTab === 'wars' && <WarsSidebar wars={wars} />}

        {activeTab === 'walkability' && <WalkabilitySidebar walkability={walkability} />}

        {activeTab === 'water' && <WaterSidebar water={water} />}
        {activeTab === 'flood' && <FloodSidebar flood={flood} />}
        {activeTab === 'bcer' && <BcerSidebar bcer={bcer} />}
      </div>
    </div>
  )

  const tabsBar = (
    <div
      className="hidden min-w-0 shrink-0 overflow-x-auto border-b border-border bg-background/95 px-2 py-1 backdrop-blur [scrollbar-width:none] md:block md:px-4 md:py-2 [&::-webkit-scrollbar]:hidden"
      onWheel={handleHorizontalWheelScroll}
    >
      <div className="flex w-max rounded-md border border-border bg-muted/40 p-0.5 md:rounded-lg md:p-1">
        {MISC_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'inline-flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors sm:h-7 sm:gap-1.5 sm:px-2.5 sm:text-xs md:h-8 md:rounded-md md:px-3',
              activeTab === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span className={id === 'heatShade' ? 'hidden sm:inline' : ''}>{label}</span>
            {id === 'heatShade' && <span className="sm:hidden">Shade</span>}
          </button>
        ))}
      </div>
    </div>
  )

  if (activeTab === 'drought') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        {tabsBar}
        <div className="min-h-0 flex-1">
          <DroughtSection yearParam="droughtYear" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {tabsBar}
      <div className="min-h-0 flex-1">
        <MapSectionLayout
          showDesktopSidebar={showSidebar}
          onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
          mobilePeek={
            <div className="min-w-0 text-left">
              <div className="truncate text-xs font-semibold text-foreground">
                MISC Data |{' '}
                {activeTab === 'canue'
                  ? 'CANUE'
                  : activeTab === 'network'
                    ? 'Network'
                    : activeTab === 'ev'
                      ? 'EV Chargers'
                      : activeTab === 'icbc'
                        ? 'ICBC'
                        : activeTab === 'wars'
                          ? 'WARS'
                          : activeTab === 'walkability'
                            ? 'Walkability'
                            : activeTab === 'water'
                              ? 'Water'
                              : activeTab === 'flood'
                                ? 'Flood'
                                : activeTab === 'bcer'
                                  ? 'BCER'
                                  : 'Heat/shade'}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {activeTab === 'canue'
                  ? `${selectedCanueDataset?.label || 'Dataset'} | ${canuePeriodLabel}`
                  : activeTab === 'network'
                    ? `${networkAvailabilityLayer.data?.features.length ?? 0} coverage features | ${networkAvailabilityManifest.data?.datasets.length ?? 0} sources`
                    : activeTab === 'ev'
                      ? `${filteredEvStations.features.length.toLocaleString()} stations | ${evShowPoints ? 'points' : 'points off'}${evShowHeatmap ? ' + heatmap' : ''}`
                      : activeTab === 'icbc'
                        ? `${icbc.selectedDataset?.title || 'Crash locations'} | ${icbc.crashFeatures.length.toLocaleString()} mapped`
                        : activeTab === 'wars'
                          ? `${wars.selectedSpecies === 'all' ? 'All species' : wars.selectedSpecies} | ${wars.filteredFeatures.length.toLocaleString()} records`
                          : activeTab === 'walkability'
                            ? walkability.displayMode === 'heatmap'
                              ? `${walkability.selectedHeatmapVariant?.label || 'Citywide MI grid'}`
                              : `${walkability.selectedVariant?.label || 'Variant'} | ${walkability.features.length.toLocaleString()} communities`
                            : activeTab === 'water'
                              ? `${water.facilities.length.toLocaleString()} facilities | ${water.filteredSamples.length.toLocaleString()} sample rows`
                              : activeTab === 'flood'
                                ? `${flood.filteredStations.length.toLocaleString()} stations | ${flood.highRiskCount.toLocaleString()} above 2 year`
                                : activeTab === 'bcer'
                                  ? `${bcer.filteredWells.length.toLocaleString()} wells | ${bcer.horizontalCount.toLocaleString()} horizontal`
                                  : `${trees.length.toLocaleString()} trees | ${forests.length.toLocaleString()} forests`}
              </div>
            </div>
          }
          mobileSidebar={
            activeTab === 'icbc' ? (
              <IcbcSidebar icbc={icbc} showSelectedLocation={false} />
            ) : activeTab === 'wars' ? (
              <WarsSidebar wars={wars} showSelectedRecord={false} />
            ) : activeTab === 'walkability' ? (
              <WalkabilitySidebar walkability={walkability} showSelectedCommunity={false} />
            ) : undefined
          }
          sidebar={sidebar}
        >
          <div className="relative h-full">
            <PgMap key={mapKey} center={mapCenter} zoom={mapZoom} styles={MAP_STYLES} loading={mapLoading}>
              <MapControls position="top-right" mobilePosition="bottom-right" showZoom showCompass />

              <MapFillLayer
                data={forestGeojson}
                fillColor="#15803d"
                fillOpacity={0.28}
                lineColor="#166534"
                lineWidth={1.2}
                lineOpacity={0.8}
                visible={activeTab === 'heatShade' && activeLayers.includes('forests')}
              />

              {activeTab === 'heatShade' &&
                activeLayers.includes('trees') &&
                visibleTrees.map((tree, index) => (
                  <MapMarker key={`${tree.id}-${index}`} longitude={tree.longitude} latitude={tree.latitude}>
                    <MarkerContent>
                      <div className="h-2 w-2 rounded-full border border-white bg-green-600 shadow-sm" />
                    </MarkerContent>
                  </MapMarker>
                ))}

              {activeTab === 'heatShade' &&
                activeLayers.includes('facilities') &&
                visibleFacilities.map((facility, index) => (
                  <MapMarker
                    key={`${facility.id}-${index}`}
                    longitude={facility.longitude}
                    latitude={facility.latitude}
                  >
                    <MarkerContent>
                      <div className="h-3 w-3 rounded-full border border-white bg-sky-500 shadow-sm" />
                    </MarkerContent>
                  </MapMarker>
                ))}

              {activeTab === 'canue' && CANUE_V2_ENABLED && selectedCanueV2Selection && !showCanueBoundaries && (
                <MapPmtilesFillLayer
                  key={selectedCanueV2Selection.pmtilesUrl}
                  url={selectedCanueV2Selection.pmtilesUrl}
                  sourceLayer="canue"
                  fillColor={canueV2Paint(selectedCanueV2Selection)}
                  fillOpacity={0.64}
                  lineColor="#0f172a"
                  lineWidth={0.18}
                  lineOpacity={0.22}
                />
              )}

              {activeTab === 'canue' &&
                showCanueBoundaries &&
                renderedCanueBoundaryLayer &&
                renderedCanueBoundaryLayer.data.features.length > 0 && (
                  <MapFillLayer
                    data={renderedCanueBoundaryLayer.data}
                    fillColor={renderedCanueFillColor}
                    fillOpacity={0.74}
                    lineColor="#0e7490"
                    lineWidth={0.7}
                    lineOpacity={0.58}
                    idProperty="boundaryId"
                    selectedId={selectedCanueBoundaryId}
                    selectionColor="#111827"
                    selectionWidth={2.1}
                    onFeatureClick={(id) => setSelectedCanueBoundaryId(selectedCanueBoundaryId === id ? null : id)}
                  />
                )}

              {activeTab === 'canue' && isMobileViewport && selectedCanueBoundaryCard && (
                <MobileCanueBoundaryFeatureCard
                  card={selectedCanueBoundaryCard}
                  onClose={() => setSelectedCanueBoundaryId(null)}
                />
              )}

              {activeTab === 'network' && networkAvailabilityLayer.data && (
                <MapFillLayer
                  data={networkAvailabilityLayer.data}
                  fillColor={['match', ['get', 'Speed'], '5G', '#0f766e', 'LTE', '#2563eb', '#64748b']}
                  fillOpacity={0.46}
                  lineColor="#083344"
                  lineWidth={0.5}
                  lineOpacity={0.38}
                  idProperty="id"
                />
              )}

              {activeTab === 'ev' && evStudyAreaFeatureCollection && (
                <MapFillLayer
                  data={evStudyAreaFeatureCollection}
                  fillColor="#0ea5e9"
                  fillOpacity={0.08}
                  lineColor="#0284c7"
                  lineWidth={1}
                  lineOpacity={0.7}
                  idProperty="code"
                />
              )}

              {activeTab === 'ev' && evShowHeatmap && filteredEvStations.features.length > 0 && (
                <MapHeatmapLayer
                  data={filteredEvStations}
                  intensityStops={[
                    [0, 0.7],
                    [5, 1.1],
                    [10, 1.5],
                  ]}
                  radiusStops={[
                    [0, 6],
                    [5, 18],
                    [10, 30],
                  ]}
                  opacity={0.78}
                  colorRamp={[
                    [0, 'rgba(14, 165, 233, 0)'],
                    [0.2, '#67e8f9'],
                    [0.5, '#22c55e'],
                    [0.8, '#fde047'],
                    [1, '#f97316'],
                  ]}
                />
              )}

              {activeTab === 'ev' && evShowPoints && filteredEvStations.features.length > 0 && (
                <MapClusterLayer
                  data={filteredEvStations}
                  clusterColors={['#0ea5e9', '#22c55e', '#f97316']}
                  clusterThresholds={[25, 125]}
                  pointColor="#0ea5e9"
                  onPointClick={(feature) => {
                    const station = feature as EvChargingFeature
                    setSelectedEvStation((current) =>
                      current?.properties?.id === station.properties?.id ? null : station,
                    )
                  }}
                />
              )}

              {activeTab === 'ev' && selectedEvStation && !isMobileViewport && (
                <MapPopup
                  longitude={selectedEvStation.geometry.coordinates[0]}
                  latitude={selectedEvStation.geometry.coordinates[1]}
                  onClose={() => setSelectedEvStation(null)}
                >
                  <div className="min-w-48 text-xs">
                    <div className="pr-5 text-sm font-semibold text-foreground">
                      {selectedEvStation.properties?.name || 'EV charging station'}
                    </div>
                    <div className="text-muted-foreground">
                      {[selectedEvStation.properties?.city, selectedEvStation.properties?.province]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                    <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <span className="text-muted-foreground">Network</span>
                      <span className="font-medium text-foreground">
                        {selectedEvStation.properties?.network || 'Unknown'}
                      </span>
                      <span className="text-muted-foreground">Connectors</span>
                      <span className="font-medium text-foreground">
                        {selectedEvStation.properties?.connectors || 'Unknown'}
                      </span>
                      <span className="text-muted-foreground">Level 2</span>
                      <span className="font-medium text-foreground">{selectedEvStation.properties?.level2 ?? 0}</span>
                      <span className="text-muted-foreground">DC fast</span>
                      <span className="font-medium text-foreground">{selectedEvStation.properties?.dcFast ?? 0}</span>
                    </div>
                  </div>
                </MapPopup>
              )}

              {activeTab === 'ev' && selectedEvStation && isMobileViewport && (
                <MobileEvStationFeatureCard station={selectedEvStation} onClose={() => setSelectedEvStation(null)} />
              )}

              {activeTab === 'walkability' && <WalkabilityLayer walkability={walkability} />}

              {activeTab === 'water' && <WaterLayer water={water} />}
              {activeTab === 'flood' && <FloodLayer flood={flood} />}
              {activeTab === 'bcer' && <BcerLayer bcer={bcer} isMobile={isMobileViewport} />}

              {activeTab === 'bcer' && isMobileViewport && bcer.selectedWell && (
                <MobileBcerFeatureCard bcer={bcer} />
              )}

              {activeTab === 'icbc' && <IcbcLayer icbc={icbc} />}

              {activeTab === 'icbc' && isMobileViewport && icbc.selectedCrash && <MobileIcbcFeatureCard icbc={icbc} />}

              {activeTab === 'wars' && <WarsLayer wars={wars} />}

              {activeTab === 'wars' && isMobileViewport && wars.selectedCrash && <MobileWarsFeatureCard wars={wars} />}

              {activeTab === 'walkability' && isMobileViewport && walkability.selectedCommunity && (
                <MobileWalkabilityFeatureCard walkability={walkability} />
              )}
            </PgMap>

            {activeTab === 'wars' && wars.timelineEnabled && wars.timelineDate && (
              <Timeline
                startDate={wars.accidentDateRange.start}
                endDate={wars.accidentDateRange.end}
                currentDate={wars.timelineDate}
                onDateChange={wars.setTimelineDate}
                onClose={wars.handleTimelineDisable}
                granularity="year"
                bucketCounts={wars.bucketCounts}
                compactBars
                overflowBuckets
                percentChangeMode={{ enabled: true, label: 'YoY' }}
                windowMode={{
                  size: wars.timelineWindowSize,
                  onSizeChange: wars.setTimelineWindowSize,
                  options: WARS_TIMELINE_WINDOW_OPTIONS,
                }}
              />
            )}

            {activeTab === 'icbc' && icbc.timelineEnabled && icbc.timelineDate && (
              <Timeline
                startDate={icbc.crashDateRange.start}
                endDate={icbc.crashDateRange.end}
                currentDate={icbc.timelineDate}
                onDateChange={icbc.setTimelineDate}
                onClose={icbc.handleTimelineDisable}
                granularity="year"
                bucketCounts={icbc.yearCounts}
                compactBars
                overflowBuckets
                percentChangeMode={{ enabled: true, label: 'YoY' }}
                windowMode={{
                  size: icbc.timelineWindowSize,
                  onSizeChange: icbc.setTimelineWindowSize,
                  options: ICBC_TIMELINE_WINDOW_OPTIONS,
                }}
              />
            )}

            {activeTab === 'water' && water.timelineEnabled && water.timelineDate && (
              <Timeline
                startDate={water.sampleDateRange.start}
                endDate={water.sampleDateRange.end}
                currentDate={water.timelineDate}
                onDateChange={water.setTimelineDate}
                onClose={water.handleTimelineDisable}
                bucketCounts={water.bucketCounts}
                compactBars
                overflowBuckets
                windowMode={{
                  size: water.timelineWindowSize,
                  onSizeChange: water.setTimelineWindowSize,
                  options: WATER_TIMELINE_WINDOW_OPTIONS,
                }}
                statsLabel={`${water.filteredSamples.length.toLocaleString()} sample rows`}
              />
            )}

            {activeTab === 'canue' && canueTimelineActive && canueTimelineDateRange && canueTimelineDate && (
              <Timeline
                startDate={canueTimelineDateRange.start}
                endDate={canueTimelineDateRange.end}
                currentDate={canueTimelineDate}
                onDateChange={handleCanueTimelineDateChange}
                onClose={handleCanueTimelineDisable}
                granularity={canueTimelineIsMonthly ? 'month' : 'year'}
                bucketCounts={canueTimelineBucketCounts}
                compactBars
                overflowBuckets
                percentChangeMode={{ enabled: !canueTimelineIsMonthly, label: 'YoY' }}
                windowMode={{
                  size: canueTimelineWindowSize,
                  onSizeChange: setCanueTimelineWindowSize,
                  options: CANUE_TIMELINE_WINDOW_OPTIONS.map((option) => ({
                    ...option,
                    label:
                      option.value === -1 ? option.label : `${option.value} ${canueTimelineIsMonthly ? 'mo' : 'yr'}`,
                  })),
                }}
                statsLabel={
                  canueTimelinePrefetch.loading
                    ? `Loading timeline ${canueTimelinePrefetch.loaded}/${canueTimelinePrefetch.total} | ${activeCanueBoundaryData.validBoundaryCount.toLocaleString()} areas`
                    : `${activeCanueBoundaryData.validBoundaryCount.toLocaleString()} areas with values`
                }
              />
            )}

            {activeTab === 'canue' && showCanueGraphs && canueGraphsAvailable && (
              <CanueGraphDrawer
                rows={activeCanueGraphRows}
                options={canueGraphVariableOptions}
                selectedKeys={selectedCanueGraphKeys}
                selectedBoundaryId={selectedCanueBoundaryId}
                boundaryLevelLabel={canueBoundaryConfig.label}
                loading={activeCanueBoundaryData.loading}
                elevated={canueTimelineActive}
                onToggleVariable={handleCanueGraphVariableToggle}
                onClose={() => setShowCanueGraphs(false)}
              />
            )}

            <MapLegendPanel
              title={MISC_LEGEND_TITLES[activeTab]}
              icon={<Layers className="h-3.5 w-3.5" />}
              collapsible
              collapsed={!showMobileLegend}
              onCollapsedChange={(collapsed) => setShowMobileLegend(!collapsed)}
              contentClassName="space-y-1"
              elevated={
                (activeTab === 'wars' && wars.timelineEnabled) ||
                (activeTab === 'icbc' && icbc.timelineEnabled) ||
                (activeTab === 'water' && water.timelineEnabled) ||
                (activeTab === 'canue' && canueTimelineActive)
              }
              width="sm"
              className={cn('w-[min(16.5rem,calc(100vw-2rem))] md:w-auto')}
            >
              {activeTab === 'heatShade' && (
                <div className="w-full space-y-1 text-xs text-muted-foreground md:w-56">
                  {MISC_LAYERS.map((layer) => (
                    <LegendItem
                      key={layer.id}
                      color={layer.color}
                      label={layer.label}
                      active={activeLayers.includes(layer.id)}
                      swatchShape={layer.id === 'forests' ? 'square' : 'circle'}
                      onClick={() => toggleLayer(layer.id)}
                    />
                  ))}
                </div>
              )}
              {activeTab === 'canue' && (
                <div className="w-full space-y-2 text-xs text-muted-foreground md:w-56">
                  <div>
                    <div className="flex items-center justify-between gap-2 px-1 py-0.5 text-[10px]">
                      <span className="truncate text-foreground">
                        {selectedCanueV2Selection
                          ? renderCanueDisplayLabel(getCanueV2VariableLabel(selectedCanueV2Selection))
                          : selectedCanueFile
                            ? renderCanueDisplayLabel(
                                getCanueVariableLabel(selectedCanueFile, selectedCanueVariable ?? ''),
                              )
                            : 'CANUE boundary layer'}
                      </span>
                      {activeCanueBoundaryData.loading && (
                        <span className="shrink-0 text-muted-foreground">Loading</span>
                      )}
                    </div>
                    <MapGradientLegendItem
                      className="mt-1 px-1"
                      colors={['#67e8f9', '#fde047', '#ef4444']}
                      minLabel={formatNullableNumber(activeCanueBoundaryData.minValue ?? selectedCanueV2Selection?.min)}
                      maxLabel={formatNullableNumber(activeCanueBoundaryData.maxValue ?? selectedCanueV2Selection?.max)}
                    />
                  </div>
                </div>
              )}
              {activeTab === 'network' && (
                <div className="w-full space-y-1 text-xs text-muted-foreground md:w-56">
                  <LegendItem color="#0f766e" label="CRTC/NRCan vector coverage" active swatchShape="square" />
                  <LegendItem color="#64748b" label="ISED site points" active />
                  <LegendItem color="#f97316" label="Carrier raster-only caveat" active swatchShape="square" />
                </div>
              )}
              {activeTab === 'ev' && (
                <div className="w-full space-y-1 text-xs text-muted-foreground md:w-56">
                  <LegendItem color="#22c55e" label="EV charging station density" active />
                  <LegendItem color="#0ea5e9" label="Station and port CSV exports" active swatchShape="square" />
                </div>
              )}
              {activeTab === 'icbc' && <IcbcLegend icbc={icbc} />}
              {activeTab === 'wars' && <WarsLegend wars={wars} />}
              {activeTab === 'walkability' && <WalkabilityLegend walkability={walkability} />}
              {activeTab === 'water' && <WaterLegend water={water} />}
              {activeTab === 'flood' && <FloodLegend flood={flood} />}
              {activeTab === 'bcer' && <BcerLegend bcer={bcer} />}
            </MapLegendPanel>
          </div>
        </MapSectionLayout>
      </div>
    </div>
  )
}
