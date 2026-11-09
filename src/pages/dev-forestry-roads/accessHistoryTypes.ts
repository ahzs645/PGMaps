import type { ContextFeature, Coordinate } from './types'

/** Inclusive bounds on an actual event date. Null is unknown, never a guessed year. */
export interface DateWindow {
  earliest: string | null
  latest: string | null
}

export interface HistoricalSource {
  id: string
  dataset: string
  recordId: string
  url: string
  retrievedAt: string
  publishedOn: string | null
  description: string
  synthetic: boolean
  /** Retained source business keys. Matching an opening is not a block-to-road-use assertion. */
  blockIdentity?: HistoricalBlockIdentity
}

export interface HistoricalBlockIdentity {
  entityId: string
  source: 'results-opening' | 'ften-cutblock'
  openingId: string
  cutblockSKey?: string
  forestFileId?: string
  cuttingPermitId?: string
  cutBlockId?: string
  timberMark?: string
  clientNumber?: string
  lifecycleStatus?: string
  disturbanceStartDate?: string
  disturbanceEndDate?: string
}

export type HistoricalRelationship = 'proximity' | 'inferred-access' | 'planned-access' | 'documented-use' | 'rejected'

export interface HistoricalRoadEvent {
  id: string
  roadId: string
  kind: 'constructed' | 'present-observed' | 'deactivated' | 'reactivated' | 'closed' | 'removed'
  when: DateWindow
  /** Observation/publication date is separate from the physical event's date. */
  observedOn: string | null
  sourceIds: string[]
  /** Binds road events to their reviewed extent, not just the road's name. */
  geometryFingerprint: string
}

/** Multiple reports stay separate; a conflicting rating is never silently selected. */
export interface HistoricalStructureEvidence {
  id: string
  sourceIds: string[]
  kind: 'load-rating' | 'closure' | 'restriction'
  validFrom: string | null
  validUntil: string | null
  ratedLoadTonnes: number | null
  description: string
}

export interface HistoricalStructure {
  id: string
  name: string
  kind: 'bridge' | 'culvert' | 'ford' | 'unknown'
  coordinate: Coordinate
  sourceIds: string[]
  /** Source-namespaced crossing identity, e.g. rri:123 or pscis:123; bare numbers are not cross-dataset joins. */
  crossingSiteId: string | null
  /** Source-namespaced physical asset identity; replacements at one crossing retain different IDs. */
  structureId: string | null
  sourceRowId: string | null
  roadId: string | null
  roadKey: { forestFileId: string; roadSectionId: string } | null
  attachment: 'identifier-match' | 'spatial-candidate' | 'reviewed' | 'unresolved'
  /** Maximum actual coordinate-to-named-road separation; not an unlimited identifier join. */
  attachmentToleranceM: number
  construction: DateWindow | null
  removal: DateWindow | null
  evidence: HistoricalStructureEvidence[]
}

/** Entrances are explicit boundary/landing locations. A block centroid is never substituted. */
export interface HistoricalAnchor {
  id: string
  name: string
  role: 'entrance' | 'outlet'
  coordinate: Coordinate
  roadId: string | null
  blockId: string | null
  sourceIds: string[]
}

export interface HistoricalTraceSettings {
  asOf: string
  allowUnknownTime: boolean
  allowUnverifiedEndpointSnaps: boolean
  snapToleranceM: number
  attachmentToleranceM: number
  maxVariants: number
}

export interface HistoricalPathSegment {
  id: string
  roadId: string | null
  kind: 'road' | 'junction' | 'attachment'
  /** Travel direction relative to the retained source edge, used for shared interval accounting. */
  forward: boolean
  coordinates: [Coordinate, Coordinate]
  lengthM: number
}

export interface HistoricalAccessPath {
  id: string
  blockId: string
  entranceId: string
  outletId: string
  period: DateWindow
  /** Frozen search assumptions; changing the sidebar date does not rewrite an earlier result. */
  settings: HistoricalTraceSettings
  relationship: HistoricalRelationship
  sourceIds: string[]
  roadIds: string[]
  coordinates: Coordinate[]
  segments: HistoricalPathSegment[]
  structureIds: string[]
  lengthM: number
  inputFingerprint: string
  assumptions: string[]
  review: { reviewer: string; reviewedOn: string; reference: string } | null
}

export interface HistoricalAccessState {
  schema: 'historical-access-v1'
  settings: HistoricalTraceSettings
  sources: HistoricalSource[]
  events: HistoricalRoadEvent[]
  structures: HistoricalStructure[]
  anchors: HistoricalAnchor[]
  paths: HistoricalAccessPath[]
  selectedPathId: string | null
}

export interface HistoricalTemporalAssessment {
  status: 'compatible' | 'unknown' | 'contradicted' | 'conflict'
  reasons: string[]
  sourceIds: string[]
}

export interface HistoricalStructureAssessment extends HistoricalTemporalAssessment {
  structureId: string
  binding: 'matched' | 'unresolved'
}

export interface HistoricalTraceInput {
  context: readonly ContextFeature[]
  state: HistoricalAccessState
  blockId: string
  /** Omitted lists use matching saved entrances and all saved outlets. */
  entranceIds?: string[]
  outletIds?: string[]
  settings?: Partial<HistoricalTraceSettings>
}

export interface HistoricalTraceResult {
  paths: HistoricalAccessPath[]
  excludedRoads: { roadId: string; name: string; reasons: string[] }[]
  structures: { structureId: string; status: HistoricalTemporalAssessment['status']; reasons: string[] }[]
  unresolved: string[]
  inputFingerprint: string
}
