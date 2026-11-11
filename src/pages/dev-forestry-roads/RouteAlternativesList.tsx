import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { hasCompleteCoverage } from './analysisResult'
import { isUntouchedRouteAlternative } from './routeAlternatives'
import type { RoadWorkspace } from './useRoadWorkspace'

const whole = (n: number) => Math.round(n).toLocaleString('en-CA')

/**
 * The roads terrain-cost searches made, each with the search's own score and what the road now
 * breaks. The score is shown here and nowhere else, so it cannot be read as the road's estimate.
 */
export function RouteAlternativesList({
  workspace,
  onSelectRoad,
}: {
  workspace: RoadWorkspace
  onSelectRoad?: (id: string) => void
}) {
  const { project, alignment, analyses } = workspace
  const limit = project.settings.maxGradePercent,
    minRadius = project.settings.minRadius
  const found = project.alignments
    .filter((road) => road.routeSearch)
    .sort((a, b) => a.name.localeCompare(b.name, 'en-CA', { numeric: true }))
  if (!found.length) return null
  return (
    <div className="space-y-1" data-testid="road-route-alternatives">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Routes found</p>
        <InfoTip label="About found routes">
          <b>Search score</b> is the search&apos;s own ranking figure: road $/m over the length, raised up to four times
          by ground grade, plus crossing and zone costs. It is not an estimate. Open a road for its estimate.
          <br />
          <b>To check</b> lists what the road breaks as it stands: sharp corners, curves under the minimum radius,
          sections with no ground, and ground steeper than the grade limit where the road has no profile yet. The search
          held the grade limit on the ground trend, so the raw ground reads steeper until a profile is fitted.
          <br />
          The next search replaces the roads here that have not been changed. A road you rename, edit or give a profile
          is kept.
        </InfoTip>
      </div>
      <div className="overflow-x-auto overscroll-none text-2xs">
        <EngineeringTable>
          <thead>
            <tr>
              <ColumnHeader label="Route" />
              <ColumnHeader label="Length" />
              <ColumnHeader label="Search score" />
              <ColumnHeader label="To check" />
            </tr>
          </thead>
          <tbody>
            {found.map((road) => {
              const record = road.routeSearch!
              const analysis = analyses.get(road.id)
              const sharp = analysis
                ? new Set(
                    analysis.stations.flatMap((station) =>
                      station.flags.some((flag) => /Sharp horizontal PI/i.test(flag)) ? [station.chainage] : [],
                    ),
                  ).size
                : 0
              const tight = road.points.filter((point) => point.radiusM > 0 && point.radiusM < minRadius - 1e-6).length
              const checks = analysis
                ? [
                    sharp > 0 && `${sharp} sharp corner${sharp === 1 ? '' : 's'}`,
                    tight > 0 && `${tight} curve${tight === 1 ? '' : 's'} under ${minRadius} m`,
                    !hasCompleteCoverage(analysis) && `${Math.floor(analysis.coveragePercent)}% of sections complete`,
                    analysis.maxGradePercent > limit + 1e-6 &&
                      `${road.vertical.length ? 'grade' : 'ground'} ${analysis.maxGradePercent.toFixed(1)}%`,
                  ].filter(Boolean)
                : ['not analysed']
              return (
                <tr key={road.id} className={road.id === alignment.id ? 'bg-primary/5' : undefined}>
                  <td>
                    <button
                      className="text-left underline-offset-2 hover:underline"
                      title={`Open ${road.name}`}
                      aria-current={road.id === alignment.id ? 'true' : undefined}
                      onClick={() => onSelectRoad?.(road.id)}
                    >
                      {road.name.split(' · ').at(-1)}
                    </button>
                    {!isUntouchedRouteAlternative(road) && <span className="text-muted-foreground"> · kept</span>}
                  </td>
                  <td className="tabular-nums">{analysis ? `${whole(analysis.length)} m` : '—'}</td>
                  <td className="tabular-nums" title={`Rank ${record.rank} of ${record.of} in its search`}>
                    ${whole(record.searchScore)}
                  </td>
                  <td className={checks.length ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>
                    {checks.length ? checks.join('; ') : 'Nothing flagged'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </EngineeringTable>
      </div>
    </div>
  )
}
