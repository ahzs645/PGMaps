import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ReadoutGrid } from '@/components/ui/readout-grid'
import { EngineeringTable } from '@/components/ui/engineering-table'
import {
  DRAINAGE_ALGORITHM_VERSION,
  MAX_DRAINAGE_COMPARISONS,
  type DrainageComparisonSnapshot,
  type DrainageEvidence,
} from './drainageEvidence'
import {
  compareDrainageRuns,
  depressionPolicyLabel,
  drainageComparisonId,
  snapPolicyLabel,
} from './drainageSensitivity'
import { Field, roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'

const number = (v: number, digits = 3) => v.toLocaleString('en-CA', { maximumFractionDigits: digits })
const delta = (v: number | null, unit: string) =>
  v === null ? 'Not comparable' : `${v > 0 ? '+' : ''}${number(v)} ${unit}`

export function DrainageSensitivityPanel({
  records,
  totalRecords,
  evidence,
  stale,
  busy,
  onSave,
  onRemove,
  onExport,
}: {
  records: DrainageComparisonSnapshot[]
  totalRecords: number
  evidence?: DrainageEvidence
  stale: boolean
  busy: boolean
  onSave: (label: string) => void
  onRemove: (id: string) => void
  onExport: (baselineId: string) => void
}) {
  const [label, setLabel] = useState('')
  const [selectedBaseline, setSelectedBaseline] = useState('')
  const baseline = records.find((r) => drainageComparisonId(r) === selectedBaseline) ?? records[0]
  const alreadySaved = evidence && records.some((r) => drainageComparisonId(r) === drainageComparisonId(evidence))
  const canSave =
    !!evidence?.roadFingerprint &&
    evidence.algorithmVersion === DRAINAGE_ALGORITHM_VERSION &&
    !stale &&
    !busy &&
    !alreadySaved &&
    totalRecords < MAX_DRAINAGE_COMPARISONS
  return (
    <section aria-label="Drainage sensitivity comparison">
      <RoadSection
        title="Compare drainage runs"
        summary={`${records.length} saved runs`}
        toggleTestId="road-drainage-comparisons-toggle"
        help="Save a run, change an assumption, and rerun. Compare buffer, terrain source, working resolution, depression treatment, outlet policy, and existing versus design surface. Change one input at a time to isolate its effect. Saved numeric records travel with the project; polygons and flow rasters are not copied."
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] items-end gap-2">
          <Field label="Comparison label">
            <input
              className={roadFieldClass}
              value={label}
              maxLength={80}
              placeholder={`Run ${records.length + 1}`}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <Button
            size="sm"
            className="h-auto min-h-8 whitespace-normal py-1.5 touch:min-h-10"
            disabled={!canSave}
            onClick={() => {
              onSave(label.trim() || `Run ${records.length + 1}`)
              setLabel('')
            }}
          >
            Save comparison run
          </Button>
        </div>
        {stale && evidence && <p role="status">Re-run drainage before saving a changed set of inputs.</p>}
        {alreadySaved && (
          <p className="text-muted-foreground">This run is saved. Change an input and rerun to compare.</p>
        )}
        {totalRecords >= MAX_DRAINAGE_COMPARISONS && (
          <p role="status">
            The project holds {MAX_DRAINAGE_COMPARISONS} comparison runs. Remove one before saving another.
          </p>
        )}
        {baseline && (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] items-end gap-2">
              <Field label="Comparison baseline">
                <RoadSelect
                  value={drainageComparisonId(baseline)}
                  onValueChange={setSelectedBaseline}
                  options={records.map((r) => ({ value: drainageComparisonId(r), label: r.label }))}
                  ariaLabel="Comparison baseline"
                  className="h-8 w-full"
                />
              </Field>
              <Button
                size="sm"
                className="h-auto min-h-8 whitespace-normal py-1.5 touch:min-h-10"
                variant="outline"
                disabled={busy}
                onClick={() => onExport(drainageComparisonId(baseline))}
              >
                Export comparison evidence
              </Button>
            </div>
            <p className="text-muted-foreground">
              Saved runs are historical snapshots. Deltas use the selected baseline.
            </p>
            {records.map((record) => {
              const id = drainageComparisonId(record)
              const isBaseline = id === drainageComparisonId(baseline)
              const comparison = compareDrainageRuns(baseline, record)
              const catchment = record.selectedCatchment
              return (
                <article
                  key={id}
                  className={cn(insetBox(), 'min-w-0 space-y-2')}
                  aria-label={`Comparison ${record.label}`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <h4 className="min-w-0 break-words font-medium">
                      {record.label}
                      {isBaseline ? ' · Baseline' : ''}
                    </h4>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 touch:min-h-10"
                      disabled={busy}
                      aria-label={`Remove comparison ${record.label}`}
                      onClick={() => onRemove(id)}
                    >
                      Remove
                    </Button>
                  </div>
                  <p className="break-words text-muted-foreground">
                    {record.terrain.name} · {record.createdAt}
                  </p>
                  <ReadoutGrid
                    minColumnWidth="18rem"
                    className="text-xs leading-5"
                    items={[
                      { label: 'Buffer', value: `${number(record.settings.bufferM)} m` },
                      { label: 'Actual grid', value: `${number(record.grid.cellM)} m` },
                      { label: 'Depressions', value: depressionPolicyLabel(record.settings) },
                      {
                        label: 'Outlet policy',
                        value: record.pourPoint ? snapPolicyLabel(record.pourPoint) : 'No pour point',
                      },
                      {
                        label: 'Catchment',
                        value: catchment
                          ? `${number(catchment.areaHa)} ha · ${catchment.surface}`
                          : record.pourPoint
                            ? 'Outlet not resolved'
                            : 'No pour point',
                      },
                      ...(!isBaseline
                        ? [
                            { label: 'Area change', value: delta(comparison.areaDeltaHa, 'ha') },
                            { label: 'Area change (%)', value: delta(comparison.areaDeltaPercent, '%') },
                          ]
                        : []),
                    ]}
                  />
                  {catchment && (
                    <p className={catchment.truncated ? 'text-warning' : 'text-muted-foreground'}>
                      {catchment.truncated
                        ? 'Boundary or missing-terrain contact: area may be incomplete.'
                        : 'No sampled boundary contact.'}
                    </p>
                  )}
                  {!isBaseline && <p>Changed: {comparison.changedInputs.join('; ') || 'No recorded input changes'}.</p>}
                  {!isBaseline &&
                    comparison.cautions.map((caution) => (
                      <p key={caution} className="text-warning">
                        {caution}
                      </p>
                    ))}
                  <details className="min-w-0">
                    <summary className="cursor-pointer py-1">Outlet and crossing evidence</summary>
                    <p className="break-words">Calculation: {record.algorithmVersion ?? 'Legacy / unknown'}.</p>
                    {!catchment && record.pourPoint && (
                      <p className="break-words py-2">
                        Requested {record.pourPoint.coordinate.map((v) => number(v, 6)).join(', ')}; no resolved outlet.
                      </p>
                    )}
                    {catchment && (
                      <p className="break-words py-2">
                        Requested {catchment.requestedCoordinate.map((v) => number(v, 6)).join(', ')}; selected{' '}
                        {catchment.snappedCoordinate.map((v) => number(v, 6)).join(', ')}. Cell {catchment.outletCell};
                        moved {number(catchment.snappedDistanceM, 2)} m; {number(catchment.cells, 0)} contributing
                        cells.
                      </p>
                    )}
                    <p>
                      {record.summary.crossings} crossings; {record.summary.redirected} diversions;{' '}
                      {number(record.summary.pondingAreaM2)} m² potential new ponding.
                    </p>
                    {record.warnings.length > 0 && (
                      <ul className="list-disc space-y-1 pl-4 text-warning" aria-label="Saved run warnings">
                        {record.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    )}
                    {record.culvertAreas.length > 0 && (
                      <EngineeringTable>
                        <thead>
                          <tr>
                            <th>Culvert</th>
                            <th>Existing ha</th>
                            <th>Design ha</th>
                            {!isBaseline && <th>Design Δ ha</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {record.culvertAreas.map((c) => (
                            <tr key={c.id}>
                              <td>{c.name}</td>
                              <td>{number(c.existingAreaHa)}</td>
                              <td>{number(c.designAreaHa)}</td>
                              {!isBaseline && (
                                <td>
                                  {delta(comparison.culverts.find((v) => v.id === c.id)?.designDeltaHa ?? null, '')}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </EngineeringTable>
                    )}
                  </details>
                </article>
              )
            })}
          </>
        )}
      </RoadSection>
    </section>
  )
}
