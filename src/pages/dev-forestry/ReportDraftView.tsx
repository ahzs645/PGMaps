import { useEffect, useRef, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
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
}: {
  draft: ReportDraftResult
  /** The output's own options (overview sheet, logo), shown beside the draft so a change shows at once. */
  options?: ReactNode
  /** The picture group being drawn now, or null. */
  drawing: string | null
  onDraw: (id: string) => void
  drawError: string | null
}) {
  const frame = useRef<HTMLIFrameElement>(null)
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
      }
    })
  }

  const showPart = (index: number) => {
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
      <iframe
        ref={frame}
        title="VIA report draft"
        sandbox="allow-same-origin"
        srcDoc={draft.html}
        onLoad={onLoad}
        className="h-[70dvh] w-full min-w-0 rounded-md border bg-white sm:h-full sm:min-h-96"
      />
    </div>
  )
}
