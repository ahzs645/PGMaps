import createWebShareEngine from '@firstform/json-url/web-share'
import type {
  BoundarySource,
  CensusBoundaryLevel,
  BoundaryLevel,
  CityBoundaryLevel,
  CommunityBoundaryLevel,
  RegionalDistrictBoundaryLevel,
  WatershedBoundaryLevel,
} from '@/maps/airquality'
import type { ScoreDataSource, ScoreMetricWeightMap, ScoreMethodSettings } from '../types'
import type { MetricRecipe } from './metricRecipes'
import type { WalkabilitySurfaceTuning } from './walkabilitySurface'

export interface ScoreBuilderShareState {
  version: 1
  boundarySource: BoundarySource
  healthBoundaryLevel: BoundaryLevel
  censusBoundaryLevel: CensusBoundaryLevel
  communityBoundaryLevel?: CommunityBoundaryLevel
  regionalDistrictBoundaryLevel?: RegionalDistrictBoundaryLevel
  cityBoundaryLevel?: CityBoundaryLevel
  watershedBoundaryLevel?: WatershedBoundaryLevel
  enabledDataSources: ScoreDataSource[]
  selectedNetworks: string[]
  weights: Partial<ScoreMetricWeightMap>
  methodSettings?: ScoreMethodSettings
  mapSurface?: 'source' | 'boundary'
  customMetricRecipes?: MetricRecipe[]
  walkabilitySurfaceTuning?: WalkabilitySurfaceTuning
}

const shareEngine = createWebShareEngine<ScoreBuilderShareState>({
  codecs: ['raw', 'lz'],
  maxLength: 12000,
  skipUnsupportedCodecs: true,
})

export function encodeScoreBuilderShareState(state: ScoreBuilderShareState): Promise<string> {
  return shareEngine.compress(state)
}

export function decodeScoreBuilderShareState(token: string): Promise<ScoreBuilderShareState> {
  return shareEngine.decompress(token, { deURI: true })
}
