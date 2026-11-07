import { useDeferredValue, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { Field, NumberField, roadFieldClass } from './Controls'
import { formatRoadStation } from './Charts'
import { parseProject } from './project'
import {
  createSwitchbackAlternative,
  smallestFittingSwitchbackRadius,
  switchbackSweptTurn,
  SWITCHBACK_LIMITS,
  type SwitchbackOptions,
  type SwitchbackSketch,
} from './switchback'
import { DEFAULT_VEHICLE_CHECK } from './sweptPath'
import type { RoadWorkspace } from './useRoadWorkspace'

const number = (value: number) => value.toLocaleString('en-CA', { maximumFractionDigits: 1 })

function Sketch({ result }: { result: SwitchbackSketch }) {
  const xs = result.sketch.map(([x]) => x),
    ys = result.sketch.map(([, y]) => y)
  const left = Math.min(...xs),
    right = Math.max(...xs),
    bottom = Math.min(...ys),
    top = Math.max(...ys)
  const scale = Math.min(250 / Math.max(1, right - left), 100 / Math.max(1, top - bottom))
  const x = (value: number) => 20 + (250 - (right - left) * scale) / 2 + (value - left) * scale
  const y = (value: number) => 25 + (100 - (top - bottom) * scale) / 2 + (top - value) * scale
  const first = result.sketch[0],
    last = result.sketch.at(-1)!
  return (
    <svg
      viewBox="0 0 290 150"
      className="w-full rounded border bg-muted/20"
      role="img"
      aria-label="Switchback plan sketch: two 90 degree curves connected by a straight"
    >
      <polyline
        points={result.sketch.map(([a, b]) => `${x(a)},${y(b)}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        className="text-primary"
      />
      <circle cx={x(first[0])} cy={y(first[1])} r="4" fill="currentColor" />
      <circle cx={x(last[0])} cy={y(last[1])} r="4" fill="currentColor" />
      <text x={x(first[0])} y={y(first[1]) + 17} textAnchor="middle" fontSize="10" fill="currentColor">
        Road end
      </text>
      <text x={x(last[0])} y={y(last[1]) - 10} textAnchor="middle" fontSize="10" fill="currentColor">
        Return leg
      </text>
    </svg>
  )
}

/** Inputs only stage a sketch; creation keeps the original and uses the normal project/undo path. */
export function SwitchbackTools({
  workspace,
  readOnly = false,
  onCreated,
}: {
  workspace: RoadWorkspace
  readOnly?: boolean
  onCreated?: () => void
}) {
  const { alignment, analysis, project } = workspace
  const [direction, setDirection] = useState<'left' | 'right'>('left')
  const [radiusM, setRadius] = useState(Math.min(1000, Math.max(25, project.settings.minRadius)))
  const [approachM, setApproach] = useState(Math.max(50, alignment.curveDesign?.runoffLengthM ?? 0))
  const [tangentM, setTangent] = useState(5)
  const [departureM, setDeparture] = useState(80)
  const [gradePercent, setGrade] = useState(3)
  const end = analysis.stations.at(-1)
  const staged = useMemo(() => {
    try {
      if (end?.designElevation == null) throw Error('A calculated formation level is needed at the road end.')
      return {
        result: createSwitchbackAlternative(alignment, {
          id: alignment.id === 'switchback-preview' ? 'switchback-preview-alt' : 'switchback-preview',
          direction,
          radiusM,
          approachM,
          tangentM,
          departureM,
          gradePercent,
          startElevationM: end.designElevation,
        }),
        error: '',
      }
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : 'The switchback could not be fitted.' }
    }
  }, [alignment, direction, radiusM, approachM, tangentM, departureM, gradePercent, end?.designElevation])
  const result = staged.result
  // The road's own design vehicle, or the labelled example until one is set.
  const vehicleCheck = alignment.vehicleCheck ?? DEFAULT_VEHICLE_CHECK
  const deferredResult = useDeferredValue(result)
  const sweptTurn = useMemo(() => {
    if (!deferredResult) return null
    try {
      return switchbackSweptTurn(deferredResult, vehicleCheck)
    } catch {
      return null
    }
  }, [deferredResult, vehicleCheck])
  // A radius search answers one set of inputs; any other change hides its answer.
  const fitKey = JSON.stringify([direction, approachM, tangentM, departureM, gradePercent])
  const [fit, setFit] = useState<{
    key: string
    road: typeof alignment
    check: typeof vehicleCheck
    radiusM: number | null
    error?: string
  } | null>(null)
  const [searching, setSearching] = useState(false)
  const findRadius = () => {
    if (end?.designElevation == null) return
    const options: SwitchbackOptions = {
      id: 'switchback-radius-search',
      direction,
      radiusM,
      approachM,
      tangentM,
      departureM,
      gradePercent,
      startElevationM: end.designElevation,
    }
    setSearching(true)
    // Let the busy state paint before the search runs on the main thread.
    window.setTimeout(() => {
      try {
        setFit({
          key: fitKey,
          road: alignment,
          check: vehicleCheck,
          radiusM: smallestFittingSwitchbackRadius(alignment, options, vehicleCheck),
        })
      } catch (error) {
        setFit({
          key: fitKey,
          road: alignment,
          check: vehicleCheck,
          radiusM: null,
          error: error instanceof Error ? error.message : 'Search failed.',
        })
      } finally {
        setSearching(false)
      }
    }, 30)
  }
  const currentFit = fit?.key === fitKey && fit.road === alignment && fit.check === vehicleCheck ? fit : null
  const create = () => {
    if (readOnly || !result || workspace.busy || end?.designElevation == null) return
    workspace.setError('')
    try {
      const candidate = createSwitchbackAlternative(alignment, {
        id: crypto.randomUUID(),
        direction,
        radiusM,
        approachM,
        tangentM,
        departureM,
        gradePercent,
        startElevationM: end.designElevation,
      })
      workspace.update((current) => {
        if (current !== project) throw Error('The road changed; review the updated sketch before creating it.')
        return parseProject({
          ...current,
          activeAlignmentId: candidate.alignment.id,
          alignments: [...current.alignments, candidate.alignment],
        })
      })
      workspace.setStation((candidate.curveStart + candidate.curveEnd) / 2)
      workspace.setFeatureSelection(null)
      onCreated?.()
      workspace.setNotice(
        `Created a ${direction} switchback alternative: two R${number(radiusM)} m curves, ${number(candidate.addedLengthM)} m added at ${number(gradePercent)}% initial grade. Review the join grade break, terrain, widening and return-leg clearance. The original road is retained.`,
      )
    } catch (error) {
      workspace.setError(error instanceof Error ? error.message : 'The switchback could not be created.')
    }
  }
  return (
    <CollapsibleSection
      label="Add a switchback"
      contentClassName="space-y-2 px-3 pb-3"
      toggleProps={{ 'data-testid': 'road-switchback-toggle' }}
      actions={
        <InfoTip label="About switchbacks">
          Extends a copy of this road with two 90° circular turns; the sizes and grade are starting sketches. The active
          profile continues at the entered grade, so round the new grade break. Existing template, material and
          structure ranges keep their stations. Saved connections and cost approvals are cleared on the copy. The
          swept-path check covers wheels against the formation; body clearance to batters and trees, earthworks
          overlapping between the legs, and traction still need review.
        </InfoTip>
      }
    >
      <div className="space-y-2" data-testid="road-switchback-tools">
        <Field label="Switchback turn">
          <NativeSelect
            className={roadFieldClass}
            aria-label="Switchback turn"
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Switchback radius (m)"
            value={radiusM}
            min={SWITCHBACK_LIMITS.minRadiusM}
            max={SWITCHBACK_LIMITS.maxRadiusM}
            step={1}
            onChange={setRadius}
          />
          <NumberField
            label="Initial grade (%)"
            value={gradePercent}
            min={-SWITCHBACK_LIMITS.maxAbsGradePercent}
            max={SWITCHBACK_LIMITS.maxAbsGradePercent}
            step={0.5}
            onChange={setGrade}
            hint="Positive rises with station. This constant formation grade starts at the existing road-end level; it is not a terrain-following or optimized profile."
          />
          <NumberField
            label="Entry straight (m)"
            value={approachM}
            min={SWITCHBACK_LIMITS.minApproachM}
            max={SWITCHBACK_LIMITS.maxApproachM}
            step={5}
            onChange={setApproach}
          />
          <NumberField
            label="Middle straight (m)"
            value={tangentM}
            min={SWITCHBACK_LIMITS.minTangentM}
            max={SWITCHBACK_LIMITS.maxTangentM}
            step={1}
            onChange={setTangent}
          />
          <NumberField
            label="Exit straight (m)"
            value={departureM}
            min={SWITCHBACK_LIMITS.minApproachM}
            max={SWITCHBACK_LIMITS.maxApproachM}
            step={5}
            onChange={setDeparture}
          />
        </div>
        {result && (
          <>
            <Sketch result={result} />
            <dl
              className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-xs tabular-nums"
              data-testid="road-switchback-preview"
            >
              <dt>Added length</dt>
              <dd>{number(result.addedLengthM)} m</dd>
              <dt>Opposing centreline spacing</dt>
              <dd>{number(result.legSeparationM)} m</dd>
              <dt>Curved turn</dt>
              <dd>180° total</dd>
              <dt>New end station</dt>
              <dd>{formatRoadStation(result.endChainage)}</dd>
              <dt>New end formation</dt>
              <dd>{number(result.endElevationM)} m</dd>
            </dl>
            <div
              className={`space-y-1.5 rounded-md border p-2 text-xs ${sweptTurn && !sweptTurn.fits ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40' : 'bg-muted/30'}`}
              data-testid="road-switchback-swept"
            >
              <p className="font-medium" role="status">
                {!sweptTurn
                  ? 'Checking the vehicle swept path…'
                  : sweptTurn.fits
                    ? `Wheels stay on the formation · offtracking ${sweptTurn.maxOfftrackingM.toFixed(2)} m`
                    : `Wheels need ${sweptTurn.requiredWideningM.toFixed(2)} m more formation · offtracking ${sweptTurn.maxOfftrackingM.toFixed(2)} m`}
              </p>
              <p className="text-2xs text-muted-foreground">
                {vehicleCheck.vehicle.name}
                {alignment.vehicleCheck
                  ? ` · ${vehicleCheck.direction === 'both' ? 'both directions' : `${vehicleCheck.direction}-station`} · ${vehicleCheck.clearanceM.toFixed(2)} m clearance`
                  : '. Example vehicle: enter yours in the Swept path view.'}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={searching || readOnly}
                onClick={findRadius}
              >
                {searching ? 'Searching radii…' : 'Find smallest radius that fits'}
              </Button>
              {currentFit && (
                <div className="flex flex-wrap items-center justify-between gap-2" data-testid="road-switchback-fit">
                  <span>
                    {currentFit.error
                      ? currentFit.error
                      : currentFit.radiusM === null
                        ? 'No radius up to 200 m fits this formation; widen it instead.'
                        : `Smallest fitting radius: ${number(currentFit.radiusM)} m`}
                  </span>
                  {currentFit.radiusM !== null && currentFit.radiusM !== radiusM && (
                    <Button size="sm" variant="outline" onClick={() => setRadius(currentFit.radiusM!)}>
                      Use R{number(currentFit.radiusM)}
                    </Button>
                  )}
                </div>
              )}
            </div>
            {radiusM < project.settings.minRadius && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Radius is below your {number(project.settings.minRadius)} m review threshold.
              </p>
            )}
            {Math.abs(gradePercent) > project.settings.maxGradePercent && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Initial grade exceeds your {number(project.settings.maxGradePercent)}% review threshold.
              </p>
            )}
          </>
        )}
        {staged.error && (
          <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
            {staged.error}
          </p>
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={readOnly || !result || !!workspace.busy || project.alignments.length >= 20}
          onClick={create}
        >
          Create switchback alternative
        </Button>
        {project.alignments.length >= 20 && (
          <p className="text-xs text-muted-foreground">The project already has 20 road alternatives.</p>
        )}
      </div>
    </CollapsibleSection>
  )
}
