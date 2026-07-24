export interface ResearchRecordsOverview {
  submissionsTotal: number
  linkedRowsTotal: number
  linkedUniquePairs: number
  submissionsWithLocations: number
  submissionsWithoutLocations: number
  locationsTotal: number
  locationsWithCoordinates: number
  yearRange: { min: number; max: number } | null
}

export interface ResearchRecord {
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

export interface ResearchRecordsLocation {
  id: string
  name: string
  coordinates: { lat: number; lon: number } | null
  coordinateSource: string | null
  totalPublications: number
  byDecade: Record<string, number>
  resourceTypes: Record<string, number>
}

export interface ResearchRecordsTimelineBucket {
  decade: number
  total: number
  byResourceType: Record<string, number>
}

export interface ExplorerLocationFeatureProperties {
  id: string
  name: string
  count: number
  color: string
  radius: number
  dominantType: string
}
