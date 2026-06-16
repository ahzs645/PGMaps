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
      '/data/geomet/pm25?bbox={bbox-epsg-3857}',
    ],
    opacity: 0.6,
    attribution: 'ECCC GeoMet',
    legendUrl: 'https://geo.weather.gc.ca/geomet?SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.1.1&LAYER=RAQDPS.SFC_PM2.5&STYLE=PM2.5_0to100ugm3_Dis&FORMAT=image/png',
    legendRenderer: 'structured',
    legendPosition: 'bottomleft',
  },
  {
    key: 'activeFires',
    label: 'Active Fires',
    icon: Flame,
    tiles: [
      'https://geoserver.cwfif.nrcan.gc.ca/geoserver/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=public:cwfif_national_activefires&STYLES=&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    ],
    opacity: 0.6,
    attribution: 'Natural Resources Canada CWFIS',
    legendUrl: 'https://geoserver.cwfif.nrcan.gc.ca/geoserver/wms?REQUEST=GetLegendGraphic&FORMAT=image%2Fpng&WIDTH=20&HEIGHT=20&LAYER=public%3Acwfif_national_activefires&TRANSPARENT=true',
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
    legendPosition: 'bottomleft',
  },
]
