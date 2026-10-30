import { NativeSelect } from '@/components/ui/form-field'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, NumberField, OptionalNumberField, roadFieldClass } from './Controls'
import { PlanningCoordinateField } from './PlanningCoordinateField'
import type { TotalCostPlanning } from './fullCostPlanning'
import type { RoadNetworkPolicy } from './roadNetworkTypes'
import type { ConnectorCheckOptions } from './connectorCheckOptions'
import type { RoadWorkspace } from './useRoadWorkspace'

export function FullCostSetupEditor({
  planning,
  onChange,
  workspace: w,
  onReviewRoads,
}: {
  planning: TotalCostPlanning
  onChange: (planning: TotalCostPlanning) => void
  workspace: RoadWorkspace
  onReviewRoads: () => void
}) {
  const network = (patch: Partial<RoadNetworkPolicy>) =>
    onChange({ ...planning, networkPolicy: { ...planning.networkPolicy, ...patch } })
  const checks = (patch: Partial<ConnectorCheckOptions>) =>
    onChange({ ...planning, connectorChecks: { ...planning.connectorChecks, ...patch } })
  const streams = w.project.context.filter((feature) => feature.kind === 'stream')
  const structures = w.alignment.engineering?.culverts ?? []
  return (
    <div className="space-y-4" data-testid="full-cost-setup">
      <InlineAlert>
        Compare new connectors from the active road's start to existing-road tie-ins. Reused access continues through
        the reviewed network to your outlet. Candidates retain separate construction quantities; no existing road is
        charged as a newly excavated road.
      </InlineAlert>
      <Field label="Active connector road attachment">
        <NativeSelect
          className={roadFieldClass}
          value={w.alignment.networkEntryRoadId ?? w.alignment.fsrConnection?.targetFeatureId ?? ''}
          onChange={(event) =>
            w.updateAlignment((road) => {
              const { networkEntryRoadId: _old, ...rest } = road
              void _old
              return {
                ...rest,
                ...(event.target.value ? { networkEntryRoadId: event.target.value } : {}),
                ...(road.fsrConnection && event.target.value !== road.fsrConnection.targetFeatureId
                  ? { fsrConnection: undefined }
                  : {}),
              }
            })
          }
        >
          <option value="">Determine from unambiguous geometry</option>
          {w.project.context
            .filter((feature) => feature.kind === 'existing-road')
            .map((road) => (
              <option key={road.id} value={road.id}>
                {road.name}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <p className="text-[11px] text-muted-foreground">
        The connector's end must meet this section within the entered tie-in tolerance. This choice distinguishes
        overlapping roads and bridge levels; it does not add a missing driveway.
      </p>
      <Field label="Planning assessment date">
        <input
          className={roadFieldClass}
          type="date"
          value={planning.asOf}
          onChange={(event) =>
            onChange({
              ...planning,
              asOf: event.target.value,
              networkPolicy: { ...planning.networkPolicy, asOf: event.target.value },
            })
          }
        />
      </Field>
      <PlanningCoordinateField
        label="Network outlet"
        value={planning.outlet}
        onChange={(outlet) => onChange({ ...planning, outlet })}
      />
      <Field label="Outlet road attachment">
        <NativeSelect
          className={roadFieldClass}
          value={planning.outletRoadId ?? ''}
          onChange={(event) => onChange({ ...planning, outletRoadId: event.target.value || null })}
        >
          <option value="">Determine from unambiguous geometry</option>
          {w.project.context
            .filter((feature) => feature.kind === 'existing-road')
            .map((road) => (
              <option key={road.id} value={road.id}>
                {road.name}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange({ ...planning, outlet: [...w.alignment.points.at(-1)!.coordinate] })}
        >
          Use active road end as reviewed outlet
        </Button>
        <Button size="sm" variant="outline" onClick={onReviewRoads}>
          Review network roads and evidence
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        The outlet is a known gate, highway junction or other required access point. The model requires connected
        outward and return paths; an unconnected nearby road gives no reuse credit.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <OptionalNumberField
          label="Additional construction setup ($)"
          value={planning.newConstructionFixedCost}
          min={0}
          max={1e12}
          step={100}
          placeholder="unpriced"
          onChange={(newConstructionFixedCost) => onChange({ ...planning, newConstructionFixedCost })}
        />
        <OptionalNumberField
          label="Loaded haul ($/m³·km)"
          value={planning.haulRatePerM3Km}
          min={0}
          max={1e6}
          placeholder="unpriced"
          onChange={(haulRatePerM3Km) => onChange({ ...planning, haulRatePerM3Km })}
        />
        <OptionalNumberField
          label="Empty return haul ($/m³·km)"
          value={planning.returnHaulRatePerM3Km}
          min={0}
          max={1e6}
          placeholder="unpriced"
          onChange={(returnHaulRatePerM3Km) => onChange({ ...planning, returnHaulRatePerM3Km })}
        />
        <OptionalNumberField
          label="Design vehicle gross weight (t)"
          value={planning.networkPolicy.vehicleWeightTonnes}
          min={0.01}
          max={1000}
          step={1}
          onChange={(vehicleWeightTonnes) => network({ vehicleWeightTonnes })}
        />
        <Field label="Operating season / road tag">
          <input
            className={roadFieldClass}
            placeholder="e.g. summer"
            value={planning.networkPolicy.season ?? ''}
            onChange={(event) => network({ season: event.target.value.trim() || null })}
          />
        </Field>
        <Field label="Vehicle class / road tag">
          <input
            className={roadFieldClass}
            placeholder="e.g. logging-truck"
            value={planning.networkPolicy.vehicleClass ?? ''}
            onChange={(event) => network({ vehicleClass: event.target.value.trim() || null })}
          />
        </Field>
        <OptionalNumberField
          label="Network uphill grade limit (%)"
          value={planning.networkPolicy.maxUphillGradePercent}
          min={0}
          max={100}
          onChange={(maxUphillGradePercent) => network({ maxUphillGradePercent })}
        />
        <OptionalNumberField
          label="Network downhill grade limit (%)"
          value={planning.networkPolicy.maxDownhillGradePercent}
          min={0}
          max={100}
          onChange={(maxDownhillGradePercent) => network({ maxDownhillGradePercent })}
        />
        <NumberField
          label="Network endpoint snap tolerance (m)"
          value={planning.networkPolicy.snapToleranceM}
          max={50}
          step={0.5}
          onChange={(snapToleranceM) => network({ snapToleranceM })}
        />
        <NumberField
          label="Entrance / tie-in tolerance (m)"
          value={planning.networkPolicy.attachmentToleranceM}
          max={50}
          step={0.5}
          onChange={(attachmentToleranceM) => network({ attachmentToleranceM })}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Haul uses actual directed loaded and empty-return paths plus distributed distances along the new road. Enter
        zero for empty return only when your loaded-leg quote already includes it. One design vehicle's conservative
        restrictions are used for all trips. Entered engineering mobilization remains in construction costs. Enter zero
        additional setup when no separate allowance is needed.
      </p>
      <fieldset className="space-y-2 rounded border p-3">
        <legend className="px-1 text-xs font-semibold">Network review policy</legend>
        {(
          [
            ['requireCurrentConditionEvidence', 'Require current reviewed condition evidence'],
            ['allowUnknownAccess', 'Assume unknown access is available'],
            ['allowPermissionRequired', 'Assume required permissions will be obtained'],
            ['allowUnknownRestrictions', 'Include roads with unknown vehicle / season / bridge restrictions'],
            ['allowUnknownCondition', 'Include roads whose condition is unknown'],
            ['allowUnverifiedEndpointSnaps', 'Assume endpoints at unknown levels form a junction'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={planning.networkPolicy[key]}
              onChange={(event) => network({ [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
        <p className="text-[11px] text-muted-foreground">
          Explicit closure, known grade separation, overload and disallowed vehicle/season restrictions remain blocked.
          Assumptions are recorded with the comparison.
        </p>
      </fieldset>
      <fieldset className="space-y-3 rounded border p-3">
        <legend className="px-1 text-xs font-semibold">Final fitted connector checks</legend>
        <Field label="Loaded timber travel direction">
          <NativeSelect
            className={roadFieldClass}
            value={planning.connectorChecks.loadedDirection ?? ''}
            onChange={(event) =>
              checks({ loadedDirection: (event.target.value as ConnectorCheckOptions['loadedDirection']) || null })
            }
          >
            <option value="">Unknown — cannot adopt</option>
            <option value="start-to-end">Road start to end</option>
            <option value="end-to-start">Road end to start</option>
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <OptionalNumberField
            label="Loaded adverse grade limit (%)"
            value={planning.connectorChecks.maxAdverseGradePercent}
            min={0.1}
            max={100}
            onChange={(maxAdverseGradePercent) => checks({ maxAdverseGradePercent })}
          />
          <OptionalNumberField
            label="Loaded favourable grade limit (%)"
            value={planning.connectorChecks.maxFavourableGradePercent}
            min={0.1}
            max={100}
            onChange={(maxFavourableGradePercent) => checks({ maxFavourableGradePercent })}
          />
          <NumberField
            label="Extra clearing each side (m)"
            value={planning.connectorChecks.clearingExtraM}
            max={500}
            onChange={(clearingExtraM) => checks({ clearingExtraM })}
          />
          <NumberField
            label="Full footprint exclusion clearance (m)"
            value={planning.connectorChecks.exclusionClearanceM}
            max={500}
            onChange={(exclusionClearanceM) => checks({ exclusionClearanceM })}
          />
          <NumberField
            label="Full footprint stream setback (m)"
            value={planning.connectorChecks.streamSetbackM}
            max={500}
            onChange={(streamSetbackM) => checks({ streamSetbackM })}
          />
          <OptionalNumberField
            label="Maximum cut depth (m)"
            value={planning.connectorChecks.maxCutDepthM}
            min={0}
            max={1000}
            onChange={(maxCutDepthM) => checks({ maxCutDepthM })}
          />
          <OptionalNumberField
            label="Maximum fill height (m)"
            value={planning.connectorChecks.maxFillHeightM}
            min={0}
            max={1000}
            onChange={(maxFillHeightM) => checks({ maxFillHeightM })}
          />
        </div>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={planning.connectorChecks.allowStreamCrossings}
            onChange={(event) => checks({ allowStreamCrossings: event.target.checked })}
          />
          Allow only explicitly reviewed crossing windows
        </label>
        <p className="text-[11px] text-muted-foreground">
          Checks use the fitted curves and independent formation, sample the road prism at up to 1 m, and test
          continuous section strips against the supplied exclusions and streams. Inbound material and outward waste
          truck grades are also checked. Missing or coarse terrain cannot pass final checks.
        </p>
        {planning.connectorChecks.approvedCrossings.map((window, index) => (
          <div key={index} className="space-y-2 rounded border p-2">
            <Field label={`Crossing ${index + 1} stream`}>
              <NativeSelect
                className={roadFieldClass}
                value={window.featureId}
                onChange={(event) =>
                  checks({
                    approvedCrossings: planning.connectorChecks.approvedCrossings.map((row, i) =>
                      i === index ? { ...row, featureId: event.target.value } : row,
                    ),
                  })
                }
              >
                {streams.map((stream) => (
                  <option key={stream.id} value={stream.id}>
                    {stream.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={`Crossing ${index + 1} entered structure`}>
              <NativeSelect
                className={roadFieldClass}
                value={window.structureId}
                onChange={(event) =>
                  checks({
                    approvedCrossings: planning.connectorChecks.approvedCrossings.map((row, i) =>
                      i === index ? { ...row, structureId: event.target.value } : row,
                    ),
                  })
                }
              >
                {structures.map((structure) => (
                  <option key={structure.id} value={structure.id}>
                    {structure.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label={`Crossing ${index + 1} start (m)`}
                value={window.startM}
                onChange={(startM) =>
                  checks({
                    approvedCrossings: planning.connectorChecks.approvedCrossings.map((row, i) =>
                      i === index ? { ...row, startM } : row,
                    ),
                  })
                }
              />
              <NumberField
                label={`Crossing ${index + 1} end (m)`}
                value={window.endM}
                onChange={(endM) =>
                  checks({
                    approvedCrossings: planning.connectorChecks.approvedCrossings.map((row, i) =>
                      i === index ? { ...row, endM } : row,
                    ),
                  })
                }
              />
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                checks({ approvedCrossings: planning.connectorChecks.approvedCrossings.filter((_, i) => i !== index) })
              }
            >
              Remove crossing window
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={!streams.length || !structures.length}
          onClick={() =>
            checks({
              approvedCrossings: [
                ...planning.connectorChecks.approvedCrossings,
                { featureId: streams[0].id, structureId: structures[0].id, startM: 0, endM: 10 },
              ],
            })
          }
        >
          Add reviewed crossing window
        </Button>
        {!structures.length && (
          <p className="text-[11px] text-muted-foreground">
            Enter culvert geometry in Engineering → Drainage before reviewing a crossing window. Stationed structures
            are never copied onto a different generated road.
          </p>
        )}
      </fieldset>
    </div>
  )
}
