import { useState } from 'react'
import { OptionalNumberField } from './Controls'
import type { Coordinate } from './types'

/** A coordinate stays unknown until both ordinates are supplied; partial entry never invents zero. */
export function PlanningCoordinateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: Coordinate | null
  onChange: (value: Coordinate | null) => void
}) {
  const [draft, setDraft] = useState({ base: value, longitude: value?.[0] ?? null, latitude: value?.[1] ?? null })
  if (draft.base !== value) setDraft({ base: value, longitude: value?.[0] ?? null, latitude: value?.[1] ?? null })
  const current =
    draft.base === value ? draft : { base: value, longitude: value?.[0] ?? null, latitude: value?.[1] ?? null }
  const change = (key: 'longitude' | 'latitude', number: number | null) => {
    const next = { ...current, [key]: number }
    const coordinate: Coordinate | null =
      next.longitude === null || next.latitude === null ? null : [next.longitude, next.latitude]
    setDraft({ ...next, base: coordinate })
    onChange(coordinate)
  }
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <OptionalNumberField
        label={`${label} longitude`}
        value={current.longitude}
        min={-180}
        max={180}
        step={0.0001}
        placeholder="unknown"
        onChange={(n) => change('longitude', n)}
      />
      <OptionalNumberField
        label={`${label} latitude`}
        value={current.latitude}
        min={-84.999999}
        max={84.999999}
        step={0.0001}
        placeholder="unknown"
        onChange={(n) => change('latitude', n)}
      />
    </div>
  )
}
