/**
 * The catchment table of an extraction run (`landingCatchments.ts`): per landing (or per road
 * without landings) the ground it serves, its share of the ground within reach, and the mean and
 * farthest extraction distance.
 */
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { LANDING_STATUS_LABELS } from './extractionLandings'
import type { LandingCatchments } from './landingCatchments'

const metres = (m: number | null) => (m === null ? '—' : Math.round(m).toLocaleString('en-CA'))

export function LandingCatchmentResults({ catchments }: { catchments: LandingCatchments }) {
  const byLanding = catchments.by === 'landing'
  return (
    <div className="space-y-1 border-t pt-2" data-testid="landing-catchments">
      <div className="flex items-center gap-1 font-medium">
        {byLanding ? 'Landing catchments' : 'Road catchments'}
        <InfoTip label="About catchments">
          Each cell within reach leaves by one landing: the one its logs are skidded, forwarded, winched or yarded to,
          or the truck road a skid trail joins. Share is of the ground within reach. Distances are extraction distances
          as in the distance classes.{' '}
          {byLanding
            ? 'Every landing is listed, including those that serve no ground.'
            : 'Without landings set, the counted roads are the catchments.'}
        </InfoTip>
      </div>
      <div className="overflow-x-auto">
        <EngineeringTable rowHeaders compact data-testid="landing-catchment-table">
          <thead>
            <tr>
              <ColumnHeader label={byLanding ? 'Landing' : 'Road'} className="text-left" />
              <ColumnHeader label="Area" unit="ha" />
              <ColumnHeader label="Share" unit="%" />
              <ColumnHeader label="Mean" unit="m" title="Mean extraction distance" />
              <ColumnHeader label="Far." unit="m" title="Farthest extraction distance" />
            </tr>
          </thead>
          <tbody>
            {catchments.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <span className="mr-1 inline-block size-2 rounded-sm" style={{ background: row.color }} />
                  {row.name}
                  {row.status && (
                    <span className="block text-3xs text-muted-foreground">
                      {LANDING_STATUS_LABELS[row.status].toLowerCase()}
                    </span>
                  )}
                </th>
                <td>{row.ha.toFixed(1)}</td>
                <td>{(100 * row.share).toFixed(1)}</td>
                <td>{metres(row.meanM)}</td>
                <td>{metres(row.farthestM)}</td>
              </tr>
            ))}
            {catchments.unassignedHa > 0 && (
              <tr>
                <th scope="row" className="text-muted-foreground">
                  No landing traced
                </th>
                <td>{catchments.unassignedHa.toFixed(1)}</td>
                <td>{((100 * catchments.unassignedHa) / Math.max(catchments.coveredHa, 1e-9)).toFixed(1)}</td>
                <td>—</td>
                <td>—</td>
              </tr>
            )}
          </tbody>
        </EngineeringTable>
      </div>
    </div>
  )
}
