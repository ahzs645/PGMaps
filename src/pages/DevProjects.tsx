import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderKanban,
  FolderOpen,
  Layers,
  Map as MapIcon,
  PanelRight,
  Search,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react'

import {
  DESKTOP_SIDEBAR_MAX_WIDTH,
  DESKTOP_SIDEBAR_MIN_WIDTH,
  MapSectionLayout,
} from '@/components/layout/MapSectionLayout'
import { Map as PgMap, MapControls } from '@/components/ui/map'
import { MapFillLayer, MapRasterLayer } from '@/components/ui/map-layers'
import { LegendItem, MapGradientLegendItem, MapLegendPanel } from '@/components/ui/map-panels'
import { MAP_STYLES } from '@/components/ui/map-styles'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useIsMobile'
import healthAuthorityBoundaries from '../../public/data/boundaries/BCMoH/simplified/health_authorities.json'

type ProjectKind = 'raster-story' | 'index-preset' | 'research-pack'
type ControllerTab = 'layers' | 'project'
type CatalogFilter = 'all' | ProjectKind
type MapBounds = [number, number, number, number]
type GeoCoordinate = [number, number]
type GeoRing = GeoCoordinate[]
type GeoPolygon = GeoRing[]

type BoundaryGeometry =
  | {
      type: 'Polygon'
      coordinates: GeoPolygon
    }
  | {
      type: 'MultiPolygon'
      coordinates: GeoPolygon[]
    }

type BoundaryFeature = {
  type: 'Feature'
  properties: Record<string, number | string | null>
  geometry: BoundaryGeometry
}

type BoundaryFeatureCollection = {
  type: 'FeatureCollection'
  features: BoundaryFeature[]
}

type PortalRasterLayer = {
  id: string
  layerName: string
  mapPath?: string
  bounds: MapBounds
}

type PortalContextWmsLayer = {
  id: string
  layerName: string
  mapPath: string
  opacity: number
  legendColor: string
  legendLabel: string
  legendShape?: 'circle' | 'square' | 'line' | 'dashed-line'
}

type ProjectLayer = {
  id: string
  label: string
  type: 'raster' | 'boundary' | 'point' | 'line' | 'base'
  checked: boolean
  locked?: boolean
}

type ProjectScene = {
  label: string
  title: string
  text: string
  focus: string
  visibleLayerIds: string[]
}

type ProjectDefinition = {
  id: number
  slug: string
  title: string
  eyebrow: string
  kind: ProjectKind
  presetKey: string
  labQuick: string
  owner: string
  updated: string
  region: string
  status: string
  summary: string
  sourceNote: string
  details?: string[]
  image?: {
    src: string
    alt: string
    caption: string
  }
  links?: Array<{
    label: string
    href: string
  }>
  accent: string
  iconTone: string
  rasterBackground: string
  mapBounds?: MapBounds
  portalRasterLayers?: PortalRasterLayer[]
  catalogMetrics: Array<{ label: string; value: string }>
  layers: ProjectLayer[]
  legend: Array<{ label: string; color: string }>
  scenes: ProjectScene[]
  recipe: Array<{ label: string; value: number; tone: string }>
  rankedAreas: Array<{ label: string; value: string; tone: string }>
  files: Array<{ label: string; detail: string }>
}

const NECHAKO_PORTAL_WMS_ENDPOINT = 'https://nechakowatershed-portal.ca/cgi-bin/qgis_mapserv.fcgi/'
const NECHAKO_PORTAL_WMS_MAP = '/var/www/qgis_maps/northern_health/northern_health.qgz'
const NECHAKO_WATERBODIES_WMS_MAP = '/var/www/qgis_maps/waterbodies/waterbodies.qgs'
const NORTHERN_HEALTH_BOUNDS: MapBounds = [-139.000001, 51.916666, -118.25, 60]
const NORTHERN_HEALTH_CENTER: [number, number] = [-128.6, 56.2]
const PROJECT_MAP_STYLES = {
  light: MAP_STYLES.light,
  dark: MAP_STYLES.light,
}
const HEALTH_AUTHORITY_BOUNDARY_COLLECTION = healthAuthorityBoundaries as unknown as BoundaryFeatureCollection
const NORTHERN_HEALTH_BOUNDARY = HEALTH_AUTHORITY_BOUNDARY_COLLECTION.features.find((feature) => {
  return feature.properties.HLTH_AUTHORITY_NAME === 'Northern'
})
const NORTHERN_HEALTH_FEATURE_COLLECTION: GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  GeoJSON.GeoJsonProperties
> = {
  type: 'FeatureCollection',
  features: NORTHERN_HEALTH_BOUNDARY
    ? [
        {
          type: 'Feature',
          geometry: NORTHERN_HEALTH_BOUNDARY.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
          properties: {
            id: 'northern-health',
            name: 'Northern Health',
            source: 'BC Ministry of Health',
          },
        },
      ]
    : [],
}

const ECHOSCREEN_CONTEXT_WMS_LAYERS: PortalContextWmsLayer[] = [
  {
    id: 'fraser-nechako',
    layerName: 'Fraser Watershed',
    mapPath: NECHAKO_WATERBODIES_WMS_MAP,
    opacity: 0.8,
    legendColor: '#2563eb',
    legendLabel: 'Fraser watershed',
    legendShape: 'line',
  },
  {
    id: 'fraser-nechako',
    layerName: 'Nechako Watershed',
    mapPath: NECHAKO_WATERBODIES_WMS_MAP,
    opacity: 0.82,
    legendColor: '#0891b2',
    legendLabel: 'Nechako watershed',
    legendShape: 'line',
  },
  {
    id: 'rivers',
    layerName: 'Lake',
    mapPath: NECHAKO_WATERBODIES_WMS_MAP,
    opacity: 0.85,
    legendColor: '#7dd3fc',
    legendLabel: 'Lakes',
    legendShape: 'square',
  },
  {
    id: 'rivers',
    layerName: 'River',
    mapPath: NECHAKO_WATERBODIES_WMS_MAP,
    opacity: 0.85,
    legendColor: '#0284c7',
    legendLabel: 'Rivers',
    legendShape: 'line',
  },
  {
    id: 'rivers',
    layerName: 'Stream (order 5 and up)',
    mapPath: NECHAKO_WATERBODIES_WMS_MAP,
    opacity: 0.72,
    legendColor: '#38bdf8',
    legendLabel: 'Major streams',
    legendShape: 'line',
  },
  {
    id: 'hospitals',
    layerName: 'Hospitals',
    mapPath: NECHAKO_PORTAL_WMS_MAP,
    opacity: 1,
    legendColor: '#111827',
    legendLabel: 'Hospitals',
    legendShape: 'circle',
  },
  {
    id: 'watershed-labels',
    layerName: 'Watershed Labels',
    mapPath: NECHAKO_WATERBODIES_WMS_MAP,
    opacity: 0.95,
    legendColor: '#64748b',
    legendLabel: 'Watershed labels',
    legendShape: 'dashed-line',
  },
]

const PROJECTS: ProjectDefinition[] = [
  {
    id: 4,
    slug: 'echoscreen-climate-health',
    title: 'EchoScreen Cumulative Impacts Study',
    eyebrow: 'Raster story project',
    kind: 'raster-story',
    presetKey: 'project.raster.climateHealth',
    labQuick: 'heatShade',
    owner: 'NH - UNBC',
    updated: 'Apr 2024',
    region: 'Northern BC watersheds',
    status: 'Prototype',
    summary:
      'Climate and health exchange map with watershed context, health facilities, future heat rasters, and precipitation-change layers.',
    sourceNote:
      'Climate rasters load from the Nechako Watershed Portal QGIS WMS using ClimateData.ca layers. Northern Health is drawn from the local BC Ministry of Health boundary data.',
    details: [
      'Created for the NH - UNBC Climate & Health Knowledge Exchange Event on April 12, 2024.',
      'The project gives Northern Health staff and UNBC researchers a shared map package for climate-health discussion, northern BC expertise, resources, and collaboration opportunities.',
      'Climate variables use CMIP6 CanDCS-U6 data under SSP585 from ClimateData.ca, with the Northern Health boundary and watershed context kept visible while the raster story changes.',
    ],
    image: {
      src: '/media/dev-projects/echoscreen-climate-health-event.png',
      alt: 'Northern Health and UNBC climate and health knowledge exchange event poster',
      caption: 'Reference event poster from the source project panel.',
    },
    links: [
      {
        label: 'NH - UNBC event page',
        href: 'https://www.leaph.org/events/nh---unbc-climate-health-knowledge-exchange-event',
      },
      {
        label: 'Nechako Watershed Portal',
        href: 'https://nechakowatershed-portal.ca/',
      },
    ],
    accent: 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950/35 dark:text-cyan-100',
    iconTone: 'bg-cyan-600',
    rasterBackground:
      'radial-gradient(circle at 66% 24%, rgba(220, 38, 38, 0.82) 0 8%, rgba(249, 115, 22, 0.68) 13%, transparent 25%), radial-gradient(circle at 42% 58%, rgba(245, 158, 11, 0.62) 0 12%, rgba(234, 88, 12, 0.42) 20%, transparent 33%), radial-gradient(circle at 74% 72%, rgba(185, 28, 28, 0.65) 0 9%, transparent 23%), linear-gradient(135deg, rgba(21, 128, 61, 0.18), rgba(14, 116, 144, 0.16))',
    mapBounds: NORTHERN_HEALTH_BOUNDS,
    portalRasterLayers: [
      {
        id: 'hot-days-past',
        layerName: 'Days >30C (1971-2000) NH (source: ClimateData.ca)',
        bounds: NORTHERN_HEALTH_BOUNDS,
      },
      {
        id: 'hot-days-future',
        layerName: 'Days >30C (2071-2100) NH (source: ClimateData.ca)',
        bounds: NORTHERN_HEALTH_BOUNDS,
      },
      {
        id: 'precip-change',
        layerName: 'Change in winter precip (between 1971-2000 and 2071-2100) (source: ClimateData.ca)',
        bounds: NORTHERN_HEALTH_BOUNDS,
      },
    ],
    catalogMetrics: [
      { label: 'Scenes', value: '4' },
      { label: 'Layers', value: '9' },
      { label: 'Raster', value: 'Portal WMS' },
    ],
    layers: [
      { id: 'topo', label: 'ESRI Topo', type: 'base', checked: true, locked: true },
      { id: 'watershed-labels', label: 'Watershed Labels', type: 'boundary', checked: true },
      { id: 'hospitals', label: 'Hospitals', type: 'point', checked: true },
      { id: 'northern-health', label: 'Northern Health', type: 'boundary', checked: true },
      { id: 'rivers', label: 'River and lake network', type: 'line', checked: true },
      { id: 'fraser-nechako', label: 'Fraser and Nechako watersheds', type: 'boundary', checked: true },
      { id: 'hot-days-past', label: 'Days >30C NH, 1971-2000', type: 'raster', checked: false },
      { id: 'hot-days-future', label: 'Days >30C NH, 2071-2100', type: 'raster', checked: true },
      { id: 'precip-change', label: 'Winter precip change', type: 'raster', checked: false },
    ],
    legend: [
      { label: 'Low projected heat', color: '#fef3c7' },
      { label: 'Moderate projected heat', color: '#f59e0b' },
      { label: 'High projected heat', color: '#ea580c' },
      { label: 'Highest projected heat', color: '#b91c1c' },
    ],
    scenes: [
      {
        label: 'Context',
        title: 'Watershed and health context',
        text: 'Open with the recognizable river system, health boundary, hospitals, and watershed labels before introducing climate surfaces.',
        focus: 'Northern Health boundary plus Fraser and Nechako watersheds',
        visibleLayerIds: ['topo', 'watershed-labels', 'hospitals', 'northern-health', 'rivers', 'fraser-nechako'],
      },
      {
        label: 'Future Heat',
        title: 'Projected hot-day surface',
        text: 'Switch on the future raster to show where hot days become the dominant climate signal across the project extent.',
        focus: 'Days >30C, 2071-2100',
        visibleLayerIds: [
          'topo',
          'watershed-labels',
          'hospitals',
          'northern-health',
          'rivers',
          'fraser-nechako',
          'hot-days-future',
        ],
      },
      {
        label: 'Change',
        title: 'Seasonal precipitation change',
        text: 'Use the same project shell to pivot from heat to seasonal precipitation without leaving the story package.',
        focus: 'Winter and summer precipitation-change raster',
        visibleLayerIds: ['topo', 'watershed-labels', 'northern-health', 'rivers', 'precip-change'],
      },
      {
        label: 'Methods',
        title: 'Project files and method note',
        text: 'Keep source files, citations, and a concise method note beside the map, with the lab handoff available as a secondary action.',
        focus: 'Project description and downloadable files',
        visibleLayerIds: ['topo', 'watershed-labels', 'hospitals', 'northern-health', 'rivers', 'hot-days-future'],
      },
    ],
    recipe: [
      { label: 'Future hot days raster', value: 100, tone: 'bg-orange-500' },
      { label: 'Health facility context', value: 0, tone: 'bg-cyan-600' },
      { label: 'Watershed context', value: 0, tone: 'bg-blue-600' },
    ],
    rankedAreas: [
      { label: 'Upper Fraser corridor', value: 'Hotter', tone: 'text-red-700 dark:text-red-300' },
      { label: 'Central Nechako basin', value: 'Rising', tone: 'text-orange-700 dark:text-orange-300' },
      { label: 'Northern Health interior', value: 'Mixed', tone: 'text-cyan-700 dark:text-cyan-300' },
    ],
    files: [
      { label: 'Project package', detail: 'Layers, style, scenes, and notes' },
      { label: 'Nechako portal WMS', detail: 'ClimateData.ca raster layers' },
      { label: 'BCMoH boundary', detail: 'Local Northern Health multipolygon' },
    ],
  },
  {
    id: 18,
    slug: 'heat-shade-priority',
    title: 'Heat + Shade Relief Priority',
    eyebrow: 'Index preset project',
    kind: 'index-preset',
    presetKey: 'heatReliefPriority',
    labQuick: 'heatShade',
    owner: 'PGMaps',
    updated: 'Current',
    region: 'Prince George DA',
    status: 'Ready',
    summary:
      'A guided version of the heat relief recipe for finding dense areas with weaker tree, forest, and cooling-facility signals.',
    sourceNote:
      'This opens directly in Index Lab as the heat and shade quick preset. The project wrapper adds narrative scenes, ranked areas, and source notes.',
    details: [
      'A guided project shell for the heat relief preset, keeping the recommended score surface and top-ranked areas visible before anyone edits weights.',
      'The map scenes separate the final priority score from shade, cooling access, and method handoff so the project reads like a small briefing rather than a raw index builder.',
    ],
    links: [
      {
        label: 'Open heat preset',
        href: '/score-builder?quick=heatShade',
      },
    ],
    accent:
      'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-100',
    iconTone: 'bg-amber-600',
    rasterBackground:
      'radial-gradient(circle at 34% 28%, rgba(22, 163, 74, 0.55) 0 11%, transparent 22%), radial-gradient(circle at 72% 36%, rgba(239, 68, 68, 0.7) 0 9%, rgba(245, 158, 11, 0.44) 17%, transparent 31%), radial-gradient(circle at 48% 72%, rgba(234, 88, 12, 0.58) 0 12%, transparent 28%), linear-gradient(135deg, rgba(20, 83, 45, 0.18), rgba(161, 98, 7, 0.16))',
    catalogMetrics: [
      { label: 'Preset', value: 'Heat' },
      { label: 'Boundary', value: 'DA' },
      { label: 'Lab', value: 'Yes' },
    ],
    layers: [
      { id: 'topo', label: 'Muted streets', type: 'base', checked: true, locked: true },
      { id: 'score-surface', label: 'Priority score surface', type: 'raster', checked: true },
      { id: 'tree-canopy', label: 'Tree and forest proxy', type: 'raster', checked: true },
      { id: 'cooling', label: 'Cooling facilities', type: 'point', checked: true },
      { id: 'da-boundaries', label: 'Dissemination areas', type: 'boundary', checked: true },
      { id: 'ranked-areas', label: 'Top ranked areas', type: 'boundary', checked: true },
    ],
    legend: [
      { label: 'Lower priority', color: '#dcfce7' },
      { label: 'Watch', color: '#fde68a' },
      { label: 'Priority', color: '#fb923c' },
      { label: 'Highest priority', color: '#b91c1c' },
    ],
    scenes: [
      {
        label: 'Overview',
        title: 'Heat relief priority surface',
        text: 'Start with the final priority surface and the top-ranked areas visible.',
        focus: 'Weighted heat relief score',
        visibleLayerIds: ['topo', 'score-surface', 'cooling', 'da-boundaries', 'ranked-areas'],
      },
      {
        label: 'Shade',
        title: 'Shade and forest signals',
        text: 'Show the benefit layer that lowers priority where canopy and forest cover are stronger.',
        focus: 'Tree and forest proxy',
        visibleLayerIds: ['topo', 'tree-canopy', 'cooling', 'da-boundaries'],
      },
      {
        label: 'Services',
        title: 'Cooling access context',
        text: 'Switch attention to cooling facilities and the areas where service access needs review.',
        focus: 'Cooling facilities and service gaps',
        visibleLayerIds: ['topo', 'score-surface', 'cooling', 'da-boundaries'],
      },
      {
        label: 'Recipe',
        title: 'Recipe handoff',
        text: 'Open the same preset in Index Lab to change the weights, boundary level, normalization, and map palette.',
        focus: 'Index Lab configuration',
        visibleLayerIds: ['topo', 'score-surface', 'tree-canopy', 'cooling', 'da-boundaries'],
      },
    ],
    recipe: [
      { label: 'Population density', value: 22, tone: 'bg-red-500' },
      { label: 'Building age', value: 16, tone: 'bg-orange-500' },
      { label: 'Tree density', value: -16, tone: 'bg-emerald-600' },
      { label: 'Forest area', value: -18, tone: 'bg-green-700' },
      { label: 'Cooling facilities', value: -8, tone: 'bg-cyan-600' },
    ],
    rankedAreas: [
      { label: 'Downtown east', value: '91', tone: 'text-red-700 dark:text-red-300' },
      { label: 'Gateway corridor', value: '84', tone: 'text-orange-700 dark:text-orange-300' },
      { label: 'South bowl edge', value: '77', tone: 'text-amber-700 dark:text-amber-300' },
    ],
    files: [
      { label: 'Index recipe', detail: 'Preset weights and method settings' },
      { label: 'Boundary export', detail: 'Scored DA features' },
      { label: 'Method note', detail: 'Proxy limitations and source review' },
    ],
  },
  {
    id: 21,
    slug: 'park-access-equity',
    title: 'Park Access Equity',
    eyebrow: 'Index preset project',
    kind: 'index-preset',
    presetKey: 'parkAccessEquity',
    labQuick: 'parks',
    owner: 'PGMaps',
    updated: 'Current',
    region: 'Prince George neighbourhoods',
    status: 'Ready',
    summary:
      'A project view for park access gaps, trail context, and neighbourhood-scale equity checks before editing the score in the lab.',
    sourceNote:
      'The project wrapper can present access scenes and ranked gaps while the lab keeps the transparent equation and export workflow.',
    details: [
      'A project view for explaining where park access gaps appear and which neighbourhood-scale assets are part of the access story.',
      'Scenes move from the access gap score to parks, trails, walksheds, and the editable Index Lab recipe.',
    ],
    links: [
      {
        label: 'Open parks preset',
        href: '/score-builder?quick=parks',
      },
    ],
    accent:
      'border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-100',
    iconTone: 'bg-emerald-600',
    rasterBackground:
      'radial-gradient(circle at 28% 42%, rgba(22, 163, 74, 0.62) 0 14%, transparent 25%), radial-gradient(circle at 70% 66%, rgba(239, 68, 68, 0.58) 0 11%, rgba(245, 158, 11, 0.44) 18%, transparent 30%), radial-gradient(circle at 58% 28%, rgba(16, 185, 129, 0.38) 0 13%, transparent 28%), linear-gradient(135deg, rgba(20, 83, 45, 0.2), rgba(8, 145, 178, 0.15))',
    catalogMetrics: [
      { label: 'Preset', value: 'Parks' },
      { label: 'Boundary', value: 'City' },
      { label: 'Lab', value: 'Yes' },
    ],
    layers: [
      { id: 'topo', label: 'Muted streets', type: 'base', checked: true, locked: true },
      { id: 'score-surface', label: 'Access gap score', type: 'raster', checked: true },
      { id: 'parks', label: 'Parks and open spaces', type: 'boundary', checked: true },
      { id: 'trails', label: 'Trail network', type: 'line', checked: true },
      { id: 'walksheds', label: '10 minute walksheds', type: 'boundary', checked: false },
      { id: 'ranked-areas', label: 'Top ranked gaps', type: 'boundary', checked: true },
    ],
    legend: [
      { label: 'Served', color: '#bbf7d0' },
      { label: 'Partial access', color: '#bef264' },
      { label: 'Access gap', color: '#facc15' },
      { label: 'High gap', color: '#dc2626' },
    ],
    scenes: [
      {
        label: 'Overview',
        title: 'Park access gap surface',
        text: 'Lead with the access gap score and top-ranked neighbourhoods.',
        focus: 'Access gap score',
        visibleLayerIds: ['topo', 'score-surface', 'parks', 'trails', 'ranked-areas'],
      },
      {
        label: 'Assets',
        title: 'Existing park and trail context',
        text: 'Bring parks and trails forward before showing how service gaps are computed.',
        focus: 'Parks and trails',
        visibleLayerIds: ['topo', 'parks', 'trails'],
      },
      {
        label: 'Walksheds',
        title: 'Walkable service areas',
        text: 'Expose the access geometry that can later become a threshold model in Index Lab.',
        focus: '10 minute walksheds',
        visibleLayerIds: ['topo', 'parks', 'trails', 'walksheds'],
      },
      {
        label: 'Recipe',
        title: 'Customizable score',
        text: 'Use Index Lab when the project needs weight changes, alternate boundaries, or exportable scored regions.',
        focus: 'Index Lab preset',
        visibleLayerIds: ['topo', 'score-surface', 'parks', 'trails', 'ranked-areas'],
      },
    ],
    recipe: [
      { label: 'Park access gap', value: 44, tone: 'bg-red-500' },
      { label: 'Park area ratio', value: -18, tone: 'bg-emerald-600' },
      { label: 'Trail density', value: -12, tone: 'bg-green-700' },
      { label: 'Population density', value: 18, tone: 'bg-orange-500' },
    ],
    rankedAreas: [
      { label: 'College Heights edge', value: '88', tone: 'text-red-700 dark:text-red-300' },
      { label: 'Hart south', value: '81', tone: 'text-orange-700 dark:text-orange-300' },
      { label: 'Blackburn west', value: '74', tone: 'text-amber-700 dark:text-amber-300' },
    ],
    files: [
      { label: 'Service areas', detail: 'Walkshed geometry' },
      { label: 'Park inventory', detail: 'City open-space features' },
      { label: 'Index export', detail: 'Scored neighbourhoods' },
    ],
  },
  {
    id: 33,
    slug: 'transit-equity-project',
    title: 'Transit Equity Project',
    eyebrow: 'Research pack',
    kind: 'research-pack',
    presetKey: 'transitEquity',
    labQuick: 'transit',
    owner: 'PGMaps',
    updated: 'Draft',
    region: 'Prince George routes',
    status: 'Draft',
    summary:
      'A guided project pack for route access, neighbourhood context, and a transit equity index that can be customized in Index Lab.',
    sourceNote:
      'This combines GTFS-derived route context with census and access metrics. The story stays light; the full weighting model lives in Index Lab.',
    details: [
      'A research pack for reviewing transit access against population context and a transparent equity scoring recipe.',
      'The story mode can keep route and stop context visible while the lab remains available for weighting changes and boundary-level experiments.',
    ],
    links: [
      {
        label: 'Open transit preset',
        href: '/score-builder?quick=transit',
      },
    ],
    accent: 'border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/35 dark:text-blue-100',
    iconTone: 'bg-blue-600',
    rasterBackground:
      'radial-gradient(circle at 30% 68%, rgba(59, 130, 246, 0.48) 0 11%, transparent 26%), radial-gradient(circle at 74% 36%, rgba(245, 158, 11, 0.46) 0 12%, transparent 28%), radial-gradient(circle at 45% 42%, rgba(239, 68, 68, 0.54) 0 9%, transparent 23%), linear-gradient(135deg, rgba(30, 64, 175, 0.18), rgba(14, 116, 144, 0.16))',
    catalogMetrics: [
      { label: 'Preset', value: 'Transit' },
      { label: 'Boundary', value: 'CT/DA' },
      { label: 'Lab', value: 'Yes' },
    ],
    layers: [
      { id: 'topo', label: 'Muted streets', type: 'base', checked: true, locked: true },
      { id: 'score-surface', label: 'Transit equity score', type: 'raster', checked: true },
      { id: 'routes', label: 'Transit route bundles', type: 'line', checked: true },
      { id: 'stops', label: 'Stops and exchanges', type: 'point', checked: true },
      { id: 'population', label: 'Population context', type: 'boundary', checked: true },
      { id: 'ranked-areas', label: 'Top priority areas', type: 'boundary', checked: true },
    ],
    legend: [
      { label: 'Higher service', color: '#bfdbfe' },
      { label: 'Moderate service', color: '#60a5fa' },
      { label: 'Equity review', color: '#f59e0b' },
      { label: 'Priority review', color: '#dc2626' },
    ],
    scenes: [
      {
        label: 'Overview',
        title: 'Transit equity score',
        text: 'Start with the combined priority score and the route network visible.',
        focus: 'Transit equity score',
        visibleLayerIds: ['topo', 'score-surface', 'routes', 'stops', 'population', 'ranked-areas'],
      },
      {
        label: 'Routes',
        title: 'Route bundle context',
        text: 'Show the route network on its own so the story can explain coverage before scoring.',
        focus: 'Routes and exchanges',
        visibleLayerIds: ['topo', 'routes', 'stops'],
      },
      {
        label: 'Population',
        title: 'Demand-side context',
        text: 'Bring population context into the map before ranking areas.',
        focus: 'Population and boundary context',
        visibleLayerIds: ['topo', 'population', 'routes', 'stops'],
      },
      {
        label: 'Recipe',
        title: 'Lab handoff',
        text: 'Open the recipe in Index Lab to edit the weighting model or switch to another boundary level.',
        focus: 'Index Lab preset',
        visibleLayerIds: ['topo', 'score-surface', 'routes', 'stops', 'population', 'ranked-areas'],
      },
    ],
    recipe: [
      { label: 'Transit access', value: -28, tone: 'bg-blue-600' },
      { label: 'Population density', value: 24, tone: 'bg-orange-500' },
      { label: 'Deprivation proxy', value: 18, tone: 'bg-red-500' },
      { label: 'Service mix', value: -10, tone: 'bg-cyan-600' },
    ],
    rankedAreas: [
      { label: 'Hart Highway corridor', value: '86', tone: 'text-red-700 dark:text-red-300' },
      { label: 'West Bowl', value: '79', tone: 'text-orange-700 dark:text-orange-300' },
      { label: 'South industrial edge', value: '71', tone: 'text-amber-700 dark:text-amber-300' },
    ],
    files: [
      { label: 'GTFS bundles', detail: 'Routes, stops, and service metadata' },
      { label: 'Index recipe', detail: 'Transit equity preset' },
      { label: 'Ranked export', detail: 'Review areas by boundary' },
    ],
  },
]

const FILTER_OPTIONS: Array<{ value: CatalogFilter; label: string }> = [
  { value: 'all', label: 'All projects' },
  { value: 'raster-story', label: 'Raster stories' },
  { value: 'index-preset', label: 'Index presets' },
  { value: 'research-pack', label: 'Research packs' },
]

const KIND_LABELS: Record<ProjectKind, string> = {
  'raster-story': 'Raster story',
  'index-preset': 'Index preset',
  'research-pack': 'Research pack',
}

const TAB_LABELS: Record<ControllerTab, string> = {
  layers: 'Layers',
  project: 'Project',
}

function buildPortalWmsTileUrl(layerName: string, mapPath = NECHAKO_PORTAL_WMS_MAP) {
  return [
    `${NECHAKO_PORTAL_WMS_ENDPOINT}?MAP=${encodeURIComponent(mapPath)}`,
    'SERVICE=WMS',
    'VERSION=1.1.1',
    'REQUEST=GetMap',
    `LAYERS=${encodeURIComponent(layerName)}`,
    'STYLES=',
    'FORMAT=image/png',
    'TRANSPARENT=TRUE',
    'SRS=EPSG:3857',
    'WIDTH=256',
    'HEIGHT=256',
    'BBOX={bbox-epsg-3857}',
  ].join('&')
}

function buildPortalWmsLegendUrl(layerName: string, mapPath = NECHAKO_PORTAL_WMS_MAP) {
  const params = new URLSearchParams({
    MAP: mapPath,
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetLegendGraphic',
    LAYER: layerName,
    FORMAT: 'image/png',
    STYLE: 'default',
  })

  return `${NECHAKO_PORTAL_WMS_ENDPOINT}?${params.toString()}`
}

function defaultVisibleLayerIds(project: ProjectDefinition) {
  return new Set(project.layers.filter((layer) => layer.checked).map((layer) => layer.id))
}

function layerIcon(layer: ProjectLayer) {
  if (layer.type === 'raster') return <MapIcon className="h-3.5 w-3.5" />
  if (layer.type === 'boundary') return <PanelRight className="h-3.5 w-3.5" />
  if (layer.type === 'point') return <FolderOpen className="h-3.5 w-3.5" />
  if (layer.type === 'line') return <SlidersHorizontal className="h-3.5 w-3.5" />
  return <Layers className="h-3.5 w-3.5" />
}

function getLabUrl(project: ProjectDefinition) {
  return `/score-builder?quick=${project.labQuick}`
}

function ProjectMapPreview({
  project,
  visibleLayerIds,
  rasterOpacity,
  className,
}: {
  project: ProjectDefinition
  visibleLayerIds: Set<string>
  rasterOpacity: number
  className?: string
}) {
  if (project.portalRasterLayers) {
    return (
      <ProjectPortalMapPreview
        project={project}
        visibleLayerIds={visibleLayerIds}
        rasterOpacity={rasterOpacity}
        className={className}
      />
    )
  }

  const showRaster =
    visibleLayerIds.has('hot-days-future') ||
    visibleLayerIds.has('hot-days-past') ||
    visibleLayerIds.has('precip-change') ||
    visibleLayerIds.has('score-surface') ||
    visibleLayerIds.has('tree-canopy')
  const showHospitals =
    visibleLayerIds.has('hospitals') || visibleLayerIds.has('stops') || visibleLayerIds.has('cooling')
  const showRivers = visibleLayerIds.has('rivers') || visibleLayerIds.has('routes') || visibleLayerIds.has('trails')
  const showBoundaries =
    visibleLayerIds.has('northern-health') ||
    visibleLayerIds.has('fraser-nechako') ||
    visibleLayerIds.has('da-boundaries') ||
    visibleLayerIds.has('population')
  const showRanked = visibleLayerIds.has('ranked-areas')
  const showParks = visibleLayerIds.has('parks') || visibleLayerIds.has('walksheds')

  return (
    <div
      className={cn(
        'relative min-h-[420px] overflow-hidden rounded-lg border bg-slate-100 shadow-sm dark:bg-slate-950 lg:min-h-[calc(100vh-12rem)]',
        className,
      )}
    >
      <div className="absolute inset-0 bg-[linear-gradient(30deg,rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(120deg,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[length:72px_72px]" />
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/60 via-sky-50/50 to-stone-100/70 dark:from-emerald-950/45 dark:via-sky-950/30 dark:to-stone-950/45" />

      {showRaster && (
        <div
          className="absolute inset-0 transition-opacity duration-300"
          style={{ background: project.rasterBackground, opacity: rasterOpacity / 100 }}
        />
      )}

      {showBoundaries && (
        <>
          <div className="absolute left-[16%] top-[16%] h-[62%] w-[58%] rotate-[-7deg] rounded-[42%] border border-cyan-800/35 bg-cyan-200/5 dark:border-cyan-300/25 dark:bg-cyan-800/10" />
          <div className="absolute left-[42%] top-[28%] h-[42%] w-[42%] rotate-[12deg] rounded-[36%] border border-blue-700/25 bg-blue-200/5 dark:border-blue-300/20 dark:bg-blue-800/10" />
        </>
      )}

      {showParks && (
        <>
          <div className="absolute left-[22%] top-[33%] h-[13%] w-[17%] rounded-lg bg-emerald-600/45 ring-1 ring-emerald-900/20" />
          <div className="absolute left-[58%] top-[55%] h-[16%] w-[20%] rounded-lg bg-emerald-600/40 ring-1 ring-emerald-900/20" />
          <div className="absolute left-[44%] top-[18%] h-[11%] w-[15%] rounded-lg bg-emerald-600/35 ring-1 ring-emerald-900/20" />
        </>
      )}

      {showRivers && (
        <>
          <div className="absolute left-[-4%] top-[47%] h-4 w-[112%] -rotate-[14deg] rounded-full bg-sky-600/42 shadow-[0_0_0_6px_rgba(14,165,233,0.08)]" />
          <div className="absolute left-[38%] top-[-7%] h-3 w-[115%] rotate-[112deg] rounded-full bg-cyan-600/34 shadow-[0_0_0_5px_rgba(8,145,178,0.07)]" />
        </>
      )}

      {showRanked && (
        <>
          <div className="absolute left-[64%] top-[31%] h-16 w-24 rotate-[-8deg] rounded-md border-2 border-red-700 bg-red-500/30" />
          <div className="absolute left-[36%] top-[64%] h-14 w-28 rotate-[8deg] rounded-md border-2 border-orange-600 bg-orange-500/25" />
          <div className="absolute left-[18%] top-[39%] h-12 w-24 rotate-[-3deg] rounded-md border-2 border-amber-600 bg-amber-400/25" />
        </>
      )}

      {showHospitals && (
        <>
          {[
            ['26%', '28%'],
            ['52%', '47%'],
            ['72%', '63%'],
            ['42%', '74%'],
          ].map(([left, top], index) => (
            <div
              key={`${left}-${top}`}
              className="absolute flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-950 text-[10px] font-bold text-white shadow-md dark:border-slate-200"
              style={{ left, top }}
            >
              {index + 1}
            </div>
          ))}
        </>
      )}

      <ProjectMapLegend project={project} visibleLayerIds={visibleLayerIds} />
    </div>
  )
}

function ProjectPortalMapPreview({
  project,
  visibleLayerIds,
  rasterOpacity,
  className,
}: {
  project: ProjectDefinition
  visibleLayerIds: Set<string>
  rasterOpacity: number
  className?: string
}) {
  const mapBounds = project.mapBounds ?? NORTHERN_HEALTH_BOUNDS
  const activePortalRasterLayers = project.portalRasterLayers?.filter((layer) => visibleLayerIds.has(layer.id)) ?? []
  const activeContextLayers = ECHOSCREEN_CONTEXT_WMS_LAYERS.filter((layer) => visibleLayerIds.has(layer.id))
  const activeRasterLayer = activePortalRasterLayers[activePortalRasterLayers.length - 1] ?? null
  const showNorthernHealthBoundary =
    visibleLayerIds.has('northern-health') && NORTHERN_HEALTH_FEATURE_COLLECTION.features.length > 0

  return (
    <div
      className={cn(
        'relative min-h-[420px] overflow-hidden rounded-lg border bg-slate-100 shadow-sm dark:bg-slate-950 lg:min-h-[calc(100vh-12rem)]',
        className,
      )}
    >
      <PgMap
        className="h-full w-full"
        center={NORTHERN_HEALTH_CENTER}
        zoom={4.35}
        minZoom={3}
        maxZoom={11}
        maxBounds={[
          [mapBounds[0] - 2, mapBounds[1] - 2],
          [mapBounds[2] + 2, mapBounds[3] + 2],
        ]}
        styles={PROJECT_MAP_STYLES}
        showStyleLoadingOverlay={false}
      >
        <MapControls position="top-right" mobilePosition="bottom-right" showZoom showCompass />

        {activePortalRasterLayers.map((layer) => (
          <MapRasterLayer
            key={layer.id}
            tiles={[buildPortalWmsTileUrl(layer.layerName, layer.mapPath)]}
            opacity={rasterOpacity / 100}
            tileSize={256}
            minZoom={3}
            maxZoom={11}
            attribution="Nechako Watershed Portal, ClimateData.ca"
          />
        ))}

        {activeContextLayers.map((layer) => (
          <MapRasterLayer
            key={`${layer.id}-${layer.layerName}`}
            tiles={[buildPortalWmsTileUrl(layer.layerName, layer.mapPath)]}
            opacity={layer.opacity}
            tileSize={256}
            minZoom={3}
            maxZoom={12}
            attribution="Nechako Watershed Portal"
          />
        ))}

        {showNorthernHealthBoundary && (
          <MapFillLayer
            data={NORTHERN_HEALTH_FEATURE_COLLECTION}
            fillColor="#06b6d4"
            fillOpacity={0.07}
            lineColor="#0f172a"
            lineWidth={1.5}
            lineOpacity={0.68}
          />
        )}

        <ProjectMapLegend
          project={project}
          visibleLayerIds={visibleLayerIds}
          activePortalRasterLayer={activeRasterLayer}
          contextLayers={activeContextLayers}
        />
      </PgMap>
    </div>
  )
}

function ProjectMapLegend({
  project,
  visibleLayerIds,
  activePortalRasterLayer = null,
  contextLayers = [],
}: {
  project: ProjectDefinition
  visibleLayerIds: Set<string>
  activePortalRasterLayer?: PortalRasterLayer | null
  contextLayers?: PortalContextWmsLayer[]
}) {
  const activeRasterLabel = activePortalRasterLayer
    ? (project.layers.find((layer) => layer.id === activePortalRasterLayer.id)?.label ??
      activePortalRasterLayer.layerName)
    : null
  const showLocalNorthernHealth = project.slug === 'echoscreen-climate-health' && visibleLayerIds.has('northern-health')
  const fallbackLegendColors = project.legend.map((item) => item.color)

  return (
    <MapLegendPanel title="Legend" width="sm" collapsible className="max-h-[min(28rem,calc(100%-2rem))] overflow-auto">
      <div className="space-y-3">
        {activePortalRasterLayer ? (
          <div>
            <div className="mb-1 text-xs font-semibold text-foreground">{activeRasterLabel}</div>
            <img
              src={buildPortalWmsLegendUrl(activePortalRasterLayer.layerName, activePortalRasterLayer.mapPath)}
              alt={`${activeRasterLabel} legend`}
              className="max-h-24 w-full rounded border bg-white object-contain p-1"
            />
            <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
              Portal WMS raster, ClimateData.ca source layer.
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-1 text-xs font-semibold text-foreground">{KIND_LABELS[project.kind]}</div>
            <MapGradientLegendItem
              colors={fallbackLegendColors}
              minLabel={project.legend[0]?.label ?? 'Lower'}
              maxLabel={project.legend[project.legend.length - 1]?.label ?? 'Higher'}
            />
          </div>
        )}

        <div className="space-y-1 border-t pt-2 text-[11px]">
          {showLocalNorthernHealth && (
            <LegendItem color="#0f172a" label="Northern Health" value="local BCMoH" swatchShape="line" />
          )}
          {contextLayers.map((layer) => (
            <LegendItem
              key={`${layer.id}-${layer.layerName}`}
              color={layer.legendColor}
              label={layer.legendLabel}
              active={visibleLayerIds.has(layer.id)}
              swatchShape={layer.legendShape}
            />
          ))}
          {!showLocalNorthernHealth && contextLayers.length === 0 && (
            <div className="text-[10px] leading-snug text-muted-foreground">Toggle layers to update the map stack.</div>
          )}
        </div>
      </div>
    </MapLegendPanel>
  )
}

function LayerToggle({ layer, visible, onToggle }: { layer: ProjectLayer; visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={layer.locked}
      className="flex w-full items-center gap-3 rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
          visible ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-muted',
        )}
      >
        {visible && <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {layerIcon(layer)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{layer.label}</span>
        <span className="block text-[11px] capitalize text-muted-foreground">{layer.type}</span>
      </span>
      {visible ? (
        <Eye className="h-4 w-4 text-muted-foreground" />
      ) : (
        <EyeOff className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  )
}

function ProjectController({
  project,
  activeTab,
  onTabChange,
  visibleLayerIds,
  onLayerToggle,
  rasterOpacity,
  onRasterOpacityChange,
  className,
}: {
  project: ProjectDefinition
  activeTab: ControllerTab
  onTabChange: (tab: ControllerTab) => void
  visibleLayerIds: Set<string>
  onLayerToggle: (layerId: string) => void
  rasterOpacity: number
  onRasterOpacityChange: (value: number) => void
  className?: string
}) {
  return (
    <aside className={cn('flex min-h-0 flex-col rounded-lg border bg-card shadow-sm', className)}>
      <div className="border-b p-3">
        <div className="grid grid-cols-2 rounded-md bg-muted p-1">
          {(Object.keys(TAB_LABELS) as ControllerTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={cn(
                'h-8 rounded text-xs font-semibold transition-colors',
                activeTab === tab
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {activeTab === 'layers' && (
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-foreground">Map Stack</div>
                <span className="text-xs text-muted-foreground">
                  {visibleLayerIds.size}/{project.layers.length}
                </span>
              </div>
              <div className="space-y-2">
                {project.layers.map((layer) => (
                  <LayerToggle
                    key={layer.id}
                    layer={layer}
                    visible={visibleLayerIds.has(layer.id)}
                    onToggle={() => onLayerToggle(layer.id)}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-background p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-foreground">Raster Opacity</div>
                <div className="text-xs font-medium text-muted-foreground">{rasterOpacity}%</div>
              </div>
              <Slider
                value={[rasterOpacity]}
                min={20}
                max={100}
                step={5}
                onValueChange={(value) => onRasterOpacityChange(value[0] ?? rasterOpacity)}
                aria-label="Raster opacity"
              />
            </div>
          </div>
        )}

        {activeTab === 'project' && (
          <div className="space-y-4">
            <div className={cn('rounded-lg border p-3', project.accent)}>
              <div className="text-xs font-semibold uppercase tracking-wide">{KIND_LABELS[project.kind]}</div>
              <div className="mt-1 text-sm font-semibold">{project.presetKey}</div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold text-foreground">Details</div>
              {[
                ['Owner', project.owner],
                ['Updated', project.updated],
                ['Region', project.region],
                ['Status', project.status],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                >
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="min-w-0 truncate text-right text-sm font-medium text-foreground">{value}</span>
                </div>
              ))}
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Recipe</div>
              <div className="space-y-2">
                {project.recipe.map((item) => (
                  <div key={item.label} className="rounded-md border bg-background p-2.5">
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="truncate text-xs font-medium text-foreground">{item.label}</span>
                      <span className="text-xs font-semibold text-muted-foreground">
                        {item.value > 0 ? '+' : ''}
                        {item.value}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full', item.tone)}
                        style={{ width: `${Math.max(8, Math.min(100, Math.abs(item.value)))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Project Files</div>
              <div className="space-y-2">
                {project.files.map((file) => (
                  <div key={file.label} className="flex items-start gap-3 rounded-md border bg-background px-3 py-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{file.label}</div>
                      <div className="text-xs leading-5 text-muted-foreground">{file.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to={getLabUrl(project)}>
                <Settings2 className="h-4 w-4" />
                Open in Index Lab
              </Link>
            </Button>
          </div>
        )}
      </div>
    </aside>
  )
}

function clampPanelWidth(width: number, fallback: number) {
  if (!Number.isFinite(width)) return fallback
  return Math.min(DESKTOP_SIDEBAR_MAX_WIDTH, Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function ProjectCatalogPage({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  filteredProjects,
  selectedProject,
  onSelectProject,
  onOpenProject,
}: {
  query: string
  onQueryChange: (value: string) => void
  filter: CatalogFilter
  onFilterChange: (value: CatalogFilter) => void
  filteredProjects: ProjectDefinition[]
  selectedProject: ProjectDefinition | null
  onSelectProject: (slug: string) => void
  onOpenProject: (slug: string) => void
}) {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null)

  function onToggleExpand(slug: string) {
    setExpandedSlug((current) => (current === slug ? null : slug))
  }

  return (
    <div className="bg-muted/30 p-3 text-foreground sm:p-5 lg:h-[calc(100vh-4rem)] lg:min-h-[720px]">
      <div className="mx-auto max-w-[98rem] gap-4 lg:grid lg:h-full lg:grid-cols-[minmax(40rem,1.35fr)_minmax(24rem,0.85fr)]">
        <section className="flex min-h-0 flex-col rounded-lg border bg-background shadow-sm">
          <header className="border-b p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <div className="mb-2 inline-flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  <FolderKanban className="h-3.5 w-3.5" />
                  Project catalog
                </div>
                <h1 className="text-2xl font-bold tracking-tight">Preset Projects</h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Select a project to inspect its story, resources, calls, and visual context before entering the map.
                </p>
              </div>

              <div className="grid gap-2 sm:min-w-[24rem] sm:grid-cols-[minmax(0,1fr)_10rem]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="Search projects"
                    className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary/25"
                  />
                </div>
                <AppSelect
                  value={filter}
                  onValueChange={(value) => onFilterChange(value as CatalogFilter)}
                  options={FILTER_OPTIONS}
                  triggerAriaLabel="Filter projects"
                />
              </div>
            </div>
          </header>

          <div className="hidden min-h-0 flex-1 overflow-auto lg:block">
            <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left">
              <thead className="sticky top-0 z-10 bg-background text-[11px] uppercase tracking-wide text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))]">
                <tr>
                  <th className="w-[48%] px-4 py-3 font-semibold">Project</th>
                  <th className="w-[20%] px-3 py-3 font-semibold">State</th>
                  <th className="w-[18%] px-3 py-3 font-semibold">Resources</th>
                  <th className="w-[14%] px-4 py-3 text-right font-semibold">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredProjects.map((project) => {
                  const active = selectedProject?.slug === project.slug
                  return (
                    <tr
                      key={project.slug}
                      className={cn('align-top transition-colors', active ? 'bg-primary/5' : 'hover:bg-muted/30')}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onSelectProject(project.slug)}
                          className="flex w-full min-w-0 items-start gap-3 text-left"
                        >
                          <span
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white',
                              project.iconTone,
                            )}
                          >
                            <FolderKanban className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-semibold text-foreground">{project.title}</span>
                              {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                            </span>
                            <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {project.summary}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="space-y-1.5">
                          <span
                            className={cn(
                              'inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold',
                              project.accent,
                            )}
                          >
                            {KIND_LABELS[project.kind]}
                          </span>
                          <div className="text-xs text-muted-foreground">{project.status}</div>
                          <div className="text-xs text-muted-foreground">{project.updated}</div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-5 text-muted-foreground">
                        <div>
                          <span className="font-medium text-foreground">{project.layers.length}</span> layers
                        </div>
                        <div>
                          <span className="font-medium text-foreground">{project.scenes.length}</span> scenes
                        </div>
                        <div>
                          <span className="font-medium text-foreground">{project.files.length}</span> files
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          variant={active ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => onOpenProject(project.slug)}
                        >
                          Enter
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {filteredProjects.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">No projects match the current search.</div>
            )}
          </div>

          <div className="space-y-3 p-3 lg:hidden">
            {filteredProjects.map((project) => (
              <ProjectCatalogMobileCard
                key={project.slug}
                project={project}
                expanded={expandedSlug === project.slug}
                onToggleExpand={() => onToggleExpand(project.slug)}
                onOpen={() => onOpenProject(project.slug)}
              />
            ))}
            {filteredProjects.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">No projects match the current search.</div>
            )}
          </div>
        </section>

        {selectedProject ? (
          <ProjectCatalogPreview project={selectedProject} onOpenProject={() => onOpenProject(selectedProject.slug)} />
        ) : (
          <aside className="hidden min-h-0 items-center justify-center rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground shadow-sm lg:flex">
            Select a project to preview its details.
          </aside>
        )}
      </div>
    </div>
  )
}

function ProjectDetailSections({ project }: { project: ProjectDefinition }) {
  const detailParagraphs = project.details ?? [project.summary, project.sourceNote]

  return (
    <>
      <section className="p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <BookOpen className="h-4 w-4" />
          About
        </div>
        <div className="space-y-2 text-sm leading-6 text-muted-foreground">
          {detailParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {project.image && (
          <figure className="mt-3 overflow-hidden rounded-md border bg-muted/20">
            <img
              src={project.image.src}
              alt={project.image.alt}
              loading="lazy"
              className="max-h-56 w-full object-contain"
            />
            <figcaption className="border-t px-3 py-2 text-xs leading-5 text-muted-foreground">
              {project.image.caption}
            </figcaption>
          </figure>
        )}
      </section>

      <section className="border-t p-4">
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Owner', project.owner],
            ['Region', project.region],
            ['Updated', project.updated],
            ['Preset', project.presetKey],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Layers className="h-4 w-4" />
          Resources and Calls
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Layer Stack
            </div>
            <div className="flex flex-wrap gap-1.5">
              {project.layers.map((layer) => (
                <span
                  key={layer.id}
                  className="rounded-md border bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground"
                >
                  {layer.label}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {project.catalogMetrics.map((metric) => (
              <div key={metric.label} className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {metric.label}
                </div>
                <div className="mt-0.5 text-sm font-semibold text-foreground">{metric.value}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files</div>
            <div className="space-y-2">
              {project.files.map((file) => (
                <div key={file.label} className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{file.label}</div>
                    <div className="text-xs leading-5 text-muted-foreground">{file.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {project.links && project.links.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Links</div>
              <div className="space-y-2">
                {project.links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target={link.href.startsWith('http') ? '_blank' : undefined}
                    rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                    className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                  >
                    <span className="truncate">{link.label}</span>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}

function ProjectCatalogMobileCard({
  project,
  expanded,
  onToggleExpand,
  onOpen,
}: {
  project: ProjectDefinition
  expanded: boolean
  onToggleExpand: () => void
  onOpen: () => void
}) {
  return (
    <article className="overflow-hidden rounded-lg border bg-background shadow-sm">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span
            className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white', project.iconTone)}
          >
            <FolderKanban className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className={cn('rounded-md border px-2 py-0.5 text-[11px] font-semibold', project.accent)}>
                {KIND_LABELS[project.kind]}
              </span>
              <span className="rounded-md border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {project.status}
              </span>
            </div>
            <h2 className="text-base font-bold leading-tight text-foreground">{project.title}</h2>
          </div>
        </div>

        <p className="mt-2 text-sm leading-6 text-muted-foreground">{project.summary}</p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" size="sm" onClick={onOpen}>
            Enter Project
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={getLabUrl(project)}>
              <Settings2 className="h-4 w-4" />
              Index Lab
            </Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
        >
          {expanded ? 'Hide details' : 'Project details'}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {expanded && (
        <div className="border-t">
          <ProjectDetailSections project={project} />
        </div>
      )}
    </article>
  )
}

function ProjectCatalogPreview({ project, onOpenProject }: { project: ProjectDefinition; onOpenProject: () => void }) {
  return (
    <aside className="hidden min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-sm lg:flex">
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={cn('rounded-md border px-2 py-0.5 text-[11px] font-semibold', project.accent)}>
                {KIND_LABELS[project.kind]}
              </span>
              <span className="rounded-md border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {project.status}
              </span>
            </div>
            <h2 className="text-lg font-bold leading-tight text-foreground">{project.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{project.summary}</p>
          </div>
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white',
              project.iconTone,
            )}
          >
            <FolderKanban className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button type="button" size="sm" onClick={onOpenProject}>
            Enter Project
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={getLabUrl(project)}>
              <Settings2 className="h-4 w-4" />
              Open in Index Lab
            </Link>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <ProjectDetailSections project={project} />
      </div>
    </aside>
  )
}

function LoadedProjectWorkspace({ project, onBack }: { project: ProjectDefinition; onBack: () => void }) {
  const isMobile = useIsMobile()
  const [activeTab, setActiveTab] = useState<ControllerTab>('project')
  const [activeSceneIndex, setActiveSceneIndex] = useState(0)
  const [rasterOpacity, setRasterOpacity] = useState(82)
  const [visibleLayerIds, setVisibleLayerIds] = useState<Set<string>>(() => defaultVisibleLayerIds(project))
  const [showSidebar, setShowSidebar] = useState(true)
  const [showRightSidebar, setShowRightSidebar] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => clampPanelWidth(320, 320))
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => clampPanelWidth(360, 360))

  const activeScene = project.scenes[activeSceneIndex] ?? project.scenes[0]

  function applyScene(index: number) {
    const scene = project.scenes[index]
    if (!scene) return
    setActiveSceneIndex(index)
    setVisibleLayerIds(new Set(scene.visibleLayerIds))
  }

  function toggleLayer(layerId: string) {
    const layer = project.layers.find((item) => item.id === layerId)
    if (!layer || layer.locked) return
    setVisibleLayerIds((current) => {
      const next = new Set(current)
      if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }

  const leftSidebar = (
    <aside className="flex h-full min-h-0 flex-col border-r bg-background">
      <div className="border-b p-3">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All projects
        </button>

        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white',
              project.iconTone,
            )}
          >
            <FolderKanban className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold leading-tight text-foreground">{project.title}</h1>
            <div className="mt-1 text-xs text-muted-foreground">{project.region}</div>
          </div>
        </div>

        <p className="mt-3 text-xs leading-5 text-muted-foreground">{project.summary}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-4 grid grid-cols-2 gap-2">
          {[
            ['Owner', project.owner],
            ['Updated', project.updated],
            ['Type', KIND_LABELS[project.kind]],
            ['Status', project.status],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border bg-muted/20 px-2.5 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="mt-0.5 truncate text-xs font-semibold text-foreground">{value}</div>
            </div>
          ))}
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            Story Scenes
          </div>
          <div className="space-y-2">
            {project.scenes.map((scene, index) => (
              <button
                key={scene.label}
                type="button"
                onClick={() => applyScene(index)}
                className={cn(
                  'w-full rounded-md border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50',
                  index === activeSceneIndex && 'border-primary bg-primary/5',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{scene.label}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{scene.text}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source Note</div>
          <p className="text-xs leading-5 text-muted-foreground">{project.sourceNote}</p>
        </div>
      </div>

      <div className="border-t p-3">
        <Button asChild size="sm" className="w-full">
          <Link to={getLabUrl(project)}>
            <Settings2 className="h-4 w-4" />
            Open in Index Lab
          </Link>
        </Button>
      </div>
    </aside>
  )

  const rightSidebar = (
    <ProjectController
      project={project}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      visibleLayerIds={visibleLayerIds}
      onLayerToggle={toggleLayer}
      rasterOpacity={rasterOpacity}
      onRasterOpacityChange={setRasterOpacity}
      className="h-full rounded-none border-0 border-l shadow-none"
    />
  )

  const mobileSidebar = (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All projects
        </button>
        <Button asChild size="sm" variant="outline">
          <Link to={getLabUrl(project)}>
            <Settings2 className="h-4 w-4" />
            Index Lab
          </Link>
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            Story Scenes
          </div>
          <div className="grid grid-cols-2 gap-2">
            {project.scenes.map((scene, index) => (
              <button
                key={scene.label}
                type="button"
                onClick={() => applyScene(index)}
                className={cn(
                  'rounded-md border bg-background px-3 py-2 text-left text-sm font-semibold text-foreground transition-colors',
                  index === activeSceneIndex ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                )}
              >
                {scene.label}
              </button>
            ))}
          </div>
          <div className="mt-2 rounded-md border bg-muted/20 p-3">
            <div className="text-sm font-semibold text-foreground">{activeScene.title}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{activeScene.text}</p>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Layers className="h-3.5 w-3.5" />
              Map Stack
            </div>
            <span className="text-xs text-muted-foreground">
              {visibleLayerIds.size}/{project.layers.length}
            </span>
          </div>
          <div className="space-y-2">
            {project.layers.map((layer) => (
              <LayerToggle
                key={layer.id}
                layer={layer}
                visible={visibleLayerIds.has(layer.id)}
                onToggle={() => toggleLayer(layer.id)}
              />
            ))}
          </div>
        </div>

        <div className="rounded-lg border bg-background p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-foreground">Raster Opacity</div>
            <div className="text-xs font-medium text-muted-foreground">{rasterOpacity}%</div>
          </div>
          <Slider
            value={[rasterOpacity]}
            min={20}
            max={100}
            step={5}
            onValueChange={(value) => setRasterOpacity(value[0] ?? rasterOpacity)}
            aria-label="Raster opacity"
          />
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source Note</div>
          <p className="text-xs leading-5 text-muted-foreground">{project.sourceNote}</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-[calc(100vh-4rem)] min-h-[640px]">
      <MapSectionLayout
        sidebar={isMobile ? mobileSidebar : leftSidebar}
        showDesktopSidebar={showSidebar}
        onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
        desktopSidebarWidth={sidebarWidth}
        onDesktopSidebarWidthChange={setSidebarWidth}
        mobileInitialSheetState="collapsed"
        mobilePeek={
          <div className="min-w-0 text-left">
            <div className="truncate text-xs font-semibold text-foreground">{project.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">{activeScene.title}</div>
          </div>
        }
        showMobilePeek
        rightSidebar={rightSidebar}
        showDesktopRightSidebar={showRightSidebar}
        onToggleDesktopRightSidebar={() => setShowRightSidebar((current) => !current)}
        desktopRightSidebarWidth={rightSidebarWidth}
        onDesktopRightSidebarWidthChange={setRightSidebarWidth}
      >
        <div className="relative h-full min-h-0">
          <ProjectMapPreview
            project={project}
            visibleLayerIds={visibleLayerIds}
            rasterOpacity={rasterOpacity}
            className="h-full min-h-0 rounded-none border-0 shadow-none lg:min-h-0"
          />
        </div>
      </MapSectionLayout>
    </div>
  )
}

export default function DevProjects() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectSlug = searchParams.get('project')
  const selectedProject = PROJECTS.find((project) => project.slug === projectSlug) ?? null
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const [previewProjectSlug, setPreviewProjectSlug] = useState(PROJECTS[0]?.slug ?? '')

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return PROJECTS.filter((project) => {
      if (filter !== 'all' && project.kind !== filter) return false
      if (!normalizedQuery) return true
      return `${project.title} ${project.summary} ${project.presetKey}`.toLowerCase().includes(normalizedQuery)
    })
  }, [filter, query])
  const selectedPreviewProject =
    filteredProjects.find((project) => project.slug === previewProjectSlug) ?? filteredProjects[0] ?? null

  function openProject(slug: string) {
    const next = new URLSearchParams(searchParams)
    next.set('project', slug)
    setSearchParams(next)
  }

  function backToCatalog() {
    const next = new URLSearchParams(searchParams)
    next.delete('project')
    setSearchParams(next)
  }

  if (selectedProject) {
    return <LoadedProjectWorkspace project={selectedProject} onBack={backToCatalog} />
  }

  return (
    <ProjectCatalogPage
      query={query}
      onQueryChange={setQuery}
      filter={filter}
      onFilterChange={setFilter}
      filteredProjects={filteredProjects}
      selectedProject={selectedPreviewProject}
      onSelectProject={setPreviewProjectSlug}
      onOpenProject={openProject}
    />
  )
}
