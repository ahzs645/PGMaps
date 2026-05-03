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
}

export type BoundarySource = 'bcHealth' | 'census' | 'cityPG'
export type BoundaryLevel = 'healthAuthority' | 'hsda' | 'lha' | 'chsa'
export type CensusBoundaryLevel = 'cd' | 'csd' | 'ct' | 'da'
export type CityBoundaryLevel = 'elementarySchoolCatchment' | 'secondarySchoolCatchment'
export type RegionLevel = BoundaryLevel | CensusBoundaryLevel | CityBoundaryLevel

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
