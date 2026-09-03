import { WALKABILITY_MI_BANDS } from '@/maps/pgdata/walkabilityMiBands'
import type { ScoreVisualOutputMode } from '../types'
import type { ScorePaletteKey, ScorePaletteProfile } from './paletteTypes'

export function getScoreColor(score: number): string {
  if (score >= 90) return '#14532d'
  if (score >= 80) return '#166534'
  if (score >= 70) return '#3f6212'
  if (score >= 60) return '#4d7c0f'
  if (score >= 50) return '#a16207'
  if (score >= 40) return '#b45309'
  if (score >= 30) return '#c2410c'
  if (score >= 20) return '#b91c1c'
  return '#7f1d1d'
}

export const SCORE_PALETTE_PROFILES: Record<ScorePaletteKey, ScorePaletteProfile> = {
  airCoverage: {
    key: 'airCoverage',
    label: 'Coverage score',
    colors: ['#7f1d1d', '#c2410c', '#a16207', '#4d7c0f', '#166534'],
    legend: { low: 'Lower coverage', high: 'Higher coverage' },
  },
  benefit: {
    key: 'benefit',
    label: 'Benefit score',
    colors: ['#fefce8', '#bef264', '#84cc16', '#22c55e', '#14532d'],
    legend: { low: 'Lower benefit', high: 'Higher benefit' },
  },
  affordability: {
    key: 'affordability',
    label: 'Affordability score',
    colors: ['#eff6ff', '#bae6fd', '#67e8f9', '#14b8a6', '#0f766e'],
    legend: { low: 'Less affordable', high: 'More affordable' },
  },
  riskPressure: {
    key: 'riskPressure',
    label: 'Risk / pressure score',
    colors: ['#fef08a', '#fb923c', '#ef4444', '#be123c', '#581c87'],
    legend: { low: 'Lower pressure', high: 'Higher pressure' },
  },
  default: {
    key: 'default',
    label: 'Composite score',
    colors: ['#7f1d1d', '#b91c1c', '#b45309', '#4d7c0f', '#166534'],
    legend: { low: 'Lower priority', high: 'Higher priority' },
  },
}

const SCORE_PRESET_PALETTE_KEYS: Record<string, ScorePaletteKey> = {
  bcEnviroScreenReconstruction: 'riskPressure',
  balancedCoverage: 'airCoverage',
  lowCostExpansion: 'airCoverage',
  referenceNetwork: 'airCoverage',
  livabilityIndex: 'benefit',
  environmentalHealth: 'benefit',
  climateCommunityHealth: 'riskPressure',
  sensorGapEquity: 'riskPressure',
  schoolExposureMobility: 'benefit',
  monitoringGapProxy: 'riskPressure',
  heatShadeNeedProxy: 'riskPressure',
  shadeGapHeatMap: 'riskPressure',
  canopyCoolingHeatMap: 'benefit',
  housingClimateRetrofitNeed: 'riskPressure',
  foodSafetyAccess: 'benefit',
  hbeLinkagesIndex: 'benefit',
  hbeCompleteNeighbourhood: 'benefit',
  hbeActiveTransportation: 'benefit',
  pedestrianNetworkStudyMi: 'benefit',
  hbeNaturalEnvironmentAccess: 'benefit',
  hbeFoodAccessResilience: 'benefit',
  hbeHousingQualityHazards: 'affordability',
  transitAccess: 'benefit',
  communityResilienceProxy: 'benefit',
  housingAffordability: 'affordability',
  redevelopmentPressure: 'riskPressure',
  completeNeighbourhood: 'benefit',
  foodInspectionRisk: 'riskPressure',
  safetyPressure: 'riskPressure',
}

const SCORE_EXAMPLE_PALETTE_KEYS: Record<string, ScorePaletteKey> = {
  greenestNeighbourhoods: 'benefit',
  airQualityGapsCt: 'airCoverage',
  foodSafetyCt: 'benefit',
  communityLivabilityCt: 'benefit',
  lowCostSensorDeploymentDa: 'airCoverage',
  parkAccessDa: 'benefit',
  foodAccessDa: 'benefit',
  livabilityDa: 'benefit',
  pgClimateHealthVulnerabilityDa: 'riskPressure',
  pedestrianNetworkStudyMiDa: 'benefit',
  heatShadeNeedDa: 'riskPressure',
  shadeGapHeatMapDa: 'riskPressure',
  canopyCoolingHeatMapDa: 'benefit',
  sensorGapEquityDa: 'riskPressure',
  schoolExposureMobilityDa: 'benefit',
  housingAffordabilityDa: 'affordability',
  redevelopmentPressureDa: 'riskPressure',
  completeNeighbourhoodDa: 'benefit',
  foodInspectionRiskDa: 'riskPressure',
  crimePressureDa: 'riskPressure',
  cityOverviewCsd: 'benefit',
  provincialAirQualityHa: 'airCoverage',
  hsdaSensorCoverage: 'airCoverage',
  lhaMonitoringComparison: 'airCoverage',
  lhaLowCostExpansion: 'airCoverage',
  chsaSensorCoverage: 'airCoverage',
  chsaReferenceGaps: 'airCoverage',
}

function interpolateChannel(start: number, end: number, ratio: number): number {
  return Math.round(start + (end - start) * ratio)
}

function interpolateHexColor(start: string, end: string, ratio: number): string {
  const startValue = Number.parseInt(start.slice(1), 16)
  const endValue = Number.parseInt(end.slice(1), 16)
  const sr = (startValue >> 16) & 255
  const sg = (startValue >> 8) & 255
  const sb = startValue & 255
  const er = (endValue >> 16) & 255
  const eg = (endValue >> 8) & 255
  const eb = endValue & 255
  const r = interpolateChannel(sr, er, ratio).toString(16).padStart(2, '0')
  const g = interpolateChannel(sg, eg, ratio).toString(16).padStart(2, '0')
  const b = interpolateChannel(sb, eb, ratio).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

export function getScorePaletteProfile(
  activePresetKey: string | null,
  activeExampleKey: string | null,
): ScorePaletteProfile {
  const paletteKey =
    (activeExampleKey ? SCORE_EXAMPLE_PALETTE_KEYS[activeExampleKey] : undefined) ||
    (activePresetKey ? SCORE_PRESET_PALETTE_KEYS[activePresetKey] : undefined) ||
    'default'
  return SCORE_PALETTE_PROFILES[paletteKey]
}

export function getScorePaletteColor(score: number, profile: ScorePaletteProfile): string {
  if (!Number.isFinite(score)) return profile.colors[0]
  const normalizedScore = Math.max(0, Math.min(100, score)) / 100
  const scaledIndex = normalizedScore * (profile.colors.length - 1)
  const lowerIndex = Math.floor(scaledIndex)
  const upperIndex = Math.min(profile.colors.length - 1, lowerIndex + 1)
  const lowerColor = profile.colors[lowerIndex] || profile.colors[0]
  const upperColor = profile.colors[upperIndex] || lowerColor
  return interpolateHexColor(lowerColor, upperColor, scaledIndex - lowerIndex)
}

export function getScorePaletteBinIndex(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(4, Math.floor(Math.max(0, Math.min(99.999, score)) / 20)))
}

export function getScorePaletteBinnedColor(score: number, profile: ScorePaletteProfile): string {
  return profile.colors[getScorePaletteBinIndex(score)] || profile.colors[0]
}

/**
 * Re-exported from the shared MI band definitions so the score builder, the
 * Walkability tab and project packages all read one source. Prefer
 * `resolveWalkabilityMiBands`/`useWalkabilityMiBands` for anything user-facing:
 * those follow the generated grid's own colours and labels, while these
 * constants are the build-time defaults.
 */
export const WALKABILITY_REPORT_MI_COLORS = WALKABILITY_MI_BANDS.map((band) => band.color)

export const WALKABILITY_REPORT_MI_BANDS = WALKABILITY_MI_BANDS

export function getWalkabilityReportMiColor(score: number): string {
  if (!Number.isFinite(score)) return WALKABILITY_REPORT_MI_COLORS[0]
  return WALKABILITY_REPORT_MI_BANDS.find((band) => score < band.max)?.color || WALKABILITY_REPORT_MI_COLORS[4]
}

export function getScorePaletteOutputColor(
  score: number,
  profile: ScorePaletteProfile,
  mode: ScoreVisualOutputMode = 'interpolated',
): string {
  return mode === 'binned' ? getScorePaletteBinnedColor(score, profile) : getScorePaletteColor(score, profile)
}
