import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/form-field'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { Field, NumberField, roadFieldClass } from './Controls'
import { formatRoadStation } from './Charts'
import { parseProject } from './project'
import { createSwitchbackAlternative, SWITCHBACK_LIMITS, type SwitchbackSketch } from './switchback'
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
      summary="Two curves at the road end"
      summaryWhenCollapsedOnly
      contentClassName="space-y-2 px-3 pb-3"
      toggleProps={{ 'data-testid': 'road-switchback-toggle' }}
    >
      <div className="space-y-2" data-testid="road-switchback-tools">
        <p className="text-xs text-muted-foreground">
          Extend a copy of this road with two 90° circular turns. Starter dimensions and grade are editable sketch
          assumptions.
        </p>
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
        <p className="text-[11px] text-muted-foreground">
          Inspect the new road in plan, profile and section. Radius and centreline spacing do not verify truck swept
          paths or overlapping earthworks. Widening tables apply per curve; the full 180° maneuver needs a separate
          vehicle review.
        </p>
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Profile and engineering inputs</summary>
          <p className="mt-1">
            The active profile is extended at the entered grade. Round the new join grade break as needed. Existing
            template/material/structure ranges retain their stations; review their coverage on the added length. Saved
            endpoint connections and cost approvals are cleared on the new alternative. Other named profiles remain with
            the original road.
          </p>
        </details>
      </div>
    </CollapsibleSection>
  )
}
