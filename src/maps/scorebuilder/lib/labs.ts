/** The Labs landing page; each lab links back here instead of to its siblings. */
export const LABS_HOME_PATH = '/labs'

/**
 * The score builder's pipeline backs three separate pages. Each page fixes what the map
 * shows: the composite index, one metric's density, or the relationship between two
 * metrics. They share the study area, data sources, and region aggregation, but each
 * page shows only its own concept: a lab never links to another lab, only back to the
 * Labs page.
 */
export type ScoreLabKind = 'index' | 'density' | 'correlate'

export interface ScoreLabInfo {
  kind: ScoreLabKind
  path: string
  label: string
  title: string
  description: string
}

export const SCORE_LABS: readonly ScoreLabInfo[] = [
  {
    kind: 'index',
    path: '/score-builder',
    label: 'Index',
    title: 'Index Lab',
    description: 'Build transparent civic and environmental-health indices with adjustable weights and methods.',
  },
  {
    kind: 'density',
    path: '/density-lab',
    label: 'Density',
    title: 'Density Lab',
    description: 'Map one metric across the study area and find the regions where it is highest.',
  },
  {
    kind: 'correlate',
    path: '/correlation-lab',
    label: 'Correlation',
    title: 'Correlation Lab',
    description: 'Compare two metrics across regions and map where they agree or diverge.',
  },
]

export function getScoreLab(kind: ScoreLabKind): ScoreLabInfo {
  return SCORE_LABS.find((lab) => lab.kind === kind) ?? SCORE_LABS[0]
}

/** URL params that pin the lens metrics in the Density and Correlation labs. */
export const LAB_URL_PARAMS = {
  densityMetric: 'dm',
  correlateMetricX: 'cx',
  correlateMetricY: 'cy',
  correlateVisStyle: 'cstyle',
} as const
