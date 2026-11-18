import { Minus, Plus, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'

import { offsetPosition } from './driveMath'
import { offsetFrom } from './exifPose'
import type { FieldPhotoState, OwnPhoto } from './useFieldPhoto'

export type FineTuneStart = Pick<OwnPhoto, 'pose' | 'sources' | 'chosen'>
export type FineTuneStep = 'fine' | 'coarse'

function Stepper({ label, value, onStep }: { label: string; value: string; onStep: (direction: number) => void }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-1 rounded-md border border-border px-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 touch:size-10"
        aria-label={`Decrease ${label.toLowerCase()}`}
        onClick={() => onStep(-1)}
      >
        <Minus className="size-3.5" />
      </Button>
      <div className="text-center text-xs">
        <div>{label}</div>
        <div className="whitespace-nowrap text-2xs text-muted-foreground tabular-nums">{value}</div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 touch:size-10"
        aria-label={`Increase ${label.toLowerCase()}`}
        onClick={() => onStep(1)}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  )
}

const limit = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))

export function PhotoFineTune({
  own,
  photo,
  start,
  step,
  onStep,
}: {
  own: OwnPhoto
  photo: FieldPhotoState
  start: FineTuneStart
  step: FineTuneStep
  onStep: (step: FineTuneStep) => void
}) {
  const { lng, lat, bearing, pitch, roll, hfov, altitudeMeters, eyeHeightMeters } = own.pose
  const { lng: startLng, lat: startLat } = start.pose
  const coarse = step === 'coarse'
  const angle = coarse ? 2 : 0.25
  const lens = coarse ? 2 : 0.5
  const distance = coarse ? 25 : 5
  const height = altitudeMeters == null ? (coarse ? 1 : 0.2) : coarse ? 20 : 5
  const from = lng != null && lat != null && Math.abs(lat) < 89 ? { lng, lat } : null
  const offset =
    from && startLng != null && startLat != null ? offsetFrom({ lng: startLng, lat: startLat }, from) : null
  const move = (east: number, north: number) => {
    if (!from) return
    const next = offsetPosition(from, { east, north })
    const wrapped = ((next.lng + 540) % 360) - 180
    photo.setOwnPose({ lng: wrapped, lat: next.lat })
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-2" aria-label="Fine-tune camera">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl<FineTuneStep>
          label="Adjustment step"
          size="sm"
          fullWidth={false}
          value={step}
          onChange={onStep}
          options={[
            { value: 'fine', label: 'Fine' },
            { value: 'coarse', label: 'Coarse' },
          ]}
        />
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="touch:h-10"
          onClick={() => photo.restoreCamera(own.id, start)}
        >
          <RotateCcw className="size-3.5" />
          Restore starting camera
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Stepper
          label="Heading"
          value={`${bearing.toFixed(2)}°`}
          onStep={(sign) => photo.setOwnPose({ bearing: bearing + sign * angle })}
        />
        <Stepper
          label="Pitch"
          value={`${pitch.toFixed(2)}°`}
          onStep={(sign) => photo.setOwnPose({ pitch: limit(pitch + sign * angle, -90, 90) })}
        />
        <Stepper
          label="Roll"
          value={`${roll.toFixed(2)}°`}
          onStep={(sign) => photo.setOwnPose({ roll: limit(roll + sign * angle, -90, 90) })}
        />
        <Stepper
          label="Field of view"
          value={`${hfov.toFixed(2)}°`}
          onStep={(sign) => photo.setOwnPose({ hfov: hfov + sign * lens })}
        />
      </div>
      <details>
        <summary className="cursor-pointer py-1 text-xs font-medium">Move the camera</summary>
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {offset && (
            <>
              <Stepper
                label="East"
                value={`${Math.round(offset.east)} m`}
                onStep={(sign) => move(sign * distance, 0)}
              />
              <Stepper
                label="North"
                value={`${Math.round(offset.north)} m`}
                onStep={(sign) => move(0, sign * distance)}
              />
            </>
          )}
          <Stepper
            label={altitudeMeters == null ? 'Eye height' : 'Altitude'}
            value={`${(altitudeMeters ?? eyeHeightMeters).toFixed(1)} m`}
            onStep={(sign) =>
              photo.setOwnPose(
                altitudeMeters == null
                  ? { eyeHeightMeters: limit(eyeHeightMeters + sign * height, 0.3, 100) }
                  : { altitudeMeters: limit(altitudeMeters + sign * height, -500, 9000) },
              )
            }
          />
        </div>
      </details>
    </div>
  )
}
