import type { CastorConfig, CastorProgress, CastorProject, CastorResult } from '@/features/forestry-castor/types'

export interface CastorRequest {
  id: number
  project: CastorProject
  config: CastorConfig
}

export type CastorResponse =
  | { id: number; type: 'progress'; progress: CastorProgress }
  | { id: number; type: 'complete'; result: CastorResult; elapsedMs: number }
  | { id: number; type: 'error'; message: string }
