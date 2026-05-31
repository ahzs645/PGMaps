import type { ScoreIndexDomain, ScoreIndexModule } from '../types'

export const SCORE_INDEX_MODULE_LABELS: Record<ScoreIndexModule, string> = {
  socialVulnerability: 'Social Vulnerability',
  environmentalBurden: 'Environmental Burden',
  healthVulnerability: 'Health Vulnerability',
  climateBurden: 'Climate Burden',
  localContext: 'Local Context',
}

export const SCORE_INDEX_DOMAIN_LABELS: Record<ScoreIndexDomain, string> = {
  demographics: 'Demographics',
  socioeconomic: 'Socioeconomic Status',
  housing: 'Housing',
  airPollution: 'Air Pollution',
  builtEnvironment: 'Built Environment',
  transportationInfrastructure: 'Transportation Infrastructure',
  foodSafety: 'Food Safety',
  publicSafety: 'Public Safety',
  heat: 'Heat',
  wildfire: 'Wildfire',
  extremeEvents: 'Extreme Events',
  healthConditions: 'Health Conditions',
  monitoring: 'Monitoring',
  services: 'Services',
}
