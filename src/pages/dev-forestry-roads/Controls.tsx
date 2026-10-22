import { useState, type ReactNode } from 'react'

export const roadFieldClass =
  'w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-base md:text-xs'
export function Field({
  label,
  children,
  hideLabel = false,
}: {
  label: string
  children: ReactNode
  /** Keep the label for assistive technology only, e.g. inside a table cell under a column header. */
  hideLabel?: boolean
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
      {children}
    </label>
  )
}
export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 100000,
  step = 0.1,
  disabled = false,
  hideLabel = false,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  hideLabel?: boolean
}) {
  const [input, setInput] = useState({ value, text: String(Number(value.toFixed(6))) })
  const draft = input.value === value ? input.text : String(Number(value.toFixed(6)))
  const finish = () => {
    const n = Number(draft)
    if (draft.trim() && Number.isFinite(n)) {
      const bounded = Math.min(max, Math.max(min, n))
      onChange(bounded)
      setInput({ value: bounded, text: String(bounded) })
    } else setInput({ value, text: String(value) })
  }
  return (
    <Field label={label} hideLabel={hideLabel}>
      <input
        className={roadFieldClass}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          const valid = !!e.target.value.trim() && Number.isFinite(n) && n >= min && n <= max
          setInput({ value: valid ? n : value, text: e.target.value })
          if (valid) onChange(n)
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish()
        }}
      />
    </Field>
  )
}

/** A number that may be unset: an empty field is `null` ("not checked"), shown by the placeholder. */
export function OptionalNumberField({
  label,
  value,
  onChange,
  min = -100000,
  max = 100000,
  step = 0.1,
  placeholder = 'off',
  hideLabel = false,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  hideLabel?: boolean
}) {
  const shown = value === null ? '' : String(Number(value.toFixed(6)))
  const [input, setInput] = useState({ value, text: shown })
  const draft = input.value === value ? input.text : shown
  const finish = () => {
    if (!draft.trim()) {
      onChange(null)
      setInput({ value: null, text: '' })
      return
    }
    const n = Number(draft)
    if (Number.isFinite(n)) {
      const bounded = Math.min(max, Math.max(min, n))
      onChange(bounded)
      setInput({ value: bounded, text: String(bounded) })
    } else setInput({ value, text: shown })
  }
  return (
    <Field label={label} hideLabel={hideLabel}>
      <input
        className={roadFieldClass}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => {
          const text = e.target.value
          const n = Number(text)
          if (!text.trim()) {
            setInput({ value: null, text })
            onChange(null)
          } else if (Number.isFinite(n) && n >= min && n <= max) {
            setInput({ value: n, text })
            onChange(n)
          } else setInput({ value, text })
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish()
        }}
      />
    </Field>
  )
}
