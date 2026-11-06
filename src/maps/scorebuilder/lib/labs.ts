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

const STUDY_AREA_STORAGE_KEY = 'pgmaps.labs.studyArea'

export interface LabStudyArea {
  source: string
  level: string
}

/** Remembers the study area for the session, so the Labs cards can reopen on it. */
export function rememberLabStudyArea(area: LabStudyArea) {
  try {
    window.sessionStorage.setItem(STUDY_AREA_STORAGE_KEY, JSON.stringify(area))
  } catch {
    // Private browsing or full storage: labs simply open on their default study area.
  }
}

export function recallLabStudyArea(): LabStudyArea | null {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(STUDY_AREA_STORAGE_KEY) ?? 'null')
    const area = parsed as Partial<LabStudyArea> | null
    return typeof area?.source === 'string' && typeof area.level === 'string'
      ? { source: area.source, level: area.level }
      : null
  } catch {
    return null
  }
}

export function forgetLabStudyArea() {
  try {
    window.sessionStorage.removeItem(STUDY_AREA_STORAGE_KEY)
  } catch {
    // Nothing was stored.
  }
}

/** A lab's path, opening on `area` when one is remembered. */
export function labHref(lab: ScoreLabInfo, area: LabStudyArea | null): string {
  if (!area) return lab.path
  return `${lab.path}?${new URLSearchParams({ src: area.source, level: area.level }).toString()}`
}

/**
 * True when `pathname` is this lab's page. Static hosts redirect `/density-lab` to
 * `/density-lab/` on a direct load or reload, so the trailing slash must not count.
 */
export function isOnLabPath(pathname: string, lab: ScoreLabKind): boolean {
  return pathname.replace(/\/+$/, '') === getScoreLab(lab).path
}

/** URL params that pin the lens metrics in the Density and Correlation labs. */
export const LAB_URL_PARAMS = {
  densityMetric: 'dm',
  correlateMetricX: 'cx',
  correlateMetricY: 'cy',
  correlateVisStyle: 'cstyle',
} as const
