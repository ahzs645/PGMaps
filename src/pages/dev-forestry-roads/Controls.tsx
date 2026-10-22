import { useState, type ReactNode } from 'react'

export const roadFieldClass =
  'w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-base md:text-xs'
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
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
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
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
    <Field label={label}>
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
