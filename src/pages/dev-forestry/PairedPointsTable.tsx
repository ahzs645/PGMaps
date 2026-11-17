/**
 * Points paired in the photo and on the plan, as a table (WSL Monoplotting Tool, Pic2Map): each pair's residual
 * against the solved camera in pixels and in metres on the ground, on or off per pair. An off pair stays drawn and
 * measured as a check point, the honest test of a solve since the solve never saw it. The reviewer's click and the
 * solved spot are both drawn on the photo, joined by a line (`PhotoWithOverlays`, `showPairs`).
 */
import { Crosshair, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'

import { pairResiduals, worstCheckPoint } from './pairResiduals'
import { controlSolveSuspect } from './photoQueue'
import type { FieldPhotoState } from './useFieldPhoto'

const NOTE = 'text-xs leading-5 text-muted-foreground'
const px = (value: number | null) => (value === null ? '–' : value.toFixed(1))
const metres = (value: number | null) => (value === null ? '–' : `${Math.round(value)}`)

export function PairedPointsTable({
  photo,
  placing,
  onPlacing,
  canPick,
}: {
  photo: FieldPhotoState
  /** Whether the next click on the photo places a point. */
  placing: boolean
  onPlacing: (placing: boolean) => void
  /** False when the plan cannot be asked for a click. */
  canPick: boolean
}) {
  const solve = photo.controlSolve
  const rows = pairResiduals(photo.pairs, photo.pairsOff, solve)
  const on = rows.filter((row) => row.on).length
  const check = worstCheckPoint(rows)
  return (
    <div className="space-y-2" aria-label="Pair points">
      <p className={NOTE}>
        Click a spot in the photo, then the same spot on the plan: a road bend, a pond, a block corner. With{' '}
        {photo.pairsNeeded} or more the camera is solved from them alone. Turn a pair off to keep it as a check point.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={placing ? 'default' : 'outline'}
          className="touch:h-10"
          disabled={!canPick}
          aria-pressed={placing}
          onClick={() => onPlacing(!placing)}
        >
          <Crosshair className="h-4 w-4" />
          {placing ? 'Click a spot in the photo…' : 'Place a point'}
        </Button>
        <Button
          type="button"
          size="sm"
          className="touch:h-10"
          disabled={on < photo.pairsNeeded || !!photo.toolsBusy}
          onClick={() => void photo.solveFromPoints()}
        >
          Solve from {on} point{on === 1 ? '' : 's'}
        </Button>
        {rows.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="touch:h-10" onClick={photo.clearPairs}>
            <Trash2 className="h-4 w-4" />
            Clear
          </Button>
        )}
      </div>
      {photo.pendingPixel && (
        <p className="text-xs text-warning-foreground">
          The spot marked “?” is not paired yet: place it again, then click the plan.
        </p>
      )}
      {rows.length ? (
        <table className="w-full text-xs tabular-nums" aria-label="Paired points">
          <thead className="text-2xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1 text-left font-medium">#</th>
              <th className="py-1 text-left font-medium">In solve</th>
              <th className="py-1 text-right font-medium">Off, px</th>
              <th className="py-1 text-right font-medium">Off, m</th>
              <th className="py-1 text-right font-medium">Held out, px</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="py-1">
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full text-2xs font-bold',
                      row.on ? 'bg-primary text-primary-foreground' : 'border border-dashed border-border',
                    )}
                  >
                    {row.n}
                  </span>
                </td>
                <td className="py-1">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={row.on}
                      aria-label={`Use point ${row.n} in the solve`}
                      onChange={(event) => photo.setPairOn(row.id, event.target.checked)}
                    />
                    <span className="text-muted-foreground">
                      {row.on ? (row.stale ? 'not solved yet' : 'yes') : 'check point'}
                    </span>
                  </label>
                </td>
                <td className="py-1 text-right">{px(row.residualPx)}</td>
                <td className="py-1 text-right">{metres(row.residualMeters)}</td>
                <td className="py-1 text-right">{px(row.heldOutPx)}</td>
                <td className="py-1 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove point ${row.n}`}
                    onClick={() => photo.removePair(row.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
          No points yet.
        </p>
      )}
      {solve && controlSolveSuspect(solve) && (
        <InlineAlert tone="warning">
          This camera looks wrong: it rolls {Math.round(solve.pose.roll)}° or moved far from the photo’s GPS. Check that
          each pair is the same spot in the photo and on the plan, and remove any that are not.
        </InlineAlert>
      )}
      {solve && (
        <p className="text-xs leading-5 text-foreground" role="status">
          Solved from {solve.pairs.length} points
          {solve.start === 'closed-form' ? ' (started from the points alone)' : ''}: heading{' '}
          {solve.pose.bearing.toFixed(1)}°, pitch {solve.pose.pitch.toFixed(1)}°, roll {solve.pose.roll.toFixed(1)}°;
          moved {Math.round(Math.hypot(solve.shift.east, solve.shift.north))} m across and {Math.round(solve.shift.up)}{' '}
          m up; {solve.rmsPx.toFixed(1)} px RMS
          {solve.heldOutMetresMax !== null
            ? `; worst point held out ${Math.round(solve.heldOutMetresMax)} m on the ground`
            : '; add points to measure each one held out'}
          {check
            ? `; worst check point ${check.px.toFixed(1)} px${check.meters !== null ? `, ${Math.round(check.meters)} m` : ''}`
            : ''}
          .
        </p>
      )}
    </div>
  )
}
