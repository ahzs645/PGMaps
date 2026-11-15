import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToggleRow } from '@/components/ui/toggle-row'
import { downloadText } from '@/lib/download'
import { OptionalNumberField } from './Controls'
import { ReferenceHeading, ReferenceLink, ReferenceSelect, referenceMoney } from './CostReferenceControls'
import {
  BC_INTERIOR_COST_SOURCE,
  INTERIOR_ROAD_GROUPS,
  INTERIOR_STABILIZATION_ROCK_ADD_CAD_PER_KM,
  interiorRoadBenchmark,
  interiorStabilizationPerKm,
  type InteriorBecZone,
  type InteriorBenchmarkInput,
  type InteriorRoadType,
  type InteriorSoilMoisture,
} from './bcInteriorCost'
import { MeasuredSideSlope, type MeasuredSideSlopeRecord, type SideSlopeRoad } from './MeasuredSideSlope'

const choose = { value: 'unselected', label: 'Not checked' }
const scopeFlags = [
  ['existingRoad', 'Existing road'],
  ['requiresEndHaul', 'End-haul construction required'],
  ['requiresOverlandConstruction', 'Overland construction required'],
] as const
const requiredInputs = [
  ['roadGroup', 'road group'],
  ['sideSlopePercent', 'side slope'],
  ['rockPercent', 'section rock'],
  ['roadType', 'road type'],
  ['becZone', 'BEC zone'],
  ['soilMoisture', 'soil moisture'],
] as const
/** The equation's sentences for a blank input, which the short "Still needed" line replaces. */
const BLANK_INPUT_ERRORS = new Set(
  interiorRoadBenchmark({
    roadGroup: null,
    sideSlopePercent: null,
    rockPercent: null,
    roadType: null,
    becZone: null,
    soilMoisture: null,
  }).errors,
)
const scopeStatement =
  'New representative tabular section; verified group boundaries; terrain outside classes IV/V; no required end haul or overland construction; any long-term primary access running surface is no wider than 6 m.'

/** Temporary, downloadable source comparison; never writes project cost settings. */
export function BCInteriorBenchmark({
  regionName,
  candidateGroups,
  road,
}: {
  regionName?: string
  /** The region's candidate road groups: marked in the list, never chosen for the user. */
  candidateGroups?: readonly number[]
  road?: SideSlopeRoad
}) {
  const [inputs, setInputs] = useState<InteriorBenchmarkInput>({
    roadGroup: null,
    sideSlopePercent: null,
    rockPercent: null,
    roadType: null,
    becZone: null,
    soilMoisture: null,
  })
  const [reviewed, setReviewed] = useState(false)
  // Set when the side slope came from the road's terrain; typing a value of one's own clears it.
  const [measured, setMeasured] = useState<MeasuredSideSlopeRecord | null>(null)
  const [rippedOrQuarryRock, setRippedOrQuarryRock] = useState(false)
  const update = (patch: Partial<InteriorBenchmarkInput>) => {
    setInputs((current) => ({ ...current, ...patch }))
    setReviewed(false)
  }
  const group = INTERIOR_ROAD_GROUPS.find((item) => item.id === inputs.roadGroup)
  const result = interiorRoadBenchmark(inputs)
  const ready = reviewed && result.status === 'available'
  // Blank inputs read as one short line; an entered value the equation refuses keeps its own sentence.
  const blanks = requiredInputs.filter(([key]) => inputs[key] == null).map(([, label]) => label)
  const stabilizationPerKm = interiorStabilizationPerKm(inputs.roadGroup, inputs.roadType, rippedOrQuarryRock)
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
          sideSlopeSource: measured
            ? { kind: 'measured-suggestion', ...measured }
            : { kind: inputs.sideSlopePercent === null ? 'not-entered' : 'entered' },
          scopeReviewed: reviewed,
          reviewedScope: scopeStatement,
          result,
          stabilization: {
            perKm: stabilizationPerKm,
            rippedOrQuarryRock,
            note: 'Separate IAM 4.3.4.1 allowance for imported stabilizing material where eligible; not part of the subgrade figure.',
          },
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
    <div className="space-y-4">
      <p className="flex items-center gap-1 text-2xs leading-4 text-muted-foreground">
        <span>
          <ReferenceLink href={BC_INTERIOR_COST_SOURCE.url}>2026 Interior Appraisal Manual</ReferenceLink>
          {' · effective ' + BC_INTERIOR_COST_SOURCE.effectiveDate}
          {' · ' + BC_INTERIOR_COST_SOURCE.costBaseYear + ' cost base'}
        </span>
        <InfoTip label="About the Interior subgrade comparison">
          IAM sections 4.3.2.2–4.3.2.4 and Table 4-2. The equation prices subgrade only.
        </InfoTip>
      </p>

      <div className="space-y-2">
        <ReferenceSelect
          label="Interior road group"
          value={inputs.roadGroup?.toString() ?? choose.value}
          options={[
            choose,
            ...INTERIOR_ROAD_GROUPS.map(({ id, label }) => ({
              value: String(id),
              label: regionName && candidateGroups?.includes(id) ? `${label} · candidate for ${regionName}` : label,
            })),
          ]}
          onChange={(value) => update({ roadGroup: value === choose.value ? null : Number(value) })}
          hint={group?.boundaries}
        />
        {regionName && candidateGroups && candidateGroups.length === 0 && (
          <p className="text-2xs leading-4 text-warning" data-testid="road-iam-no-candidate-group">
            No Interior road group lists {regionName}. Check IAM Table 4-2 before using one.
          </p>
        )}
        {road && (
          <MeasuredSideSlope
            road={road}
            inUse={measured}
            onUse={(record) => {
              update({ sideSlopePercent: record.percent })
              setMeasured(record)
            }}
          />
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <OptionalNumberField
            label={measured ? 'Uphill side slope · measured suggestion (%)' : 'Uphill side slope (%)'}
            value={inputs.sideSlopePercent}
            onChange={(sideSlopePercent) => {
              setMeasured(null)
              update({ sideSlopePercent })
            }}
            min={0}
            max={500}
            placeholder="Not checked"
            hint="Measured across the hillside, perpendicular to the centreline. It is not road grade."
          />
          <OptionalNumberField
            label="Section rock (%)"
            value={inputs.rockPercent}
            onChange={(rockPercent) => update({ rockPercent })}
            min={0}
            max={100}
            placeholder="Not checked"
            hint="Needs supporting field evidence."
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
            hint="Needs supporting evidence. Unknown does not mean other."
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
            hint="Follows the manual's Appendix III classification."
          />
          <OptionalNumberField
            label="Homogeneous section length (m, optional)"
            value={inputs.lengthM ?? null}
            onChange={(lengthM) => update({ lengthM })}
            min={0}
            max={100000}
            placeholder="Unit comparison only"
            hint="Scales the comparison total. Formal appraisal sections are recorded to the nearest 100 m, normally at least 1 km."
          />
        </div>
      </div>

      <section className="space-y-2 border-t pt-4" aria-label="Applicability and exclusions">
        <ReferenceHeading
          info={`Confirm: ${scopeStatement} Unknown conditions need review before you confirm. The equation does not certify ECE eligibility, survey quality or engineering approval.`}
        >
          Applicability
        </ReferenceHeading>
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
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {scopeFlags.map(([key, label]) => (
            <ToggleRow
              key={key}
              layout="tile"
              active={inputs.conditions?.[key] === true}
              label={label}
              tone="amber"
              onClick={() => update({ conditions: { ...inputs.conditions, [key]: !inputs.conditions?.[key] } })}
            />
          ))}
        </div>
        <ToggleRow
          active={reviewed}
          label="Applicability reviewed"
          tone="primary"
          aria-label="Confirm Interior benchmark applicability reviewed"
          onClick={() => setReviewed((value) => !value)}
        />
      </section>

      <div data-testid="road-interior-benchmark-result" aria-live="polite" className="border-t pt-4">
        {result.status === 'not-applicable' ? (
          <InlineAlert tone="warning" title="Separate cost method required">
            {result.errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </InlineAlert>
        ) : result.status === 'needs-input' ? (
          <div className="space-y-1 text-2xs leading-4 text-muted-foreground">
            {blanks.length > 0 && (
              <p data-testid="road-interior-still-needed">
                <span className="font-medium text-foreground">Still needed:</span> {blanks.join(', ')}
              </p>
            )}
            {result.errors
              .filter((error) => !BLANK_INPUT_ERRORS.has(error))
              .map((error) => (
                <p key={error} className="text-warning">
                  {error}
                </p>
              ))}
          </div>
        ) : !reviewed ? (
          <InlineAlert>Review applicability to show the comparison.</InlineAlert>
        ) : (
          <div className="space-y-1 text-xs">
            <p className="text-base font-semibold tabular-nums">
              {referenceMoney(result.subgradePerKm!)} CAD/km · subgrade
            </p>
            <p className="text-muted-foreground">
              {BC_INTERIOR_COST_SOURCE.costBaseYear} cost base · side slope used: {result.slopeUsedPercent}%
            </p>
            {result.subgradeTotal !== null && (
              <p className="tabular-nums">
                {referenceMoney(result.subgradeTotal)} CAD for the entered length, before escalation
              </p>
            )}
            {stabilizationPerKm !== null && (
              <div className="space-y-1.5 border-t pt-2" data-testid="road-interior-stabilization">
                <p className="flex items-center gap-1 tabular-nums">
                  <span>
                    <span className="font-medium">{referenceMoney(stabilizationPerKm)} CAD/km</span> · stabilizing
                    material, where eligible
                  </span>
                  <InfoTip label="About the stabilizing material allowance">
                    A separate allowance (IAM 4.3.4.1) for imported gravel or broken rock where the subgrade and ditch
                    material is not enough. It is not part of the subgrade figure and is not summed with it here. The
                    published haul-distance coefficient is zero, which does not make a real haul free.
                  </InfoTip>
                </p>
                <ToggleRow
                  active={rippedOrQuarryRock}
                  label={`Ripped or quarry rock (+${referenceMoney(INTERIOR_STABILIZATION_ROCK_ADD_CAD_PER_KM)}/km)`}
                  tone="primary"
                  onClick={() => setRippedOrQuarryRock((value) => !value)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={download}>
          Download Interior comparison JSON
        </Button>
        <InfoTip label="What this allowance includes" showLabel bubbleClassName="w-96">
          <span className="block space-y-2">
            {result.cautions.map((caution) => (
              <span key={caution} className="block">
                {caution}
              </span>
            ))}
          </span>
        </InfoTip>
      </div>
    </div>
  )
}
