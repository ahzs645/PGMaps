// =============================================================================
// Sewage / PFAS monitoring sites — proportional-circle sample data
// =============================================================================
// Mirrors the Felt Watershed Pollution Map's point layers (e.g. "PFAS sites
// (total PFAS ng/l)"), where circle SIZE encodes a numeric attribute and the
// legend shows graduated circles with max / mid / min value labels.

export const SEWAGE_CENTER: [number, number] = [-122.7497, 53.9171]
export const SEWAGE_DEFAULT_ZOOM = 11.2

export type SewageAttributeId = 'pfas' | 'spillHours'

export interface SewageAttribute {
  id: SewageAttributeId
  label: string
  /** Felt-style legend caption: "{layer name} ({attribute})". */
  caption: string
  unit: string
  color: string
}

export const SEWAGE_ATTRIBUTES: SewageAttribute[] = [
  { id: 'pfas', label: 'Total PFAS', caption: 'PFAS sites (total PFAS ng/l)', unit: 'ng/l', color: 'hsl(320, 55%, 52%)' },
  { id: 'spillHours', label: 'Spill hours', caption: 'Sewage discharge sites (annual spill hours)', unit: 'hrs', color: 'hsl(3, 62%, 52%)' },
]

export interface SewageSiteProperties {
  id: string
  name: string
  pfas: number
  spillHours: number
  dischargeType: string
  receivingWater: string
  properties: Array<{ label: string; value: string }>
}

export type SewageSite = GeoJSON.Feature<GeoJSON.Point, SewageSiteProperties>

const DISCHARGE_TYPES = ['Storm overflow', 'Treated effluent', 'Industrial', 'Agricultural']
const RECEIVING_WATERS = ['Fraser River', 'Nechako River', 'Hudson Bay Slough', 'Lheidli Creek', 'Willow River']

const LNG_MIN = -122.86
const LNG_MAX = -122.66
const LAT_MIN = 53.86
const LAT_MAX = 53.96
const SITE_COUNT = 48

/** Deterministic 0..1 pseudo-random so site positions/values are stable. */
function pseudo(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function makeSite(i: number): SewageSite {
  const lng = LNG_MIN + pseudo(i * 2 + 1) * (LNG_MAX - LNG_MIN)
  const lat = LAT_MIN + pseudo(i * 2 + 2) * (LAT_MAX - LAT_MIN)
  const pfas = Math.round(10 + pseudo(i + 17) ** 2 * 4920)
  const spillHours = Math.round(pseudo(i + 53) ** 1.7 * 1400)
  const dischargeType = DISCHARGE_TYPES[Math.floor(pseudo(i + 101) * DISCHARGE_TYPES.length) % DISCHARGE_TYPES.length]
  const receivingWater = RECEIVING_WATERS[Math.floor(pseudo(i + 211) * RECEIVING_WATERS.length) % RECEIVING_WATERS.length]
  const id = `site-${i + 1}`

  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: {
      id,
      name: `Outfall PG-${String(i + 1).padStart(2, '0')}`,
      pfas,
      spillHours,
      dischargeType,
      receivingWater,
      properties: [
        { label: 'Total PFAS', value: `${pfas.toLocaleString()} ng/l` },
        { label: 'Annual spill hours', value: `${spillHours.toLocaleString()} hrs` },
        { label: 'Discharge type', value: dischargeType },
        { label: 'Receiving water', value: receivingWater },
        { label: 'Monitoring', value: 'Active' },
      ],
    },
  }
}

export const siteFeatures: GeoJSON.FeatureCollection<GeoJSON.Point, SewageSiteProperties> = {
  type: 'FeatureCollection',
  features: Array.from({ length: SITE_COUNT }, (_, i) => makeSite(i)),
}

/** [min, max] of a numeric attribute across all sites. */
export function attributeDomain(attribute: SewageAttributeId): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const feature of siteFeatures.features) {
    const value = feature.properties[attribute]
    if (value < lo) lo = value
    if (value > hi) hi = value
  }
  return [lo, hi]
}

/** Area-proportional circle radius (px) for a value within a domain. */
export function radiusFor(value: number, domain: [number, number], minPx: number, maxPx: number): number {
  const [lo, hi] = domain
  if (hi <= lo) return (minPx + maxPx) / 2
  const t = (Math.sqrt(Math.max(value, lo)) - Math.sqrt(lo)) / (Math.sqrt(hi) - Math.sqrt(lo))
  return minPx + Math.max(0, Math.min(1, t)) * (maxPx - minPx)
}

/** Compact label like Felt's legend: 4930 → "4.93K", 10 → "10". */
export function formatCompact(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2).replace(/\.?0+$/, '')}K`
  }
  return String(Math.round(value))
}
