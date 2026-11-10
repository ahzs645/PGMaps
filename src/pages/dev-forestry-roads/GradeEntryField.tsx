/**
 * A typed tangent grade, for the profile's grade popover and the Vertical schedule. Unlike the plain
 * number field, a grade the rule refuses is never applied in any form: the field keeps the text the
 * user typed beside the refusal until they change it, and Enter or blur on that text applies nothing.
 * (The shared field resets its draft to the stored value after a refused change, and Enter then
 * applied that value's rounded display as a new grade, moving a PVI by millimetres.)
 */
import { useId, useState } from 'react'
import { FormField } from '@/components/ui/form-field'
import { roadFieldClass } from './Controls'

/** The grade as the field shows it: two decimals at most, never "-0". */
export function gradeFieldText(grade: number, decimals = 2, fixed = false) {
  const rounded = Number(grade.toFixed(decimals))
  const value = Object.is(rounded, -0) ? 0 : rounded
  return fixed ? value.toFixed(decimals) : String(value)
}

export function GradeEntryField({
  label,
  hideLabel = false,
  value,
  max,
  onGrade,
  disabled,
  fixedDecimals = false,
  inputClassName = roadFieldClass,
  autoFocus,
  step = 0.5,
}: {
  label: string
  hideLabel?: boolean
  /** The tangent's grade now, in percent. */
  value: number
  /** The steepest grade either way, in percent; a typed value past it is changed to it on Enter or blur. */
  max: number
  /** Applies a grade; returns why it was refused, or nothing when it was applied. */
  onGrade: (grade: number) => string | undefined
  disabled?: boolean
  fixedDecimals?: boolean
  inputClassName?: string
  /** Marks the input as the one a popover focuses when it opens. */
  autoFocus?: boolean
  /** What an arrow key adds or takes away, in percent. */
  step?: number
}) {
  const id = useId()
  // The user's own text while they edit or while it stands refused; null shows the grade.
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [note, setNote] = useState<string | undefined>()
  const range = `Enter −${max} to ${max}.`

  /** Applies `grade`; a refusal keeps `shown` in the field beside its message. */
  const apply = (grade: number, shown: string) => {
    const refused = onGrade(grade)
    setError(refused)
    setText(refused ? shown : null)
    return !refused
  }
  const commit = () => {
    if (text === null) return
    const grade = text.trim() ? Number(text) : NaN
    // Blank or not a number: nothing was applied, so show the grade again.
    if (!Number.isFinite(grade)) {
      setText(null)
      setError(undefined)
      return
    }
    if (Math.abs(grade) <= max) return void apply(grade, text)
    const limit = Math.sign(grade) * max
    if (apply(limit, gradeFieldText(limit)))
      setNote(`${text.trim()} is outside −${max} to ${max}, so it was changed to ${gradeFieldText(limit)}.`)
  }
  /** Arrow keys step the grade by `step` and apply it at once, as a typed grade and Enter would. */
  const stepBy = (direction: 1 | -1) => {
    const from = text !== null && Number.isFinite(Number(text)) && text.trim() ? Number(text) : value
    const next = Math.max(-max, Math.min(max, Number((from + direction * step).toFixed(6))))
    setNote(undefined)
    apply(next, gradeFieldText(next))
  }

  return (
    <FormField
      label={label}
      hideLabel={hideLabel}
      htmlFor={id}
      error={error}
      description={note && <span role="status">{note}</span>}
      descriptionId={`${id}-description`}
    >
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={-max}
        max={max}
        value={text ?? gradeFieldText(value, 2, fixedDecimals)}
        disabled={disabled}
        data-autofocus={autoFocus || undefined}
        className={inputClassName}
        onChange={(event) => {
          // Typing applies nothing until Enter or blur, so a half-typed grade never moves a PVI.
          setText(event.target.value)
          setNote(undefined)
          const grade = Number(event.target.value)
          setError(event.target.value.trim() && Number.isFinite(grade) && Math.abs(grade) > max ? range : undefined)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          stepBy(event.key === 'ArrowUp' ? 1 : -1)
        }}
      />
    </FormField>
  )
}
