import { CloudFog, Flame, Map, Wind } from 'lucide-react'

export type WmsLayerKey = 'surfaceWinds' | 'modelledPm25' | 'activeFires' | 'firePerimeters' | 'fireDanger' | 'forecastZones'

export interface WmsLayerDefinition {
  key: WmsLayerKey
  label: string
  icon: typeof Wind
  tiles: string[]
  opacity: number
  attribution: string
  legendUrl?: string
  legendRenderer?: 'image' | 'structured'
  legendPosition?: 'bottomleft' | 'bottomright' | 'topleft' | 'topright'
}

export const WMS_LAYERS: WmsLayerDefinition[] = [
  {
    key: 'surfaceWinds',
    label: 'Surface Winds',
    icon: Wind,
    tiles: [
      'https://geo.weather.gc.ca/geomet?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=HRDPS.CONTINENTAL_UU&STYLES=WindBarbs_Sfc&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.6,
    attribution: 'ECCC GeoMet',
    legendUrl: 'https://aqmap.ca/aqmap/dev/icons/windbarbs_legend.jpg',
    legendPosition: 'bottomleft',
  },
  {
    key: 'modelledPm25',
    label: 'Modelled PM2.5',
    icon: CloudFog,
    tiles: [
      'https://geo.weather.gc.ca/geomet?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=RAQDPS.SFC_PM2.5&STYLES=RAQDPS-SFC-PM_UGM3_BCAQHI&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.6,
    attribution: 'ECCC GeoMet',
    legendUrl: 'https://geo.weather.gc.ca/geomet?SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.1.1&LAYER=RAQDPS.SFC_PM2.5&STYLE=RAQDPS-SFC-PM_UGM3_BCAQHI&FORMAT=image/png',
    legendPosition: 'bottomleft',
  },
  {
    key: 'activeFires',
    label: 'Active Fires',
    icon: Flame,
    tiles: [
      'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=public:activefires_current&STYLES=public:cwfis_activefires&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.6,
    attribution: 'Natural Resources Canada CWFIS',
    legendUrl: 'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.1.1&LAYER=public:activefires_current&STYLE=public:cwfis_activefires&FORMAT=image/png',
    legendPosition: 'bottomright',
  },
  {
    key: 'firePerimeters',
    label: 'Fire Perimeters',
    icon: Flame,
    tiles: [
      'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=m3_polygons_current&STYLES=cwfis_m3_polygons&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.6,
    attribution: 'Natural Resources Canada CWFIS',
    legendUrl: 'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.1.1&LAYER=m3_polygons_current&STYLE=cwfis_m3_polygons&FORMAT=image/png',
    legendPosition: 'bottomright',
  },
  {
    key: 'fireDanger',
    label: 'Fire Danger',
    icon: Flame,
    tiles: [
      'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=public:fdr_current&STYLES=public:cffdrs_fdr&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.6,
    attribution: 'Natural Resources Canada CWFIS',
    legendUrl: 'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.1.1&LAYER=public:fdr_current&STYLE=public:cffdrs_fdr&FORMAT=image/png',
    legendRenderer: 'structured',
    legendPosition: 'bottomright',
  },
  {
    key: 'forecastZones',
    label: 'Forecast Zones',
    icon: Map,
    tiles: [
      'https://geo.weather.gc.ca/geomet?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=Public-Standard-Forecast-Zones&STYLES=Public-Standard-Forecast-Zones&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.78,
    attribution: 'ECCC GeoMet',
    legendUrl: 'https://geo.weather.gc.ca/geomet?SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.1.1&LAYER=Public-Standard-Forecast-Zones&STYLE=Public-Standard-Forecast-Zones&FORMAT=image/png',
    legendPosition: 'bottomleft',
  },
]
