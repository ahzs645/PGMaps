import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { FramePages } from '@/components/ui/frame-pages'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { PdfPages } from '@/components/ui/pdf-pages'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'

import { drawGroupOf } from './viaReport/draftPictures'
import type { MakeupRow } from './viaReport/recipeMakeup'

/** One picture group of the draft (`DraftPictureId`), as the draft lists it. */
export type DraftPicture = {
  id: string
  label: string
  /** `stand-in`: not drawn yet; `drawn`; `not-drawn`: drawn, but nothing came back (its note says why); `working`. */
  state: 'stand-in' | 'drawn' | 'not-drawn' | 'working'
  note: string | null
  /** The button's label, or null when there is nothing to press. */
  action: string | null
}

/** One part as the draft lists it: where it prints and what it leaves for the reviewer. */
export type DraftPart = {
  /** Its place in the recipe; the page marks it `part-<index>`. */
  index: number
  id: string
  title: string
  sources: readonly string[]
  printed: boolean
  toComplete: number
}

/** The VIA report's draft, built without capturing anything (`useVisualsExport`'s `buildDraft`). */
export type ReportDraftResult = {
  html: string
  parts: DraftPart[]
  pictures: DraftPicture[]
  makeup: MakeupRow[]
  toComplete: number
  notes: string[]
  /** Every value of the report that can be changed by hand, by its key on the page (`data-edit`). */
  editTargets: Readonly<Record<string, DraftEditTarget>>
  /** Edits kept for this recipe's parts whose place the report no longer prints. */
  orphanEdits: ReadonlyArray<{ key: string; value: string }>
}

/** One editable value of the draft (`viaReport/edits.ts`'s `EditTarget`, as the draft lists it). */
export type DraftEditTarget = {
  label: string
  kind: string
  /** What the part printed; null for a blank. */
  original: string | null
  /** The reviewer's edit, when there is one. */
  edited?: string
  /** A tick-box question's options. */
  options?: readonly string[]
}

/** The draft on the PDF's own pages: the file's writer run on the draft, stand-ins in place of pictures not drawn. */
export type ReportDraftPages = {
  blob: Blob
  /** The page each part starts on, by the part's place in the recipe. */
  partPages: number[]
  pages: number
}

const STATE_LABEL: Record<DraftPicture['state'], string> = {
  'stand-in': 'Stand-in',
  drawn: 'Drawn',
  'not-drawn': 'Not drawn',
  working: 'Drawing…',
}

const TINTS: ReadonlyArray<{ label: string; className: string }> = [
  { label: 'From the run', className: 'bg-[rgba(59,130,246,.18)]' },
  { label: 'Your review', className: 'bg-[rgba(245,158,11,.25)]' },
  { label: 'The scene', className: 'bg-[rgba(16,185,129,.2)]' },
  { label: 'A public table', className: 'bg-[rgba(139,92,246,.18)]' },
  { label: 'To fill in', className: 'bg-[#fde68a]' },
]

function Heading({ children }: { children: ReactNode }) {
  return <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>
}

/**
 * The VIA report's draft: on one side what it is made of (the recipe's format, style, layout and options, its parts,
 * clickable to their place on the page, and its pictures, each drawn on demand), on the other the report laid out as
 * the file will be, a stand-in where a picture is not drawn yet. Clicking a stand-in draws its group. Values are tinted
 * by where they came from; the file has no tints.
 */
export function ReportDraftView({
  draft,
  options,
  drawing,
  onDraw,
  drawError,
  pages,
  onEdit,
  startOnPages = false,
  onPages,
}: {
  draft: ReportDraftResult
  /** The output's own options (overview sheet, logo), shown beside the draft so a change shows at once. */
  options?: ReactNode
  /** The picture group being drawn now, or null. */
  drawing: string | null
  onDraw: (id: string) => void
  drawError: string | null
  /** Writes the draft on the PDF's pages; absent, the draft has only its flowing layout. */
  pages?: () => Promise<ReportDraftPages>
  /** Changes one value by hand (null puts back what the part printed); absent, the draft cannot be edited. */
  onEdit?: (key: string, value: string | null, original?: string | null) => void
  /** Open on the pages (the PDF format is chosen) rather than the flowing layout. */
  startOnPages?: boolean
  /** Told the page each part starts on once the pages are written, so the contents can say it. */
  onPages?: (partPages: number[]) => void
}) {
  const [layout, setLayout] = useState<'pages' | 'flow'>(startOnPages && pages ? 'pages' : 'flow')
  const [paged, setPaged] = useState<
    | { draft: ReportDraftResult; url: string; partPages: number[]; pages: number }
    | { draft: ReportDraftResult; error: string }
    | null
  >(null)
  // The page the pages layout brings into view: a new object each time a part is chosen, even the same one again.
  const [page, setPage] = useState<{ number: number }>({ number: 1 })
  const latestPages = useRef(pages)
  const latestEdit = useRef(onEdit)
  const latestTargets = useRef(draft.editTargets)
  const latestOnPages = useRef(onPages)
  useEffect(() => {
    latestOnPages.current = onPages
    latestPages.current = pages
    latestEdit.current = onEdit
    latestTargets.current = draft.editTargets
  })
  // The pages are written again whenever the draft is laid out again; the last ones stay up meanwhile.
  useEffect(() => {
    if (layout !== 'pages' || !latestPages.current) return
    let stopped = false
    latestPages
      .current()
      .then((built) => {
        if (stopped) return
        setPaged({ draft, url: URL.createObjectURL(built.blob), partPages: built.partPages, pages: built.pages })
        latestOnPages.current?.(built.partPages)
      })
      .catch((error: unknown) => {
        if (!stopped)
          setPaged({ draft, error: error instanceof Error ? error.message : 'The pages could not be written.' })
      })
    return () => {
      stopped = true
    }
  }, [layout, draft])
  const pagedUrl = paged && 'url' in paged ? paged.url : null
  useEffect(() => () => void (pagedUrl && URL.revokeObjectURL(pagedUrl)), [pagedUrl])
  const edited = Object.entries(draft.editTargets).filter(([, target]) => target.edited !== undefined)

  const frame = useRef<HTMLIFrameElement | null>(null)
  // The page keeps its place when the draft is laid out again (a picture drawn, an option changed).
  const scrolled = useRef(0)
  const latestDraw = useRef(onDraw)
  useEffect(() => {
    latestDraw.current = onDraw
  })

  const onLoad = () => {
    const doc = frame.current?.contentDocument
    const win = frame.current?.contentWindow
    if (!doc || !win) return
    win.scrollTo(0, scrolled.current)
    win.addEventListener('scroll', () => (scrolled.current = win.scrollY), { passive: true })
    // The frame runs no scripts of its own; the dialog listens for clicks on its stand-ins.
    doc.addEventListener('click', (event) => {
      const target = event.target as Element | null
      const image = target?.closest?.('img')
      const group = image ? drawGroupOf(image.getAttribute('src') ?? '') : null
      if (group) {
        event.preventDefault()
        latestDraw.current(group)
        return
      }
      const value = target?.closest?.('[data-edit]') as HTMLElement | null
      if (value && latestEdit.current) startEdit(value)
    })
  }

  /** Changes a value in place: a tick box toggles; anything else is typed over, kept on Enter or on leaving it. */
  const startEdit = (element: HTMLElement) => {
    const key = element.getAttribute('data-edit') ?? ''
    const target = latestTargets.current[key]
    const save = latestEdit.current
    if (!target || !save || element.isContentEditable) return
    const shown = target.edited ?? target.original ?? ''
    const option = element.getAttribute('data-option')
    if (option !== null) {
      save(key, option === shown ? '' : option, target.original)
      return
    }
    const before = element.innerHTML
    // A blank's ruled line is not text to type after.
    if (!shown) element.textContent = ''
    else if (target.kind === 'paragraph') element.textContent = shown
    element.setAttribute('contenteditable', 'plaintext-only')
    if (!element.isContentEditable) element.setAttribute('contenteditable', 'true')
    element.focus()
    let cancelled = false
    const done = () => {
      element.removeEventListener('blur', done)
      element.removeEventListener('keydown', onKey)
      element.removeAttribute('contenteditable')
      const typed = (element.innerText ?? '').replace(/\s+/g, ' ').trim()
      if (cancelled || typed === shown) element.innerHTML = before
      else save(key, typed, target.original)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelled = true
        element.blur()
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        element.blur()
      }
      event.stopPropagation()
    }
    element.addEventListener('blur', done)
    element.addEventListener('keydown', onKey)
  }

  const showPart = (index: number) => {
    if (layout === 'pages') {
      if (paged && 'url' in paged) setPage({ number: paged.partPages[index] ?? 1 })
      return
    }
    const doc = frame.current?.contentDocument
    const mark = doc?.getElementById(`part-${index}`)
    if (!mark) return
    mark.scrollIntoView({ block: 'start', behavior: 'smooth' })
    mark.classList.add('flash')
    window.setTimeout(() => mark.classList.remove('flash'), 1200)
  }

  return (
    <div className="grid min-w-0 gap-3 sm:h-full sm:min-h-0 sm:grid-cols-[17rem_minmax(0,1fr)]">
      <aside
        aria-label="What the report is made of"
        className="grid min-w-0 content-start gap-4 sm:min-h-0 sm:overflow-y-auto sm:pr-1"
      >
        {pages && (
          <section className="space-y-1.5" aria-label="Layout">
            <Heading>Layout</Heading>
            <SegmentedControl
              size="sm"
              fullWidth={false}
              label="Draft layout"
              value={layout}
              onChange={setLayout}
              options={[
                { value: 'pages' as const, label: 'Pages' },
                { value: 'flow' as const, label: onEdit ? 'Edit' : 'Flowing' },
              ]}
            />
            <p className="text-2xs text-muted-foreground">
              {layout === 'pages'
                ? `The pages the PDF prints${paged && 'url' in paged ? ` (${paged.pages})` : ''}: its own page breaks, landscape pages and 11 × 17 sheets, with stand-ins where a picture is not drawn yet.`
                : onEdit
                  ? 'One flowing page. Click a value to change it by hand: Enter keeps it, Esc leaves it. Click a stand-in to draw it.'
                  : 'One flowing page. Click a stand-in to draw it.'}
            </p>
          </section>
        )}
        {onEdit && (edited.length > 0 || draft.orphanEdits.length > 0) && (
          <section className="space-y-1.5" aria-label="Your edits">
            <Heading>Your edits · {edited.length}</Heading>
            <ul className={cn(insetBox({ padding: 'none' }), 'divide-y overflow-hidden')}>
              {edited.map(([key, target]) => (
                <li key={key} className="space-y-1 px-2.5 py-2 text-xs">
                  <p className="font-medium text-foreground">{target.label}</p>
                  <p className="break-words text-2xs text-muted-foreground">
                    {target.edited ? `“${target.edited}”` : 'Left blank'} · the report gave{' '}
                    {target.original ? `“${target.original}”` : 'a blank'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Put back ${target.label}`}
                    onClick={() => onEdit(key, null)}
                  >
                    Put back
                  </Button>
                </li>
              ))}
              {draft.orphanEdits.map((orphan) => (
                <li key={orphan.key} className="space-y-1 px-2.5 py-2 text-xs">
                  <p className="font-medium text-foreground">Not printed now</p>
                  <p className="break-words text-2xs text-muted-foreground">
                    “{orphan.value}” was typed for {orphan.key.split('|').filter(Boolean).join(' › ')}, which this
                    report no longer prints. It is kept, and not used.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => onEdit(orphan.key, null)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-2xs text-muted-foreground">
              An edit prints as yours in every format, and the report’s last line counts them.
            </p>
          </section>
        )}
        {options && (
          <section className="space-y-1.5" aria-label="Options">
            <Heading>Options</Heading>
            {options}
          </section>
        )}
        {draft.notes.map((note) => (
          <InlineAlert key={note} tone="warning">
            {note}
          </InlineAlert>
        ))}
        <section className="space-y-1.5" aria-label="Pictures">
          <Heading>Pictures</Heading>
          {drawError && <InlineAlert tone="error">{drawError}</InlineAlert>}
          <ul className={cn(insetBox({ padding: 'none' }), 'divide-y overflow-hidden')}>
            {draft.pictures.map((picture) => {
              const busy = drawing === picture.id || picture.state === 'working'
              return (
                <li key={picture.id} className="space-y-1 px-2.5 py-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 font-medium text-foreground">{picture.label}</p>
                    <span
                      className={cn(
                        'shrink-0 rounded-sm px-1.5 text-3xs font-semibold uppercase tracking-wide',
                        picture.state === 'drawn'
                          ? 'bg-success-surface text-success-foreground'
                          : picture.state === 'not-drawn'
                            ? 'bg-warning-surface text-warning-foreground'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {busy ? 'Drawing…' : STATE_LABEL[picture.state]}
                    </span>
                  </div>
                  {picture.note && <p className="text-2xs text-muted-foreground">{picture.note}</p>}
                  {picture.action && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!drawing || busy}
                      aria-label={`${picture.action}: ${picture.label}`}
                      onClick={() => onDraw(picture.id)}
                    >
                      {busy ? 'Drawing…' : picture.action}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="text-2xs text-muted-foreground">
            Drawing moves the page’s maps for a few seconds and puts them back. What you draw here is kept: Preview and
            Download draw only what is still a stand-in.
          </p>
        </section>
        <section className="space-y-1.5" aria-label="Made of">
          <Heading>Made of</Heading>
          <KeyValueRows
            variant="grid"
            size="xs"
            rows={draft.makeup.map((row) => ({ label: row.label, value: row.value }))}
            className={cn(insetBox({ padding: 'sm' }), 'text-2xs')}
          />
        </section>
        <section className="space-y-1.5" aria-label="Parts">
          <Heading>
            Parts · {draft.parts.length}
            {draft.toComplete ? ` · ${draft.toComplete} to complete` : ''}
          </Heading>
          <ol className={cn(insetBox({ padding: 'none' }), 'divide-y overflow-hidden')}>
            {draft.parts.map((part) => (
              <li key={`${part.index}-${part.id}`}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-baseline gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!part.printed}
                  onClick={() => showPart(part.index)}
                >
                  <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">{part.index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className={part.printed ? 'text-foreground' : 'text-muted-foreground'}>{part.title}</span>
                    <span className="block text-2xs text-muted-foreground">
                      {[
                        part.sources.length ? part.sources.join(', ') : 'PGMaps',
                        part.printed ? null : 'prints nothing for this assessment',
                        part.toComplete ? `${part.toComplete} to complete` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section className="space-y-1.5" aria-label="Tints">
          <Heading>Where each value comes from</Heading>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
            {TINTS.map((tint) => (
              <li key={tint.label} className="flex items-center gap-1">
                <span className={cn('inline-block size-3 rounded-sm border', tint.className)} aria-hidden="true" />
                {tint.label}
              </li>
            ))}
          </ul>
          <p className="text-2xs text-muted-foreground">Untinted text is the format’s own. The file has no tints.</p>
        </section>
      </aside>
      {/* Scripts stay off in the frame; same-origin lets the dialog find the parts and listen for stand-in clicks. */}
      {layout === 'pages' &&
        (paged && 'url' in paged ? (
          // The app's own page viewer, as the file's preview is shown: the same pages, zoom and gestures.
          <PdfPages
            source={paged.url}
            title="VIA report draft"
            resetKey="draft"
            page={page}
            className="h-[70dvh] min-w-0 sm:h-full sm:min-h-96"
          />
        ) : paged && 'error' in paged && paged.draft === draft ? (
          <InlineAlert tone="error">{paged.error}</InlineAlert>
        ) : (
          <InlineAlert loading>Writing the draft’s pages…</InlineAlert>
        ))}
      <div hidden={layout === 'pages'} className="h-[70dvh] min-w-0 sm:h-full sm:min-h-96">
        <FramePages
          html={draft.html}
          title="VIA report draft"
          frameTitle="VIA report draft"
          resetKey="draft"
          frameRef={(element) => {
            frame.current = element
          }}
          onFrameLoad={onLoad}
        />
      </div>
    </div>
  )
}
