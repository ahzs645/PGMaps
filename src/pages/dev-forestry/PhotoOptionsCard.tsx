/**
 * The options card (docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.2): one row per candidate
 * camera (`photoOptions`), ranked by the evidence behind each — the skyline's best fit and runner-up, the phone's
 * heading, an accepted neighbouring frame's camera, a point solve, a matched camera. Each row says what it rests on:
 * agreeing sky columns and their span, the model view's score beside its thumbnail, the sun, and its warnings. *Use*
 * makes it the camera; *Adjust* uses it and opens the hand tools. Nothing here says a camera is right.
 */
import { Check, Loader2, Mountain, SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { cn } from '@/lib/utils'

import { sameCamera, type AcceptancePose } from './photoAcceptance'
import { PHOTO_MATCHERS } from './photoMatchers'
import { NEIGHBOUR_AGREE_DEGREES, type PhotoOption } from './photoOptions'
import { photoModelViews, type FieldPhotoState, type ModelViewImage, type OwnPhotoWork } from './useFieldPhoto'

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

/** A model view drawn for this camera, wherever it was kept: by the queue, by the reviewer, or ahead for an option. */
export function modelViewFor(
  work: Pick<OwnPhotoWork, 'modelViews' | 'optionViews'>,
  pose: AcceptancePose | null,
): ModelViewImage | null {
  return (pose && photoModelViews(work).find((view) => view.pose && sameCamera(view.pose, pose))) || null
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`

/**
 * A row's evidence in two parts: `facts`, the one line it shows (how the fit was measured, and what agrees with it),
 * and `details`, the rest, behind its (i): the sky's span, the sun, a neighbour's agreement in full, a match's errors.
 */
function rowEvidence(
  option: PhotoOption,
  {
    thumbShown,
    neighbourName,
  }: { thumbShown: boolean; neighbourName: (id: string | null | undefined) => string | null },
): { facts: string[]; details: string[] } {
  const { evidence } = option
  const facts: string[] = []
  const details: string[] = []
  if (evidence.skyColumns !== undefined) {
    facts.push(
      `${evidence.skyColumns} sky columns${evidence.agreeShare !== undefined ? `, ${Math.round(evidence.agreeShare * 100)}% agree` : ''}`,
    )
    details.push(`The skyline spans ${Math.round((evidence.skySpanShare ?? 0) * 100)}% of the frame.`)
  }
  if (evidence.heldOutMeters !== undefined && evidence.heldOutMeters !== null)
    facts.push(`worst pair held out ${Math.round(evidence.heldOutMeters)} m`)
  if (option.overlap) {
    facts.push(`${option.overlap.matches} shared features`)
    details.push(
      `${option.overlap.matches} shared features by ${PHOTO_MATCHERS[option.overlap.matcher ?? 'xfeat'].label}, from ${
        option.overlap.basis === 'terrain' ? `${option.overlap.controls} terrain points` : 'image geometry'
      }; held-out error at 1,050 px wide ${option.overlap.medianPx.toFixed(1)} px median, ${option.overlap.p90Px.toFixed(1)} px at the 90th percentile.`,
    )
  }
  if (!thumbShown && evidence.modelScore !== undefined && evidence.modelScore !== null)
    facts.push(`model view ${evidence.modelScore.toFixed(2)}`)
  for (const note of option.notes ?? []) facts.push(note.charAt(0).toLowerCase() + note.slice(1))
  if (
    evidence.neighbourAgreesDegrees !== undefined &&
    evidence.neighbourAgreesDegrees !== null &&
    evidence.neighbourAgreesDegrees <= NEIGHBOUR_AGREE_DEGREES
  ) {
    const name = neighbourName(evidence.neighbourId) ?? 'the neighbouring frame'
    facts.push(`within ${evidence.neighbourAgreesDegrees.toFixed(1)}° of ${name}`)
    details.push(
      `Within ${evidence.neighbourAgreesDegrees.toFixed(1)}° of ${name}’s accepted camera, a frame seconds apart: evidence, not a verdict.`,
    )
  }
  if (evidence.sunNote) details.push(`Sun: ${evidence.sunNote}.`)
  return { facts, details }
}

export function PhotoOptionsCard({
  photo,
  onAdjust,
  onSearchRound,
}: {
  photo: FieldPhotoState
  onAdjust: () => void
  /** A ground row's *Use*: the skyline searched round its heading, which is a sector rather than a fitted camera. */
  onSearchRound?: (bearing: number) => void
}) {
  const own = photo.own
  if (!own) return null
  const options = photo.optionsFor(own.id)
  const current = ownAcceptancePose(own)
  const work = photo.workFor(own.id)
  const search = work.search
  const viewsComing = photo.optionViewsFor === own.id
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
          const ground = option.kind === 'ground' && !!onSearchRound
          const thumb = modelViewFor(work, option.pose)
          const drawable =
            option.kind === 'winner' || option.kind === 'runner-up' ? option.kind : inUse ? 'camera' : null
          // Its view is being drawn ahead, or waits its turn behind the search.
          const drawing = !thumb && (viewsComing || search.status === 'working')
          const { facts, details } = rowEvidence(option, {
            thumbShown: !!thumb,
            neighbourName: (id) => photo.ownPhotos.find((entry) => entry.id === id)?.name ?? null,
          })
          return (
            <li
              key={option.id}
              className={cn('rounded-md border p-2 text-xs', inUse ? 'border-primary' : 'border-border')}
              aria-label={`${option.label}${inUse ? ', in use' : ''}`}
            >
              <div className="flex gap-3">
                {/* The view's place is the photo's shape whether or not the view has been drawn yet, so a view arriving
                    (they are drawn ahead, one camera at a time) never changes the height of its row. */}
                <figure className="w-24 shrink-0">
                  <div
                    className="flex items-center justify-center overflow-hidden rounded-sm bg-muted"
                    style={{ aspectRatio: `${own.width} / ${own.height}` }}
                  >
                    {thumb ? (
                      <img
                        src={thumb.url}
                        alt={`Model view at heading ${thumb.bearing.toFixed(0)}°`}
                        className="h-full w-full"
                      />
                    ) : drawing ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                        aria-label="Drawing its model view"
                      />
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
                      <p className="p-1 text-center text-3xs leading-4 text-muted-foreground">
                        Use it to draw its model view
                      </p>
                    )}
                  </div>
                  <figcaption className="min-h-4 text-3xs leading-4 text-muted-foreground tabular-nums">
                    {thumb
                      ? Number.isFinite(thumb.score)
                        ? `Agreement ${thumb.score.toFixed(2)}`
                        : 'Insufficient ground imagery'
                      : ''}
                  </figcaption>
                </figure>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-start gap-1">
                    {inUse && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />}
                    <p className="min-w-0 font-medium">{option.label}</p>
                    {/* Cautions and the full evidence behind their icons: the row keeps one line of each. */}
                    {option.warnings.length > 0 && (
                      <InfoTip
                        tone="warning"
                        label={`${option.warnings.length === 1 ? 'A caution' : `${option.warnings.length} cautions`} on ${option.label}`}
                        className="shrink-0"
                      >
                        <ul className="space-y-1">
                          {option.warnings.map((warning) => (
                            <li key={warning}>{sentence(warning)}</li>
                          ))}
                        </ul>
                      </InfoTip>
                    )}
                    {details.length > 0 && (
                      <InfoTip label={`What ${option.label} rests on`} className="shrink-0">
                        <ul className="space-y-1">
                          {details.map((detail) => (
                            <li key={detail}>{detail}</li>
                          ))}
                        </ul>
                      </InfoTip>
                    )}
                  </div>
                  <p className="text-muted-foreground tabular-nums">
                    {option.pose.bearing.toFixed(1)}° · pitch {signed(option.pose.pitch)} · roll{' '}
                    {signed(option.pose.roll)} · {option.pose.hfov.toFixed(0)}° lens
                  </p>
                  {facts.length > 0 && <p className="text-muted-foreground tabular-nums">{facts.join(' · ')}</p>}
                  <div className="flex gap-1.5 pt-1">
                    <Button
                      type="button"
                      size="xs"
                      variant={inUse ? 'outline' : 'default'}
                      className="touch:h-10"
                      disabled={inUse}
                      aria-label={`${ground ? 'Search round' : 'Use'} ${option.label.toLowerCase()}`}
                      onClick={() => {
                        photo.chooseOption(own.id, option.id)
                        if (ground) onSearchRound?.(option.pose.bearing)
                      }}
                    >
                      {inUse ? 'In use' : ground ? 'Search round it' : 'Use'}
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
