/**
 * The own photo's hand tools, behind *Adjust* in its window (`OwnPhotoDialog`): angles held near a value (priors) with
 * a landmark picked at the photo's centre, and the skyline search run again, every heading or near the camera as it
 * stands (after a drag-to-align). They need no road view, so they work for a photo taken far from the scene's road.
 * Paired points are `PairedPointsTable`; the checks of a camera are the comparison (`PhotoCompare`) and the photo on
 * the plan. `docs/forestry-visual-quality.md`, "A photo of your own".
 */
import { Crosshair, Loader2, Mountain, Target } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { CameraPriors, FieldPhotoState } from './useFieldPhoto'
import { sunNote } from './photoOptions'

/** Asks the plan for one click while the dialog steps aside; `hint` is what the plan's banner says. */
export type StartPlanPick = (onPoint: (point: [number, number]) => void, hint: string) => void

type Angle = keyof CameraPriors
const ANGLES: Array<{ key: Angle; label: string; tolerance: number }> = [
  { key: 'heading', label: 'Heading', tolerance: 20 },
  { key: 'pitch', label: 'Pitch', tolerance: 5 },
  { key: 'roll', label: 'Roll', tolerance: 5 },
]
const inputClass =
  'h-8 w-20 rounded-md border border-input bg-background px-2 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-ring touch:h-10'
const NOTE = 'text-xs leading-5 text-muted-foreground'

/** How many angles are held, for the section's summary. */
export const heldAngleCount = (priors: CameraPriors) => ANGLES.filter(({ key }) => priors[key]).length

/** Angles held near a value within a tolerance; a landmark at the photo's centre sets heading and pitch. */
export function HeldAngles({ photo, onPick }: { photo: FieldPhotoState; onPick?: StartPlanPick }) {
  const own = photo.own!
  const set = (key: Angle, patch: { value?: number; tolerance?: number } | null) =>
    photo.setPriors((current) => {
      const next = { ...current }
      if (!patch) delete next[key]
      else {
        const start = key === 'heading' ? own.pose.bearing : key === 'pitch' ? own.pose.pitch : own.pose.roll
        next[key] = {
          value: patch.value ?? current[key]?.value ?? start,
          tolerance: patch.tolerance ?? current[key]?.tolerance ?? ANGLES.find((a) => a.key === key)!.tolerance,
        }
      }
      return next
    })
  return (
    <div className="space-y-2" aria-label="Hold angles near a value">
      <p className={NOTE}>
        Hold an angle when you know it roughly: the flight track, the tilt sensor, a landmark. The search and the point
        solve both keep it within the tolerance; a free angle is searched in full.
      </p>
      {ANGLES.map(({ key, label }) => {
        const prior = photo.priors[key]
        return (
          <div key={key} className="flex min-h-8 items-center gap-2 text-xs">
            <label className="flex w-24 items-center gap-1.5">
              <input
                type="checkbox"
                checked={!!prior}
                aria-label={`Hold ${label.toLowerCase()} near a value`}
                onChange={(event) => set(key, event.target.checked ? {} : null)}
              />
              {label}
            </label>
            {prior ? (
              <>
                <input
                  className={inputClass}
                  type="number"
                  step={0.5}
                  aria-label={`${label} to hold near, degrees`}
                  value={Math.round(prior.value * 10) / 10}
                  onChange={(event) =>
                    Number.isFinite(event.target.valueAsNumber) && set(key, { value: event.target.valueAsNumber })
                  }
                />
                <span>±</span>
                <input
                  className={inputClass}
                  type="number"
                  step={1}
                  min={0}
                  aria-label={`${label} tolerance, degrees`}
                  value={prior.tolerance}
                  onChange={(event) =>
                    Number.isFinite(event.target.valueAsNumber) &&
                    set(key, { tolerance: Math.max(0, event.target.valueAsNumber) })
                  }
                />
                <span className="text-muted-foreground">°</span>
              </>
            ) : (
              <span className="text-muted-foreground">free</span>
            )}
          </div>
        )
      })}
      {onPick && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-10"
          onClick={() =>
            onPick(
              ([lng, lat]) => void photo.pickLandmark(lng, lat),
              'Click the spot on the plan that sits at the centre of the photo',
            )
          }
        >
          <Crosshair className="h-4 w-4" />
          Pick the spot at the photo’s centre on the plan
        </Button>
      )}
      {photo.landmark && (
        <p className={NOTE}>
          Centre spot {(photo.landmark.distanceMeters / 1000).toFixed(1)} km away: heading{' '}
          {photo.landmark.bearing.toFixed(1)}°, pitch {photo.landmark.pitch.toFixed(1)}°, now held within the tolerances
          above.
        </p>
      )}
    </div>
  )
}

/** How closely *Search near this camera* holds each angle round the camera as it stands, degrees. */
export const NEAR_SEARCH_TOLERANCE = { heading: 10, pitch: 4, roll: 4 } as const

/**
 * The skyline search run again by hand: every heading, or near the camera as it stands, which is how a drag-to-align
 * hands over to the search. Its result joins the options card; the queue already ran it once for each photo.
 */
export function SkylineSearch({ photo }: { photo: FieldPhotoState }) {
  const search = photo.cameraSearch
  const working = search.status === 'working'
  const own = photo.own
  const held = heldAngleCount(photo.priors)
  return (
    <div className="space-y-2" data-testid="camera-search">
      <p className={NOTE}>
        Reads the photo’s skyline and tries every heading against the terrain 90 km round, with pitch and roll
        {held ? `, keeping ${held} held angle${held === 1 ? '' : 's'} near their values` : ''}. It needs open sky over
        distant ground; with trees or cloud on the horizon, pair points instead.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="touch:h-10"
          disabled={working}
          onClick={() => void photo.findCamera()}
        >
          {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mountain className="h-4 w-4" />}
          {working
            ? search.stage === 'terrain'
              ? `Loading terrain…${search.tiles ? ` ${search.tiles.loaded}/${search.tiles.total} tiles` : ''}`
              : search.stage === 'photo'
                ? 'Reading the skyline…'
                : `Searching… ${Math.round(search.done * 100)}%`
            : held
              ? 'Search with the held angles'
              : 'Search every heading'}
        </Button>
        {own && !working && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            onClick={() =>
              void photo.findCamera({
                heading: { value: own.pose.bearing, tolerance: NEAR_SEARCH_TOLERANCE.heading },
                pitch: { value: own.pose.pitch, tolerance: NEAR_SEARCH_TOLERANCE.pitch },
                roll: { value: own.pose.roll, tolerance: NEAR_SEARCH_TOLERANCE.roll },
              })
            }
          >
            <Target className="h-4 w-4" />
            Search near this camera
          </Button>
        )}
        {working && (
          <Button type="button" variant="ghost" size="sm" className="touch:h-10" onClick={photo.cancelCameraSearch}>
            Cancel
          </Button>
        )}
      </div>
      {search.status === 'done' && (
        <div className="space-y-1 text-xs leading-5" role="status">
          <p className={search.result.trustworthy ? 'text-foreground' : 'font-medium text-warning-foreground'}>
            {search.result.trustworthy
              ? 'Fitted to the skyline: '
              : search.result.ambiguous
                ? 'Not settled — another heading fits about as well: '
                : 'Best fit, not trustworthy: '}
            heading {search.result.bearing.toFixed(1)}°, pitch {search.result.pitch.toFixed(1)}°, roll{' '}
            {search.result.roll.toFixed(1)}°. {search.result.fit.agreeing} sky columns across{' '}
            {Math.round(search.result.fit.span * 100)}% of the frame; {Math.round(search.result.fit.agreement * 100)}%
            agree.{' '}
            {search.recordedOffBy !== null &&
              `The phone's heading was ${Math.round(Math.abs(search.recordedOffBy))}° out. `}
            Searched in {search.seconds.toFixed(0)} s.
          </p>
          {search.sun && <p className="text-muted-foreground">Sun for this camera: {sunNote(search.sun.best)}.</p>}
          <p className="text-muted-foreground">
            Every candidate is in the options card. Check before trusting one: the skyline on the photo should sit on
            the ridgeline, and the sun where the light comes from.
          </p>
        </div>
      )}
      {search.status === 'failed' && (
        <p className="text-xs leading-5 text-foreground" role="status">
          {search.message}
        </p>
      )}
    </div>
  )
}
