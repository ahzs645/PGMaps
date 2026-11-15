import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import type { ToolRun } from './assessmentTools'
import { formatPct } from './measureFormat'
import { greenUpNotMonotonic, recoveryRows, recoveryVerdict, type RecoveryKind } from './recoverySummary'
import type { HeadlineScale } from './runRevision'

function Cell({ scale, provisional }: { scale: HeadlineScale | null; provisional: boolean }) {
  if (!scale || scale.percent === null || provisional) return <td className="text-muted-foreground">withheld</td>
  return (
    <td className={scale.met ? undefined : 'font-semibold text-danger'} data-met={scale.met ? 'yes' : 'no'}>
      {formatPct(scale.percent, 1)} {scale.met ? '✓' : 'over'}
    </td>
  )
}

/**
 * The recovery timeline (one row per year) or the green-up sensitivity (one row per green-up
 * age): the landform's figure on each scale against the objective, read from each run's summary.
 */
export function RecoveryTable({ runs, kind }: { runs: readonly ToolRun[]; kind: RecoveryKind }) {
  const rows = recoveryRows(runs, kind)
  if (!rows.length) return null
  const max = (basis: 'perspective' | 'planimetric') => rows.find((r) => r[basis])?.[basis]?.maxPercent
  const perspectiveMax = max('perspective'),
    planimetricMax = max('planimetric')
  // Partial cuts are not cleared ground: step 4 adds their Table 6 figure to X, so they get a column of their own.
  const partial = rows.some((row) => row.partialCuts)
  return (
    <div className="space-y-1.5" data-recovery-table={kind}>
      <EngineeringTable
        compact
        rowHeaders
        aria-label={kind === 'timeline' ? 'Recovery timeline' : 'Green-up age sensitivity'}
      >
        <thead>
          <tr>
            <ColumnHeader
              label={kind === 'timeline' ? 'Year' : 'Green-up age'}
              unit={kind === 'timeline' ? '' : 'years'}
            />
            <ColumnHeader
              label="Perspective"
              unit={perspectiveMax != null ? `objective ≤ ${formatPct(perspectiveMax, 1)}` : undefined}
            />
            <ColumnHeader
              label="Planimetric"
              unit={planimetricMax != null ? `objective ≤ ${formatPct(planimetricMax, 1)}` : undefined}
            />
            {partial && <ColumnHeader label="Partial cuts" unit="Table 6, added to X" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-recovery-key={row.key}>
              <th scope="row">{row.key}</th>
              {row.error ? (
                <td colSpan={partial ? 3 : 2} className="whitespace-normal text-left text-danger">
                  {row.error}
                </td>
              ) : (
                <>
                  <Cell scale={row.perspective} provisional={row.provisional} />
                  <Cell scale={row.planimetric} provisional={row.provisional} />
                  {partial && (
                    <td data-partial-cuts>
                      {!row.partialCuts
                        ? '—'
                        : row.partialCuts.percent === 'missing'
                          ? 'inputs missing'
                          : `+${formatPct(row.partialCuts.percent, 1)}`}
                    </td>
                  )}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </EngineeringTable>
      <p data-recovery-verdict="perspective">{recoveryVerdict(rows, 'perspective', kind)}</p>
      <p data-recovery-verdict="planimetric">{recoveryVerdict(rows, 'planimetric', kind)}</p>
      {partial && (
        <p className="text-muted-foreground" data-recovery-partial-note>
          The perspective and planimetric columns are the run&apos;s cleared ground. A partial cut in view adds its
          Table 6 figure to X in step 4 until its gaps reach green-up height; “—” means none is in view or counting.
        </p>
      )}
      {kind === 'greenup' && (greenUpNotMonotonic(rows, 'perspective') || greenUpNotMonotonic(rows, 'planimetric')) && (
        <p className="text-muted-foreground" data-recovery-note>
          A longer green-up age gives a lower figure here. The age also decides which openings are cleared ground: one
          read as greened up keeps its inventory canopy, which can screen part of the landform behind it.
        </p>
      )}
    </div>
  )
}
