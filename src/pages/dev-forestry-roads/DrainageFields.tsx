import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, RoadSelect } from './Controls'
import { DEFAULT_WATERSHED_MIN_AREA_HA, MAX_POUR_POINT_SNAP_M, type PourPoint } from './drainageCatchments'
import type { DepressionPolicy, SnapPolicy } from './drainagePolicies'
import { DRAINAGE_FIELDS } from './roadFieldDefinitions'
import type { Coordinate } from './types'

/**
 * The drainage inputs the road's check (Drainage view, `DrainagePanel.tsx`) and Existing-ground
 * drainage (the plan card, `GroundDrainagePanel.tsx`) share: one set of labels, options, defaults
 * and ranges for the routing they have in common. Each tool keeps its own state; these only draw
 * and report a change, and each field renders bare so the panel lays it out in its own grid.
 */

/** The routing settings both tools route with. `reachM` is the road's buffer or the area's margin. */
export interface DrainageRoutingValues {
  streamThresholdHa: number
  reachM: number
  workingResolutionM?: number
  depressionPolicy?: DepressionPolicy
}

const DEPRESSION_OPTIONS = [
  {
    value: 'fill-all',
    label: 'Fill all depressions',
    title: 'Fill every depression before routing. Potential ponding is still reported.',
  },
  {
    value: 'preserve',
    label: 'Preserve depressions',
    title: 'Keep natural sinks: flow that reaches one stops there.',
  },
  {
    value: 'depth-limited',
    label: 'Fill shallow basins',
    title: 'Fill a connected depression only when its spill depth is within the limit; deeper basins remain.',
  },
]
const GRID_OPTIONS = [
  { value: 'automatic', label: 'Use source resolution', title: 'The terrain source resolution, at least 1 m.' },
  {
    value: 'custom',
    label: 'Set working resolution',
    title: 'A coarser cell size. It cannot add terrain detail, and the cell budget may coarsen it further.',
  },
]
const SNAP_OPTIONS = [
  {
    value: 'max-accumulation',
    label: 'Greatest contributing area',
    title: 'The cell within the snap distance that drains the most area. Ties go to the nearest.',
  },
  {
    value: 'lowest-elevation',
    label: 'Lowest elevation',
    title: 'The lowest cell within the snap distance, on the chosen surface before depression filling.',
  },
]
/** A depth-limited policy starts at this spill depth, m. */
const DEFAULT_BASIN_FILL_M = 0.5

const twoPlaces = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 })
/** One line naming the routing choices, for a folded section's summary. */
export function routingSummary(value: DrainageRoutingValues) {
  const fmt = (v: number) => twoPlaces.format(v)
  const depression =
    value.depressionPolicy?.mode === 'preserve'
      ? 'depressions kept'
      : value.depressionPolicy?.mode === 'depth-limited'
        ? `basins filled to ${fmt(value.depressionPolicy.maxDepthM)} m`
        : 'depressions filled'
  return [
    `streams from ${fmt(value.streamThresholdHa)} ha`,
    `${fmt(value.reachM)} m upslope`,
    depression,
    value.workingResolutionM === undefined ? 'source cells' : `${fmt(value.workingResolutionM)} m cells`,
  ].join(' · ')
}

/**
 * Stream threshold, upslope reach, depression treatment and working grid, as four fields (six
 * with a depth limit or a requested cell). `onChange` gets only what changed; an `undefined`
 * working resolution means the source's.
 */
export function DrainageRoutingFields({
  value,
  onChange,
  reach,
  customCellM,
  updateOn,
}: {
  value: DrainageRoutingValues
  onChange: (patch: Partial<DrainageRoutingValues>) => void
  /** The reach field's range and what it is measured from (the road's catch lines or the area's boundary). */
  reach: { min: number; max: number; hint: ReactNode }
  /** The cell a newly set working resolution starts at, m. */
  customCellM: number
  updateOn?: 'change' | 'commit'
}) {
  const policy = value.depressionPolicy
  return (
    <>
      <NumberField
        {...DRAINAGE_FIELDS.streamThresholdHa}
        value={value.streamThresholdHa}
        updateOn={updateOn}
        hint="Contributing area at which a flow line is drawn as a stream."
        onChange={(streamThresholdHa) => onChange({ streamThresholdHa })}
      />
      <NumberField
        label={DRAINAGE_FIELDS.bufferM.label}
        step={DRAINAGE_FIELDS.bufferM.step}
        min={reach.min}
        max={reach.max}
        value={value.reachM}
        updateOn={updateOn}
        hint={reach.hint}
        onChange={(reachM) => onChange({ reachM })}
      />
      <Field label="Depression treatment">
        <RoadSelect
          ariaLabel="Depression treatment"
          className="h-8 w-full"
          value={policy?.mode ?? 'fill-all'}
          options={DEPRESSION_OPTIONS}
          onValueChange={(mode) =>
            onChange({
              depressionPolicy:
                mode === 'depth-limited'
                  ? {
                      mode,
                      maxDepthM: policy?.mode === 'depth-limited' ? policy.maxDepthM : DEFAULT_BASIN_FILL_M,
                    }
                  : { mode: mode as 'fill-all' | 'preserve' },
            })
          }
        />
      </Field>
      {policy?.mode === 'depth-limited' && (
        <NumberField
          label="Maximum basin fill (m)"
          value={policy.maxDepthM}
          min={0}
          max={1000}
          step={0.05}
          updateOn={updateOn}
          onChange={(maxDepthM) => onChange({ depressionPolicy: { mode: 'depth-limited', maxDepthM } })}
        />
      )}
      <Field label="Working grid">
        <RoadSelect
          ariaLabel="Working grid"
          className="h-8 w-full"
          value={value.workingResolutionM === undefined ? 'automatic' : 'custom'}
          options={GRID_OPTIONS}
          onValueChange={(choice) => onChange({ workingResolutionM: choice === 'automatic' ? undefined : customCellM })}
        />
      </Field>
      {value.workingResolutionM !== undefined && (
        <NumberField
          label="Requested grid cell (m)"
          value={value.workingResolutionM}
          min={1}
          max={100_000}
          step={1}
          updateOn={updateOn}
          onChange={(workingResolutionM) => onChange({ workingResolutionM })}
        />
      )}
    </>
  )
}

/** Watershed polygons on or off, and the smallest kept. Off is `undefined`. */
export function WatershedFields({
  minAreaHa,
  onChange,
  note,
  updateOn,
}: {
  minAreaHa: number | undefined
  onChange: (minAreaHa: number | undefined) => void
  /** What the partition splits, shown while it is on. */
  note?: ReactNode
  updateOn?: 'change' | 'commit'
}) {
  return (
    <div className="space-y-2">
      <label className="flex min-h-8 items-center gap-2 touch:min-h-10">
        <input
          type="checkbox"
          aria-label="Delineate watershed polygons"
          checked={minAreaHa !== undefined}
          onChange={(event) => onChange(event.target.checked ? DEFAULT_WATERSHED_MIN_AREA_HA : undefined)}
        />
        Delineate watershed polygons
      </label>
      {minAreaHa !== undefined && (
        <>
          {note && <p className="text-muted-foreground">{note}</p>}
          <NumberField
            label="Minimum watershed (ha)"
            value={minAreaHa}
            min={0.01}
            max={100_000}
            step={0.1}
            updateOn={updateOn}
            onChange={onChange}
          />
        </>
      )}
    </div>
  )
}

export type PourPointOptions = Pick<PourPoint, 'snapRadiusM' | 'snapPolicy'> & { surface?: PourPoint['surface'] }

/**
 * Picking a pour point on the plan, its snap, and the point once set (longitude and latitude,
 * editable, and Remove). The road check also chooses the surface it is read on.
 */
export function PourPointFields({
  options,
  onOptions,
  surfaces = false,
  point,
  onPoint,
  picking,
  onPick,
  disabled,
  disabledReason,
  updateOn,
}: {
  options: PourPointOptions
  onOptions: (patch: Partial<PourPointOptions>) => void
  /** Offer existing ground or the design surface (the road check only). */
  surfaces?: boolean
  point: Coordinate | undefined
  /** A typed coordinate, or `undefined` to remove the point. */
  onPoint: (point: Coordinate | undefined) => void
  picking: boolean
  onPick: () => void
  disabled?: boolean
  /** Why picking is off, said under the button. */
  disabledReason?: string
  updateOn?: 'change' | 'commit'
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] items-end gap-2">
        {surfaces && (
          <Field label="Catchment surface">
            <RoadSelect
              ariaLabel="Catchment surface"
              className="h-8 w-full"
              value={options.surface ?? 'design'}
              onValueChange={(surface) => onOptions({ surface: surface as PourPoint['surface'] })}
              options={[
                { value: 'existing', label: 'Existing ground' },
                { value: 'design', label: 'Design surface' },
              ]}
            />
          </Field>
        )}
        <NumberField
          label="Pour-point snap (m)"
          value={options.snapRadiusM}
          min={0}
          max={MAX_POUR_POINT_SNAP_M}
          step={1}
          updateOn={updateOn}
          onChange={(snapRadiusM) => onOptions({ snapRadiusM })}
        />
        <Field label="Outlet snap policy">
          <RoadSelect
            ariaLabel="Outlet snap policy"
            className="h-8 w-full"
            value={options.snapPolicy ?? 'max-accumulation'}
            onValueChange={(snapPolicy) => onOptions({ snapPolicy: snapPolicy as SnapPolicy })}
            options={SNAP_OPTIONS}
          />
        </Field>
        <Button
          size="sm"
          className="h-auto min-h-8 min-w-0 whitespace-normal py-1.5 touch:min-h-10"
          variant={picking ? 'default' : 'outline'}
          aria-pressed={picking}
          disabled={disabled && !picking}
          onClick={onPick}
        >
          {picking ? 'Cancel point selection' : point ? 'Move pour point on plan' : 'Select pour point on plan'}
        </Button>
      </div>
      {disabled && !picking && disabledReason && <p className="text-muted-foreground">{disabledReason}</p>}
      {picking && <p role="status">Tap a terrain location on the plan to set the pour point.</p>}
      {point && (
        <div className="grid grid-cols-2 items-end gap-2">
          <NumberField
            label="Pour-point longitude"
            value={point[0]}
            min={-180}
            max={180}
            step={0.00001}
            updateOn={updateOn}
            onChange={(lon) => onPoint([lon, point[1]])}
          />
          <NumberField
            label="Pour-point latitude"
            value={point[1]}
            min={-84.99999}
            max={84.99999}
            step={0.00001}
            updateOn={updateOn}
            onChange={(lat) => onPoint([point[0], lat])}
          />
        </div>
      )}
      {point && (
        <Button size="sm" variant="ghost" className="touch:min-h-10" onClick={() => onPoint(undefined)}>
          Remove pour point
        </Button>
      )}
    </div>
  )
}
