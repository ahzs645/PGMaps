import { useCallback, useEffect, useMemo, useState } from 'react'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useSearchParams } from 'react-router-dom'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import { Layers, Satellite, Trees } from 'lucide-react'
import { numberColumn, textColumn } from '@/components/map/tableColumns'
import {
  MapTableBridge,
  defineTableSource,
  useMapTable,
  useMapTableState,
  type MapTableOptions,
  type MapTableSource,
} from '@/components/map/useMapTable'
import { Map as PgMap, MapClusterLayer, MapMarker, MapPopup, MapScaleBar, MarkerContent } from '@/components/ui/map'
import { MapFillLayer, MapHeatmapLayer } from '@/components/ui/map-layers'
import { SectionTabsBar } from '@/components/layout/SectionTabsBar'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { MobileFeatureCard, ResponsiveFeatureDetail } from '@/components/ui/mobile-feature-card'
import { PG_CENTER } from '@/components/ui/map-styles'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { DatasetInfo } from '@/components/DatasetInfo'
import {
  getDefaultLevelForSource,
  getLevelOptionsForSource,
  isValidLevelForSource,
  useStudyAreaRegions,
  type BoundarySource,
  type RegionLevel,
  type StudyAreaRegion,
} from '@/lib/studyArea'
import {
  InlineAlert,
  KeyValueRows,
  LegendItem,
  MapGradientLegendItem,
  MapLegendPanel,
  MapSidebarShell,
  MapSwatch,
  SidebarSection,
  ToggleChip,
} from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { ToggleRow } from '@/components/ui/toggle-row'
import { DATASETS } from '@/lib/dataCatalog'
import { featureCenter, featuresBounds } from '@/lib/featureBounds'
import { DEFAULT_LOCALE, formatNumber } from '@/lib/format'
import {
  useHeatShadeData,
  type HeatShadeFacility,
  type HeatShadeTree,
} from '@/maps/scorebuilder/hooks/useHeatShadeData'
import { formatDate, formatNullableNumber, useJsonManifest } from './shared'
import {
  NetworkAvailabilitySidebar,
  networkAvailabilityTooltipHtml,
  useNetworkAvailabilityLayer,
  type NetworkAvailabilityManifest,
} from './networkAvailability'
import {
  EV_STATION_COLUMNS,
  EvChargingSidebar,
  evStationRowId,
  type EvChargingBoundarySummary,
  type EvChargingFeature,
  type EvChargingFeatureCollection,
  type EvChargingManifest,
  type EvChargingSummaryStats,
} from './evCharging'
import { CanueGraphDrawer, MobileCanueBoundaryFeatureCard } from './CanueGraphDrawer'
import { CanueGridLayers } from './CanueGridLayers'
import { CanueSidebar } from './CanueSidebar'
import { useCanueController } from './useCanueController'
import { MISC_LEGEND_TITLES, MISC_TABS, parseMiscDataTab, type MiscDataTab } from './miscDataTabs'
import {
  CANUE_TIMELINE_WINDOW_OPTIONS,
  MISC_LAYERS,
  CANUE_BOUNDARY_FILL_OPACITY,
  CANUE_SCALE_COLORS,
  getCanueV2VariableLabel,
  getCanueVariableLabel,
  renderCanueDisplayLabel,
  type MiscLayerId,
} from './canueCore'
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
import { DEFAULT_WARS_HEATMAP, serializeWarsHeatmapSettings } from './WarsHeatmapControls'
import {
  OPEN_LITTER_TIMELINE_WINDOW_OPTIONS,
  formatLitterName,
  MobileOpenLitterMapFeatureCard,
  OpenLitterMapLayer,
  OpenLitterMapLayerControls,
  OpenLitterMapLegend,
  OpenLitterMapSidebar,
  OpenLitterMapSourceNotes,
  useOpenLitterMapData,
} from './openLitterMap'
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
import { RemediationSection } from '@/maps/remediation/RemediationSection'
import { ParcelMapSection } from '@/maps/parcelmap/ParcelMapSection'
import { CensusSection } from '@/maps/census'
import { CANUE_V2_ENABLED, type CanueVariableSelection } from './canueV2'

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

/** What a tab gives the one table this section shares. Empty `tableSources` means no table. */
interface MiscTabTable {
  tableSources: readonly MapTableSource[]
  selectedTableRowId?: string | null
  selectTableRow?: MapTableOptions['onSelectRow']
}

type CanueBoundaryRow = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>

const NO_TAB_TABLE: MiscTabTable = { tableSources: [] }

// Some tabs' chips are too wide to sit beside the title, so the header row wraps them under it.
const MISC_HEADER_CLASS = '[&>div]:flex-wrap [&>div]:items-center [&>div>div:last-child]:shrink'

// Each one is a DOM marker, so these keep the map responsive. The table lists every row.
const MAX_DRAWN_TREES = 900
const MAX_DRAWN_FACILITIES = 350

const HEAT_TREE_COLUMNS = [
  textColumn<HeatShadeTree>('name', 'Species', (tree) => tree.commonName, { width: 220 }),
  numberColumn<HeatShadeTree>('dbh', 'Trunk diameter', (tree) => tree.dbh, { format: String }),
  numberColumn<HeatShadeTree>('age', 'Tree age', (tree) => tree.treeAge, { format: String }),
  textColumn<HeatShadeTree>('id', 'Tree ID', (tree) => tree.id, { defaultHidden: true }),
]

const HEAT_FACILITY_COLUMNS = [
  textColumn<HeatShadeFacility>('name', 'Facility', (facility) => facility.name, { width: 260 }),
  textColumn<HeatShadeFacility>('kind', 'Kind', (facility) =>
    facility.kind === 'responseFacility' ? 'Response facility' : 'Community facility',
  ),
  textColumn<HeatShadeFacility>('status', 'Status', (facility) => facility.status),
]

function evStationRows(station: EvChargingFeature) {
  return [
    { label: 'Network', value: station.properties?.network || 'Unknown' },
    { label: 'Connectors', value: station.properties?.connectors || 'Unknown' },
    { label: 'Level 2', value: station.properties?.level2 ?? 0 },
    { label: 'DC fast', value: station.properties?.dcFast ?? 0 },
  ]
}

function evStationLocation(station: EvChargingFeature) {
  return [station.properties?.city, station.properties?.province].filter(Boolean).join(', ')
}

function MobileEvStationFeatureCard({ station, onClose }: { station: EvChargingFeature; onClose: () => void }) {
  return (
    <MobileFeatureCard
      cardKey={station.properties?.id ?? station.properties?.name}
      title={station.properties?.name || 'EV charging station'}
      subtitle={evStationLocation(station) || station.properties?.network || 'EV charging'}
      onClose={onClose}
    >
      <div className="rounded-md border border-border bg-background p-3 text-foreground">
        <KeyValueRows rows={evStationRows(station)} />
      </div>
    </MobileFeatureCard>
  )
}

const NO_CANUE_SELECTIONS: readonly CanueVariableSelection[] = []
const NO_CANUE_FEATURE_STATE: Record<string, { value: number | null }> = {}

function EvChargingLegend({
  showPoints,
  showHeatmap,
  showBoundaries,
}: {
  showPoints: boolean
  showHeatmap: boolean
  showBoundaries: boolean
}) {
  return (
    <div className="w-full space-y-2 text-xs text-muted-foreground">
      {showPoints && (
        <div className="space-y-1">
          <LegendItem color="#0ea5e9" label="Stations and small clusters" active />
          <LegendItem color="#22c55e" label="25-124 station clusters" active />
          <LegendItem color="#f97316" label="125+ station clusters" active />
        </div>
      )}
      {showHeatmap && (
        <div className="space-y-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
          <div className="px-1 text-xs font-medium text-foreground">Station density</div>
          <MapGradientLegendItem
            className="px-1"
            colors={['#67e8f9', '#22c55e', '#fde047', '#f97316']}
            minLabel="Low"
            maxLabel="High"
          />
        </div>
      )}
      {showBoundaries && (
        <div className="space-y-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
          <div className="px-1 text-xs font-medium text-foreground">Regional station density</div>
          <MapGradientLegendItem
            className="px-1"
            colors={['#e0f2fe', '#38bdf8', '#0369a1']}
            minLabel="Low"
            maxLabel="High"
          />
        </div>
      )}
    </div>
  )
}

type EvBoundaryFeatureProperties = EvChargingBoundarySummary &
  Record<string, unknown> & {
    code: string
    name: string
    metricValue: number
  }

type EvBoundaryFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  EvBoundaryFeatureProperties
>

function getEvPortCount(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0
}

function summarizeEvChargingFeatures(
  features: EvChargingFeature[],
  totalStationCount: number,
  areaKm2: number | null,
): EvChargingSummaryStats {
  const networkCounts = new Map<string, number>()
  let level2Ports = 0
  let dcFastPorts = 0
  let level2StationCount = 0
  let dcFastStationCount = 0

  for (const feature of features) {
    const level2 = getEvPortCount(feature.properties?.level2)
    const dcFast = getEvPortCount(feature.properties?.dcFast)
    level2Ports += level2
    dcFastPorts += dcFast
    if (level2 > 0) level2StationCount += 1
    if (dcFast > 0) dcFastStationCount += 1

    const network = feature.properties?.network?.trim() || 'Unknown'
    networkCounts.set(network, (networkCounts.get(network) ?? 0) + 1)
  }

  let topNetwork = 'n/a'
  let topNetworkCount = 0
  for (const [network, count] of networkCounts) {
    if (count > topNetworkCount) {
      topNetwork = network
      topNetworkCount = count
    }
  }

  const totalPorts = level2Ports + dcFastPorts
  return {
    stationCount: features.length,
    stationSharePercent: totalStationCount > 0 ? (features.length / totalStationCount) * 100 : 0,
    level2Ports,
    dcFastPorts,
    totalPorts,
    level2StationCount,
    dcFastStationCount,
    dcFastPortPercent: totalPorts > 0 ? (dcFastPorts / totalPorts) * 100 : 0,
    densityPer1000Km2: areaKm2 && areaKm2 > 0 ? (features.length / areaKm2) * 1000 : null,
    areaKm2,
    topNetwork,
    topNetworkCount,
  }
}

function getEvStationsInRegion(features: EvChargingFeature[], region: StudyAreaRegion): EvChargingFeature[] {
  return features.filter((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates
    if (
      longitude < region.bounds[0] ||
      longitude > region.bounds[2] ||
      latitude < region.bounds[1] ||
      latitude > region.bounds[3]
    ) {
      return false
    }

    return booleanPointInPolygon(point([longitude, latitude]), region.feature)
  })
}

export default function MiscDataSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const isMobileViewport = useIsMobile()
  const activeTab = parseMiscDataTab(searchParams.get('tab'))
  const setActiveTab = useCallback(
    (tab: MiscDataTab) => {
      const params = new URLSearchParams(searchParams)
      if (tab === 'canue') params.delete('tab')
      else params.set('tab', tab)
      // An open table belongs to the tab it was opened on.
      params.delete('table')
      params.delete('row')
      setSearchParams(params)
    },
    [searchParams, setSearchParams],
  )
  const [activeLayers, setActiveLayers] = useState<MiscLayerId[]>(['trees', 'forests', 'facilities'])
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
  const [selectedEvBoundaryId, setSelectedEvBoundaryId] = useState<string | null>(null)
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
    canueTimelineSelections,
    canueTimelineGridScale,
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
    canueBoundaryShapes,
    renderedCanueFeatureState,
    renderedCanueFillColor,
    canueMapCenter,
    canueMapZoom,
    mapLoadingCanue,
    handleCanueBoundarySourceChange,
    handleCanueGraphVariableToggle,
  } = useCanueController({ activeTab, searchParams })
  const canueBoundaryAreaCount = canueBoundaryShapes?.features.length ?? 0
  const canueAreasWithValuesLabel = `${activeCanueBoundaryData.validBoundaryCount.toLocaleString()} of ${canueBoundaryAreaCount.toLocaleString()} areas`
  const canueNoValueAreaCount =
    showCanueBoundaries && !activeCanueBoundaryData.loading
      ? Math.max(canueBoundaryAreaCount - activeCanueBoundaryData.validBoundaryCount, 0)
      : 0
  const canueSharedScale = showCanueBoundaries ? canueTimelinePrefetch.scale : canueTimelineGridScale
  const { trees, forests, facilities, loading, error } = useHeatShadeData(activeTab === 'heatShade')
  const heatShadeManifest = useJsonManifest<HeatShadeManifest>(
    activeTab === 'heatShade' ? '/data/heat-shade/manifest.json' : null,
  )
  const networkAvailabilityManifest = useJsonManifest<NetworkAvailabilityManifest>(
    activeTab === 'network' ? '/data/network-availability/manifest.json' : null,
  )
  const networkAvailabilityLayer = useNetworkAvailabilityLayer(
    activeTab === 'network',
    networkAvailabilityManifest.data?.generatedAt,
  )
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
    searchParams.get('warsHotspots'),
    searchParams.get('warsWinterRange'),
    searchParams.get('warsWinterRangeMode'),
    searchParams.get('warsHeatmapOptions'),
  )
  const openLitterMap = useOpenLitterMapData(
    activeTab === 'openLitterMap',
    searchParams.get('litterCategory'),
    searchParams.get('litterPoints'),
    searchParams.get('litterHeatmap'),
    searchParams.get('litterHexes'),
    searchParams.get('litterObject'),
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
    const heatmapOptions = serializeWarsHeatmapSettings(wars.heatmapSettings)
    if (activeTab === 'wars' && heatmapOptions !== serializeWarsHeatmapSettings(DEFAULT_WARS_HEATMAP)) {
      params.set('warsHeatmapOptions', heatmapOptions)
    } else {
      params.delete('warsHeatmapOptions')
    }
    if (activeTab === 'wars' && wars.showHotspots) params.set('warsHotspots', '1')
    else params.delete('warsHotspots')
    if (activeTab === 'wars' && wars.showWinterRange) params.set('warsWinterRange', '1')
    else params.delete('warsWinterRange')
    if (
      activeTab !== 'wars' ||
      (searchParams.get('warsWinterRangeMode') !== 'inline' && searchParams.get('warsWinterRangeMode') !== 'blob')
    ) {
      params.delete('warsWinterRangeMode')
    }
    if (activeTab === 'openLitterMap' && openLitterMap.selectedCategory !== 'all') {
      params.set('litterCategory', openLitterMap.selectedCategory)
    } else {
      params.delete('litterCategory')
    }
    if (activeTab === 'openLitterMap' && openLitterMap.selectedObject !== 'all') {
      params.set('litterObject', openLitterMap.selectedObject)
    } else {
      params.delete('litterObject')
    }
    if (activeTab === 'openLitterMap' && !openLitterMap.showPoints) params.set('litterPoints', '0')
    else params.delete('litterPoints')
    if (activeTab === 'openLitterMap' && openLitterMap.showHeatmap) params.set('litterHeatmap', '1')
    else params.delete('litterHeatmap')
    if (activeTab === 'openLitterMap' && openLitterMap.showHexes) params.set('litterHexes', '1')
    else params.delete('litterHexes')
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
    wars.heatmapSettings,
    wars.showPoints,
    wars.showHotspots,
    wars.showWinterRange,
    wars.selectedSpecies,
    openLitterMap.selectedCategory,
    openLitterMap.selectedObject,
    openLitterMap.showHeatmap,
    openLitterMap.showHexes,
    openLitterMap.showPoints,
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

  const visibleTrees = useMemo(() => trees.slice(0, MAX_DRAWN_TREES), [trees])
  const visibleFacilities = useMemo(() => facilities.slice(0, MAX_DRAWN_FACILITIES), [facilities])
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
  const allEvStationFeatures = useMemo(
    () => (evChargingStations.data?.features ?? []) as EvChargingFeature[],
    [evChargingStations.data?.features],
  )
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
    if (activeEvStudyAreaRegions.length === 0 || !evStudyAreaBounds) {
      return { type: 'FeatureCollection', features: allEvStationFeatures }
    }

    const filtered = allEvStationFeatures.filter((feature) => {
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
  }, [activeEvStudyAreaRegions, allEvStationFeatures, evStudyAreaBounds])
  const evCurrentScopeAreaKm2 = useMemo(
    () =>
      activeEvStudyAreaRegions.length > 0
        ? activeEvStudyAreaRegions.reduce((sum, region) => sum + region.areaKm2, 0)
        : null,
    [activeEvStudyAreaRegions],
  )
  const evSummaryStats = useMemo(
    () => summarizeEvChargingFeatures(filteredEvStations.features, allEvStationFeatures.length, evCurrentScopeAreaKm2),
    [allEvStationFeatures.length, evCurrentScopeAreaKm2, filteredEvStations.features],
  )
  const evStudyAreaFeatureCollection = useMemo<EvBoundaryFeatureCollection | null>(() => {
    if (activeEvStudyAreaRegions.length === 0) return null
    return {
      type: 'FeatureCollection',
      features: activeEvStudyAreaRegions.map((region) => {
        const stations = getEvStationsInRegion(allEvStationFeatures, region)
        const summary = summarizeEvChargingFeatures(stations, allEvStationFeatures.length, region.areaKm2)
        const boundaryId = region.code
        const boundaryName = region.name
        const properties: EvBoundaryFeatureProperties = {
          ...(region.feature.properties ?? {}),
          ...summary,
          id: boundaryId,
          code: boundaryId,
          name: boundaryName,
          boundaryId,
          boundaryName,
          metricValue: summary.densityPer1000Km2 ?? 0,
        }

        return {
          ...region.feature,
          id: boundaryId,
          properties,
        }
      }),
    }
  }, [activeEvStudyAreaRegions, allEvStationFeatures])
  const evBoundaryMaxDensity = useMemo(
    () =>
      Math.max(1, ...(evStudyAreaFeatureCollection?.features ?? []).map((feature) => feature.properties.metricValue)),
    [evStudyAreaFeatureCollection],
  )
  const selectedEvBoundary = useMemo(
    () =>
      selectedEvBoundaryId && evStudyAreaFeatureCollection
        ? (evStudyAreaFeatureCollection.features.find(
            (feature) => feature.properties.boundaryId === selectedEvBoundaryId,
          )?.properties ?? null)
        : null,
    [evStudyAreaFeatureCollection, selectedEvBoundaryId],
  )
  const handleEvBoundarySourceChange = useCallback((source: BoundarySource) => {
    setEvShowBoundaries(true)
    setEvBoundarySource(source)
    setEvRegionLevel((current) => (isValidLevelForSource(source, current) ? current : getDefaultLevelForSource(source)))
    setSelectedEvBoundaryId(null)
  }, [])

  const handleEvBoundaryLevelChange = useCallback((level: RegionLevel) => {
    setEvShowBoundaries(true)
    setEvRegionLevel(level)
    setSelectedEvBoundaryId(null)
  }, [])

  const handleEvClearBoundaries = useCallback(() => {
    setEvShowBoundaries(false)
    setSelectedEvBoundaryId(null)
  }, [])

  const evTable = useMemo<MiscTabTable>(
    () => ({
      tableSources: [
        defineTableSource<EvChargingFeature>({
          id: 'ev-stations',
          label: 'Charging stations',
          color: '#0ea5e9',
          shape: 'point',
          rows: filteredEvStations.features as EvChargingFeature[],
          columns: EV_STATION_COLUMNS,
          getRowId: evStationRowId,
          getRowCenter: (station) => [station.geometry.coordinates[0], station.geometry.coordinates[1]],
          status: evChargingStations.error ? 'error' : evChargingStations.data ? 'ready' : 'loading',
        }),
      ],
      selectedTableRowId: selectedEvStation ? evStationRowId(selectedEvStation) : null,
      selectTableRow: (station: EvChargingFeature) => setSelectedEvStation(station),
    }),
    [evChargingStations.data, evChargingStations.error, filteredEvStations.features, selectedEvStation],
  )
  // No selection on this tab, so a row only flies to its tree or facility.
  const heatTable = useMemo<MiscTabTable>(() => {
    const status = error ? 'error' : loading ? 'loading' : 'ready'
    return {
      tableSources: [
        ...(activeLayers.includes('trees')
          ? [
              defineTableSource<HeatShadeTree>({
                id: 'heat-trees',
                label: 'Trees',
                color: MISC_LAYERS[0].color,
                shape: 'point',
                rows: trees,
                columns: HEAT_TREE_COLUMNS,
                getRowId: (tree) => tree.id,
                getRowCenter: (tree) => [tree.longitude, tree.latitude],
                status,
              }),
            ]
          : []),
        ...(activeLayers.includes('facilities')
          ? [
              defineTableSource<HeatShadeFacility>({
                id: 'heat-facilities',
                label: 'Cooling facilities',
                color: MISC_LAYERS[2].color,
                shape: 'point',
                rows: facilities,
                columns: HEAT_FACILITY_COLUMNS,
                getRowId: (facility) => `${facility.kind}:${facility.id}`,
                getRowCenter: (facility) => [facility.longitude, facility.latitude],
                status,
              }),
            ]
          : []),
      ],
    }
  }, [activeLayers, error, facilities, loading, trees])
  const canueTable = useMemo<MiscTabTable>(() => {
    if (!showCanueBoundaries || !renderedCanueBoundaryLayer) return NO_TAB_TABLE
    const { data, property } = renderedCanueBoundaryLayer
    const rowId = (boundary: CanueBoundaryRow) => String(boundary.properties?.boundaryId ?? boundary.id)
    const value = (boundary: CanueBoundaryRow) => {
      const raw = boundary.properties?.[property]
      return raw == null ? null : Number(raw)
    }
    return {
      tableSources: [
        defineTableSource<CanueBoundaryRow>({
          id: 'canue-boundaries',
          label: 'CANUE boundaries',
          color: '#0e7490',
          shape: 'fill',
          rows: data.features,
          columns: [
            textColumn<CanueBoundaryRow>('boundary', 'Boundary', (boundary) => boundary.properties?.boundaryName, {
              width: 240,
            }),
            numberColumn<CanueBoundaryRow>(
              'value',
              selectedCanueV2Selection
                ? getCanueV2VariableLabel(selectedCanueV2Selection)
                : selectedCanueFile
                  ? getCanueVariableLabel(selectedCanueFile, selectedCanueVariable ?? '')
                  : 'Value',
              value,
              { width: 180 },
            ),
            numberColumn<CanueBoundaryRow>('records', 'Records', (boundary) => boundary.properties?.rowCount),
          ],
          getRowId: rowId,
          getRowCenter: featureCenter,
          getRowBounds: (boundary) => featuresBounds([boundary]),
          flyZoom: 9,
        }),
      ],
      selectedTableRowId: selectedCanueBoundaryId,
      selectTableRow: (boundary: CanueBoundaryRow) => setSelectedCanueBoundaryId(rowId(boundary)),
    }
  }, [
    renderedCanueBoundaryLayer,
    selectedCanueBoundaryId,
    selectedCanueFile,
    selectedCanueV2Selection,
    selectedCanueVariable,
    setSelectedCanueBoundaryId,
    showCanueBoundaries,
  ])
  // Network has only dissolved polygons, and the tabs with their own layout set up their own table.
  const tabTables: Partial<Record<MiscDataTab, MiscTabTable>> = {
    heatShade: heatTable,
    canue: canueTable,
    ev: evTable,
    icbc,
    wars,
    openLitterMap,
    walkability,
    water,
    flood,
    bcer,
  }
  const tabTable = tabTables[activeTab] ?? NO_TAB_TABLE
  const tableState = useMapTableState()
  const table = useMapTable({
    sources: tabTable.tableSources,
    state: tableState,
    // A tab's selection is a row of its first source; Water's other sources point at facilities.
    selectedRowId: tableState.activeId === tabTable.tableSources[0]?.id ? tabTable.selectedTableRowId : undefined,
    onSelectRow: tabTable.selectTableRow,
  })

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
      {activeTab === 'network' && !networkAvailabilityLayer.data && !networkAvailabilityLayer.error && (
        <p>Loading CRTC LTE/5G coverage snapshot...</p>
      )}
      {activeTab === 'network' && networkAvailabilityLayer.error && <p>{networkAvailabilityLayer.error}</p>}
      {activeTab === 'ev' && <p>EV charging inventory updated {formatDate(evChargingManifest.data?.generatedAt)}.</p>}
      {activeTab === 'ev' && evChargingStations.error && <p>{evChargingStations.error}</p>}
      {activeTab === 'icbc' && <IcbcSourceNotes icbc={icbc} />}
      {activeTab === 'wars' && <WarsSourceNotes wars={wars} />}
      {activeTab === 'openLitterMap' && <OpenLitterMapSourceNotes litter={openLitterMap} />}
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
              : activeTab === 'openLitterMap'
                ? 'OpenLitterMap'
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
          ? evBoundarySource === 'census' || evBoundarySource === 'cityCommunity' || evBoundarySource === 'cityPG'
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
              : activeTab === 'openLitterMap'
                ? !openLitterMap.points.data && !openLitterMap.points.error
                : activeTab === 'bcer'
                  ? bcer.loading
                  : false
  // A legend explains what is drawn, so it goes once nothing is. Heat & shade,
  // flood, BCER and water stay: their legend rows are the layers' own toggles.
  const showLegendPanel =
    activeTab === 'ev'
      ? evShowPoints || evShowHeatmap || evShowBoundaries
      : activeTab === 'icbc'
        ? icbc.showPoints || icbc.showHeatmap
        : activeTab === 'wars'
          ? wars.showPoints || wars.showHeatmap || wars.showHotspots || wars.showWinterRange
          : activeTab === 'openLitterMap'
            ? openLitterMap.showPoints || openLitterMap.showHeatmap || openLitterMap.showHexes
            : true

  const sidebarActions =
    activeTab === 'ev' ? (
      <div className="flex flex-wrap gap-2">
        <ToggleChip active={evShowPoints} onClick={() => setEvShowPoints((current) => !current)} tone="sky">
          {evShowPoints ? 'Hide points' : 'Show points'}
        </ToggleChip>
        <ToggleChip active={evShowHeatmap} onClick={() => setEvShowHeatmap((current) => !current)} tone="orange">
          Heatmap
        </ToggleChip>
      </div>
    ) : activeTab === 'icbc' ? (
      <IcbcLayerControls icbc={icbc} />
    ) : activeTab === 'wars' ? (
      <WarsLayerControls wars={wars} />
    ) : activeTab === 'openLitterMap' ? (
      <OpenLitterMapLayerControls litter={openLitterMap} />
    ) : activeTab === 'water' ? (
      <WaterLayerControls water={water} />
    ) : activeTab === 'flood' ? (
      <FloodLayerControls flood={flood} />
    ) : activeTab === 'bcer' ? (
      <BcerLayerControls bcer={bcer} />
    ) : undefined

  const sidebar = (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title={activeMapTitle}
      actions={sidebarActions}
      headerClassName={MISC_HEADER_CLASS}
      metadata={
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
                      : activeTab === 'openLitterMap'
                        ? DATASETS.openLitterMap
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
                        : activeTab === 'openLitterMap'
                          ? openLitterMap.manifest.data?.generatedAt
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
      }
    >
      {activeTab === 'heatShade' && (
        <>
          <SidebarSection title="Map Layers">
            <div className="space-y-2">
              {MISC_LAYERS.map((layer) => (
                <ToggleRow
                  key={layer.id}
                  tone="primary"
                  active={activeLayers.includes(layer.id)}
                  onClick={() => toggleLayer(layer.id)}
                  leading={<MapSwatch color={layer.color} active={activeLayers.includes(layer.id)} />}
                  label={layer.label}
                  trailing={
                    <span className="tabular-nums">
                      {formatNumber(
                        layer.id === 'trees'
                          ? trees.length
                          : layer.id === 'forests'
                            ? forests.length
                            : facilities.length,
                      )}
                    </span>
                  }
                />
              ))}
            </div>
            {loading && (
              <InlineAlert loading className="mt-3">
                Loading heat and shade data...
              </InlineAlert>
            )}
            {error && (
              <InlineAlert tone="error" className="mt-3">
                {error}
              </InlineAlert>
            )}
          </SidebarSection>

          <SidebarSection title="Heat, Shade, and Canopy" icon={Trees} iconClassName="text-green-600">
            <StatGroup
              variant="tiles"
              size="sm"
              columns={3}
              items={[
                { label: 'tree points', value: formatNumber(trees.length) },
                { label: 'forest areas', value: formatNumber(forests.length) },
                { label: 'facilities', value: formatNumber(facilities.length) },
              ]}
            />
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Tree points are shown as a canopy and shade proxy until a full canopy raster or canopy polygon layer is
              available.
            </p>
            {(trees.length > MAX_DRAWN_TREES || facilities.length > MAX_DRAWN_FACILITIES) && (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                The map draws the first {formatNumber(visibleTrees.length)} trees and{' '}
                {formatNumber(visibleFacilities.length)} facilities. The table lists all of them.
              </p>
            )}
          </SidebarSection>

          <SidebarSection title="Remote Sensing Queue" icon={Satellite} iconClassName="text-violet-600">
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium text-foreground">{landsatSource?.name ?? 'Landsat warm-season scenes'}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {landsatSource?.sceneCount ?? 0} scenes
                {landsatSource?.years?.length ? ` across ${landsatSource.years.join(', ')}` : ''}
              </div>
            </div>
          </SidebarSection>
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

      {activeTab === 'network' && (
        <NetworkAvailabilitySidebar manifest={networkAvailabilityManifest} layer={networkAvailabilityLayer} />
      )}

      {activeTab === 'ev' && (
        <EvChargingSidebar
          manifest={evChargingManifest}
          summaryStats={evSummaryStats}
          selectedBoundary={selectedEvBoundary}
          boundariesVisible={evShowBoundaries}
          boundarySource={evBoundarySource}
          selectedRegionLevel={evRegionLevel}
          regionLevelOptions={evRegionLevelOptions}
          boundaryLoading={evShowBoundaries && evBoundaryLoading}
          boundaryError={evShowBoundaries ? evBoundaryError : null}
          onBoundarySourceChange={handleEvBoundarySourceChange}
          onClearBoundaries={handleEvClearBoundaries}
          onClearSelectedBoundary={() => setSelectedEvBoundaryId(null)}
          onRegionLevelChange={handleEvBoundaryLevelChange}
        />
      )}

      {activeTab === 'icbc' && <IcbcSidebar icbc={icbc} />}

      {activeTab === 'wars' && <WarsSidebar wars={wars} />}

      {activeTab === 'openLitterMap' && <OpenLitterMapSidebar litter={openLitterMap} />}

      {activeTab === 'walkability' && <WalkabilitySidebar walkability={walkability} />}

      {activeTab === 'water' && <WaterSidebar water={water} />}
      {activeTab === 'flood' && <FloodSidebar flood={flood} />}
      {activeTab === 'bcer' && <BcerSidebar bcer={bcer} />}
    </MapSidebarShell>
  )

  const tabsBar = <SectionTabsBar tabs={MISC_TABS} activeTab={activeTab} onTabChange={setActiveTab} />

  if (activeTab === 'drought' || activeTab === 'remediation' || activeTab === 'parcelmap' || activeTab === 'census') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        {tabsBar}
        <div className="min-h-0 flex-1">
          {activeTab === 'remediation' ? (
            <RemediationSection />
          ) : activeTab === 'parcelmap' ? (
            <ParcelMapSection />
          ) : activeTab === 'census' ? (
            <CensusSection />
          ) : (
            <DroughtSection yearParam="droughtYear" />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {tabsBar}
      <div className="min-h-0 flex-1">
        <MapSectionLayout
          table={table}
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
                          : activeTab === 'openLitterMap'
                            ? 'OpenLitterMap'
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
              <div className="truncate text-xs text-muted-foreground">
                {activeTab === 'canue'
                  ? `${selectedCanueDataset?.label || 'Dataset'} | ${canuePeriodLabel}`
                  : activeTab === 'network'
                    ? `${networkAvailabilityLayer.data?.features.length ?? 0} coverage features | ${networkAvailabilityManifest.data?.datasets.length ?? 0} sources`
                    : activeTab === 'ev'
                      ? `${filteredEvStations.features.length.toLocaleString(DEFAULT_LOCALE)} stations | ${evShowPoints ? 'points' : 'points off'}${evShowHeatmap ? ' + heatmap' : ''}`
                      : activeTab === 'icbc'
                        ? `${icbc.selectedDataset?.title || 'Crash locations'} | ${icbc.crashFeatures.length.toLocaleString(DEFAULT_LOCALE)} mapped`
                        : activeTab === 'wars'
                          ? `${wars.selectedSpecies === 'all' ? 'All species' : wars.selectedSpecies} | ${wars.filteredFeatures.length.toLocaleString(DEFAULT_LOCALE)} records`
                          : activeTab === 'openLitterMap'
                            ? `${openLitterMap.selectedCategory === 'all' ? 'All categories' : formatLitterName(openLitterMap.selectedCategory)}${openLitterMap.selectedObject === 'all' ? '' : ` › ${formatLitterName(openLitterMap.selectedObject)}`} | ${openLitterMap.filteredFeatures.length.toLocaleString(DEFAULT_LOCALE)} records`
                            : activeTab === 'walkability'
                              ? walkability.displayMode === 'heatmap'
                                ? `${walkability.selectedHeatmapVariant?.label || 'Citywide MI grid'}`
                                : `${walkability.selectedVariant?.label || 'Variant'} | ${walkability.features.length.toLocaleString(DEFAULT_LOCALE)} communities`
                              : activeTab === 'water'
                                ? `${water.facilities.length.toLocaleString(DEFAULT_LOCALE)} facilities | ${water.filteredSamples.length.toLocaleString(DEFAULT_LOCALE)} sample rows`
                                : activeTab === 'flood'
                                  ? `${flood.filteredStations.length.toLocaleString(DEFAULT_LOCALE)} stations | ${flood.highRiskCount.toLocaleString(DEFAULT_LOCALE)} above 2 year`
                                  : activeTab === 'bcer'
                                    ? `${bcer.filteredWells.length.toLocaleString(DEFAULT_LOCALE)} wells | ${bcer.horizontalCount.toLocaleString(DEFAULT_LOCALE)} horizontal`
                                    : `${trees.length.toLocaleString(DEFAULT_LOCALE)} trees | ${forests.length.toLocaleString(DEFAULT_LOCALE)} forests`}
              </div>
            </div>
          }
          mobileSidebar={
            activeTab === 'icbc' ? (
              <IcbcSidebar icbc={icbc} showSelectedLocation={false} />
            ) : activeTab === 'wars' ? (
              <WarsSidebar wars={wars} showSelectedRecord={false} />
            ) : activeTab === 'openLitterMap' ? (
              <OpenLitterMapSidebar litter={openLitterMap} showSelectedRecord={false} showLayerControls />
            ) : activeTab === 'walkability' ? (
              <WalkabilitySidebar walkability={walkability} showSelectedCommunity={false} />
            ) : undefined
          }
          sidebar={sidebar}
        >
          <div className="relative h-full">
            <PgMap key={mapKey} center={mapCenter} zoom={mapZoom} loading={mapLoading} deferResize={table.deferResize}>
              <MapTableBridge table={table} />
              <MapScaleBar position="bottom-left" className="max-md:hidden" />
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
                <CanueGridLayers
                  selection={selectedCanueV2Selection}
                  timelineSelections={canueTimelineActive ? canueTimelineSelections : NO_CANUE_SELECTIONS}
                  scale={canueTimelineGridScale}
                />
              )}

              {activeTab === 'canue' &&
                showCanueBoundaries &&
                renderedCanueBoundaryLayer &&
                canueBoundaryShapes &&
                canueBoundaryShapes.features.length > 0 && (
                  <MapFillLayer
                    data={canueBoundaryShapes}
                    featureState={renderedCanueFeatureState ?? NO_CANUE_FEATURE_STATE}
                    fillColor={renderedCanueFillColor}
                    fillOpacity={CANUE_BOUNDARY_FILL_OPACITY}
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
                  fillColor={['match', ['get', 'technology'], '5G', '#0f766e', 'LTE', '#2563eb', '#64748b']}
                  fillOpacity={0.56}
                  lineColor="#083344"
                  lineOpacity={0.18}
                  lineWidth={0.45}
                  hoverHtml={networkAvailabilityTooltipHtml}
                />
              )}

              {activeTab === 'ev' && evStudyAreaFeatureCollection && (
                <MapFillLayer
                  data={evStudyAreaFeatureCollection}
                  fillColor={[
                    'interpolate',
                    ['linear'],
                    ['coalesce', ['to-number', ['get', 'metricValue']], 0],
                    0,
                    '#e0f2fe',
                    evBoundaryMaxDensity * 0.5,
                    '#38bdf8',
                    evBoundaryMaxDensity,
                    '#0369a1',
                  ]}
                  fillOpacity={0.24}
                  lineColor="#0284c7"
                  lineWidth={1}
                  lineOpacity={0.7}
                  idProperty="boundaryId"
                  selectedId={selectedEvBoundaryId}
                  selectionColor="#0f172a"
                  selectionWidth={2}
                  onFeatureClick={(id) => setSelectedEvBoundaryId(selectedEvBoundaryId === id ? null : id)}
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

              {activeTab === 'ev' && selectedEvStation && (
                <ResponsiveFeatureDetail
                  popup={
                    <MapPopup
                      longitude={selectedEvStation.geometry.coordinates[0]}
                      latitude={selectedEvStation.geometry.coordinates[1]}
                      onClose={() => setSelectedEvStation(null)}
                    >
                      <MapPopupCard
                        className="min-w-48"
                        title={selectedEvStation.properties?.name || 'EV charging station'}
                        subtitle={evStationLocation(selectedEvStation)}
                        onClose={() => setSelectedEvStation(null)}
                      >
                        <KeyValueRows variant="grid" rows={evStationRows(selectedEvStation)} />
                      </MapPopupCard>
                    </MapPopup>
                  }
                  card={
                    <MobileEvStationFeatureCard
                      station={selectedEvStation}
                      onClose={() => setSelectedEvStation(null)}
                    />
                  }
                />
              )}

              {activeTab === 'walkability' && <WalkabilityLayer walkability={walkability} />}

              {activeTab === 'water' && <WaterLayer water={water} />}
              {activeTab === 'flood' && <FloodLayer flood={flood} />}
              {activeTab === 'bcer' && <BcerLayer bcer={bcer} isMobile={isMobileViewport} />}

              {activeTab === 'bcer' && isMobileViewport && bcer.selectedWell && <MobileBcerFeatureCard bcer={bcer} />}

              {activeTab === 'icbc' && <IcbcLayer icbc={icbc} />}

              {activeTab === 'icbc' && isMobileViewport && icbc.selectedCrash && <MobileIcbcFeatureCard icbc={icbc} />}

              {activeTab === 'wars' && <WarsLayer wars={wars} />}

              {activeTab === 'wars' && isMobileViewport && (wars.selectedCrash || wars.selectedWinterRange) && (
                <MobileWarsFeatureCard wars={wars} />
              )}

              {activeTab === 'openLitterMap' && <OpenLitterMapLayer litter={openLitterMap} />}

              {activeTab === 'openLitterMap' && isMobileViewport && openLitterMap.selectedFeature && (
                <MobileOpenLitterMapFeatureCard litter={openLitterMap} />
              )}

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
                onClose={wars.disableTimeline}
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

            {activeTab === 'openLitterMap' && openLitterMap.timelineEnabled && openLitterMap.timelineDate && (
              <Timeline
                startDate={openLitterMap.dateRange.start}
                endDate={openLitterMap.dateRange.end}
                currentDate={openLitterMap.timelineDate}
                onDateChange={openLitterMap.setTimelineDate}
                onClose={openLitterMap.disableTimeline}
                bucketCounts={openLitterMap.bucketCounts}
                compactBars
                overflowBuckets
                windowMode={{
                  size: openLitterMap.timelineWindowSize,
                  onSizeChange: openLitterMap.setTimelineWindowSize,
                  options: OPEN_LITTER_TIMELINE_WINDOW_OPTIONS,
                }}
                statsLabel={`${openLitterMap.filteredFeatures.length.toLocaleString(DEFAULT_LOCALE)} records`}
              />
            )}

            {activeTab === 'icbc' && icbc.timelineEnabled && icbc.timelineDate && (
              <Timeline
                startDate={icbc.crashDateRange.start}
                endDate={icbc.crashDateRange.end}
                currentDate={icbc.timelineDate}
                onDateChange={icbc.setTimelineDate}
                onClose={icbc.disableTimeline}
                granularity="year"
                bucketCounts={icbc.yearCounts}
                compactBars
                overflowBuckets
                percentChangeMode={{ enabled: true, label: 'YoY' }}
                statsLabel={`${icbc.totalCrashes.toLocaleString()} crashes`}
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
                onClose={water.disableTimeline}
                bucketCounts={water.bucketCounts}
                compactBars
                overflowBuckets
                windowMode={{
                  size: water.timelineWindowSize,
                  onSizeChange: water.setTimelineWindowSize,
                  options: WATER_TIMELINE_WINDOW_OPTIONS,
                }}
                statsLabel={`${water.filteredSamples.length.toLocaleString(DEFAULT_LOCALE)} sample rows`}
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
                  !showCanueBoundaries
                    ? `${(selectedCanueV2Layer?.features ?? 0).toLocaleString(DEFAULT_LOCALE)} grid cells`
                    : canueTimelinePrefetch.loading
                      ? `Loading timeline ${canueTimelinePrefetch.loaded}/${canueTimelinePrefetch.total} | ${canueAreasWithValuesLabel}`
                      : `${canueAreasWithValuesLabel} with values`
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

            {showLegendPanel && (
              <MapLegendPanel
                title={activeTab === 'ev' ? 'EV Map Layers' : MISC_LEGEND_TITLES[activeTab]}
                icon={<Layers className="h-3.5 w-3.5" />}
                collapsible
                defaultCollapsed="mobile"
                contentClassName="space-y-1"
                width="sm"
              >
                {activeTab === 'heatShade' && (
                  <div className="w-full space-y-1 text-xs text-muted-foreground">
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
                  <div className="w-full space-y-2 text-xs text-muted-foreground">
                    <div>
                      <div className="flex items-center justify-between gap-2 px-1 py-0.5 text-xs">
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
                        colors={CANUE_SCALE_COLORS}
                        minLabel={
                          canueSharedScale
                            ? `${canueSharedScale.clippedLow ? '≤ ' : ''}${formatNullableNumber(canueSharedScale.low)}`
                            : formatNullableNumber(activeCanueBoundaryData.minValue ?? selectedCanueV2Selection?.min)
                        }
                        maxLabel={
                          canueSharedScale
                            ? `${canueSharedScale.clippedHigh ? '≥ ' : ''}${formatNullableNumber(canueSharedScale.high)}`
                            : formatNullableNumber(activeCanueBoundaryData.maxValue ?? selectedCanueV2Selection?.max)
                        }
                      />
                      {canueSharedScale && (
                        <p className="mt-1 px-1 text-[11px] leading-tight">
                          One scale for every period on the timeline
                        </p>
                      )}
                    </div>
                    {canueNoValueAreaCount > 0 && (
                      <LegendItem
                        className="px-1"
                        color="#94a3b8"
                        swatch={<MapSwatch color="#94a3b8" active={false} />}
                        label="No data this period"
                        value={canueNoValueAreaCount.toLocaleString()}
                      />
                    )}
                  </div>
                )}
                {activeTab === 'network' && (
                  <div className="w-full space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between gap-2 px-1 py-0.5 text-xs">
                      <span className="truncate text-foreground">
                        {networkAvailabilityLayer.data
                          ? `${networkAvailabilityLayer.data.features.length.toLocaleString(DEFAULT_LOCALE)} coverage features loaded`
                          : networkAvailabilityLayer.error
                            ? 'Coverage failed to load'
                            : 'Loading coverage'}
                      </span>
                    </div>
                    <LegendItem color="#0f766e" label="5G coverage" active swatchShape="square" />
                    <LegendItem color="#2563eb" label="LTE coverage" active swatchShape="square" />
                  </div>
                )}
                {activeTab === 'ev' && (
                  <EvChargingLegend
                    showPoints={evShowPoints}
                    showHeatmap={evShowHeatmap}
                    showBoundaries={evShowBoundaries}
                  />
                )}
                {activeTab === 'icbc' && <IcbcLegend icbc={icbc} />}
                {activeTab === 'wars' && <WarsLegend wars={wars} />}
                {activeTab === 'openLitterMap' && <OpenLitterMapLegend litter={openLitterMap} />}
                {activeTab === 'walkability' && <WalkabilityLegend walkability={walkability} />}
                {activeTab === 'water' && <WaterLegend water={water} />}
                {activeTab === 'flood' && <FloodLegend flood={flood} />}
                {activeTab === 'bcer' && <BcerLegend bcer={bcer} />}
              </MapLegendPanel>
            )}
          </div>
        </MapSectionLayout>
      </div>
    </div>
  )
}
