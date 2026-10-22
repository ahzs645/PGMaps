// ISED spectrum-licence sites, scraped by vendor/canadadatamapper
// (datascrapers/ised/cell-sites) and synced to /data/canada/cell-sites.

export const CELL_SITES_URL = '/data/canada/cell-sites/cell-sites.geojson.gz'
export const CELL_SITES_MANIFEST_URL = '/data/canada/cell-sites/manifest.json'

export type CellSiteProperties = {
  province: string | null
  location: string | null
  /** `O` outdoor, `I` indoor. */
  siteTypes: string[]
  /** As filed: `T` tower and `R` rooftop are clear; others are not decoded. */
  structureTypes: string[]
  heightM: number | null
  lastChanged: string | null
  operators: string[]
  technologies: string[]
  /** ISED licence_category codes. */
  bands: string[]
  records: number
  byOperator: Record<string, { technologies: string[]; bands: string[] }>
}

export type CellSiteFeature = GeoJSON.Feature<GeoJSON.Point, CellSiteProperties>
export type CellSiteCollection = GeoJSON.FeatureCollection<GeoJSON.Point, CellSiteProperties>

export type CellSitesManifest = {
  sites?: number
  attribution?: string
  caveat?: string
  source?: { extractDate?: string | null; pageUrl?: string }
  operators?: Record<string, number>
  output?: { bytes?: number }
}

export type CellSiteOperatorGroup = {
  id: string
  label: string
  color: [number, number, number]
}

/** Order is draw priority: a shared mast takes the colour of the first visible group. */
export const CELL_SITE_OPERATOR_GROUPS: CellSiteOperatorGroup[] = [
  { id: 'Bell', label: 'Bell', color: [0, 84, 166] },
  { id: 'TELUS', label: 'TELUS', color: [102, 51, 153] },
  { id: 'Rogers', label: 'Rogers', color: [218, 41, 28] },
  { id: 'Vidéotron', label: 'Vidéotron', color: [234, 179, 8] },
  { id: 'Freedom', label: 'Freedom', color: [234, 88, 12] },
  { id: 'SaskTel', label: 'SaskTel', color: [22, 163, 74] },
  { id: 'Eastlink', label: 'Eastlink', color: [8, 145, 178] },
  { id: 'other', label: 'Other licensees', color: [100, 116, 139] },
]

const NAMED_GROUPS = new Set(CELL_SITE_OPERATOR_GROUPS.map((group) => group.id).filter((id) => id !== 'other'))

export function operatorGroupId(operator: string) {
  return NAMED_GROUPS.has(operator) ? operator : 'other'
}

/** Visible groups present at a site, in draw-priority order. */
export function visibleGroupsAtSite(properties: CellSiteProperties, visible: ReadonlySet<string>) {
  const present = new Set(properties.operators.map(operatorGroupId))
  return CELL_SITE_OPERATOR_GROUPS.filter((group) => visible.has(group.id) && present.has(group.id))
}

export function filterCellSites(collection: CellSiteCollection | null, visible: ReadonlySet<string>) {
  if (!collection || !visible.size) return []
  return collection.features.filter((feature) => visibleGroupsAtSite(feature.properties, visible).length > 0)
}

/** Wedge colours for MapPieClusterLayer, in CELL_SITE_OPERATOR_GROUPS order. */
export const CELL_SITE_BAND_COLORS = CELL_SITE_OPERATOR_GROUPS.map(
  ({ color }) => `#${color.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`,
)

/**
 * Pre-aggregated pie input: each site counts once (`count`, the donut's centre
 * number) and adds one to every visible group on its mast (`bandCounts`), so a
 * shared mast contributes a wedge to each operator on it. MapLibre stringifies
 * nested properties, so detail lookups go through `siteIndex` into `sites`.
 */
export function cellSitePieData(
  sites: readonly CellSiteFeature[],
  visible: ReadonlySet<string>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: sites.map((site, siteIndex) => {
      const groups = visibleGroupsAtSite(site.properties, visible)
      const present = new Set(groups.map((group) => group.id))
      return {
        type: 'Feature',
        geometry: site.geometry,
        properties: {
          siteIndex,
          count: 1,
          bandCounts: CELL_SITE_OPERATOR_GROUPS.map((group) => (present.has(group.id) ? 1 : 0)),
          color: CELL_SITE_BAND_COLORS[CELL_SITE_OPERATOR_GROUPS.indexOf(groups[0])],
          spiderTitle: site.properties.operators.join(' · '),
          spiderSubtitle: [site.properties.location, site.properties.technologies.join(', ')].filter(Boolean).join(' · '),
        },
      }
    }),
  }
}

/** Sites per group, counting a shared mast once for each group on it. */
export function countSitesByGroup(manifest: CellSitesManifest | null) {
  const counts = new Map<string, number>()
  for (const [operator, sites] of Object.entries(manifest?.operators ?? {})) {
    const id = operatorGroupId(operator)
    counts.set(id, (counts.get(id) ?? 0) + sites)
  }
  return counts
}

const STRUCTURE_LABELS: Record<string, string> = { T: 'Tower', R: 'Rooftop' }
const SITE_TYPE_LABELS: Record<string, string> = { O: 'Outdoor', I: 'Indoor' }

export function cellSiteTooltipRows(properties: CellSiteProperties): Array<[string, string | number | null]> {
  return [
    ...properties.operators.map((operator): [string, string] => {
      const detail = properties.byOperator[operator]
      return [operator, [detail?.technologies.join(', '), detail?.bands.join(', ')].filter(Boolean).join(' · ')]
    }),
    ['Location', properties.location],
    ['Site', properties.siteTypes.map((code) => SITE_TYPE_LABELS[code] ?? code).join(' / ')],
    [
      'Structure',
      [
        properties.structureTypes.map((code) => STRUCTURE_LABELS[code] ?? code).join(' / '),
        properties.heightM ? `${properties.heightM} m` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    ],
    ['Last changed', properties.lastChanged],
    ['ISED records', properties.records],
  ]
}
