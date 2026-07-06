// Domain types live in the tested engine; the app re-exports them so component
// imports stay stable. App-only I/O types (geocoding, manifest, UI content) are
// defined here.
export type {
  MatchType,
  MatchedRelationshipPlace,
  NationRecord,
  PeopleGroupRecord,
  PlaceRecord,
  PlaceRelationshipRecord,
  ReferenceAreaRecord,
  RelationshipGraph,
  RelationshipSource,
  SourceKey,
  SourceMatch,
  SpeakerPerspective,
  WordingMode,
  WordingOptions,
} from '@/lib/acknowledgement/engine'
export type {
  CandidateNation,
  Confidence,
  PronunciationInfo,
  SourceLookupState,
  SourceStatus,
} from '@/lib/acknowledgement/candidates'

export type GeocodeStatus = 'idle' | 'loading' | 'success' | 'error'

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
  /** Display name for the location (address or campus name), when it has one. */
  label?: string
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
