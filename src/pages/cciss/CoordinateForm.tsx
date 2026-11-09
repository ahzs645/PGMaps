import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, FormField } from '@/components/ui/form-field'

export type LngLat = [number, number]

/** `[longitude, latitude]` from typed text, or `null` when either is blank, not a number or out of range. */
export function parseLngLat(longitude: string, latitude: string): LngLat | null {
  const point: LngLat = [Number(longitude), Number(latitude)]
  if (!longitude.trim() || !latitude.trim() || !point.every(Number.isFinite)) return null
  return Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90 ? null : point
}

/**
 * Typed longitude and latitude with a submit button. `onSubmit` gets the parsed point, or `null`
 * with the raw numbers when the entry is invalid; the caller says what that means.
 */
export function CoordinateForm({
  initial,
  longitudeLabel = 'Longitude',
  latitudeLabel = 'Latitude',
  submitLabel,
  submitVariant = 'default',
  onSubmit,
  children,
}: {
  initial?: LngLat
  longitudeLabel?: string
  latitudeLabel?: string
  submitLabel: string
  submitVariant?: 'default' | 'outline'
  onSubmit: (point: LngLat | null, raw: LngLat) => void
  /** Help and messages under the fields. */
  children?: ReactNode
}) {
  const [longitude, setLongitude] = useState(initial ? String(initial[0]) : '')
  const [latitude, setLatitude] = useState(initial ? String(initial[1]) : '')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(parseLngLat(longitude, latitude), [Number(longitude), Number(latitude)])
      }}
    >
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <FormField label={longitudeLabel}>
          <input
            className={FORM_INPUT_CLASS}
            inputMode="decimal"
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
          />
        </FormField>
        <FormField label={latitudeLabel}>
          <input
            className={FORM_INPUT_CLASS}
            inputMode="decimal"
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
          />
        </FormField>
        <Button type="submit" variant={submitVariant}>
          {submitLabel}
        </Button>
      </div>
      {children}
    </form>
  )
}
