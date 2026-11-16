import type { ComponentProps } from 'react'
import { NumberField, OptionalNumberField } from './Controls'
import type { StationEntry } from './stationEntry'

/**
 * A station or range end stored as chainage and shown through the road's stationing
 * (`stationEntry.ts`): its station name on a road with a start station or equations, metres
 * otherwise. `label` is the field's name without a unit (`Assignment 1 start`), which takes
 * ` (station)` or ` (m)`; `keepLabel` shows it as given.
 */
export function StationField({
  entry,
  label,
  value,
  onChange,
  min,
  max,
  keepLabel = false,
  ...rest
}: Omit<ComponentProps<typeof NumberField>, 'onChange'> & {
  entry: StationEntry
  onChange: (chainage: number) => void
  keepLabel?: boolean
}) {
  return (
    <NumberField
      {...rest}
      label={keepLabel ? label : entry.label(label)}
      value={entry.show(value)}
      min={entry.limits?.min ?? min}
      max={entry.limits?.max ?? max}
      onChange={(typed) => {
        const chainage = entry.take(typed, value)
        if (chainage !== value) onChange(chainage)
      }}
    />
  )
}

/** {@link StationField} for an optional end (blank: the road's start or end). */
export function OptionalStationField({
  entry,
  label,
  value,
  onChange,
  min,
  max,
  keepLabel = false,
  ...rest
}: Omit<ComponentProps<typeof OptionalNumberField>, 'onChange'> & {
  entry: StationEntry
  onChange: (chainage: number | null) => void
  keepLabel?: boolean
}) {
  return (
    <OptionalNumberField
      {...rest}
      label={keepLabel ? label : entry.label(label)}
      value={value === null ? null : entry.show(value)}
      min={entry.limits?.min ?? min}
      max={entry.limits?.max ?? max}
      onChange={(typed) => {
        const chainage = typed === null ? null : entry.take(typed, value)
        if (chainage !== value) onChange(chainage)
      }}
    />
  )
}
