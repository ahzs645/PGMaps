import { Flame, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmRemoveButton } from '@/components/ui/confirm-remove'
import { FileButton } from '@/components/ui/file-button'
import { FORM_INPUT_CLASS, FormField, NumberField, SelectField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolSection } from '@/components/ui/tool-section'
import { districts, table } from '../../forest-patches/project'
import { removeDisturbance, setArea, updateDisturbance } from '../edits'
import {
  disturbanceKindLabels,
  disturbanceKinds,
  START_YEAR_RANGE,
  YEAR_RANGE,
  yearBasisLabels,
  type DisturbanceKind,
} from '../plan'
import type { StepProps } from './types'

/** Step 1: the reporting unit Objective C is measured over, the projection's start, and the baseline. */
export function AreaStep({ plan, edit, drawing, startDrawing, importFiles, onCommand }: StepProps) {
  const { area } = plan
  const target = table.targets.find((t) => t.ndu === area.ndu)
  const empty = !plan.blocks.length && !plan.baseline.length
  return (
    <>
      {empty && (
        <div className="space-y-2 border-b p-3" data-testid="block-planning-start">
          <p className="text-sm font-medium">Start a plan</p>
          <p className="text-xs text-muted-foreground">
            Choose the reporting unit below, add what has already been cut or burned, then draw the blocks. Or open the
            synthetic Prince George sample to see a worked comparison.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onCommand('openSample')}>
              Open the sample
            </Button>
            <Button size="sm" variant="outline" onClick={() => onCommand('open')}>
              Open a plan file
            </Button>
          </div>
        </div>
      )}
      <ToolSection
        title="Reporting unit"
        help="Objective C of the 2004 Prince George order is measured per natural disturbance sub-unit within each historic forest district (Map 1). Use inventory clipped to that unit."
        summary={area.ndu ? `${area.district || 'No district'} · ${area.ndu}` : 'Not chosen'}
        defaultOpen
      >
        <SelectField
          label="Historic forest district"
          value={area.district}
          onValueChange={(district) => edit((p) => setArea(p, { district }))}
        >
          <option value="">Choose…</option>
          {districts.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </SelectField>
        <SelectField
          label="Natural disturbance sub-unit"
          value={area.ndu}
          onValueChange={(ndu) => edit((p) => setArea(p, { ndu }))}
          description={
            target
              ? `Table 7 targets: ${table.labels.map((label, i) => `${label} ${Object.values(target.percent)[i]}%`).join(' · ')}`
              : undefined
          }
        >
          <option value="">Choose…</option>
          {table.targets.map((t) => (
            <option key={t.ndu}>{t.ndu}</option>
          ))}
        </SelectField>
        <NumberField
          label="First projection year"
          description="Eleven five-year periods from this year."
          value={area.startYear}
          min={START_YEAR_RANGE[0]}
          max={START_YEAR_RANGE[1]}
          step={1}
          updateOn="commit"
          onValueChange={(startYear) => edit((p) => setArea(p, { startYear }))}
        />
        {(!area.district || !area.ndu) && (
          <InlineAlert tone="info">Choose both to calculate the young-forest patches.</InlineAlert>
        )}
      </ToolSection>

      <ToolSection
        title="Inventory and applicability"
        help="What the baseline is drawn from, and which plan, tenure and order versions you relied on. The reviewer checks these; nothing here decides that the order applies."
        summary={area.snapshotDate ? `Inventory of ${area.snapshotDate}` : 'Source stated, date not given'}
      >
        <FormField label="Source and coverage">
          <textarea
            className={FORM_INPUT_CLASS}
            rows={2}
            value={area.source}
            onChange={(e) => edit((p) => setArea(p, { source: e.target.value }))}
          />
        </FormField>
        <FormField label="Inventory date">
          <input
            type="date"
            className={FORM_INPUT_CLASS}
            value={area.snapshotDate ?? ''}
            onChange={(e) => edit((p) => setArea(p, { snapshotDate: e.target.value || undefined }))}
          />
        </FormField>
        <FormField
          label="Plan, tenure and order evidence"
          description="Document versions, dates, geographic scope and any later order that may supersede the 2004 order here."
        >
          <textarea
            className={FORM_INPUT_CLASS}
            rows={3}
            value={area.applicabilityEvidence ?? ''}
            onChange={(e) => edit((p) => setArea(p, { applicabilityEvidence: e.target.value || undefined }))}
          />
        </FormField>
      </ToolSection>

      <ToolSection
        title="Baseline"
        help="Harvests and stand-replacing disturbances that already happened. Every schedule shares them. A stand counts as young forest for 20 years after its disturbance."
        summary={`${plan.baseline.length} past disturbance${plan.baseline.length === 1 ? '' : 's'}`}
        defaultOpen
        actions={
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={drawing === 'disturbance' ? 'default' : 'outline'}
              onClick={() => startDrawing('disturbance')}
              disabled={drawing !== null && drawing !== 'disturbance'}
            >
              <Flame className="size-3.5" />
              Draw
            </Button>
            <FileButton
              size="sm"
              variant="outline"
              label="Import"
              accept=".geojson,.json,application/json"
              onFiles={(files) => importFiles('baseline', files)}
            >
              <Upload className="size-3.5" />
              Import
            </FileButton>
          </div>
        }
      >
        {plan.baseline.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None yet. Draw one on the map or import a GeoJSON file with a <code>year</code> on each feature.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Past disturbances">
            {plan.baseline.map((d) => (
              <li key={d.id} className="space-y-1 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Name of ${d.name}`}
                    className={FORM_INPUT_CLASS}
                    value={d.name}
                    onChange={(e) =>
                      e.target.value.trim() && edit((p) => updateDisturbance(p, d.id, { name: e.target.value }))
                    }
                  />
                  <ConfirmRemoveButton
                    label={`Remove ${d.name}`}
                    question={`Remove ${d.name} from the baseline?`}
                    onConfirm={() => edit((p) => removeDisturbance(p, d.id))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SelectField
                    label="Kind"
                    value={d.kind}
                    onValueChange={(kind) => edit((p) => updateDisturbance(p, d.id, { kind: kind as DisturbanceKind }))}
                  >
                    {disturbanceKinds.map((k) => (
                      <option key={k} value={k}>
                        {disturbanceKindLabels[k]}
                      </option>
                    ))}
                  </SelectField>
                  <NumberField
                    label="Year"
                    value={d.year}
                    min={YEAR_RANGE[0]}
                    max={YEAR_RANGE[1]}
                    step={1}
                    updateOn="commit"
                    onValueChange={(year) => edit((p) => updateDisturbance(p, d.id, { year, yearBasis: 'plan-entry' }))}
                  />
                </div>
                <p
                  className={
                    d.yearBasis === 'editor-default' ? 'text-2xs text-warning' : 'text-2xs text-muted-foreground'
                  }
                >
                  {yearBasisLabels[d.yearBasis]}
                  {d.source ? ` · ${d.source}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </ToolSection>
    </>
  )
}
