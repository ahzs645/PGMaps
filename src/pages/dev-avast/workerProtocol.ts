import type { CandidateOverlay } from './overlay'
import type { Candidate, DensityFeature, GeometrySettings, Piece } from './types'
import type { VriFeature, VriPiece } from './vriFill'

export type AvastWorkerRequest =
  | { type: 'run'; runId: number; candidates: Candidate[]; avast: DensityFeature[]; lidar: DensityFeature[]; settings: GeometrySettings }
  | { type: 'vri'; runId: number; candidates: Candidate[]; avastPieces: Piece[]; vri: VriFeature[]; minPieceHa: number }
  | { type: 'cancel' }

export type AvastWorkerResponse =
  | { type: 'candidate'; runId: number; index: number; total: number; key: string; overlay: CandidateOverlay }
  | { type: 'done'; runId: number }
  | { type: 'cancelled'; runId: number }
  | { type: 'error'; runId: number; message: string }
  | { type: 'vri-candidate'; runId: number; index: number; total: number; key: string; pieces: VriPiece[] }
