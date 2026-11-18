/**
 * The options card (docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.2): one row per candidate
 * camera (`photoOptions`), ranked by the evidence behind each — the skyline's best fit and runner-up, the phone's
 * heading, an accepted neighbouring frame's camera, a point solve, a matched camera. Each row says what it rests on:
 * agreeing sky columns and their span, the model view's score beside its thumbnail, the sun, and its warnings. *Use*
 * makes it the camera; *Adjust* uses it and opens the hand tools. Nothing here says a camera is right.
 */
import { Check, Loader2, Mountain, SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { sameCamera, type AcceptancePose } from './photoAcceptance'
import { PHOTO_MATCHERS } from './photoMatchers'
import { NEIGHBOUR_AGREE_DEGREES } from './photoOptions'
import type { FieldPhotoState, ModelViewImage, PhotoModelViewKind } from './useFieldPhoto'

const signed = (value: number, digits = 1) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}°`

/** The camera as it stands, in an acceptance's terms; null without a position. */
export function ownAcceptancePose(own: FieldPhotoState['own']): AcceptancePose | null {
  if (!own || own.pose.lng === null || own.pose.lat === null) return null
  return {
    lng: own.pose.lng,
    lat: own.pose.lat,
    altitudeMeters: own.pose.altitudeMeters ?? null,
    bearing: own.pose.bearing,
    pitch: own.pose.pitch,
    roll: own.pose.roll,
    hfov: own.pose.hfov,
  }
}

/** A model view drawn for this camera, wherever it was kept. */
export function modelViewFor(
  views: Partial<Record<PhotoModelViewKind, ModelViewImage>>,
  pose: AcceptancePose | null,
): ModelViewImage | null {
  return (pose && Object.values(views).find((view) => view.pose && sameCamera(view.pose, pose))) || null
}

export function PhotoOptionsCard({ photo, onAdjust }: { photo: FieldPhotoState; onAdjust: () => void }) {
  const own = photo.own
  if (!own) return null
  const options = photo.optionsFor(own.id)
  const current = ownAcceptancePose(own)
  const work = photo.workFor(own.id)
  const search = work.search
  if (!options.length)
    return (
      <section className="space-y-2 rounded-md border border-border p-3 text-xs" aria-label="Camera options">
        <h4 className="text-sm font-semibold">Camera options</h4>
        <p className="leading-5 text-muted-foreground">
          {own.pose.lng === null || own.pose.lat === null
            ? 'Set where the photo was taken first (Adjust): the search looks at the terrain round it.'
            : search.status === 'working'
              ? 'Searching for the camera…'
              : 'No candidate yet. The queue searches each photo in turn; Adjust holds the hand tools.'}
        </p>
        <Button type="button" variant="outline" size="sm" className="touch:h-10" onClick={onAdjust}>
          <SlidersHorizontal className="h-4 w-4" />
          Adjust
        </Button>
      </section>
    )
  return (
    <section className="space-y-2" aria-label="Camera options">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">Camera options</h4>
        <p className="text-2xs text-muted-foreground">Ranked by the evidence behind each; none is a verdict.</p>
      </div>
      {search.status === 'done' && search.neighbour && (
        <p className="text-2xs leading-4 text-muted-foreground">
          Also checked the heading around {search.neighbour.name}, taken{' '}
          {Math.abs(Math.round(search.neighbour.gapSeconds))} s apart.
        </p>
      )}
      <ol className="space-y-2">
        {options.map((option) => {
          const inUse = !!current && sameCamera(option.pose, current)
          const thumb = modelViewFor(work.modelViews, option.pose)
          const drawable =
            option.kind === 'winner' || option.kind === 'runner-up' ? option.kind : inUse ? 'camera' : null
          const { evidence } = option
          return (
            <li
              key={option.id}
              className={cn('rounded-md border p-2 text-xs', inUse ? 'border-primary' : 'border-border')}
              aria-label={`${option.label}${inUse ? ', in use' : ''}`}
            >
              <div className="flex gap-3">
                <div className="w-24 shrink-0">
                  {thumb ? (
                    <figure>
                      <img
                        src={thumb.url}
                        alt={`Model view at heading ${thumb.bearing.toFixed(0)}°`}
                        className="w-full rounded-sm"
                      />
                      <figcaption className="text-3xs text-muted-foreground tabular-nums">
                        {Number.isFinite(thumb.score)
                          ? `Agreement ${thumb.score.toFixed(2)}`
                          : 'Insufficient ground imagery'}
                      </figcaption>
                    </figure>
                  ) : drawable ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="h-auto w-full py-2 text-2xs whitespace-normal touch:h-10"
                      disabled={!!photo.toolsBusy}
                      onClick={() => void photo.renderModel(drawable)}
                    >
                      {photo.toolsBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Mountain className="h-3.5 w-3.5" />
                      )}
                      Draw its model view
                    </Button>
                  ) : (
                    <p className="text-3xs leading-4 text-muted-foreground">Use it to draw its model view</p>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex items-center gap-1 font-medium">
                    {inUse && <Check className="h-3.5 w-3.5 text-success" aria-hidden />}
                    {option.label}
                  </p>
                  <p className="text-muted-foreground tabular-nums">
                    Heading {option.pose.bearing.toFixed(1)}° · pitch {signed(option.pose.pitch)} · roll{' '}
                    {signed(option.pose.roll)} · {option.pose.hfov.toFixed(0)}° lens
                  </p>
                  {evidence.skyColumns !== undefined && (
                    <p className="text-muted-foreground tabular-nums">
                      {evidence.skyColumns} sky columns across {Math.round((evidence.skySpanShare ?? 0) * 100)}% of the
                      frame
                      {evidence.agreeShare !== undefined ? `; ${Math.round(evidence.agreeShare * 100)}% agree` : ''}
                    </p>
                  )}
                  {evidence.modelScore !== undefined && evidence.modelScore !== null && !thumb && (
                    <p className="text-muted-foreground tabular-nums">
                      Model view agreement {evidence.modelScore.toFixed(2)}
                    </p>
                  )}
                  {evidence.neighbourAgreesDegrees !== undefined &&
                    evidence.neighbourAgreesDegrees !== null &&
                    evidence.neighbourAgreesDegrees <= NEIGHBOUR_AGREE_DEGREES && (
                      <p className="text-muted-foreground tabular-nums">
                        Within {evidence.neighbourAgreesDegrees.toFixed(1)}° of{' '}
                        {photo.ownPhotos.find((entry) => entry.id === evidence.neighbourId)?.name ??
                          'the neighbouring frame'}
                        ’s accepted camera, a frame seconds apart: evidence, not a verdict
                      </p>
                    )}
                  {evidence.heldOutMeters !== undefined && evidence.heldOutMeters !== null && (
                    <p className="text-muted-foreground tabular-nums">
                      Worst pair held out {Math.round(evidence.heldOutMeters)} m on the ground
                    </p>
                  )}
                  {option.overlap && (
                    <p className="text-muted-foreground tabular-nums">
                      {option.overlap.matches} shared features by{' '}
                      {PHOTO_MATCHERS[option.overlap.matcher ?? 'xfeat'].label} ·{' '}
                      {option.overlap.basis === 'terrain'
                        ? `${option.overlap.controls} terrain points`
                        : 'image geometry'}{' '}
                      · held-out error at 1,050 px wide {option.overlap.medianPx.toFixed(1)} px median /{' '}
                      {option.overlap.p90Px.toFixed(1)} px at the 90th percentile
                    </p>
                  )}
                  {evidence.sunNote && <p className="text-muted-foreground">Sun: {evidence.sunNote}.</p>}
                  {option.warnings.map((warning) => (
                    <p key={warning} className="text-warning-foreground">
                      {warning.charAt(0).toUpperCase() + warning.slice(1)}.
                    </p>
                  ))}
                  <div className="flex gap-1.5 pt-1">
                    <Button
                      type="button"
                      size="xs"
                      variant={inUse ? 'outline' : 'default'}
                      className="touch:h-10"
                      disabled={inUse}
                      aria-label={`Use ${option.label.toLowerCase()}`}
                      onClick={() => photo.chooseOption(own.id, option.id)}
                    >
                      {inUse ? 'In use' : 'Use'}
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="touch:h-10"
                      aria-label={`Adjust ${option.label.toLowerCase()}`}
                      onClick={() => {
                        if (!inUse) photo.chooseOption(own.id, option.id)
                        onAdjust()
                      }}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Adjust
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
