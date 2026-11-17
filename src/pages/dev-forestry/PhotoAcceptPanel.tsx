/**
 * The own-photo window's *Use* tab (docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.6, §2.7):
 * accepting the camera, then the jobs the photo does. *Accept* is the reviewer's, never automatic: it is on only when
 * the gate passes (`acceptGate`: checks drawn for this exact camera, a point solve's held-out pair landing, a note for
 * a fit that is not settled, initials typed), and says why when it is off. A camera moved after it was accepted lapses
 * the acceptance, said plainly. One record holds the photo; every job is a link to it, never a copy.
 */
import { useState } from 'react'
import { Check, CircleAlert, MapPin, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, FormField } from '@/components/ui/form-field'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'

import { PHOTO_JOBS, type PhotoJob } from './assessmentTools'
import { METHOD_TEXT, type AcceptPreview } from './photoAcceptPreview'
import type { FieldPhotoState } from './useFieldPhoto'

/** Each job in plain words: what linking the photo to it does. */
export const PHOTO_JOB_TEXT: Record<PhotoJob, { label: string; note: string }> = {
  viewpoint: {
    label: 'A viewpoint',
    note: 'A view of interest at this camera: its place, heading, tilt, roll, altitude and lens.',
  },
  before: { label: 'The before image', note: 'The existing view in a before/after pair.' },
  ground: { label: 'Ground conditions', note: 'Evidence of what the ground looks like; needs no accepted camera.' },
  'drawn-check': {
    label: 'A check of the drawn forest',
    note: 'Held against the road view’s drawn timber from the same camera.',
  },
  regrowth: { label: 'Regrowth over time', note: 'Evidence for a field green-up judgement, never the check itself.' },
  landform: { label: 'Landform evidence', note: 'Evidence for a landform or sensitivity unit you link it to.' },
}

/** Jobs that need the camera accepted first: their pictures are drawn from it. */
const NEEDS_ACCEPTED: ReadonlySet<PhotoJob> = new Set(['viewpoint', 'before', 'drawn-check'])

export function PhotoAcceptPanel({
  photo,
  preview,
  initials,
  note,
  onInitials,
  onNote,
  onAccept,
  acceptError,
}: {
  photo: FieldPhotoState
  /** What Accept would record, and the gate's answer (`acceptPreview`). */
  preview: AcceptPreview
  initials: string
  note: string
  onInitials: (value: string) => void
  onNote: (value: string) => void
  onAccept: () => void
  /** Why the last Accept was refused, from the hook. */
  acceptError: string | null
}) {
  const own = photo.own
  if (!own) return null
  const state = photo.acceptanceState(own.id)
  const acceptance = own.acceptance
  const notSettled = preview.evidence.settled === false
  return (
    <section className="space-y-3" aria-label="Accept the camera">
      <h4 className="text-sm font-semibold">Accept the camera</h4>
      {acceptance && (
        <div
          className={cn(
            'space-y-1 rounded-md border p-2 text-xs',
            state === 'accepted' ? 'border-success-border' : 'border-warning-border',
          )}
          role="status"
        >
          <p className="flex items-center gap-1.5 font-medium">
            {state === 'accepted' ? (
              <Check className="h-3.5 w-3.5 text-success" aria-hidden />
            ) : (
              <CircleAlert className="h-3.5 w-3.5 text-warning" aria-hidden />
            )}
            {state === 'accepted'
              ? `Accepted by ${acceptance.acceptedBy}`
              : `Lapsed: the camera has moved since ${acceptance.acceptedBy} accepted it`}
          </p>
          <KeyValueRows
            variant="divided"
            rows={[
              { label: 'When', value: acceptance.acceptedAt.replace('T', ' ').slice(0, 16) + ' UTC' },
              { label: 'How it was found', value: METHOD_TEXT[acceptance.method] },
              {
                label: 'Camera accepted',
                value: `${acceptance.pose.bearing.toFixed(1)}°, pitch ${acceptance.pose.pitch.toFixed(1)}°, roll ${acceptance.pose.roll.toFixed(1)}°`,
              },
              acceptance.note ? { label: 'Note', value: acceptance.note } : null,
            ]}
          />
          {state === 'lapsed' && (
            <p className="leading-5 text-muted-foreground">
              An acceptance never carries over to a camera nobody looked at: check this one and accept it again, or put
              the camera back.
            </p>
          )}
        </div>
      )}
      {state !== 'accepted' && (
        <div className="space-y-2">
          <p className="text-xs leading-5 text-muted-foreground">
            The camera rests on: {METHOD_TEXT[preview.method]}. Accepting records your initials, the time, the camera
            and the evidence you saw. Nothing before this is a verdict.
          </p>
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
            <FormField label="Your initials">
              <input
                className={cn(FORM_INPUT_CLASS, 'h-9 touch:h-10')}
                value={initials}
                maxLength={12}
                autoComplete="off"
                onChange={(event) => onInitials(event.target.value)}
              />
            </FormField>
            <FormField label={notSettled ? 'Why this camera (needed: not settled)' : 'Note (optional)'}>
              <textarea
                className={cn(FORM_INPUT_CLASS, 'min-h-9 py-1.5')}
                rows={2}
                value={note}
                onChange={(event) => onNote(event.target.value)}
              />
            </FormField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="touch:h-10" disabled={!preview.gate.ok} onClick={onAccept}>
              <Check className="h-4 w-4" />
              Accept camera
            </Button>
            {!preview.gate.ok && <p className="text-xs text-muted-foreground">{preview.gate.reason}</p>}
          </div>
          {acceptError && <InlineAlert tone="warning">{acceptError}</InlineAlert>}
        </div>
      )}
    </section>
  )
}

/** The jobs the photo does, a viewpoint first, and removing it from the set. */
export function PhotoUsePanel({
  photo,
  onRemoved,
}: {
  photo: FieldPhotoState
  /** Called after the photo is removed, so the window can move on. */
  onRemoved?: () => void
}) {
  const own = photo.own
  const [message, setMessage] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null)
  if (!own) return null
  const accepted = photo.acceptanceState(own.id) === 'accepted'
  const makeViewpoint = () => {
    const made = photo.makeViewpoint(own.id)
    setMessage(
      made.ok
        ? {
            tone: 'success',
            text: made.added
              ? 'Added to the views of interest (step 1), at this camera.'
              : 'Its view of interest now follows this camera.',
          }
        : { tone: 'warning', text: made.reason },
    )
  }
  const has = (job: PhotoJob) => own.uses.some((use) => use.job === job)
  const viewId = own.uses.find((use) => use.job === 'viewpoint')?.targetId ?? null
  return (
    <section className="space-y-3" aria-label="Use the photo">
      <h4 className="text-sm font-semibold">What this photo is for</h4>
      <ul className="space-y-1.5">
        {PHOTO_JOBS.map((job) => {
          const text = PHOTO_JOB_TEXT[job]
          const blocked = NEEDS_ACCEPTED.has(job) && !accepted && !has(job)
          return (
            <li key={job}>
              <label className={cn('flex items-start gap-2 text-xs', blocked && 'opacity-60')}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={has(job)}
                  disabled={blocked || !own.recordId}
                  onChange={(event) => {
                    if (job === 'viewpoint' && event.target.checked) makeViewpoint()
                    else photo.setJob(own.id, job, event.target.checked, job === 'viewpoint' ? viewId : null)
                  }}
                />
                <span className="min-w-0">
                  <span className="font-medium">{text.label}</span>{' '}
                  <span className="text-muted-foreground">
                    {text.note}
                    {blocked ? ' Accept the camera first.' : ''}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {message && <InlineAlert tone={message.tone}>{message.text}</InlineAlert>}
      {!own.recordId && (
        <InlineAlert tone="warning">
          This photo is not in the workspace’s field records, so it has nowhere to keep its jobs.
        </InlineAlert>
      )}
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-10"
          disabled={!accepted}
          onClick={makeViewpoint}
        >
          <MapPin className="h-4 w-4" />
          {viewId ? 'Update its viewpoint' : 'Make a viewpoint'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="touch:h-10"
          onClick={() => {
            photo.removePhoto(own.id)
            onRemoved?.()
          }}
        >
          <Trash2 className="h-4 w-4" />
          Remove photo
        </Button>
      </div>
      <p className="text-2xs leading-4 text-muted-foreground">
        Removing a photo drops its field record and its original; a view made from it stays, without the link.
      </p>
    </section>
  )
}
