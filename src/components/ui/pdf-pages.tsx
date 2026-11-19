import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { ArrowLeftRight, ChevronDown, ChevronUp, ExternalLink, LoaderCircle, Minus, Plus } from 'lucide-react'
import { useElementSize } from '@/hooks/useElementSize'
import { loadPdfJs } from '@/lib/pdfPages/pdfjs'
import { cn } from '@/lib/utils'

/** CSS pixels per PDF point: a page at 100% is its printed size on screen. */
const ACTUAL_SIZE = 96 / 72
const MIN_SCALE = 0.25 * ACTUAL_SIZE
const MAX_SCALE = 4 * ACTUAL_SIZE
const ZOOM_STEP = 1.25
/** Fitting the width never enlarges a page past this, so a wide pane or full screen does not blow a page up. */
const MAX_FIT_SCALE = 1.5 * ACTUAL_SIZE
const PAGE_GAP_PX = 16
const PAGE_PAD_PX = 16
/** A page is drawn once it comes within this much of the view, and let go when it leaves it. */
const DRAW_MARGIN = '150% 0px'
/** A zoom is drawn again once it rests; until then the last drawing is stretched. */
const REDRAW_DELAY_MS = 150
/** A canvas larger than this is drawn at a lower pixel ratio, to stay inside the browser's canvas limits. */
const MAX_CANVAS_PIXELS = 16_000_000

type PageSize = { width: number; height: number }
type Loaded = { doc: PDFDocumentProxy; sizes: PageSize[] }

const controlClass =
  'flex h-7 w-7 items-center justify-center rounded-sm text-foreground hover:bg-foreground/[0.08] disabled:text-muted-foreground disabled:hover:bg-transparent touch:h-10 touch:w-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const groupClass = 'flex items-center rounded-md border border-border bg-background p-0.5 text-2xs shadow-sm'

/**
 * A PDF drawn page by page in the application's own viewer, in place of the browser's: the same
 * bytes the download writes, with page and zoom controls in the app's style. Pages are drawn only
 * near the view and let go away from it, so a long plot book costs no more than the pages in sight.
 * *Open in a new tab* hands the same file to the browser's viewer, for search and print.
 */
export function PdfPages({ source, title, className }: { source: Blob | string; title: string; className?: string }) {
  // Each result is kept with the file it was read from, so a new file shows nothing of the last.
  const [read, setRead] = useState<{ source: Blob | string; loaded?: Loaded; error?: string } | null>(null)
  const loaded = read?.source === source ? read.loaded : undefined
  const error = read?.source === source ? read.error : undefined
  // `null` fits the pages to the pane's width; a number is a zoom the reader chose.
  const [chosenScale, setChosenScale] = useState<number | null>(null)
  const [current, setCurrent] = useState(0)
  // A new file starts on its first page at the fitted width.
  const [shownSource, setShownSource] = useState(source)
  if (shownSource !== source) {
    setShownSource(source)
    setCurrent(0)
    setChosenScale(null)
  }
  const scroller = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const { width } = useElementSize(scroller, { box: 'content' })

  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    ;(async () => {
      const [pdfjs, bytes] = await Promise.all([
        loadPdfJs(),
        typeof source === 'string' ? fetch(source).then((response) => response.arrayBuffer()) : source.arrayBuffer(),
      ])
      if (cancelled) return
      task = pdfjs.getDocument({ data: new Uint8Array(bytes), enableXfa: false, useWasm: false, verbosity: 0 })
      const doc = await task.promise
      const sizes: PageSize[] = []
      for (let number = 1; number <= doc.numPages; number++) {
        const viewport = (await doc.getPage(number)).getViewport({ scale: 1 })
        if (cancelled) return
        sizes.push({ width: viewport.width, height: viewport.height })
      }
      setRead({ source, loaded: { doc, sizes } })
    })().catch((reason: unknown) => {
      if (!cancelled)
        setRead({ source, error: reason instanceof Error ? reason.message : 'The PDF could not be read.' })
    })
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [source])

  // *Open in a new tab* makes its address on the click; every address made is let go with the viewer.
  const opened = useRef<string[]>([])
  useEffect(() => {
    const urls = opened.current
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [])
  const openInTab = () => {
    let url = source
    if (typeof url !== 'string') {
      url = URL.createObjectURL(url)
      opened.current.push(url)
    }
    window.open(url, '_blank', 'noopener')
  }

  const widest = loaded ? Math.max(...loaded.sizes.map((size) => size.width)) : 0
  const fitScale =
    // The scroller's content box is already inside its padding.
    widest > 0 && width > 0 ? Math.min(MAX_FIT_SCALE, Math.max(MIN_SCALE, width / widest)) : 0
  const scale = chosenScale ?? fitScale

  // The page whose body crosses the upper third of the view is the one being read.
  const readPage = useCallback(() => {
    const view = scroller.current
    if (!view) return
    const line = view.scrollTop + view.clientHeight / 3
    let page = 0
    pageRefs.current.forEach((element, index) => {
      if (element && element.offsetTop <= line) page = index
    })
    setCurrent(page)
  }, [])

  // A zoom keeps the point at the top of the view where it was.
  const anchor = useRef<{ page: number; offset: number } | null>(null)
  const zoomTo = (next: number | null) => {
    const view = scroller.current,
      element = pageRefs.current[current]
    if (view && element) anchor.current = { page: current, offset: (view.scrollTop - element.offsetTop) / scale }
    setChosenScale(next === null ? null : Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)))
  }
  useLayoutEffect(() => {
    const view = scroller.current,
      held = anchor.current
    anchor.current = null
    const element = held && pageRefs.current[held.page]
    if (view && element) view.scrollTop = element.offsetTop + held.offset * scale
  }, [scale])

  const goTo = (page: number) => {
    const element = pageRefs.current[page]
    if (element && scroller.current) scroller.current.scrollTo({ top: element.offsetTop - PAGE_PAD_PX })
  }

  const count = loaded?.sizes.length ?? 0
  return (
    <div
      className={cn('relative flex h-full min-h-80 flex-col overflow-hidden rounded-md border bg-muted/60', className)}
      role="region"
      aria-label={`${title} pages`}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-background/90 px-2 py-1.5">
        <div className={groupClass} role="group" aria-label="Pages">
          <button
            type="button"
            className={controlClass}
            aria-label="Previous page"
            disabled={current <= 0}
            onClick={() => goTo(current - 1)}
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="min-w-16 px-1 text-center tabular-nums text-muted-foreground" aria-live="polite">
            {count ? `Page ${current + 1} of ${count}` : 'Pages'}
          </span>
          <button
            type="button"
            className={controlClass}
            aria-label="Next page"
            disabled={current >= count - 1}
            onClick={() => goTo(current + 1)}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={groupClass} role="group" aria-label="Zoom">
            <button
              type="button"
              className={controlClass}
              aria-label="Zoom out"
              disabled={!scale || scale <= MIN_SCALE + 1e-6}
              onClick={() => zoomTo(scale / ZOOM_STEP)}
            >
              <Minus className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span className="min-w-10 text-center tabular-nums text-muted-foreground" role="status">
              {scale ? `${Math.round((scale / ACTUAL_SIZE) * 100)}%` : '–'}
            </span>
            <button
              type="button"
              className={controlClass}
              aria-label="Zoom in"
              disabled={!scale || scale >= MAX_SCALE - 1e-6}
              onClick={() => zoomTo(scale * ZOOM_STEP)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              className={controlClass}
              aria-label="Fit to width"
              title="Fit to width"
              disabled={chosenScale === null}
              onClick={() => zoomTo(null)}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <button
            type="button"
            onClick={openInTab}
            className="flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-2xs text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:h-11"
            title="Open in the browser's own viewer, to search or print"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            <span className="max-sm:sr-only">Open in a new tab</span>
          </button>
        </div>
      </div>
      {/* Sized by the pane, never by its pages: the fitted scale is read from this box, so pages that
          widened it would widen themselves again (`contain: inline-size`). */}
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain [contain:inline-size]"
        style={{ padding: PAGE_PAD_PX }}
        onScroll={readPage}
      >
        {error ? (
          <p className="m-auto max-w-sm p-6 text-center text-xs text-muted-foreground" role="alert">
            The preview could not draw this PDF ({error}). The download is not affected.
          </p>
        ) : !loaded || !scale ? (
          <p className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Drawing the pages…
          </p>
        ) : (
          <div className="mx-auto flex w-max flex-col items-center" style={{ gap: PAGE_GAP_PX }}>
            {loaded.sizes.map((size, index) => (
              <PdfPage
                key={index}
                doc={loaded.doc}
                number={index + 1}
                size={size}
                scale={scale}
                root={scroller}
                pageRef={(element) => {
                  pageRefs.current[index] = element
                }}
                label={`Page ${index + 1} of ${count}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PdfPage({
  doc,
  number,
  size,
  scale,
  root,
  label,
  pageRef,
}: {
  doc: PDFDocumentProxy
  number: number
  size: PageSize
  scale: number
  root: RefObject<HTMLDivElement | null>
  label: string
  pageRef: (element: HTMLDivElement | null) => void
}) {
  const box = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  const [drawn, setDrawn] = useState(false)
  // Read by the draw only to choose its delay, so a finished draw does not start another.
  const drawnRef = useRef(false)
  useEffect(() => {
    drawnRef.current = drawn
  }, [drawn])

  useEffect(() => {
    const element = box.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        setNear(entry.isIntersecting)
        // Away from the view a page keeps its place but not its pixels.
        if (!entry.isIntersecting && canvas.current) {
          canvas.current.width = canvas.current.height = 0
          setDrawn(false)
        }
      },
      {
        root: root.current,
        rootMargin: DRAW_MARGIN,
      },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [root])

  useEffect(() => {
    const target = canvas.current
    if (!target || !near) return
    let task: RenderTask | null = null
    let stopped = false
    const timer = window.setTimeout(
      async () => {
        try {
          const page = await doc.getPage(number)
          if (stopped) return
          const cssWidth = size.width * scale,
            cssHeight = size.height * scale
          const ratio = Math.min(
            window.devicePixelRatio || 1,
            Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, cssWidth * cssHeight)),
          )
          const viewport = page.getViewport({ scale: scale * ratio })
          // Drawn off screen and swapped in whole, so a redraw never shows a blank page.
          const off = document.createElement('canvas')
          off.width = Math.ceil(viewport.width)
          off.height = Math.ceil(viewport.height)
          task = page.render({ canvas: off, viewport })
          await task.promise
          if (stopped) return
          target.width = off.width
          target.height = off.height
          target.getContext('2d')?.drawImage(off, 0, 0)
          off.width = off.height = 0
          setDrawn(true)
        } catch {
          // A cancelled draw (the zoom moved on, the page left the view) is not a failure.
        }
      },
      drawnRef.current ? REDRAW_DELAY_MS : 0,
    )
    return () => {
      stopped = true
      window.clearTimeout(timer)
      task?.cancel()
    }
  }, [doc, number, near, scale, size.width, size.height])

  return (
    <div
      ref={(element) => {
        box.current = element
        pageRef(element)
      }}
      className="relative shrink-0 bg-white shadow-md ring-1 ring-black/10"
      style={{ width: size.width * scale, height: size.height * scale }}
      role="img"
      aria-label={label}
      data-pdf-page={number}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {!drawn && (
        <LoaderCircle
          className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-hidden
        />
      )}
    </div>
  )
}
