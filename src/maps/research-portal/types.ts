export interface ResearchPortalOverview {
  submissionsTotal: number
  linkedRowsTotal: number
  linkedUniquePairs: number
  submissionsWithLocations: number
  submissionsWithoutLocations: number
  locationsTotal: number
  locationsWithCoordinates: number
  yearRange: { min: number; max: number } | null
}

export interface ResearchPortalSubmission {
  id: number
  title: string | null
  resourceType: string
  resourceTypeMain: string
  publicationYear: number | null
  decade: number | null
  author: string | null
  tags: string[]
  locationIds: string[]
}

export interface ResearchPortalLocation {
  id: string
  name: string
  coordinates: { lat: number; lon: number } | null
  coordinateSource: string | null
  totalPublications: number
  byDecade: Record<string, number>
  resourceTypes: Record<string, number>
}

export interface ResearchPortalDecadeSeries {
  decade: number
  total: number
  byResourceType: Record<string, number>
}

export interface ResearchPortalLocationFeatureProperties {
  id: string
  name: string
  count: number
  color: string
  radius: number
  dominantType: string
}
