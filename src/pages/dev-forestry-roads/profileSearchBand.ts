/**
 * The band a profile search was free to place PVIs in (RoadEng's vertical band), for drawing on the
 * profile after a run: the band centre the run used (ground, or the profile it started from) less
 * the run's "below" and plus its "above", over the stretch it searched. Session only: it is never
 * stored in the project. Pure: no DOM or network access.
 */
import type { VerticalOptimizationReport } from './verticalOptimizer'
import type { VerticalPoint } from './types'

export interface SearchBandSample {
  chainage: number
  /** The band centre the run searched around, m. */
  centre: number
  /** The lowest and highest level a PVI could take here, m. */
  low: number
  high: number
}

/** The band as drawn: one sample at every station the run priced, from its own centre line and limits. */
export function searchBandSamples(band: VerticalOptimizationReport['band']): SearchBandSample[] {
  return band.line
    .filter((p) => Number.isFinite(p.chainage) && Number.isFinite(p.elevation))
    .map((p) => ({
      chainage: p.chainage,
      centre: p.elevation,
      low: p.elevation - band.belowM,
      high: p.elevation + band.aboveM,
    }))
}

/** The last run's band, with what it was searched on, so it is drawn only on that road and profile. */
export interface ProfileSearchBand {
  roadId: string
  /** The road's profile the run's result went into. */
  profileId?: string
  /** The profile as the run returned it: an edit to it puts the band away. */
  vertical: readonly Pick<VerticalPoint, 'chainage' | 'elevation' | 'curveLength'>[]
  /** The terrain the run read; another terrain puts the band away. */
  terrain: object
  samples: SearchBandSample[]
}

export function profileSearchBand(
  report: VerticalOptimizationReport,
  road: { id: string; activeVerticalAlternativeId?: string; vertical: readonly VerticalPoint[] },
  terrain: object,
): ProfileSearchBand {
  return {
    roadId: road.id,
    profileId: road.activeVerticalAlternativeId,
    vertical: road.vertical.map(({ chainage, elevation, curveLength }) => ({ chainage, elevation, curveLength })),
    terrain,
    samples: searchBandSamples(report.band),
  }
}

/**
 * The band to draw on a road's profile, or null: it belongs to another road or profile, the profile
 * has been edited since the run, or the terrain has changed.
 */
export function shownSearchBand(
  band: ProfileSearchBand | null,
  road: { id: string; activeVerticalAlternativeId?: string; vertical: readonly VerticalPoint[] },
  terrain: object,
): SearchBandSample[] | null {
  if (!band || band.roadId !== road.id || band.profileId !== road.activeVerticalAlternativeId) return null
  if (band.terrain !== terrain || band.vertical.length !== road.vertical.length) return null
  for (let i = 0; i < band.vertical.length; i++) {
    const kept = band.vertical[i],
      now = road.vertical[i]
    if (kept.chainage !== now.chainage || kept.elevation !== now.elevation || kept.curveLength !== now.curveLength)
      return null
  }
  return band.samples.length > 1 ? band.samples : null
}
