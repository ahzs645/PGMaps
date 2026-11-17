/**
 * The own-photo window's *Photos* tab (docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.1, §2.8): a
 * drop zone taking many photos at once, the photos in time order grouped by flight, each with a dot for where the
 * automatic queue has it, the active one marked, and the queue's place ("Searching 3 of 14") with pause and cancel.
 * A photo that wants the reviewer says why in plain words.
 */
import { Loader2, Pause, Play, RotateCcw, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FileDropField } from '@/components/ui/file-drop-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { PHOTO_FILE_ACCEPT } from '@/lib/heic/heicFile'
import { cn } from '@/lib/utils'

import type { FieldRecord } from './assessmentTools'
import type { RoadViewPose } from './exifPose'
import { PHOTO_STATUS_TEXT, photoFailureText, type PhotoQueueEntry, type PhotoQueueStatus } from './photoOptions'
import type { FieldPhotoState, OwnPhoto } from './useFieldPhoto'

/** The dot's colour per status: status colours only, so dark mode follows the tokens. */
const STATUS_DOT: Record<PhotoQueueStatus, string> = {
  unsearched: 'border border-muted-foreground/60 bg-transparent',
  queued: 'bg-muted-foreground/40',
  searching: 'bg-info animate-pulse',
  options: 'bg-warning',
  checked: 'bg-info',
  accepted: 'bg-success',
  failed: 'bg-danger',
}

const timeOf = (iso: string | null) => {
  if (!iso) return null
  const match = /T(\d{2}:\d{2}(?::\d{2})?)/.exec(iso)
  return match ? match[1] : null
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
      span: [timeOf(flight.start), timeOf(flight.end)].filter(Boolean).join('–'),
      photos: flight.photoIds.flatMap((id) => byId.get(id) ?? []),
    })),
    ...(untimed.length ? [{ id: 'untimed', title: 'No time recorded', span: '', photos: untimed }] : []),
  ]
  const open = new Set(ownPhotos.map((entry) => entry.id))
  const closedRecords = records.filter((record) => !open.has(record.id))
  const line = queueLine(queue)
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
      {!ownPhotos.length && (
        <p className="text-xs leading-5 text-muted-foreground">
          JPEG, PNG, WebP or HEIC, an iPhone’s own format, decoded here where the browser cannot show it; nothing is
          uploaded. Each photo becomes a field record. Its EXIF gives the starting camera, and a queue then searches
          each photo’s camera in time order by itself. Nothing is accepted until you check it and say so.
        </p>
      )}

      {ownPhotos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Queue">
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
      )}

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
          running={queue.running === photo.own.id}
        />
      )}

      {closedRecords.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium">Photographs in Field records</p>
          <ul className="divide-y divide-border/70 rounded-md border border-border">
            {closedRecords.map((record) => (
              <li key={record.id} className="flex items-center gap-3 px-2 py-1.5 text-xs">
                <img src={record.image} alt="" className="h-9 w-14 shrink-0 rounded-sm object-cover" />
                <span className="min-w-0 flex-1 truncate">{record.name}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch:h-10"
                  aria-label={`Open ${record.name}`}
                  onClick={() => photo.openOwnRecord(record, roadView)}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** One frame in the strip: its picture, its time, and a dot for where the queue has it. */
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
  const status = entry?.status ?? 'queued'
  const when = timeOf(photo.takenAtUtc)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`${photo.name}: ${PHOTO_STATUS_TEXT[status]}${lapsed ? ', acceptance lapsed' : ''}${active ? ', open' : ''}`}
      className={cn(
        'block w-full overflow-hidden rounded-md border text-left transition-colors',
        active ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/60',
      )}
    >
      <img src={photo.src} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
      <span className="flex items-center gap-1.5 px-1.5 py-1 text-2xs">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[status])} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{photo.name}</span>
        {when && <span className="shrink-0 text-muted-foreground tabular-nums">{when}</span>}
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
}: {
  own: OwnPhoto
  entry: PhotoQueueEntry
  running: boolean
  onRerun: () => void
}) {
  return (
    <section className="space-y-1.5 rounded-md border border-border p-2 text-xs" aria-label="Open photo">
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[entry.status])} aria-hidden />
        <p className="min-w-0 flex-1 truncate">
          <span className="font-medium">{own.name}</span>
          {own.frameIndex !== null && <span className="text-muted-foreground"> · frame {own.frameIndex + 1}</span>}
          <span className="text-muted-foreground"> · {PHOTO_STATUS_TEXT[entry.status]}</span>
        </p>
        <Button type="button" variant="ghost" size="xs" className="touch:h-10" disabled={running} onClick={onRerun}>
          <RotateCcw className="h-3.5 w-3.5" />
          Search again
        </Button>
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
