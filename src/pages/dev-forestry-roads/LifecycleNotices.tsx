import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { Notification } from '@/components/ui/notification'
import type { LibraryEntry } from './projectLibrary'
import type { RemovedRoad } from './roadLifecycle'
import { clockText } from './saveState'

/** Long enough to notice and reach Undo; the header's Undo button still works afterwards. */
const ROAD_REMOVED_NOTICE_MS = 10_000

/** Says which road was deleted and which one is shown now, with a way back. */
export function RoadRemovedNotice({
  removed,
  shownName,
  onUndo,
  onDismiss,
}: {
  removed: RemovedRoad | null
  /** The road shown now; null when the last road went and the design is empty. */
  shownName: string | null
  onUndo: () => void
  onDismiss: () => void
}) {
  if (!removed) return null
  return (
    <Notification
      id={`road-removed-${removed.road.id}`}
      data-testid="road-removed-notice"
      tone="info"
      // The shared stack runs the clock, and holds it while the pointer or focus is on a notice,
      // so Undo cannot vanish from under the pointer.
      duration={ROAD_REMOVED_NOTICE_MS}
      title={`Deleted ${removed.road.name}`}
      message={shownName === null ? 'No roads left: peg or sketch one.' : `Now showing ${shownName}.`}
      action={
        <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" onClick={onUndo}>
          Undo
        </Button>
      }
      onDismiss={onDismiss}
      dismissLabel="Dismiss the deleted-road notice"
    />
  )
}

/**
 * A project file whose name matches a project already saved in this browser. Opening it as a new
 * project left two with one name; the person chooses which they mean.
 */
export function ProjectFileConflictDialog({
  conflict,
  onReplace,
  onKeepBoth,
  onCancel,
  portalContainer,
}: {
  conflict: { fileName: string; existing: LibraryEntry; keepBothName: string; openedAt: number } | null
  onReplace: () => void
  onKeepBoth: () => void
  onCancel: () => void
  portalContainer?: HTMLElement | null
}) {
  return (
    <PanelDialog
      open={!!conflict}
      onOpenChange={(open) => !open && onCancel()}
      title="A project with this name is already saved"
      size="md"
      portalContainer={portalContainer}
      contentProps={{ 'data-testid': 'road-project-file-conflict' }}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onKeepBoth}>
            Keep both
          </Button>
          <Button onClick={onReplace}>Replace saved project</Button>
        </div>
      }
    >
      {conflict && (
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium">{conflict.fileName}</span> holds a project named{' '}
            <span className="font-medium">{conflict.existing.name}</span>. This browser already has one with that name,
            last edited {clockText(conflict.existing.updatedAt, conflict.openedAt)}.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Replace saved project</span> opens the file in its place.
              The version saved in this browser is overwritten.
            </li>
            <li>
              <span className="font-medium text-foreground">Keep both</span> opens the file as{' '}
              <span className="font-medium text-foreground">{conflict.keepBothName}</span> and leaves the saved one as
              it is.
            </li>
          </ul>
        </div>
      )}
    </PanelDialog>
  )
}
