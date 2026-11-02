import type { CastorReportProgress } from '@/features/forestry-castor/outputs'
import type { CastorConfig, CastorProgress, CastorProject } from '@/features/forestry-castor/types'
import type { CastorChunk } from './chunks'

export interface CastorRequest {
  id: number
  project: CastorProject
  config: CastorConfig
}

/** The result arrives as 'chunk' messages (see chunks.ts) followed by 'complete'. */
export type CastorResponse =
  | { id: number; type: 'progress'; progress: CastorProgress }
  | { id: number; type: 'chunk'; chunk: CastorChunk }
  | { id: number; type: 'complete'; elapsedMs: number }
  | { id: number; type: 'error'; message: string }

/** The page streams the project and result as chunks, then asks for the archive. */
export type CastorReportRequest = { type: 'chunk'; chunk: CastorChunk } | { type: 'build' }

export type CastorReportResponse =
  | { type: 'progress'; progress: CastorReportProgress }
  | { type: 'complete'; bytes: ArrayBuffer }
  | { type: 'error'; message: string }
