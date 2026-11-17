/**
 * Drought risk to the landform's standing timber: the BEC unit and treed species mix under the
 * active landform, read against BC's published forDRAT table (`/dev/forestry/drought-risk`).
 *
 * forDRAT rates drought-related mortality in *mature* stands, so this is context for the timber
 * the view relies on (the green landform, the stand that screens it), never a regeneration or
 * planting judgement, a run input or a change to green-up. Soil moisture regime is a site
 * assessment: it is always the reviewer's choice, never read from the BEC unit or the map.
 * forDRAT's units are BEC v11; the map read here is DataBC's current BEC, so an identifier match
 * does not verify that the boundaries agree, and a unit absent from the table says so.
 *
 * No DOM or network access: `fetch` is passed in, and the inventory stands come from the caller.
 */
import type {
  PublishedDataset,
  PublishedPeriod,
  RiskCode,
  SoilMoistureRegime,
  SpeciesCode,
} from '@/features/forest-drought/published'
import { filterPublishedRows } from '@/features/forest-drought/published'
import type { VriStand } from './bcVegetationInventory'
import {
  metersPerDegree,
  pointInPolygon,
  polygonBounds,
  preparePolygons,
  type Bounds,
  type PolygonGeometry,
} from './visibility'

export const BEC_WFS = 'https://openmaps.gov.bc.ca/geo/pub/WHSE_FOREST_VEGETATION.BEC_BIOGEOCLIMATIC_POLY/ows'
const BEC_TYPE_NAME = 'pub:WHSE_FOREST_VEGETATION.BEC_BIOGEOCLIMATIC_POLY'
/** BEC polygons are large; a landform touches a handful. */
export const MAX_BEC_FEATURES = 200
/** Grid points sampled inside the landform for its species and BEC shares. */
export const DROUGHT_SAMPLE_TARGET = 1500
/** The historical period every reading is set beside. */
export const DROUGHT_BASELINE_PERIOD: PublishedPeriod = '1981-2010'

/**
 * VRI species codes forDRAT rates. Only unambiguous matches: coastal Douglas-fir (`FDC`),
 * black spruce (`SB`), amabilis fir (`BA`) and balsam poplar (`ACB`) are other species than
 * the table's, so they stay unrated rather than borrowing a neighbour's rating.
 */
export const FORDRAT_SPECIES_FOR_VRI: Readonly<Record<string, SpeciesCode>> = {
  PL: 'Pl',
  PLI: 'Pl',
  SX: 'Sx',
  SXW: 'Sx',
  SXE: 'Sx',
  SW: 'Sx',
  SE: 'Sx',
  FD: 'Fd',
  FDI: 'Fd',
  BL: 'Bl',
  CW: 'Cw',
  HW: 'Hw',
  LW: 'Lw',
  PY: 'Py',
  ACT: 'Ac',
  AT: 'At',
}

export const fordratSpecies = (vriCode: string): SpeciesCode | null =>
  FORDRAT_SPECIES_FOR_VRI[vriCode.trim().toUpperCase()] ?? null

/** The CQL filter carries the box, longitude first; never the WFS `bbox` parameter (latitude first in 2.0). */
export function becQueryUrl(bounds: Bounds): string {
  const [minLng, minLat, maxLng, maxLat] = bounds
  const parameters = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: BEC_TYPE_NAME,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(MAX_BEC_FEATURES),
    propertyName: 'MAP_LABEL,ZONE,SUBZONE,VARIANT,PHASE,GEOMETRY',
    CQL_FILTER: `BBOX(GEOMETRY,${minLng},${minLat},${maxLng},${maxLat},'EPSG:4326')`,
  })
  return `${BEC_WFS}?${parameters.toString()}`
}

export type BecPolygon = { label: string; geometry: PolygonGeometry }

export function parseBecPolygons(payload: unknown): BecPolygon[] {
  const features = (payload as { features?: unknown })?.features
  if (!Array.isArray(features)) throw new Error('The BEC map returned no features list.')
  return features.flatMap((entry) => {
    const feature = entry as { geometry?: { type?: string }; properties?: Record<string, unknown> }
    const label = feature.properties?.MAP_LABEL
    const type = feature.geometry?.type
    if (typeof label !== 'string' || !label.trim() || (type !== 'Polygon' && type !== 'MultiPolygon')) return []
    return [{ label: label.trim(), geometry: feature.geometry as PolygonGeometry }]
  })
}

export async function fetchBecPolygons(
  bounds: Bounds,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<BecPolygon[]> {
  const response = await fetchFn(becQueryUrl(bounds), { signal })
  if (!response.ok) {
    const reason = wfsExceptionReason(await response.text().catch(() => ''))
    throw new Error(`The BEC map could not be read (HTTP ${response.status}${reason ? `: ${reason}` : ''}).`)
  }
  return parseBecPolygons(await response.json())
}

/**
 * What a GeoServer exception report says went wrong, in a reader's words where it is DataBC's own trouble. GeoServer
 * answers a busy database with HTTP 400 and `HikariPool … Connection is not available`, which a bare status hides.
 */
export function wfsExceptionReason(body: string): string | null {
  const text = /<ows:ExceptionText>([\s\S]*?)<\/ows:ExceptionText>/.exec(body)?.[1]?.trim()
  if (!text) return null
  if (/Connection is not available|Unable to obtain connection/i.test(text))
    return "DataBC's server could not reach its database; try again later"
  const first = text.split('\n')[0].replace(/^java\.lang\.\w+:\s*/, '')
  return first.length > 160 ? `${first.slice(0, 157)}…` : first
}

export type SpeciesShare = { vriCode: string; fordrat: SpeciesCode | null; share: number }

export type LandformStand = {
  /** BEC units under the landform, largest share first. Shares are of the sampled landform. */
  becUnits: Array<{ label: string; share: number }>
  /** Share of the sampled landform on inventory-treed ground. */
  treedShare: number
  /** The treed ground's species, by inventory percentage, largest first. Shares sum to 1. */
  species: SpeciesShare[]
  samples: number
}

/** Regular grid points inside a polygon, about `target` of them, spaced evenly in metres. */
export function landformSamples(geometry: PolygonGeometry, target = DROUGHT_SAMPLE_TARGET): Array<[number, number]> {
  const [minLng, minLat, maxLng, maxLat] = polygonBounds(geometry)
  const scale = metersPerDegree((minLat + maxLat) / 2)
  const widthM = (maxLng - minLng) * scale.lng,
    heightM = (maxLat - minLat) * scale.lat
  if (!(widthM > 0 && heightM > 0)) return []
  // The bounds' area overstates the polygon's; start there and halve the spacing until enough land inside.
  let spacing = Math.sqrt((widthM * heightM) / target)
  for (let attempt = 0; attempt < 4; attempt++) {
    const points: Array<[number, number]> = []
    const dLng = spacing / scale.lng,
      dLat = spacing / scale.lat
    for (let lat = minLat + dLat / 2; lat < maxLat; lat += dLat)
      for (let lng = minLng + dLng / 2; lng < maxLng; lng += dLng)
        if (pointInPolygon(geometry, lng, lat)) points.push([lng, lat])
    if (points.length >= target / 4 || attempt === 3) return points
    spacing /= 2
  }
  return []
}

/** The BEC units and treed species mix under a landform, from sampled points. */
export function landformStand(
  geometry: PolygonGeometry,
  stands: ReadonlyArray<Pick<VriStand, 'treed' | 'speciesCode' | 'speciesComposition' | 'geometry'>>,
  bec: ReadonlyArray<BecPolygon>,
): LandformStand {
  const points = landformSamples(geometry)
  const box = polygonBounds(geometry)
  const standIndex = preparePolygons(
    stands.map((s) => s.geometry),
    box,
  )
  const becIndex = preparePolygons(
    bec.map((b) => b.geometry),
    box,
  )
  const units = new Map<string, number>()
  const species = new Map<string, number>()
  let treed = 0
  let speciesWeight = 0
  for (const [lng, lat] of points) {
    const unit = becIndex.indexAt(lng, lat)
    if (unit >= 0) units.set(bec[unit].label, (units.get(bec[unit].label) ?? 0) + 1)
    const index = standIndex.indexAt(lng, lat)
    if (index < 0 || !stands[index].treed) continue
    treed++
    const stand = stands[index]
    const composition = stand.speciesComposition?.length
      ? stand.speciesComposition
      : stand.speciesCode
        ? [{ code: stand.speciesCode, percent: 100 }]
        : []
    for (const entry of composition) {
      if (!(entry.percent > 0)) continue
      const code = entry.code.trim().toUpperCase()
      species.set(code, (species.get(code) ?? 0) + entry.percent)
      speciesWeight += entry.percent
    }
  }
  const n = points.length
  return {
    samples: n,
    treedShare: n ? treed / n : 0,
    becUnits: [...units]
      .map(([label, count]) => ({ label, share: n ? count / n : 0 }))
      .sort((a, b) => b.share - a.share || a.label.localeCompare(b.label)),
    species: [...species]
      .map(([vriCode, weight]) => ({
        vriCode,
        fordrat: fordratSpecies(vriCode),
        share: speciesWeight ? weight / speciesWeight : 0,
      }))
      .sort((a, b) => b.share - a.share || a.vriCode.localeCompare(b.vriCode)),
  }
}

export type DroughtRow = {
  code: SpeciesCode
  /** VRI codes that read as this forDRAT species, e.g. `["SX", "SW"]`. */
  vriCodes: string[]
  /** Share of the treed ground, summed over those codes. */
  share: number
  baseline: RiskCode
  projected: RiskCode
}

export type DroughtReading = {
  bgc: string
  smr: SoilMoistureRegime
  period: PublishedPeriod
  baselineAetPet: number
  projectedAetPet: number
  rows: DroughtRow[]
  /** Treed-ground species forDRAT does not rate, with their shares. */
  unrated: SpeciesShare[]
}

/**
 * The landform's species read from the table for one BEC unit, soil moisture regime and period,
 * beside the 1981–2010 baseline. Null when the unit is not in the published (BEC v11) table.
 */
export function droughtReading(
  dataset: PublishedDataset,
  bgc: string,
  smr: SoilMoistureRegime,
  period: PublishedPeriod,
  species: ReadonlyArray<SpeciesShare>,
): DroughtReading | null {
  const row = (p: PublishedPeriod) => filterPublishedRows(dataset, { bgc, smr, period: p })[0] ?? null
  const baseline = row(DROUGHT_BASELINE_PERIOD),
    projected = row(period)
  if (!baseline || !projected) return null
  const grouped = new Map<SpeciesCode, { vriCodes: string[]; share: number }>()
  for (const entry of species) {
    if (!entry.fordrat) continue
    const current = grouped.get(entry.fordrat) ?? { vriCodes: [], share: 0 }
    current.vriCodes.push(entry.vriCode)
    current.share += entry.share
    grouped.set(entry.fordrat, current)
  }
  return {
    bgc,
    smr,
    period,
    baselineAetPet: baseline.aetPet,
    projectedAetPet: projected.aetPet,
    rows: [...grouped]
      .map(([code, entry]) => ({
        code,
        vriCodes: entry.vriCodes,
        share: entry.share,
        baseline: baseline.risks[code],
        projected: projected.risks[code],
      }))
      .sort((a, b) => b.share - a.share),
    unrated: species.filter((entry) => !entry.fordrat),
  }
}

/** The drought-risk page opened on the same unit, soil and period. */
export function droughtRiskLink(bgc: string, smr: SoilMoistureRegime | '', period: PublishedPeriod): string {
  const query = new URLSearchParams({ bgc })
  if (smr !== '') query.set('smr', String(smr))
  query.set('period', period)
  return `/dev/forestry/drought-risk?${query.toString()}`
}
