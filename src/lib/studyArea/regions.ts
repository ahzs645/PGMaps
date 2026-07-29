import area from '@turf/area'
import bbox from '@turf/bbox'
import union from '@turf/union'
import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/fetchJson'
import {
  BOUNDARY_CODE_PROPERTY_BY_LEVEL,
  BOUNDARY_FILE_BY_LEVEL,
  BOUNDARY_INDEX_KEY_BY_LEVEL,
  BOUNDARY_NAME_PROPERTY_BY_LEVEL,
} from './options'
import type {
  BoundaryIndex,
  BoundaryLevel,
  BoundaryRegionRecord,
  BoundarySource,
  BcRfcBoundaryLevel,
  BcerBoundaryLevel,
  CensusBoundaryLevel,
  CommunityBoundaryLevel,
  CityBoundaryLevel,
  CrownTenureBoundaryLevel,
  DrainageBoundaryLevel,
  FireZoneBoundaryLevel,
  MineralTenureBoundaryLevel,
  MunicipalityBoundaryLevel,
  NrAdminBoundaryLevel,
  RangeTenureBoundaryLevel,
  RegionLevel,
  RegionalDistrictBoundaryLevel,
  StudyAreaRegion,
  UwrBoundaryLevel,
  WalkabilityCommunityBoundaryLevel,
  WatershedBoundaryLevel,
} from './types'

type RawBoundaryFeature = GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>
type BoundaryFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>

interface BoundaryFeatureCollection {
  type: 'FeatureCollection'
  features: RawBoundaryFeature[]
}

const BOUNDARY_INDEX_PATH = '/data/boundaries/BCMoH/index.json'
const CANADA_CSD_BASE_PATH = '/data/census/canada-csd'
const CENSUS_FILE_BY_LEVEL: Record<CensusBoundaryLevel, string> = {
  cd: '/data/census/prince_george_cd.geo.json',
  csd: `${CANADA_CSD_BASE_PATH}/manifest.json`,
  northSouthCsd: `${CANADA_CSD_BASE_PATH}/manifest.json`,
  ct: '/data/census/prince_george_ct.geo.json',
  da: '/data/census/prince_george_da.geo.json',
  db: '/data/census/prince_george_db.geo.json',
  bcDaSimplified: '/data/census/bc-da-simplified/manifest.json',
}
const CITY_FILE_BY_LEVEL: Record<CityBoundaryLevel, string> = {
  elementarySchoolCatchment: '/data/boundaries/CityPG/elementary_school_catchments.geojson',
  secondarySchoolCatchment: '/data/boundaries/CityPG/secondary_school_catchments.geojson',
}
// The walkability snapshot carries the exact same 31 CityPG community polygons
// (matching OBJECTIDs/geometry) plus precomputed walkability variant scores, so the
// community boundary source loads it directly and the plain boundary file stays as
// a fallback. This keeps "Community polygons" and walkability metrics on one source.
const COMMUNITY_FILE_BY_LEVEL: Record<CommunityBoundaryLevel, string> = {
  communityPolygon: '/data/walkability/community_walkability.geojson',
}
const COMMUNITY_FALLBACK_FILE_BY_LEVEL: Record<CommunityBoundaryLevel, string> = {
  communityPolygon: '/data/citypg/community_boundaries.geojson',
}
const REGIONAL_DISTRICT_FILE_BY_LEVEL: Record<RegionalDistrictBoundaryLevel, string> = {
  regionalDistrict: '/data/boundaries/BC/regional_districts.geojson',
}
const MUNICIPALITY_FILE_BY_LEVEL: Record<MunicipalityBoundaryLevel, string> = {
  municipality: '/data/boundaries/BC/municipalities.geojson',
}
const CITY_NAME_PROPERTY_BY_LEVEL: Record<CityBoundaryLevel, string> = {
  elementarySchoolCatchment: 'SchoolName',
  secondarySchoolCatchment: 'SchoolNam',
}
const WATERSHED_FILE_BY_LEVEL: Record<WatershedBoundaryLevel, string> = {
  majorWatershed: '/data/boundaries/BCFWA/major_watersheds_province_simplified.geojson',
  watershedGroup: '/data/boundaries/BCFWA/watershed_groups_province_simplified.geojson',
  assessmentWatershed: '/data/boundaries/BCFWA/assessment_watersheds.geojson',
  namedWatershed: '/data/boundaries/BCFWA/named_watersheds_province_50m.geojson.gz',
}
const DRAINAGE_FILE_BY_LEVEL: Record<DrainageBoundaryLevel, string> = {
  oceanDrainageArea: '/data/boundaries/BCDrainage/drainage_basins.geojson',
  drainageRegion: '/data/boundaries/BCDrainage/drainage_basins.geojson',
}
const FIRE_ZONE_FILE_BY_LEVEL: Record<FireZoneBoundaryLevel, string> = {
  fireCentre: '/data/boundaries/BCWildfire/fire_zones.geojson',
  fireZone: '/data/boundaries/BCWildfire/fire_zones.geojson',
}
export const BC_RFC_ARCGIS_ROOT = 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services'
export const BC_RFC_SNOW_BASINS_URL = `${BC_RFC_ARCGIS_ROOT}/Snow_Basins_Indices_View/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson&resultRecordCount=1000`
const NR_ADMIN_FILE_BY_LEVEL: Record<NrAdminBoundaryLevel, string> = {
  nrArea: '/data/boundaries/BCNR/nr_areas.geojson',
  nrRegion: '/data/boundaries/BCNR/nr_regions.geojson',
  nrDistrict: '/data/boundaries/BCNR/nr_districts.geojson',
}
const UWR_FILE_BY_LEVEL: Record<UwrBoundaryLevel, string> = {
  ungulateWinterRange: '/data/boundaries/BCUWR/ungulate_winter_range.geojson',
}
const BCER_FILE_BY_LEVEL: Record<BcerBoundaryLevel, string> = {
  bcerAdminZone: '/data/boundaries/BCER/admin_zones.geojson',
}
const CROWN_TENURE_FILE_BY_LEVEL: Record<CrownTenureBoundaryLevel, string> = {
  crownTenure: '/data/boundaries/BCTantalis/crown_tenures.geojson',
}
const RANGE_TENURE_FILE_BY_LEVEL: Record<RangeTenureBoundaryLevel, string> = {
  rangeTenurePolygon: '/data/boundaries/BCRange/range_tenures.geojson',
  rangePasture: '/data/boundaries/BCRange/range_pastures.geojson',
}
const MINERAL_TENURE_FILE_BY_LEVEL: Record<MineralTenureBoundaryLevel, string> = {
  mineralTenure: '/data/boundaries/BCMineral/mineral_tenures.geojson',
}
const WALKABILITY_COMMUNITY_FILE_BY_LEVEL: Record<WalkabilityCommunityBoundaryLevel, string> = {
  walkabilityCommunity: '/data/walkability/community_walkability.geojson',
}

const HEALTH_LEVEL_SET = new Set<BoundaryLevel>(['healthAuthority', 'hsda', 'lha', 'chsa'])
const REGIONAL_DISTRICT_LEVEL_SET = new Set<RegionalDistrictBoundaryLevel>(['regionalDistrict'])
const MUNICIPALITY_LEVEL_SET = new Set<MunicipalityBoundaryLevel>(['municipality'])
const CENSUS_LEVEL_SET = new Set<CensusBoundaryLevel>(['cd', 'csd', 'northSouthCsd', 'ct', 'da', 'db', 'bcDaSimplified'])
const COMMUNITY_LEVEL_SET = new Set<CommunityBoundaryLevel>(['communityPolygon'])
const CITY_LEVEL_SET = new Set<CityBoundaryLevel>(['elementarySchoolCatchment', 'secondarySchoolCatchment'])
const WATERSHED_LEVEL_SET = new Set<WatershedBoundaryLevel>([
  'majorWatershed',
  'watershedGroup',
  'assessmentWatershed',
  'namedWatershed',
])
const DRAINAGE_LEVEL_SET = new Set<DrainageBoundaryLevel>(['oceanDrainageArea', 'drainageRegion'])
const FIRE_ZONE_LEVEL_SET = new Set<FireZoneBoundaryLevel>(['fireCentre', 'fireZone'])
const BC_RFC_LEVEL_SET = new Set<BcRfcBoundaryLevel>(['rfcSnowBasin'])
const BCER_LEVEL_SET = new Set<BcerBoundaryLevel>(['bcerAdminZone'])
const NR_ADMIN_LEVEL_SET = new Set<NrAdminBoundaryLevel>(['nrArea', 'nrRegion', 'nrDistrict'])
const UWR_LEVEL_SET = new Set<UwrBoundaryLevel>(['ungulateWinterRange'])
const CROWN_TENURE_LEVEL_SET = new Set<CrownTenureBoundaryLevel>(['crownTenure'])
const RANGE_TENURE_LEVEL_SET = new Set<RangeTenureBoundaryLevel>(['rangeTenurePolygon', 'rangePasture'])
const MINERAL_TENURE_LEVEL_SET = new Set<MineralTenureBoundaryLevel>(['mineralTenure'])
const WALKABILITY_COMMUNITY_LEVEL_SET = new Set<WalkabilityCommunityBoundaryLevel>(['walkabilityCommunity'])

let boundaryIndexCache: BoundaryIndex | null = null
const boundaryRegionCache = new Map<string, StudyAreaRegion[]>()

function sortRegions(regions: StudyAreaRegion[]): StudyAreaRegion[] {
  return [...regions].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
}

function mapRecordsByCode(records: BoundaryRegionRecord[]): Map<string, string> {
  const byCode = new Map<string, string>()
  records.forEach((record) => {
    byCode.set(String(record.code), record.name)
  })
  return byCode
}

function isHealthBoundaryLevel(level: RegionLevel): level is BoundaryLevel {
  return HEALTH_LEVEL_SET.has(level as BoundaryLevel)
}

function isCensusBoundaryLevel(level: RegionLevel): level is CensusBoundaryLevel {
  return CENSUS_LEVEL_SET.has(level as CensusBoundaryLevel)
}

function isCommunityBoundaryLevel(level: RegionLevel): level is CommunityBoundaryLevel {
  return COMMUNITY_LEVEL_SET.has(level as CommunityBoundaryLevel)
}

function isRegionalDistrictBoundaryLevel(level: RegionLevel): level is RegionalDistrictBoundaryLevel {
  return REGIONAL_DISTRICT_LEVEL_SET.has(level as RegionalDistrictBoundaryLevel)
}

function isMunicipalityBoundaryLevel(level: RegionLevel): level is MunicipalityBoundaryLevel {
  return MUNICIPALITY_LEVEL_SET.has(level as MunicipalityBoundaryLevel)
}

function isCityBoundaryLevel(level: RegionLevel): level is CityBoundaryLevel {
  return CITY_LEVEL_SET.has(level as CityBoundaryLevel)
}

function isWatershedBoundaryLevel(level: RegionLevel): level is WatershedBoundaryLevel {
  return WATERSHED_LEVEL_SET.has(level as WatershedBoundaryLevel)
}

function isDrainageBoundaryLevel(level: RegionLevel): level is DrainageBoundaryLevel {
  return DRAINAGE_LEVEL_SET.has(level as DrainageBoundaryLevel)
}

function isFireZoneBoundaryLevel(level: RegionLevel): level is FireZoneBoundaryLevel {
  return FIRE_ZONE_LEVEL_SET.has(level as FireZoneBoundaryLevel)
}

function isBcRfcBoundaryLevel(level: RegionLevel): level is BcRfcBoundaryLevel {
  return BC_RFC_LEVEL_SET.has(level as BcRfcBoundaryLevel)
}

function isBcerBoundaryLevel(level: RegionLevel): level is BcerBoundaryLevel {
  return BCER_LEVEL_SET.has(level as BcerBoundaryLevel)
}

function isNrAdminBoundaryLevel(level: RegionLevel): level is NrAdminBoundaryLevel {
  return NR_ADMIN_LEVEL_SET.has(level as NrAdminBoundaryLevel)
}

function isUwrBoundaryLevel(level: RegionLevel): level is UwrBoundaryLevel {
  return UWR_LEVEL_SET.has(level as UwrBoundaryLevel)
}

function isCrownTenureBoundaryLevel(level: RegionLevel): level is CrownTenureBoundaryLevel {
  return CROWN_TENURE_LEVEL_SET.has(level as CrownTenureBoundaryLevel)
}

function isRangeTenureBoundaryLevel(level: RegionLevel): level is RangeTenureBoundaryLevel {
  return RANGE_TENURE_LEVEL_SET.has(level as RangeTenureBoundaryLevel)
}

function isMineralTenureBoundaryLevel(level: RegionLevel): level is MineralTenureBoundaryLevel {
  return MINERAL_TENURE_LEVEL_SET.has(level as MineralTenureBoundaryLevel)
}

function isWalkabilityCommunityBoundaryLevel(level: RegionLevel): level is WalkabilityCommunityBoundaryLevel {
  return WALKABILITY_COMMUNITY_LEVEL_SET.has(level as WalkabilityCommunityBoundaryLevel)
}

/**
 * Maps one community-walkability feature into a study-area region. Exposed for
 * unit testing; the precomputed variant scores ride along in `feature.properties`
 * so the score builder can surface them as community-only metrics.
 */
export function mapWalkabilityCommunityFeatureToRegion(
  rawFeature: RawBoundaryFeature,
  level: WalkabilityCommunityBoundaryLevel,
): StudyAreaRegion | null {
  const feature = toPolygonFeature(rawFeature)
  if (!feature) return null

  const properties = (feature.properties ?? {}) as Record<string, unknown>
  const code = String(properties.communityId ?? properties.OBJECTID ?? rawFeature.id ?? '').trim()
  if (!code) return null

  const displayName = String(properties.communityName ?? properties.CommunityName ?? code).trim() || code
  const areaKm2 = area(feature) / 1_000_000
  const bounds = bbox(feature) as [number, number, number, number]

  return {
    id: `walkabilityCommunity:${level}:${code}`,
    code,
    name: displayName,
    source: 'walkabilityCommunity',
    level,
    feature,
    bounds,
    areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
  } satisfies StudyAreaRegion
}

function toPolygonFeature(feature: RawBoundaryFeature): BoundaryFeature | null {
  const geometry = feature.geometry
  if (!geometry) return null
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    return null
  }

  return {
    type: 'Feature',
    id: feature.id,
    properties: feature.properties ?? {},
    geometry,
  }
}

export function studyAreaRegionsToFeatureCollection(
  regions: StudyAreaRegion[],
): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  return {
    type: 'FeatureCollection',
    features: regions.map((region) => ({
      ...region.feature,
      properties: {
        ...region.feature.properties,
        id: region.id,
        boundaryId: region.id,
        boundaryName: region.name,
        boundaryCode: region.code,
        boundaryLevel: region.level,
        boundarySource: region.source,
        areaKm2: region.areaKm2,
      },
    })),
  }
}

async function loadBoundaryIndex(signal?: AbortSignal): Promise<BoundaryIndex> {
  if (boundaryIndexCache) return boundaryIndexCache
  boundaryIndexCache = await fetchJson<BoundaryIndex>(BOUNDARY_INDEX_PATH, signal)
  return boundaryIndexCache
}

async function loadHealthRegions(level: BoundaryLevel, signal?: AbortSignal): Promise<StudyAreaRegion[]> {
  const cacheKey = `bcHealth:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const [index, geometry] = await Promise.all([
    loadBoundaryIndex(signal),
    fetchJson<BoundaryFeatureCollection>(`/data/boundaries/BCMoH/${BOUNDARY_FILE_BY_LEVEL[level]}`, signal),
  ])

  const records = index[BOUNDARY_INDEX_KEY_BY_LEVEL[level]] ?? []
  const nameByCode = mapRecordsByCode(records)
  const codeKey = BOUNDARY_CODE_PROPERTY_BY_LEVEL[level]
  const nameKey = BOUNDARY_NAME_PROPERTY_BY_LEVEL[level]

  const regions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => {
      const feature = toPolygonFeature(rawFeature)
      if (!feature) return null

      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const code = String(properties[codeKey] ?? '').trim()
      if (!code) return null

      const nameFromFeature = String(properties[nameKey] ?? '').trim()
      const displayName = nameByCode.get(code) || nameFromFeature || code

      const areaKm2 = area(feature) / 1_000_000
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `bcHealth:${level}:${code}`,
        code,
        name: displayName,
        source: 'bcHealth',
        level,
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
      } satisfies StudyAreaRegion
    })
    .filter((region): region is StudyAreaRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

async function loadCensusRegions(level: CensusBoundaryLevel, signal?: AbortSignal): Promise<StudyAreaRegion[]> {
  const cacheKey = `census:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  if (level === 'northSouthCsd') {
    const csdRegions = await loadCensusRegions('csd', signal)
    const variantRegions = csdRegions.map((region) => {
      const id = `census:${level}:${region.code}`
      return {
        ...region,
        id,
        level,
        feature: {
          ...region.feature,
          properties: {
            ...(region.feature.properties ?? {}),
            id,
            boundaryId: id,
            boundaryLevel: level,
          },
        },
      } satisfies StudyAreaRegion
    })
    boundaryRegionCache.set(cacheKey, variantRegions)
    return variantRegions
  }

  if (level === 'bcDaSimplified') {
    const manifest = await fetchJson<{
      chunks: Array<{ path: string }>
      levels?: Array<{ id: string; chunks: Array<{ path: string }> }>
    }>(CENSUS_FILE_BY_LEVEL[level], signal)
    const chunks = manifest.levels?.find((entry) => entry.id === 'overview')?.chunks ?? manifest.chunks
    const collections = await Promise.all(
      chunks.map((chunk) => fetchJson<BoundaryFeatureCollection>(`/data/census/bc-da-simplified/${chunk.path}`, signal)),
    )
    const sortedRegions = sortRegions(collections.flatMap((collection) => (
      collection.features
        .map<StudyAreaRegion | null>((rawFeature) => {
          const feature = toPolygonFeature(rawFeature)
          if (!feature) return null

          const properties = (feature.properties ?? {}) as Record<string, unknown>
          const code = String(properties.boundaryCode ?? properties.DAUID ?? properties.id ?? '').trim()
          if (!code) return null

          const displayName = String(properties.boundaryName ?? properties.name ?? `DA ${code}`).trim() || `DA ${code}`
          const areaKm2 = area(feature) / 1_000_000
          const bounds = bbox(feature) as [number, number, number, number]

          return {
            id: `census:${level}:${code}`,
            code,
            name: displayName,
            source: 'census',
            level,
            feature,
            bounds,
            areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
          } satisfies StudyAreaRegion
        })
        .filter((region): region is StudyAreaRegion => region !== null)
    )))
    boundaryRegionCache.set(cacheKey, sortedRegions)
    return sortedRegions
  }

  const geometry = level === 'csd'
    ? await (async () => {
        const manifest = await fetchJson<{
          chunks: Array<{ path: string }>
          classification: { path: string }
        }>(CENSUS_FILE_BY_LEVEL[level], signal)
        const [collections, classification] = await Promise.all([
          Promise.all(
            manifest.chunks.map((chunk) => (
              fetchJson<BoundaryFeatureCollection>(`${CANADA_CSD_BASE_PATH}/${chunk.path}`, signal)
            )),
          ),
          fetchJson<{
            byCsdUid: Record<string, 'North' | 'South'>
          }>(`${CANADA_CSD_BASE_PATH}/${manifest.classification.path}`, signal),
        ])
        return {
          type: 'FeatureCollection',
          features: collections.flatMap((collection) => collection.features).map((feature) => {
            const properties = feature.properties ?? {}
            const csdUid = String(properties.CSDUID ?? properties.boundaryCode ?? properties.id ?? '')
            const northSouth = classification.byCsdUid[csdUid]
            return {
              ...feature,
              properties: {
                ...properties,
                north_south: northSouth ?? null,
                north_south_code: northSouth === 'North' ? 'N' : northSouth === 'South' ? 'S' : null,
              },
            }
          }),
        } satisfies BoundaryFeatureCollection
      })()
    : await fetchJson<BoundaryFeatureCollection>(CENSUS_FILE_BY_LEVEL[level], signal)

  const regions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => {
      const feature = toPolygonFeature(rawFeature)
      if (!feature) return null

      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const code = String(properties.boundaryCode ?? properties.id ?? properties.code ?? '').trim()
      if (!code) return null

      const displayName = String(properties.boundaryName ?? properties.name ?? code).trim() || code
      const areaKm2 = Number(properties.areaKm2 ?? properties.areaSqKm ?? area(feature) / 1_000_000)
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `census:${level}:${code}`,
        code,
        name: displayName,
        source: 'census',
        level,
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
      } satisfies StudyAreaRegion
    })
    .filter((region): region is StudyAreaRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

async function loadCityRegions(level: CityBoundaryLevel, signal?: AbortSignal): Promise<StudyAreaRegion[]> {
  const cacheKey = `cityPG:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(CITY_FILE_BY_LEVEL[level], signal)
  const nameKey = CITY_NAME_PROPERTY_BY_LEVEL[level]

  const regions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => {
      const feature = toPolygonFeature(rawFeature)
      if (!feature) return null

      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const objectId = String(properties.OBJECTID ?? '').trim()
      const displayName = String(properties[nameKey] ?? objectId).trim() || objectId
      if (!objectId && !displayName) return null

      const code = objectId || displayName
      const areaKm2 = area(feature) / 1_000_000
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `cityPG:${level}:${code}`,
        code,
        name: displayName,
        source: 'cityPG',
        level,
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
      } satisfies StudyAreaRegion
    })
    .filter((region): region is StudyAreaRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

async function loadCommunityRegions(level: CommunityBoundaryLevel, signal?: AbortSignal): Promise<StudyAreaRegion[]> {
  const cacheKey = `cityCommunity:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  let geometry: BoundaryFeatureCollection
  try {
    geometry = await fetchJson<BoundaryFeatureCollection>(COMMUNITY_FILE_BY_LEVEL[level], signal)
  } catch (error) {
    if (signal?.aborted) throw error
    geometry = await fetchJson<BoundaryFeatureCollection>(COMMUNITY_FALLBACK_FILE_BY_LEVEL[level], signal)
  }

  const regions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => {
      const feature = toPolygonFeature(rawFeature)
      if (!feature) return null

      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const objectId = String(properties.OBJECTID ?? rawFeature.id ?? '').trim()
      const displayName = String(properties.CommunityName ?? objectId).trim() || objectId
      if (!objectId && !displayName) return null

      const code = objectId || displayName
      const areaKm2 = area(feature) / 1_000_000
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `cityCommunity:${level}:${code}`,
        code,
        name: displayName,
        source: 'cityCommunity',
        level,
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
      } satisfies StudyAreaRegion
    })
    .filter((region): region is StudyAreaRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

async function loadRegionalDistrictRegions(level: RegionalDistrictBoundaryLevel, signal?: AbortSignal): Promise<StudyAreaRegion[]> {
  const cacheKey = `regionalDistrict:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(REGIONAL_DISTRICT_FILE_BY_LEVEL[level], signal)

  const regions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => {
      const feature = toPolygonFeature(rawFeature)
      if (!feature) return null

      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const code = String(properties.ADMIN_AREA_ABBREVIATION ?? properties.LGL_ADMIN_AREA_ID ?? '').trim()
      if (!code) return null

      const displayName = String(properties.ADMIN_AREA_NAME ?? code).trim() || code
      const areaKm2 = area(feature) / 1_000_000
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `regionalDistrict:${level}:${code}`,
        code,
        name: displayName,
        source: 'regionalDistrict',
        level,
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
      } satisfies StudyAreaRegion
    })
    .filter((region): region is StudyAreaRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

async function loadWatershedRegions(level: WatershedBoundaryLevel, signal?: AbortSignal): Promise<StudyAreaRegion[]> {
  const cacheKey = `watershed:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(WATERSHED_FILE_BY_LEVEL[level], signal)

  const regions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => {
      const feature = toPolygonFeature(rawFeature)
      if (!feature) return null

      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const code = String(properties.boundaryCode ?? properties.OBJECTID ?? '').trim()
      if (!code) return null

      const displayName = String(properties.boundaryName ?? code).trim() || code
      const sourceAreaKm2 = Number(properties.areaKm2)
      const areaKm2 = Number.isFinite(sourceAreaKm2) && sourceAreaKm2 > 0
        ? sourceAreaKm2
        : area(feature) / 1_000_000
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `watershed:${level}:${code}`,
        code,
        name: displayName,
        source: 'watershed',
        level,
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
      } satisfies StudyAreaRegion
    })
    .filter((region): region is StudyAreaRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

async function loadStandardBoundaryRegions(
  source: BoundarySource,
  level: RegionLevel,
  filePath: string,
  signal?: AbortSignal,
): Promise<StudyAreaRegion[]> {
  const cacheKey = `${source}:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(filePath, signal)

  const regions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => {
      const feature = toPolygonFeature(rawFeature)
      if (!feature) return null

      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const code = String(properties.boundaryCode ?? properties.OBJECTID ?? '').trim()
      if (!code) return null

      const displayName = String(properties.boundaryName ?? code).trim() || code
      const areaKm2 = area(feature) / 1_000_000
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `${source}:${level}:${code}`,
        code,
        name: displayName,
        source,
        level,
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
      } satisfies StudyAreaRegion
    })
    .filter((region): region is StudyAreaRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

function mapDrainageRegionFeatureToRegion(rawFeature: RawBoundaryFeature): StudyAreaRegion | null {
  const feature = toPolygonFeature(rawFeature)
  if (!feature) return null

  const properties = (feature.properties ?? {}) as Record<string, unknown>
  const code = String(properties.boundaryCode ?? properties.DR_Code ?? properties.FID ?? '').trim()
  if (!code) return null

  const displayName = String(properties.boundaryName ?? properties.DR_Name ?? code).trim() || code
  const areaKm2 = area(feature) / 1_000_000
  const bounds = bbox(feature) as [number, number, number, number]

  return {
    id: `bcDrainage:drainageRegion:${code}`,
    code,
    name: displayName,
    source: 'bcDrainage',
    level: 'drainageRegion',
    feature,
    bounds,
    areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
  } satisfies StudyAreaRegion
}

function mergeOceanDrainageAreaFeatures(regions: StudyAreaRegion[]): StudyAreaRegion[] {
  const byOceanDrainageArea = new Map<string, StudyAreaRegion[]>()
  regions.forEach((region) => {
    const areaName = String(region.feature.properties?.ODA_Name ?? '').trim()
    if (!areaName) return
    byOceanDrainageArea.set(areaName, [...(byOceanDrainageArea.get(areaName) ?? []), region])
  })

  return [...byOceanDrainageArea.entries()]
    .map<StudyAreaRegion | null>(([areaName, areaRegions]) => {
      const firstProperties = areaRegions[0]?.feature.properties ?? {}
      const areaCode = String(firstProperties.ODA_Code ?? areaName).trim() || areaName
      const mergedFeature = areaRegions
        .map((region) => region.feature)
        .reduce<BoundaryFeature | null>((merged, feature) => {
          if (!merged) return feature as BoundaryFeature
          return union(merged as never, feature as never) as BoundaryFeature | null
        }, null)

      if (!mergedFeature) return null

      const feature: BoundaryFeature = {
        type: 'Feature',
        id: areaCode,
        geometry: mergedFeature.geometry,
        properties: {
          boundaryCode: areaCode,
          boundaryName: areaName,
          ODA_Code: areaCode,
          ODA_Name: areaName,
          drainageRegionCount: areaRegions.length,
          drainageRegionCodes: areaRegions.map((region) => region.code).join(','),
          drainageRegionNames: areaRegions.map((region) => region.name).join(','),
        },
      }
      const areaKm2 = area(feature) / 1_000_000
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `bcDrainage:oceanDrainageArea:${areaCode}`,
        code: areaCode,
        name: areaName,
        source: 'bcDrainage',
        level: 'oceanDrainageArea',
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
      } satisfies StudyAreaRegion
    })
    .filter((region): region is StudyAreaRegion => region !== null)
}

async function loadBcDrainageRegions(level: DrainageBoundaryLevel, signal?: AbortSignal): Promise<StudyAreaRegion[]> {
  const cacheKey = `bcDrainage:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(DRAINAGE_FILE_BY_LEVEL[level], signal)
  const drainageRegions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => mapDrainageRegionFeatureToRegion(rawFeature))
    .filter((region): region is StudyAreaRegion => region !== null)

  const regions = level === 'oceanDrainageArea'
    ? mergeOceanDrainageAreaFeatures(drainageRegions)
    : drainageRegions

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

function mapBcWildfireZoneFeatureToRegion(rawFeature: RawBoundaryFeature): StudyAreaRegion | null {
  const feature = toPolygonFeature(rawFeature)
  if (!feature) return null

  const properties = (feature.properties ?? {}) as Record<string, unknown>
  const code = String(properties.boundaryCode ?? properties.FIRE_ZONE_CODE ?? properties.OBJECTID ?? '').trim()
  if (!code) return null

  const displayName = String(properties.boundaryName ?? properties.FIRE_ZONE ?? code).trim() || code
  const areaKm2 = area(feature) / 1_000_000
  const bounds = bbox(feature) as [number, number, number, number]

  return {
    id: `bcWildfire:fireZone:${code}`,
    code,
    name: displayName,
    source: 'bcWildfire',
    level: 'fireZone',
    feature,
    bounds,
    areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
  } satisfies StudyAreaRegion
}

function mergeFireCentreFeatures(regions: StudyAreaRegion[]): StudyAreaRegion[] {
  const byCentre = new Map<string, StudyAreaRegion[]>()
  regions.forEach((region) => {
    const centre = String(region.feature.properties?.FIRE_CENTRE ?? '').trim()
    if (!centre) return
    byCentre.set(centre, [...(byCentre.get(centre) ?? []), region])
  })

  return [...byCentre.entries()]
    .map<StudyAreaRegion | null>(([centre, centreRegions]) => {
      const mergedFeature = centreRegions
        .map((region) => region.feature)
        .reduce<BoundaryFeature | null>((merged, feature) => {
          if (!merged) return feature as BoundaryFeature
          return union(merged as never, feature as never) as BoundaryFeature | null
        }, null)

      if (!mergedFeature) return null

      const feature: BoundaryFeature = {
        type: 'Feature',
        id: centre,
        geometry: mergedFeature.geometry,
        properties: {
          boundaryCode: centre,
          boundaryName: centre,
          FIRE_CENTRE: centre,
          fireZoneCount: centreRegions.length,
          fireZoneCodes: centreRegions.map((region) => region.code).join(','),
          fireZoneNames: centreRegions.map((region) => region.name).join(','),
        },
      }
      const areaKm2 = area(feature) / 1_000_000
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `bcWildfire:fireCentre:${centre}`,
        code: centre,
        name: centre,
        source: 'bcWildfire',
        level: 'fireCentre',
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
      } satisfies StudyAreaRegion
    })
    .filter((region): region is StudyAreaRegion => region !== null)
}

async function loadBcWildfireRegions(level: FireZoneBoundaryLevel, signal?: AbortSignal): Promise<StudyAreaRegion[]> {
  const cacheKey = `bcWildfire:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(FIRE_ZONE_FILE_BY_LEVEL[level], signal)
  const zoneRegions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => mapBcWildfireZoneFeatureToRegion(rawFeature))
    .filter((region): region is StudyAreaRegion => region !== null)

  const regions = level === 'fireCentre'
    ? mergeFireCentreFeatures(zoneRegions)
    : zoneRegions

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

async function loadBcRfcRegions(level: BcRfcBoundaryLevel, signal?: AbortSignal): Promise<StudyAreaRegion[]> {
  const cacheKey = `bcRfc:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(BC_RFC_SNOW_BASINS_URL, signal)

  const regions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => {
      const feature = toPolygonFeature(rawFeature)
      if (!feature) return null

      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const code = String(properties.basinID ?? properties.OBJECTID_12 ?? properties.OBJECTID ?? rawFeature.id ?? '').trim()
      if (!code) return null

      const displayName = String(properties.basinName ?? properties.BASIN ?? properties.basin ?? code).trim() || code
      const normalizedFeature: BoundaryFeature = {
        ...feature,
        properties: {
          ...properties,
          boundaryCode: code,
          boundaryName: displayName,
        },
      }
      const areaKm2 = area(normalizedFeature) / 1_000_000
      const bounds = bbox(normalizedFeature) as [number, number, number, number]

      return {
        id: `bcRfc:${level}:${code}`,
        code,
        name: displayName,
        source: 'bcRfc',
        level,
        feature: normalizedFeature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
      } satisfies StudyAreaRegion
    })
    .filter((region): region is StudyAreaRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

async function loadWalkabilityCommunityRegions(
  level: WalkabilityCommunityBoundaryLevel,
  signal?: AbortSignal,
): Promise<StudyAreaRegion[]> {
  const cacheKey = `walkabilityCommunity:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(WALKABILITY_COMMUNITY_FILE_BY_LEVEL[level], signal)

  const regions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => mapWalkabilityCommunityFeatureToRegion(rawFeature, level))
    .filter((region): region is StudyAreaRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

export async function loadStudyAreaRegions(
  source: BoundarySource,
  level: RegionLevel,
  signal?: AbortSignal,
): Promise<StudyAreaRegion[]> {
  if (source === 'bcHealth') {
    if (!isHealthBoundaryLevel(level)) {
      throw new Error(`Invalid health boundary level: ${level}`)
    }
    return loadHealthRegions(level, signal)
  }

  if (source === 'census') {
    if (!isCensusBoundaryLevel(level)) {
      throw new Error(`Invalid census boundary level: ${level}`)
    }
    return loadCensusRegions(level, signal)
  }

  if (source === 'cityPG') {
    if (!isCityBoundaryLevel(level)) {
      throw new Error(`Invalid City of Prince George boundary level: ${level}`)
    }
    return loadCityRegions(level, signal)
  }

  if (source === 'cityCommunity') {
    if (!isCommunityBoundaryLevel(level)) {
      throw new Error(`Invalid City of Prince George community boundary level: ${level}`)
    }
    return loadCommunityRegions(level, signal)
  }

  if (source === 'regionalDistrict') {
    if (!isRegionalDistrictBoundaryLevel(level)) {
      throw new Error(`Invalid regional district boundary level: ${level}`)
    }
    return loadRegionalDistrictRegions(level, signal)
  }

  if (source === 'bcMunicipality') {
    if (!isMunicipalityBoundaryLevel(level)) {
      throw new Error(`Invalid BC municipality boundary level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, MUNICIPALITY_FILE_BY_LEVEL[level], signal)
  }

  if (source === 'nrAdmin') {
    if (!isNrAdminBoundaryLevel(level)) {
      throw new Error(`Invalid Natural Resource admin level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, NR_ADMIN_FILE_BY_LEVEL[level], signal)
  }

  if (source === 'bcDrainage') {
    if (!isDrainageBoundaryLevel(level)) {
      throw new Error(`Invalid BC drainage boundary level: ${level}`)
    }
    return loadBcDrainageRegions(level, signal)
  }

  if (source === 'bcWildfire') {
    if (!isFireZoneBoundaryLevel(level)) {
      throw new Error(`Invalid BC wildfire boundary level: ${level}`)
    }
    return loadBcWildfireRegions(level, signal)
  }

  if (source === 'bcRfc') {
    if (!isBcRfcBoundaryLevel(level)) {
      throw new Error(`Invalid BC River Forecast Centre boundary level: ${level}`)
    }
    return loadBcRfcRegions(level, signal)
  }

  if (source === 'bcEr') {
    if (!isBcerBoundaryLevel(level)) {
      throw new Error(`Invalid BC Energy Regulator boundary level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, BCER_FILE_BY_LEVEL[level], signal)
  }

  if (source === 'uwr') {
    if (!isUwrBoundaryLevel(level)) {
      throw new Error(`Invalid Ungulate Winter Range level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, UWR_FILE_BY_LEVEL[level], signal)
  }

  if (source === 'crownTenure') {
    if (!isCrownTenureBoundaryLevel(level)) {
      throw new Error(`Invalid Crown tenure level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, CROWN_TENURE_FILE_BY_LEVEL[level], signal)
  }

  if (source === 'rangeTenure') {
    if (!isRangeTenureBoundaryLevel(level)) {
      throw new Error(`Invalid range tenure level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, RANGE_TENURE_FILE_BY_LEVEL[level], signal)
  }

  if (source === 'mineralTenure') {
    if (!isMineralTenureBoundaryLevel(level)) {
      throw new Error(`Invalid mineral tenure level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, MINERAL_TENURE_FILE_BY_LEVEL[level], signal)
  }

  if (source === 'walkabilityCommunity') {
    if (!isWalkabilityCommunityBoundaryLevel(level)) {
      throw new Error(`Invalid walkability community level: ${level}`)
    }
    return loadWalkabilityCommunityRegions(level, signal)
  }

  if (!isWatershedBoundaryLevel(level)) {
    throw new Error(`Invalid Freshwater Atlas watershed level: ${level}`)
  }
  return loadWatershedRegions(level, signal)
}

export function getWatershedLevelSourceNote(level: WatershedBoundaryLevel): string {
  if (level === 'namedWatershed') {
    return 'BC Freshwater Atlas named watersheds, province-wide 50 metre topology-preserved simplified geometry. Named drainage areas intentionally overlap and nest.'
  }
  if (level === 'assessmentWatershed') {
    return 'BC Freshwater Atlas assessment watersheds clipped to the Prince George regional viewport.'
  }
  if (level === 'watershedGroup') {
    return 'BC Freshwater Atlas watershed groups, province-wide topology-preserved simplified geometry.'
  }
  return 'BC major watershed basins, province-wide topology-preserved simplified geometry.'
}

/*
 * Fundamental watersheds and stream reaches are intentionally not loaded here:
 * the province-wide FWA_WATERSHEDS_POLY layer has millions of polygons and
 * needs vector tiles or a server-side query path before it is suitable for this UI.
 */

export function useStudyAreaRegions(source: BoundarySource, level: RegionLevel) {
  const [regions, setRegions] = useState<StudyAreaRegion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 30_000)

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const next = await loadStudyAreaRegions(source, level, controller.signal)
        if (!controller.signal.aborted) {
          setRegions(next)
        }
      } catch (err) {
        if (controller.signal.aborted && !timedOut) return
        setError(timedOut ? 'Timed out loading boundary geometry' : (err as Error).message || 'Unable to load boundary geometry')
      } finally {
        window.clearTimeout(timeoutId)
        if (!controller.signal.aborted || timedOut) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [source, level])

  return {
    regions,
    loading,
    error,
  }
}
