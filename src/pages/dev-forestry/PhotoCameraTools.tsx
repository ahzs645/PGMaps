/**
 * The own photo's camera tools, as the sections of its dialog (`OwnPhotoDialog`). They need no road view, so they
 * work for a photo taken far from the scene's road: the all-headings skyline search, angles held near a value
 * (priors) with a landmark picked at the photo's centre, points paired in the photo and on the plan, and two checks
 * of any camera: the map drawn from the camera, and the photo laid on the plan.
 * `docs/forestry-visual-quality.md`, "A photo of your own".
 */
import { Crosshair, Loader2, Map as MapIcon, Mountain, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import type { CameraPriors, FieldPhotoState } from './useFieldPhoto'
import type { SunCheck } from './wideOrientation'

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

const sunText = (sun: SunCheck) =>
  sun.elevation < 0
    ? 'the sun was below the horizon'
    : sun.inFrame && sun.pixel
      ? `the sun (${Math.round(sun.elevation)}° up) should be in the frame, where the photo marks it`
      : Math.abs(sun.relativeBearing) > 90
        ? `the sun (${Math.round(sun.elevation)}° up) was behind the camera, ${Math.round(Math.abs(sun.relativeBearing))}° to the ${sun.relativeBearing < 0 ? 'left' : 'right'}`
        : `the sun (${Math.round(sun.elevation)}° up) was ${Math.round(Math.abs(sun.relativeBearing))}° ${sun.relativeBearing < 0 ? 'left' : 'right'} of the view's centre, out of frame`

/** The all-headings camera search: heading, pitch and roll from the photo's skyline, with what to check. */
export function SkylineSearch({ photo }: { photo: FieldPhotoState }) {
  const search = photo.cameraSearch
  const working = search.status === 'working'
  return (
    <div className="space-y-2" data-testid="camera-search">
      <p className={NOTE}>
        Reads the photo’s skyline and tries every heading against the terrain 90 km round, with pitch and roll. It needs
        open sky over distant ground; with trees or cloud on the horizon, pair points instead.
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
                : `Searching every heading… ${Math.round(search.done * 100)}%`
            : search.status === 'done'
              ? 'Search again'
              : 'Search every heading'}
        </Button>
        {working && (
          <Button type="button" variant="ghost" size="sm" className="touch:h-10" onClick={photo.cancelCameraSearch}>
            Cancel
          </Button>
        )}
      </div>
      {search.status === 'done' && (
        <div className="space-y-1.5 text-xs leading-5" role="status">
          <p className={search.result.trustworthy ? 'text-foreground' : 'font-medium text-destructive'}>
            {search.result.trustworthy
              ? 'Found: '
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
          {search.sun && <p className="text-muted-foreground">For this camera, {sunText(search.sun.best)}.</p>}
          {search.result.runnerUp && (
            <p className="text-muted-foreground">
              Next best: heading {Math.round(search.result.runnerUp.bearing)}°
              {search.sun?.runnerUp ? `, where ${sunText(search.sun.runnerUp)}` : ''}.{' '}
              <button type="button" className="underline" onClick={photo.tryRunnerUp}>
                Try it
              </button>
            </p>
          )}
          <p className="text-muted-foreground">
            Check before trusting it: the yellow skyline on the photo should sit on the ridgeline, and the sun where the
            light comes from. A bright sky, a backlit hillside or shadows can tell two headings apart.
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

/** Whether a solve from paired points gave a camera that is probably mis-paired. */
export const solveLooksWrong = (solve: NonNullable<FieldPhotoState['controlSolve']>) =>
  Math.abs(solve.pose.roll) > 30 ||
  Math.hypot(solve.shift.east, solve.shift.north) > 150 ||
  Math.abs(solve.shift.up) > 100

/**
 * Points paired in the photo and on the plan, and the camera solved from them. A spot is placed by clicking the
 * photo beside this section (`PhotoStage`), which then asks the plan for the same spot.
 */
export function PairedPoints({ photo }: { photo: FieldPhotoState }) {
  const solve = photo.controlSolve
  const rows = new Map(solve?.pairs.map((row) => [row.id, row]))
  return (
    <div className="space-y-2" aria-label="Pair points">
      <p className={NOTE}>
        Click a spot in the photo, then the same spot on the plan: a road bend, a pond, a block corner. With{' '}
        {photo.pairsNeeded} or more the camera is solved from them alone, not from the skyline; 4–6 spread over the
        photo give each one’s error with the camera solved without it.
      </p>
      {photo.pendingPixel && (
        <p className="text-xs text-warning">
          The spot marked “?” is not paired yet: click it in the photo again, then click the plan.
        </p>
      )}
      {photo.pairs.length > 0 ? (
        <ol className="divide-y divide-border/70 rounded-md border border-border text-xs">
          {photo.pairs.map((pair, i) => {
            const row = rows.get(pair.id)
            return (
              <li key={pair.id} className="flex items-center gap-2 px-2 py-1.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-2xs font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {row
                    ? `fits ${row.fittedPx.toFixed(1)} px${row.heldOutPx !== null ? `; held out ${row.heldOutPx.toFixed(1)} px ≈ ${Math.round(row.heldOutPx * row.metresPerPx)} m` : ''}`
                    : `${pair.elevation.toFixed(0)} m above sea level`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove point ${i + 1}`}
                  onClick={() => photo.removePair(pair.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
          No points yet. Click a spot in the photo to start.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="touch:h-10"
          disabled={photo.pairs.length < photo.pairsNeeded || !!photo.toolsBusy}
          onClick={() => void photo.solveFromPoints()}
        >
          Solve from {photo.pairs.length} point{photo.pairs.length === 1 ? '' : 's'}
        </Button>
        {photo.pairs.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="touch:h-10" onClick={photo.clearPairs}>
            <Trash2 className="h-4 w-4" />
            Clear the points
          </Button>
        )}
      </div>
      {solve && solveLooksWrong(solve) && (
        <InlineAlert tone="warning">
          This camera looks wrong: it rolls {Math.round(solve.pose.roll)}° or moved far from the photo’s GPS. Check that
          each pair is the same spot in the photo and on the plan, and remove any that are not.
        </InlineAlert>
      )}
      {solve && (
        <p className="text-xs leading-5 text-foreground" role="status">
          Solved from {solve.pairs.length} points
          {solve.start === 'closed-form' ? ' (started from the points alone)' : ''}: heading{' '}
          {solve.pose.bearing.toFixed(1)}°, pitch {solve.pose.pitch.toFixed(1)}°, roll {solve.pose.roll.toFixed(1)}°;
          moved {Math.round(Math.hypot(solve.shift.east, solve.shift.north))} m across and {Math.round(solve.shift.up)}{' '}
          m up;
          {` ${solve.rmsPx.toFixed(1)} px RMS`}
          {solve.heldOutMetresMax !== null
            ? `; worst point held out ${Math.round(solve.heldOutMetresMax)} m on the ground.`
            : '. Add points to measure each one held out.'}
        </p>
      )}
    </div>
  )
}

/** Checks of the photo's camera, and of the search's runner-up, that do not rely on the skyline. */
export function CameraChecks({
  photo,
  onShownOnPlan,
}: {
  photo: FieldPhotoState
  /** Called once the photo is laid on the plan, so the dialog can step aside and show it. */
  onShownOnPlan: () => void
}) {
  const runnerUp = photo.cameraSearch.status === 'done' ? photo.cameraSearch.result.runnerUp : null
  const own = photo.own!
  const drape = photo.photoDrape
  const candidates: Array<{ which: 'camera' | 'runner-up'; label: string }> = [
    { which: 'camera', label: `This camera (${own.pose.bearing.toFixed(0)}°)` },
    ...(runnerUp ? [{ which: 'runner-up' as const, label: `The runner-up (${runnerUp.bearing.toFixed(0)}°)` }] : []),
  ]
  const views = (['camera', 'runner-up'] as const).flatMap((which) => {
    const view = photo.modelViews[which]
    return view ? [{ which, view }] : []
  })
  return (
    <div className="space-y-4" aria-label="Check a camera">
      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Model view</h4>
        <p className={NOTE}>
          Draws satellite imagery as the camera would see it, to hold beside the photo: roads, openings and lakes should
          fall in the same places. It needs no skyline.
        </p>
        <div className="flex flex-wrap gap-2">
          {candidates.map((candidate) => (
            <Button
              key={candidate.which}
              type="button"
              variant="outline"
              size="sm"
              className="touch:h-10"
              disabled={!!photo.toolsBusy}
              aria-label={`Model view: ${candidate.label.toLowerCase()}`}
              onClick={() => void photo.renderModel(candidate.which)}
            >
              <Mountain className="h-4 w-4" />
              {candidate.label}
            </Button>
          ))}
        </div>
        {views.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <figure>
              <img src={own.src} alt="Your photo" className="w-full rounded-sm" />
              <figcaption className="mt-1 text-2xs text-muted-foreground">Photo</figcaption>
            </figure>
            {views.map(({ which, view }) => (
              <figure key={which}>
                <img
                  src={view.url}
                  alt={`Model view at heading ${view.bearing.toFixed(0)}°`}
                  className="w-full rounded-sm"
                />
                <figcaption className="mt-1 text-2xs text-muted-foreground">
                  Heading {view.bearing.toFixed(0)}° · agreement {view.score.toFixed(2)}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        {views.length > 0 && (
          <p className={NOTE}>
            Agreement correlates the photo with a model view over the ground, in brightness and in edges. Higher is
            better; it is evidence beside the skyline and the sun, not a verdict.
          </p>
        )}
      </section>
      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Photo on the plan</h4>
        <p className={NOTE}>
          Lays the photo on the plan as this camera saw the ground. A right camera puts its roads, openings and lakes on
          the imagery’s; a wrong one puts them elsewhere, or spreads sky over the ground. This window steps aside to
          show the plan; come back with <em>Open the camera</em> in the sidebar.
        </p>
        <div className="flex flex-wrap gap-2">
          {candidates.map((candidate) => (
            <Button
              key={candidate.which}
              type="button"
              variant="outline"
              size="sm"
              className="touch:h-10"
              disabled={!!photo.toolsBusy}
              aria-label={`Photo on the plan: ${candidate.label.toLowerCase()}`}
              onClick={() => void photo.showOnMap(candidate.which).then((shown) => shown && onShownOnPlan())}
            >
              <MapIcon className="h-4 w-4" />
              {candidate.label}
            </Button>
          ))}
          {drape && (
            <Button type="button" variant="ghost" size="sm" className="touch:h-10" onClick={photo.hideDrape}>
              Take it off the plan
            </Button>
          )}
        </div>
        {drape && (
          <p className={NOTE}>
            The photo at heading {drape.bearing.toFixed(0)}° is on the plan; the camera sees{' '}
            {Math.round(drape.seenShare * 100)}% of the ground in its frame (terrain only).
          </p>
        )}
      </section>
    </div>
  )
}
