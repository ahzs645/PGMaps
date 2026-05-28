import { FileImage, FileText } from 'lucide-react'
import { MAP_STYLES } from '@/components/ui/map-styles'
import type { AqBasemap } from './monitorPresentation'
import type { ExportFormat } from './exportMap'

export const URL_UPDATE_DELAY_MS = 350

export const FIRE_DANGER_VECTOR_URL = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=public:fdr_current_shp&outputFormat=application/json&srsName=EPSG:4326'

export const FIRE_DANGER_FILL_COLORS: Record<number, string> = {
  0: '#0000ff',
  1: '#00b050',
  2: '#ffff00',
  3: '#ff9900',
  4: '#ff0000',
}

export const AQHI_STOPS: Array<{ color: string; labelKey: string; rangeKey: string }> = [
  { color: '#3bb54a', labelKey: 'aqhi.low', rangeKey: 'aqhi.range.low' },
  { color: '#f7d13d', labelKey: 'aqhi.moderate', rangeKey: 'aqhi.range.moderate' },
  { color: '#f59e0b', labelKey: 'aqhi.high', rangeKey: 'aqhi.range.high' },
  { color: '#c81e1e', labelKey: 'aqhi.veryHigh', rangeKey: 'aqhi.range.veryHigh' },
]

export const EXPORT_OPTIONS: Array<{ format: ExportFormat; labelKey: string; icon: typeof FileImage }> = [
  { format: 'png', labelKey: 'export.png', icon: FileImage },
  { format: 'pngOverlay', labelKey: 'export.pngWithOverlays', icon: FileImage },
  { format: 'jpeg', labelKey: 'export.jpeg', icon: FileImage },
  { format: 'pdf', labelKey: 'export.pdf', icon: FileText },
]

export const BASEMAP_STYLES: Record<AqBasemap, { light: string; dark: string }> = {
  light: {
    light: MAP_STYLES.light,
    dark: MAP_STYLES.light,
  },
  dark: {
    light: MAP_STYLES.dark,
    dark: MAP_STYLES.dark,
  },
}
