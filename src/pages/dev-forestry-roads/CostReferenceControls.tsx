import type { ReactNode } from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import { Field, RoadSelect } from './Controls'

export function ReferenceSelect({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  hint?: ReactNode
}) {
  return (
    <Field label={label} hint={hint}>
      <RoadSelect
        value={value}
        onValueChange={onChange}
        options={options}
        ariaLabel={label}
        className="h-auto min-h-8"
      />
    </Field>
  )
}

/** A block heading in the references dialog, with its explanation behind an (i). */
export function ReferenceHeading({ children, info }: { children: ReactNode; info?: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <h3 className="text-xs font-semibold text-foreground">{children}</h3>
      {info && <InfoTip label={`About ${typeof children === 'string' ? children : 'this section'}`}>{info}</InfoTip>}
    </div>
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
