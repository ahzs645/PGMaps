export interface Violation {
  code: string
  description: string
  observation: string
  corrective_action?: string
  corrected_during_inspection?: boolean
}

export type ViolationRiskBand = 'Severe' | 'Elevated' | 'Moderate' | 'Administrative' | 'Unknown'
export type ViolationRiskCategory =
  | 'Temperature Control'
  | 'Contamination'
  | 'Pest Control'
  | 'Sanitization & Hygiene'
  | 'Chemical Safety'
  | 'Facility & Equipment'
  | 'Administrative'
  | 'Other'

export interface ViolationRiskAssessment {
  band: ViolationRiskBand
  category: ViolationRiskCategory
  score: number
}

export interface ViolationRiskSummary {
  severe: number
  elevated: number
  moderate: number
  administrative: number
  unknown: number
  score: number
  worstBand: ViolationRiskBand
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
  risk: ViolationRiskSummary
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

// Roulette types
export type LocationMode = 'none' | 'geolocation' | 'manual'
export type SpinnerMode = 'wheel' | 'slot'

export interface SourceLocation {
  lat: number
  lng: number
}

export interface RouletteRestaurant extends Restaurant {
  distanceKm: number | null
  rouletteViolationCount: number
}
