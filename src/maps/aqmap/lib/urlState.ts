import { WMS_LAYERS, type WmsLayerKey } from './wmsLayers'
import { SMOKE_LAYERS, type SmokeLayerKey } from './smokeLayers'
import type { AqBasemap, AqMonitorGroup } from './monitorPresentation'
import type { AqmapLocale } from './i18n'
import {
  isMapViewValid,
  parseMapViewHash,
  parseNumberField,
  parseZoomField,
  serializeMapViewHash,
  type MapViewState,
  type MapViewUrlOptions,
} from '@/components/ui/map-url-state'

export const CANADA_CENTER: [number, number] = [-96, 56]
export const MIN_ZOOM = 2
export const MAX_ZOOM = 16
export const DEFAULT_ZOOM = 3.1

/** Shared compact-hash format config (zoom 2dp, lng/lat 4dp, zoom clamp 2-16). */
const AQ_VIEW_OPTIONS: MapViewUrlOptions = {
  defaultView: { center: CANADA_CENTER, zoom: DEFAULT_ZOOM },
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
}

export type AqMapView = MapViewState

export interface AqUrlState {
  basemap: AqBasemap
  visibleGroups: Set<AqMonitorGroup>
  visibleWmsLayers: Set<WmsLayerKey>
  visibleSmokeLayers: Set<SmokeLayerKey>
  selectedTimestamp: string
  mapView: AqMapView
  locale: AqmapLocale
}

function parseLocale(value: string | null): AqmapLocale {
  return value === 'fr' ? 'fr' : 'en'
}

const GROUP_IDS: Record<AqMonitorGroup, string> = {
  agency: 'L1',
  lcm: 'L2',
  other: 'L3',
}

const WMS_IDS: Record<WmsLayerKey, string> = WMS_LAYERS.reduce((acc, layer, index) => {
  acc[layer.key] = `L${index + 4 + SMOKE_LAYERS.length}`
  return acc
}, {} as Record<WmsLayerKey, string>)

const SMOKE_IDS: Record<SmokeLayerKey, string> = SMOKE_LAYERS.reduce((acc, layer, index) => {
  acc[layer.key] = `L${index + 4}`
  return acc
}, {} as Record<SmokeLayerKey, string>)

const BASEMAP_IDS: Record<AqBasemap, string> = {
  light: 'B1',
  dark: 'B2',
  topographic: 'B3',
}

function parseBasemap(value: string | null): AqBasemap {
  return value === 'dark' || value === 'topographic' ? value : 'light'
}

function parseZoom(value: string | null): number {
  return parseZoomField(value, AQ_VIEW_OPTIONS)
}

export function isValidMapView(view: AqMapView): boolean {
  return isMapViewValid(view, AQ_VIEW_OPTIONS)
}

function parseGroups(value: string | null): Set<AqMonitorGroup> {
  const allowed = new Set<AqMonitorGroup>(['agency', 'lcm', 'other'])
  const parsed = (value ?? 'agency,lcm')
    .split(',')
    .filter((item): item is AqMonitorGroup => allowed.has(item as AqMonitorGroup))
  return new Set(parsed.length > 0 ? parsed : ['agency', 'lcm'])
}

function parseWmsLayers(value: string | null): Set<WmsLayerKey> {
  const allowed = new Set<WmsLayerKey>(WMS_LAYERS.map((layer) => layer.key))
  const parsed = (value ?? '')
    .split(',')
    .filter((item): item is WmsLayerKey => allowed.has(item as WmsLayerKey))
  return new Set(parsed)
}

function parseSmokeLayers(value: string | null): Set<SmokeLayerKey> {
  const allowed = new Set<SmokeLayerKey>(SMOKE_LAYERS.map((layer) => layer.key))
  const parsed = (value ?? '')
    .split(',')
    .filter((item): item is SmokeLayerKey => allowed.has(item as SmokeLayerKey))
  return new Set(parsed)
}

export function serializeSet<T extends string>(set: Set<T>): string {
  return Array.from(set).sort().join(',')
}

function parseQueryState(searchParams: URLSearchParams): AqUrlState {
  return {
    basemap: parseBasemap(searchParams.get('basemap')),
    visibleGroups: parseGroups(searchParams.get('groups')),
    visibleWmsLayers: parseWmsLayers(searchParams.get('wms')),
    visibleSmokeLayers: parseSmokeLayers(searchParams.get('smoke')),
    selectedTimestamp: searchParams.get('time') ?? '',
    mapView: {
      center: [
        parseNumberField(searchParams.get('lng'), CANADA_CENTER[0]),
        parseNumberField(searchParams.get('lat'), CANADA_CENTER[1]),
      ],
      zoom: parseZoom(searchParams.get('z')),
    },
    locale: parseLocale(searchParams.get('lang')),
  }
}

export function parseAqmapHash(hash: string, searchParams: URLSearchParams): AqUrlState {
  const fallback = parseQueryState(searchParams)
  const parsed = parseMapViewHash(hash, AQ_VIEW_OPTIONS)
  if (!parsed) return fallback

  const { view, codes: layerParts } = parsed
  const basePart = layerParts.find((part) => part.startsWith('B'))
  const groupIdEntries = Object.entries(GROUP_IDS) as Array<[AqMonitorGroup, string]>
  const wmsIdEntries = Object.entries(WMS_IDS) as Array<[WmsLayerKey, string]>
  const smokeIdEntries = Object.entries(SMOKE_IDS) as Array<[SmokeLayerKey, string]>

  const visibleGroups = new Set(
    groupIdEntries
      .filter(([, id]) => layerParts.includes(id))
      .map(([group]) => group),
  )
  const visibleWmsLayers = new Set(
    wmsIdEntries
      .filter(([, id]) => layerParts.includes(id))
      .map(([key]) => key),
  )
  const visibleSmokeLayers = new Set(
    smokeIdEntries
      .filter(([, id]) => layerParts.includes(id))
      .map(([key]) => key),
  )

  return {
    basemap:
      basePart === BASEMAP_IDS.dark
        ? 'dark'
        : basePart === BASEMAP_IDS.topographic
          ? 'topographic'
          : 'light',
    visibleGroups: visibleGroups.size > 0 ? visibleGroups : fallback.visibleGroups,
    visibleWmsLayers,
    visibleSmokeLayers,
    selectedTimestamp: fallback.selectedTimestamp,
    mapView: view,
    locale: fallback.locale,
  }
}

export function serializeAqmapHash(state: AqUrlState): string {
  const codes = [
    BASEMAP_IDS[state.basemap],
    ...Array.from(state.visibleGroups).map((group) => GROUP_IDS[group]),
    ...Array.from(state.visibleWmsLayers).map((layer) => WMS_IDS[layer]),
    ...Array.from(state.visibleSmokeLayers).map((layer) => SMOKE_IDS[layer]),
  ]

  return serializeMapViewHash(state.mapView, codes, AQ_VIEW_OPTIONS)
}
