import type { Coordinate, ExistingRoadEvidence } from './types'

/** A numeric load rating is separate from general road/imagery condition evidence. */
export interface BridgeLoadRatingEvidence {
  sourceReference: string
  reviewer: string
  ratedLoadTonnes: number | null
  ratedAt: string | null
  validUntil: string | null
  /** Matching planning vehicle-class tags; ['*'] is an explicit all-classes assertion. */
  vehicleClasses: string[] | null
}

/** Reviewed planning inputs. Null means unknown/unpriced, not unlimited/zero. */
export interface RoadNetworkEvidence {
  access: 'allowed' | 'permission-required' | 'closed' | 'unknown'
  /** ['*'] explicitly allows every season/class. Null is unknown; [] allows none. */
  seasons: string[] | null
  vehicleClasses: string[] | null
  maxVehicleWeightTonnes: number | null
  bridgeStatus: 'none' | 'reviewed' | 'closed' | 'unknown'
  bridgeLoadTonnes: number | null
  bridgeRating: BridgeLoadRatingEvidence | null
  direction: 'both' | 'forward' | 'reverse'
  /** Known grade separation level; null never establishes an at-grade junction. */
  level: number | null
  forwardUphillGradePercent: number | null
  forwardDownhillGradePercent: number | null
  rehabilitationCostPerM: number | null
  accessCost: number | null
  structureCost: number | null
  fixedCost: number | null
  haulCostFactor: number
  /** Same ID on two roads explicitly declares a junction at the supplied coordinates. */
  junctions: { id: string; coordinate: Coordinate }[]
}

export interface RoadNetworkPolicy {
  asOf: string
  requireCurrentConditionEvidence: boolean
  snapToleranceM: number
  attachmentToleranceM: number
  season: string | null
  vehicleClass: string | null
  vehicleWeightTonnes: number | null
  maxUphillGradePercent: number | null
  maxDownhillGradePercent: number | null
  allowUnknownAccess: boolean
  allowPermissionRequired: boolean
  allowUnknownRestrictions: boolean
  allowUnknownCondition: boolean
  /** Explicit assumption for endpoint connections with unknown levels; known different levels never connect. */
  allowUnverifiedEndpointSnaps: boolean
}

export interface RoadNetworkInput {
  id: string
  name: string
  coordinates: Coordinate[]
  evidence?: ExistingRoadEvidence
  network?: RoadNetworkEvidence
  /** Proposed links are separately checked by the connector model; they are not existing-road reuse. */
  proposed?: boolean
}
export interface RoadNetworkAttachmentInput {
  id: string
  coordinate: Coordinate
  maxDistanceM?: number
  roadId?: string
}
export interface RoadNetworkAttachment {
  id: string
  nodeId: string | null
  coordinate: Coordinate
  projectedCoordinate?: Coordinate
  roadId?: string
  distanceM: number | null
  reason?: string
}
export interface RoadNetworkNode {
  id: string
  coordinate: Coordinate
}
export type RoadNetworkCostKind = 'rehabilitation' | 'structure' | 'access' | 'fixed'
export interface RoadNetworkCostItem {
  id: string
  kind: RoadNetworkCostKind
  amount: number | null
  label: string
  roadId: string
}
export interface RoadNetworkEdge {
  id: string
  from: string
  to: string
  roadId: string | null
  kind: 'road' | 'junction' | 'attachment'
  reused: boolean
  coordinates: Coordinate[]
  lengthM: number
  weightedLengthM: number
  forwardAllowed: boolean
  reverseAllowed: boolean
  costItems: RoadNetworkCostItem[]
  warnings: string[]
}
export interface RoadNetworkGraph {
  nodes: Map<string, RoadNetworkNode>
  edges: Map<string, RoadNetworkEdge>
  adjacency: Map<string, { edgeId: string; to: string; forward: boolean }[]>
  attachments: Map<string, RoadNetworkAttachment>
  excludedRoads: { roadId: string; name: string; reasons: string[] }[]
  warnings: string[]
  policy: RoadNetworkPolicy
}
export interface RoadNetworkPathOptions {
  distanceRatePerM: number
  objective?: 'distance' | 'total-cost'
  includeRehabilitation?: boolean
  /** Costs already installed/paid on another selected access or supply path. */
  paidCostItemIds?: readonly string[]
  /** A distance screen can expose unpriced costs; it must not report a priced total. */
  allowUnpricedCosts?: boolean
}
export interface RoadNetworkPath {
  coordinates: Coordinate[]
  edgeIds: string[]
  roadIds: string[]
  lengthM: number
  distanceM: number
  weightedLengthM: number
  reusedLengthM: number
  junctionGapM: number
  attachmentDistanceM: number
  haulCost: number
  rehabilitationCost: number | null
  accessCost: number | null
  structureCost: number | null
  fixedCost: number | null
  totalCost: number | null
  cost: number | null
  costItems: RoadNetworkCostItem[]
  costItemIds: string[]
  /** Same IDs, for callers that previously named once-only allowances cost groups. */
  costGroupIds: string[]
  warnings: string[]
}
