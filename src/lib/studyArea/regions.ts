import area from '@turf/area'
import bbox from '@turf/bbox'
import { useEffect, useState } from 'react'
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
  CensusBoundaryLevel,
  CommunityBoundaryLevel,
  CityBoundaryLevel,
  CrownTenureBoundaryLevel,
  MineralTenureBoundaryLevel,
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
const CENSUS_FILE_BY_LEVEL: Record<CensusBoundaryLevel, string> = {
  cd: '/data/census/prince_george_cd.geo.json',
  csd: '/data/census/prince_george_csd.geo.json',
  ct: '/data/census/prince_george_ct.geo.json',
  da: '/data/census/prince_george_da.geo.json',
}
const CITY_FILE_BY_LEVEL: Record<CityBoundaryLevel, string> = {
  elementarySchoolCatchment: '/data/boundaries/CityPG/elementary_school_catchments.geojson',
  secondarySchoolCatchment: '/data/boundaries/CityPG/secondary_school_catchments.geojson',
}
const COMMUNITY_FILE_BY_LEVEL: Record<CommunityBoundaryLevel, string> = {
  communityPolygon: '/data/citypg/community_boundaries.geojson',
}
const REGIONAL_DISTRICT_FILE_BY_LEVEL: Record<RegionalDistrictBoundaryLevel, string> = {
  regionalDistrict: '/data/boundaries/BC/regional_districts.geojson',
}
const CITY_NAME_PROPERTY_BY_LEVEL: Record<CityBoundaryLevel, string> = {
  elementarySchoolCatchment: 'SchoolName',
  secondarySchoolCatchment: 'SchoolNam',
}
const WATERSHED_FILE_BY_LEVEL: Record<WatershedBoundaryLevel, string> = {
  majorWatershed: '/data/boundaries/BCFWA/major_watersheds_province_simplified.geojson',
  watershedGroup: '/data/boundaries/BCFWA/watershed_groups_province_simplified.geojson',
  assessmentWatershed: '/data/boundaries/BCFWA/assessment_watersheds.geojson',
}
const NR_ADMIN_FILE_BY_LEVEL: Record<NrAdminBoundaryLevel, string> = {
  nrArea: '/data/boundaries/BCNR/nr_areas.geojson',
  nrRegion: '/data/boundaries/BCNR/nr_regions.geojson',
  nrDistrict: '/data/boundaries/BCNR/nr_districts.geojson',
}
const UWR_FILE_BY_LEVEL: Record<UwrBoundaryLevel, string> = {
  ungulateWinterRange: '/data/boundaries/BCUWR/ungulate_winter_range.geojson',
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
const CENSUS_LEVEL_SET = new Set<CensusBoundaryLevel>(['cd', 'csd', 'ct', 'da'])
const COMMUNITY_LEVEL_SET = new Set<CommunityBoundaryLevel>(['communityPolygon'])
const CITY_LEVEL_SET = new Set<CityBoundaryLevel>(['elementarySchoolCatchment', 'secondarySchoolCatchment'])
const WATERSHED_LEVEL_SET = new Set<WatershedBoundaryLevel>([
  'majorWatershed',
  'watershedGroup',
  'assessmentWatershed',
])
const NR_ADMIN_LEVEL_SET = new Set<NrAdminBoundaryLevel>(['nrArea', 'nrRegion', 'nrDistrict'])
const UWR_LEVEL_SET = new Set<UwrBoundaryLevel>(['ungulateWinterRange'])
const CROWN_TENURE_LEVEL_SET = new Set<CrownTenureBoundaryLevel>(['crownTenure'])
const RANGE_TENURE_LEVEL_SET = new Set<RangeTenureBoundaryLevel>(['rangeTenurePolygon', 'rangePasture'])
const MINERAL_TENURE_LEVEL_SET = new Set<MineralTenureBoundaryLevel>(['mineralTenure'])
const WALKABILITY_COMMUNITY_LEVEL_SET = new Set<WalkabilityCommunityBoundaryLevel>(['walkabilityCommunity'])

let boundaryIndexCache: BoundaryIndex | null = null
const boundaryRegionCache = new Map<string, StudyAreaRegion[]>()

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`)
  }
  return response.json() as Promise<T>
}

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

function isCityBoundaryLevel(level: RegionLevel): level is CityBoundaryLevel {
  return CITY_LEVEL_SET.has(level as CityBoundaryLevel)
}

function isWatershedBoundaryLevel(level: RegionLevel): level is WatershedBoundaryLevel {
  return WATERSHED_LEVEL_SET.has(level as WatershedBoundaryLevel)
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

async function loadBoundaryIndex(): Promise<BoundaryIndex> {
  if (boundaryIndexCache) return boundaryIndexCache
  boundaryIndexCache = await fetchJson<BoundaryIndex>(BOUNDARY_INDEX_PATH)
  return boundaryIndexCache
}

async function loadHealthRegions(level: BoundaryLevel): Promise<StudyAreaRegion[]> {
  const cacheKey = `bcHealth:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const [index, geometry] = await Promise.all([
    loadBoundaryIndex(),
    fetchJson<BoundaryFeatureCollection>(`/data/boundaries/BCMoH/${BOUNDARY_FILE_BY_LEVEL[level]}`),
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

async function loadCensusRegions(level: CensusBoundaryLevel): Promise<StudyAreaRegion[]> {
  const cacheKey = `census:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(CENSUS_FILE_BY_LEVEL[level])

  const regions = geometry.features
    .map<StudyAreaRegion | null>((rawFeature) => {
      const feature = toPolygonFeature(rawFeature)
      if (!feature) return null

      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const code = String(properties.id ?? properties.code ?? '').trim()
      if (!code) return null

      const displayName = String(properties.name ?? code).trim() || code
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

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

async function loadCityRegions(level: CityBoundaryLevel): Promise<StudyAreaRegion[]> {
  const cacheKey = `cityPG:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(CITY_FILE_BY_LEVEL[level])
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

async function loadCommunityRegions(level: CommunityBoundaryLevel): Promise<StudyAreaRegion[]> {
  const cacheKey = `cityCommunity:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(COMMUNITY_FILE_BY_LEVEL[level])

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

async function loadRegionalDistrictRegions(level: RegionalDistrictBoundaryLevel): Promise<StudyAreaRegion[]> {
  const cacheKey = `regionalDistrict:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(REGIONAL_DISTRICT_FILE_BY_LEVEL[level])

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

async function loadWatershedRegions(level: WatershedBoundaryLevel): Promise<StudyAreaRegion[]> {
  const cacheKey = `watershed:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(WATERSHED_FILE_BY_LEVEL[level])

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
): Promise<StudyAreaRegion[]> {
  const cacheKey = `${source}:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(filePath)

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

async function loadWalkabilityCommunityRegions(
  level: WalkabilityCommunityBoundaryLevel,
): Promise<StudyAreaRegion[]> {
  const cacheKey = `walkabilityCommunity:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(WALKABILITY_COMMUNITY_FILE_BY_LEVEL[level])

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
): Promise<StudyAreaRegion[]> {
  if (source === 'bcHealth') {
    if (!isHealthBoundaryLevel(level)) {
      throw new Error(`Invalid health boundary level: ${level}`)
    }
    return loadHealthRegions(level)
  }

  if (source === 'census') {
    if (!isCensusBoundaryLevel(level)) {
      throw new Error(`Invalid census boundary level: ${level}`)
    }
    return loadCensusRegions(level)
  }

  if (source === 'cityPG') {
    if (!isCityBoundaryLevel(level)) {
      throw new Error(`Invalid City of Prince George boundary level: ${level}`)
    }
    return loadCityRegions(level)
  }

  if (source === 'cityCommunity') {
    if (!isCommunityBoundaryLevel(level)) {
      throw new Error(`Invalid City of Prince George community boundary level: ${level}`)
    }
    return loadCommunityRegions(level)
  }

  if (source === 'regionalDistrict') {
    if (!isRegionalDistrictBoundaryLevel(level)) {
      throw new Error(`Invalid regional district boundary level: ${level}`)
    }
    return loadRegionalDistrictRegions(level)
  }

  if (source === 'nrAdmin') {
    if (!isNrAdminBoundaryLevel(level)) {
      throw new Error(`Invalid Natural Resource admin level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, NR_ADMIN_FILE_BY_LEVEL[level])
  }

  if (source === 'uwr') {
    if (!isUwrBoundaryLevel(level)) {
      throw new Error(`Invalid Ungulate Winter Range level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, UWR_FILE_BY_LEVEL[level])
  }

  if (source === 'crownTenure') {
    if (!isCrownTenureBoundaryLevel(level)) {
      throw new Error(`Invalid Crown tenure level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, CROWN_TENURE_FILE_BY_LEVEL[level])
  }

  if (source === 'rangeTenure') {
    if (!isRangeTenureBoundaryLevel(level)) {
      throw new Error(`Invalid range tenure level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, RANGE_TENURE_FILE_BY_LEVEL[level])
  }

  if (source === 'mineralTenure') {
    if (!isMineralTenureBoundaryLevel(level)) {
      throw new Error(`Invalid mineral tenure level: ${level}`)
    }
    return loadStandardBoundaryRegions(source, level, MINERAL_TENURE_FILE_BY_LEVEL[level])
  }

  if (source === 'walkabilityCommunity') {
    if (!isWalkabilityCommunityBoundaryLevel(level)) {
      throw new Error(`Invalid walkability community level: ${level}`)
    }
    return loadWalkabilityCommunityRegions(level)
  }

  if (!isWatershedBoundaryLevel(level)) {
    throw new Error(`Invalid Freshwater Atlas watershed level: ${level}`)
  }
  return loadWatershedRegions(level)
}

export function getWatershedLevelSourceNote(level: WatershedBoundaryLevel): string {
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

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const next = await loadStudyAreaRegions(source, level)
        if (!controller.signal.aborted) {
          setRegions(next)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setError((err as Error).message || 'Unable to load boundary geometry')
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [source, level])

  return {
    regions,
    loading,
    error,
  }
}
