import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { ToggleRow } from '@/components/ui/toggle-row'
import { downloadText } from '@/lib/download'
import { OptionalNumberField } from './Controls'
import { ReferenceLink, ReferenceSelect, referenceMoney } from './CostReferenceControls'
import {
  BC_INTERIOR_COST_SOURCE,
  INTERIOR_ROAD_GROUPS,
  interiorRoadBenchmark,
  type InteriorBecZone,
  type InteriorBenchmarkInput,
  type InteriorRoadType,
  type InteriorSoilMoisture,
} from './bcInteriorCost'

const choose = { value: 'unselected', label: 'Not checked' }
const scopeFlags = [
  ['existingRoad', 'Existing road'],
  ['requiresEndHaul', 'End-haul construction required'],
  ['requiresOverlandConstruction', 'Overland construction required'],
] as const
const scopeStatement =
  'New representative tabular section; verified group boundaries; terrain outside classes IV/V; no required end haul or overland construction; any long-term primary access running surface is no wider than 6 m.'

/** Temporary, downloadable source comparison; never writes project cost settings. */
export function BCInteriorBenchmark({ regionName }: { regionName?: string }) {
  const [inputs, setInputs] = useState<InteriorBenchmarkInput>({
    roadGroup: null,
    sideSlopePercent: null,
    rockPercent: null,
    roadType: null,
    becZone: null,
    soilMoisture: null,
  })
  const [reviewed, setReviewed] = useState(false)
  const update = (patch: Partial<InteriorBenchmarkInput>) => {
    setInputs((current) => ({ ...current, ...patch }))
    setReviewed(false)
  }
  const group = INTERIOR_ROAD_GROUPS.find((item) => item.id === inputs.roadGroup)
  const result = interiorRoadBenchmark(inputs)
  const ready = reviewed && result.status === 'available'
  const download = () => {
    if (!ready) return
    downloadText(
      JSON.stringify(
        {
          schema: 'pgmaps-bc-interior-cost-comparison-v1',
          generatedAt: new Date().toISOString(),
          source: BC_INTERIOR_COST_SOURCE,
          region: regionName ?? null,
          roadGroup: group,
          inputs,
          scopeReviewed: reviewed,
          reviewedScope: scopeStatement,
          result,
          limitation: 'Independent 2024-base appraisal comparison; not included in project totals.',
        },
        null,
        2,
      ),
      'bc-interior-road-comparison.json',
      'application/json',
    )
  }

  return (
    <div className="space-y-3 rounded border p-3">
      <h3 className="text-xs font-semibold">Interior subgrade comparison</h3>
      <p className="text-[11px] leading-4 text-muted-foreground">
        <ReferenceLink href={BC_INTERIOR_COST_SOURCE.url}>2026 Interior Appraisal Manual</ReferenceLink>
        {' · effective ' + BC_INTERIOR_COST_SOURCE.effectiveDate}
        {' · ' + BC_INTERIOR_COST_SOURCE.costBaseYear + ' cost base. '}
        Sections 4.3.2.2–4.3.2.4 and Table 4-2. This covers subgrade only.
      </p>
      <ReferenceSelect
        label="Interior road group"
        value={inputs.roadGroup?.toString() ?? choose.value}
        options={[choose, ...INTERIOR_ROAD_GROUPS.map(({ id, label }) => ({ value: String(id), label }))]}
        onChange={(value) => update({ roadGroup: value === choose.value ? null : Number(value) })}
      />
      {group && <p className="text-[11px] leading-4 text-muted-foreground">{group.boundaries}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <OptionalNumberField
          label="Uphill side slope (%)"
          value={inputs.sideSlopePercent}
          onChange={(sideSlopePercent) => update({ sideSlopePercent })}
          min={0}
          max={500}
          placeholder="Not checked"
        />
        <OptionalNumberField
          label="Section rock (%)"
          value={inputs.rockPercent}
          onChange={(rockPercent) => update({ rockPercent })}
          min={0}
          max={100}
          placeholder="Not checked"
        />
        <ReferenceSelect
          label="Interior road type"
          value={inputs.roadType ?? choose.value}
          options={[
            choose,
            { value: 'long-term', label: 'Long-term · raised subgrade and ditch' },
            { value: 'short-term', label: 'Short-term · bladed surface' },
            { value: 'snow-ice', label: 'Snow/ice · separate method' },
          ]}
          onChange={(value) => update({ roadType: value === choose.value ? null : (value as InteriorRoadType) })}
        />
        <ReferenceSelect
          label="Verified BEC zone"
          value={inputs.becZone ?? choose.value}
          options={[
            choose,
            ...['ESSF', 'ICH', 'CWH', 'SBS', 'MS'].map((value) => ({ value, label: value })),
            { value: 'other', label: 'Other verified BEC zone' },
          ]}
          onChange={(value) => update({ becZone: value === choose.value ? null : (value as InteriorBecZone) })}
        />
        <ReferenceSelect
          label="Absolute soil moisture"
          value={inputs.soilMoisture ?? choose.value}
          options={[
            choose,
            { value: 'wet', label: 'Wet' },
            { value: 'moist', label: 'Moist' },
            { value: 'dry', label: 'Dry' },
          ]}
          onChange={(value) =>
            update({ soilMoisture: value === choose.value ? null : (value as InteriorSoilMoisture) })
          }
        />
        <OptionalNumberField
          label="Homogeneous section length (m, optional)"
          value={inputs.lengthM ?? null}
          onChange={(lengthM) => update({ lengthM })}
          min={0}
          max={100000}
          placeholder="Unit comparison only"
        />
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Side slope is measured across the hillside, perpendicular to the centreline; it is not road grade. Soil moisture
        follows the manual’s Appendix III classification. Rock and BEC need supporting evidence.
      </p>
      <CollapsibleSection label="Applicability and exclusions" defaultOpen contentClassName="space-y-2 px-2 pb-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <OptionalNumberField
            label="Running surface width (m, optional)"
            value={inputs.conditions?.runningSurfaceWidthM ?? null}
            min={0}
            max={100}
            placeholder="Confirm limit below"
            onChange={(runningSurfaceWidthM) => update({ conditions: { ...inputs.conditions, runningSurfaceWidthM } })}
          />
          <ReferenceSelect
            label="Terrain stability class (optional)"
            value={inputs.conditions?.terrainClass?.toString() ?? choose.value}
            options={[
              choose,
              ...['I', 'II', 'III', 'IV', 'V'].map((label, index) => ({
                value: String(index + 1),
                label: 'Class ' + label,
              })),
            ]}
            onChange={(value) =>
              update({
                conditions: {
                  ...inputs.conditions,
                  terrainClass: value === choose.value ? null : (Number(value) as 1 | 2 | 3 | 4 | 5),
                },
              })
            }
          />
        </div>
        {scopeFlags.map(([key, label]) => (
          <ToggleRow
            key={key}
            active={inputs.conditions?.[key] === true}
            label={label}
            onClick={() => update({ conditions: { ...inputs.conditions, [key]: !inputs.conditions?.[key] } })}
          />
        ))}
        <p className="text-[11px] leading-4 text-muted-foreground">
          Confirm: {scopeStatement} Unknown conditions need review before confirming.
        </p>
        <ToggleRow
          active={reviewed}
          label="Applicability reviewed"
          aria-label="Confirm Interior benchmark applicability reviewed"
          onClick={() => setReviewed((value) => !value)}
        />
      </CollapsibleSection>
      <div data-testid="road-interior-benchmark-result" aria-live="polite">
        {result.status === 'not-applicable' ? (
          <InlineAlert tone="warning" title="Separate cost method required">
            {result.errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </InlineAlert>
        ) : result.status === 'needs-input' ? (
          <p className="text-[11px] text-muted-foreground">{result.errors.join(' ')}</p>
        ) : !reviewed ? (
          <InlineAlert>Review applicability to show the comparison.</InlineAlert>
        ) : (
          <div className="space-y-1 text-xs">
            <p className="text-base font-semibold">{referenceMoney(result.subgradePerKm!)} CAD/km · subgrade</p>
            <p className="text-muted-foreground">2024 cost base · side slope used: {result.slopeUsedPercent}%.</p>
            {result.subgradeTotal !== null && (
              <p>{referenceMoney(result.subgradeTotal)} CAD for the entered section length, before any escalation.</p>
            )}
            <p className="text-muted-foreground">This comparison is not added to the covered estimate.</p>
          </div>
        )}
      </div>
      <CollapsibleSection label="What this allowance includes" contentClassName="space-y-2 px-2 pb-2">
        {result.cautions.map((caution) => (
          <p key={caution} className="text-[11px] leading-4 text-muted-foreground">
            {caution}
          </p>
        ))}
      </CollapsibleSection>
      <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={download}>
        Download Interior comparison JSON
      </Button>
    </div>
  )
}
