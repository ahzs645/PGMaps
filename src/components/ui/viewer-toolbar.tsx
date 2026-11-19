/**
 * The bar over every file preview (`docs/shared-ui.md`, **File previews**): pages where the file has them, zoom, and
 * *Open in a new tab*, in one place and one look whether the file is a PDF (`PdfPages`), a picture
 * (`PicturePreview`) or pages laid out as HTML (`FramePages`).
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { ExternalLink, Maximize, Minus, Plus } from 'lucide-react'

import { cn } from '@/lib/utils'

export const viewerControlClass =
  'flex h-7 w-7 items-center justify-center rounded-sm text-foreground hover:bg-foreground/[0.08] disabled:text-muted-foreground disabled:hover:bg-transparent touch:h-10 touch:w-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
export const viewerGroupClass =
  'flex items-center rounded-md border border-border bg-background p-0.5 text-2xs shadow-sm'

/** The bar itself: `start` on the left (pages, a caption), `children` on the right. */
export function ViewerToolbar({ start, children }: { start?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-background/90 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">{start}</div>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  )
}

/** The zoom group: out, the zoom as a percentage, in, and fit (to width for pages, whole for a picture). */
export function ViewerZoom({
  percent,
  onOut,
  onIn,
  onFit,
  canOut,
  canIn,
  fitted,
  fitLabel = 'Fit',
  fitIcon,
}: {
  /** The zoom shown, or null while it is not known. */
  percent: number | null
  onOut: () => void
  onIn: () => void
  onFit: () => void
  canOut: boolean
  canIn: boolean
  /** Already fitted: the fit button has nothing to do. */
  fitted: boolean
  fitLabel?: string
  fitIcon?: ReactNode
}) {
  return (
    <div className={viewerGroupClass} role="group" aria-label="Zoom">
      <button type="button" className={viewerControlClass} aria-label="Zoom out" disabled={!canOut} onClick={onOut}>
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span className="min-w-10 text-center tabular-nums text-muted-foreground" role="status">
        {percent === null ? '–' : `${Math.round(percent)}%`}
      </span>
      <button type="button" className={viewerControlClass} aria-label="Zoom in" disabled={!canIn} onClick={onIn}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className={viewerControlClass}
        aria-label={fitLabel}
        title={fitLabel}
        disabled={fitted}
        onClick={onFit}
      >
        {fitIcon ?? <Maximize className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </div>
  )
}

/** A `data:` address as a Blob, read at once: a browser will not open a `data:` address in a new tab. */
export function dataUrlBlob(url: string): Blob {
  const comma = url.indexOf(',')
  const head = url.slice(5, comma)
  const body = url.slice(comma + 1)
  const type = head.split(';')[0] || 'application/octet-stream'
  if (!/;base64$/i.test(head)) return new Blob([decodeURIComponent(body)], { type })
  const text = atob(body)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return new Blob([bytes], { type })
}

/** An address made for a new tab is let go this long after its viewer closes, so a tab still loading it keeps it. */
const OPENED_URL_GRACE_MS = 60_000

/**
 * Opens a file in a new tab, in the browser's own viewer (to search, print or read it apart from the dialog). Made on
 * the click, inside it, so the browser allows the tab. Every address it makes is let go after the viewer closes.
 */
export function useOpenInTab(): (source: Blob | string | (() => Blob | string)) => void {
  const made = useRef<string[]>([])
  useEffect(() => {
    const urls = made.current
    return () => {
      window.setTimeout(() => urls.forEach((url) => URL.revokeObjectURL(url)), OPENED_URL_GRACE_MS)
    }
  }, [])
  return (given) => {
    const source = typeof given === 'function' ? given() : given
    let url: string
    if (typeof source !== 'string' || source.startsWith('data:')) {
      url = URL.createObjectURL(typeof source === 'string' ? dataUrlBlob(source) : source)
      made.current.push(url)
    } else url = source
    window.open(url, '_blank', 'noopener')
  }
}

/** *Open in a new tab*, the same button on every preview. */
export function OpenInTabButton({ onOpen, className }: { onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-2xs text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:h-11',
        className,
      )}
      title="Open in a new tab, in the browser's own viewer, to search or print"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      <span className="max-sm:sr-only">Open in a new tab</span>
    </button>
  )
}
