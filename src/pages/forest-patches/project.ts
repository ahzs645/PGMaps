import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import order from '../../../packages/legal-rules/rules/bc/prince-george/2004-biodiversity-order.json'

export { order }
export const table = order.youngForestPatchDistribution
export type Bin = keyof (typeof table.targets)[number]['percent']
export const bins = table.bins as Bin[]
export const scenarios = ['reference', 'proposed', 'alternative'] as const
export type Scenario = (typeof scenarios)[number]
const yearBases = ['editor-default', 'source-attribute', 'plan-entry'] as const
type YearBasis = (typeof yearBases)[number]
export type Footprint = Feature<
  Polygon | MultiPolygon,
  { id: string; scenario: Scenario; year: number; source?: string; yearBasis?: YearBasis }
>
export function disturbanceBasis(feature: Footprint) {
  switch (feature.properties.yearBasis) {
    case 'editor-default':
      return 'Source year missing · editor fallback'
    case 'source-attribute':
      return 'Year supplied by the imported feature'
    case 'plan-entry':
      return 'Year entered in the plan'
    default:
      return 'Origin of date unrecorded'
  }
}
export type Project = FeatureCollection<Footprint['geometry'], Footprint['properties']> & {
  format: 'pgmaps-patches-v1'
  district: string
  ndu: string
  source: string
  startYear: number
  applicabilityEvidence?: string
  rationale?: string
  /**
   * A reporting unit (WGS84). When set, patches are built from every footprint, inside the unit and
   * beyond it, each is classed by its whole size, and only its young area inside the unit counts.
   * Absent, every footprint counts in full, as before.
   */
  countWithin?: Polygon | MultiPolygon
}
export const districts = ['Fort St. James', 'Prince George', 'Vanderhoof']
export const periodYears = (start: number) => Array.from({ length: 11 }, (_, i) => start + i * 5)
function rectangle(west: number, south: number, width: number, height: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [west + width, south],
        [west + width, south + height],
        [west, south + height],
        [west, south],
      ],
    ],
  }
}
export function exampleProject(): Project {
  const block = (id: string, scenario: Scenario, year: number, west: number, south: number): Footprint => ({
    type: 'Feature',
    properties: { id, scenario, year, yearBasis: 'plan-entry' },
    geometry: rectangle(west, south, 0.009, 0.005),
  })
  return {
    format: 'pgmaps-patches-v1',
    type: 'FeatureCollection',
    startYear: 2026,
    district: 'Prince George',
    ndu: 'Moist Interior - Mountain',
    source: 'Synthetic demonstration near Prince George. Reporting unit selected for illustration.',
    features: [
      block('Opening A', 'reference', 2011, -122.78, 53.99),
      block('Opening B', 'reference', 2021, -122.755, 53.991),
      block('Harvest now', 'proposed', 2026, -122.7701, 53.99),
      block('Harvest later', 'alternative', 2036, -122.7701, 53.99),
    ],
  }
}
export function emptyProject(): Project {
  return {
    format: 'pgmaps-patches-v1',
    type: 'FeatureCollection',
    startYear: new Date().getFullYear(),
    district: '',
    ndu: '',
    source: 'User plan; inventory coverage unverified.',
    features: [],
  }
}
function validRing(ring: Position[]) {
  if (!Array.isArray(ring) || ring.length < 4) return false
  const valid = ring.every(
    (p) =>
      Array.isArray(p) &&
      p.length >= 2 &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1]) &&
      p[0] >= -140 &&
      p[0] <= -114 &&
      p[1] >= 48 &&
      p[1] <= 61,
  )
  return valid && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]
}
export function parseProject(value: unknown): Project {
  const p = value as Project | null
  if (
    p?.format !== 'pgmaps-patches-v1' ||
    p.type !== 'FeatureCollection' ||
    !Array.isArray(p.features) ||
    (p.district !== '' && !districts.includes(p.district)) ||
    (p.ndu !== '' && !table.targets.some((t) => t.ndu === p.ndu)) ||
    typeof p.source !== 'string' ||
    !p.source.trim() ||
    (p.rationale !== undefined && typeof p.rationale !== 'string') ||
    (p.applicabilityEvidence !== undefined && typeof p.applicabilityEvidence !== 'string') ||
    !Number.isInteger(p.startYear) ||
    p.startYear < 1800 ||
    p.startYear > 2200
  ) {
    throw new Error('Use a patch project with a start year, source, historic district and Table 7 sub-unit.')
  }
  const ids = new Set<string>()
  for (const f of p.features) {
    const props = f?.properties
    if (
      f?.type !== 'Feature' ||
      !props ||
      typeof props.id !== 'string' ||
      !props.id.trim() ||
      ids.has(props.id) ||
      (props.yearBasis !== undefined && !yearBases.includes(props.yearBasis)) ||
      (props.source !== undefined && typeof props.source !== 'string') ||
      !scenarios.includes(props.scenario) ||
      !Number.isInteger(props.year) ||
      props.year < 1600 ||
      props.year > 2250
    ) {
      throw new Error('Each footprint needs a unique ID, scenario and disturbance year (1600–2250).')
    }
    ids.add(props.id)
    const g = f.geometry
    const parts = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []
    if (
      !Array.isArray(parts) ||
      !parts.length ||
      !parts.every((poly) => Array.isArray(poly) && poly.length && poly.every(validRing))
    ) {
      throw new Error('Use closed WGS84 Polygon or MultiPolygon rings within British Columbia.')
    }
  }
  return p
}

// Positive means the class moved closer, even if it crossed the target.
export function movementTowardTarget(before: number | null, after: number | null, target: number) {
  if (before === null || after === null) return null
  return Math.abs(before - target) - Math.abs(after - target)
}

// Plain GIS layers append to one reporting unit. Explicit per-feature values take
// precedence over the editor defaults. Reject invalid values instead of guessing.
export function importLayer(
  project: Project,
  value: unknown,
  fileName: string,
  year: number,
  scenario: Scenario,
): Project {
  const collection = value as { type?: string; features?: Footprint[]; format?: string }
  if (!collection || collection.format) throw new Error('Use Open project for a saved assessment unit.')
  const features =
    collection.type === 'Feature'
      ? [value as Footprint]
      : collection.type === 'FeatureCollection'
        ? collection.features
        : undefined
  if (!Array.isArray(features) || !features.length) throw new Error('A GeoJSON layer must contain polygon features.')
  const appended = features.map((f, i) => {
    const props = f?.properties
    return {
      type: 'Feature',
      geometry: f?.geometry,
      properties: {
        id: String(props?.id ?? f?.id ?? fileName + ' #' + (i + 1)),
        year: props?.year ?? year,
        yearBasis: props?.year == null ? 'editor-default' : (props.yearBasis ?? 'source-attribute'),
        scenario: props?.scenario ?? scenario,
        source: fileName,
      },
    }
  })
  return parseProject({ ...project, features: [...project.features, ...appended] })
}
