/**
 * The extraction-reach panel's machine picker and limits (skidder skid rule and winching,
 * forwarder slopes, budget and crane), after the options of Sylvaccess 3.6 (Dupire et al. 2015;
 * INRAE user notice, 2024). Written from a functional specification; no code from Sylvaccess
 * (GPL-3.0-or-later) was used.
 */
import { InfoTip } from '@/components/ui/info-tip'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Field, NumberField, RoadSelect, roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import { CableCoverageFields } from './CableCoverageFields'
import {
  MAX_FELLABLE_SLOPE_PERCENT,
  MIN_FELLABLE_SLOPE_PERCENT,
  type ExtractionMachine,
  type ExtractionSettings,
  type WinchFrom,
} from './extractionReach'
import {
  MAX_CRANE_M,
  MAX_FORWARDER_REACH_M,
  MAX_FORWARDER_SLOPE_PERCENT,
  MAX_STEEP_BUDGET_M,
  MIN_CRANE_M,
  MIN_FORWARDER_REACH_M,
  MIN_FORWARDER_SLOPE_PERCENT,
} from './forwarderReach'
import { MAX_OFF_BLOCK_M, MAX_SKID_CELL_M, MAX_SKID_REACH_M, MIN_SKID_CELL_M, MIN_SKID_REACH_M } from './skidReach'
import {
  MAX_WINCH_M,
  MAX_WINCH_SLOPE_PERCENT,
  MIN_WINCH_SLOPE_PERCENT,
  WINCH_HOLLOW_M,
  WINCH_HUMP_M,
} from './winchReach'

const MACHINES = [
  { value: 'skidder', label: 'Skidder' },
  { value: 'forwarder', label: 'Forwarder' },
  { value: 'cable', label: 'Cable yarder' },
] as const
const WINCH_FROM: { value: WinchFrom; label: string }[] = [
  { value: 'edge', label: 'Edge of driven ground' },
  { value: 'roads', label: 'Roads and trails first' },
  { value: 'none', label: 'No winching' },
]

export interface ExtractionFieldsProps {
  settings: ExtractionSettings
  onSettings: (update: (s: ExtractionSettings) => ExtractionSettings) => void
  offBlockM: number
  onOffBlockM: (value: number) => void
  cellM: number
  onCellM: (value: number) => void
  classText: string
  onClassText: (value: string) => void
  classError: string
}

/** The machine picker and its limits, for the extraction-reach panel. */
export function ExtractionReachFields(p: ExtractionFieldsProps) {
  const { settings: s, onSettings } = p
  const skid = (patch: Partial<ExtractionSettings['skid']>) =>
    onSettings((x) => ({ ...x, skid: { ...x.skid, ...patch } }))
  const winch = (patch: Partial<ExtractionSettings['winch']>) =>
    onSettings((x) => ({ ...x, winch: { ...x.winch, ...patch } }))
  const forwarder = (patch: Partial<ExtractionSettings['forwarder']>) =>
    onSettings((x) => ({ ...x, forwarder: { ...x.forwarder, ...patch } }))
  return (
    <div className="space-y-2">
      <SegmentedControl
        label="Extraction machine"
        size="sm"
        value={s.machine}
        options={MACHINES}
        onChange={(machine: ExtractionMachine) => onSettings((x) => ({ ...x, machine }))}
      />
      {s.machine === 'cable' ? (
        <CableCoverageFields
          rule={s.cable}
          onRule={(update) => onSettings((x) => ({ ...x, cable: update(x.cable) }))}
        />
      ) : s.machine === 'skidder' ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Level reach (m)"
              value={s.skid.flatReachM}
              min={MIN_SKID_REACH_M}
              max={MAX_SKID_REACH_M}
              step={10}
              onChange={(flatReachM) => skid({ flatReachM, adverseReachM: Math.min(s.skid.adverseReachM, flatReachM) })}
            />
            <NumberField
              label="Uphill reach (m)"
              value={s.skid.adverseReachM}
              min={MIN_SKID_REACH_M}
              max={s.skid.flatReachM}
              step={10}
              onChange={(adverseReachM) => skid({ adverseReachM })}
            />
            <NumberField
              label="at uphill grade (%)"
              value={s.skid.adverseSlopePercent}
              min={1}
              max={200}
              step={1}
              hint="Percent. The field rule's 30 is read as 30 %, about 17°; 30° would be 58 %."
              onChange={(adverseSlopePercent) => skid({ adverseSlopePercent })}
            />
            <NumberField
              label="Ground skid limit (%)"
              value={s.skid.maxGroundSlopePercent}
              min={1}
              max={200}
              step={1}
              hint="The skidder does not drive on steeper ground; it can still winch logs off it."
              onChange={(maxGroundSlopePercent) => skid({ maxGroundSlopePercent })}
            />
          </div>
          <RoadSection
            title="Winching"
            summary={s.winchFrom === 'none' ? 'Off' : `${s.winch.upReachM} m up · ${s.winch.downReachM} m down`}
            help={
              <>
                Winch lines run straight from the machine. The longest line falls to the uphill length on lines at or
                above its slope and rises to the downhill length on lines at or below its own; between, it changes with
                the line&apos;s drop (the CARTUVI rule Sylvaccess uses). A line may pass at most {WINCH_HUMP_M} m below
                a rise and {WINCH_HOLLOW_M} m above a hollow; both are fixed.
                <br />
                Edge of driven ground: the skidder drives to the timber and winches only where it cannot drive. Roads
                and trails first: logs within winch reach of a road or trail are winched to it, which keeps the machine
                off that ground.
              </>
            }
          >
            <Field label="Winch from">
              <RoadSelect
                ariaLabel="Winch from"
                value={s.winchFrom}
                onValueChange={(value) => onSettings((x) => ({ ...x, winchFrom: value as WinchFrom }))}
                options={WINCH_FROM}
              />
            </Field>
            {s.winchFrom !== 'none' && (
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Uphill line (m)"
                  value={s.winch.upReachM}
                  min={0}
                  max={MAX_WINCH_M}
                  step={5}
                  hint="Timber above the machine."
                  onChange={(upReachM) => winch({ upReachM })}
                />
                <NumberField
                  label="full from (%)"
                  value={s.winch.upFullSlopePercent}
                  min={MIN_WINCH_SLOPE_PERCENT}
                  max={MAX_WINCH_SLOPE_PERCENT}
                  step={5}
                  onChange={(upFullSlopePercent) => winch({ upFullSlopePercent })}
                />
                <NumberField
                  label="Downhill line (m)"
                  value={s.winch.downReachM}
                  min={0}
                  max={MAX_WINCH_M}
                  step={5}
                  hint="Timber below the machine."
                  onChange={(downReachM) => winch({ downReachM })}
                />
                <NumberField
                  label="full from (%)"
                  ariaLabel="Downhill full from (%)"
                  value={s.winch.downFullSlopePercent}
                  min={MIN_WINCH_SLOPE_PERCENT}
                  max={MAX_WINCH_SLOPE_PERCENT}
                  step={5}
                  onChange={(downFullSlopePercent) => winch({ downFullSlopePercent })}
                />
              </div>
            )}
          </RoadSection>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Side slope limit (%)"
            value={s.forwarder.sideSlopePercent}
            min={MIN_FORWARDER_SLOPE_PERCENT}
            max={MAX_FORWARDER_SLOPE_PERCENT}
            step={1}
            hint="Steepest slope across the machine. Ground within all three slope limits is driven in any direction."
            onChange={(sideSlopePercent) => forwarder({ sideSlopePercent })}
          />
          <NumberField
            label="Loaded downhill (%)"
            value={s.forwarder.loadedDownhillPercent}
            min={MIN_FORWARDER_SLOPE_PERCENT}
            max={MAX_FORWARDER_SLOPE_PERCENT}
            step={1}
            hint="Steepest ground on a straight run to timber above the road: the loaded machine comes back down."
            onChange={(loadedDownhillPercent) => forwarder({ loadedDownhillPercent })}
          />
          <NumberField
            label="Loaded uphill (%)"
            value={s.forwarder.loadedUphillPercent}
            min={MIN_FORWARDER_SLOPE_PERCENT}
            max={MAX_FORWARDER_SLOPE_PERCENT}
            step={1}
            hint="Steepest ground on a straight run to timber below the road: the loaded machine climbs back."
            onChange={(loadedUphillPercent) => forwarder({ loadedUphillPercent })}
          />
          <NumberField
            label="Steep run budget (m)"
            value={s.forwarder.steepBudgetM}
            min={0}
            max={MAX_STEEP_BUDGET_M}
            step={10}
            hint="Distance a run may travel on ground steeper than the side slope limit."
            onChange={(steepBudgetM) => forwarder({ steepBudgetM })}
          />
          <NumberField
            label="Crane reach (m)"
            value={s.forwarder.craneReachM}
            min={MIN_CRANE_M}
            max={MAX_CRANE_M}
            step={0.5}
            hint="Measured centre to centre on the grid: a reach under one cell adds nothing."
            onChange={(craneReachM) => forwarder({ craneReachM })}
          />
          <NumberField
            label="Forwarding reach (m)"
            value={s.forwarder.reachM}
            min={MIN_FORWARDER_REACH_M}
            max={MAX_FORWARDER_REACH_M}
            step={10}
            hint="Longest forwarding distance, stand and trail, counted within reach."
            onChange={(reachM) => forwarder({ reachM })}
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Hand-falling limit (%)"
          value={s.fellableSlopePercent}
          min={MIN_FELLABLE_SLOPE_PERCENT}
          max={MAX_FELLABLE_SLOPE_PERCENT}
          step={5}
          hint="Ground whose steepest slope, with its eight neighbours, is above this is reported too steep to fell."
          onChange={(fellableSlopePercent) => onSettings((x) => ({ ...x, fellableSlopePercent }))}
        />
        <NumberField
          label="Travel outside block (m)"
          value={p.offBlockM}
          min={0}
          max={MAX_OFF_BLOCK_M}
          step={10}
          hint={
            s.machine === 'cable'
              ? 'How far outside the block a landing may be.'
              : 'How far the machine or a winch line may go outside the block to reach a road.'
          }
          onChange={p.onOffBlockM}
        />
        <NumberField
          label="Grid cell (m)"
          value={p.cellM}
          min={MIN_SKID_CELL_M}
          max={MAX_SKID_CELL_M}
          step={1}
          hint="Starting cell; a large block grows it to fit. Sylvaccess uses 5 m."
          onChange={p.onCellM}
        />
        <Field
          label="Distance classes (m)"
          hint="Lower bounds, separated by semicolons, starting at 0. Sylvaccess uses 0;500;1000;1500."
        >
          <input
            className={roadFieldClass}
            aria-label="Distance classes (m)"
            value={p.classText}
            onChange={(e) => p.onClassText(e.target.value)}
          />
        </Field>
      </div>
      {p.classError && <p className="text-2xs text-destructive">{p.classError}</p>}
      <p className="flex items-center gap-1 text-2xs text-muted-foreground">
        {s.machine === 'skidder'
          ? 'Default reach: the field rule, 350 m level, 200 m at 30 % uphill.'
          : s.machine === 'cable'
            ? 'Distances are carriage distances along the line from its landing.'
            : 'Defaults: Sylvaccess 3.6, with a 500 m forwarding reach.'}
        <InfoTip label="About the defaults">
          The skidder keeps the field layout rule of thumb (350 m level and downhill, 200 m at 30 % uphill, 40 % ground
          skid limit). Sylvaccess has no reach limit and a 30 % drivable limit; enter 2000 m and 30 % to match it. Winch
          and forwarder limits are Sylvaccess 3.6&apos;s defaults, not BC standards.
        </InfoTip>
      </p>
    </div>
  )
}
