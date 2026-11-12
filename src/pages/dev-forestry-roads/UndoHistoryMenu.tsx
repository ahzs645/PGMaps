import { useState } from 'react'
import { Bookmark, History as HistoryIcon, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { ToolbarPopover } from '@/components/ui/toolbar-popover'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { roadFieldClass } from './Controls'
import { MAX_CHECKPOINT_NAME, MAX_UNDO_STEPS, splitHistoryLabel, type HistoryRow } from './undoHistory'

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export interface UndoHistoryProps {
  /** Read when the panel is open: the list is worked out from the project states, not kept. */
  rows: () => HistoryRow[]
  onGo: (steps: number) => void
  checkpoints: readonly { id: string; name: string; at: number }[]
  onSaveCheckpoint: (name: string) => string
  onRestoreCheckpoint: (id: string) => void
  onDeleteCheckpoint: (id: string) => void
  disabled?: boolean
}

/**
 * The edit history behind Undo and Redo, newest first, each step named by what it changed; choosing
 * one undoes or redoes to it. Checkpoints name the current state to come back to in this session.
 */
export function UndoHistoryPanel({
  rows,
  onGo,
  checkpoints,
  onSaveCheckpoint,
  onRestoreCheckpoint,
  onDeleteCheckpoint,
  disabled,
}: UndoHistoryProps) {
  const [name, setName] = useState('')
  const [saved, setSaved] = useState('')
  const list = [...rows()].reverse()
  const heading = 'text-3xs font-semibold uppercase tracking-wide text-muted-foreground'
  return (
    <div className="grid gap-3 p-2 text-xs" data-testid="road-undo-history">
      <section className="grid gap-1.5">
        <div className="flex items-center gap-1.5">
          <h3 className={heading}>Edit history</h3>
          <InfoTip label="About the edit history">
            Choose a step to return to the project as it was after it. Later steps stay available to redo until you make
            a new edit. The last {MAX_UNDO_STEPS} steps are kept in this tab only; edits made in quick succession count
            as one.
          </InfoTip>
        </div>
        {list.length <= 1 ? (
          <p className="text-muted-foreground">No edits to undo yet.</p>
        ) : (
          <ol
            className={cn(
              insetBox({ padding: 'none', tone: 'background' }),
              'max-h-64 divide-y overflow-y-auto overscroll-none',
            )}
          >
            {list.map((row) => {
              const now = row.offset === 0
              const { change, road } = splitHistoryLabel(row.label)
              return (
                <li key={row.offset}>
                  <button
                    type="button"
                    disabled={disabled || now}
                    // The newest step to undo takes focus when the panel opens, not the (i) above it.
                    data-autofocus={row.offset === -1 || undefined}
                    aria-current={now ? 'step' : undefined}
                    aria-label={
                      now ? `${row.label}, current state` : `${row.offset < 0 ? 'Undo' : 'Redo'} to: ${row.label}`
                    }
                    title={row.label}
                    className={`flex w-full items-baseline gap-2 px-2 py-1.5 text-left enabled:hover:bg-muted/60 ${
                      now ? 'bg-primary/10 font-medium' : row.offset > 0 ? 'text-muted-foreground' : ''
                    }`}
                    onClick={() => onGo(row.offset)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{change}</span>
                      {road && (
                        <span className="block truncate text-3xs font-normal text-muted-foreground">{road}</span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-3xs text-muted-foreground">
                      {now ? 'Now' : row.offset > 0 ? 'Redo' : row.at === null ? '' : time(row.at)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </section>
      <section className="grid gap-1.5">
        <div className="flex items-center gap-1.5">
          <h3 className={heading}>Checkpoints</h3>
          <InfoTip label="About checkpoints">
            A checkpoint names the project as it is now. Returning to one is itself an edit, so Undo takes you back.
            Checkpoints last until the tab closes or another project opens; to keep a version, duplicate the road or
            save the project file.
          </InfoTip>
        </div>
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            setSaved(onSaveCheckpoint(name))
            setName('')
          }}
        >
          <input
            className={roadFieldClass}
            aria-label="Checkpoint name"
            placeholder={`Checkpoint ${checkpoints.length + 1}`}
            maxLength={MAX_CHECKPOINT_NAME}
            data-autofocus
            value={name}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" size="field" variant="outline" className="shrink-0" disabled={disabled}>
            <Bookmark className="size-3.5" />
            Save
          </Button>
        </form>
        {saved && (
          <p role="status" className="text-muted-foreground">
            Saved checkpoint {saved}.
          </p>
        )}
        {checkpoints.length > 0 && (
          <ul className={cn(insetBox({ padding: 'none', tone: 'background' }), 'divide-y')}>
            {checkpoints.map((checkpoint) => (
              <li key={checkpoint.id} className="flex items-center gap-1 py-0.5 pl-2 pr-0.5">
                <span className="min-w-0 flex-1 truncate" title={checkpoint.name}>
                  {checkpoint.name}
                </span>
                <span className="shrink-0 tabular-nums text-3xs text-muted-foreground">{time(checkpoint.at)}</span>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`Return to checkpoint ${checkpoint.name}`}
                  onClick={() => onRestoreCheckpoint(checkpoint.id)}
                >
                  Return
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Delete checkpoint ${checkpoint.name}`}
                  title="Delete checkpoint"
                  onClick={() => onDeleteCheckpoint(checkpoint.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** The header's history button beside Undo and Redo. */
export function UndoHistoryButton(props: UndoHistoryProps) {
  return (
    <ToolbarPopover
      label="Edit history and checkpoints"
      icon={<HistoryIcon className="size-4" />}
      align="end"
      width={300}
      buttonClassName="size-8"
    >
      <UndoHistoryPanel {...props} />
    </ToolbarPopover>
  )
}
