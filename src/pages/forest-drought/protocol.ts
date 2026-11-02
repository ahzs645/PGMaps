import type { ScenarioInput, SimulationResult, Soil } from '@/features/forest-drought/model'

export interface SimulationRequest {
  id: number
  csv: string
  latitude: 50 | 55 | 60
  soils: Soil[]
  scenarios: ScenarioInput[]
  summaryPolicy: 'day-weighted' | 'equal-month'
}

export type SimulationResponse =
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'complete'; result: SimulationResult; elapsedMs: number; dayCount: number }
  | { id: number; type: 'error'; message: string }
