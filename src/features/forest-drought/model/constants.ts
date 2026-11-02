// SPDX-License-Identifier: Apache-2.0
// Copyright 2019 Province of British Columbia; browser adaptation 2026.

import type { Latitude, Soil } from './types'

export const MODEL_INFO = {
  id: 'forestDroughtTool-ts-v1',
  name: 'forestDroughtTool browser research calculator',
  sourceRepository: 'https://github.com/bcgov/forestDroughtTool',
  sourceCommit: 'e02ddcbf8203e65bada1a36655887e1d0c8fe2f5',
  methodVersion: '1.0.0',
  validation:
    'Daily kernel matched upstream R on 15 synthetic cases (84,501 comparisons; scaled tolerance 1e-10). Research model; wrapper policies differ.',
} as const

export const MAX_CLIMATE_DAYS = 36_600
export const MAX_SCENARIOS = 9
export const MAX_SOIL_DAY_EVALUATIONS = 500_000
export const MAX_CLIMATE_CSV_BYTES = 8_000_000

// Exact binary64 values decoded from upstream data/soilsData.rda, in upstream row order.
// SHA256: 729913da056da57ef03b452757c9b23eb12e68baf00316edd03de32109551b9b
export const DEFAULT_SOILS: readonly Soil[] = [
  { id: 1, label: 'Xeric', afc: 24.479999999999997, awsc: 17.3925, infiltrationRate: 7.5 },
  { id: 2, label: 'Subxeric', afc: 72.86500000000001, awsc: 56.72723118279595, infiltrationRate: 25.9 },
  { id: 3, label: 'Submesic', afc: 111.89999999999999, awsc: 87.01363636363651, infiltrationRate: 24.9 },
  { id: 4, label: 'Mesic', afc: 135.9, awsc: 108.7443396226413, infiltrationRate: 0 },
  { id: 5, label: 'Subhygric', afc: 109.44, awsc: 81.01499999999976, infiltrationRate: -28.4 },
]

export const DAY_LENGTH: Record<Latitude, readonly number[]> = {
  50: [8.3, 9.8, 11.6, 13.5, 15.2, 16.1, 15.7, 14.3, 12.4, 10.5, 8.8, 7.9],
  55: [7.5, 9.4, 11.5, 13.8, 15.9, 17.1, 16.6, 14.7, 12.4, 10.2, 8.1, 6.9],
  60: [6.4, 8.8, 11.4, 14.2, 16.8, 18.4, 17.7, 15.4, 12.5, 9.7, 7.1, 5.6],
}

export const ASMR_CLASSES = [
  { upper: 0.55, label: 'ED' },
  { upper: 0.65, label: 'VD1' },
  { upper: 0.75, label: 'VD2' },
  { upper: 0.85, label: 'MD' },
  { upper: 0.95, label: 'SD' },
  { upper: 1, label: 'F' },
] as const

/** R cut(..., breaks=c(0, asmrClass$asmrUL)) is open at zero, closed at each upper bound. */
export function classifyAsmr(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null
  return ASMR_CLASSES.find((entry) => value <= entry.upper)?.label ?? null
}
