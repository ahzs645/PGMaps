/**
 * A what-if, kept out of the workbook and geodatabase: how much volume would
 * the blocks carry if VRI filled the ground AVAST leaves empty?
 *
 * AVAST's CMM_m3ha is VRI volume at the 17.5 cm utilization level — live plus
 * dead where VRI records dead volume — on stands 60 years and older. So VRI
 * rank-1 is the natural fallback where a block falls outside TimberAnalysis_Base
 * or on its zero-volume polygons. The geometry (which VRI polygon covers which
 * part of a block) is computed once; the volume rules apply afterwards, so
 * changing utilization, dead volume, age or factor never re-runs the overlay.
 * Pure: no DOM or network access.
 */
import RBush from 'rbush'
import { bboxOf, difference, intersect, multiPolygonArea, squareMetresToHa, toMultiPolygon, union } from './geometry'
import type { BBox, Candidate, MultiPolygonCoords, Piece } from './types'

export const VRI_WFS = 'https://openmaps.gov.bc.ca/geo/pub/WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY/ows'
const TYPE_NAME = 'pub:WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY'
/** The layer has 189 attributes; GeoServer will not generalise geometry, so ask for these only. */
const FIELDS = [
  'FEATURE_ID',
  'BCLCS_LEVEL_2',
  'PROJ_AGE_1',
  'SPECIES_CD_1',
  'PROJECTED_DATE',
  'LIVE_STAND_VOLUME_125',
  'LIVE_STAND_VOLUME_175',
  'LIVE_STAND_VOLUME_225',
  'DEAD_STAND_VOLUME_125',
  'DEAD_STAND_VOLUME_175',
  'DEAD_STAND_VOLUME_225',
  'EARLIEST_NONLOGGING_DIST_TYPE',
  'EARLIEST_NONLOGGING_DIST_DATE',
  'GEOMETRY',
]
export const VRI_PAGE_SIZE = 5000

/**
 * VRI rank-1 inside a BC Albers box. The layer's native CRS is EPSG:3005, so
 * the box and the answer stay in projected metres — there is no latitude-first
 * axis order to get wrong, which is what bites `EPSG:4326` WFS queries.
 */
export function vriQueryUrl(box: BBox, startIndex = 0): string {
  const parameters = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: TYPE_NAME,
    outputFormat: 'application/json',
    srsName: 'EPSG:3005',
    count: String(VRI_PAGE_SIZE),
    startIndex: String(startIndex),
    sortBy: 'FEATURE_ID',
    propertyName: FIELDS.join(','),
    CQL_FILTER: `BBOX(GEOMETRY,${box.map((value) => value.toFixed(1)).join(',')},'EPSG:3005')`,
  })
  return `${VRI_WFS}?${parameters.toString()}`
}

export type Utilization = 125 | 175 | 225

export type VriFeature = {
  fid: number
  treed: boolean
  age: number | null
  species: string
  projectedDate: string
  live: Record<Utilization, number | null>
  dead: Record<Utilization, number | null>
  /** VRI's earliest non-logging disturbance, e.g. `IBM` (mountain pine beetle), and its year: the dead volume's year of death. */
  disturbanceType: string
  disturbanceYear: number | null
  geometry: MultiPolygonCoords
  bbox: BBox
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export function vriFeaturesFromGeoJson(collection: GeoJSON.FeatureCollection): VriFeature[] {
  const out: VriFeature[] = []
  for (const feature of collection.features) {
    const geometry = toMultiPolygon(feature.geometry)
    if (!geometry.length) continue
    const p = feature.properties ?? {}
    out.push({
      fid: Number(p.FEATURE_ID ?? feature.id),
      treed: p.BCLCS_LEVEL_2 === 'T',
      age: num(p.PROJ_AGE_1),
      species: String(p.SPECIES_CD_1 ?? ''),
      projectedDate: String(p.PROJECTED_DATE ?? '').replace(/Z$/, ''),
      live: { 125: num(p.LIVE_STAND_VOLUME_125), 175: num(p.LIVE_STAND_VOLUME_175), 225: num(p.LIVE_STAND_VOLUME_225) },
      dead: { 125: num(p.DEAD_STAND_VOLUME_125), 175: num(p.DEAD_STAND_VOLUME_175), 225: num(p.DEAD_STAND_VOLUME_225) },
      disturbanceType: String(p.EARLIEST_NONLOGGING_DIST_TYPE ?? ''),
      disturbanceYear: Number.parseInt(String(p.EARLIEST_NONLOGGING_DIST_DATE ?? ''), 10) || null,
      geometry,
      bbox: bboxOf(geometry),
    })
  }
  return out
}

/**
 * `species`: pine-leading stands at 12.5 cm and everything else at 17.5 cm,
 * the Prince George TSA's merchantability rule. AVAST uses 17.5 cm throughout,
 * which leaves out pine stems between 12.5 and 17.4 cm.
 */
export type UtilizationRule = Utilization | 'species'
/** `shelf`: dead volume discounted by years since death on the TSR shelf-life curve. */
export type DeadRule = 'none' | 'full' | 'shelf'

export type VriRules = {
  utilization: UtilizationRule
  dead: DeadRule
  /** Years since death for dead volume whose stand records no disturbance year. */
  unknownDeathYears: number
  /** Year shelf life is measured to. */
  asOfYear: number
  /** Stands younger than this count as 0 m³/ha. AVAST's own cut-off is 60 years. */
  minAge: number
  treedOnly: boolean
  /** Also refill AVAST pieces that are present but carry 0 m³/ha. */
  fillZeroAvast: boolean
  /** Multiply VRI volume by the run's LiDAR factor, as AVAST volume is. */
  applyFactor: boolean
  /** Blocks whose volume per hectare with VRI falls below this are flagged (PG TSR: 182, 140 for beetle salvage). */
  minimumM3ha: number
}

/**
 * Defaults follow the Prince George TSA rather than AVAST: pine-leading stands
 * at 12.5 cm and dead volume discounted for shelf life. Set utilization 175 and
 * dead `full` to reproduce how AVAST derives CMM_m3ha.
 */
export const DEFAULT_VRI_RULES: VriRules = {
  utilization: 'species',
  dead: 'shelf',
  unknownDeathYears: 10,
  asOfYear: new Date().getFullYear(),
  minAge: 60,
  treedOnly: true,
  fillZeroAvast: true,
  applyFactor: true,
  minimumM3ha: 182,
}

export const isPine = (species: string) => species.toUpperCase().startsWith('P')

/**
 * The Prince George TSR's shelf life for dead pine: all of it in the year of
 * death, 80% the year after, falling linearly to 40% at year 15 and held there.
 */
export function shelfLife(yearsSinceDeath: number): number {
  if (yearsSinceDeath <= 1) return 1
  if (yearsSinceDeath >= 15) return 0.4
  return 0.8 - (0.4 * (yearsSinceDeath - 2)) / 13
}

/**
 * Ground ÷ inventory volume by leading species from the 2018 Prince George TSA
 * VRI audit (180 plots): pine 0.836, spruce 0.946, balsam 1.246, other 1.159.
 * Close to 1.0 overall only because the strata offset each other.
 */
export function auditRatio(species: string): number {
  const code = species.toUpperCase()
  if (code.startsWith('P')) return 0.836
  if (code.startsWith('S')) return 0.946
  if (code.startsWith('B')) return 1.246
  return 1.159
}

export function utilizationFor(feature: Pick<VriFeature, 'species'>, rule: UtilizationRule): Utilization {
  if (rule !== 'species') return rule
  return isPine(feature.species) ? 125 : 175
}

/** m³/ha a VRI polygon contributes under the rules, mirroring how AVAST derives CMM_m3ha by default. */
export function vriDensity(feature: VriFeature, rules: VriRules): number {
  if (rules.treedOnly && !feature.treed) return 0
  if (feature.age === null || feature.age < rules.minAge) return 0
  const utilization = utilizationFor(feature, rules.utilization)
  const live = feature.live[utilization] ?? 0
  const dead = feature.dead[utilization] ?? 0
  if (rules.dead === 'none' || dead === 0) return live
  if (rules.dead === 'full') return live + dead
  const years = feature.disturbanceYear === null ? rules.unknownDeathYears : rules.asOfYear - feature.disturbanceYear
  return live + dead * shelfLife(years)
}

export type VriPiece = {
  candidateKey: string
  /** `uncovered`: ground with no AVAST polygon. `zero`: an AVAST piece at 0 m³/ha. */
  source: 'uncovered' | 'zero'
  fid: number
  areaHa: number
  geometry: MultiPolygonCoords
}

type Item = { minX: number; minY: number; maxX: number; maxY: number; feature: VriFeature }

export function buildVriIndex(features: VriFeature[]) {
  const tree = new RBush<Item>()
  tree.load(
    features.map((feature) => ({
      minX: feature.bbox[0],
      minY: feature.bbox[1],
      maxX: feature.bbox[2],
      maxY: feature.bbox[3],
      feature,
    })),
  )
  return (box: BBox) =>
    tree.search({ minX: box[0], minY: box[1], maxX: box[2], maxY: box[3] }).map((item) => item.feature)
}

/** VRI pieces over the parts of one candidate AVAST does not supply volume for. */
export function vriFillCandidate(
  candidate: Candidate,
  avastPieces: Piece[],
  search: (box: BBox) => VriFeature[],
  minPieceHa: number,
): VriPiece[] {
  const regions: Array<{ source: VriPiece['source']; geometry: MultiPolygonCoords }> = []
  const covered = union(...avastPieces.map((piece) => piece.geometry))
  const uncovered = covered.length ? difference(candidate.geometry, covered) : candidate.geometry
  if (uncovered.length) regions.push({ source: 'uncovered', geometry: uncovered })
  const zero = union(...avastPieces.filter((piece) => piece.density === 0).map((piece) => piece.geometry))
  if (zero.length) regions.push({ source: 'zero', geometry: zero })
  const pieces: VriPiece[] = []
  for (const region of regions) {
    for (const feature of search(bboxOf(region.geometry))) {
      const geometry = intersect(region.geometry, feature.geometry)
      if (!geometry.length) continue
      const areaHa = squareMetresToHa(multiPolygonArea(geometry))
      if (areaHa < minPieceHa) continue
      pieces.push({ candidateKey: candidate.key, source: region.source, fid: feature.fid, areaHa, geometry })
    }
  }
  return pieces
}

export type VriFillTotals = {
  /** Hectares of the block AVAST does not cover that VRI does. */
  uncoveredFillHa: number
  uncoveredFillVolume: number
  /** Hectares of 0 m³/ha AVAST that VRI gives volume, and that volume. */
  zeroFillHa: number
  zeroFillVolume: number
  /** The same fill volume scaled by the PG TSA audit's species ratios. */
  auditFillVolume: number
  /** Hectares of VRI fill at 0 m³/ha under the rules (young, non-treed, no volume). */
  zeroDensityHa: number
}

export function vriFillTotals(
  pieces: VriPiece[],
  byFid: Map<number, VriFeature>,
  rules: VriRules,
  factor: number | null,
): Map<string, VriFillTotals> {
  const scale = rules.applyFactor && factor !== null ? factor : 1
  const totals = new Map<string, VriFillTotals>()
  for (const piece of pieces) {
    if (piece.source === 'zero' && !rules.fillZeroAvast) continue
    const feature = byFid.get(piece.fid)
    const density = feature ? vriDensity(feature, rules) : 0
    const entry = totals.get(piece.candidateKey) ?? {
      uncoveredFillHa: 0,
      uncoveredFillVolume: 0,
      zeroFillHa: 0,
      zeroFillVolume: 0,
      auditFillVolume: 0,
      zeroDensityHa: 0,
    }
    const volume = density * piece.areaHa * scale
    if (feature) entry.auditFillVolume += volume * auditRatio(feature.species)
    if (density <= 0) entry.zeroDensityHa += piece.areaHa
    else if (piece.source === 'uncovered') {
      entry.uncoveredFillHa += piece.areaHa
      entry.uncoveredFillVolume += volume
    } else {
      entry.zeroFillHa += piece.areaHa
      entry.zeroFillVolume += volume
    }
    totals.set(piece.candidateKey, entry)
  }
  return totals
}

/** One line for the workbook's Method & QA sheet saying which VRI rules produced the columns. */
export function describeVriRules(rules: VriRules, factor: number | null, projectedDate: string | null): string {
  const utilization =
    rules.utilization === 'species'
      ? 'pine-leading stands at 12.5 cm, others at 17.5 cm'
      : `${rules.utilization / 10} cm for every stand`
  const dead =
    rules.dead === 'none'
      ? 'dead volume excluded'
      : rules.dead === 'full'
        ? 'all VRI dead volume included'
        : `dead volume on the TSR shelf-life curve to ${rules.asOfYear} (${rules.unknownDeathYears} years assumed where VRI records no disturbance date)`
  return (
    [
      `VRI rank-1 (VEG_COMP_LYR_R1_POLY${projectedDate ? `, projected to ${projectedDate}` : ''}) fills block area AVAST leaves empty${rules.fillZeroAvast ? ' and AVAST pieces at 0 m³/ha' : ''}`,
      `${utilization}; ${dead}; stands ${rules.minAge} years and older${rules.treedOnly ? ', treed polygons only' : ''}`,
      rules.applyFactor && factor !== null ? `scaled by the LiDAR factor ${factor.toFixed(4)}` : 'no factor applied',
      `blocks below ${rules.minimumM3ha} m³/ha with VRI flagged; audit-adjusted uses the 2018 Prince George TSA VRI audit ratios by leading species`,
    ].join('; ') + '.'
  )
}
