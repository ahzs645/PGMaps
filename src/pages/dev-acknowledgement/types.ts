export type SourceKey = 'verified' | 'nativeLand' | 'cad' | 'treaty' | 'reserve' | 'local'
export type Confidence = 'strong' | 'moderate' | 'review_required'
export type WordingMode = 'short' | 'formal' | 'event' | 'institutional' | 'educational'
export type MatchType = 'place' | 'municipality' | 'boundary'
export type GeocodeStatus = 'idle' | 'loading' | 'success' | 'error'
export type SourceStatus = 'idle' | 'loading' | 'success' | 'error' | 'skipped'

export type WordingOptions = {
  includeTreatyContext: boolean
  includePeopleGroupContext: boolean
}

export type CandidateNation = {
  id: string
  name: string
  preferredName: string
  confidence: Confidence
  pronunciation?: PronunciationInfo
  reason: string
  sources: Partial<Record<SourceKey, string>>
  notes: string
}

export type SourceMatch = {
  source: SourceKey
  name: string
  label: string
  detail?: string
}

export type SourceLookupState = {
  status: SourceStatus
  matches: SourceMatch[]
  message?: string
}

export type DataGap = {
  name: string
  status: string
  use: string
  limitation: string
  url: string
}

export type IndigenousManifestSource = {
  id: string
  title: string
  output?: string
  featureCount?: number
  access?: string
  source?: string
  sourceLayer?: string
  sourceUrl?: string
  url?: string
  caveat?: string
}

export type IndigenousManifest = {
  automated?: IndigenousManifestSource[]
  manual?: IndigenousManifestSource[]
}

export type TemplatePrompt = {
  label: string
  prompt: string
}

export type PronunciationInfo = {
  phonetic?: string
  audioUrl?: string
  sourceLabel: string
  sourceUrl: string
  caveat: string
}

export type PronunciationSource = {
  name: string
  status: string
  use: string
  caveat: string
  url: string
}

export type LocalLanguageResource = {
  name: string
  status: string
  use: string
  caveat: string
  url: string
  audioUrl?: string
  qrUrl?: string
}

export type RelationshipSource = {
  id: string
  title: string
  url: string
  sourceType: string
}

export type PeopleGroupRecord = {
  id: string
  preferredName: string
  alternateNames?: string[]
  displayName: string
}

export type NationRecord = {
  id: string
  preferredName: string
  alternateNames?: string[]
  peopleGroupIds?: string[]
}

export type ReferenceAreaRecord = {
  id: string
  name: string
  nationId?: string
  areaType: string
  geometryStatus: 'reference_map_only' | 'available_geojson' | 'manual_review'
  geometrySource?: {
    dataset: 'native-land' | 'indigenous'
    category: 'territories' | 'languages' | 'treaties' | 'first_nations_treaty_areas' | 'first_nations_treaty_lands'
    property: string
    value: string
  }
  sourceRefs: string[]
  caveat: string
}

export type PlaceRecord = {
  id: string
  name: string
  type: string
  locationNames?: string[]
  addressAliases?: string[]
}

export type PlaceRelationshipRecord = {
  id: string
  placeId: string
  relationshipType:
    | 'traditional_territory'
    | 'traditional_territories'
    | 'traditional_lands'
    | 'on_or_near_traditional_territories'
    | 'village_lands_within_treaty'
    | 'academic_campus_on_territory'
    | 'operations_on_territories'
    | 'campus_on_territory'
    | 'campus_on_peoples_territory'
  territoryStatus?: 'unceded'
  territoryQualifiers?: string[]
  treatyId?: string
  treatyName?: string
  landName?: string
  languageContext?: string[]
  nationIds: string[]
  peopleGroupIds?: string[]
  nationPeopleGroups?: Record<string, string[]>
  referenceAreaIds?: string[]
  verificationStatus: string
  sourceRefs: string[]
}

export type RelationshipGraph = {
  generatedAt: string
  notes?: string[]
  sources: RelationshipSource[]
  peopleGroups: PeopleGroupRecord[]
  nations: NationRecord[]
  referenceAreas?: ReferenceAreaRecord[]
  places: PlaceRecord[]
  placeRelationships: PlaceRelationshipRecord[]
}

export type MatchedRelationshipPlace = {
  place: PlaceRecord
  relationships: PlaceRelationshipRecord[]
}

export type GeocodeResult = {
  fullAddress: string
  latitude: number
  longitude: number
  score: number
  matchPrecision: string
  precisionPoints: number
  faults: string[]
  baseDataDate: string
  searchTimestamp: string
}

export type DroppedLocation = {
  latitude: number
  longitude: number
}

export type BcGeocoderFeature = {
  geometry?: {
    coordinates?: [number, number]
  }
  properties?: {
    fullAddress?: string
    score?: number
    matchPrecision?: string
    precisionPoints?: number
    faults?: unknown[]
  }
}

export type BcGeocoderResponse = {
  baseDataDate?: string
  searchTimestamp?: string
  features?: BcGeocoderFeature[]
}
