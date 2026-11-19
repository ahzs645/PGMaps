import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { ArrowLeftRight, ChevronDown, ChevronUp, LoaderCircle } from 'lucide-react'
import { useElementSize } from '@/hooks/useElementSize'
import { loadPdfJs } from '@/lib/pdfPages/pdfjs'
import { cn } from '@/lib/utils'

import {
  OpenInTabButton,
  useOpenInTab,
  viewerControlClass,
  viewerGroupClass,
  ViewerToolbar,
  ViewerZoom,
} from './viewer-toolbar'
import { listenZoomGestures, zoomKey, type ZoomPoint } from './zoomGestures'

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
type Loaded = { doc: PDFDocumentProxy; sizes: PageSize[]; task: PDFDocumentLoadingTask }

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/**
 * A PDF drawn page by page in the application's own viewer, in place of the browser's: the same
 * bytes the download writes, with page and zoom controls in the app's style. Pages are drawn only
 * near the view and let go away from it, so a long plot book costs no more than the pages in sight.
 * *Open in a new tab* hands the same file to the browser's viewer, for search and print.
 *
 * The gestures are every file preview's (`docs/shared-ui.md`, **File previews**): a pinch or Ctrl/⌘ + wheel zooms
 * about the pointer, a plain wheel scrolls, a double click zooms in or fits again, and `+`, `-` and `0` work while the
 * pages have focus. A file written again for the same output (`resetKey` unchanged) keeps the reader's zoom and place:
 * the last pages stay up until the new ones are read. `page` brings a page into view each time a new one is asked for.
 */
export function PdfPages({
  source,
  title,
  className,
  resetKey,
  page,
  toolbarStart,
}: {
  source: Blob | string
  title: string
  className?: string
  /** A change starts the viewer again at the first page, fitted; by default, a new `source` does. */
  resetKey?: string | number | null
  /** A page to bring into view (1 for the first), asked for again by passing a new object. */
  page?: { number: number }
  /** Left of the bar, after the page controls: a caption. */
  toolbarStart?: ReactNode
}) {
  const key = resetKey === undefined ? source : resetKey
  // Each result is kept with the file it was read from and the viewer's key: a file for another key shows nothing
  // of the last, and one for the same key is shown until the next has been read.
  const [read, setRead] = useState<{ source: Blob | string; key: unknown; loaded?: Loaded; error?: string } | null>(
    null,
  )
  const loaded = read && (read.source === source || read.key === key) ? read.loaded : undefined
  const error = read?.source === source ? read.error : undefined
  // `null` fits the pages to the pane's width; a number is a zoom the reader chose.
  const [chosenScale, setChosenScale] = useState<number | null>(null)
  const [current, setCurrent] = useState(0)
  // A new key starts on its first page at the fitted width.
  const [shownKey, setShownKey] = useState<unknown>(key)
  if (shownKey !== key) {
    setShownKey(key)
    setCurrent(0)
    setChosenScale(null)
  }
  const scroller = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const { width } = useElementSize(scroller, { box: 'content' })

  useEffect(() => {
    let cancelled = false
    let handedOver = false
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
      handedOver = true
      setRead({ source, key, loaded: { doc, sizes, task: task! } })
    })().catch((reason: unknown) => {
      if (!cancelled)
        setRead({ source, key, error: reason instanceof Error ? reason.message : 'The PDF could not be read.' })
    })
    return () => {
      cancelled = true
      // A document already shown is let go when the next replaces it (below), not while it is still on screen.
      if (!handedOver) void task?.destroy()
    }
    // `key` travels with the result; only a new file is read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])
  const shownTask = read?.loaded?.task
  useEffect(() => {
    if (!shownTask) return
    return () => void shownTask.destroy()
  }, [shownTask])

  const openInTab = useOpenInTab()

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

  // A zoom keeps the point under the pointer (or, from the buttons, the top middle of the view) where it was. The
  // scale the pages are drawn at and the one asked for are kept apart, so a pinch's quick steps all start from the
  // last one asked for and keep the spot taken before the first was drawn.
  const drawnScale = useRef(0)
  const askedScale = useRef(0)
  const anchor = useRef<{ page: number; x: number; y: number; atX: number; atY: number } | null>(null)
  const zoomTo = (next: number | null, at?: ZoomPoint) => {
    const target = next === null ? null : clampScale(next)
    const effective = target ?? fitScale
    const view = scroller.current
    if (view && !anchor.current && drawnScale.current && Math.abs(effective - drawnScale.current) > 1e-6) {
      const box = view.getBoundingClientRect()
      const atX = at ? at.clientX - box.left : view.clientWidth / 2
      const atY = at ? at.clientY - box.top : 0
      const line = view.scrollTop + atY
      let page = 0
      pageRefs.current.forEach((element, index) => {
        if (element && element.offsetTop <= line) page = index
      })
      const element = pageRefs.current[page]
      if (element)
        anchor.current = {
          page,
          x: (view.scrollLeft + atX - element.offsetLeft) / drawnScale.current,
          y: (line - element.offsetTop) / drawnScale.current,
          atX,
          atY,
        }
    }
    askedScale.current = effective
    setChosenScale(target)
  }
  useLayoutEffect(() => {
    drawnScale.current = scale
    askedScale.current = scale
    const view = scroller.current,
      held = anchor.current
    anchor.current = null
    const element = held && pageRefs.current[held.page]
    if (view && element) {
      view.scrollTop = element.offsetTop + held.y * scale - held.atY
      view.scrollLeft = element.offsetLeft + held.x * scale - held.atX
    }
  }, [scale])
  const latestZoom = useRef(zoomTo)
  useEffect(() => {
    latestZoom.current = zoomTo
  })
  useEffect(() => {
    const view = scroller.current
    if (!view) return
    return listenZoomGestures(view, (factor, at) => {
      const from = askedScale.current
      if (from > 0) latestZoom.current(from * factor, at)
    })
  }, [])

  const goTo = (page: number) => {
    const element = pageRefs.current[page]
    if (element && scroller.current) scroller.current.scrollTo({ top: element.offsetTop - PAGE_PAD_PX })
  }
  // A page asked for is brought into view once its pages are laid out.
  const wanted = useRef(page)
  useEffect(() => {
    wanted.current = page
  }, [page])
  useLayoutEffect(() => {
    const asked = wanted.current
    if (!asked || !loaded || !scale) return
    wanted.current = undefined
    goTo(Math.max(0, Math.min(loaded.sizes.length - 1, asked.number - 1)))
  }, [page, loaded, scale])

  const count = loaded?.sizes.length ?? 0
  return (
    <div
      className={cn('relative flex h-full min-h-80 flex-col overflow-hidden rounded-md border bg-muted/60', className)}
      role="region"
      aria-label={`${title} pages`}
      onKeyDown={(event) => {
        const asked = zoomKey(event.nativeEvent)
        if (!asked || !scale) return
        event.preventDefault()
        zoomTo(asked === 'fit' ? null : askedScale.current * (asked === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP))
      }}
    >
      <ViewerToolbar
        start={
          <>
            <div className={viewerGroupClass} role="group" aria-label="Pages">
              <button
                type="button"
                className={viewerControlClass}
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
                className={viewerControlClass}
                aria-label="Next page"
                disabled={current >= count - 1}
                onClick={() => goTo(current + 1)}
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            {toolbarStart}
          </>
        }
      >
        <ViewerZoom
          percent={scale ? (scale / ACTUAL_SIZE) * 100 : null}
          canOut={!!scale && scale > MIN_SCALE + 1e-6}
          canIn={!!scale && scale < MAX_SCALE - 1e-6}
          fitted={chosenScale === null}
          onOut={() => zoomTo(scale / ZOOM_STEP)}
          onIn={() => zoomTo(scale * ZOOM_STEP)}
          onFit={() => zoomTo(null)}
          fitLabel="Fit to width"
          fitIcon={<ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />}
        />
        <OpenInTabButton onOpen={() => openInTab(source)} />
      </ViewerToolbar>
      {/* Sized by the pane, never by its pages: the fitted scale is read from this box, so pages that
          widened it would widen themselves again (`contain: inline-size`). */}
      <div
        ref={scroller}
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain [contain:inline-size] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        style={{ padding: PAGE_PAD_PX }}
        onScroll={readPage}
        onDoubleClick={(event) => {
          if (!scale) return
          zoomTo(chosenScale === null ? Math.max(fitScale * 2, ACTUAL_SIZE) : null, event)
        }}
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
