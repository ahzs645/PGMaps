import { AppSelect } from '@/components/ui/select'
import { Field } from './Controls'

export function ReferenceSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <AppSelect
        value={value}
        onValueChange={onChange}
        options={options}
        triggerAriaLabel={label}
        triggerClassName="h-auto min-h-9 text-xs"
        contentClassName="z-[1500] text-xs"
      />
    </Field>
  )
}

export function ReferenceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
      {children}
    </a>
  )
}

export const referenceMoney = (value: number) => '$' + value.toLocaleString('en-CA', { maximumFractionDigits: 0 })
