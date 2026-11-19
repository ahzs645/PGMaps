/**
 * The contents of a printed file, as one list in print order (`docs/shared-ui.md`, **Document
 * contents**): what each part is set to, a preview beside it, the order and the presets. Every output
 * with a contents section uses it, never a page's own checkbox grid, placement dropdown grid or
 * up/down list. The rules (which moves are allowed, counts, sentences, stored orders) are
 * `src/lib/documentContents/contents.ts`, free of DOM access; this file only draws them.
 */
import { Check, GripVertical, Lock, Minus, MoreHorizontal } from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmRemoveButton } from '@/components/ui/confirm-remove'
import { CheckboxField, FORM_INPUT_CLASS } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StyledSelect } from '@/components/ui/styled-select'
import { SelectAllActions, TextButton } from '@/components/ui/text-button'
import { useElementSize } from '@/hooks/useElementSize'
import { useSizeFold, type FoldThresholds } from '@/hooks/useSizeFold'
import {
  ON_OFF,
  canMove,
  contentsCounts,
  contentsSummary,
  dragTargetIndex,
  isTwoState,
  moveAnnouncement,
  moveRange,
  moveTargets,
  movedOrder,
  onOffValues,
  partPrints,
  partSwitchable,
  type ContentsChoice,
  type ContentsGroup,
  type ContentsPart,
  type ContentsPreset,
  type MoveTargets,
} from '@/lib/documentContents/contents'
import { MAX_SAVED_CONTENTS_NAME } from '@/lib/documentContents/savedContents'
import { cn } from '@/lib/utils'

/**
 * Where the list and the preview sit side by side. Folding changes nothing the element is measured
 * on (its width is its parent's), so the gap only keeps a pane dragged across the line from
 * flickering.
 */
export const CONTENTS_FOLD: FoldThresholds = { foldBelow: 640, unfoldFrom: 680 }

/** How far the pointer travels on a grip before a press becomes a drag, so a click stays a click. */
export const DRAG_THRESHOLD_PX = 4
/** How close to a scroller's edge a drag scrolls it, and the most it scrolls in a frame. */
const AUTO_SCROLL_EDGE_PX = 32
const AUTO_SCROLL_MAX_STEP_PX = 14
/** How long a moved row keeps waiting for its new place before focus is left alone. */
const FOCUS_WAIT_MS = 1500

type DataAttributes = { [key: `data-${string}`]: string | number | boolean | undefined }

export type DocumentContentsProps = {
  /** The heading. Default "Contents". */
  title?: string
  /** What is printed, for accessible names: "the report", "the package". */
  subject: string
  /** In print order. */
  parts: readonly ContentsPart[]
  groups?: readonly ContentsGroup[]
  /** Default `ON_OFF`. Two choices draw a checkbox; more draw a compact dropdown per row. */
  choices?: readonly ContentsChoice[]
  /** For a multi-choice row's control name, `${part.label}: ${stateLabel}`: "where it goes". */
  stateLabel?: string
  /** Absent: the list is read-only. */
  onState?: (key: string, state: string) => void
  /** All / None in one write (two-state lists only). */
  onStates?: (changes: Record<string, string>) => void
  /** Absent: fixed order, no grips. `order` is the whole key order after the move. */
  onMove?: (key: string, toIndex: number, order: string[]) => void
  /** Shown as "Usual order" only when given. */
  onResetOrder?: () => void
  onRemove?: (key: string) => void
  add?: {
    label: string
    options: ReadonlyArray<{ id: string; label: string; group?: string }>
    onAdd: (id: string) => void
  }
  presets?: {
    options: readonly ContentsPreset[]
    /** null: none matches. */
    value: string | null
    /** The chosen preset has been changed since: shown as "Name · modified". */
    modified?: boolean
    onChoose: (id: string) => void
    /** Back to the chosen preset, or to the defaults. */
    onReset?: () => void
    /** "Save as preset…": a small name field in place. */
    onSaveAs?: (name: string) => void
    /** Saved presets only, asked once. */
    onDelete?: (id: string) => void
    /** What the delete question says happens next. Default: removed from this browser, the contents kept as they are. */
    deleteDetail?: string
  }
  /** The part whose preview is shown. */
  selected?: string | null
  onSelect?: (key: string | null) => void
  /** The caller's preview of the selected part, or of the whole document when none is selected. */
  preview?: ReactNode
  /** The heading over the preview when no part is selected: "Whole report". */
  previewLabel?: string
  /** Bring this row into view and ring it (a click on a heading in a preview). */
  focusKey?: string
  /** A caller's own small control at the row's end ("Edit", "Sheet setup"). */
  rowAction?: (part: ContentsPart) => ReactNode
  /**
   * A small picture that leads the row (a view's thumbnail), drawn after the state control and before the name, at
   * the fixed size the caller gives it. It is decoration: it is hidden from the row's accessible name, so say
   * anything it shows in the part's `detail` or `note` too. Return null for a row without one.
   */
  rowLead?: (part: ContentsPart) => ReactNode
  /** Behind an (i) beside the title. */
  help?: ReactNode
  /** Replaces the computed count line. */
  summary?: string
  /** The caller's own controls that belong with the contents, drawn under the list. */
  beside?: ReactNode
  /** The caller's own small links in the heading's line, after All / None ("Edit here", "Change in Package"). */
  actions?: ReactNode
  className?: string
} & DataAttributes

/** Which control in a row had focus, so it gets it back after the row moves. */
type FocusKind = 'grip' | 'state' | 'name' | 'menu' | 'any'

type PendingFocus = { key: string; kind: FocusKind; order: string }

type DragSession = {
  key: string
  pointerId: number
  grip: HTMLElement
  startY: number
  lastY: number
  from: number
  to: number
  range: { from: number; to: number }
  started: boolean
  scroller: HTMLElement | null
  frame: number
  userSelect: string
  onKey: (event: KeyboardEvent) => void
}

const HEADING = 'text-3xs font-semibold uppercase tracking-wide text-muted-foreground'
const ICON_BUTTON =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 touch:size-9'
const ROW_SELECT_CLASS =
  'w-32 shrink-0 rounded-md border border-input bg-background px-1.5 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 touch:py-2'
const CUSTOM_PRESET = '\u0000custom'

/** Undoes what a drag changed outside React: its frame loop, its Escape listener, text selection and pointer capture. */
function releaseSession(current: DragSession) {
  cancelAnimationFrame(current.frame)
  window.removeEventListener('keydown', current.onKey, true)
  if (current.started) document.body.style.userSelect = current.userSelect
  if (current.grip.hasPointerCapture?.(current.pointerId)) current.grip.releasePointerCapture(current.pointerId)
}

/** The nearest ancestor that scrolls vertically, or the page's own scroller. */
function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return (document.scrollingElement as HTMLElement | null) ?? null
}

function rowElements(root: HTMLElement | null): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>()
  root?.querySelectorAll<HTMLElement>('[data-contents-row]').forEach((row) => {
    const key = row.dataset.contentsRow
    if (key !== undefined) rows.set(key, row)
  })
  return rows
}

function focusTarget(row: HTMLElement, kind: FocusKind): HTMLElement | null {
  const own = (selector: string) => row.querySelector<HTMLElement>(selector)
  return (
    (kind === 'state'
      ? (own('[data-contents-state] [data-select-trigger]') ?? own('[data-contents-focus="state"]'))
      : null) ??
    (kind !== 'any' ? own(`[data-contents-focus="${kind}"]`) : null) ??
    own('[data-contents-focus]') ??
    own('[data-contents-state] [data-select-trigger]')
  )
}

const kindOf = (target: EventTarget | null): FocusKind => {
  const element = target as { closest?: (selector: string) => Element | null } | null
  const marked = typeof element?.closest === 'function' ? element.closest('[data-contents-focus]') : null
  const kind = marked?.getAttribute('data-contents-focus')
  if (kind === 'grip' || kind === 'state' || kind === 'name' || kind === 'menu') return kind
  return typeof element?.closest === 'function' && element.closest('[data-contents-state]') ? 'state' : 'any'
}

/** Consecutive parts of one group, each run drawn under its group's heading. */
function groupRuns(parts: readonly ContentsPart[]) {
  const runs: Array<{ group?: string; start: number; parts: ContentsPart[] }> = []
  parts.forEach((part, index) => {
    const last = runs[runs.length - 1]
    if (last && last.group === part.group) last.parts.push(part)
    else runs.push({ group: part.group, start: index, parts: [part] })
  })
  return runs
}

export function DocumentContents({
  title = 'Contents',
  subject,
  parts,
  groups,
  choices = ON_OFF,
  stateLabel = 'state',
  onState,
  onStates,
  onMove,
  onResetOrder,
  onRemove,
  add,
  presets,
  selected = null,
  onSelect,
  preview,
  previewLabel,
  focusKey,
  rowAction,
  rowLead,
  help,
  summary,
  beside,
  actions,
  className,
  ...data
}: DocumentContentsProps) {
  const id = useId()
  const rootRef = useRef<HTMLElement>(null)
  const { width } = useElementSize(rootRef)
  const stacked = useSizeFold(width, CONTENTS_FOLD, true)
  const sideBySide = preview !== undefined && !stacked
  const [announcement, setAnnouncement] = useState('')
  const [drag, setDrag] = useState<{ key: string; from: number; to: number } | null>(null)
  const session = useRef<DragSession | null>(null)
  const pendingFocus = useRef<PendingFocus | null>(null)

  const twoState = isTwoState(choices)
  const onOff = onOffValues(choices)
  const editable = !!onState
  const order = parts.map((part) => part.key).join('\u0000')
  const counts = contentsCounts(parts, choices)
  const switchable = parts.filter(partSwitchable)
  const groupTitle = (groupId: string | undefined) => groups?.find((group) => group.id === groupId)

  // A moved row is put back in focus once it stands in its new place.
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    const row = rowElements(rootRef.current).get(pending.key)
    const target = row ? focusTarget(row, pending.kind) : null
    if (target && document.activeElement !== target) target.focus({ preventScroll: false })
    if (order !== pending.order) pendingFocus.current = null
  })

  useEffect(() => {
    if (!focusKey) return
    const row = rowElements(rootRef.current).get(focusKey)
    if (!row) return
    row.scrollIntoView?.({ block: 'nearest' })
    focusTarget(row, 'state')?.focus?.({ preventScroll: true })
  }, [focusKey])

  const endDrag = (commit: boolean) => {
    const current = session.current
    if (!current) return
    session.current = null
    releaseSession(current)
    setDrag(null)
    if (commit && current.started && current.to !== current.from) move(current.key, current.to, 'grip')
  }

  // A drag still running when the list goes away gives the page back its text selection and keys.
  useEffect(() => {
    const sessions = session
    return () => {
      const current = sessions.current
      sessions.current = null
      if (current) releaseSession(current)
    }
  }, [])

  /** Puts focus on a row once it stands in its new place; a parent that never moves it lets go after a moment. */
  function awaitFocus(pending: PendingFocus) {
    pendingFocus.current = pending
    globalThis.setTimeout(() => {
      if (pendingFocus.current === pending) pendingFocus.current = null
    }, FOCUS_WAIT_MS)
  }

  function move(key: string, toIndex: number, kind: FocusKind) {
    if (!onMove) return
    const next = movedOrder(parts, key, toIndex)
    if (!next) return
    const from = parts.findIndex((part) => part.key === key)
    awaitFocus({ key, kind, order })
    setAnnouncement(moveAnnouncement(parts[from].label, from, toIndex, parts.length))
    onMove(key, toIndex, next)
  }

  const remove = (key: string) => {
    if (!onRemove) return
    const index = parts.findIndex((part) => part.key === key)
    const neighbour = parts[index + 1] ?? parts[index - 1]
    if (neighbour) awaitFocus({ key: neighbour.key, kind: 'any', order })
    setAnnouncement(`${parts[index]?.label ?? 'Part'} removed`)
    onRemove(key)
  }

  const retarget = (current: DragSession) => {
    const rows = rowElements(rootRef.current)
    const mids = parts.map((part) => {
      const rect = rows.get(part.key)?.getBoundingClientRect()
      return rect ? rect.top + rect.height / 2 : Number.NaN
    })
    const to = dragTargetIndex(mids, current.lastY, current.from, current.range)
    if (to === current.to) return
    current.to = to
    setDrag({ key: current.key, from: current.from, to })
  }

  const autoScroll = () => {
    const current = session.current
    if (!current) return
    const scroller = current.scroller
    if (scroller) {
      const isPage = scroller === document.scrollingElement
      const top = isPage ? 0 : scroller.getBoundingClientRect().top
      const bottom = isPage ? window.innerHeight : scroller.getBoundingClientRect().bottom
      const step = (depth: number) =>
        Math.ceil((AUTO_SCROLL_MAX_STEP_PX * Math.min(AUTO_SCROLL_EDGE_PX, depth)) / AUTO_SCROLL_EDGE_PX)
      if (current.lastY < top + AUTO_SCROLL_EDGE_PX)
        scroller.scrollTop -= step(top + AUTO_SCROLL_EDGE_PX - current.lastY)
      else if (current.lastY > bottom - AUTO_SCROLL_EDGE_PX)
        scroller.scrollTop += step(current.lastY - (bottom - AUTO_SCROLL_EDGE_PX))
      retarget(current)
    }
    current.frame = requestAnimationFrame(autoScroll)
  }

  const gripDown = (event: ReactPointerEvent<HTMLButtonElement>, part: ContentsPart, index: number) => {
    if (!onMove || event.button !== 0 || session.current) return
    const range = moveRange(parts, part.key)
    if (!range || range.to === range.from) return
    const grip = event.currentTarget
    grip.setPointerCapture?.(event.pointerId)
    session.current = {
      key: part.key,
      pointerId: event.pointerId,
      grip,
      startY: event.clientY,
      lastY: event.clientY,
      from: index,
      to: index,
      range,
      started: false,
      scroller: null,
      frame: 0,
      userSelect: '',
      onKey: (key) => {
        if (key.key !== 'Escape') return
        key.preventDefault()
        key.stopPropagation()
        endDrag(false)
      },
    }
  }

  const gripMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = session.current
    if (!current || current.pointerId !== event.pointerId) return
    current.lastY = event.clientY
    if (!current.started) {
      if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD_PX) return
      current.started = true
      current.userSelect = document.body.style.userSelect
      document.body.style.userSelect = 'none'
      current.scroller = scrollParent(current.grip)
      window.addEventListener('keydown', current.onKey, true)
      current.frame = requestAnimationFrame(autoScroll)
      setDrag({ key: current.key, from: current.from, to: current.from })
    }
    event.preventDefault()
    retarget(current)
  }

  const rowKeys = (event: ReactKeyboardEvent<HTMLElement>, part: ContentsPart) => {
    if (!onMove || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    const targets = moveTargets(parts, part.key)
    event.preventDefault()
    event.stopPropagation()
    const to = event.key === 'ArrowUp' ? targets.up : targets.down
    if (to !== null) move(part.key, to, kindOf(event.target))
  }

  const setAll = (state: string) => {
    if (!onStates) return
    const changes: Record<string, string> = {}
    for (const part of switchable) if (part.state !== state) changes[part.key] = state
    if (Object.keys(changes).length) onStates(changes)
  }
  const groupSwitch = twoState && editable && !!onStates && !!onOff

  const reorderable = !!onMove && parts.some((part) => canMove(parts, part.key))
  const hasMenus = parts.some((part) => (reorderable && canMove(parts, part.key)) || (part.removable && !!onRemove))
  const selectedPart = selected ? parts.find((part) => part.key === selected) : undefined
  // A read-only list says which parts print only when they differ: a tick on every row says nothing.
  const marks = editable || parts.some((part) => !!part.locked || !!part.unavailable || !partPrints(part, choices))

  const renderRow = (part: ContentsPart, index: number) => {
    const prints = partPrints(part, choices)
    const movable = reorderable && canMove(parts, part.key)
    const removable = !!part.removable && !!onRemove
    const targets = movable ? moveTargets(parts, part.key) : null
    const isSelected = selected === part.key
    const ringed = focusKey === part.key
    const dragged = drag?.key === part.key
    const lineAbove = !!drag && drag.to !== drag.from && drag.to === index && drag.to < drag.from
    const lineBelow = !!drag && drag.to !== drag.from && drag.to === index && drag.to > drag.from
    // A locked or unavailable part's own text, then the caller's sentence about it, each on its line.
    const noteLines = [part.locked ?? part.unavailable, part.note].filter((line): line is string => !!line)
    const note =
      noteLines.length > 1 ? (
        <>
          {noteLines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </>
      ) : (
        (noteLines[0] ?? null)
      )
    const noteId = `${id}-note-${index}`
    const lead = rowLead?.(part) ?? null
    const leadBox =
      lead === null ? null : (
        <span aria-hidden="true" data-contents-lead="" className="flex shrink-0">
          {lead}
        </span>
      )
    const nameClass = cn('min-w-0 break-words text-left', !prints && 'text-muted-foreground')
    const name = onSelect ? (
      <button
        type="button"
        data-contents-focus="name"
        aria-pressed={isSelected}
        className={cn(
          nameClass,
          'rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isSelected && 'font-medium text-foreground',
        )}
        onClick={() => onSelect(isSelected ? null : part.key)}
      >
        {part.label}
      </button>
    ) : (
      <span className={nameClass}>{part.label}</span>
    )
    const choice = choices.find((entry) => entry.value === part.state)
    let control: ReactNode
    if (part.locked) {
      control = <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    } else if (!editable && twoState && !marks) {
      control = null
    } else if (!editable) {
      control = twoState ? (
        prints ? (
          <Check role="img" className="size-3.5 shrink-0 text-foreground" aria-label={choice?.label ?? part.state} />
        ) : (
          <Minus
            role="img"
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-label={choice?.label ?? part.state}
          />
        )
      ) : (
        <span className="w-24 shrink-0 text-2xs text-muted-foreground">{choice?.label ?? part.state}</span>
      )
    } else if (twoState && onOff) {
      // A picture leading the row goes inside the checkbox's label, so a click on it toggles the part, with the note
      // beside it under the name; hidden from the name, the note still describes the checkbox.
      const ledLabel =
        leadBox === null ? null : (
          <span className="flex min-w-0 items-center gap-2">
            {leadBox}
            <span className="flex min-w-0 flex-col">
              {name}
              {note && (
                <span id={noteId} aria-hidden="true" className="text-2xs text-muted-foreground">
                  {note}
                </span>
              )}
            </span>
          </span>
        )
      control = (
        <CheckboxField
          data-contents-focus="state"
          label={onSelect ? <span className="sr-only">{part.label}</span> : (ledLabel ?? name)}
          description={onSelect || ledLabel ? undefined : note}
          aria-describedby={ledLabel && note ? noteId : undefined}
          checked={part.state === onOff.on && !part.unavailable}
          disabled={!!part.unavailable}
          onCheckedChange={(checked) => onState?.(part.key, checked ? onOff.on : onOff.off)}
          className={onSelect ? 'shrink-0' : 'min-w-0 flex-1'}
          labelClassName={onSelect ? 'gap-0' : 'items-center'}
          inputClassName="mt-0"
        />
      )
    } else {
      control = (
        <span data-contents-state="" className="shrink-0">
          <StyledSelect
            className={ROW_SELECT_CLASS}
            aria-label={`${part.label}: ${stateLabel}`}
            value={part.state}
            disabled={!!part.unavailable}
            onValueChange={(state) => onState?.(part.key, state)}
          >
            {choices.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </StyledSelect>
        </span>
      )
    }
    const nameInControl = editable && twoState && !part.locked && !onSelect
    // A dropdown, or the word a read-only list shows for it, follows the name; a tick, a lock and a
    // checkbox lead the row.
    const controlAfterName = !twoState && !part.locked
    return (
      <li
        key={part.key}
        data-contents-row={part.key}
        data-state={part.state}
        data-prints={prints ? 'true' : 'false'}
        data-focused={ringed ? 'true' : undefined}
        aria-current={isSelected ? 'true' : undefined}
        className={cn(
          'relative flex min-w-0 items-center gap-1.5 px-1.5 py-1 touch:py-1.5',
          isSelected && 'bg-selected',
          ringed && 'ring-2 ring-inset ring-primary/40',
          dragged && 'bg-muted opacity-70',
        )}
        onKeyDownCapture={(event) => rowKeys(event, part)}
      >
        {lineAbove && (
          <span aria-hidden className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded-full bg-primary" />
        )}
        {lineBelow && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary"
          />
        )}
        {reorderable &&
          (movable ? (
            <button
              type="button"
              data-contents-focus="grip"
              aria-label={`Move '${part.label}': drag, or Alt and an arrow key`}
              aria-roledescription="drag handle"
              className={cn(ICON_BUTTON, 'cursor-grab touch-none select-none', dragged && 'cursor-grabbing')}
              onPointerDown={(event) => gripDown(event, part, index)}
              onPointerMove={gripMove}
              onPointerUp={() => endDrag(true)}
              onPointerCancel={() => endDrag(false)}
              onLostPointerCapture={() => endDrag(false)}
            >
              <GripVertical className="size-3.5" aria-hidden="true" />
            </button>
          ) : (
            <span aria-hidden className="size-6 shrink-0 touch:size-9" />
          ))}
        {!controlAfterName && control}
        {!nameInControl && leadBox}
        {!nameInControl && (
          <div className="flex min-w-0 flex-1 flex-col">
            {name}
            {note && <span className="text-2xs text-muted-foreground">{note}</span>}
          </div>
        )}
        {part.detail && <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{part.detail}</span>}
        {controlAfterName && control}
        {part.help && (
          <InfoTip label={`About ${part.label}`} className="shrink-0">
            {part.help}
          </InfoTip>
        )}
        {rowAction?.(part)}
        {hasMenus &&
          (movable || removable ? (
            <RowMenu
              label={part.label}
              targets={targets}
              onMoveTo={(to) => move(part.key, to, 'menu')}
              onRemove={removable ? () => remove(part.key) : undefined}
            />
          ) : (
            <span aria-hidden className="size-6 shrink-0 touch:size-9" />
          ))}
      </li>
    )
  }

  const runs = groupRuns(parts)
  const list = (
    <div className={cn(insetBox({ padding: 'none' }), 'min-w-0 overflow-hidden', drag && 'select-none')}>
      {runs.map((run, runIndex) => {
        const group = groupTitle(run.group)
        const headingId = `${id}-group-${runIndex}`
        const runPrints = run.parts.filter((part) => partPrints(part, choices)).length
        const runSwitchable = run.parts.filter(partSwitchable)
        const allOn = !!onOff && runSwitchable.every((part) => part.state === onOff.on)
        const allOff = !!onOff && runSwitchable.every((part) => part.state !== onOff.on)
        return (
          <section
            key={`${run.group ?? ''}-${run.start}`}
            aria-labelledby={group ? headingId : undefined}
            aria-label={group ? undefined : `Parts of ${subject}`}
            className={cn(runIndex > 0 && 'border-t')}
          >
            {group && (
              <div className="flex min-w-0 items-center gap-2 bg-muted/40 px-2 py-1">
                {groupSwitch && onOff && runSwitchable.length > 0 && (
                  <input
                    type="checkbox"
                    aria-label={`Print every part of ${group.title}`}
                    checked={allOn}
                    ref={(element) => {
                      if (element) element.indeterminate = !allOn && !allOff
                    }}
                    onChange={() => {
                      const state = allOn ? onOff.off : onOff.on
                      const changes: Record<string, string> = {}
                      for (const part of runSwitchable) if (part.state !== state) changes[part.key] = state
                      onStates?.(changes)
                    }}
                    className="size-3.5 shrink-0 accent-primary"
                  />
                )}
                <h5 id={headingId} className={cn(HEADING, 'min-w-0 flex-1 truncate')}>
                  {group.title}
                </h5>
                <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                  {runPrints} of {run.parts.length}
                </span>
                {group.note && (
                  <InfoTip label={`About ${group.title}`} className="shrink-0">
                    {group.note}
                  </InfoTip>
                )}
              </div>
            )}
            <ul className="divide-y">{run.parts.map((part, at) => renderRow(part, run.start + at))}</ul>
          </section>
        )
      })}
      {!parts.length && <p className="px-2 py-2 text-xs text-muted-foreground">No parts.</p>}
    </div>
  )

  const addControl = add && add.options.length > 0 && (
    <StyledSelect
      aria-label={add.label}
      placeholder={add.label}
      value=""
      className={cn(FORM_INPUT_CLASS, 'py-1 md:text-xs')}
      onValueChange={(value) => value && add.onAdd(value)}
    >
      {add.options.map((option) => {
        const group = option.group ? (groupTitle(option.group)?.title ?? option.group) : undefined
        return group ? (
          <optgroup key={option.id} label={group}>
            <option value={option.id}>{option.label}</option>
          </optgroup>
        ) : (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        )
      })}
    </StyledSelect>
  )

  const header = (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className={HEADING}>{title}</h4>
        {help && <InfoTip label={`About ${title.toLowerCase()}`}>{help}</InfoTip>}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {twoState && editable && onStates && onOff && (
            <SelectAllActions
              onAll={() => setAll(onOff.on)}
              onNone={() => setAll(onOff.off)}
              allSelected={switchable.every((part) => part.state === onOff.on)}
              noneSelected={switchable.every((part) => part.state !== onOff.on)}
            />
          )}
          {onResetOrder && (
            <TextButton tone="muted" onClick={onResetOrder}>
              Usual order
            </TextButton>
          )}
          {actions}
        </span>
      </div>
      <p role="status" className="text-2xs text-muted-foreground">
        {summary ?? contentsSummary(counts)}
      </p>
      {presets && <PresetRow presets={presets} subject={subject} />}
    </div>
  )

  const listColumn = (
    <div className={cn('flex min-w-0 flex-col gap-2', sideBySide && 'min-h-0')}>
      {header}
      {/* A block, never a grid: the list hides its overflow, so a grid track would squeeze it to a few rows
          instead of letting this column scroll. */}
      <div className={cn('min-w-0 space-y-2', sideBySide && 'min-h-0 flex-1 overflow-y-auto')}>
        {list}
        {addControl}
        {beside}
      </div>
    </div>
  )

  return (
    <section
      ref={rootRef}
      aria-label={`${title} of ${subject}`}
      data-layout={preview === undefined ? 'list' : sideBySide ? 'side-by-side' : 'stacked'}
      className={cn(
        'min-w-0 text-xs',
        sideBySide
          ? 'grid h-full min-h-0 grid-cols-[minmax(19rem,9fr)_minmax(0,11fr)] grid-rows-[minmax(0,1fr)] gap-3'
          : 'grid gap-3',
        className,
      )}
      {...data}
    >
      {listColumn}
      {preview !== undefined && (
        <div
          data-contents-preview=""
          className={cn('flex min-w-0 flex-col gap-2', sideBySide ? 'min-h-0 border-l pl-3' : 'border-t pt-3')}
        >
          <div className="flex min-w-0 items-center gap-2">
            <h4 className={cn(HEADING, 'min-w-0 flex-1 truncate')}>
              {selectedPart?.label ?? previewLabel ?? 'Whole document'}
            </h4>
            {selectedPart && onSelect && (
              <TextButton className="shrink-0" onClick={() => onSelect(null)}>
                {previewLabel ?? 'Whole document'}
              </TextButton>
            )}
          </div>
          <div className={cn('min-w-0', sideBySide && 'min-h-0 flex-1 overflow-y-auto')}>{preview}</div>
        </div>
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  )
}

/** A row's ⋯ menu: the moves its place allows, and Remove for a part a person added. */
function RowMenu({
  label,
  targets,
  onMoveTo,
  onRemove,
}: {
  label: string
  targets: MoveTargets | null
  onMoveTo: (toIndex: number) => void
  onRemove?: () => void
}) {
  const [open, setOpen] = useState(false)
  const acted = useRef(false)
  const items: Array<{ id: string; text: string; name: string; to: number | null }> = targets
    ? [
        { id: 'up', text: 'Move up', name: `Move '${label}' up`, to: targets.up },
        { id: 'down', text: 'Move down', name: `Move '${label}' down`, to: targets.down },
        { id: 'top', text: 'Move to top', name: `Move '${label}' to top`, to: targets.top },
        { id: 'bottom', text: 'Move to bottom', name: `Move '${label}' to bottom`, to: targets.bottom },
      ]
    : []
  const act = (run: () => void) => {
    acted.current = true
    setOpen(false)
    run()
  }
  const itemClass =
    'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-50 touch:py-2.5'
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) acted.current = false
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-contents-focus="menu"
          aria-label={`Options for '${label}'`}
          aria-haspopup="menu"
          className={cn(ICON_BUTTON, open && 'bg-muted text-foreground')}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        role="menu"
        aria-label={`Options for '${label}'`}
        className="w-44 p-1"
        onCloseAutoFocus={(event) => {
          // A move or a removal puts focus back itself, on the row in its new place or its neighbour.
          if (acted.current) event.preventDefault()
        }}
        onKeyDown={(event) => {
          const options = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
          ]
          if (!options.length) return
          const at = options.indexOf(document.activeElement as HTMLButtonElement)
          const next =
            event.key === 'ArrowDown'
              ? (at + 1) % options.length
              : event.key === 'ArrowUp'
                ? (at - 1 + options.length) % options.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? options.length - 1
                    : null
          if (next === null) return
          event.preventDefault()
          options[next].focus()
        }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            aria-label={item.name}
            disabled={item.to === null}
            className={itemClass}
            onClick={() => item.to !== null && act(() => onMoveTo(item.to!))}
          >
            {item.text}
          </button>
        ))}
        {onRemove && (
          <>
            {items.length > 0 && <div role="separator" className="my-1 h-px bg-border" />}
            <button
              type="button"
              role="menuitem"
              aria-label={`Remove '${label}'`}
              className={cn(itemClass, 'text-danger')}
              onClick={() => act(onRemove)}
            >
              Remove
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** The preset row: the chosen preset ("· modified" once changed), Reset, Save as preset… and Delete for a saved one. */
function PresetRow({ presets, subject }: { presets: NonNullable<DocumentContentsProps['presets']>; subject: string }) {
  const id = useId()
  const [naming, setNaming] = useState<string | null>(null)
  const chosen = presets.value ? presets.options.find((option) => option.id === presets.value) : undefined
  const builtIn = presets.options.filter((option) => !option.saved)
  const saved = presets.options.filter((option) => option.saved)
  const label = (option: ContentsPreset) =>
    option.id === presets.value && presets.modified ? `${option.label} · modified` : option.label
  const name = naming?.trim() ?? ''
  const saveAs = () => {
    if (!name || !presets.onSaveAs) return
    presets.onSaveAs(name.slice(0, MAX_SAVED_CONTENTS_NAME))
    setNaming(null)
  }
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <label htmlFor={`${id}-preset`} className="shrink-0 font-medium">
          Preset
        </label>
        <StyledSelect
          id={`${id}-preset`}
          aria-label={`Preset for ${subject}`}
          className={cn(FORM_INPUT_CLASS, 'w-auto min-w-[10rem] flex-1 py-1 md:text-xs')}
          value={chosen ? chosen.id : CUSTOM_PRESET}
          onValueChange={(value) => value !== CUSTOM_PRESET && presets.onChoose(value)}
        >
          {!chosen && (
            <option value={CUSTOM_PRESET} disabled>
              Custom
            </option>
          )}
          {builtIn.map((option) => (
            <option key={option.id} value={option.id}>
              {label(option)}
            </option>
          ))}
          {saved.length > 0 && (
            <optgroup label="Saved in this browser">
              {saved.map((option) => (
                <option key={option.id} value={option.id}>
                  {label(option)}
                </option>
              ))}
            </optgroup>
          )}
        </StyledSelect>
        <span className="flex shrink-0 items-center gap-3">
          {presets.onReset && (
            <TextButton tone="muted" disabled={!presets.modified && !!chosen} onClick={presets.onReset}>
              Reset
            </TextButton>
          )}
          {presets.onSaveAs && naming === null && (
            <TextButton onClick={() => setNaming('')}>Save as preset…</TextButton>
          )}
          {presets.onDelete && chosen?.saved && (
            <ConfirmRemoveButton
              label={`Delete preset '${chosen.label}'`}
              question={`Delete the preset '${chosen.label}'?`}
              detail={presets.deleteDetail ?? 'It is removed from this browser. The contents stay as they are.'}
              confirmLabel="Delete"
              onConfirm={() => presets.onDelete?.(chosen.id)}
            >
              Delete
            </ConfirmRemoveButton>
          )}
        </span>
      </div>
      {naming !== null && (
        <form
          className="flex min-w-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            saveAs()
          }}
        >
          <input
            aria-label="Preset name"
            className={cn(FORM_INPUT_CLASS, 'min-w-0 flex-1 py-1 md:text-xs')}
            value={naming}
            maxLength={MAX_SAVED_CONTENTS_NAME}
            placeholder="Name"
            autoFocus
            onChange={(event) => setNaming(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              setNaming(null)
            }}
          />
          <Button type="submit" size="xs" disabled={!name}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => setNaming(null)}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  )
}
