/**
 * The own photo's camera tools, beside its pose fields and independent of the road view (so they work for a photo
 * taken far from the scene's road): the all-headings skyline search, angles held near a value (priors), a landmark
 * picked at the photo's centre, points paired in the photo and on the plan, and two checks of any camera: the photo
 * laid on the plan, and the map drawn from the camera. `docs/forestry-visual-quality.md`, "Field photo".
 */
import { useState, type MouseEvent } from 'react'
import { Crosshair, Loader2, Map as MapIcon, Mountain, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import type { OwnPhotoActions } from './OwnFieldPhoto'
import type { CameraPriors, FieldPhotoState } from './useFieldPhoto'
import type { SunCheck } from './wideOrientation'

type PickPoint = OwnPhotoActions['onPickPoint']
type Angle = keyof CameraPriors
const ANGLES: Array<{ key: Angle; label: string; tolerance: number }> = [
  { key: 'heading', label: 'Heading', tolerance: 20 },
  { key: 'pitch', label: 'Pitch', tolerance: 5 },
  { key: 'roll', label: 'Roll', tolerance: 5 },
]
const inputClass =
  'h-7 w-16 rounded-md border border-input bg-background px-1.5 text-2xs tabular-nums focus:outline-none focus:ring-1 focus:ring-ring touch:h-10'

export function PhotoCameraTools({
  photo,
  onPickPoint,
  pickActive,
}: {
  photo: FieldPhotoState
  onPickPoint?: PickPoint
  pickActive?: boolean
}) {
  const own = photo.own
  if (!own || own.pose.lng === null || own.pose.lat === null) return null
  return (
    <div
      className="space-y-3 rounded-md border border-border p-2"
      aria-label="Find this photo's camera"
      data-testid="photo-camera-tools"
    >
      <p className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">Find the camera</p>
      <PriorsPanel photo={photo} onPickPoint={onPickPoint} pickActive={pickActive} />
      <CameraSearchPanel photo={photo} />
      <PairsPanel photo={photo} onPickPoint={onPickPoint} pickActive={pickActive} />
      <ChecksPanel photo={photo} />
      {photo.toolsBusy && (
        <p className="flex items-center gap-1 text-3xs text-muted-foreground" role="status">
          <Loader2 className="h-3 w-3 animate-spin" />
          {photo.toolsBusy}
        </p>
      )}
      {photo.toolsError && <InlineAlert tone="warning">{photo.toolsError}</InlineAlert>}
    </div>
  )
}

/** Angles held near a value within a tolerance; a landmark at the photo's centre sets heading and pitch. */
function PriorsPanel({
  photo,
  onPickPoint,
  pickActive,
}: {
  photo: FieldPhotoState
  onPickPoint?: PickPoint
  pickActive?: boolean
}) {
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
    <div className="space-y-1.5" aria-label="Hold angles near a value">
      <p className="text-3xs leading-4 text-muted-foreground">
        Hold an angle near a value when you know it roughly (the flight track, the tilt sensor, a landmark). Both the
        search and the point solve keep it within the tolerance; free angles are searched in full.
      </p>
      {ANGLES.map(({ key, label }) => {
        const prior = photo.priors[key]
        return (
          <div key={key} className="flex items-center gap-1.5 text-2xs">
            <label className="flex w-24 items-center gap-1">
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
      {onPickPoint && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="w-full text-2xs touch:h-10"
          aria-pressed={pickActive}
          onClick={() => onPickPoint(pickActive ? null : ([lng, lat]) => void photo.pickLandmark(lng, lat))}
        >
          <Crosshair className="h-3.5 w-3.5" />
          {pickActive ? 'Click the plan…' : 'Pick the spot at the photo’s centre on the plan'}
        </Button>
      )}
      {photo.landmark && (
        <p className="text-3xs leading-4 text-muted-foreground">
          Centre spot {(photo.landmark.distanceMeters / 1000).toFixed(1)} km away: heading{' '}
          {photo.landmark.bearing.toFixed(1)}°, pitch {photo.landmark.pitch.toFixed(1)}°, now held within the tolerances
          above.
        </p>
      )}
    </div>
  )
}

/** Points paired in the photo and on the plan, and the camera solved from them. */
function PairsPanel({
  photo,
  onPickPoint,
  pickActive,
}: {
  photo: FieldPhotoState
  onPickPoint?: PickPoint
  pickActive?: boolean
}) {
  const own = photo.own!
  const solve = photo.controlSolve
  const [expanded, setExpanded] = useState(false)
  const clickPhoto = (event: MouseEvent<HTMLImageElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const pixel: [number, number] = [
      ((event.clientX - box.left) / box.width) * own.width,
      ((event.clientY - box.top) / box.height) * own.height,
    ]
    photo.setPendingPixel(pixel)
    onPickPoint?.(([lng, lat]) => void photo.addPair(pixel, lng, lat))
  }
  const rows = new Map(solve?.pairs.map((row) => [row.id, row]))
  return (
    <div className="space-y-1.5" aria-label="Pair points">
      <p className="text-3xs leading-4 text-muted-foreground">
        Or pair points: click a spot in the photo, then the same spot on the plan (a road bend, a pond, a block corner).
        With {photo.pairsNeeded} or more the camera is solved from them alone, not from the skyline; 4–6 spread over the
        photo give each one's error with the camera solved without it.
      </p>
      <div className="relative">
        <img
          src={own.src}
          alt="Your photo: click a spot to pair it with the plan"
          className={
            expanded
              ? 'w-full cursor-crosshair rounded-sm'
              : 'max-h-56 w-full cursor-crosshair rounded-sm object-contain'
          }
          onClick={clickPhoto}
          draggable={false}
        />
        {[
          ...photo.pairs.map((pair, i) => ({ id: pair.id, pixel: pair.pixel, label: String(i + 1), pending: false })),
          ...(photo.pendingPixel ? [{ id: 'pending', pixel: photo.pendingPixel, label: '?', pending: true }] : []),
        ].map((mark) => (
          <span
            key={mark.id}
            className={
              'pointer-events-none absolute flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white text-3xs font-bold text-white ' +
              (mark.pending ? 'bg-warning' : 'bg-primary')
            }
            style={{ left: `${(mark.pixel[0] / own.width) * 100}%`, top: `${(mark.pixel[1] / own.height) * 100}%` }}
          >
            {mark.label}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="xs" className="text-2xs" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Smaller photo' : 'Larger photo'}
        </Button>
        {photo.pendingPixel && (
          <span className="text-3xs text-warning">
            {pickActive ? 'Now click the same spot on the plan…' : 'Point placed; click the plan to pair it.'}
          </span>
        )}
      </div>
      {photo.pairs.length > 0 && (
        <ol className="space-y-0.5 text-3xs">
          {photo.pairs.map((pair, i) => {
            const row = rows.get(pair.id)
            return (
              <li key={pair.id} className="flex items-center gap-1.5">
                <span className="w-4 font-semibold">{i + 1}</span>
                <span className="flex-1 text-muted-foreground">
                  {row
                    ? `fits ${row.fittedPx.toFixed(1)} px${row.heldOutPx !== null ? `; held out ${row.heldOutPx.toFixed(1)} px ≈ ${Math.round(row.heldOutPx * row.metresPerPx)} m` : ''}`
                    : `${pair.elevation.toFixed(0)} m above sea level`}
                </span>
                <button type="button" aria-label={`Remove point ${i + 1}`} onClick={() => photo.removePair(pair.id)}>
                  <X className="h-3 w-3" />
                </button>
              </li>
            )
          })}
        </ol>
      )}
      <div className="flex gap-1">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="flex-1 text-2xs touch:h-10"
          disabled={photo.pairs.length < photo.pairsNeeded || !!photo.toolsBusy}
          onClick={() => void photo.solveFromPoints()}
        >
          Solve from {photo.pairs.length} point{photo.pairs.length === 1 ? '' : 's'}
        </Button>
        {photo.pairs.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-2xs"
            aria-label="Clear the points"
            onClick={photo.clearPairs}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {solve &&
        (Math.abs(solve.pose.roll) > 30 ||
          Math.hypot(solve.shift.east, solve.shift.north) > 150 ||
          Math.abs(solve.shift.up) > 100) && (
          <InlineAlert tone="warning">
            This camera looks wrong: it rolls {Math.round(solve.pose.roll)}° or moved far from the photo's GPS. Check
            that each pair is the same spot in the photo and on the plan, and remove any that are not.
          </InlineAlert>
        )}
      {solve && (
        <p className="text-3xs leading-4 text-foreground" role="status">
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
function ChecksPanel({ photo }: { photo: FieldPhotoState }) {
  const runnerUp = photo.cameraSearch.status === 'done' ? photo.cameraSearch.result.runnerUp : null
  const own = photo.own!
  const drape = photo.photoDrape
  const candidates: Array<{ which: 'camera' | 'runner-up'; label: string }> = [
    { which: 'camera', label: `this camera (${own.pose.bearing.toFixed(0)}°)` },
    ...(runnerUp ? [{ which: 'runner-up' as const, label: `the runner-up (${runnerUp.bearing.toFixed(0)}°)` }] : []),
  ]
  return (
    <div className="space-y-1.5" aria-label="Check a camera">
      <p className="text-3xs leading-4 text-muted-foreground">
        Check a camera without the skyline. On the plan, its photo should put roads, openings and lakes on the
        imagery's; sky spread over ground means the camera is wrong. The model view draws the imagery as the camera
        would see it.
      </p>
      <div className="flex flex-wrap gap-1">
        {candidates.map((candidate) => (
          <Button
            key={`map-${candidate.which}`}
            type="button"
            variant={drape?.which === candidate.which ? 'default' : 'outline'}
            size="xs"
            className="text-2xs touch:h-10"
            disabled={!!photo.toolsBusy}
            onClick={() => void photo.showOnMap(candidate.which)}
          >
            <MapIcon className="h-3.5 w-3.5" />
            Photo on the plan: {candidate.label}
          </Button>
        ))}
        {drape && (
          <Button type="button" variant="ghost" size="xs" className="text-2xs" onClick={photo.hideDrape}>
            Hide it
          </Button>
        )}
      </div>
      {drape && (
        <p className="text-3xs text-muted-foreground">
          The photo at heading {drape.bearing.toFixed(0)}° is on the plan; the camera sees{' '}
          {Math.round(drape.seenShare * 100)}% of the ground in its frame (terrain only).
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {candidates.map((candidate) => (
          <Button
            key={`model-${candidate.which}`}
            type="button"
            variant="outline"
            size="xs"
            className="text-2xs touch:h-10"
            disabled={!!photo.toolsBusy}
            onClick={() => void photo.renderModel(candidate.which)}
          >
            <Mountain className="h-3.5 w-3.5" />
            Model view: {candidate.label}
          </Button>
        ))}
      </div>
      {(photo.modelViews.camera || photo.modelViews['runner-up']) && (
        <div className="grid grid-cols-2 gap-1">
          <figure>
            <img src={own.src} alt="Your photo" className="w-full rounded-sm" />
            <figcaption className="text-3xs text-muted-foreground">Photo</figcaption>
          </figure>
          {(['camera', 'runner-up'] as const).map((which) => {
            const view = photo.modelViews[which]
            return view ? (
              <figure key={which}>
                <img
                  src={view.url}
                  alt={`Model view at heading ${view.bearing.toFixed(0)}°`}
                  className="w-full rounded-sm"
                />
                <figcaption className="text-3xs text-muted-foreground">
                  Heading {view.bearing.toFixed(0)}° · agreement {view.score.toFixed(2)}
                </figcaption>
              </figure>
            ) : null
          })}
        </div>
      )}
      {photo.modelViews.camera && photo.modelViews['runner-up'] && (
        <p className="text-3xs leading-4 text-muted-foreground">
          Agreement correlates the photo with each model view over the ground, in brightness and in edges. Higher is
          better; it is evidence beside the skyline and the sun, not a verdict.
        </p>
      )}
    </div>
  )
}

const sunText = (sun: SunCheck) =>
  sun.elevation < 0
    ? 'the sun was below the horizon'
    : sun.inFrame && sun.pixel
      ? `the sun (${Math.round(sun.elevation)}° up) should be in the frame`
      : Math.abs(sun.relativeBearing) > 90
        ? `the sun (${Math.round(sun.elevation)}° up) was behind the camera, ${Math.round(Math.abs(sun.relativeBearing))}° to the ${sun.relativeBearing < 0 ? 'left' : 'right'}`
        : `the sun (${Math.round(sun.elevation)}° up) was ${Math.round(Math.abs(sun.relativeBearing))}° ${sun.relativeBearing < 0 ? 'left' : 'right'} of the view's centre, out of frame`

/** The all-headings camera search for an own photo: heading, pitch and roll from its skyline, with what to check. */
function CameraSearchPanel({ photo }: { photo: FieldPhotoState }) {
  const search = photo.cameraSearch
  const working = search.status === 'working'
  return (
    <div className="space-y-1" data-testid="camera-search">
      <div className="flex gap-1">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="flex-1 text-2xs touch:h-10"
          disabled={working}
          onClick={() => void photo.findCamera()}
        >
          {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {working
            ? search.stage === 'terrain'
              ? `Loading terrain 90 km round…${search.tiles ? ` ${search.tiles.loaded}/${search.tiles.total} tiles` : ''}`
              : search.stage === 'photo'
                ? 'Reading the skyline…'
                : `Searching every heading… ${Math.round(search.done * 100)}%`
            : 'Find the camera (all headings)'}
        </Button>
        {working && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-2xs touch:h-10"
            onClick={photo.cancelCameraSearch}
          >
            Cancel
          </Button>
        )}
      </div>
      {search.status === 'done' && (
        <div className="space-y-1 text-3xs leading-4" role="status">
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
            Check before trusting it: the yellow skyline should sit on the ridgeline, the orange outline on the block,
            and the sun where the light comes from. A bright sky, a backlit hillside or shadows can tell two headings
            apart.
          </p>
        </div>
      )}
      {search.status === 'failed' && (
        <p className="text-3xs leading-4 text-foreground" role="status">
          {search.message}
        </p>
      )}
    </div>
  )
}
