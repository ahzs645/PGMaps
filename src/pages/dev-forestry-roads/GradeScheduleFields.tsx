/** Typed tangent grades in the Vertical schedule; the rule is `setTangentGrade` in `gradeEdit.ts`. */
import { engineeringCellInputClass } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { GradeEntryField } from './GradeEntryField'
import { MAX_EDIT_GRADE_PERCENT, setTangentGrade, type GradeHold } from './gradeEdit'
import type { VerticalControl, VerticalPoint } from './types'

/** Which end of a tangent stays when its grade is typed in the schedule. */
export function GradeHoldPicker({
  value,
  onChange,
  disabled,
}: {
  value: GradeHold
  onChange: (hold: GradeHold) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1 text-2xs text-muted-foreground">
      <span>Typed grade moves</span>
      <SegmentedControl
        label="Typed grade moves"
        size="sm"
        fullWidth={false}
        value={value}
        onChange={onChange}
        options={[
          { value: 'back', label: 'Ahead PVI', disabled, title: 'The PVI up-station of the tangent moves' },
          { value: 'ahead', label: 'Back PVI', disabled, title: 'The PVI down-station of the tangent moves' },
        ]}
      />
      <InfoTip label="Typed grades">
        A typed grade moves one PVI of that tangent and holds the other; the moved PVI&apos;s grade on its far side
        changes with it. A PVI sitting on an elevation control it meets is not moved: hold it instead.
      </InfoTip>
    </div>
  )
}

/** One editable grade cell: the tangent that starts at `backId`. */
export function GradeCell({
  label,
  value,
  points,
  backId,
  hold,
  controls,
  onVerticalChange,
}: {
  label: string
  value: number | null
  points: VerticalPoint[]
  /** The tangent's back PVI; null where there is no tangent (before the first PVI, after the last). */
  backId: string | null
  hold: GradeHold
  controls?: VerticalControl[]
  onVerticalChange?: (points: VerticalPoint[]) => void
}) {
  if (value === null || backId === null || !Number.isFinite(value)) return <>—</>
  return (
    <GradeEntryField
      label={label}
      hideLabel
      value={Math.round(value * 1e4) / 1e4}
      max={MAX_EDIT_GRADE_PERCENT}
      fixedDecimals
      inputClassName={engineeringCellInputClass}
      disabled={!onVerticalChange}
      onGrade={(grade) => {
        const result = setTangentGrade(points, backId, grade, hold, controls)
        if ('error' in result) return result.error
        onVerticalChange?.(result.points)
      }}
    />
  )
}
