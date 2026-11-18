/**
 * The own-photo window's *Photos* tab (docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.1, §2.8): a
 * drop zone taking many photos at once, the photos in time order grouped by flight, each with a dot and a word for
 * what it needs (`photoStripState`), the active one marked, and the queue's place ("Searching 3 of 14") with pause
 * and cancel. A photo that wants the reviewer says why in plain words.
 *
 * `PhotoFilmstrip` is the same set as one row of small pictures, for the window's other tabs: the set, the queue and
 * a way to another photo stay on screen while one photo's camera is worked on.
 */
import { Loader2, Pause, Play, RotateCcw, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConfirmRemoveButton } from '@/components/ui/confirm-remove'
import { FileDropField } from '@/components/ui/file-drop-field'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { PHOTO_FILE_ACCEPT } from '@/lib/heic/heicFile'
import { cn } from '@/lib/utils'

import type { FieldRecord } from './assessmentTools'
import type { RoadViewPose } from './exifPose'
import {
  PHOTO_REMOVE_DETAIL,
  photoFailureText,
  photoStripState,
  type PhotoQueueEntry,
  type PhotoStripTone,
} from './photoOptions'
import { queueOrder } from './photoQueue'
import { closedPhotoNotes } from './photoRecords'
import type { FieldPhotoState, OwnPhoto } from './useFieldPhoto'

/** The dot's colour per tone: status colours only, so dark mode follows the tokens. */
export const PHOTO_TONE_DOT: Record<PhotoStripTone, string> = {
  idle: 'border border-muted-foreground/60 bg-transparent',
  waiting: 'bg-muted-foreground/40',
  working: 'bg-info animate-pulse',
  ready: 'bg-info',
  help: 'bg-warning',
  done: 'bg-success',
  failed: 'bg-danger',
}

/** The clock of an instant kept as ISO text, as written (UTC for a known instant). */
const timeOf = (iso: string | null) => {
  if (!iso) return null
  const match = /T(\d{2}:\d{2}(?::\d{2})?)/.exec(iso)
  return match ? match[1] : null
}
/**
 * When a photo was taken, as the reviewer remembers it: the camera's own clock. Without one, the instant's clock,
 * said to be UTC so 16:04 is not read as four in the afternoon.
 */
const whenOf = (photo: Pick<OwnPhoto, 'clock' | 'takenAtUtc'>) => {
  if (photo.clock) return photo.clock
  const utc = timeOf(photo.takenAtUtc)
  return utc ? `${utc} UTC` : null
}

/** "Searching 3 of 14", "Paused: 5 waiting", "Stopped", or null while idle. */
export function queueLine(queue: FieldPhotoState['queue']): string | null {
  if (queue.running && queue.position) return `Searching ${queue.position} of ${queue.total}`
  const waiting = queue.entries.filter((entry) => entry.status === 'queued').length
  if (queue.paused && waiting) return `Paused: ${waiting} waiting`
  if (waiting) return `${waiting} waiting`
  if (queue.cancelled) return 'Stopped: rerun a photo to search it'
  return null
}

/** A flight's first and last time, once when they are the same. */
const flightSpan = (photos: OwnPhoto[]) => {
  const times = [photos[0], photos[photos.length - 1]].flatMap((photo) => (photo ? (whenOf(photo) ?? []) : []))
  return [...new Set(times)].join('–')
}

export function PhotoStrip({
  photo,
  records,
  roadView,
  onAdded,
}: {
  photo: FieldPhotoState
  /** Field records of kind 'photo' not yet open, to bring into the set. */
  records: FieldRecord[]
  roadView: RoadViewPose | null
  /** Called with the result of an add, so the window can move on to the first photo. */
  onAdded?: (added: string[]) => void
}) {
  const { ownPhotos, ownFlights, queue, ownStatus } = photo
  const byId = new Map(ownPhotos.map((entry) => [entry.id, entry]))
  const entryOf = new Map(queue.entries.map((entry) => [entry.recordId, entry]))
  const flown = new Set(ownFlights.flatMap((flight) => flight.photoIds))
  const untimed = ownPhotos.filter((entry) => !flown.has(entry.id))
  const groups = [
    ...ownFlights.map((flight, i) => ({
      id: flight.id,
      title: `Flight ${i + 1}`,
      span: flightSpan(flight.photoIds.flatMap((id) => byId.get(id) ?? [])),
      photos: flight.photoIds.flatMap((id) => byId.get(id) ?? []),
    })),
    ...(untimed.length ? [{ id: 'untimed', title: 'No time recorded', span: '', photos: untimed }] : []),
  ]
  const open = new Set(ownPhotos.map((entry) => entry.id))
  // In time order, as the set is: the workspace keeps them in the order they were filed.
  const closedById = new Map(records.filter((record) => !open.has(record.id)).map((record) => [record.id, record]))
  const closedRecords = queueOrder(
    [...closedById.values()].map((record) => ({ ...record, takenAtUtc: record.takenAtUtc ?? null })),
  ).flatMap((id) => closedById.get(id) ?? [])
  const active = photo.own ? entryOf.get(photo.own.id) : undefined

  const add = (files: File[]) => {
    if (!files.length) return
    void photo.addOwnFiles(files, roadView).then((result) => onAdded?.(result.added))
  }

  return (
    <div className="space-y-4 text-sm" data-testid="own-photo-strip">
      <FileDropField
        label="Photos"
        accept={PHOTO_FILE_ACCEPT}
        multiple
        filesLabel={ownPhotos.length ? 'Add more photos' : 'Choose photos'}
        dropHint="or drop them here, a whole flight at once"
        disabled={ownStatus.loading}
        className="justify-center p-4"
        onFiles={(picked) => add(picked.map((entry) => entry.file))}
        inputProps={{ 'data-testid': 'own-photo-file' }}
      />
      {ownStatus.loading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          {ownStatus.stage ?? 'Reading the photos…'}
        </p>
      )}
      {ownStatus.error && <InlineAlert tone="error">{ownStatus.error}</InlineAlert>}
      {ownStatus.note && !ownStatus.loading && (
        <p className="text-xs leading-5 text-muted-foreground" role="status">
          {ownStatus.note}
        </p>
      )}
      {!ownPhotos.length && (
        <p className="text-xs leading-5 text-muted-foreground">
          JPEG, PNG, WebP or HEIC, an iPhone’s own format, decoded here where the browser cannot show it; nothing is
          uploaded. Each photo becomes a field record. Its EXIF gives the starting camera, and a queue then searches
          each photo’s camera in time order by itself. Nothing is accepted until you say so.
        </p>
      )}

      {ownPhotos.length > 0 && <QueueControls photo={photo} className="text-xs" />}

      {groups.map((group) => (
        <section key={group.id} aria-label={group.title}>
          <h4 className="mb-1.5 text-xs font-medium">
            {group.title}
            {group.span && <span className="ml-1 font-normal text-muted-foreground tabular-nums">· {group.span}</span>}
            <span className="ml-1 font-normal text-muted-foreground">
              · {group.photos.length} photo{group.photos.length === 1 ? '' : 's'}
            </span>
          </h4>
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
            {group.photos.map((entry) => (
              <li key={entry.id}>
                <Frame
                  photo={entry}
                  entry={entryOf.get(entry.id)}
                  active={entry.id === photo.activeId}
                  lapsed={photo.acceptanceState(entry.id) === 'lapsed'}
                  onSelect={() => photo.selectOwnPhoto(entry.id)}
                />
              </li>
            ))}
          </ol>
        </section>
      ))}

      {photo.own && active && (
        <ActiveFrame
          own={photo.own}
          entry={active}
          onRerun={() => photo.rerun(photo.own!.id)}
          onRemove={() => photo.removePhoto(photo.own!.id)}
          running={queue.running === photo.own.id}
        />
      )}

      {closedRecords.length > 0 && (
        <section aria-label="Imported before" data-testid="own-photo-records">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h4 className="mr-auto flex items-center gap-1 text-xs font-medium">
              Imported before
              <span className="font-normal text-muted-foreground">
                · {closedRecords.length} photo{closedRecords.length === 1 ? '' : 's'}
              </span>
              <InfoTip label="About photos imported before">
                These are field records already. <em>Open</em> carries on with the same record: the camera it holds, its
                acceptance and its jobs. Nothing is filed twice, and choosing the same file again opens its record too.
                A photo marked <em>Small copy only</em> has no original kept and opens as its 1,600-pixel copy; choose
                its file again to give it the original. <em>Remove</em> deletes the record and its original from this
                browser, and unlinks a viewpoint made from it.
              </InfoTip>
            </h4>
            {closedRecords.length > 1 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="touch:h-10"
                  disabled={ownStatus.loading}
                  onClick={() => void photo.openOwnRecords(closedRecords, roadView)}
                >
                  Open all
                </Button>
                <ConfirmRemoveButton
                  label="Remove all photos imported before"
                  question={`Remove all ${closedRecords.length} photos?`}
                  detail="Their field records and originals go from this browser. A viewpoint made from one stays, without the link."
                  confirmLabel="Remove all"
                  onConfirm={() => closedRecords.forEach((record) => photo.removePhoto(record.id))}
                >
                  Remove all
                </ConfirmRemoveButton>
              </>
            )}
          </div>
          <p className="mb-1.5 text-xs leading-5 text-muted-foreground">
            Opening one carries on with its field record; it is not imported again.
          </p>
          <ul className="divide-y divide-border/70 rounded-md border border-border">
            {closedRecords.map((record) => {
              const notes = closedPhotoNotes(record, photo.originalKept(record.id))
              return (
                <li key={record.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-xs">
                  <img src={record.image} alt="" className="h-9 w-14 shrink-0 rounded-sm object-cover" loading="lazy" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{record.name}</span>
                    {notes.length > 0 && (
                      <span className="block truncate text-2xs text-muted-foreground">{notes.join(' · ')}</span>
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="touch:h-10"
                    aria-label={`Open ${record.name}`}
                    disabled={ownStatus.loading}
                    onClick={() => void photo.openOwnRecord(record, roadView)}
                  >
                    Open
                  </Button>
                  <ConfirmRemoveButton
                    label={`Remove ${record.name}`}
                    question={`Remove ${record.name}?`}
                    detail={PHOTO_REMOVE_DETAIL}
                    onConfirm={() => photo.removePhoto(record.id)}
                  />
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

/** The queue's place in words, with pause, carry on and cancel. */
function QueueControls({ photo, className }: { photo: FieldPhotoState; className?: string }) {
  const { queue } = photo
  const line = queueLine(queue)
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} aria-label="Queue">
      {queue.running && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
      <span className="mr-auto tabular-nums" role="status">
        {line ?? `${queue.done} of ${queue.total} searched`}
      </span>
      {(queue.running || queue.entries.some((entry) => entry.status === 'queued')) &&
        (queue.paused ? (
          <Button type="button" variant="outline" size="xs" className="touch:h-10" onClick={photo.resumeQueue}>
            <Play className="h-3.5 w-3.5" />
            Carry on
          </Button>
        ) : (
          <Button type="button" variant="outline" size="xs" className="touch:h-10" onClick={photo.pauseQueue}>
            <Pause className="h-3.5 w-3.5" />
            Pause
          </Button>
        ))}
      {queue.running && (
        <Button type="button" variant="ghost" size="xs" className="touch:h-10" onClick={photo.cancelQueue}>
          <Square className="h-3.5 w-3.5" />
          Cancel
        </Button>
      )}
    </div>
  )
}

/**
 * The set as one row of small pictures, each with its dot, and the queue's place beside it. A click opens that photo
 * where the reviewer is, without a trip to the Photos tab; the row scrolls sideways when a flight is longer than it.
 */
export function PhotoFilmstrip({ photo }: { photo: FieldPhotoState }) {
  const { ownPhotos, queue } = photo
  if (ownPhotos.length < 2) return null
  const entryOf = new Map(queue.entries.map((entry) => [entry.recordId, entry]))
  return (
    <div className="flex items-center gap-3" data-testid="own-photo-filmstrip">
      <ol className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5" aria-label="Photos in the set">
        {ownPhotos.map((entry) => {
          const state = photoStripState(entryOf.get(entry.id))
          const active = entry.id === photo.activeId
          return (
            <li key={entry.id} className="shrink-0">
              <button
                type="button"
                onClick={() => photo.selectOwnPhoto(entry.id)}
                aria-pressed={active}
                aria-label={`${entry.name}: ${state.text}${active ? ', open' : ''}`}
                title={`${entry.name} · ${state.short}`}
                className={cn(
                  'relative block h-10 w-14 overflow-hidden rounded-sm border transition-colors touch:h-11 touch:w-16',
                  active ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/60',
                )}
              >
                <img src={entry.thumb ?? entry.src} alt="" className="h-full w-full object-cover" loading="lazy" />
                <span
                  className={cn(
                    'absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full ring-1 ring-background',
                    PHOTO_TONE_DOT[state.tone],
                  )}
                  aria-hidden
                />
              </button>
            </li>
          )
        })}
      </ol>
      <QueueControls photo={photo} className="shrink-0 text-2xs text-muted-foreground" />
    </div>
  )
}

/** One frame in the strip: its picture, its time, and a dot and a word for what it needs. */
function Frame({
  photo,
  entry,
  active,
  lapsed,
  onSelect,
}: {
  photo: OwnPhoto
  entry: PhotoQueueEntry | undefined
  active: boolean
  lapsed: boolean
  onSelect: () => void
}) {
  const state = photoStripState(entry)
  const when = whenOf(photo)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`${photo.name}: ${state.text}${lapsed ? ', acceptance lapsed' : ''}${active ? ', open' : ''}`}
      className={cn(
        'block w-full overflow-hidden rounded-md border text-left transition-colors',
        active ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/60',
      )}
    >
      <img src={photo.thumb ?? photo.src} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
      <span className="flex items-center gap-1.5 px-1.5 pt-1 text-2xs">
        <span className="min-w-0 flex-1 truncate">{photo.name}</span>
        {when && <span className="shrink-0 text-muted-foreground tabular-nums">{when}</span>}
      </span>
      <span className="flex items-center gap-1.5 px-1.5 pb-1 text-2xs text-muted-foreground">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', PHOTO_TONE_DOT[state.tone])} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{lapsed ? 'Moved since accepted' : state.short}</span>
      </span>
    </button>
  )
}

/** The open photo's place in the queue, in plain words, and why it wants the reviewer. */
function ActiveFrame({
  own,
  entry,
  running,
  onRerun,
  onRemove,
}: {
  own: OwnPhoto
  entry: PhotoQueueEntry
  running: boolean
  onRerun: () => void
  onRemove: () => void
}) {
  return (
    <section className="space-y-1.5 rounded-md border border-border p-2 text-xs" aria-label="Open photo">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', PHOTO_TONE_DOT[photoStripState(entry).tone])}
          aria-hidden
        />
        <p className="min-w-0 flex-1 truncate">
          <span className="font-medium">{own.name}</span>
          {own.frameIndex !== null && <span className="text-muted-foreground"> · frame {own.frameIndex + 1}</span>}
          <span className="text-muted-foreground"> · {photoStripState(entry).short}</span>
        </p>
        <Button type="button" variant="ghost" size="xs" className="touch:h-10" disabled={running} onClick={onRerun}>
          <RotateCcw className="h-3.5 w-3.5" />
          Search again
        </Button>
        <ConfirmRemoveButton
          label={`Remove ${own.name}`}
          question={`Remove ${own.name}?`}
          detail={PHOTO_REMOVE_DETAIL}
          onConfirm={onRemove}
        />
      </div>
      {entry.reasons.map((reason) => (
        <p key={reason} className="leading-5 text-warning-foreground">
          {photoFailureText(reason)}
        </p>
      ))}
      {entry.notes.map((note) => (
        <p key={note} className="leading-5 text-muted-foreground">
          {note}
        </p>
      ))}
    </section>
  )
}
