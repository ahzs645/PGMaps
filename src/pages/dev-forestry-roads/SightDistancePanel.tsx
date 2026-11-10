import { useMemo, useState } from 'react'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { formatRoadStation } from './Charts'
import { horizontalCurveSummary } from './engine'
import { RoadSection } from './SidebarParts'
import {
  curveSightClearings,
  DEFAULT_SIGHT_SETTINGS,
  reviewRoadSight,
  sightBasis,
  SIGHT_LIMITS,
  TRUCK_EYE_HEIGHT_M,
  type SightDistanceSettings,
} from './sightDistance'
import type { RoadWorkspace } from './useRoadWorkspace'

const m = (value: number | null, digits = 0) =>
  value === null ? '—' : value.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits })

/**
 * Stopping sight distance inputs and results for the active road: the distance needed from design
 * speed, the stations that see less, and the clearing each curve needs on its inside. The Review
 * list carries the same check (`readiness.ts`).
 */
export function SightDistancePanel({ workspace }: { workspace: RoadWorkspace }) {
  const { project, alignment, analysis, updateAlignment, setStation } = workspace
  const [open, setOpen] = useState(false)
  const basis = useMemo(() => sightBasis(alignment, project.standards), [alignment, project.standards])
  // Looking along the road costs up to a few hundred milliseconds on a long road: only while open.
  const review = useMemo(
    () =>
      open
        ? reviewRoadSight({
            analysis,
            alignment,
            standards: project.standards,
            stationIntervalM: project.settings.stationInterval,
          })
        : null,
    [open, analysis, alignment, project.standards, project.settings.stationInterval],
  )
  const clearings = useMemo(() => {
    if (!review) return []
    try {
      return curveSightClearings(horizontalCurveSummary(alignment), analysis.stations, review)
    } catch {
      return []
    }
  }, [alignment, analysis.stations, review])
  const s = basis.settings
  const set = (patch: Partial<SightDistanceSettings>) =>
    updateAlignment((road) => ({ ...road, sightDistance: { ...road.sightDistance, ...patch } }))
  const summary =
    basis.speedKmh === null
      ? 'No design speed'
      : `${basis.singleLane ? 'Meeting' : 'SSD'} ${m(basis.levelRequiredM)} m at ${m(basis.speedKmh)} km/h`
  const worst = [...(review?.short ?? [])].sort(
    (a, b) => a.availableM - (a.requiredM ?? 0) - (b.availableM - (b.requiredM ?? 0)),
  )
  return (
    <RoadSection
      title="Sight distance"
      summary={summary}
      help={
        <>
          The distance a driver needs to stop, from the design speed (curve design, else Design standards), reaction
          time and braking friction, on the grade ahead. A single-lane road needs both vehicles&rsquo; stopping
          distances to an oncoming vehicle. Each station looks ahead and back along its lane on the surface the road
          leaves: the designed section between the catch points and the ground beyond, rebuilt from the calculated
          stations. Distances are measured along the road. A sightline over missing terrain is unknown, not clear.
        </>
      }
      open={open}
      onOpenChange={setOpen}
      data-testid="road-sight-distance-section"
    >
      {basis.speedKmh === null && (
        <InlineAlert tone="info">Enter a design speed under Curve design or Design standards.</InlineAlert>
      )}
      <div className="grid grid-cols-2 items-end gap-2">
        <NumberField
          label="Reaction time (s)"
          value={s.reactionTimeS}
          min={SIGHT_LIMITS.reactionTimeS[0]}
          max={SIGHT_LIMITS.reactionTimeS[1]}
          step={0.1}
          onChange={(value) => set({ reactionTimeS: value })}
        />
        <OptionalNumberField
          label="Braking friction"
          value={s.friction}
          min={SIGHT_LIMITS.friction[0]}
          max={SIGHT_LIMITS.friction[1]}
          step={0.01}
          placeholder={basis.friction === null ? 'from speed' : `${basis.friction} from speed`}
          hint="Blank takes TAC's wet-pavement value for the design speed. Gravel and snow can be lower."
          onChange={(value) => set({ friction: value })}
        />
        <Field label="Eye height">
          <RoadSelect
            ariaLabel="Eye height"
            className={roadFieldClass}
            value={s.eyeHeightM === TRUCK_EYE_HEIGHT_M ? 'truck' : s.eyeHeightM === 1.05 ? 'car' : 'custom'}
            onValueChange={(value) =>
              value !== 'custom' && set({ eyeHeightM: value === 'truck' ? TRUCK_EYE_HEIGHT_M : 1.05 })
            }
          >
            <option value="car">Car 1.05 m</option>
            <option value="truck">Logging truck {TRUCK_EYE_HEIGHT_M} m</option>
            <option value="custom">Entered</option>
          </RoadSelect>
        </Field>
        <NumberField
          label="Eye (m)"
          value={s.eyeHeightM}
          min={SIGHT_LIMITS.eyeHeightM[0]}
          max={SIGHT_LIMITS.eyeHeightM[1]}
          step={0.01}
          onChange={(value) => set({ eyeHeightM: value })}
        />
        <Field label="Lanes">
          <RoadSelect
            ariaLabel="Lanes"
            className={roadFieldClass}
            value={s.singleLane === null ? 'auto' : s.singleLane ? 'single' : 'two'}
            onValueChange={(value) => set({ singleLane: value === 'auto' ? null : value === 'single' })}
          >
            <option value="auto">From width ({basis.singleLane ? 'single' : 'two'})</option>
            <option value="single">Single lane</option>
            <option value="two">Two lanes</option>
          </RoadSelect>
        </Field>
        <NumberField
          label={basis.singleLane ? 'Oncoming vehicle (m)' : 'Object (m)'}
          value={basis.singleLane ? s.oncomingHeightM : s.objectHeightM}
          min={0}
          max={5}
          step={0.01}
          onChange={(value) => set(basis.singleLane ? { oncomingHeightM: value } : { objectHeightM: value })}
        />
        <OptionalNumberField
          label="Trees beyond clearing (m)"
          value={s.vegetationHeightM}
          min={SIGHT_LIMITS.vegetationHeightM[0]}
          max={SIGHT_LIMITS.vegetationHeightM[1]}
          step={1}
          placeholder="ignore"
          hint="Standing trees past the clearing edge block sight up to this height. Blank leaves vegetation out."
          onChange={(value) => set({ vegetationHeightM: value })}
        />
        {alignment.sightDistance && (
          <button
            type="button"
            className="pb-1 text-left text-2xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => updateAlignment(({ sightDistance: _, ...road }) => road)}
            title={`Reaction ${DEFAULT_SIGHT_SETTINGS.reactionTimeS} s, eye ${DEFAULT_SIGHT_SETTINGS.eyeHeightM} m, object ${DEFAULT_SIGHT_SETTINGS.objectHeightM} m`}
          >
            Reset to defaults
          </button>
        )}
      </div>
      {review?.status === 'checked' && (
        <p className="text-2xs text-muted-foreground" data-testid="road-sight-distance-result">
          Needs {m(review.levelRequiredM)} m on the level at {m(review.speedKmh)} km/h (friction{' '}
          {review.friction?.toFixed(2)}). Looked both ways every {m(review.eyeSpacingM)} m:{' '}
          {review.short.length
            ? `${new Set(review.short.map((eye) => eye.chainage)).size} stations see less`
            : 'none sees less'}
          {review.unknown.length ? `, ${review.unknown.length} looks unknown (missing terrain)` : ''}
          {review.nearEnd.length ? `, ${review.nearEnd.length} near a road end not judged` : ''}.
        </p>
      )}
      {worst.length > 0 && (
        <div className="max-h-40 overflow-auto">
          <EngineeringTable>
            <thead className="sticky top-0">
              <tr>
                <ColumnHeader label="Station" />
                <ColumnHeader label="Look" />
                <ColumnHeader label="Sees" unit="m" />
                <ColumnHeader label="Needs" unit="m" />
                <ColumnHeader label="Limit" />
              </tr>
            </thead>
            <tbody>
              {worst.slice(0, 50).map((eye) => (
                <tr
                  key={`${eye.chainage}-${eye.direction}`}
                  className="cursor-pointer"
                  onClick={() => setStation(eye.chainage)}
                  aria-selected={Math.abs(workspace.station - eye.chainage) < 1e-6}
                >
                  <td>{formatRoadStation(eye.chainage)}</td>
                  <td>{eye.direction}</td>
                  <td>{m(eye.availableM)}</td>
                  <td>{m(eye.requiredM)}</td>
                  <td>{eye.limitedBy === 'vegetation' ? 'trees' : 'surface'}</td>
                </tr>
              ))}
            </tbody>
          </EngineeringTable>
        </div>
      )}
      {clearings.length > 0 && (
        <div className="max-h-40 overflow-auto" data-testid="road-sight-curve-clearing">
          <EngineeringTable>
            <thead className="sticky top-0">
              <tr>
                <ColumnHeader label="Curve" />
                <ColumnHeader label="R" unit="m" />
                <ColumnHeader label="Clear inside" unit="m from CL" />
                <ColumnHeader label="Cleared" unit="m" />
              </tr>
            </thead>
            <tbody>
              {clearings.map((curve) => (
                <tr key={curve.curve} className="cursor-pointer" onClick={() => setStation(curve.start)}>
                  <td>
                    H{curve.curve + 1} {curve.inside === 'left' ? 'L' : 'R'}
                  </td>
                  <td>{m(curve.radiusM)}</td>
                  <td className={curve.short ? 'font-medium text-destructive' : undefined}>
                    {m(curve.neededFromCentreM, 1)}
                  </td>
                  <td>{m(curve.clearedFromCentreM, 1)}</td>
                </tr>
              ))}
            </tbody>
          </EngineeringTable>
        </div>
      )}
    </RoadSection>
  )
}
