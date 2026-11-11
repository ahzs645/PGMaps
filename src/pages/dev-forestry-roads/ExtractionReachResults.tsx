/**
 * The extraction-reach statistics: area by how logs leave and by state, distance classes and the
 * before/after comparison, after Sylvaccess 3.6's summary tables (Dupire et al. 2015; INRAE user
 * notice, 2024). Written from a functional specification; no code from Sylvaccess
 * (GPL-3.0-or-later) was used.
 */
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import {
  DISTANCE_CLASS_COLORS,
  type ExtractionComparison,
  type ExtractionMethod,
  type ExtractionState,
  type ExtractionSummary,
} from './extractionReach'

const pct = (share: number) => `${(100 * share).toFixed(share > 0 && share < 0.01 ? 1 : 0)}%`
const metres = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`)
const ha = (value: number) => value.toFixed(1)

const METHOD_LABELS: Record<ExtractionSummary['machine'], Partial<Record<ExtractionMethod, string>>> = {
  skidder: {
    road: 'On a road or trail',
    ground: 'Skidded',
    'winch-road': 'Winched from a road or trail',
    'winch-edge': 'Winched from driven ground',
  },
  forwarder: {
    road: 'On a road or trail',
    ground: 'Forwarded, free travel',
    run: 'Forwarded, straight runs',
    crane: 'Loaded by crane',
  },
  cable: {
    road: 'On a road',
    cable: 'Yarded by skyline',
  },
}
const STATE_LABELS: [ExtractionState, string][] = [
  ['beyond', 'Beyond reach'],
  ['steep', 'Too steep for the machine'],
  ['unfellable', 'Too steep to fell'],
  ['excluded', 'No extraction area'],
  ['unknown', 'Unknown'],
]

/** The run's statistics: area by how logs leave and by state, distance classes, and before/after. */
export function ExtractionReachResults({
  summary: s,
  comparison,
}: {
  summary: ExtractionSummary
  comparison: ExtractionComparison | null
}) {
  const share = (value: number) => (s.blockHa > 0 ? value / s.blockHa : 0)
  const methods = Object.entries(METHOD_LABELS[s.machine]) as [ExtractionMethod, string][]
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums">
        <dt className="text-muted-foreground">Within reach</dt>
        <dd>
          {pct(s.coveredShare)} · {ha(s.stateHa.covered)} ha
        </dd>
        <dt className="text-muted-foreground">Mean distance</dt>
        <dd>{s.meanTotalM === null ? '—' : metres(s.meanTotalM)}</dd>
        <dt className="text-muted-foreground">Farthest cell</dt>
        <dd>{s.farthest ? `${metres(s.farthest.totalM)}${s.farthest.covered ? '' : ' (beyond)'}` : '—'}</dd>
        {s.meanWinchM !== null && (
          <>
            <dt className="text-muted-foreground">Mean winch line</dt>
            <dd>{metres(s.meanWinchM)}</dd>
          </>
        )}
      </dl>
      <div className="overflow-x-auto overscroll-none">
        <EngineeringTable rowHeaders compact data-testid="extraction-area-table">
          <thead>
            <tr>
              <ColumnHeader label="Block area" className="text-left" />
              <ColumnHeader label="Area" unit="ha" />
              <ColumnHeader label="Share" unit="%" />
            </tr>
          </thead>
          <tbody>
            {methods.map(([method, label]) => (
              <tr key={method}>
                <th scope="row">{label}</th>
                <td>{ha(s.methodHa[method])}</td>
                <td>{(100 * share(s.methodHa[method])).toFixed(1)}</td>
              </tr>
            ))}
            {s.viaTrailHa > 0 && (
              <tr>
                <th scope="row" className="text-muted-foreground">
                  of which along a skid trail
                </th>
                <td>{ha(s.viaTrailHa)}</td>
                <td>{(100 * share(s.viaTrailHa)).toFixed(1)}</td>
              </tr>
            )}
            {STATE_LABELS.filter(([state]) => s.machine !== 'cable' || state !== 'steep').map(([state, label]) => (
              <tr key={state}>
                <th scope="row">{label}</th>
                <td>{ha(s.stateHa[state])}</td>
                <td>{(100 * share(s.stateHa[state])).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </EngineeringTable>
      </div>
      <div className="overflow-x-auto overscroll-none">
        <EngineeringTable rowHeaders compact data-testid="extraction-class-table">
          <thead>
            <tr>
              <ColumnHeader label="Distance class" className="text-left" />
              <ColumnHeader label="Area" unit="ha" />
              <ColumnHeader label="Share" unit="%" />
              <ColumnHeader label="Cum." unit="%" title="Cumulative share" />
            </tr>
          </thead>
          <tbody>
            {s.classes.map((row, k) => (
              <tr key={row.label}>
                <th scope="row">
                  <span
                    className="mr-1 inline-block size-2 rounded-sm"
                    style={{ background: DISTANCE_CLASS_COLORS[k % DISTANCE_CLASS_COLORS.length] }}
                  />
                  {row.label}
                </th>
                <td>{ha(row.ha)}</td>
                <td>{(100 * row.share).toFixed(1)}</td>
                <td>{(100 * row.cumulativeShare).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </EngineeringTable>
      </div>
      {s.disconnectedTrails.length > 0 && (
        <InlineAlert tone="warning">
          Not joined to a truck road, so left out: {s.disconnectedTrails.join(', ')}.
        </InlineAlert>
      )}
      {comparison && (
        <div className="space-y-1 border-t pt-2" data-testid="extraction-comparison">
          <div className="flex items-center gap-1 font-medium">
            Designed roads: before and after
            <InfoTip label="About the comparison">
              The same block and limits run with mapped roads only, then with the designed roads added. Green on the
              plan is newly within reach; teal is ground whose extraction distance falls.
            </InfoTip>
          </div>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums">
            <dt className="text-muted-foreground">Newly within reach</dt>
            <dd>{ha(comparison.newlyHa)} ha</dd>
            <dt className="text-muted-foreground">Distance shortened</dt>
            <dd>
              {ha(comparison.shortenedHa)} ha
              {comparison.meanShortenedM !== null ? ` · mean ${metres(comparison.meanShortenedM)}` : ''}
            </dd>
            {comparison.shortenedBy
              .filter((bin) => bin.ha > 0)
              .map((bin) => (
                <div key={bin.label} className="contents">
                  <dt className="pl-2 text-muted-foreground">{bin.label}</dt>
                  <dd>{ha(bin.ha)} ha</dd>
                </div>
              ))}
            {comparison.lostHa > 0 && (
              <>
                <dt className="text-muted-foreground">No longer within reach</dt>
                <dd>{ha(comparison.lostHa)} ha</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  )
}
