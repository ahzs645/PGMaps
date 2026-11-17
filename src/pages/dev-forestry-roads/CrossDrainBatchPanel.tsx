import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { NumberField, RoadSelect } from './Controls'
import { StationField } from './StationFields'
import { formatRoadStation } from './Charts'
import type { StationEntry } from './stationEntry'
import type { CrossDrainBatch } from './useCrossDrainBatch'
import { TRIAL_SPACING_LIMITS, type TrialSpacing } from './crossDrainBatch'
import type { CulvertInletSide } from './culverts/culvertInlet'

const fixed = (value: number | null | undefined, digits: number) => (value == null ? '—' : value.toFixed(digits))

/**
 * Draft cross-drain culverts, placed in one step: the selected candidate sites or a trial spacing
 * fill the preview, each row is checked through the engine, and the ready rows go into the road
 * together (guide `drainage.md`, **Placing cross-drains in a batch**).
 */
export function CrossDrainBatchPanel({
  batch,
  stations,
  roadLength,
  selectable,
  runCurrent,
}: {
  batch: CrossDrainBatch
  stations: StationEntry
  roadLength: number
  /** Candidate sites that can be ticked: those not already served through a culvert. */
  selectable: number
  /** The drainage run is current, so its candidates can fill the preview. */
  runCurrent: boolean
}) {
  const [spacing, setSpacing] = useState<TrialSpacing>({ startM: 0, endM: roadLength, spacingM: 80 })
  const [spacingProblem, setSpacingProblem] = useState<string | null>(null)
  const { rows } = batch
  const ready = rows.filter((r) => r.ready).length
  const unconfirmed = rows.filter((r) => r.draft.included && !r.draft.sideConfirmed && r.draft.proposedSide).length
  return (
    <section
      aria-label="Place cross-drains in a batch"
      className={cn(insetBox({ padding: 'lg', tone: 'muted' }), 'mt-2 space-y-2')}
      data-testid="cross-drain-batch"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          disabled={!runCurrent || !batch.selected.size}
          onClick={batch.previewSelected}
          data-testid="cross-drain-batch-preview"
        >
          Preview draft culverts{batch.selected.size ? ` (${batch.selected.size})` : ''}
        </Button>
        <p className="min-w-40 flex-1 text-muted-foreground">
          {runCurrent
            ? selectable
              ? 'Tick sites in the table, or fill the preview at a trial spacing.'
              : 'No site is without a culvert; a trial spacing still fills the preview.'
            : 'Re-run the drainage check to preview its sites; a trial spacing works without it.'}
        </p>
      </div>
      <div
        role="group"
        aria-label="Trial spacing"
        className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] items-end gap-2"
      >
        <StationField
          entry={stations}
          label="Trial start"
          value={spacing.startM}
          max={roadLength}
          onChange={(startM) => setSpacing({ ...spacing, startM })}
        />
        <StationField
          entry={stations}
          label="Trial end"
          value={spacing.endM}
          max={roadLength}
          onChange={(endM) => setSpacing({ ...spacing, endM })}
        />
        <NumberField
          label="Spacing (m)"
          value={spacing.spacingM}
          min={TRIAL_SPACING_LIMITS.minM}
          max={TRIAL_SPACING_LIMITS.maxM}
          step={5}
          onChange={(spacingM) => setSpacing({ ...spacing, spacingM })}
        />
        <Button
          size="xs"
          variant="outline"
          data-testid="cross-drain-batch-spacing"
          onClick={() => setSpacingProblem(batch.fillSpacing(spacing))}
        >
          Fill at spacing
        </Button>
      </div>
      {spacingProblem && <InlineAlert tone="warning">{spacingProblem}</InlineAlert>}
      {rows.length > 0 && (
        <>
          <div
            role="group"
            aria-label="Draft pipe"
            className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] items-end gap-2"
          >
            <NumberField
              label="Draft diameter (m)"
              value={batch.pipe.diameterM}
              min={0.1}
              max={20}
              onChange={(diameterM) => batch.setPipe({ ...batch.pipe, diameterM })}
            />
            <NumberField
              label="Draft cover (m)"
              value={batch.pipe.minCoverM}
              max={100}
              onChange={(minCoverM) => batch.setPipe({ ...batch.pipe, minCoverM })}
            />
            <NumberField
              label="Draft installed $/m"
              value={batch.pipe.unitCost}
              max={1000000}
              step={10}
              onChange={(unitCost) => batch.setPipe({ ...batch.pipe, unitCost })}
            />
          </div>
          <EngineeringTable data-testid="cross-drain-batch-rows">
            <thead>
              <tr>
                <ColumnHeader label="Add" />
                <ColumnHeader label="Station" className="text-left" />
                <ColumnHeader label="From" className="text-left" />
                <ColumnHeader label="Inlet" className="text-left" />
                <ColumnHeader label="Skew" unit="°" />
                <ColumnHeader label="Fall" unit="%" />
                <ColumnHeader label="Span" unit="m" />
                <ColumnHeader label="Cover" unit="m" />
                <ColumnHeader label="Checks" className="text-left" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const d = row.draft
                const n = index + 1
                return (
                  <tr key={d.id} data-ready={row.ready} data-testid="cross-drain-batch-row">
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Add draft ${n}`}
                        checked={d.included}
                        onChange={(e) => batch.edit(d.id, { included: e.target.checked })}
                      />
                    </td>
                    <td className="min-w-28 text-left">
                      <StationField
                        entry={stations}
                        label={`Draft ${n} station`}
                        hideLabel
                        precision={1}
                        value={d.chainage}
                        max={roadLength}
                        updateOn="commit"
                        onChange={(chainage) => batch.edit(d.id, { chainage })}
                      />
                    </td>
                    <td className="text-left">
                      {d.origin === 'candidate' && d.fromChainage !== undefined && d.toChainage !== undefined
                        ? d.toChainage > d.fromChainage
                          ? `${formatRoadStation(d.fromChainage)}–${formatRoadStation(d.toChainage)} · ${d.outlets} outlets`
                          : 'Site'
                        : 'Spacing'}
                    </td>
                    <td className="min-w-32 text-left">
                      <RoadSelect
                        ariaLabel={`Draft ${n} inlet side`}
                        value={d.inletSide}
                        onValueChange={(value) => batch.edit(d.id, { inletSide: value as CulvertInletSide })}
                      >
                        <option value="left">Left → right</option>
                        <option value="right">Right → left</option>
                      </RoadSelect>
                      <span className="text-2xs text-muted-foreground">
                        {d.sideConfirmed
                          ? 'confirmed'
                          : d.proposedSide
                            ? `proposed${d.sidesSeen && d.sidesSeen.length > 1 ? ', outlets both sides' : ''}`
                            : 'no proposal'}
                      </span>
                    </td>
                    <td className="min-w-20">
                      <NumberField
                        label={`Draft ${n} skew (°)`}
                        hideLabel
                        value={d.skewDegrees}
                        min={-80}
                        max={80}
                        step={5}
                        updateOn="commit"
                        onChange={(skewDegrees) => batch.edit(d.id, { skewDegrees })}
                      />
                    </td>
                    <td className="min-w-20">
                      <NumberField
                        label={`Draft ${n} fall (%)`}
                        hideLabel
                        value={d.fallPercent}
                        min={-50}
                        max={50}
                        step={0.5}
                        updateOn="commit"
                        onChange={(fallPercent) => batch.edit(d.id, { fallPercent })}
                      />
                    </td>
                    <td>{fixed(row.culvert.lengthM, 1)}</td>
                    <td>{fixed(row.result?.coverM, 2)}</td>
                    <td className="min-w-48 text-left">
                      {row.issues.length ? (
                        <ul className="space-y-0.5">
                          {row.issues.map((issue) => (
                            <li
                              key={issue.code}
                              data-issue={issue.code}
                              className={issue.blocks ? 'font-medium text-danger' : 'text-warning'}
                            >
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground">{d.included ? 'Ready' : 'Not added'}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </EngineeringTable>
          {batch.changed && (
            <InlineAlert tone="warning" data-testid="cross-drain-batch-changed">
              The road or the drainage run changed after this preview was built; the rows above are checked on the road
              as it now stands.{' '}
              <button type="button" className="underline" onClick={batch.refresh}>
                Use the preview as it now stands
              </button>
            </InlineAlert>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs" disabled={!!batch.blocked} onClick={batch.accept} data-testid="cross-drain-batch-accept">
              Add {ready} culvert{ready === 1 ? '' : 's'}
            </Button>
            <Button size="xs" variant="outline" disabled={!unconfirmed} onClick={batch.confirmAll}>
              Confirm proposed sides{unconfirmed ? ` (${unconfirmed})` : ''}
            </Button>
            <Button size="xs" variant="ghost" onClick={batch.clear}>
              Clear preview
            </Button>
            {batch.blocked && <span className="text-muted-foreground">{batch.blocked}</span>}
          </div>
        </>
      )}
    </section>
  )
}
