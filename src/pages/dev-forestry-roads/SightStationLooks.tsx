import { formatRoadStation } from './Charts'
import type { StationSightView } from './sightDistance'
import { blockingText } from './sightPresentation'

const m = (value: number | null) => (value === null ? '—' : Math.round(value).toLocaleString('en-CA'))

/** The selected station's two looks in words: what each sees, and what blocks the line to the distance needed. */
export function SightStationLooks({ view }: { view: StationSightView }) {
  if (view.status !== 'checked' || !view.looks.length) return null
  return (
    <div className="space-y-1 text-2xs" data-testid="road-sight-station">
      <p className="font-medium">At {formatRoadStation(view.chainage)}</p>
      {view.looks.map((look) => {
        const { eye } = look
        const blocking = look.needed?.trace.state !== 'clear' ? look.needed?.blocking : null
        const sees =
          eye.limitedBy === 'clear'
            ? `sees the ${m(eye.requiredM)} m needed`
            : eye.limitedBy === 'unknown'
              ? `unknown past ${m(eye.availableM)} m (missing terrain)`
              : eye.limitedBy === 'road-end'
                ? `${m(eye.availableM)} m to the road end, of ${m(eye.requiredM)} m needed (not judged)`
                : `sees ${m(eye.availableM)} of ${m(eye.requiredM)} m`
        return (
          <p
            key={eye.direction}
            data-testid="road-sight-look"
            data-direction={eye.direction}
            data-state={eye.limitedBy}
            className={eye.limitedBy === 'surface' || eye.limitedBy === 'vegetation' ? 'text-destructive' : undefined}
          >
            Looking {eye.direction}: {sees}.{blocking ? ` ${blockingText(blocking)}` : ''}
          </p>
        )
      })}
    </div>
  )
}
