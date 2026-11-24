import type { Plan } from '../plan'
import type { AnalysisState } from '../usePlanAnalysis'

export type Drawing = 'block' | 'shape' | 'disturbance'
export type ImportKind = 'blocks' | 'baseline' | 'zones' | 'unit'

/** What every step editor is handed by the page. Edits go through `edit` and nothing else. */
export interface StepProps {
  plan: Plan
  edit: (change: (plan: Plan) => Plan) => void
  selectedBlock: string | null
  selectBlock: (id: string | null) => void
  drawing: Drawing | null
  startDrawing: (kind: Drawing) => void
  importFiles: (kind: ImportKind, files: File[]) => void
  /** The schedule and year on the map. */
  shown: { schedule: string; year: number }
  setShown: (shown: { schedule?: string; year?: number }) => void
  analysis: AnalysisState
  /** Whether the old forest layer is drawn on the map (session only, never in the plan). */
  oldForestMapOn: boolean
  setOldForestMapOn: (on: boolean) => void
  /** Runs a planner command (open a file, the sample) from inside a step. */
  onCommand: (id: 'open' | 'openSample') => void
}
