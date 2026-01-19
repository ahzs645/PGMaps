export interface Violation {
  code: string
  description: string
  observation: string
  corrective_action?: string
  corrected_during_inspection?: boolean
}

export interface Inspection {
  date?: string
  inspection_date?: string
  type?: string
  inspection_type?: string
  hazard_rating: HazardRating
  critical_violations_count: number
  non_critical_violations_count: number
  follow_up_required?: 'Yes' | 'No'
  violations?: Violation[]
}

export type HazardRating = 'Low' | 'Moderate' | 'Unknown'
export type FacilityType = 'Restaurant' | 'Institutional Kitchen' | 'Store' | 'Unknown' | 'Other'
export type VisualizationMode = 'violations' | 'hazard'

export interface Restaurant {
  name: string
  address: string
  full_address?: string
  latitude: number | null
  longitude: number | null
  facility_type: FacilityType
  hazard_rating: HazardRating
  current_hazard_rating?: HazardRating
  details_url: string
  inspections?: Inspection[]
}

export interface ViolationStats {
  total: number
  critical: number
  nonCritical: number
  inspectionCount: number
}

export interface RestaurantWithStats extends Restaurant {
  filteredInspections: Inspection[]
  hazardRatingAtDate: HazardRating
  violationStats: ViolationStats
}

export interface RestaurantStats {
  total: number
  geocoded: number
  byHazard: Record<HazardRating, number>
  byFacilityType: Record<string, number>
  totalInspections: number
  totalViolations: number
}

export interface TimelineStats {
  totalViolations: number
  criticalViolations: number
  totalInspections: number
  restaurantsWithViolations: number
}

export interface HazardStatsAtDate {
  Low: number
  Moderate: number
  Unknown: number
}
