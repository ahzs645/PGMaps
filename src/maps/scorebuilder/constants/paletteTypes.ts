export type ScorePaletteKey = 'airCoverage' | 'benefit' | 'affordability' | 'riskPressure' | 'default'

export interface ScorePaletteProfile {
  key: ScorePaletteKey
  label: string
  colors: readonly [string, string, string, string, string]
  legend: {
    low: string
    high: string
  }
}
