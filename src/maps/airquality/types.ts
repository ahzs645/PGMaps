export interface AirMonitor {
  id: string
  name: string
  network: string
  latitude: number
  longitude: number
  city?: string | null
  province?: string | null
  status?: string | null
  parameters: string[]
  source?: string | null
  dateObserved?: string | null
  pm25Recent?: number | null
  metadata?: {
    temperature?: number | null
    humidity?: number | null
    pressure?: number | null
    [key: string]: number | string | null | undefined
  } | null
}

export type AirQualityBasemap = 'light' | 'topographic' | 'dark'

export type AirQualityCorrectionModel =
  | 'rawPurpleAir'
  | 'epaBarkjohn'
  | 'nilsonLocal'
  | 'wildfireSmoke'
  | 'siteSpecific'

export type AirQualityObservationLayer =
  | 'rawPA'
  | 'correctedPA'
  | 'rawEGG'
  | 'correctedEGG'
  | 'agencyFEM'

export type AirQualityBoundaryColorMetric =
  | 'sensorCount'
  | 'overallDensity'
  | 'lowCostDensity'
  | 'otherDensity'
  | 'correctedPm25'
  | 'rawPm25'
  | 'networkCount'

export type BoundarySource =
  | 'bcHealth'
  | 'regionalDistrict'
  | 'census'
  | 'cityPG'
  | 'watershed'
  | 'nrAdmin'
  | 'uwr'
  | 'crownTenure'
  | 'rangeTenure'
  | 'mineralTenure'
export type BoundaryLevel = 'healthAuthority' | 'hsda' | 'lha' | 'chsa'
export type RegionalDistrictBoundaryLevel = 'regionalDistrict'
export type CensusBoundaryLevel = 'cd' | 'csd' | 'ct' | 'da'
export type CityBoundaryLevel = 'elementarySchoolCatchment' | 'secondarySchoolCatchment'
export type WatershedBoundaryLevel = 'majorWatershed' | 'watershedGroup' | 'assessmentWatershed'
export type NrAdminBoundaryLevel = 'nrArea' | 'nrRegion' | 'nrDistrict'
export type UwrBoundaryLevel = 'ungulateWinterRange'
export type CrownTenureBoundaryLevel = 'crownTenure'
export type RangeTenureBoundaryLevel = 'rangeTenurePolygon' | 'rangePasture'
export type MineralTenureBoundaryLevel = 'mineralTenure'
export type RegionLevel =
  | BoundaryLevel
  | RegionalDistrictBoundaryLevel
  | CensusBoundaryLevel
  | CityBoundaryLevel
  | WatershedBoundaryLevel
  | NrAdminBoundaryLevel
  | UwrBoundaryLevel
  | CrownTenureBoundaryLevel
  | RangeTenureBoundaryLevel
  | MineralTenureBoundaryLevel

export interface BoundaryRegionRecord {
  id: string
  code: string
  name: string
  fullId?: string
  healthAuthorityCode?: string
  healthAuthorityName?: string
  hsdaCode?: string
  hsdaName?: string
  lhaCode?: string
  lhaName?: string
  [key: string]: string | number | null | undefined
}

export interface BoundaryIndex {
  healthAuthorities: BoundaryRegionRecord[]
  healthServiceDeliveryAreas: BoundaryRegionRecord[]
  localHealthAreas: BoundaryRegionRecord[]
  communityHealthServiceAreas: BoundaryRegionRecord[]
}

export interface SelectedBoundaryRegion {
  source: BoundarySource
  level: RegionLevel
  code: string
  name: string
  levelLabel: string
}

export interface SensorDensityStats {
  lowCost: number
  other: number
  overall: number
  areaKm2: number
  actualCoverageKm2: number
  coveragePercent: number
  totalCount: number
  lowCostCount: number
  otherCount: number
}

export interface AirQualityAreaStats {
  monitorCount: number
  pm25MonitorCount: number
  rawPm25Average: number | null
  correctedPm25Average: number | null
  correctedPm25Min: number | null
  correctedPm25Max: number | null
  networkCount: number
}
