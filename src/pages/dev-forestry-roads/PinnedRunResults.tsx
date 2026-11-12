/**
 * Compare with a pinned run (`pinnedRun.ts`): pin the current result, change the machine, limits or
 * landings, run again, and read the difference here and on the plan.
 */
import { Pin, PinOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import type { ExtractionMachine, ExtractionState } from './extractionReach'
import type { PinnedRunComparison } from './pinnedRun'

const MACHINES: Record<ExtractionMachine, string> = {
  skidder: 'skidder',
  forwarder: 'forwarder',
  cable: 'cable yarder',
}
const STATES: Record<ExtractionState, string> = {
  outside: 'Outside',
  covered: 'Within reach',
  beyond: 'Beyond reach',
  steep: 'Too steep for the machine',
  unfellable: 'Too steep to fell',
  excluded: 'No extraction area',
  unknown: 'Unknown',
}
const ha = (v: number) => v.toFixed(1)
const delta = (v: number) => `${v > 0.05 ? '+' : ''}${v.toFixed(1)}`

export function PinnedRunResults({
  pinnedLabel,
  isPinnedRun,
  comparison,
  error,
  onPin,
  onUnpin,
}: {
  /** What was pinned, or null. */
  pinnedLabel: string | null
  /** The current result is the pinned one. */
  isPinnedRun: boolean
  comparison: PinnedRunComparison | null
  error: string | null
  onPin: () => void
  onUnpin: () => void
}) {
  return (
    <div className="space-y-1.5 border-t pt-2" data-testid="pinned-run">
      <div className="flex items-center gap-1 font-medium">
        Compare with a pinned run
        <InfoTip label="About comparing with a pinned run">
          Pin this result, change the machine, limits, landings or roads, and run again: the area by state and distance
          class is shown for both, with the ground gained, lost, shorter and longer. Both runs must share the block,
          grid cell and travel band. Ground unknown in one run and known in the other is counted apart.
        </InfoTip>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="xs"
          variant="outline"
          className="gap-1"
          disabled={isPinnedRun}
          onClick={onPin}
          data-testid="pin-run"
        >
          <Pin className="size-3" />
          {pinnedLabel ? 'Pin this run instead' : 'Pin this run'}
        </Button>
        {pinnedLabel && (
          <Button size="xs" variant="ghost" className="gap-1" onClick={onUnpin}>
            <PinOff className="size-3" />
            Unpin
          </Button>
        )}
      </div>
      {pinnedLabel && <p className="text-2xs text-muted-foreground">Pinned: {pinnedLabel}</p>}
      {pinnedLabel && isPinnedRun && (
        <p className="text-2xs text-muted-foreground">Change a setting and run again to compare.</p>
      )}
      {error && <p className="text-2xs text-muted-foreground">{error}</p>}
      {comparison && (
        <div className="space-y-1.5" data-testid="pinned-comparison">
          <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums">
            {comparison.pinnedMachine !== comparison.currentMachine && (
              <>
                <dt className="text-muted-foreground">Machines</dt>
                <dd>
                  {MACHINES[comparison.pinnedMachine]} → {MACHINES[comparison.currentMachine]}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Gained</dt>
            <dd>{ha(comparison.gainedHa)} ha</dd>
            <dt className="text-muted-foreground">Lost</dt>
            <dd>{ha(comparison.lostHa)} ha</dd>
            <dt className="text-muted-foreground">Shorter / longer</dt>
            <dd>
              {ha(comparison.shorterHa)} / {ha(comparison.longerHa)} ha
            </dd>
            <dt className="text-muted-foreground">Mean change</dt>
            <dd>
              {comparison.meanChangeM === null
                ? '—'
                : `${comparison.meanChangeM > 0 ? '+' : ''}${Math.round(comparison.meanChangeM)} m`}
            </dd>
            {comparison.unknownChangedHa > 0 && (
              <>
                <dt className="text-muted-foreground">Unknown in one run</dt>
                <dd>{ha(comparison.unknownChangedHa)} ha</dd>
              </>
            )}
          </dl>
          <div className="overflow-x-auto overscroll-none">
            <EngineeringTable rowHeaders compact data-testid="pinned-state-table">
              <thead>
                <tr>
                  <ColumnHeader label="Block area" className="text-left" />
                  <ColumnHeader label="Pinned" unit="ha" />
                  <ColumnHeader label="Now" unit="ha" />
                  <ColumnHeader label="Δ" unit="ha" title="Now less pinned" />
                </tr>
              </thead>
              <tbody>
                {comparison.states
                  .filter((row) => row.pinnedHa > 0 || row.currentHa > 0)
                  .map((row) => (
                    <tr key={row.state}>
                      <th scope="row">{STATES[row.state]}</th>
                      <td>{ha(row.pinnedHa)}</td>
                      <td>{ha(row.currentHa)}</td>
                      <td>{delta(row.currentHa - row.pinnedHa)}</td>
                    </tr>
                  ))}
                {comparison.classes.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="pl-2 text-muted-foreground">
                      {row.label}
                    </th>
                    <td>{ha(row.pinnedHa)}</td>
                    <td>{ha(row.currentHa)}</td>
                    <td>{delta(row.currentHa - row.pinnedHa)}</td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
        </div>
      )}
    </div>
  )
}
