/**
 * Groups the features rendered under a map point for the map menu's *What's here?* card: the
 * page's own layers first, then whatever the basemap draws there. No DOM or network access.
 */

/** The parts of a MapLibre rendered feature this module reads. */
export interface RenderedFeatureLike {
  id?: string | number
  properties?: Record<string, unknown> | null
  source?: string
  sourceLayer?: string
  layer?: { id: string; type?: string; source?: string; 'source-layer'?: string }
}

/** The parts of a MapLibre source specification used to tell a basemap source from page data. */
export interface SourceSpecLike {
  type?: string
  url?: string
  tiles?: readonly string[]
}

export interface WhatsHereFeature {
  key: string
  title: string
  /** Up to `MAX_PROPERTIES` attribute rows, in the source's order. */
  rows: Array<[string, string]>
  /** How many rows were left out. */
  hiddenRows: number
}

export interface WhatsHereGroup {
  key: string
  label: string
  basemap: boolean
  features: WhatsHereFeature[]
}

export const MAX_FEATURES = 40
export const MAX_PROPERTIES = 12

/** Hosts that serve the basemap styles PGMaps draws under its data. */
const BASEMAP_HOSTS = [
  'cartocdn.com',
  'openfreemap.org',
  'maptiler.com',
  'arcgisonline.com',
  'arcgis.com',
  'protomaps.com',
  'stadiamaps.com',
  'openstreetmap.org',
  'versatiles.org',
]

/** True when a source's tiles come from a basemap provider rather than the page's own data. */
export function isBasemapSource(spec: SourceSpecLike | undefined): boolean {
  if (!spec) return false
  const urls = [spec.url, ...(spec.tiles ?? [])].filter((url): url is string => typeof url === 'string')
  return urls.some((url) => BASEMAP_HOSTS.some((host) => hostOf(url).endsWith(host)))
}

function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url)
  return match ? match[1].toLowerCase().replace(/:\d+$/, '') : ''
}

/** Layers drawn only to show a state (a hover ring, a selection halo): never a feature of their own. */
const STATE_LAYER = /(^|[-_])(hover|hovered|highlight|highlighted|selected|selection|halo|hit|hitbox|focus)([-_]|$)/i
/** Endings that name the drawing rather than the data: "parks-fill" and "parks-outline" are both "Parks". */
const DRAWING_SUFFIX =
  /([-_](fill|line|outline|stroke|circle|circles|symbol|symbols|label|labels|points|point|layer|extrusion|casing|icon|icons))+$/i

/** A readable name for a layer id: `bc-parks-fill` → `Bc parks`. */
export function layerLabel(layerId: string): string {
  const stem = layerId.replace(DRAWING_SUFFIX, '') || layerId
  const words = stem
    .replace(/[-_.:]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : layerId
}

const TITLE_KEYS = [
  'name',
  'title',
  'label',
  'name_en',
  'name:en',
  'NAME',
  'Name',
  'TITLE',
  'PROTECTED_LANDS_NAME',
  'FEATURE_NAME',
  'ADDRESS',
  'address',
  'class',
  'type',
]

/** A short title: the first name-like attribute, else the feature id, else the layer's name. */
export function featureTitle(feature: RenderedFeatureLike, fallback: string): string {
  const properties = feature.properties ?? {}
  for (const key of TITLE_KEYS) {
    const value = properties[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  if (feature.id !== undefined && feature.id !== null && feature.id !== '') return `${fallback} ${feature.id}`
  return fallback
}

/** An attribute value as text; nested objects as compact JSON, cut to a line. */
export function formatAttribute(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(8)))
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

/**
 * The features under a point, grouped by layer name with duplicates dropped (a polygon drawn as a
 * fill and an outline counts once). Page layers come first in drawing order (topmost first), and
 * the basemap's features follow in one group.
 */
export function groupWhatsHere(
  features: readonly RenderedFeatureLike[],
  sources: Readonly<Record<string, SourceSpecLike | undefined>>,
): WhatsHereGroup[] {
  const groups = new Map<string, WhatsHereGroup>()
  const seen = new Set<string>()
  let count = 0
  for (const feature of features) {
    if (count >= MAX_FEATURES) break
    const layerId = feature.layer?.id ?? ''
    if (!layerId || STATE_LAYER.test(layerId)) continue
    const sourceId = feature.source ?? feature.layer?.source ?? ''
    const sourceLayer = feature.sourceLayer ?? feature.layer?.['source-layer'] ?? ''
    const basemap = isBasemapSource(sources[sourceId])
    const identity =
      feature.id !== undefined && feature.id !== null
        ? `id:${String(feature.id)}`
        : `p:${JSON.stringify(feature.properties ?? {})}`
    const featureKey = `${sourceId}\u0000${sourceLayer}\u0000${identity}`
    if (seen.has(featureKey)) continue
    seen.add(featureKey)

    const label = basemap ? 'Basemap' : layerLabel(layerId)
    const groupKey = basemap ? 'basemap' : `layer:${label}`
    let group = groups.get(groupKey)
    if (!group) {
      group = { key: groupKey, label, basemap, features: [] }
      groups.set(groupKey, group)
    }
    const entries = Object.entries(feature.properties ?? {})
    const fallback = basemap ? layerLabel(sourceLayer || layerId) : label
    group.features.push({
      key: featureKey,
      title:
        basemap && sourceLayer
          ? `${featureTitle(feature, fallback)} · ${layerLabel(sourceLayer)}`
          : featureTitle(feature, fallback),
      rows: entries.slice(0, MAX_PROPERTIES).map(([key, value]) => [key, formatAttribute(value)]),
      hiddenRows: Math.max(0, entries.length - MAX_PROPERTIES),
    })
    count++
  }
  const list = [...groups.values()]
  return [...list.filter((group) => !group.basemap), ...list.filter((group) => group.basemap)]
}
