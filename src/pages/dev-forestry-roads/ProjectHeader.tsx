import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { Notification } from '@/components/ui/notification'
import { clockText, saveStateText, type BrowserSave, type FileSave } from './saveState'

/** Long enough to read on arrival; the header's save line carries the same fact afterwards. */
const RESTORED_NOTICE_MS = 12_000

/**
 * The open project's name in the header line. A click turns it into a field: Enter or leaving it
 * renames the project, Escape keeps the old name.
 */
export function ProjectName({
  name,
  onRename,
  disabled = false,
}: {
  name: string
  onRename: (name: string) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    const next = draft?.trim()
    if (next && next !== name) onRename(next.slice(0, 200))
    setDraft(null)
  }
  if (draft !== null)
    return (
      <input
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        aria-label="Project name"
        data-testid="road-project-name-field"
        className="h-6 min-w-0 max-w-64 flex-1 rounded-md border border-input bg-background px-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={draft}
        maxLength={200}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(null)
        }}
      />
    )
  return (
    <button
      type="button"
      disabled={disabled}
      data-testid="road-project-name"
      title={`${name} · click to rename the project`}
      aria-label={`Project: ${name}. Rename`}
      className="group flex min-w-[5rem] max-w-[14rem] items-center gap-1 rounded-md px-1 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
      onClick={() => setDraft(name)}
    >
      <span className="truncate">{name || 'Untitled road project'}</span>
      <Pencil aria-hidden className="size-3 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100" />
    </button>
  )
}

/** Where the open project is kept: the browser save and its time, and whether a file holds it. */
export function SaveStateLine({ browser, file }: { browser: BrowserSave; file: FileSave | null }) {
  // "Now" only decides whether a time needs its date. It is the latest save, moved on once a minute.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const latest = Math.max('at' in browser ? browser.at : 0, file?.at ?? 0)
  const state = saveStateText(browser, file, Math.max(latest, tick))
  return (
    <span
      data-testid="road-save-state"
      data-save={browser.kind}
      title={state.detail}
      className={`block truncate text-xs ${
        state.tone === 'danger' ? 'text-danger' : state.tone === 'warning' ? 'text-warning' : 'text-muted-foreground'
      }`}
    >
      {/* Beside the road switcher the line is narrow below a wide desktop; the short form fits it. */}
      <span className="xl:hidden">{state.short}</span>
      <span className="hidden xl:inline">{state.text}</span>
      <span className="sr-only">. {state.detail}</span>
    </span>
  )
}

/**
 * The header's second line. A notice shows on one line, with the whole message behind an (i) when
 * the line cannot show it, and stays put while the pointer or focus is on it so it can be read
 * before it clears. With no notice the line shows `idle`: the save state.
 */
export function HeaderStatus({ notice, idle }: { notice: string; idle: ReactNode }) {
  const [held, setHeld] = useState('')
  const [holding, setHolding] = useState(false)
  if (notice && notice !== held) setHeld(notice)
  if (!notice && !holding && held) setHeld('')
  const shown = notice || (holding ? held : '')
  const line = useRef<HTMLParagraphElement>(null)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const element = line.current
    if (!element) return
    const measure = () => setClipped(element.scrollWidth > element.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [shown])
  return (
    <div
      className="road-workspace-status flex min-w-0 max-w-[58vw] items-center gap-1"
      onPointerEnter={() => setHolding(true)}
      onPointerLeave={() => setHolding(false)}
      onFocus={() => setHolding(true)}
      onBlur={() => setHolding(false)}
    >
      {/* Always mounted, so a new notice is announced; empty, it takes no room. */}
      <p
        ref={line}
        role="status"
        aria-live="polite"
        title={shown || undefined}
        className={`min-w-0 truncate text-xs text-teal-700 dark:text-teal-400 ${shown ? '' : 'hidden'}`}
      >
        {shown}
      </p>
      {shown && clipped && (
        <InfoTip label="Read the whole message" bubbleClassName="max-w-sm">
          {shown}
        </InfoTip>
      )}
      {!shown && idle}
    </div>
  )
}

/** Says once, in the shared notification stack, that the last session's project was reopened. */
export function SessionRestoredNotice({
  restored,
  onDismiss,
}: {
  restored: { name: string; savedAt: number | null; restoredAt: number } | null
  onDismiss: () => void
}) {
  if (!restored) return null
  return (
    <Notification
      id="road-session-restored"
      data-testid="road-session-restored"
      tone="info"
      title="Previous session restored"
      message={`${restored.name}${restored.savedAt === null ? '' : `, saved in this browser ${clockText(restored.savedAt, restored.restoredAt)}`}. Your other projects are under Projects.`}
      duration={RESTORED_NOTICE_MS}
      onDismiss={onDismiss}
      dismissLabel="Dismiss the restored-session notice"
    />
  )
}

/**
 * A first visit opens on an example road. This card says so and offers the two ways to start real
 * work; it stays until it is dismissed or another project is opened.
 */
export function ExampleStartNotice({
  show,
  onNewProject,
  onOpenFile,
  onDismiss,
}: {
  show: boolean
  onNewProject: () => void
  onOpenFile: () => void
  onDismiss: () => void
}) {
  if (!show) return null
  return (
    <Notification
      id="road-example-start"
      data-testid="road-example-start"
      tone="info"
      title="This is an example road"
      message="Explore it, or start your own project. Your work is saved in this browser as you go."
      actions={
        <>
          <Button size="xs" onClick={onNewProject}>
            New project
          </Button>
          <Button size="xs" variant="outline" onClick={onOpenFile}>
            Open a project file
          </Button>
        </>
      }
      onDismiss={onDismiss}
      dismissLabel="Dismiss the example notice"
    />
  )
}
