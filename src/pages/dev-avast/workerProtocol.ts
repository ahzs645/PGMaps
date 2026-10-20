import type { CandidateOverlay } from './overlay'
import type { Candidate, DensityFeature, GeometrySettings } from './types'

export type AvastWorkerRequest =
  | { type: 'run'; runId: number; candidates: Candidate[]; avast: DensityFeature[]; lidar: DensityFeature[]; settings: GeometrySettings }
  | { type: 'cancel' }

export type AvastWorkerResponse =
  | { type: 'candidate'; runId: number; index: number; total: number; key: string; overlay: CandidateOverlay }
  | { type: 'done'; runId: number }
  | { type: 'cancelled'; runId: number }
  | { type: 'error'; runId: number; message: string }
