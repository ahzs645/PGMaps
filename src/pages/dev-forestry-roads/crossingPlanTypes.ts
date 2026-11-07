import type { Coordinate } from './types'

/** Planning alternatives only. Choosing one is not a hydraulic or fish-passage approval. */
export type CrossingStructure =
  | 'undecided'
  | 'bridge'
  | 'open-bottom'
  | 'embedded-culvert'
  | 'closed-bottom-culvert'
  | 'ford'

/** No installed-price defaults: an empty quantity/rate is unknown, including on shared items. */
export interface CrossingCostItem {
  id: string
  label: string
  quantity: number | null
  unit: string
  unitRate: number | null
  source: string
  sourceUrl: string
  priceDate: string
}

export interface StreamCrossingRecord {
  id: string
  featureId: string
  /** Exact physical crossing and occurrence; never nearest-neighbour reassigned. */
  identity: string
  coordinate: Coordinate
  chainage: number
  /** Geometry at last explicit review, not at last project save. */
  basisFingerprint: string
  structure: CrossingStructure
  evidence: string
  items: CrossingCostItem[]
  /** Explicit replacement of an existing engineering culvert's installed allowance. */
  replacesCulvertId?: string
}

export interface CrossingEstimateRow {
  record: StreamCrossingRecord
  name: string
  chainage: number
  status: 'current' | 'needs-review' | 'unrecorded'
  knownSubtotal: number
  complete: boolean
  missing: string[]
  basisFingerprint: string
}

export interface CrossingEstimate {
  rows: CrossingEstimateRow[]
  retired: StreamCrossingRecord[]
  /** Sum of priced current crossing items; unresolved records do not enter the ledger. */
  crossingSubtotal: number
  sharedSubtotal: number
  knownSubtotal: number
  /** Existing engineering allowances replaced by an explicitly linked current record. */
  replacedLegacyCost: number
  replacedLegacyIds: string[]
  /** Added once to a road estimate, before its existing contingency. */
  incrementalSubtotal: number
  complete: boolean
  warnings: string[]
}
