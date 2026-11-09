/** A map click opens the matching saved record without creating an evidence relationship. */
export interface AccessHistorySelection {
  kind: 'block' | 'road' | 'structure' | 'path'
  id: string
  revision: number
}

/** Transient request feedback. Successful coverage is also retained in source-query records. */
export interface AccessHistoryQueryStatus {
  kind: 'pilot' | 'identity' | 'roads' | 'structures'
  status: 'loading' | 'preview' | 'success' | 'error' | 'cancelled'
  blockId: string | null
  message: string
  occurredAt: string
}
import type { RoadWorkspace } from './useRoadWorkspace'

/** The history UI needs no terrain-analysis hook in a standalone record review. */
export type AccessHistoryWorkspace = Pick<
  RoadWorkspace,
  'project' | 'projectId' | 'alignment' | 'busy' | 'update' | 'setNotice' | 'canUndo' | 'undo'
>
