/**
 * Cable coverage results below the shared extraction tables: the lines found, why the rest were
 * not kept, and the suggested lines with their selection settings (`cableLineSelection.ts`).
 */
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { NumberField } from './Controls'
import type { CableCoverageResult, CableLineRecord } from './cableCoverage'
import { CABLE_SELECTION_LIMITS, type CableSelection, type CableSelectionRule } from './cableLineSelection'

const pct = (share: number) => `${Math.round(100 * share)}%`
const REJECTED: Record<string, string> = {
  short: 'shorter than the shortest line',
  length: 'shorter than the shortest line',
  grid: 'off the terrain grid',
  unknown: 'unknown ground',
  barrier: 'a stream',
  'side-slope': 'side-slope ground',
  'outside-block': 'too long outside the block',
  position: 'yarder on the wrong side',
  budget: 'span budget',
  clearance: 'load clearance',
  tension: 'rope tension',
  gravity: 'gravity carriage stops',
  'unknown-ground': 'unknown ground',
  unsolvable: 'rope cannot carry the load',
  'tension-window': 'no shared pre-tension',
  'lift-off': 'skyline lifts off a support',
  'loaded-angle': 'loaded break angle',
  'no-candidates': 'no support site',
  empty: 'no yardable ground in its band',
}

export function CableCoverageResults({
  coverage,
  selection,
  rule,
  onRule,
  roadName,
}: {
  coverage: CableCoverageResult
  selection: CableSelection | null
  rule: CableSelectionRule
  onRule: (rule: CableSelectionRule) => void
  /** The road a landing lies on, by landing index. */
  roadName: (landing: number) => string
}) {
  const { stats, lines } = coverage
  const allRejected = Object.entries(stats.rejected)
    .filter(([, n]) => n && n > 0)
    .sort((a, b) => b[1]! - a[1]!)
  const rejected = allRejected.slice(0, 4)
  const otherRejected = allRejected.slice(4).reduce((sum, [, n]) => sum + (n ?? 0), 0)
  const byId = new Map(lines.map((l) => [l.id, l]))
  const chosen = (selection?.ids ?? []).map((id) => byId.get(id)).filter((l): l is CableLineRecord => !!l)
  const field = (key: keyof CableSelectionRule, label: string, scale = 1, step = 1, hint?: string) => (
    <NumberField
      label={label}
      value={rule[key] * scale}
      min={CABLE_SELECTION_LIMITS[key][0] * scale}
      max={CABLE_SELECTION_LIMITS[key][1] * scale}
      step={step}
      hint={hint}
      onChange={(value) => onRule({ ...rule, [key]: key === 'maxLines' ? Math.round(value) : value / scale })}
    />
  )
  return (
    <div className="space-y-2 border-t pt-2" data-testid="cable-coverage-results">
      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums">
        <dt className="text-muted-foreground">Lines that work</dt>
        <dd>
          {lines.length.toLocaleString('en-CA')} of {stats.candidates.toLocaleString('en-CA')}
        </dd>
        <dt className="text-muted-foreground">Yarder above / below</dt>
        <dd>
          {stats.machineAbove} / {stats.machineBelow}
        </dd>
        <dt className="text-muted-foreground">Mean skyline</dt>
        <dd>{stats.meanSkylineM === null ? '—' : `${Math.round(stats.meanSkylineM)} m`}</dd>
        <dt className="text-muted-foreground">Mean supports</dt>
        <dd>{stats.meanSupports === null ? '—' : stats.meanSupports.toFixed(1)}</dd>
        <dt className="text-muted-foreground">Landings</dt>
        <dd>{coverage.landings.length}</dd>
      </dl>
      {rejected.length > 0 && (
        <p className="text-2xs text-muted-foreground">
          Not kept:{' '}
          {rejected.map(([reason, n]) => `${n.toLocaleString('en-CA')} ${REJECTED[reason] ?? reason}`).join(', ')}
          {otherRejected > 0 ? `, and ${otherRejected.toLocaleString('en-CA')} for other reasons` : ''}.
        </p>
      )}
      <div className="space-y-1.5 border-t pt-2">
        <div className="flex items-center gap-1 font-medium">
          Suggested lines
          <InfoTip label="About the suggested lines">
            Greedy maximum coverage: each step takes the line that yards the most ground no chosen line yards, per unit
            cost, where each support adds the support penalty to a line&apos;s cost. A line must yard at least the new
            share of its own band to be taken. Lines the others cover almost wholly are dropped at the end. A
            suggestion, not a layout: check each line on its D-line profile with its supports.
          </InfoTip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {field('maxLines', 'Most lines')}
          {field('targetShare', 'Target (%)', 100, 5, 'Of the block’s known, fellable, open ground.')}
          {field('minNewShare', 'New share (%)', 100, 5, 'Of its own band a line must add.')}
          {field('supportPenalty', 'Support penalty', 1, 0.05, 'Extra cost per support, as a share of a line.')}
        </div>
        {selection && (
          <p className="tabular-nums" data-testid="cable-selection-summary">
            {chosen.length} line{chosen.length === 1 ? '' : 's'} yard {selection.coveredHa.toFixed(1)} ha:{' '}
            {pct(selection.shareOfFeasible)} of what every line yards, {pct(selection.shareOfCoverable)} of the block.
            {selection.stopped === 'max-lines'
              ? ' Stopped at the most lines.'
              : selection.stopped === 'target'
                ? ' Meets the target.'
                : ' No other line adds its new share.'}
          </p>
        )}
        {chosen.length > 0 && (
          <div className="overflow-x-auto">
            <EngineeringTable rowHeaders compact data-testid="cable-line-table">
              <thead>
                <tr>
                  <ColumnHeader label="Line" unit="bearing · from" className="text-left" />
                  <ColumnHeader label="Skyline" unit="m" />
                  <ColumnHeader label="Supp." title="Intermediate supports" />
                  <ColumnHeader label="Area" unit="ha" />
                  <ColumnHeader label="Carr." unit="m" title="Mean carriage distance" />
                </tr>
              </thead>
              <tbody>
                {chosen.map((line) => (
                  <tr key={line.id}>
                    <th scope="row">
                      <span className="block font-medium">{line.id}</span>
                      <span className="block text-3xs text-muted-foreground">
                        {Math.round(line.bearingDeg)}° · {roadName(line.landing)}
                        {line.designedLanding ? ' (designed)' : ''}
                      </span>
                    </th>
                    <td>{Math.round(line.skylineM)}</td>
                    <td>{line.points.length - 2}</td>
                    <td>{line.areaHa.toFixed(1)}</td>
                    <td>{Math.round(line.meanCarriageM)}</td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
        )}
      </div>
    </div>
  )
}
